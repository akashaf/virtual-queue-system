-- From 2026-10-30 Supabase stops auto-granting new public tables to the Data API
-- roles, and every rebuild from these migrations (db reset, a new project, a
-- preview branch) makes the tables new. The earlier migrations re-grant anon and
-- authenticated explicitly, but the secret-key client (lib/push.ts,
-- lib/operator/shops.ts, the e2e helpers) only ever had the auto-grant.
--
-- Production already holds these grants, so there this changes nothing.

grant select, insert, update, delete on public.shops to service_role;
grant select, insert, update, delete on public.queue_days to service_role;
grant select, insert, update, delete on public.tickets to service_role;
grant select, insert, update, delete on public.push_sends to service_role;
