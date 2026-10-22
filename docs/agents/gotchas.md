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
  instead (`if (key !== last) { setLast(key); setCount(0) }`, as `app/dashboard/use-elapsed-ms.ts` does), and
  read browser storage through `useSyncExternalStore` rather than an effect — the customer
  page needs both.
- **A Radix Collapsible on a native `<details>` must not toggle too.** The queue board's
  "Just served" is a Collapsible on `<details>`/`<summary>` (an e2e test finds it by
  `locator("details")`). With the Collapsible also handling the click, React applied
  `open` during the click and the browser's own summary toggle then flipped it back shut.
  The `<details>` `onToggle` is the single source of truth and the Collapsible is only told.
- **`bun run e2e` cannot start while `bun run dev` is running.** Next allows one dev server
  per project directory, so Playwright's own server on 3100 exits at once. Run
  `E2E_PORT=3000 bun run e2e` to reuse the running one instead (it already talks to local
  Supabase through `.env.local`). Either way e2e runs against `next dev`, so saving a
  source file mid-run hot-reloads the page under a test; edit after the run finishes.
- `bun run typecheck` runs `next typegen` first, because `LayoutProps` / `PageProps` /
  `RouteContext` are generated. After deleting routes, `rm -rf .next` clears stale
  `.next/types`.
- **Error boundaries take a `retry` prop here, not `reset`.** Next 16.3.5 renamed it, and
  neither `reset` nor `unstable_retry` exists any more, so a boundary copied from older docs
  or from training data renders a dead button. `app/global-error.tsx` uses `retry`. Read
  `node_modules/next/dist/docs/` before assuming any API in this version.
