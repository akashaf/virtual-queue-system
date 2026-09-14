-- Review follow-up to #7: one place that adds a Ticket, one that locks a
-- Customer's Shop, and two payloads that stop inventing what they can be told.
--
-- join_queue and rejoin_queue had grown the same five steps between them —
-- count the Queue, refuse a full one, take the next number, stamp the Heads-up,
-- insert — so a change to any of them had to be made twice and remembered twice.

/*
 * The Shop a Ticket belongs to, locked, or a null row.
 *
 * Every mutation takes the Shop lock first (backend.md §2), including the two a
 * Customer makes. It answers with a null row rather than raising, because the
 * Customer's functions each have their own word for a Ticket they cannot act on.
 */
create function public.lock_ticket_shop(p_ticket_id uuid)
returns public.shops
language plpgsql
set search_path = ''
as $$
declare
  v_shop public.shops;
begin
  select s.* into v_shop
  from public.shops s
  join public.tickets t on t.shop_id = s.id
  where t.id = p_ticket_id
  for update of s;

  return v_shop;
end;
$$;

/*
 * Puts a Customer in the Queue: the part Join and Rejoin do identically.
 *
 * Both ways in check the Queue's size, take the next number, and stamp
 * heads_up_sent_at on a Ticket that arrives already inside the threshold. What
 * differs is how the Customer earned the place — a location check for a scan,
 * a No-show to come back from for a Rejoin — and that stays with the caller.
 *
 * The Shop must already be locked by the caller: the size check below is only
 * safe against a simultaneous join because of it.
 *
 * Errors: queue_full.
 */
create function public.add_ticket(
  p_shop public.shops,
  p_name text,
  p_device_id uuid,
  p_origin public.ticket_origin,
  p_parent_ticket_id uuid default null
)
returns public.tickets
language plpgsql
set search_path = ''
as $$
declare
  v_active int;
  v_ahead int;
  v_number int;
  v_ticket public.tickets;
begin
  -- The queue size counts chairs as well as the Queue; the new Ticket's position
  -- counts only the Queue, and everyone in it is ahead because the new Ticket
  -- takes the highest number. One scan answers both.
  select
    count(*) filter (where t.status in ('waiting', 'called')),
    count(*) filter (where t.status = 'waiting')
  into v_active, v_ahead
  from public.tickets t
  where t.queue_day_id = p_shop.current_queue_day_id;

  if v_active >= p_shop.max_queue_size then
    raise exception 'queue_full';
  end if;

  update public.queue_days
  set next_number = next_number + 1
  where id = p_shop.current_queue_day_id
  returning next_number - 1 into v_number;

  insert into public.tickets (
    shop_id, queue_day_id, number, customer_name, device_id, origin,
    parent_ticket_id, heads_up_sent_at
  )
  values (
    p_shop.id, p_shop.current_queue_day_id, v_number,
    -- coalesce, not btrim alone: the column allows a null name because erasure
    -- leaves one behind, so a null here has to become the empty string for
    -- tickets_customer_name_length to refuse it the way it refuses a blank.
    coalesce(btrim(p_name), ''), p_device_id, p_origin, p_parent_ticket_id,
    -- Arriving already inside the Heads-up Threshold counts as having been told:
    -- the Customer is looking at the page that says how many are ahead. Marking
    -- it here is what stops the next mutation sending them a pointless alert.
    case when v_ahead <= p_shop.heads_up_threshold then now() end
  )
  returning * into v_ticket;

  return v_ticket;
end;
$$;

/*
 * Creates a Ticket for a Customer standing at the Shop. Unchanged but for the
 * last third, which add_ticket now does.
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
    'alerts', '[]'::jsonb
  );
end;
$$;

/*
 * A second chance for a Customer who was called and missed it.
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
    'alerts', '[]'::jsonb
  );
end;
$$;

/*
 * The Customer gives up their place, from the Queue or from the chair.
 *
 * Scoped to the current Queue Day, as the Owner's endings are: a Ticket from a
 * day that has closed is not one anybody is still acting on, and #11 will start
 * moving Tickets between days.
 *
 * Errors: ticket_not_found, which is also what a Ticket belonging to another
 * device gets — the device id is part of the lookup rather than a check after
 * it, and a null device matches nothing.
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
    'alerts', '[]'::jsonb
  );
end;
$$;

-- Its one caller now spells the lookup out, with the extra conditions a Rejoin
-- needs and a word of its own for failing them.
drop function public.device_ticket(public.shops, uuid, uuid, public.ticket_status[]);

/*
 * The Customer's view, with a position that means what its comment says.
 *
 * Only a Waiting Ticket has a place in the Queue. A Called Ticket is in a chair
 * and one that has ended is out of the Queue altogether, so counting the people
 * with lower numbers told them a number about somebody else's wait.
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

/*
 * One Served Ticket, now carrying the call it came from.
 *
 * Undo puts the Customer back in the chair they were already in, so the screen
 * that takes the Undo has to be able to say how long they have been there and
 * when No-show unlocks. Without these it invented both, and invented them wrong:
 * undo_served deliberately leaves called_at alone.
 */
create or replace function public.served_ticket_json(p_ticket public.tickets)
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
    ))::int,
    'undo_expires_in_ms', greatest(0, round(
      extract(epoch from (p_ticket.served_at + public.undo_window() - now())) * 1000
    ))::int
  );
$$;

-- Supabase grants execute on every new function to the Data API roles; take it
-- back. Both helpers are called only from inside the security definer functions
-- above, so no role outside the database needs them.
revoke all on function public.lock_ticket_shop(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.add_ticket(
  public.shops, text, uuid, public.ticket_origin, uuid
) from public, anon, authenticated, service_role;
