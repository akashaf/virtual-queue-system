-- Last Call and Close Shop with carry-over (#11).
--
-- The Owner ends the Queue Day in two steps. Last Call stops new joins and asks
-- every Waiting Customer to choose: stay today, or move to the next Queue Day.
-- Close Shop then resolves everyone — carry-choice Tickets move to the front of
-- the new day, numbered 1..k in their original order, and the rest are Removed
-- with a `shop_closed` alert. The customer view gains the fields those screens
-- read: `last_call_choice`, `carried_over` and `removed_reason`.

/*
 * Stops new Tickets joining and asks the Queue to choose.
 *
 * Sets `joining_state = last_call`, stamps the Queue Day's `last_call_at`, and
 * returns a `last_call` alert for every Waiting Ticket. Pressing it while Last
 * Call is already on does nothing — two Owner phones may both press it, and the
 * second press must not alert the whole Queue again.
 */
create function public.start_last_call()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_alerts jsonb;
begin
  v_shop := public.lock_owner_shop();

  if v_shop.joining_state = 'last_call' then
    return jsonb_build_object(
      'result', jsonb_build_object('joining_state', 'last_call'),
      'alerts', '[]'::jsonb
    );
  end if;

  update public.shops set joining_state = 'last_call' where id = v_shop.id;
  update public.queue_days
  set last_call_at = now()
  where id = v_shop.current_queue_day_id;

  select coalesce(
    jsonb_agg(jsonb_build_object('ticket_id', t.id, 'kind', 'last_call') order by t.number),
    '[]'::jsonb
  ) into v_alerts
  from public.tickets t
  where t.queue_day_id = v_shop.current_queue_day_id
    and t.status = 'waiting';

  return jsonb_build_object(
    'result', jsonb_build_object('joining_state', 'last_call'),
    'alerts', v_alerts || public.stamp_heads_ups(v_shop)
  );
end;
$$;

/*
 * Reopens joining before Close Shop (§12 rule 2).
 *
 * Choices already made are kept: a new Last Call can change them, and Close
 * Shop is what acts on them. `last_call_at` is left standing too — it records
 * when the Queue Day's most recent Last Call began, and starting another one
 * stamps it afresh.
 */
create function public.cancel_last_call()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
begin
  v_shop := public.lock_owner_shop();

  if v_shop.joining_state <> 'open' then
    update public.shops set joining_state = 'open' where id = v_shop.id;
  end if;

  return jsonb_build_object(
    'result', jsonb_build_object('joining_state', 'open'),
    'alerts', public.stamp_heads_ups(v_shop)
  );
end;
$$;

/*
 * The Waiting Customer's answer to Last Call: stay today, or move to the next
 * Queue Day. Changeable until Close Shop, which is the moment the choice is
 * acted on.
 *
 * Only allowed while the question is open: outside Last Call the choice card
 * is not on anyone's screen, and a press that arrives anyway — the Owner
 * reopened joining, or closed, just as the Customer tapped — is told the
 * situation rather than silently recorded.
 *
 * Errors: not_last_call, ticket_not_found.
 */
create function public.choose_last_call(
  p_ticket_id uuid,
  p_device_id uuid,
  p_choice public.last_call_choice
)
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

  if v_shop.joining_state <> 'last_call' then
    raise exception 'not_last_call';
  end if;

  -- The device id is the whole of the claim, as everywhere: part of the lookup,
  -- not a check after it. Only a Waiting Ticket has a choice to make — one in a
  -- chair is being served today whatever it answers.
  select * into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
    and t.queue_day_id = v_shop.current_queue_day_id
    and t.device_id = p_device_id
    and t.status = 'waiting';

  if not found then
    raise exception 'ticket_not_found';
  end if;

  update public.tickets
  set last_call_choice = p_choice
  where id = v_ticket.id
  returning * into v_ticket;

  return jsonb_build_object(
    'result', public.customer_view_json(v_shop, v_ticket),
    'alerts', public.stamp_heads_ups(v_shop)
  );
end;
$$;

/*
 * Ends the Queue Day and opens the next one.
 *
 * Refused while any Ticket is Called (§12 rule 1): auto-resolving a chair would
 * either bill an unconfirmed haircut or drop a real one, so the Owner finishes
 * those first. Then, in order:
 *
 *   1. The current Queue Day is closed *before* the new one is created — the
 *      partial unique index allows a Shop only one open day at a time.
 *   2. Waiting Tickets that chose `carry` and have not carried before move to
 *      the new day, renumbered 1..k in their original order (§12 rule 3). The
 *      choice is cleared — it has been honoured — and `carried_over_at` marks
 *      them as having used their one carry. Their `heads_up_sent_at` is kept:
 *      the Heads-up is one-time per Ticket (CONTEXT.md), and one already told
 *      "almost your turn" is not told again tomorrow.
 *   3. Every other Waiting Ticket is Removed (`close_shop`), each with a
 *      `shop_closed` alert. A Carried-over Ticket is among them whatever it
 *      chose: one carry is all a Ticket gets. Their push subscriptions are
 *      deliberately NOT deleted here — the dispatcher still needs them to send
 *      the very alert this returns, and deletes them once it has (lib/push.ts).
 *   4. Joining reopens. A Queue Day is the span between two Close Shops, not a
 *      calendar day, so the new day accepts Tickets at once.
 *
 * No stamp_heads_ups, alone among the mutations: the carried Tickets are at the
 * front of the new day, and stamping now would push "almost your turn" to
 * people who just chose to come back tomorrow. The new day's first mutation
 * tells whoever is owed one.
 *
 * Errors: tickets_still_called.
 */
create function public.close_shop()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops;
  v_new_day_id uuid;
  v_carried int;
  v_alerts jsonb;
begin
  v_shop := public.lock_owner_shop();

  if exists (
    select 1 from public.tickets t
    where t.queue_day_id = v_shop.current_queue_day_id
      and t.status = 'called'
  ) then
    raise exception 'tickets_still_called';
  end if;

  update public.queue_days
  set closed_at = now()
  where id = v_shop.current_queue_day_id;

  insert into public.queue_days (shop_id, started_at)
  values (v_shop.id, now())
  returning id into v_new_day_id;

  with movers as (
    select t.id, row_number() over (order by t.number) as new_number
    from public.tickets t
    where t.queue_day_id = v_shop.current_queue_day_id
      and t.status = 'waiting'
      and t.last_call_choice = 'carry'
      and t.carried_over_at is null
  )
  update public.tickets t
  set queue_day_id = v_new_day_id,
      number = m.new_number,
      carried_over_at = now(),
      last_call_choice = null
  from movers m
  where t.id = m.id;
  get diagnostics v_carried = row_count;

  update public.queue_days
  set next_number = v_carried + 1
  where id = v_new_day_id;

  with removed as (
    update public.tickets t
    set status = 'removed', removed_reason = 'close_shop', finished_at = now()
    where t.queue_day_id = v_shop.current_queue_day_id
      and t.status = 'waiting'
    returning t.id, t.number
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('ticket_id', r.id, 'kind', 'shop_closed') order by r.number),
    '[]'::jsonb
  ) into v_alerts
  from removed r;

  update public.shops
  set current_queue_day_id = v_new_day_id, joining_state = 'open'
  where id = v_shop.id;

  return jsonb_build_object(
    'result', jsonb_build_object(
      'carried_over', v_carried,
      'removed', jsonb_array_length(v_alerts)
    ),
    'alerts', v_alerts
  );
