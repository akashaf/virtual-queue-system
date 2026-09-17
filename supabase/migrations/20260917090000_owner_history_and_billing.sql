-- Owner history and the billing summary (#13).
--
-- A Served Ticket is the only billable event, at RM0.25, and belongs to the
-- calendar month in Malaysia time in which it was marked Served (CONTEXT.md's
-- Billing Month). The Owner sees what they owe so far; the Operator pulls a
-- month's totals per Shop to invoice by hand.

/* What one Served Ticket costs the Owner, in sen. The one place the price lives. */
create function public.served_ticket_price_sen()
returns int
language sql
immutable
set search_path = ''
as $$
  select 25;
$$;

/*
 * The instants a Malaysian calendar day spans: midnight to midnight in
 * Asia/Kuala_Lumpur. Stable rather than immutable, because Postgres treats a
 * time zone conversion as depending on the zone database.
 */
create function public.malaysia_day(p_day date)
returns tstzrange
language sql
stable
set search_path = ''
as $$
  select tstzrange(
    p_day::timestamp at time zone 'Asia/Kuala_Lumpur',
    (p_day + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
  );
$$;

/*
 * The Billing Month holding a Malaysian calendar date, as the instants it spans:
 * from midnight on the 1st in Asia/Kuala_Lumpur up to, not including, midnight
 * on the next 1st. The one definition of a Billing Month's bounds, which the
 * Owner's month so far, the Operator's served_this_month and the invoice all
 * read, so none of them can count a different month.
 */
create function public.billing_month(p_day date)
returns tstzrange
language sql
stable
set search_path = ''
as $$
  select tstzrange(
    date_trunc('month', p_day)::timestamp at time zone 'Asia/Kuala_Lumpur',
    (date_trunc('month', p_day) + interval '1 month')::timestamp
      at time zone 'Asia/Kuala_Lumpur'
  );
$$;

/*
 * A Shop's Served Tickets within a span of time. Only status = 'served' counts:
 * a Done that was undone is back in the chair and has cost nobody anything.
 * Compared with the span's bounds rather than contained in it, so the
 * (shop_id, served_at) index can serve the count.
 */
create function public.served_count(p_shop_id uuid, p_span tstzrange)
returns int
language sql
stable
set search_path = ''
as $$
  select count(*)::int
  from public.tickets t
  where t.shop_id = p_shop_id
    and t.status = 'served'
    and t.served_at >= lower(p_span)
    and t.served_at < upper(p_span);
$$;

/* The current Billing Month, as Malaysia's calendar has it right now. */
create function public.current_billing_month()
returns tstzrange
language sql
stable
set search_path = ''
as $$
  select public.billing_month((now() at time zone 'Asia/Kuala_Lumpur')::date);
$$;

/*
 * Every Shop's Served Tickets in one Billing Month, and what they come to.
 *
 * Every Shop is listed, Deactivated ones included — a Shop switched off in the
 * middle of a month still owes for the start of it — oldest first, as
 * operator_shops lists them. A Shop that Served nobody says 0 rather than going
 * missing, so the Operator can tell "nothing to invoice" from "not counted".
 *
 * `p_month` is `YYYY-MM`; anything else is refused rather than guessed at. The
 * admin API checks the same thing first, so this is only ever a bug reaching it.
 */
create function public.billing_summary(p_month text)
returns table (
  slug text,
  name text,
  served_count int,
  amount_sen int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month tstzrange;
begin
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception using
      errcode = '22023',
      message = format('month must be YYYY-MM, not %L', p_month);
  end if;

  v_month := public.billing_month(to_date(p_month, 'YYYY-MM'));

  return query
  select
    s.slug,
    s.name,
    served.n,
    served.n * public.served_ticket_price_sen()
  from public.shops s
  cross join lateral (select public.served_count(s.id, v_month) as n) served
  order by s.created_at, s.slug;
end;
$$;

-- The helpers are only ever called from inside the security definer functions
-- in this file, so no Data API role needs them — service_role included, which
-- default privileges would otherwise leave behind.
revoke all on function public.served_ticket_price_sen()
  from public, anon, authenticated, service_role;
revoke all on function public.malaysia_day(date)
  from public, anon, authenticated, service_role;
revoke all on function public.billing_month(date)
  from public, anon, authenticated, service_role;
revoke all on function public.current_billing_month()
  from public, anon, authenticated, service_role;
revoke all on function public.served_count(uuid, tstzrange)
  from public, anon, authenticated, service_role;

revoke all on function public.billing_summary(text) from public, anon, authenticated;
grant execute on function public.billing_summary(text) to service_role;

/*
 * What the Owner's history page shows (frontend.md §4.3):
 *
 * - `today`: every Ticket in the current Queue Day, whatever became of it, in
 *   number order. A Queue Day, not a calendar date, because that is what the
 *   Ticket numbers restart with — and a Carried-over Ticket is today's.
 * - `served_by_day`: Served Tickets per Malaysian calendar date over the last
 *   `p_days` days including today, newest first. A day with none says 0, so
 *   a quiet day reads as quiet rather than as a gap in the list.
 * - `this_month`: the Billing Month so far, counted and priced exactly as
 *   billing_summary will invoice it.
 *
 * Every count goes through served_count, as billing_summary's does.
 *
 * Finds the Shop from auth.uid() like get_owner_queue, so a request cannot
 * name another Shop, and raises `shop_inactive` the same way.
 */
create function public.get_owner_history(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_month_served int;
begin
  if p_days is null or p_days not between 1 and 366 then
    raise exception using
      errcode = '22023',
      message = format('days must be between 1 and 366, not %s', p_days);
  end if;

  select * into v_shop
  from public.shops
  where owner_user_id = (select auth.uid())
    and is_active;

  if not found then
    raise exception 'shop_inactive';
  end if;

  v_month_served := public.served_count(v_shop.id, public.current_billing_month());

  return jsonb_build_object(
    'today', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'number', t.number,
          'name', t.customer_name,
          'status', t.status,
          'joined_at', t.joined_at,
          'called_at', t.called_at,
          'served_at', t.served_at
        )
        order by t.number
      )
      from public.tickets t
      where t.queue_day_id = v_shop.current_queue_day_id
    ), '[]'::jsonb),
    'served_by_day', (
      select jsonb_agg(
        jsonb_build_object(
          'day', d.day,
          'served_count', public.served_count(v_shop.id, public.malaysia_day(d.day))
        )
        order by d.day desc
      )
      -- Counting back in whole dates keeps every step in Malaysian calendar
      -- days; only the bounds of each day become instants.
      from generate_series(0, p_days - 1) as back(days)
      cross join lateral (select v_today - back.days as day) d
    ),
    'this_month', jsonb_build_object(
      'served_count', v_month_served,
      'amount_sen', v_month_served * public.served_ticket_price_sen()
    )
  );
end;
$$;

revoke all on function public.get_owner_history(int) from public, anon, authenticated;
grant execute on function public.get_owner_history(int) to authenticated;

/*
 * operator_shops (#14) now counts served_this_month through the same helpers,
 * so the number the Operator glances at and the invoice billing_summary draws
 * up read one definition of the Billing Month. Same signature, so its grants
 * carry over.
 */
create or replace function public.operator_shops(p_slug text default null)
returns table (
  id uuid,
  slug text,
  name text,
  owner_email text,
  lat double precision,
  lng double precision,
  join_radius_m int,
  heads_up_threshold int,
  max_queue_size int,
  is_active boolean,
  joining_state public.joining_state,
  current_queue_day_id uuid,
  created_at timestamptz,
  served_this_month int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.slug,
    s.name,
    u.email::text,
    s.lat,
    s.lng,
    s.join_radius_m,
    s.heads_up_threshold,
    s.max_queue_size,
    s.is_active,
    s.joining_state,
    s.current_queue_day_id,
    s.created_at,
    public.served_count(s.id, public.current_billing_month())
  from public.shops s
  join auth.users u on u.id = s.owner_user_id
  where p_slug is null or s.slug = p_slug
  order by s.created_at, s.slug;
$$;
