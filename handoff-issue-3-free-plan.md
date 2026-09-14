# Handoff: after #3 and #4

Repo: `/Users/akashaf/workspace/virtual-queue-system` (GitHub `akashaf/virtual-queue-system`, branch `main`).

## Where things stand

- **#3 is done apart from two human steps** (below). The Free-plan findings are on the issue: https://github.com/akashaf/virtual-queue-system/issues/3#issuecomment-5660938883 and in `docs/specs/third-party.md` §2.
- **#4 is implemented**: first migration, `create_shop`, RLS, `POST /api/operator/shops`, `/login`, the real `proxy.ts`, and a dashboard that checks the session and `is_active` on the server.
- Next frontier: **#5** (Customer joins the Queue) and **#9** (Sentry), both `ready-for-agent`.

## 1. Still needs a human

- [ ] **Two Supabase variables in Netlify.** Reading the project's API keys is blocked in the agent sandbox, so copy them from the `queue-service` dashboard (Project Settings → API keys):
      ```
      ~/.bun/bin/netlify env:set NEXT_PUBLIC_SUPABASE_ANON_KEY '<anon key>' --context production
      ~/.bun/bin/netlify env:set SUPABASE_SERVICE_ROLE_KEY '<service role key>' --context production --secret
      ```
      Nothing is deployed that needs them until #4 ships.
- [ ] **Turn the Twilio SMS provider off** in Supabase → Authentication → Sign In / Providers → Phone. `supabase config push` reports it as *unencodable*: it can switch between SMS providers but cannot turn the active one off. `auth.sms.enable_signup` is already `false`, so nobody can sign up by phone meanwhile.
- [ ] **Push the first migration to the cloud**: `bunx supabase db push` needs the database password, which only the user has.
- [ ] Close #3 once the first two are done.

## 2. Netlify Free plan: what it cannot do

Recorded in `docs/specs/third-party.md` §2; repeated here because each one cost a debugging round.

- **The functions region cannot be changed.** `updateSite` returns 422 for `ap-southeast-1` *and* for another US region. Functions stay in `us-east-2`, so every action is two trans-Pacific hops. Fixing it is part of the paid upgrade (ADR 0003).
- **Per-scope environment variables are paid-only, and `--scope` fails silently**: no output, exit 0, nothing written. Always confirm with `netlify env:list --context production`. On Free every variable is all-scope, which is what we need.
- **`--secret` values are write-only** — not readable from the CLI or the dashboard. The generated `OPERATOR_API_KEY`, `CRON_SECRET` and VAPID keys are mirrored to the gitignored `.env.netlify.production`, **the only readable copy**. It is deliberately not named `.env.production.local`, because `next build` loads that name and would pull production secrets into a local build.

## 3. Local environment

- `.env.local` (gitignored) points at local Supabase and holds `OPERATOR_API_KEY=local-operator-key`.
- Start: `colima start && bun run db:start` · Stop: `bun run db:stop && colima stop`.
  If `db:start` fails with `LegacyStatusDbNotReadyError`, just run it again; the container was still booting.
- Colima and the Docker CLI came from Homebrew. `~/.docker/config.json` had a stale `"credsStore": "desktop"` that broke image pulls; it was removed, backup at `~/.docker/config.json.bak-desktop`.
- `.claude/settings.local.json` allows `~/.bun/bin/netlify` so the agent can run Netlify writes. Reading Supabase API keys and searching for credential files stay blocked.
- Tests run against local Supabase only, never the cloud project.

## 4. Gotchas that cost time

- **`"use server"` files may only export values that are async functions.** Adding `export const MESSAGE = "…"` to `app/login/actions.ts` broke *every* action in the file, and neither `tsc` nor `next build` caught it — only `next dev`. Type-only exports (`export interface`) are fine. Shared strings live in `app/login/messages.ts`.
- `bun run db:types` regenerates `lib/supabase/database.types.ts`. Run it after every migration and commit the result, or `tsc` silently stops checking queries.
- Netlify auto-grants new `public` tables to `anon`/`authenticated`, so each migration must `revoke` and then grant back deliberately.
- A Server Action form clicked before hydration submits as a normal POST, and `page.reload()` in Playwright re-submits it. Poll with `page.goto()` instead.
- `bun run typecheck` runs `next typegen` first, because `LayoutProps`/`PageProps` are generated. After deleting routes, `rm -rf .next` clears stale `.next/types`.
- Vitest projects: `unit` (`{app,lib}/**/*.test.ts`) and `db` (`tests/db/**`, needs local Supabase). Plain `bun run test` runs both.
- `git diff` can hang on a pager here; use `git --no-pager diff`.

## 5. Suggested skills

- `mattpocock-skills:implement` with `mattpocock-skills:tdd`, for #5 or #9.
- `mattpocock-skills:code-review` after any code or spec change, before committing.
