-- Web Push through OneSignal (#29, ADR 0005).
--
-- OneSignal now holds every push subscription, keyed by the Ticket id the page
-- logs in with, so push_subscriptions and everything that kept it tidy go: the
-- save function, the deletion helper, and the deletes in the Ticket endings and
-- the daily jobs. Those functions are re-declared below with the delete taken
-- out; nothing else in them changes. An ended Ticket is simply never alerted
-- again, which is all the deletes were for.
--
-- In its place, push_sends: one row per alert lib/push.ts tried to send, so
-- "was #017 ever told?" has an answer that does not need the OneSignal
-- dashboard — which, for an iPhone, cannot say whether a push arrived anyway.

create table public.push_sends (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  kind text not null
    check (kind in ('heads_up', 'called', 'last_call', 'shop_closed')),
  -- sent: OneSignal accepted it for at least one subscription.
  -- no_subscriber: the Ticket never allowed alerts, or had not yet.
  -- error: OneSignal refused or could not be reached; reported to Sentry too.
  outcome text not null check (outcome in ('sent', 'no_subscriber', 'error')),
  -- OneSignal's id for the notification, to find it in their dashboard.
  notification_id text,
  created_at timestamptz not null default now()
);

-- What debugging asks: everything sent about one Ticket.
create index push_sends_by_ticket on public.push_sends (ticket_id);
-- What erasure asks: every row past its 30 days.
create index push_sends_by_created_at on public.push_sends (created_at);

alter table public.push_sends enable row level security;

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
 * As in 20260917120000_daily_cleanup.sql, without the subscription delete.
 */
create or replace function public.expire_carried_over()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_expired int;
  v_total int := 0;
  v_alerts jsonb := '[]'::jsonb;
begin
  for v_shop in
    select s.*
    from public.shops s
    where exists (
      select 1 from public.tickets t
      where t.shop_id = s.id
        and t.status = 'waiting'
        and t.carried_over_at < now() - public.carry_over_lifetime()
    )
    order by s.id
    for update of s
  loop
    update public.tickets t
    set status = 'removed', removed_reason = 'carry_over_expired', finished_at = now()
    where t.shop_id = v_shop.id
      and t.status = 'waiting'
      and t.carried_over_at < now() - public.carry_over_lifetime();
    get diagnostics v_expired = row_count;

    v_total := v_total + v_expired;

    if v_expired > 0 and v_shop.is_active then
      v_alerts := v_alerts || public.stamp_heads_ups(v_shop);
    end if;
  end loop;

  return jsonb_build_object(
    'result', jsonb_build_object('expired', v_total),
    'alerts', v_alerts
  );
end;
$$;

/*
 * PDPA: 30 days after a Ticket finishes, the Customer's name and device go.
 * The send log goes after 30 days too, counted from the send: it names no one,
 * but it is a record of one person's visit, and nobody debugs a month-old push.
 *
 * It also returns the ids of the Tickets it erased, so lib/cron/daily.ts can
 * delete their users in OneSignal, which holds the phone's subscription under
 * the Ticket id. Only this run's: a Ticket erased once is never returned again,
 * so a OneSignal delete that fails is reported rather than retried.
 *
 * Its report says deleted_push_sends where it said deleted_subscriptions.
 */
create or replace function public.erase_expired_personal_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_erased uuid[];
  v_deleted int;
begin
  with erased as (
    update public.tickets t
    set customer_name = null, device_id = null
    where t.finished_at < now() - public.personal_data_retention()
      and (t.customer_name is not null or t.device_id is not null)
    returning t.id
  )
  select coalesce(array_agg(id), '{}') into v_erased from erased;

  delete from public.push_sends s
  where s.created_at < now() - public.personal_data_retention();
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'erased_tickets', cardinality(v_erased),
    'erased_ticket_ids', to_jsonb(v_erased),
    'deleted_push_sends', v_deleted
  );
end;
$$;

drop function public.save_push_subscription(uuid, uuid, text, text, text, text);
drop function public.delete_push_subscriptions(uuid);
drop table public.push_subscriptions;

-- Supabase auto-grants new public tables to the Data API roles; take it back.
-- Only lib/push.ts writes here, through the secret-key client.
revoke all on public.push_sends from anon, authenticated;
