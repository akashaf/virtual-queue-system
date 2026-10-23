-- No Heads-up until the Queue Day has started (#41).
--
-- Close Shop opens the next Queue Day straight away, with its Carried-over
-- Tickets at the front and Joining open, so a Ticket can sit inside the
-- Heads-up Threshold all night. Until now the first join or leave after closing
-- time pushed "almost your turn" to each of them, and the page told them to head
-- back to the shop. A Queue Day has started once it has had its first Call next;
-- before that nobody is told anything is near.
--
-- Started is derived, not stored: any Ticket in the day with a called_at. Only
-- call_next sets called_at, a Waiting Ticket never has one (Carried-over Tickets
-- included: only Waiting ones carry), and no Ticket row is ever deleted, so the
-- answer cannot go back to false within a day. A new day from Close Shop starts
-- out with no called_at in it.
--
-- add_ticket, stamp_heads_ups and customer_view_json are replaced with `create or replace`,
-- which keeps their grants; the bodies are the live ones apart from the guard and
-- `day_started`.

create function public.queue_day_started(p_queue_day_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
    where t.queue_day_id = p_queue_day_id
      and t.called_at is not null
  );
$$;

-- Every caller at once: join, leave, rejoin, the expiry job and the Owner's
-- presses. call_next stamps after setting called_at, so the day's first Call
-- next sends every Heads-up the night held back.
create or replace function public.stamp_heads_ups(p_shop public.shops)
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
      -- A scalar subquery, so Postgres asks once rather than once per row.
      and (select public.queue_day_started(p_shop.current_queue_day_id))
    returning t.id, t.number
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('ticket_id', s.id, 'kind', 'heads_up') order by s.number),
    '[]'::jsonb
  )
  from stamped s;
$$;

-- A Ticket arriving inside the threshold counts as told only once the day has
-- started: someone who joins at 10pm is not looking at the page when the first
-- Call next comes, so that press tells them like everyone else.
create or replace function public.add_ticket(
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
    case
      when v_ahead <= p_shop.heads_up_threshold
        and public.queue_day_started(p_shop.current_queue_day_id)
      then now()
    end
  )
  returning * into v_ticket;

  return v_ticket;
end;
$$;

-- For a Waiting Ticket the page shows its Heads-up banner and holds the wake lock
-- only once this is true, and takes it from here rather than guessing from
-- position or the clock.
create or replace function public.customer_view_json(p_shop public.shops, p_ticket public.tickets)
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
      'heads_up_threshold', p_shop.heads_up_threshold,
      'day_started', public.queue_day_started(p_shop.current_queue_day_id)
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
        'last_call_choice', p_ticket.last_call_choice,
        'carried_over', p_ticket.carried_over_at is not null,
        'removed_reason', p_ticket.removed_reason,
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
    end,
    'estimate', public.estimated_wait(p_shop, p_ticket)
  );
$$;

-- Only this file's functions call it; default privileges would otherwise hand
-- execute to every Data API role, service_role included.
revoke all on function public.queue_day_started(uuid)
  from public, anon, authenticated, service_role;
