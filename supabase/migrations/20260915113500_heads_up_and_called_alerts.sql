-- Heads-up and Called alerts (#8).
--
-- backend.md §4: after any mutation, every Waiting Ticket inside the Heads-up
-- Threshold that has not been told yet is stamped and returned as a `heads_up`
-- alert. `call_next` also returns a `called` alert for the Ticket it summoned.
-- Every mutation is re-declared below only to change what it returns as
-- `alerts`; nothing else in them changes. The customer view also gains the
-- Shop's `heads_up_threshold`, which the page shows "Head back" against.

/*
 * Stamps the Heads-ups the Shop's Queue now owes, and returns them as alerts.
 *
 * Called at the end of every mutation, including the ones that move nobody up:
 * the rule is "after any mutation", so a Ticket owed a Heads-up for any other
 * reason — a threshold raised under it — is told by the very next press rather
 * than waiting for the right kind of one.
 *
 * Position is counted among Waiting Tickets only, as everywhere else: a Called
 * Ticket is in a chair and ahead of nobody. A joining Ticket is never among the
 * results, because add_ticket has already stamped it silently.
 */
create function public.stamp_heads_ups(p_shop public.shops)
returns jsonb
language sql
set search_path = ''
as $$
  with queue as (
    select
      t.id,
      t.number,
      t.heads_up_sent_at,
      row_number() over (order by t.number) - 1 as position
    from public.tickets t
    where t.queue_day_id = p_shop.current_queue_day_id
      and t.status = 'waiting'
  ),
  stamped as (
    update public.tickets t
    set heads_up_sent_at = now()
    from queue q
    where t.id = q.id
      and q.heads_up_sent_at is null
      and q.position <= p_shop.heads_up_threshold
    returning t.id, t.number
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('ticket_id', s.id, 'kind', 'heads_up') order by s.number),
    '[]'::jsonb
  )
  from stamped s;
$$;

/*
 * Summons the Customer at the front of the Queue, and says so: the `called`
 * alert for them, then any Heads-up the Tickets behind are now owed.
 *
 * Errors: queue_empty.
 */
create or replace function public.call_next()
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

  return jsonb_build_object(
    'result', public.called_ticket_json(v_ticket),
    'alerts', jsonb_build_array(
      jsonb_build_object('ticket_id', v_ticket.id, 'kind', 'called')
    ) || public.stamp_heads_ups(v_shop)
  );
end;
$$;

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
    'alerts', public.stamp_heads_ups(v_shop)
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
  -- Owner's "called N min ago" would otherwise restart from zero. Nor is a
  -- second `called` alert sent: they were told once, and are in the chair.
  update public.tickets
  set status = 'called', served_at = null, finished_at = null
  where id = v_ticket.id
  returning * into v_ticket;

  return jsonb_build_object(
    'result', public.called_ticket_json(v_ticket),
    'alerts', public.stamp_heads_ups(v_shop)
  );
end;
$$;

create or replace function public.mark_no_show(p_ticket_id uuid)
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
    'alerts', public.stamp_heads_ups(v_shop)
  );
end;
$$;

create or replace function public.remove_ticket(p_ticket_id uuid)
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
    'alerts', public.stamp_heads_ups(v_shop)
  );
end;
$$;

/*
 * Creates a Ticket for a Customer standing at the Shop.
 *
 * The new Ticket is never among the alerts: add_ticket stamps one that arrives
 * inside the threshold silently, because the Customer is looking at the page.
 * A join moves nobody else up either, so these alerts are only ever Heads-ups
 * some earlier change left owed.
 *
 * Errors: shop_inactive, last_call, already_in_queue, too_far, queue_full — in
 * that order. The Join Radius comes before the queue size deliberately: "check
 * back soon" is the wrong thing to tell someone who is not at the Shop at all.
 */
