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
- **ESLint here rejects `setState` in an effect body** (`react-hooks/set-state-in-effect`),
  which rules out the usual "reset derived state when a prop changes" effect. `tsc` is happy
  with it, so only `bun run lint` catches it. Use React's adjust-while-rendering pattern
  instead (`if (key !== last) { setLast(key); setCount(0) }`, as `queue-board.tsx` does), and
  read browser storage through `useSyncExternalStore` rather than an effect — the customer
  page needs both.
- `bun run typecheck` runs `next typegen` first, because `LayoutProps` / `PageProps` /
  `RouteContext` are generated. After deleting routes, `rm -rf .next` clears stale
  `.next/types`.
- **Error boundaries take a `retry` prop here, not `reset`.** Next 16.3.5 renamed it, and
  neither `reset` nor `unstable_retry` exists any more, so a boundary copied from older docs
  or from training data renders a dead button. `app/global-error.tsx` uses `retry`. Read
  `node_modules/next/dist/docs/` before assuming any API in this version.

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
- **Overloading a Postgres function breaks its existing callers.** #7 added
  `owner_ticket(shops, uuid, ticket_status[])` beside #6's `(…, ticket_status)` one, and
  every call site instantly failed with *function … is not unique*: the callers pass a bare
  `'called'`, which is `unknown` and matches both. `db:reset` catches it, `tsc` cannot. Either
  cast at every call site or, as #7 did, keep one signature and move the old callers onto it
  in the same migration.
- **A broadcast is testable without a browser.** `realtime.send` just inserts into
  `realtime.messages`, so `tests/db/queue-broadcast.test.ts` reads that table over the plain
  `pg` connection. Two things to know: the rows outlive `resetTestData`, which truncates only
  the `public` tables, so count the delta rather than the total; and `create_shop` inserts and
  then updates the Shop, so a new Shop has already pinged its own topic twice before a test
  does anything.
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

- **A supabase-js `.select()` string must be one literal.** The client parses the
  column string *at the type level*, and TypeScript only gives it a literal type when it is a
  single literal: split a long select across two strings with `+` and every row property
  becomes `GenericStringError`. `lib/push.ts` keeps its embedded-join select on one long line
  for this reason.

- **A Postgres error's `details` is the failing row.** For a constraint violation it reads
  `Failing row contains (…)`, Customer name and coordinates included, and Supabase passes it
  through on the error object. Sentry's scrubber in `lib/error-reporting.ts` filters by key, so
  it cannot see into that string; the reporting helpers send only `message` and `code` for this
  reason. Do not hand a Supabase error to `Sentry.captureException` directly.

## Sentry

- **`@sentry/nextjs` warns on every build** unless `instrumentation-client.ts` exports
  `onRouterTransitionStart`, even with tracing off, and `withSentryConfig` must come from
  `@sentry/nextjs/config` (the root export is deprecated for v11). `next typegen` prints both.
- **The client only sees `NEXT_PUBLIC_` variables**, so the DSN is `NEXT_PUBLIC_SENTRY_DSN`
  (it is public by design). Source-map upload also needs `SENTRY_ORG` and `SENTRY_PROJECT` at
  build time beside `SENTRY_AUTH_TOKEN`.
- **An organization auth token carries one scope, `org:ci`**, which uploads source maps and
  nothing else. `sentry-cli projects list` and `organizations list` both 403 on it, so neither
  is a way to check a token: use `sentry-cli info`, which prints the scopes. A 403 means the
  token is good and refusing the action; only a 401 means the token itself is wrong.
- **The org slug is embedded in the token.** Pass a different `--org` and `sentry-cli` warns
  *Using organization `X` (embedded in token) rather than manually-configured organization `Y`*
  and carries on. That warning is the only cheap check on a mistyped `SENTRY_ORG`; nothing
  validates `SENTRY_PROJECT` until a build actually uploads.
- **Sentry shows an organization token once, at creation.** The Organization Tokens page lists
  each token's name and last use, never its value, so a token that is not saved on the way past
  can only be replaced, not recovered.
- **A capturing transport proves scrubbing end to end.** Pass `createTransport` from
  `@sentry/core` to a real `Sentry.init` and read what it was handed: it exercises the actual
  `beforeSend` chain rather than a mock of it. Sentry attaches context lines that quote the
  surrounding source, though, so never assert on a literal that also appears in the test file —
  it will be in the payload either way and the test will pass for the wrong reason.

## Netlify and secrets

- **Never let a production secret pass through an agent.** A command containing the value puts
  it in the transcript, which is how the first `service_role` key leaked. Secrets go into the
  Netlify UI by hand; editing an existing variable there also keeps its secret flag and scopes,
  avoiding the silent failure below. Public values (`NEXT_PUBLIC_*`) are fine by CLI.
- **`netlify env:set --scope` fails silently on the Free plan**: no output, exit 0, nothing
  written. Always confirm with `netlify env:list --context production`.
- **Netlify secret values are write-only.** You cannot read one back to check it, so a key is
  only ever proven by a request that uses it. `env:list` prints a short placeholder for one, so
  compare the length rather than the value when checking the secret flag took.
- **The Free plan cannot narrow a secret's contexts or scopes.** A variable added as secret
  lands in every context (`dev`, `branch-deploy`, `deploy-preview`, `production`, `dev-server`)
  with `builds, functions, runtime`, and the UI will not restrict it. So choose secrets that are
  safe everywhere: `SENTRY_AUTH_TOKEN` is acceptable only because an organization token carries
  `org:ci` alone. A token that could *read* anything would need a different plan, or no Netlify.

## Testing

- **An e2e context that joins the Queue must grant `"notifications"`.** With the permission
  at its default, the push explanation sheet (#10) opens as a modal right after a successful
  join and blocks every later click in the test. Granted, the page subscribes silently and no
  sheet appears. `test.use({ permissions: ["geolocation", "notifications"] })` is the pattern.
- **Vitest only collects `{app,lib}/**/*.test.ts` (unit) and `tests/db/**` (db).** A scratch
  test written anywhere else is not ignored loudly — it simply never runs, and the suite stays
  green while proving nothing. Check the file is under one of those roots before trusting a pass.

## QR codes

- **`qrcode`'s `width` option does not guarantee the width.** It divides the requested width
  by the module count and *floors* the product, so `width: 1024` came out 1023×1023 for a
  version-6 symbol (a 42-character slug) while shorter slugs were fine. `lib/operator/qr.ts`
  maps pixels onto modules itself for this reason; the unit test renders several slug lengths.

## JavaScript and Postgres disagreeing

- `String.length` counts an emoji as 2; Postgres `length()` counts it as 1. Customer names are
  measured with `[...name].length` so the two agree.

## Shell

- `git diff` can hang on a pager here; use `git --no-pager diff`.
- `until <check>; do sleep; done` stops when the check **succeeds** — easy to invert when
  polling a deploy state.
- `page.reload()` in Playwright re-submits a POST. Poll with `page.goto()` instead.