- **The first join's device cookie arrives with the Server Action's response.** Anything the
  browser sends before that response lands goes without the cookie, so the server answers as
  if this browser holds no Ticket. The join's own `queue_changed` ping triggers such a refetch.
  Every screen that refetches a view orders it through `createViewOrder` (`lib/view-order.ts`),
  which drops a refetch sent before a newer view was shown (#31, #32); a new screen needs it too.

- **A new source the page loads must go into `lib/csp.ts`.** Every page carries a
  Content-Security-Policy (report-only until #36 enforces it), so nothing visibly breaks: the
  browser only raises a `securitypolicyviolation` event. The `test` in `e2e/helpers.ts` fails
  any e2e test that raises one, which is how the alert chimes' `blob:` URLs were found. An
  inline `<script>` needs the nonce from the `x-nonce` request header, as `app/layout.tsx`
  passes it to next-themes.

## Supabase and migrations

- **VS Code can squat on the local database port.** Its extension host (`Code Helper (Plugin)`)
  was found listening on `127.0.0.1:54322`, so every Postgres connection reached it instead of
  Docker and died with *Connection terminated unexpectedly*: db tests, and `supabase start`
  itself, which then leaves the stack stopped. The REST API on 54321 still worked, so e2e
  seeding looked fine. `lsof -nP -iTCP:54322 -sTCP:LISTEN` names the culprit; quitting VS Code
  fully frees it. Killing the process also kills the Claude Code extension running in it.
  Docker here is Colima, so the *healthy* listener is `ssh` (Lima's port-forward mux), not Docker.

- `bun run db:types` regenerates `lib/supabase/database.types.ts`. Run it after every
  migration and commit the result, or `tsc` quietly stops checking queries.
- **Grant every new `public` table explicitly, to every role that uses it.** From 2026-10-30 the
  cloud no longer grants select/insert/update/delete on new tables, or execute on new functions,
  to `anon` / `authenticated` / `service_role`, and that includes every new project and preview
  branch. `auto_expose_new_tables = false` in `supabase/config.toml` makes local `db reset` do
  the same (#39). It still grants truncate/references/trigger, so a migration that creates a
  table enables RLS, `revoke all … from anon, authenticated`, and grants back what each role
  needs, `service_role` included when the secret-key client touches it. Production kept its
  old grants, so a missing one breaks only rebuilt databases. `tests/db/table-grants.test.ts`
  lists the expected grants and fails on any table not in it. The flag needs
  `supabase stop && supabase start` and then `db:reset`: a plain start restores the old database.
- **Default privileges also grant `service_role` execute on every new function**, so
  `revoke … from public, anon, authenticated` leaves it behind. Name `service_role` too for
  helpers that nothing outside the database calls.
- **`db:reset` before the migration edit is not a reset.** A test asserting a new constraint
  passed against the old function for exactly this reason. Reset after the *last* SQL edit,
  then run the tests.
- **`supabase.auth.signOut()` reports success for a Sign-in that has already ended.** supabase-js
  swallows the Auth server's "session not found" answer, so a device signed out from elsewhere
  is told its sign-out worked. `endOtherSignIns` (`lib/auth/owner.ts`) asks `getUser()` first,
  which is refused at once for an ended Sign-in; do the same before trusting a `signOut()`.
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
- **Redefine a function from the database, not from an old migration.** One function can be
  replaced in many migration files, and copying a stale one silently undoes every later fix.
  Take the current body from the local database after `db:reset` (there is no `psql` on the host):
  `docker exec supabase_db_virtual-queue-system psql -U postgres -Atc "select pg_get_functiondef('public.leave_queue'::regproc);"`
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
- **A push to `main` does not migrate production.** Netlify deploys the code; nothing applies
  `supabase/migrations/` to the cloud project. #11, #12 and #14 all shipped code to production
  while its database stayed three migrations behind, and nobody noticed until #13 checked. Before
  `git push`, run `bunx supabase db push --dry-run` (read-only; the linked CLI needs no password
  for it). If it lists anything, settle the order with the user: an additive migration goes
  first; one that changes what live code reads or calls (a dropped table, a new return shape, as
  in #29) breaks production whichever lands first, so the two ship back to back. The user runs
  `bunx supabase db push`; a dry run afterwards should say *Remote database is up to date*.
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

## iPhone and the Home Screen app

- **An iPhone Home Screen app does not share cookies with Safari.** Adding the queue page to
  the Home Screen gives it its own storage, so the device cookie — and with it the Ticket —
  stays behind in Safari, and the installed app sees a new device. Joining again there puts the
  same person in the Queue twice. Advice to install has to come before joining, not after.
- **Before iOS 26, Add to Home Screen needs a manifest to make an app.** Without a manifest
  asking for `display: standalone`, it saves a bookmark that opens in Safari again, so the
  install gate would stop the Customer a second time. iOS 26 opens every Home Screen page as an
  app, which is why testing on a current iPhone never showed it. Each Shop's page links
  `/s/{slug}/app.webmanifest` for this reason.
- **A Ticket only has a OneSignal subscriber once the Customer has finished the sheet.**
  A Call next pressed seconds after a join can find nobody under that Ticket's External ID.
  It is not silent any more: `push_sends` gets a `no_subscriber` row. When testing push,
  read `push_sends` for the Ticket before blaming OneSignal or the phone.
- **Safari revokes a push subscription after three pushes that show nothing.** The service
  worker used to skip the notification when the queue page was focused, to avoid alerting
  twice. On an iPhone, testing with the app open used up those three pushes, after which
  pushes stopped arriving even with the screen locked, and nothing on the page says so
  (it still reads "alerts on"). Every push must call `showNotification`. OneSignal's worker
  always does; never add a handler to `OneSignalSDKWorker.js` that suppresses one.
- **An iPhone plays the page's alert sound at the media volume, not the ringer.** A
  "silent alert" in testing turned out to be media volume turned down, with the ringer up.
  Check the media volume before debugging.

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

- **e2e runs without OneSignal, so push is always "off" there.** With no
  `NEXT_PUBLIC_ONESIGNAL_APP_ID`, the page treats the browser as having no push: no sheet,
  straight to the keep-this-page-open banner. Contexts still grant `"notifications"` so that a
  run with an App ID set does not block on the sheet. The dev server then logs a
  `MissingEnvError` from `after()` on every alert, which is expected: the sender requires the
  App ID, so that a production deploy without it fails loudly.
- **A busy Mac fails e2e tests that a quiet one passes.** With macOS indexing and updating in the
  background (load average 70–100 on 8 cores), sign-in alone took up to 5 s and every run lost one
  to four tests to timeouts, the same tests passing in isolation. It looked exactly like a
  regression from the change under test. `e2e/global-setup.ts` warns at the start of a run when
  the load is high; heed it. A run can also turn busy partway through (in #34: 2.3 at the start, 72
  when two specs timed out). So every failed test also carries a `machine load` attachment, printed
  under the failure beside its trace: the load when it failed, and `busy` if that was over the
  start-of-run threshold. `e2e/load-reporter.ts` writes it. A `--reporter` flag replaces the
  config's reporters, this one included; pass `--reporter=./e2e/load-reporter.ts,list` to keep it. Compare against `git stash` back to back, or with
  `--workers=1`, rather than against an earlier run. To test whether a failure is a timeout,
  shrink the timeout on a quiet machine (`--testTimeout=800` failed the slowest db test every
  run, in a minute) rather than loading the machine and waiting for a rare red.
- **For a flaky e2e test, read its `trace.zip` before adding any logging.** Playwright keeps one
  per failure (`test-results/<test>/trace.zip`, `trace: "retain-on-failure"`), holding the
  browser console and every network request and response in order. `show-trace` is a GUI, so
  unzip it instead: each line of `*.network` is one request as JSON, its response body in the
  file named by `snapshot.response.content._file`, and console messages are the
  `"type":"console"` lines of `*.trace`. #31 was found by hand-adding `console.log` and
  rerunning twenty times, when the failing run's trace would have shown the `/me` response
  that came back with no Ticket.
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

- **`git push` runs typecheck, lint and the unit and database tests first** (`.githooks/pre-push`,
  about 2 minutes), so it needs local Supabase up and a long command timeout. A failure is a
  real one: fix it rather than reach for `--no-verify`. The db tests run up to six times slower
  on a busy Mac, which is why their timeout is 20 s rather than Vitest's 5 s (`vitest.config.mts`);
  a db test timing out past that is most likely a hang, not the load. A Vitest run writes
  `.test-results/vitest.json`, each test's status, duration and failure message, so read a
  failed push there before rerunning: the next run overwrites it, and a `--reporter` flag
  replaces the report.

- `git diff` can hang on a pager here; use `git --no-pager diff`.
- `until <check>; do sleep; done` stops when the check **succeeds** — easy to invert when
  polling a deploy state.
- `page.reload()` in Playwright re-submits a POST. Poll with `page.goto()` instead.