create or replace function public.join_queue(
  p_slug text,
  p_device_id uuid,
  p_name text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_ticket public.tickets;
  v_tolerance_m double precision;
  v_distance_m double precision;
begin
  select * into v_shop from public.shops where slug = p_slug for update;

  if not found or not v_shop.is_active then
    raise exception 'shop_inactive';
  end if;

  if v_shop.joining_state <> 'open' then
    raise exception 'last_call';
  end if;

  if exists (
    select 1 from public.tickets t
    where t.shop_id = v_shop.id
      and t.device_id = p_device_id
      and t.status in ('waiting', 'called')
  ) then
    raise exception 'already_in_queue';
  end if;

  -- ADR 0002: indoor GPS is often 20-100 m out, so the reading's own accuracy is
  -- allowed on top of the radius — capped, or a deliberately vague fix would let
  -- someone join from anywhere.
  v_tolerance_m := least(greatest(coalesce(p_accuracy_m, 0), 0), 100);
  v_distance_m := public.haversine_m(v_shop.lat, v_shop.lng, p_lat, p_lng);

  if v_distance_m > v_shop.join_radius_m + v_tolerance_m then
    raise exception 'too_far';
  end if;

  v_ticket := public.add_ticket(v_shop, p_name, p_device_id, 'scan');

  return jsonb_build_object(
    'result', public.customer_view_json(v_shop, v_ticket),
    'alerts', public.stamp_heads_ups(v_shop)
  );
end;
$$;

/*
 * A second chance for a Customer who was called and missed it. Its alerts are
 * join_queue's: never the new Ticket, which add_ticket stamps silently.
 *
 * Errors: shop_inactive, last_call, not_rejoinable, already_in_queue, queue_full.
 */
create or replace function public.rejoin_queue(p_ticket_id uuid, p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_source public.tickets;
  v_ticket public.tickets;
begin
  v_shop := public.lock_ticket_shop(p_ticket_id);

  if v_shop.id is null or not v_shop.is_active then
    raise exception 'shop_inactive';
  end if;

  if v_shop.joining_state <> 'open' then
    raise exception 'last_call';
  end if;

  -- One Rejoin per scan: the source has to be a No-show that came from a scan,
  -- is still in today's Queue Day, belongs to this device, and has not already
  -- been rejoined from. A null device matches nothing, erasure included.
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

  if not found then
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

  -- The name the Customer already gave; they are not asked for it again.
  v_ticket := public.add_ticket(
    v_shop, v_source.customer_name, p_device_id, 'rejoin', v_source.id
  );

  return jsonb_build_object(
    'result', public.customer_view_json(v_shop, v_ticket),
    'alerts', public.stamp_heads_ups(v_shop)
  );
end;
$$;

/*
 * The Customer gives up their place, from the Queue or from the chair. Leaving
 * from the Queue moves everyone behind up, so this is where a Heads-up is often
 * owed.
 *
 * Errors: ticket_not_found.
 */
create or replace function public.leave_queue(p_ticket_id uuid, p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_ticket public.tickets;
begin
  v_shop := public.lock_ticket_shop(p_ticket_id);

  if v_shop.id is null then
    raise exception 'ticket_not_found';
  end if;

  select * into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
    and t.queue_day_id = v_shop.current_queue_day_id
    and t.device_id = p_device_id
    and t.status in ('waiting', 'called');

  if not found then
    raise exception 'ticket_not_found';
  end if;

  update public.tickets
  set status = 'left', finished_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  return jsonb_build_object(
    'result', public.customer_view_json(v_shop, v_ticket),
    'alerts', public.stamp_heads_ups(v_shop)
  );
end;
$$;

/*
 * The Customer's view, now carrying the Shop's Heads-up Threshold.
 *
 * The page shows "Head back to the shop now" once the Ticket is inside it, and
 * decides when to chime by watching the Ticket cross it (frontend.md §3.3). The
 * threshold is a Shop setting rather than anything about another Customer, so
 * handing it over tells the browser nothing it should not know.
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
      ),
      'heads_up_threshold', p_shop.heads_up_threshold
    ),
    'ticket', case
      when p_ticket.id is null then null
      else jsonb_build_object(
        'id', p_ticket.id,
        'number', p_ticket.number,
        'status', p_ticket.status,
        'position', case
          when p_ticket.status <> 'waiting' then 0
          else (
            select count(*)
            from public.tickets t
            where t.queue_day_id = p_ticket.queue_day_id
              and t.status = 'waiting'
              and t.number < p_ticket.number
          )
        end,
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

-- Supabase grants execute on every new function to the Data API roles, service
-- role included; take it back. The helper is only ever called from inside the
-- security definer functions above.
revoke all on function public.stamp_heads_ups(public.shops)
  from public, anon, authenticated, service_role;
