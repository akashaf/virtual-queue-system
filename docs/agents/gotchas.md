# Gotchas

Things that are true of this repo, are not in the specs, and each cost real time to find.
Add to this file when something surprises you; it is cheaper than finding it twice.

## Next.js

- **`"use server"` files may only export async functions.** Adding `export const MESSAGE = "…"`
  to `app/login/actions.ts` broke *every* action in the file, and neither `tsc` nor `next build`
  caught it — only `next dev`. Type-only exports are fine. Shared strings live beside the
  actions, in their own module (`app/login/messages.ts`).
- **A layout and its page render at the same time.** `app/dashboard/layout.tsx` redirecting a
  Deactivated Shop's Owner does not stop `page.tsx` running and throwing first. Only the e2e
  run's `[WebServer]` output showed it. Owner reads return null for "no active Shop" rather
  than throwing, so the page survives on its own.
- **`proxy.ts` matches by path shape.** Its matcher excludes anything containing a dot, so
  `/api/health` was matched and inherited a hard dependency on Supabase config — the liveness
  check 500ed exactly when it was needed to diagnose a broken deploy. Bearer-authenticated
  routes are now excluded explicitly. Watch this when adding a route.
- **A Server Action form clicked before hydration submits as a normal POST.** The customer
  page's Join button stays disabled until hydrated for this reason: a pre-hydration submit
  would post with no coordinates, and the Join Radius check is the whole point of it.
- `bun run typecheck` runs `next typegen` first, because `LayoutProps` / `PageProps` /
  `RouteContext` are generated. After deleting routes, `rm -rf .next` clears stale
  `.next/types`.

## Supabase and migrations

- `bun run db:types` regenerates `lib/supabase/database.types.ts`. Run it after every
  migration and commit the result, or `tsc` quietly stops checking queries.
- **Supabase auto-grants new `public` tables to `anon` / `authenticated`**, so every migration
  must `revoke` and then grant back deliberately.
- **Default privileges also grant `service_role` execute on every new function**, so
  `revoke … from public, anon, authenticated` leaves it behind. Name `service_role` too for
  helpers that nothing outside the database calls.
- **`db:reset` before the migration edit is not a reset.** A test asserting a new constraint
  passed against the old function for exactly this reason. Reset after the *last* SQL edit,
  then run the tests.
- **The JWKS endpoint does not tell you whether JWT signing keys have been migrated.**
  `/auth/v1/.well-known/jwks.json` publishes keys that *verify*, and a shared HS256 secret can
  never appear in a JWKS — so a project with an asymmetric key still on *standby* looks
  identical to one that has rotated to it. Read *Authentication → JWT Keys* for which key is
  **Current key**, or decode an access token and read `alg` and `kid`.
- **`supabase config diff` does not tell you whether phone sign-in is on.** It reports
  `auth.sms.twilio.enabled | remote: true` even after phone auth is switched off, because that
  key means *Twilio is the selected SMS provider*, not *phone sign-in is enabled*. Trusting it
  cost this repo three rounds of telling the user a dashboard change had not worked when it
  had. Ask the Auth service, which answers for the running system:
  `curl -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" https://<ref>.supabase.co/auth/v1/settings`
  and read `external.phone`. More generally, `config diff` compares against the CLI's config
  model, which is not always shaped like the thing the dashboard toggles.
- **Never run `supabase config push` from the repo.** `supabase/config.toml` is the local
  development config and much of it is wrong for production — `site_url`, redirect URLs,
  pooler sizes, OTP and email limits. It has no per-key flag, and a non-interactive run
  proceeds without confirmation. `docs/specs/third-party.md` §3 has the safe scratch-workdir
  recipe. `supabase config diff` is read-only and safe.

## Netlify and secrets

- **Never let a production secret pass through an agent.** A command containing the value puts
  it in the transcript, which is how the first `service_role` key leaked. Secrets go into the
  Netlify UI by hand; editing an existing variable there also keeps its secret flag and scopes,
  avoiding the silent failure below. Public values (`NEXT_PUBLIC_*`) are fine by CLI.
- **`netlify env:set --scope` fails silently on the Free plan**: no output, exit 0, nothing
  written. Always confirm with `netlify env:list --context production`.
- **Netlify secret values are write-only.** You cannot read one back to check it, so a key is
  only ever proven by a request that uses it.

## JavaScript and Postgres disagreeing

- `String.length` counts an emoji as 2; Postgres `length()` counts it as 1. Customer names are
  measured with `[...name].length` so the two agree.

## Shell

- `git diff` can hang on a pager here; use `git --no-pager diff`.
- `until <check>; do sleep; done` stops when the check **succeeds** — easy to invert when
  polling a deploy state.
- `page.reload()` in Playwright re-submits a POST. Poll with `page.goto()` instead.
