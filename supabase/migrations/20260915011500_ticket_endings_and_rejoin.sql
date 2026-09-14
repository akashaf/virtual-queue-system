-- Every way a Ticket ends other than Served, and the one way back in (#7).
--
-- The Owner's endings (No-show, Remove) are authenticated the way #6's are: the
-- Shop comes from auth.uid(), and a Ticket that is not in that Shop's current
-- Queue Day simply is not found. The Customer's (Leave, Rejoin) are called by
-- Next.js with the secret key, after the server has read the device cookie, and
-- prove themselves with that device id instead.

/** How long a chair waits before the Owner may give up on a Customer (backend.md §4). */
create function public.no_show_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '5 minutes';
$$;

/** The least that identifies a Ticket to the screen that just acted on it. */
create function public.ticket_ref_json(p_ticket public.tickets)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', p_ticket.id, 'number', p_ticket.number);
$$;

/*
 * The same lookup #6 introduced, widened to the several statuses an action may
 * accept. Remove takes a Customer out of the Queue or the chair alike, so it
 * cannot name just one.
 */
create function public.owner_ticket(
  p_shop public.shops,
  p_ticket_id uuid,
  p_statuses public.ticket_status[]
)
returns public.tickets
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ticket public.tickets;
begin
  select * into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
    and t.queue_day_id = p_shop.current_queue_day_id
    and t.status = any (p_statuses);

  if not found then
    raise exception 'ticket_not_found';
  end if;

  return v_ticket;
end;
$$;

/*
 * The Customer's own Ticket, proved by the device that holds it.
 *
 * The device id is the whole of a Customer's claim (backend.md §7), so it is
 * part of the lookup rather than a check after it: a Ticket that belongs to
 * another device is simply not this device's to find.
 */
create function public.device_ticket(
  p_shop public.shops,
  p_ticket_id uuid,
  p_device_id uuid,
  p_statuses public.ticket_status[]
)
returns public.tickets
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ticket public.tickets;
begin
  select * into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
    and t.shop_id = p_shop.id
    and t.device_id = p_device_id
    and t.status = any (p_statuses);

  if p_device_id is null or not found then
    raise exception 'ticket_not_found';
  end if;

  return v_ticket;
end;
$$;

/*
 * The Customer never came to the chair.
 *
 * Only after the wait, because the Customer may be walking over: a No-show is
 * final, and taking it back means asking them to join again at the back of the
 * Queue. It frees the device, so they can.
 *
 * Errors: ticket_not_found, too_early.
 */
create function public.mark_no_show(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_ticket public.tickets;
begin
  v_shop := public.lock_owner_shop();
  v_ticket := public.owner_ticket(v_shop, p_ticket_id, array['called']::public.ticket_status[]);

  if now() - v_ticket.called_at < public.no_show_window() then
    raise exception 'too_early';
  end if;

  update public.tickets
  set status = 'no_show', finished_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  return jsonb_build_object(
    'result', public.ticket_ref_json(v_ticket),
    'alerts', '[]'::jsonb
  );
end;
$$;

/*
 * The Owner takes a Ticket out: a Customer who left without saying so, a
 * duplicate, a mistake. Allowed from the Queue and from the chair alike.
 *
 * Errors: ticket_not_found.
 */
create function public.remove_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_ticket public.tickets;
begin
  v_shop := public.lock_owner_shop();
  v_ticket := public.owner_ticket(v_shop, p_ticket_id, array['waiting', 'called']::public.ticket_status[]);

  update public.tickets
  set status = 'removed', removed_reason = 'owner', finished_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  return jsonb_build_object(
    'result', public.ticket_ref_json(v_ticket),
    'alerts', '[]'::jsonb
  );
end;
$$;

/*
 * The Customer gives up their place.
 *
 * Allowed from the chair as well as from the Queue (§12 rule 5): a Customer who
 * walks out should free the chair at once, rather than leaving the Owner to wait
 * five minutes for No-show to unlock.
 *
 * Errors: ticket_not_found.
 */
create function public.leave_queue(p_ticket_id uuid, p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_ticket public.tickets;
begin
  select * into v_shop
  from public.shops s
  where s.id = (select t.shop_id from public.tickets t where t.id = p_ticket_id)
  for update;

  if not found then
    raise exception 'ticket_not_found';
  end if;

  v_ticket := public.device_ticket(
    v_shop, p_ticket_id, p_device_id, array['waiting', 'called']::public.ticket_status[]
  );

  update public.tickets
  set status = 'left', finished_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  return jsonb_build_object(
    'result', public.customer_view_json(v_shop, v_ticket),
    'alerts', '[]'::jsonb
  );
end;
$$;

/*
 * A second chance for a Customer who was called and missed it.
 *
 * The Join Radius is deliberately not checked (ADR 0002): the Customer proved
 * they were at the Shop when they scanned, and the QR code is not in reach of
 * someone standing in a chair. What keeps that exemption narrow is the source —
 * a No-show, from a scan, in the Shop's *current* Queue Day (§12 rule 6) — so an
 * old Ticket can never become a way in from anywhere.
 *
 * Errors: shop_inactive, last_call, not_rejoinable, already_in_queue, queue_full.
 */
create function public.rejoin_queue(p_ticket_id uuid, p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_source public.tickets;
  v_ticket public.tickets;
  v_active int;
  v_ahead int;
  v_number int;
begin
  -- The Shop lock first, as every mutation does, so the queue-size check below
  -- cannot be raced by a join happening at the same moment.
  select * into v_shop
  from public.shops s
  where s.id = (select t.shop_id from public.tickets t where t.id = p_ticket_id)
  for update;

  if not found or not v_shop.is_active then
    raise exception 'shop_inactive';
  end if;

  if v_shop.joining_state <> 'open' then
    raise exception 'last_call';
  end if;

  -- One Rejoin per scan: the source has to be a No-show that came from a scan,
  -- is still in today's Queue Day, belongs to this device, and has not already
  -- been rejoined from.
  select * into v_source
  from public.tickets t
  where t.id = p_ticket_id
    and t.queue_day_id = v_shop.current_queue_day_id
    and t.device_id = p_device_id
    and t.status = 'no_show'
    and t.origin = 'scan'
    and not exists (
      select 1 from public.tickets child where child.parent_ticket_id = t.id
    );

  if p_device_id is null or not found then
    raise exception 'not_rejoinable';
  end if;

  -- The Customer may have scanned again rather than waiting for this button.
  if exists (
    select 1 from public.tickets t
    where t.shop_id = v_shop.id
      and t.device_id = p_device_id
      and t.status in ('waiting', 'called')
  ) then
    raise exception 'already_in_queue';
  end if;

  select
    count(*) filter (where t.status in ('waiting', 'called')),
    count(*) filter (where t.status = 'waiting')
  into v_active, v_ahead
  from public.tickets t
  where t.queue_day_id = v_shop.current_queue_day_id;

  if v_active >= v_shop.max_queue_size then
    raise exception 'queue_full';
  end if;

  update public.queue_days
  set next_number = next_number + 1
  where id = v_shop.current_queue_day_id
  returning next_number - 1 into v_number;

  insert into public.tickets (
    shop_id, queue_day_id, number, customer_name, device_id, origin,
    parent_ticket_id, heads_up_sent_at
  )
  values (
    v_shop.id, v_shop.current_queue_day_id, v_number,
    -- The name the Customer already gave; they are not asked for it again.
    v_source.customer_name, p_device_id, 'rejoin', v_source.id,
    -- Stamped without an alert for the same reason join_queue stamps it: the
    -- Customer is looking at the page that is about to say how many are ahead.
    case when v_ahead <= v_shop.heads_up_threshold then now() end
  )
  returning * into v_ticket;

  return jsonb_build_object(
    'result', public.customer_view_json(v_shop, v_ticket),
    'alerts', '[]'::jsonb
  );
end;
$$;

/*
 * #6's Done and Undo, moved onto the one `owner_ticket` above. Their behaviour
 * is unchanged; only the shape of the status they ask for is.
 */
create or replace function public.mark_served(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_ticket public.tickets;
begin
  v_shop := public.lock_owner_shop();
  v_ticket := public.owner_ticket(v_shop, p_ticket_id, array['called']::public.ticket_status[]);

  update public.tickets
  set status = 'served', served_at = now(), finished_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  return jsonb_build_object(
    'result', public.served_ticket_json(v_ticket),
    'alerts', '[]'::jsonb
  );
end;
$$;

create or replace function public.undo_served(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_ticket public.tickets;
begin
  v_shop := public.lock_owner_shop();
  v_ticket := public.owner_ticket(v_shop, p_ticket_id, array['served']::public.ticket_status[]);

  if now() - v_ticket.served_at > public.undo_window() then
    raise exception 'undo_expired';
  end if;

  -- Done freed the device, so the Customer may already have taken a new place
  -- in the Queue. Putting the old Ticket back would give them two active ones,
  -- which tickets_one_active_per_device refuses — and a raw 23505 is no way to
  -- tell an Owner that the person in front of them is queueing again. A null
  -- device_id, which is what erasure leaves behind, matches nobody.
  if v_ticket.device_id is not null and exists (
    select 1 from public.tickets t
    where t.shop_id = v_shop.id
      and t.device_id = v_ticket.device_id
      and t.status in ('waiting', 'called')
  ) then
    raise exception 'rejoined';
  end if;

  -- called_at is left alone: the Customer really was called then, and the
  -- Owner's "called N min ago" would otherwise restart from zero.
  update public.tickets
  set status = 'called', served_at = null, finished_at = null
  where id = v_ticket.id
  returning * into v_ticket;

  return jsonb_build_object(
    'result', public.called_ticket_json(v_ticket),
    'alerts', '[]'::jsonb
  );
end;
$$;

drop function public.owner_ticket(public.shops, uuid, public.ticket_status);

-- Finding the Ticket a device last held in the current Queue Day, which is what
-- get_customer_view now answers with.
create index tickets_device_in_queue_day
  on public.tickets (queue_day_id, device_id, joined_at desc);

/*
 * The Customer's view, now carrying what became of their Ticket.
 *
 * `can_rejoin` is the whole of the Rejoin offer: a No-show, from a scan, still
 * in today's Queue Day, that has not already been rejoined from. The Shop-level
 * reasons a Rejoin can still fail — Last Call, a full Queue — are deliberately
 * not folded in: they change from one moment to the next, and rejoin_queue
 * answers them with a token the page can put into words.
 */
create or replace function public.customer_view_json(
  p_shop public.shops,
  p_ticket public.tickets
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'shop', jsonb_build_object(
      'id', p_shop.id,
      'name', p_shop.name,
      'is_active', p_shop.is_active,
      'joining_state', p_shop.joining_state,
      'waiting_count', (
        select count(*)
        from public.tickets t
        where t.queue_day_id = p_shop.current_queue_day_id
          and t.status = 'waiting'
      )
    ),
    'ticket', case
      when p_ticket.id is null then null
      else jsonb_build_object(
        'id', p_ticket.id,
        'number', p_ticket.number,
        'status', p_ticket.status,
        -- Called Tickets are in a chair, not ahead of anyone; a Ticket that has
        -- ended is ahead of nobody either, and its position is not shown.
        'position', (
          select count(*)
          from public.tickets t
          where t.queue_day_id = p_ticket.queue_day_id
            and t.status = 'waiting'
            and t.number < p_ticket.number
        ),
        'can_rejoin', (
          p_ticket.status = 'no_show'
          and p_ticket.origin = 'scan'
          and p_ticket.queue_day_id = p_shop.current_queue_day_id
          and not exists (
            select 1 from public.tickets child
            where child.parent_ticket_id = p_ticket.id
          )
        )
      )
    end
  );
$$;

/*
 * The Customer page's whole view, by Shop slug and device.
 *
 * The Ticket is the last one this device took in the Shop's current Queue Day,
 * whatever became of it — not only an active one. A Customer whose Ticket was
 * ended by the Owner cannot otherwise be told which of No-show, Removed and
 * Served happened to them, and `can_rejoin` has nowhere to live: all three look
 * identical from a page that only ever sees the Ticket disappear.
 *
 * Scoped to the current Queue Day, so a Customer coming back tomorrow meets the
 * join form rather than yesterday's news. The page keeps a dismissed Ticket's id
 * in sessionStorage, which is how tapping past a final state works without the
 * server having to remember that it was read (frontend.md §3.1).
 */
create or replace function public.get_customer_view(
  p_slug text,
  p_device_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_ticket public.tickets;
begin
  select * into v_shop from public.shops where slug = p_slug;
  if not found then
    return null;
  end if;

  if p_device_id is not null then
    select * into v_ticket
    from public.tickets t
    where t.queue_day_id = v_shop.current_queue_day_id
      and t.device_id = p_device_id
    order by t.joined_at desc, t.number desc
    limit 1;
  end if;

  return public.customer_view_json(v_shop, v_ticket);
end;
$$;

/*
 * One Called Ticket, now counting down to when the Owner may give up on them.
 *
 * Measured here for the same reason the Undo window is: a tablet with a wrong
 * clock must not offer a No-show that `mark_no_show` would answer `too_early`.
 */
create or replace function public.called_ticket_json(p_ticket public.tickets)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_ticket.id,
    'number', p_ticket.number,
    'name', p_ticket.customer_name,
    'called_at', p_ticket.called_at,
    'no_show_in_ms', greatest(0, round(
      extract(epoch from (p_ticket.called_at + public.no_show_window() - now())) * 1000
    ))::int
  );
$$;

/*
 * The Owner's live Queue, now saying which Waiting Tickets came from a Rejoin.
 *
 * A rejoined Ticket is at the back with a high number but its Customer has been
 * in the shop a while, so the Owner is told rather than left to wonder.
 */
create or replace function public.get_owner_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
begin
  select * into v_shop
  from public.shops
  where owner_user_id = (select auth.uid())
    and is_active;

  if not found then
    raise exception 'shop_inactive';
  end if;

  return jsonb_build_object(
    'shop', jsonb_build_object(
      'id', v_shop.id,
      'name', v_shop.name,
      'joining_state', v_shop.joining_state
    ),
    'waiting', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'number', t.number,
          'name', t.customer_name,
          'joined_at', t.joined_at,
          'origin', t.origin
        )
        order by t.number
      )
      from public.tickets t
      where t.queue_day_id = v_shop.current_queue_day_id
        and t.status = 'waiting'
    ), '[]'::jsonb),
    'called', coalesce((
      select jsonb_agg(public.called_ticket_json(t) order by t.called_at)
      from public.tickets t
      where t.queue_day_id = v_shop.current_queue_day_id
        and t.status = 'called'
    ), '[]'::jsonb),
    'just_served', coalesce((
      select jsonb_agg(public.served_ticket_json(t) order by t.served_at desc)
      from public.tickets t
      where t.queue_day_id = v_shop.current_queue_day_id
        and t.status = 'served'
        and now() - t.served_at <= public.undo_window()
    ), '[]'::jsonb)
  );
end;
$$;

-- Supabase grants execute on every new function to the Data API roles; take it
-- back, then hand out only what backend.md §3 allows.
revoke all on function public.no_show_window() from public, anon, authenticated, service_role;
revoke all on function public.ticket_ref_json(public.tickets)
  from public, anon, authenticated, service_role;
revoke all on function public.owner_ticket(public.shops, uuid, public.ticket_status[])
  from public, anon, authenticated, service_role;
revoke all on function public.mark_no_show(uuid) from public, anon, authenticated;
revoke all on function public.remove_ticket(uuid) from public, anon, authenticated;
revoke all on function public.device_ticket(
  public.shops, uuid, uuid, public.ticket_status[]
) from public, anon, authenticated, service_role;
revoke all on function public.leave_queue(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rejoin_queue(uuid, uuid) from public, anon, authenticated;

grant execute on function public.mark_no_show(uuid) to authenticated;
grant execute on function public.remove_ticket(uuid) to authenticated;
grant execute on function public.leave_queue(uuid, uuid) to service_role;
grant execute on function public.rejoin_queue(uuid, uuid) to service_role;
