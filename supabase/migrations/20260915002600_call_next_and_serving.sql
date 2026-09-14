-- Call next, Done and Undo, and the live ping that tells both screens (#6).
--
-- Every function here is called with the Owner's own JWT, so none of them takes
-- a Shop argument: the Shop comes from auth.uid(), and a Ticket that is not in
-- that Shop's current Queue Day simply is not found.

/*
 * Locks the caller's Shop and hands it back, or refuses.
 *
 * The lock is the first thing every mutation does (backend.md §2), so all of one
 * Shop's mutations run one at a time — it is what makes two simultaneous Call
 * next presses take two different Tickets rather than the same one.
 *
 * shop_inactive covers "no Shop" and "Deactivated Shop" alike, the way
 * get_owner_queue does: both mean this caller runs no Queue right now.
 */
create function public.lock_owner_shop()
returns public.shops
language plpgsql
set search_path = ''
as $$
declare
  v_shop public.shops;
begin
  select * into v_shop
  from public.shops
  where owner_user_id = (select auth.uid())
    and is_active
  for update;

  if not found then
    raise exception 'shop_inactive';
  end if;

  return v_shop;
end;
$$;

/** One Called Ticket as the Owner's screen shows it. */
create function public.called_ticket_json(p_ticket public.tickets)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_ticket.id,
    'number', p_ticket.number,
    'name', p_ticket.customer_name,
    'called_at', p_ticket.called_at
  );
$$;

/*
 * Summons the Customer at the front of the Queue.
 *
 * Calling is separate from marking a Ticket Served, so several Tickets may be
 * Called at once — one per free chair.
 *
 * Errors: queue_empty.
 */
create function public.call_next()
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

  select * into v_ticket
  from public.tickets t
  where t.queue_day_id = v_shop.current_queue_day_id
    and t.status = 'waiting'
  order by t.number
  limit 1;

  if not found then
    raise exception 'queue_empty';
  end if;

  update public.tickets
  set status = 'called', called_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  -- The `called` alert, and the Heads-up the Ticket behind may now be owed,
  -- arrive with #8, which is what builds the dispatcher to send them.
  return jsonb_build_object(
    'result', public.called_ticket_json(v_ticket),
    'alerts', '[]'::jsonb
  );
end;
$$;

/*
 * Finds one of the caller's Tickets, or refuses.
 *
 * "Not this Shop's Ticket", "not in today's Queue" and "no longer in that state"
 * are one answer on purpose: an Owner learns nothing about another Shop's
 * Queue, and a stale button on their own screen gets told the same true thing —
 * that Ticket is not one they can act on now.
 */
create function public.owner_ticket(
  p_shop public.shops,
  p_ticket_id uuid,
  p_status public.ticket_status
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
    and t.status = p_status;

  if not found then
    raise exception 'ticket_not_found';
  end if;

  return v_ticket;
end;
$$;

/** How long the Owner has to take a Done back (CONTEXT.md, Ticket status). */
create function public.undo_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '2 minutes';
$$;

/*
 * One Served Ticket, with the time left to undo it.
 *
 * The window is measured here rather than on the Owner's device, so a tablet
 * with a wrong clock cannot offer an Undo that undo_served will refuse.
 */
create function public.served_ticket_json(p_ticket public.tickets)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_ticket.id,
    'number', p_ticket.number,
    'name', p_ticket.customer_name,
    'undo_expires_in_ms', greatest(0, round(
      extract(epoch from (p_ticket.served_at + public.undo_window() - now())) * 1000
    ))::int
  );
$$;

/*
 * The haircut is done. The only billable event there is (CONTEXT.md, Served
 * Ticket), which is why it is a deliberate press and not a side effect of
 * calling the next Customer.
 *
 * Errors: ticket_not_found.
 */
create function public.mark_served(p_ticket_id uuid)
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
  v_ticket := public.owner_ticket(v_shop, p_ticket_id, 'called');

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

/*
 * Takes a Done back: a mis-tap, or a Customer who turns out not to be finished.
 *
 * Allowed only while the Undo window is open, because a Served Ticket is what
 * the Shop is billed for and history has to settle at some point.
 *
 * Errors: ticket_not_found, undo_expired, rejoined.
 */
create function public.undo_served(p_ticket_id uuid)
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
  v_ticket := public.owner_ticket(v_shop, p_ticket_id, 'served');

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

/*
 * The Owner's live Queue, now with the Dones they can still take back.
 *
 * "Just served" is read from the database rather than remembered by the screen,
 * so the Undo survives a reload and shows up on the Shop's other device too.
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
          'joined_at', t.joined_at
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

/*
 * Tells a Shop's open screens that something moved (backend.md §6).
 *
 * The ping carries no Ticket data at all, which is what makes a public topic
 * acceptable: it reveals that a Queue changed, never who is in it. Every client
 * refetches its own view, so a Customer's browser still only ever learns about
 * its own Ticket.
 *
 * realtime.send swallows its own failures as a warning, so a Realtime outage can
 * never roll back the mutation that triggered it; the 30 s poll covers the gap.
 *
 * The Shop id comes from the column named in the trigger argument, so one
 * function serves both tables.
 */
create function public.broadcast_queue_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('at', now()),
    'queue_changed',
    'shop:' || (to_jsonb(new) ->> tg_argv[0]),
    false
  );
  return null;
end;
$$;

create trigger tickets_broadcast_queue_changed
  after insert or update on public.tickets
  for each row execute function public.broadcast_queue_changed('shop_id');

create trigger shops_broadcast_queue_changed
  after insert or update on public.shops
  for each row execute function public.broadcast_queue_changed('id');

/*
 * The Customer's view, now carrying the Shop's id.
 *
 * It is what the page subscribes to for queue_changed pings, and a Customer
 * cannot listen for their own Shop without it. Nothing is authorised by the id:
 * the topic is public and carries no data, and every read still goes back
 * through this function with the device cookie.
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
        -- Called Tickets are in a chair, not ahead of anyone.
        'position', (
          select count(*)
          from public.tickets t
          where t.queue_day_id = p_ticket.queue_day_id
            and t.status = 'waiting'
            and t.number < p_ticket.number
        )
      )
    end
  );
$$;

-- Supabase grants execute on every new function to the Data API roles; take it
-- back, then hand out only what backend.md §3 allows. The two helpers are called
-- only from inside the security definer functions above, so no role needs them.
revoke all on function public.lock_owner_shop() from public, anon, authenticated, service_role;
revoke all on function public.called_ticket_json(public.tickets)
  from public, anon, authenticated, service_role;
revoke all on function public.owner_ticket(public.shops, uuid, public.ticket_status)
  from public, anon, authenticated, service_role;
revoke all on function public.undo_window() from public, anon, authenticated, service_role;
revoke all on function public.broadcast_queue_changed()
  from public, anon, authenticated, service_role;
revoke all on function public.served_ticket_json(public.tickets)
  from public, anon, authenticated, service_role;
revoke all on function public.call_next() from public, anon, authenticated;
revoke all on function public.mark_served(uuid) from public, anon, authenticated;
revoke all on function public.undo_served(uuid) from public, anon, authenticated;

grant execute on function public.call_next() to authenticated;
grant execute on function public.mark_served(uuid) to authenticated;
grant execute on function public.undo_served(uuid) to authenticated;
