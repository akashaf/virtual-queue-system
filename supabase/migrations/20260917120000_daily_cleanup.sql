-- The daily cleanup job (#15).
--
-- POST /api/cron/daily runs these at 03:00 Malaysia time (backend.md §9): first
-- the Carried-over Tickets whose three days are up, then the personal data PDPA
-- says the Shop no longer needs. Both are safe to run twice, because a manual
-- "Run now" in the Netlify UI or a retry may do exactly that.

/** How long a Carried-over Ticket may wait for its Customer to come back (CONTEXT.md). */
create function public.carry_over_lifetime()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '3 days';
$$;

/** How long a finished Ticket keeps the Customer's name and device (PDPA). */
create function public.personal_data_retention()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '30 days';
$$;

/*
 * Removes every Waiting Carried-over Ticket carried more than 3 days ago
 * (CONTEXT.md), as `carry_over_expired`.
 *
 * A Called one stays in the chair: the Owner is serving that Customer, and
 * taking the Ticket out from under them would lose a real haircut, for the same
 * reason Close Shop refuses while one is Called.
 *
 * Shop by Shop, each locked first like every other queue mutation, in id order
 * so two runs cannot deadlock. The Ticket is re-checked under the lock: an
 * Owner may have Called it between the scan and the lock.
 *
 * Carried-over Tickets sit at the front of the Queue, so removing them moves
 * everyone behind up, and the Heads-ups that earns are returned as alerts.
 * Not for a Deactivated Shop, though: nobody is being served there, and
 * "almost your turn" would send a Customer to a Shop that cannot call them.
 *
 * No alert for the expired Ticket itself. It chose to come back three days
 * ago and has not; there is no push kind for it, and its page says Removed.
 */
create function public.expire_carried_over()
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
    with expired as (
      update public.tickets t
      set status = 'removed', removed_reason = 'carry_over_expired', finished_at = now()
      where t.shop_id = v_shop.id
        and t.status = 'waiting'
        and t.carried_over_at < now() - public.carry_over_lifetime()
      returning t.id
    ),
    unsubscribed as (
      delete from public.push_subscriptions s
      using expired e
      where s.ticket_id = e.id
    )
    select count(*) into v_expired from expired;

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
 * PDPA: 30 days after a Ticket finishes, the Customer's name and device go, and
 * so do any push subscriptions still pointing at it — a No-show that could
 * have Rejoined keeps them, and a Close Shop whose dispatch failed never had
 * them deleted.
 *
 * The Ticket row itself stays. A Served Ticket is what the Shop is billed for,
 * and the others are what the Owner's history counts; neither needs a name.
 *
 * No Shop lock: nothing here moves anyone in a Queue. A Ticket that finished
 * 30 days ago can no longer change — an Undo is two minutes — so there is
 * nothing to race.
 *
 * Only Tickets that still hold something are updated, so a second run counts
 * nothing and touches nothing.
 */
create function public.erase_expired_personal_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_erased int;
  v_unsubscribed int;
begin
  update public.tickets t
  set customer_name = null, device_id = null
  where t.finished_at < now() - public.personal_data_retention()
    and (t.customer_name is not null or t.device_id is not null);
  get diagnostics v_erased = row_count;

  delete from public.push_subscriptions s
  using public.tickets t
  where t.id = s.ticket_id
    and t.finished_at < now() - public.personal_data_retention();
  get diagnostics v_unsubscribed = row_count;

  return jsonb_build_object(
    'erased_tickets', v_erased,
    'deleted_subscriptions', v_unsubscribed
  );
end;
$$;

-- What erasure looks for every night, kept small: once a Ticket has been
-- erased it drops out, so the index holds only the Tickets still to come due.
create index tickets_awaiting_erasure on public.tickets (finished_at)
  where customer_name is not null or device_id is not null;

-- Default privileges hand execute to every Data API role. The helpers are only
-- called from inside this file's functions, so nobody keeps them — service_role
-- included; only the secret-key client may call the two jobs.
revoke all on function public.carry_over_lifetime()
  from public, anon, authenticated, service_role;
revoke all on function public.personal_data_retention()
  from public, anon, authenticated, service_role;
revoke all on function public.expire_carried_over() from public, anon, authenticated;
revoke all on function public.erase_expired_personal_data() from public, anon, authenticated;
grant execute on function public.expire_carried_over() to service_role;
grant execute on function public.erase_expired_personal_data() to service_role;
