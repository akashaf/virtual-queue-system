# Handoff

Repo: `akashaf/virtual-queue-system`, branch `main`, committed at `5714137` — **not pushed**.

**The site is live**: https://virtual-queue-system.netlify.app — `/` and `/login` return 200, `/api/health` returns `{"ok":true}`, `/dashboard` 307s to `/login`. But the **cloud database is still empty**, so no Owner can sign in and no Customer can join. See task 2 below, which is now the only blocker.

## Done in the last session

- **#5 (Customer joins the Queue and sees their position)** — implemented, reviewed on both
  the Standards and Spec axes, committed as `5714137`. Not yet deployed or closed: it needs
  task 2 below before it can run anywhere but locally.
  - `tickets`, `join_queue`, `get_customer_view`, `get_owner_queue` in
    `supabase/migrations/20260914150714_tickets_and_join_queue.sql`.
  - `/s/[slug]` (EN/BM), `GET /api/s/[slug]/me`, and the dashboard's Waiting list.
  - Tests: 214 in `bun run test`, 22 in `bun run e2e`.
  - Specs updated alongside — `docs/specs/backend.md` §3/§5/§6/§7 and `frontend.md`
    §1/§3.1/§6. **Don't re-derive any of it from the code.** In particular §5 records where
    the shipped function contracts stop short of the full MVP shape, per slice.

## Done in the session before that

- **Supabase API keys** — the leaked `service_role` key is revoked, the project now uses publishable/secret keys, and both environment variables were renamed to match. Commit `314d759`, [ADR 0004](docs/adr/0004-publishable-and-secret-supabase-api-keys.md), task 1 below.

## Done before that

- **#3 (Netlify)** — everything except the Twilio toggle. Findings on the issue: https://github.com/akashaf/virtual-queue-system/issues/3#issuecomment-5660938883
- **#4 (Operator creates a Shop, Owner logs in)** — implemented, reviewed on both the Standards and Spec axes, committed and deployed. Summary: https://github.com/akashaf/virtual-queue-system/issues/4#issuecomment-5661074145
- Commits: `9d07d6d` (Netlify limits + Node pin), `a4f251e` (#4), `716fea6` (keep the liveness check off the session proxy).

Specs were updated alongside the code — `docs/specs/third-party.md` §2 for the Netlify limits, `docs/specs/backend.md` §3/§5/§8/§11 for the schema, `create_shop`, the admin API contract and the generated types. Don't re-derive any of it from the code.

## What still needs doing, in order

### 1. ~~Rotate the Supabase service-role key~~ — done, by migrating instead

The leaked `service_role` key is **revoked**, confirmed by `401` from `/auth/v1/admin/users`.
Production, local development and the test suites all run on publishable/secret keys, and the
environment variables are now `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`
— the legacy-named pair is deleted from Netlify.

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
- **`SUPABASE_SECRET_KEY` in production is not yet proven.** Netlify secret values are write-only
  and no deployed route builds the admin client until the `shops` table exists, so the first
  `POST /api/operator/shops` after task 2 is what actually exercises it. If that call fails on
  auth rather than schema, re-copy the `netlify_production` key from the Supabase dashboard into
  Netlify. The publishable key *is* proven: `/dashboard` 307s, which needs `requireEnv` in
  `proxy.ts` to resolve it.

### 2. Push the first migration to the cloud

```
bunx supabase db push
```

Needs the **database password**, which only the user has. Until this runs, **both**
migrations exist only locally: the deployed `/login` cannot authenticate anyone and
`/s/[slug]` has no `tickets` table to read. This is now the only thing standing between
the repo and a working deployment.

### 3. Turn the Twilio SMS provider off

Supabase → Authentication → Sign In / Providers → Phone. `supabase config push` reports it as *unencodable*: it can switch between SMS providers but cannot turn the active one off. `auth.sms.enable_signup` is already `false`, so nobody can sign up by phone meanwhile.

### 4. Close #3

Its last open acceptance criterion (environment variables, Deploy Previews) is now satisfied — all nine production variables are set, previews are off, branch deploys are limited to `main`.

### 5. Then pick up the frontier

**#6** (Call next, Done and Served, live on both screens) is the natural next step: #5 left
the dashboard read-only, and #6 is the first slice where one screen changes what another
shows, so it brings the `realtime.send('queue_changed')` trigger with it (backend.md §6 says
so explicitly). It also adds `get_owner_queue`'s Served-within-the-undo-window list.

Also `ready-for-agent`: **#9** (Sentry), and **#16** (asymmetric JWT signing keys), which
wants doing before real Shops are onboarded, while signing everyone out costs nothing.

Onboarding the first Shop, once the migration is pushed, uses `POST /api/operator/shops` with the `OPERATOR_API_KEY` from `.env.netlify.production` — **that file is the only readable copy**, because Netlify secret values are write-only.

## Local environment

- Start: `colima start && bun run db:start` · Stop: `bun run db:stop && colima stop`.
  If `db:start` fails with `LegacyStatusDbNotReadyError`, run it again; the container was still booting.
- `.env.local` (gitignored) points at local Supabase with the stack's `sb_publishable_…` /
  `sb_secret_…` keys, `OPERATOR_API_KEY=local-operator-key`. Regenerate it with the `bun run db:env`
  line quoted at the top of the file.
- `.claude/settings.local.json` allows `~/.bun/bin/netlify` so an agent can make Netlify writes. Reading Supabase API keys and searching for credential files stay blocked by the sandbox, so key values have to come from the user — and secret ones should go into the Netlify UI by hand, never through an agent (see the gotcha below).
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
- **A layout and its page render at the same time.** `app/dashboard/layout.tsx` redirecting a
  Deactivated Shop's Owner does not stop `page.tsx` from running and throwing first. Only the
  e2e run's `[WebServer]` output showed it. Owner reads return null for "no active Shop"
  rather than throwing.
- **`db:reset` before the migration edit is not a reset.** A test asserting a new constraint
  passed against the old function for exactly this reason. Reset after the last SQL edit.
- Supabase's default privileges grant `service_role` execute on every new function, so
  `revoke … from public, anon, authenticated` leaves it behind. Name `service_role` too for
  helpers nothing outside the database calls.
- `String.length` counts an emoji as 2; Postgres `length()` counts it as 1. Customer names are
  measured with `[...name].length` so the two agree.

## Suggested skills

- `mattpocock-skills:implement` with `mattpocock-skills:tdd` — for #6 or #9.
- `mattpocock-skills:code-review` — after any code or spec change, before committing. It caught three real defects in #4 and three more in #5 that the tests did not.
- `mattpocock-skills:domain-modeling` — if #6's Undo window or Realtime rules force a decision worth an ADR.
