# Third-Party Services Spec: Barbershop Virtual Queue (MVP)

Vocabulary follows [CONTEXT.md](../../CONTEXT.md). How each service is used in code is in [backend.md](./backend.md) and [frontend.md](./frontend.md).

> Plan prices and quotas below are what we planned around. **Check them on each vendor's pricing page before launch**, because they change.

## 1. Summary

| Service | Role | Plan at launch | Monthly cost |
|---|---|---|---|
| Netlify | Hosting (Next.js runtime), Server Actions, Route Handlers, Scheduled Functions | **Free plan** until the first paying Shop ([ADR 0003](../adr/0003-netlify-free-plan-until-first-paying-shop.md)). The site is paused if monthly credits run out, which would take every Shop's Queue offline; see [§8](#8-upgrade-triggers) | US$0, then ~US$9 (Personal) or ~US$20 per member (Pro) |
| Supabase | Postgres, Auth (Owners only), Realtime | Free, then Pro when limits are near | US$0, then ~US$25 |
| OneSignal | Web Push: holds subscriptions, sends through the browsers' push services ([ADR 0005](../adr/0005-onesignal-delivers-web-push.md)) | Free plan (10,000 Web Push subscribers per send) | US$0 |
| Sentry | Error tracking for client and server | Free Developer plan | US$0 |
| npm libraries: `@supabase/supabase-js`, `@supabase/ssr`, `server-only`, `react-onesignal`, `qrcode`, `@sentry/nextjs`, shadcn/ui (Radix, with shadcn's `cn` class merger), `sonner` | Code dependencies | Open source | US$0 |
| Dev tooling: Supabase CLI (a devDependency, run with `bunx supabase`), a Docker-compatible runtime such as Colima, Vitest, `pg`, Playwright | Local database, tests | Open source | US$0 |

**Not used in the MVP (deferred):**
- **Resend** or other email: owner forgot-password needs a custom domain first
- **WhatsApp Cloud API:** phase 2 alerts, see [ADR 0001](../adr/0001-web-push-not-whatsapp-for-mvp-alerts.md)
- **Payment gateway:** invoicing is manual for now
- **Custom domain:** QR codes use `*.netlify.app` and will be reprinted when a domain is bought

## 2. Netlify

- **Site setup:**
  - Connect the Git repo. Netlify detects Next.js and applies its Next.js runtime (OpenNext-based) automatically; don't add `@netlify/plugin-nextjs` by hand unless pinning a version.
  - Build command `bun run build`, publish directory `.next`. Netlify detects bun from `bun.lock`.
  - Commit a `netlify.toml` so the settings live in the repo:
    ```toml
    [build]
      command = "bun run build"
      publish = ".next"

    [functions]
      directory = "netlify/functions"
    ```
- **Next.js 16 support:** the Next.js docs say Netlify is building a verified adapter on the new Adapter API and currently uses its own integration. **Verified on 2026-09-14** with a throwaway deploy (details on issue #3): these all work on Netlify, so no fallbacks are needed:
  - Server Actions
  - `proxy.ts`, running on the Node.js runtime
  - `after()`, whose work completes after the response has been sent
- **Node version:** Netlify functions ran **Node 22.14.0** at verification, while local development used Node 26. Production is now pinned to the Node 22 major with `NODE_VERSION` in `netlify.toml`, so a Netlify default bump can't change the runtime under us; Netlify still applies 22.x patch updates. Local development stays on Node 26, so anything version-sensitive must be proven by a deploy, not only locally.
- **Functions region:** **US East (Ohio), `us-east-2`. The Free plan cannot change it** — confirmed on 2026-09-14, when `updateSite` rejected `functions_region` with `422 Unprocessable Entity` for both `ap-southeast-1` and another US region, so this is a plan restriction and not a bad value. Every action therefore pays two trans-Pacific hops (browser in Malaysia → functions in US East → Supabase in Singapore). That is accepted until the upgrade in [§8](#8-upgrade-triggers), see [ADR 0003](../adr/0003-netlify-free-plan-until-first-paying-shop.md). On a paid plan, switch it in *Site configuration → Build & deploy → Functions region* so functions sit next to Supabase `ap-southeast-1`.
- **Domain:** `virtual-queue-system.netlify.app`.
  - This is the host every printed QR code points to, **so never rename the Netlify site**. Renaming changes the subdomain and breaks every printed QR code.
  - Set `APP_BASE_URL` to `https://virtual-queue-system.netlify.app`.
- **Environment variables:** everything in [backend.md §10](./backend.md#10-environment-variables). Set in the **Production** context only, with `netlify env:set NAME value --context production`.
  - **Per-scope variables are a paid feature.** On Free, `--scope` is rejected and every variable applies to all scopes (Builds, Functions, Runtime), so `NEXT_PUBLIC_*` values reach the build as needed without extra configuration. The CLI fails *silently* on `--scope` — it prints nothing and still exits 0 — so always confirm a write with `netlify env:list --context production`.
  - Mark `SUPABASE_SECRET_KEY`, `ONESIGNAL_REST_API_KEY`, `OPERATOR_API_KEY` and `CRON_SECRET` as secret with `--secret`, which does work on Free.
  - **Secret values are write-only:** once set, neither the CLI nor the dashboard can read them back. The Operator needs `OPERATOR_API_KEY` for the Postman runbook in [§7](#7-operator-runbook-onboarding-a-shop), so the generated values are mirrored to a local, gitignored `.env.netlify.production`. That file is the only readable copy — losing it means rotating the key. It is deliberately *not* called `.env.production.local`, a name `next build` loads by itself.
  - Only **Production** is deployed, and it points at the real Supabase project. Deploy Previews and Branch deploys stay disabled (below); if they're ever enabled, give them values for a separate Supabase project.
- **Scheduled Functions:** one function, `netlify/functions/daily.mts`, scheduled `0 19 * * *` (UTC). It only calls `POST /api/cron/daily` with the `CRON_SECRET` header; see [backend.md §9](./backend.md#9-scheduled-jobs-netlify-scheduled-functions). Scheduled functions only run on published production deploys, and can be triggered with *Run now* in the Netlify UI for testing.
- **Function limits:** Netlify functions have a short synchronous execution limit. All queue work is one database call, and pushes go out in parallel with `Promise.allSettled`, so no request should come close to it.
- **Deploy Previews: disabled** (`build_settings.skip_prs = true`), and **branch deploys are limited to `main`**, the production branch (`build_settings.allowed_branches = ["main"]`). A preview wired to real data would expose the Operator API, and password protection isn't available on the Free plan. Production must stay public for customers.

## 3. Supabase

- **Project:** `queue-service`, region `ap-southeast-1` (Singapore), linked to the repo with `bunx supabase link`. All schema, functions, RLS policies and the Realtime trigger are managed as **Supabase CLI migrations** in `supabase/migrations/`, applied with `bunx supabase db push` (needs the database password). Never edit the database directly in the dashboard.
- **Local development:** `bun run db:start` runs the full stack locally in Docker (a Docker-compatible runtime such as Colima is required). Automated tests, including the queue-function tests, **always run against the local stack, never the cloud project**, because they create and delete data and depend on resets.
- **Auth settings:**
  - Email provider on, **public sign-ups disabled**. Owners are created only through the Operator API with `auth.admin.createUser`.
    - In `supabase/config.toml`, block sign-ups with `[auth] enable_signup = false` and keep `[auth.email] enable_signup = true`. The email setting switches the whole email provider, so setting it to false also blocks Owner password sign-in.
  - Email confirmation isn't needed, because created users are pre-confirmed.
  - **JWT expiry: 600 s**, so revoked sessions stop working within 10 minutes.
  - Sessions: refresh tokens keep Owners signed in. Inactivity timeout and time-boxed sessions are Pro-plan settings; turn on a 30-day inactivity timeout after upgrading. Until then sessions last until revoked.
  - The built-in email sender is not used, because it only delivers to project team addresses and is heavily rate limited.
  - `site_url` is `https://virtual-queue-system.netlify.app`.
  - **Phone / SMS sign-in is off.** `GET /auth/v1/settings` on the project reports `"external": { "phone": false }`, alongside `disable_signup: true`, so no account can be created or signed in by phone. Turned off by hand in *Authentication → Sign In / Providers → Phone*.
    - **`supabase config diff` is not a valid check for this.** It keeps reporting `auth.sms.twilio.enabled | remote: true` after phone auth is off, because that key means *Twilio is the selected SMS provider*, not *phone sign-in is on*. Twilio stays selected and inert. The same split is why `config push` "can switch between SMS providers but cannot turn the active one off".
    - Check it with the Auth service instead, which answers for the running system rather than for the config model:
      ```
      curl -sS -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
        https://beolqxlclwhnvmoglgmo.supabase.co/auth/v1/settings
      ```
      `external.phone` is the field that matters. The publishable key is a public value, so this is safe to run anywhere.
  - **Applying auth settings to the cloud project:** `supabase/config.toml` is the local development config, and many of its values (such as `site_url`, redirect URLs, pooler sizes, OTP and email limits) are wrong for production. **Never run `supabase config push` from the repo.** Instead, write a temporary `supabase/config.toml` in a scratch directory that declares only the keys to change, check `bunx supabase config diff --workdir <dir> --project-ref <ref>`, then run `config push` with the same flags; undeclared keys are left unchanged. Without a terminal, `config push` applies changes without asking for confirmation, so always diff first.
- **Realtime:** Broadcast only, sent from Postgres with `realtime.send`, on public topics `shop:{id}`. Postgres Changes is not used, so RLS never has to be evaluated per subscriber.
- **Keys:** the project uses Supabase's **publishable / secret** API keys. The legacy `anon` and `service_role` JWT keys are **deactivated** (Supabase deprecates them by the end of 2026), see [ADR 0004](../adr/0004-publishable-and-secret-supabase-api-keys.md).
  - The publishable key (`sb_publishable_…`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) goes to browsers. It acts as the `anon` Postgres role, so it can only open Realtime and Auth and has no table or function grants.
  - The secret key (`sb_secret_…`, `SUPABASE_SECRET_KEY`) stays on the server. It acts as the `service_role` Postgres role and bypasses RLS. It is named `netlify_production` in the dashboard, so it can be revoked on its own.
  - The Postgres role names are unchanged: migrations still grant to `anon`, `authenticated` and `service_role`.
  - Both key types can be live at once, so a future rotation is: create the new key, set it in Netlify, rebuild, verify, then revoke the old one. Reading a secret key back is impossible after creation in Netlify, so verify by exercising a route that uses it.
  - **User access tokens are signed by an asymmetric JWT signing key** — ES256, `kid 0b23a31e-9f81-4b48-b429-679fbe2d0abc`. The legacy shared JWT secret is no longer the signing key, so rotating is now zero-downtime: publish the replacement, let the retired key verify until its tokens expire (600 s), then revoke.
    - **The JWKS endpoint cannot tell you whether this is done.** `GET /auth/v1/.well-known/jwks.json` publishes keys that *verify*, and a shared HS256 secret can never appear there, so a project mid-migration — asymmetric key on standby, legacy secret still signing — looks exactly like a migrated one. Check *Authentication → JWT Keys* for which key is marked **Current key**, or decode an access token and read its `alg` and `kid`; those are the only answers that distinguish the two.
- **Backups:** the free tier has no downloadable backups. Before charging real money, schedule a weekly `supabase db dump` into a private store, or upgrade to Pro, which has daily backups.

### Free-tier limits to watch

| Limit | Free | What uses it | Action when near |
|---|---|---|---|
| Pauses after 7 days with no activity | yes | Shops idle for a week | Upgrade to Pro before launch with real shops. Until then the daily cron keeps it active |
| Database size | 500 MB | Tickets (~1 KB each with indexes) | Around 400k Tickets. Far away |
| Realtime concurrent connections | 200 | Each open customer or owner page | ≈ 30 Shops × (queue of 6 + 1 owner device). Upgrade to Pro past ~150 peak |
| Realtime messages | 2 million per month | One ping per Ticket change × subscribers | Watch in the dashboard |
| Egress | 5 GB | Refetches every 30 s | Increase the poll interval if needed |

## 4. Web Push

- **Vendor:** OneSignal, set up the standard way for a website with custom code ([ADR 0005](../adr/0005-onesignal-delivers-web-push.md)).
  - **Dashboard setup, done once:** create an app, add the Web platform with *Custom Code*, site URL `https://virtual-queue-system.netlify.app`, and no prompts (the page asks through its own sheet). OneSignal generates and keeps the VAPID keys.
  - `NEXT_PUBLIC_ONESIGNAL_APP_ID` is the App ID (public). `ONESIGNAL_REST_API_KEY` is an App API key, a secret: add it in the Netlify UI by hand, never through an agent.
  - The SDK registers `public/OneSignalSDKWorker.js` at the site root.
  - **Free plan limits:** Confirmed Delivery is paid-only, and not available for Safari on any plan, so for iPhones the dashboard shows sent and clicked, not delivered. `push_sends` (backend.md §3) is our own record of every send.
- **Support matrix (the reason ADR 0001 exists):**

| Platform | Push when page closed | Our fallback |
|---|---|---|
| Android Chrome, Samsung Internet | Yes | — |
| Desktop Chrome, Edge, Firefox | Yes | — |
| iOS / iPadOS Safari in a normal tab | **No**: push only works for web apps added to the Home Screen (iOS 16.4+) | In-page chime, title flash and wake lock; customer keeps the page open |
| In-app webviews (Instagram, TikTok, etc.) | No | "Open in browser" banner |

- **Operational rules:**
  - Send by External ID (the Ticket id). OneSignal drops subscriptions the push service reports gone. The nightly job deletes a Ticket's OneSignal user 30 days after it finishes (PDPA).
  - TTL 600 s for `heads_up` and `called`, so a late alert isn't delivered after it's useless.

## 5. Sentry

- **SDK:** `@sentry/nextjs`, set up through `instrumentation.ts` and `instrumentation-client.ts`, with `app/global-error.tsx` reporting render errors the SDK's global handlers never see. Every `Sentry.init` takes its options from `lib/error-reporting.ts`. Upload source maps at build time with `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`; a build without the token skips the upload, and a runtime without `NEXT_PUBLIC_SENTRY_DSN` sends nothing.
- **Capture:**
  - Unhandled errors
  - Push send failures (OneSignal refusing or unreachable), with the status code only
  - Unexpected function errors (anything not in the known error-code list), through `functionErrorReason`, which passes known codes through unreported. It leaves out the error's `details`, which Postgres fills with the failing row
  - Geolocation timeouts, as breadcrumbs only
  - Content-Security-Policy violation reports, sent by the browser itself ([§9](#9-content-security-policy))
- **Privacy:**
  - `sendDefaultPii: false`
  - Scrub `customer_name` and any `lat`/`lng`, and their `p_`-prefixed function arguments, from events and breadcrumbs by key
  - No session replay in the MVP
- **Alert rule:** email the Operator on any new issue in production.

## 6. QR codes

- Generated server-side with the `qrcode` npm package at `GET /api/operator/shops/[slug]/qr.png`. No external QR service.
- Content: `https://virtual-queue-system.netlify.app/s/<slug>`. PNG, 1024 px, error correction M, 4-module quiet zone.
- The Operator designs the printed poster separately, for example in Canva. Test-scan the printed poster with an iPhone Camera and an Android Camera before handing it over.

## 7. Operator runbook: onboarding a Shop

1. Get the shop's coordinates: long-press the shop in Google Maps and copy the lat,lng.
2. Postman: `POST /api/operator/shops` with slug, name, lat, lng, owner email and a generated password.
3. Postman: `GET /api/operator/shops/{slug}/qr.png`, save it, and put it in the poster.
4. Stand inside the shop and join the queue from a phone to confirm the Join Radius. If needed, adjust `joinRadiusM` with `PATCH`.
5. Give the Owner their login and a one-page guide: Call next → Done → Last Call → Close Shop.
6. Monthly: `GET /api/operator/billing?month=YYYY-MM`, then send each Owner their amount (Served × RM0.25) for payment by DuitNow or bank transfer.

## 8. Upgrade triggers

| Trigger | Change |
|---|---|
| First paying Shop goes live | Move from the Netlify Free plan to a paid plan, so the site can't be paused for running out of credits and the functions region can be set to Singapore ([ADR 0003](../adr/0003-netlify-free-plan-until-first-paying-shop.md)). Supabase Pro strongly recommended (no pausing, backups, session timeouts) |
| Netlify credit usage passes ~70% mid-month (check the Netlify usage page regularly while on Free) | Upgrade to a paid Netlify plan before the site is paused |
| Buy a domain | Add it to Netlify, reprint QR codes, add Resend with DNS records, enable owner forgot-password |
| Owners report missed alerts on iPhone | Phase 2: WhatsApp Cloud API (needs Meta Business verification, customer phone numbers and a per-message cost, to be weighed against RM0.25) |
| More than ~20 Shops or manual invoicing is painful | Phase 2: automated invoicing and a payment gateway |

## 9. Content-Security-Policy

The Owner's Sign-in tokens are in cookies page scripts can read, because the Supabase browser client needs them for Realtime. The policy is there so that a script we did not ship cannot run and copy them.

- **Report-only first.** Every page is sent `Content-Security-Policy-Report-Only`, and no enforcing `Content-Security-Policy`, so browsers report what the policy *would* block without blocking anything. After a week of reports, the Owner pastes them from Sentry into #36 and someone reads them, allows any real source the policy forgot, and ignores the noise (browser extensions, injected ad scripts). Then **#36, "Enforce the Content-Security-Policy"**, renames the header to the enforcing one. Report-only went out with #35.
- **Where it is set:** `proxy.ts`, from `cspHeaders` in `lib/csp.ts`. Route Handlers get none: those outside the proxy matcher (health, cron, operator, the QR code, anything with a file extension) never pass through it, and the proxy skips `/api/` for the rest, which answer with JSON.
- **The policy** is in `lib/csp.ts`, with the reasons for its sources beside them. It allows our own origin, Supabase's API and Realtime, Sentry, and OneSignal. A script runs only if it carries this request's nonce, or a script that does loaded it (`'strict-dynamic'`, which is how OneSignal's SDK arrives); any other script is reported. Inline styles stay allowed: Radix, sonner and React style props need them, and styles cannot read cookies.
- **Nonces need per-request rendering.** The root layout reads the request headers, so no page is prerendered; `next build` lists every route as dynamic (`ƒ`). A prerendered page would carry a stale nonce.
- **Reports go to Sentry**, to the project's security endpoint built from `NEXT_PUBLIC_SENTRY_DSN` (`https://<host>/api/<project>/security/?sentry_key=<public key>`): `report-to` with a `Reporting-Endpoints` header for Chromium, `report-uri` for Safari and Firefox. Without a DSN nothing is reported, as with errors.
- **Tested** by `lib/csp.test.ts`, by `e2e/csp.spec.ts` for the headers each route gets, and by every e2e test: the `test` in `e2e/helpers.ts` fails any test whose pages raise a violation, and ESLint makes specs import it. e2e has no OneSignal App ID or Sentry DSN, so push sign-up and report delivery are only checked in production, during the report-only week.
