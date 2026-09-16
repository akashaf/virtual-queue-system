-- Web Push subscriptions (#10).
--
-- A browser that granted notifications hands its PushSubscription to the
-- savePushSubscription action, which stores it here against the Ticket. The
-- dispatcher (lib/push.ts) reads them back by ticket_id when a mutation returns
-- alerts, and deletes any the push service reports gone (404/410).
--
-- backend.md §3: a Ticket's subscriptions are deleted when it reaches a final
-- status, except a No-show while a Rejoin is still possible — so the endings
-- below are re-declared with the delete added; nothing else in them changes.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  -- One row per browser: the endpoint is the push service's name for it, so a
  -- browser that subscribes again — say for the Ticket it rejoined with — moves
  -- its one subscription rather than gaining a second.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- The customer page's language when it subscribed. The payload carries it so
  -- the service worker can word the notification without asking the server.
  lang text not null default 'en',
  created_at timestamptz not null default now()
);

-- What dispatch asks: the subscriptions for the Tickets a mutation alerted.
create index push_subscriptions_by_ticket on public.push_subscriptions (ticket_id);

alter table public.push_subscriptions enable row level security;

/*
 * Upserts the browser's push subscription, after checking the device owns the
 * Ticket — the cookie is the whole of a Customer's claim, so it is part of the
 * lookup rather than a check after it, and a Ticket held by another device gets
 * the same answer as one that has ended.
 *
 * The Ticket row is locked so a save cannot race the ending that would have
 * deleted the subscription: whichever commits second sees the other's work.
 * Deliberately not the Shop lock that backend.md §5 gives every queue mutation:
 * saving a subscription moves nobody in the Queue, and the Ticket row is the
 * only thing it has to agree with.
 *
 * Errors: ticket_not_found.
 */
create function public.save_push_subscription(
  p_ticket_id uuid,
  p_device_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_lang text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets;
begin
  select * into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
    and t.device_id = p_device_id
    and t.status in ('waiting', 'called')
  for update;

  if not found then
    raise exception 'ticket_not_found';
  end if;

  insert into public.push_subscriptions (ticket_id, endpoint, p256dh, auth, lang)
  values (v_ticket.id, p_endpoint, p_p256dh, p_auth, p_lang)
  on conflict (endpoint) do update
  set ticket_id = excluded.ticket_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      lang = excluded.lang;
end;
$$;

/*
 * The §3 deletion rule's one home: a Ticket that can no longer be alerted about
 * loses its subscriptions. Callers decide *when* that is — every final status
 * except a No-show that can still Rejoin.
 */
create function public.delete_push_subscriptions(p_ticket_id uuid)
returns void
language sql
set search_path = ''
as $$
  delete from public.push_subscriptions where ticket_id = p_ticket_id;
$$;

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

  perform public.delete_push_subscriptions(v_ticket.id);

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

  -- Deleted at Done even though an Undo may follow: nothing can be restored
  -- then, and nothing is lost either — every push kind alerts Waiting Tickets
  -- except `called`, which an Undo deliberately never sends again. An open
  -- page re-saves its subscription by itself; a closed one had its alert.
  perform public.delete_push_subscriptions(v_ticket.id);

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

  -- A No-show from a scan can still Rejoin, so it keeps its subscriptions: the
  -- other conditions of the offer hold by construction here (a Ticket just
  -- Called is in the current Queue Day, and no child can exist before the
  -- No-show does). A rejoin-origin Ticket has used its second chance.
  if v_ticket.origin <> 'scan' then
    perform public.delete_push_subscriptions(v_ticket.id);
  end if;

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

  perform public.delete_push_subscriptions(v_ticket.id);

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

  -- The source's one Rejoin is used up, so it is final now. The browser saves
  -- its subscription again under the new Ticket, endpoint and all.
  perform public.delete_push_subscriptions(v_source.id);

  return jsonb_build_object(
    'result', public.customer_view_json(v_shop, v_ticket),
    'alerts', public.stamp_heads_ups(v_shop)
  );
end;
$$;

-- Supabase auto-grants new public tables and functions to the Data API roles;
-- take it back. Next.js is the only caller, through the secret-key client, and
-- delete_push_subscriptions is only ever called from inside the functions above.
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on function public.save_push_subscription(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.delete_push_subscriptions(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_push_subscription(uuid, uuid, text, text, text, text)
  to service_role;
