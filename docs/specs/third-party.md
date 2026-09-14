# Third-Party Services Spec: Barbershop Virtual Queue (MVP)

Vocabulary follows [CONTEXT.md](../../CONTEXT.md). How each service is used in code is in [backend.md](./backend.md) and [frontend.md](./frontend.md).

> Plan prices and quotas below are what we planned around. **Check them on each vendor's pricing page before launch**, because they change.

## 1. Summary

| Service | Role | Plan at launch | Monthly cost |
|---|---|---|---|
| Netlify | Hosting (Next.js runtime), Server Actions, Route Handlers, Scheduled Functions | **Free plan** until the first paying Shop ([ADR 0003](../adr/0003-netlify-free-plan-until-first-paying-shop.md)). The site is paused if monthly credits run out, which would take every Shop's Queue offline; see [§8](#8-upgrade-triggers) | US$0, then ~US$9 (Personal) or ~US$20 per member (Pro) |
| Supabase | Postgres, Auth (Owners only), Realtime | Free, then Pro when limits are near | US$0, then ~US$25 |
| Browser push services (FCM for Chrome/Android, Mozilla Autopush, Apple Push for installed web apps) | Deliver Web Push | No account needed; uses the VAPID keys we generate | US$0 |
| Sentry | Error tracking for client and server | Free Developer plan | US$0 |
| npm libraries: `@supabase/supabase-js`, `@supabase/ssr`, `server-only`, `web-push`, `qrcode`, `@sentry/nextjs`, shadcn/ui (Radix, with shadcn's `cn` class merger), `sonner` | Code dependencies | Open source | US$0 |
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
  - Mark `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`, `OPERATOR_API_KEY` and `CRON_SECRET` as secret with `--secret`, which does work on Free.
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
  - **Phone / SMS sign-in is not used.** `auth.sms.enable_signup` is already `false` in the cloud project, so nobody can sign up by phone. The Twilio provider itself is still switched on (`auth.sms.twilio.enabled = true`); `config push` reports it as *unencodable* — it can switch between SMS providers but cannot turn the active one off — so it has to be switched off by hand in *Authentication → Sign In / Providers → Phone*.
  - **Applying auth settings to the cloud project:** `supabase/config.toml` is the local development config, and many of its values (such as `site_url`, redirect URLs, pooler sizes, OTP and email limits) are wrong for production. **Never run `supabase config push` from the repo.** Instead, write a temporary `supabase/config.toml` in a scratch directory that declares only the keys to change, check `bunx supabase config diff --workdir <dir> --project-ref <ref>`, then run `config push` with the same flags; undeclared keys are left unchanged. Without a terminal, `config push` applies changes without asking for confirmation, so always diff first.
- **Realtime:** Broadcast only, sent from Postgres with `realtime.send`, on public topics `shop:{id}`. Postgres Changes is not used, so RLS never has to be evaluated per subscriber.
- **Keys:**
  - The anon key goes to browsers. It can only open Realtime and Auth, and has no table or function grants.
  - The service role key stays on the server.
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

- **Standard:** the Push API with VAPID. No vendor account; the browser picks its own push service.
- **Key generation, done once:** `bunx web-push generate-vapid-keys`.
  - Store the public key in `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, the private key in `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT=mailto:<operator email>`.
  - **Rotating these keys invalidates every existing subscription.**
- **Support matrix (the reason ADR 0001 exists):**

| Platform | Push when page closed | Our fallback |
|---|---|---|
| Android Chrome, Samsung Internet | Yes | — |
| Desktop Chrome, Edge, Firefox | Yes | — |
| iOS / iPadOS Safari in a normal tab | **No**: push only works for web apps added to the Home Screen (iOS 16.4+) | In-page chime, title flash and wake lock; customer keeps the page open |
| In-app webviews (Instagram, TikTok, etc.) | No | "Open in browser" banner |

- **Operational rules:**
  - Delete a subscription when the push service answers 404 or 410.
  - Payload limit is about 4 KB; ours is under 300 bytes.
  - TTL 600 s for `heads_up` and `called`, so a late alert isn't delivered after it's useless.

## 5. Sentry

- **SDK:** `@sentry/nextjs`, set up through `instrumentation.ts` and `instrumentation-client.ts`. Upload source maps at build time with `SENTRY_AUTH_TOKEN`.
- **Capture:**
  - Unhandled errors
  - Push send failures other than 404 and 410
  - Unexpected function errors (anything not in the known error-code list)
  - Geolocation timeouts, as breadcrumbs only
- **Privacy:**
  - `sendDefaultPii: false`
  - Scrub `customer_name` and any `lat`/`lng`
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
