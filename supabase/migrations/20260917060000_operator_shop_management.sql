-- Operator Shop management (#14).
--
-- Two service_role-only functions behind the admin API (backend.md §8): the
-- Operator's view of the Shops, and the one direct SQL write to the Auth schema
-- the app makes (the rest go through the Auth admin API). Shops are never deleted, only deactivated, so nothing here removes
-- a row.

/*
 * The Shops as the Operator sees them: every column the API returns, the Owner's
 * email, and the Tickets Served so far this Billing Month.
 *
 * The email lives in auth.users, and reading it here saves the API a round trip
 * to the Auth admin endpoint per Shop. `served_this_month` counts the calendar
 * month in Asia/Kuala_Lumpur, per CONTEXT.md's Billing Month, so the number the
 * Operator glances at agrees with the invoice billing_summary draws up (#13).
 * Only status = 'served' counts: a Done that was undone is back in the chair.
 *
 * With a slug it returns that one Shop, or no rows.
 */
create function public.operator_shops(p_slug text default null)
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
    (
      select count(*)::int
      from public.tickets t
      where t.shop_id = s.id
        and t.status = 'served'
        and t.served_at >= (
          date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur')
            at time zone 'Asia/Kuala_Lumpur'
        )
    )
  from public.shops s
  join auth.users u on u.id = s.owner_user_id
  where p_slug is null or s.slug = p_slug
  order by s.created_at, s.slug;
$$;

/*
 * Signs an Owner out everywhere by deleting their auth.sessions rows. The
 * refresh tokens go with them (auth.refresh_tokens cascades on session_id), so
 * no browser can mint a new access token; the Auth server also refuses a
 * getUser() for a session it no longer has, which is what the dashboard layout
 * asks on every render. An access JWT already issued is still accepted by the
 * Data API until it expires, which is why config.toml keeps jwt_expiry at 600
 * seconds — and every owner function starts by locking an *active* Shop anyway.
 *
 * Called by the admin API after a deactivation or a password reset.
 */
create function public.revoke_owner_sessions(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_user_id;
$$;

-- Default privileges hand execute to every Data API role; only the secret-key
-- client may call either of these.
revoke all on function public.operator_shops(text) from public, anon, authenticated;
revoke all on function public.revoke_owner_sessions(uuid) from public, anon, authenticated;
grant execute on function public.operator_shops(text) to service_role;
grant execute on function public.revoke_owner_sessions(uuid) to service_role;