end;
$$;

/*
 * The Customer's view, now carrying the Last Call fields the page shows.
 *
 * `last_call_choice` is what the choice card marks as current; `carried_over`
 * is the "Moved from previous day" badge; `removed_reason` is how the page
 * tells "your ticket was removed" apart from "shop closed, come back tomorrow"
 * — all three are facts about the Customer's own Ticket, so handing them over
 * tells the browser nothing about anyone else.
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
    end
  );
$$;

/*
 * The Customer page's whole view, now answering for the evening the shop
 * closed.
 *
 * Close Shop moves the whole Queue Day into the past, so the current-day lookup
 * that (rightly) hides yesterday's news also hides the one ending a Customer is
 * owed *tonight*: their page refetches on the closing ping and would meet the
 * join form, as though the Queue they stood in had never existed. So when the
 * current day holds nothing for this device, the Ticket Close Shop removed is
 * looked for in the day that just closed — but only for a few hours. The screen
 * says "come back tomorrow"; a Customer who does must meet the join form, not
 * last night's goodbye.
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

    if v_ticket.id is null then
      select t.* into v_ticket
      from public.tickets t
      join public.queue_days d on d.id = t.queue_day_id
      where d.shop_id = v_shop.id
        and d.closed_at > now() - interval '6 hours'
        and t.device_id = p_device_id
        and t.status = 'removed'
        and t.removed_reason = 'close_shop'
      order by t.joined_at desc, t.number desc
      limit 1;
    end if;
  end if;

  return public.customer_view_json(v_shop, v_ticket);
end;
$$;

/*
 * The Owner's live Queue, now saying what each Waiting Ticket chose and which
 * came over from yesterday — the dashboard's badges, and what its Close Shop
 * confirmation counts ("N moving to next day, N will be removed").
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
          'origin', t.origin,
          'last_call_choice', t.last_call_choice,
          'carried_over', t.carried_over_at is not null
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
-- back, then hand out only what backend.md §3 allows: the Owner presses through
-- their own JWT, the Customer through Next.js and the secret key.
revoke all on function public.start_last_call() from public, anon, authenticated;
revoke all on function public.cancel_last_call() from public, anon, authenticated;
revoke all on function public.close_shop() from public, anon, authenticated;
revoke all on function public.choose_last_call(uuid, uuid, public.last_call_choice)
  from public, anon, authenticated;

grant execute on function public.start_last_call() to authenticated;
grant execute on function public.cancel_last_call() to authenticated;
grant execute on function public.close_shop() to authenticated;
grant execute on function public.choose_last_call(uuid, uuid, public.last_call_choice)
  to service_role;
