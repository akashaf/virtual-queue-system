-- Tickets, joining the Queue, and the two views onto it (#5).
--
-- Access rules are unchanged from docs/specs/backend.md §3: the anon role gets
-- nothing, an Owner may only SELECT their own Shop's rows, and every write goes
-- through a security definer function that takes the Shop lock first.

create type public.ticket_status as enum (
  'waiting', 'called', 'served', 'no_show', 'left', 'removed'
);
create type public.ticket_origin as enum ('scan', 'rejoin');
create type public.removed_reason as enum ('owner', 'close_shop', 'carry_over_expired');
create type public.last_call_choice as enum ('stay', 'carry');

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  -- Denormalised from queue_days so billing queries never join, and so the
  -- one-active-Ticket-per-device index can be scoped to the Shop.
  shop_id uuid not null references public.shops (id) on delete cascade,
  queue_day_id uuid not null references public.queue_days (id) on delete cascade,
  number int not null
    constraint tickets_number_positive check (number >= 1),
  -- Null once erase_expired_personal_data has run, 30 days after finished_at.
  customer_name text
    constraint tickets_customer_name_length
      check (customer_name is null or length(customer_name) between 1 and 30),
  -- From the vq_device cookie. Erased together with the name.
  device_id uuid,
  status public.ticket_status not null default 'waiting',
  origin public.ticket_origin not null,
  parent_ticket_id uuid references public.tickets (id) on delete set null,
  removed_reason public.removed_reason,
  last_call_choice public.last_call_choice,
  -- Non-null = a Carried-over Ticket, which may only carry over once.
  carried_over_at timestamptz,
  heads_up_sent_at timestamptz,
  joined_at timestamptz not null default now(),
  called_at timestamptz,
  served_at timestamptz,
  -- When the status became final.
  finished_at timestamptz
);

-- Ticket numbers restart at each new Queue Day.
create unique index tickets_queue_day_number on public.tickets (queue_day_id, number);

-- One active Ticket per device per Shop. Scoped to the Shop, not the Queue Day,
-- so a Ticket left open across a Close Shop still blocks a second one.
create unique index tickets_one_active_per_device
  on public.tickets (shop_id, device_id)
  where status in ('waiting', 'called');

-- Serves both numbers the Customer sees: their position and the waiting count.
create index tickets_waiting_by_number
  on public.tickets (queue_day_id, number)
  where status = 'waiting';

-- Billing counts a Shop's Served Tickets for a Billing Month.
create index tickets_served_by_shop
  on public.tickets (shop_id, served_at)
  where status = 'served';

