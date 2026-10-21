-- A Sign-in ends at the first Close Shop after seven days (#33, ADR 0006).
--
-- close_shop now takes the limit, OWNER_SIGN_IN_MAX_DAYS, which lives in the
-- app's environment rather than here. After closing the Queue Day it deletes
-- every one of the caller's auth.sessions at least that old, on any device, and
-- says whether the caller's own was among them, so the device that closed can
-- send the Owner to sign in with a note. The refresh tokens cascade with the
-- sessions, as they do for revoke_owner_sessions.
--
-- Do not replace this with `[auth.sessions] timebox` after a Pro upgrade: a
-- timebox logs the Owner out at a fixed time, in the middle of a working day.
--
-- The old no-argument close_shop is dropped rather than overloaded: two
-- signatures would leave every caller one argument away from the wrong one. The
-- body below is the live one, unchanged apart from the limit, the delete and
-- `signed_out`.

drop function public.close_shop();

create function public.close_shop(p_sign_in_max_days int)
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
  v_signed_out boolean;
begin
  if p_sign_in_max_days is null or p_sign_in_max_days < 1 then
    raise exception using
      errcode = '22023',
      message = format('sign-in limit must be a positive number of days, not %s', p_sign_in_max_days);
  end if;

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

  -- Every device's, not only this one's: a lost tablet never closes a Shop.
  with ended as (
    delete from auth.sessions s
    where s.user_id = v_shop.owner_user_id
      and s.created_at <= now() - make_interval(days => p_sign_in_max_days)
    returning s.id
  )
  select coalesce(bool_or(e.id = (auth.jwt() ->> 'session_id')::uuid), false)
  into v_signed_out
  from ended e;

  return jsonb_build_object(
    'result', jsonb_build_object(
      'carried_over', v_carried,
      'removed', jsonb_array_length(v_alerts),
      'signed_out', v_signed_out
    ),
    'alerts', v_alerts
  );
end;
$$;

revoke all on function public.close_shop(int) from public, anon, authenticated, service_role;
grant execute on function public.close_shop(int) to authenticated;
