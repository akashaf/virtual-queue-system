-- Estimated Wait (#12).
--
-- A Waiting Customer sees a rough wait range once the Shop has served enough
-- Tickets today. The estimate reads the pace of recent serves — the median
-- interval between consecutive `served_at` values — so several chairs working
-- at once show up as a faster queue, without the system ever modelling chairs.

/*
 * The Estimated Wait for one Waiting Ticket, or null.
 *
 * Null until 5 Tickets are Served in the current Queue Day: before that the
 * median is guesswork, and the page (frontend.md §3.1) hides the range rather
 * than show a wild one. The gap is the median interval between consecutive `served_at`
 * values over the last 10 Served, and the range is −30%/+30% around
 * (position + 1) × gap, each end rounded to the nearest 5 minutes.
 *
 * Only a Waiting Ticket gets one: a Called Ticket is in a chair and a finished
 * one is out of the Queue, so the wait this estimates is over for both.
 */
create function public.estimated_wait(
  p_shop public.shops,
  p_ticket public.tickets
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with served as (
    select t.served_at
    from public.tickets t
    where t.queue_day_id = p_shop.current_queue_day_id
      and t.status = 'served'
    order by t.served_at desc
    limit 10
  ),
  gap as (
    select percentile_cont(0.5) within group (order by s.seconds)::numeric
      as median_seconds
    from (
      select extract(epoch from
        served_at - lag(served_at) over (order by served_at)
      ) as seconds
      from served
    ) s
    where s.seconds is not null
  )
  select case
    when p_ticket.id is null or p_ticket.status <> 'waiting' then null
    when (select count(*) from served) < 5 then null
    else (
      select jsonb_build_object(
        'min_minutes', round(estimate.minutes * 0.7 / 5) * 5,
        'max_minutes', round(estimate.minutes * 1.3 / 5) * 5
      )
      from gap,
      lateral (
        -- The Ticket's position, counted as customer_view_json counts it. A
        -- Waiting Ticket is always in the Shop's current Queue Day, so the one
        -- day id serves both this count and the serves above.
        select (
          1 + (
            select count(*)
            from public.tickets t
            where t.queue_day_id = p_shop.current_queue_day_id
              and t.status = 'waiting'
              and t.number < p_ticket.number
          )
        ) * gap.median_seconds / 60 as minutes
      ) estimate
    )
  end
$$;

-- The Customer's view, now carrying the Estimated Wait. Top-level rather than
-- inside `ticket`, per the backend.md §5 shape — it is a fact about the Queue's
-- pace as much as about the Ticket, and says nothing about anyone else.
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

-- Called only from inside customer_view_json, whose callers are the security
-- definer functions, so no Data API role needs it — service_role included,
-- which default privileges would otherwise leave behind.
revoke all on function public.estimated_wait(public.shops, public.tickets)
  from public, anon, authenticated, service_role;
