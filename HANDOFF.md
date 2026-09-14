# Handoff

Repo: `akashaf/virtual-queue-system`, branch `main`, pushed at `716fea6`.

**The site is live**: https://virtual-queue-system.netlify.app — `/` and `/login` return 200, `/api/health` returns `{"ok":true}`, `/dashboard` 307s to `/login`. But the **cloud database is still empty**, so no Owner can actually sign in yet. See task 2 below.

## Done in the last session

- **#3 (Netlify)** — everything except the Twilio toggle. Findings on the issue: https://github.com/akashaf/virtual-queue-system/issues/3#issuecomment-5660938883
- **#4 (Operator creates a Shop, Owner logs in)** — implemented, reviewed on both the Standards and Spec axes, committed and deployed. Summary: https://github.com/akashaf/virtual-queue-system/issues/4#issuecomment-5661074145
- Commits: `9d07d6d` (Netlify limits + Node pin), `a4f251e` (#4), `716fea6` (keep the liveness check off the session proxy).

Specs were updated alongside the code — `docs/specs/third-party.md` §2 for the Netlify limits, `docs/specs/backend.md` §3/§5/§8/§11 for the schema, `create_shop`, the admin API contract and the generated types. Don't re-derive any of it from the code.

## What still needs doing, in order

### 1. ~~Rotate the Supabase service-role key~~ — done, by migrating instead

The leaked `service_role` key is **revoked**, confirmed by `401` from `/auth/v1/admin/users`.

It was not rotated. The legacy `anon`/`service_role` JWT keys are deprecated by Supabase
(gone by the end of 2026, and never issued to projects created since 1 November 2025), so
regenerating the JWT secret would have re-issued a key we had to replace again within the
year, and invalidated every session to do it. Instead the project moved to publishable and
secret API keys and the legacy keys were deactivated — see
[ADR 0004](docs/adr/0004-publishable-and-secret-supabase-api-keys.md) and
`docs/specs/third-party.md` §3.

Still open from that migration:

- **Asymmetric JWT signing keys** — deliberately deferred, tracked as
  [#16](https://github.com/akashaf/virtual-queue-system/issues/16). Access tokens are still
  signed by the legacy shared JWT secret, so rotating it signs everyone out. Cheapest while
  no Owner has a session.
- Deactivation is **reversible** in the Supabase dashboard, if a forgotten client turns up.

### 2. Push the first migration to the cloud

```
bunx supabase db push
```

Needs the **database password**, which only the user has. Until this runs, `supabase/migrations/20260914075646_shops_and_queue_days.sql` exists only locally and the deployed `/login` cannot authenticate anyone.

### 3. Turn the Twilio SMS provider off

Supabase → Authentication → Sign In / Providers → Phone. `supabase config push` reports it as *unencodable*: it can switch between SMS providers but cannot turn the active one off. `auth.sms.enable_signup` is already `false`, so nobody can sign up by phone meanwhile.

### 4. Close #3

Its last open acceptance criterion (environment variables, Deploy Previews) is now satisfied — all nine production variables are set, previews are off, branch deploys are limited to `main`.

### 5. Then pick up the frontier

**#5** (Customer joins the Queue and sees their position) and **#9** (Sentry) are both `ready-for-agent`. #5 is the natural next step and needs the `tickets` table plus `join_queue`.

Onboarding the first Shop, once the migration is pushed, uses `POST /api/operator/shops` with the `OPERATOR_API_KEY` from `.env.netlify.production` — **that file is the only readable copy**, because Netlify secret values are write-only.

## Local environment

- Start: `colima start && bun run db:start` · Stop: `bun run db:stop && colima stop`.
  If `db:start` fails with `LegacyStatusDbNotReadyError`, run it again; the container was still booting.
- `.env.local` (gitignored) points at local Supabase, `OPERATOR_API_KEY=local-operator-key`.
- `.claude/settings.local.json` allows `~/.bun/bin/netlify` so an agent can make Netlify writes. Reading Supabase API keys and searching for credential files stay blocked by the sandbox — that is why the two Supabase keys had to be supplied by hand.
- Tests run against local Supabase only, never the cloud project. `bun run test` (85 tests) and `bun run e2e` (8 tests).

## Gotchas worth keeping

Not in the specs, and each one cost real time:

- **`"use server"` files may only export async functions.** Adding `export const MESSAGE = "…"` to `app/login/actions.ts` broke *every* action in the file — and neither `tsc` nor `next build` caught it, only `next dev`. Type-only exports are fine. Shared strings live in `app/login/messages.ts`.
- **`netlify env:set --scope` fails silently on the Free plan**: no output, exit 0, nothing written. Always confirm with `netlify env:list --context production`.
- **`proxy.ts` matches by path shape.** Its matcher excludes anything containing a dot, so `/api/health` was matched and inherited a hard dependency on Supabase config — the liveness check 500ed exactly when it was needed to diagnose a broken deploy. Bearer-authenticated routes are now excluded explicitly. Watch this when adding routes.
- `bun run db:types` regenerates `lib/supabase/database.types.ts`. Run it after every migration and commit the result, or `tsc` quietly stops checking queries.
- Supabase auto-grants new `public` tables to `anon`/`authenticated`, so every migration must `revoke` and then grant back deliberately.
- A Server Action form clicked before hydration submits as a normal POST, and `page.reload()` in Playwright re-submits it. Poll with `page.goto()` instead.
- `bun run typecheck` runs `next typegen` first, because `LayoutProps`/`PageProps` are generated. After deleting routes, `rm -rf .next` clears stale `.next/types`.
- **Never let a production secret pass through an agent.** A command containing the value puts
  it in the transcript, which is how the first `service_role` key leaked. Secrets go into the
  Netlify UI by hand; editing an existing variable there also keeps its secret flag and scopes,
  avoiding the silent `--scope` failure above. Public values (`NEXT_PUBLIC_*`) are fine by CLI.
- `git diff` can hang on a pager here; use `git --no-pager diff`.
- `until <check>; do sleep; done` stops when the check **succeeds** — easy to invert when polling a deploy state.

## Suggested skills

- `mattpocock-skills:implement` with `mattpocock-skills:tdd` — for #5 or #9.
- `mattpocock-skills:code-review` — after any code or spec change, before committing. It caught three real defects in #4 that the tests did not.
- `mattpocock-skills:domain-modeling` — if #5's Ticket rules force a decision worth an ADR.