-- Distance in metres between two WGS84 points, on a spherical earth. Accurate to
-- ~0.5%, which is far inside the accuracy of a phone's GPS fix.
create function public.haversine_m(
  p_lat_a double precision,
  p_lng_a double precision,
  p_lat_b double precision,
  p_lng_b double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  -- least(1, …) keeps a rounding error just above 1 out of asin's domain.
  select 2 * 6371000 * asin(sqrt(least(1,
    sin(radians(p_lat_b - p_lat_a) / 2) ^ 2
    + cos(radians(p_lat_a)) * cos(radians(p_lat_b))
      * sin(radians(p_lng_b - p_lng_a) / 2) ^ 2
  )));
$$;

/*
 * What a Customer is allowed to see: their Shop, and their own Ticket. Never
 * another Customer's name, and never the rest of the Queue.
 *
 * Shared by get_customer_view and join_queue so that a join and the refetch that
 * follows it cannot disagree. `p_ticket` may be a null record, which is how "this
 * device has no active Ticket" is spelled.
 */
create function public.customer_view_json(
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

/*
 * The Customer page's whole view, by Shop slug and device.
 *
 * Returns null for a slug that has no Shop, so the page can show the same
 * "not accepting customers" message it shows for a Deactivated Shop.
 */
create function public.get_customer_view(
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

  -- tickets_one_active_per_device makes this at most one row.
  if p_device_id is not null then
    select * into v_ticket
    from public.tickets t
    where t.shop_id = v_shop.id
      and t.device_id = p_device_id
      and t.status in ('waiting', 'called');
  end if;

  return public.customer_view_json(v_shop, v_ticket);
end;
$$;

/*
 * Creates a Ticket for a Customer standing at the Shop.
 *
 * Raises P0001 with the message set to one of shop_inactive, last_call,
 * already_in_queue, too_far or queue_full — the tokens the Customer page
 * switches on. An unknown slug raises shop_inactive too: a Customer must not be
 * able to tell a Shop that never existed from one that was switched off.
 */
create function public.join_queue(
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
  v_active int;
  v_ahead int;
  v_number int;
begin
  -- The Shop lock first, so every mutation for one Shop runs one at a time. It is
  -- what makes the queue-size check below safe against two simultaneous joins.
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

  -- The queue size counts chairs as well as the Queue; the new Ticket's position
  -- counts only the Queue, and everyone in it is ahead because the new Ticket
  -- takes the highest number. One scan answers both.
  select
    count(*) filter (where t.status in ('waiting', 'called')),
    count(*) filter (where t.status = 'waiting')
  into v_active, v_ahead
  from public.tickets t
  where t.queue_day_id = v_shop.current_queue_day_id;

  -- Checked after the Join Radius: "come back soon" is the wrong thing to tell
  -- someone who is not at the Shop at all.
  if v_active >= v_shop.max_queue_size then
    raise exception 'queue_full';
  end if;

  update public.queue_days
  set next_number = next_number + 1
  where id = v_shop.current_queue_day_id
  returning next_number - 1 into v_number;

  insert into public.tickets (
    shop_id, queue_day_id, number, customer_name, device_id, origin, heads_up_sent_at
  )
  values (
    v_shop.id, v_shop.current_queue_day_id, v_number,
    -- coalesce, not btrim alone: the column allows a null name because erasure
    -- leaves one behind, so a null here has to become the empty string for
    -- tickets_customer_name_length to refuse it the way it refuses a blank.
    coalesce(btrim(p_name), ''), p_device_id, 'scan',
    -- Joining already inside the Heads-up Threshold counts as having been told:
    -- the Customer is looking at the page that says how many are ahead. Marking
    -- it here is what stops the next mutation sending them a pointless alert.
    case when v_ahead <= v_shop.heads_up_threshold then now() end
  )
  returning * into v_ticket;

  -- Alerts are dispatched by Next.js; joining raises none of its own, for the
  -- same reason.
  return jsonb_build_object(
    'result', public.customer_view_json(v_shop, v_ticket),
    'alerts', '[]'::jsonb
  );
end;
$$;

/*
 * The Owner's live Queue: the current Queue Day's Waiting and Called Tickets,
 * with names. Unlike the Customer functions this one is called with the Owner's
 * own JWT, and finds the Shop from auth.uid() rather than trusting an argument.
 *
 * The Served-within-the-undo-window list arrives with #6, which is what creates
 * a Served Ticket in the first place.
 */
create function public.get_owner_queue()
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
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'number', t.number,
          'name', t.customer_name,
          'called_at', t.called_at
        )
        order by t.called_at
      )
      from public.tickets t
      where t.queue_day_id = v_shop.current_queue_day_id
        and t.status = 'called'
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.tickets enable row level security;

-- Supabase auto-grants new public tables to the Data API roles; take it back and
-- hand out only what §3 allows.
revoke all on public.tickets from anon, authenticated;
-- The two helpers are called only from inside the security definer functions
-- above, which run as their owner, so no Data API role needs them at all.
revoke all on function public.haversine_m(
  double precision, double precision, double precision, double precision
) from public, anon, authenticated, service_role;
revoke all on function public.customer_view_json(public.shops, public.tickets)
  from public, anon, authenticated, service_role;
revoke all on function public.get_customer_view(text, uuid)
  from public, anon, authenticated;
revoke all on function public.join_queue(
  text, uuid, text, double precision, double precision, double precision
) from public, anon, authenticated;
revoke all on function public.get_owner_queue() from public, anon, authenticated;

grant select on public.tickets to authenticated;
grant execute on function public.get_customer_view(text, uuid) to service_role;
grant execute on function public.join_queue(
  text, uuid, text, double precision, double precision, double precision
) to service_role;
grant execute on function public.get_owner_queue() to authenticated;

create policy tickets_owner_select on public.tickets
  for select to authenticated
  using (
    exists (
      select 1 from public.shops s
      where s.id = tickets.shop_id
        and s.owner_user_id = (select auth.uid())
    )
  );
