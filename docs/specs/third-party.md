# Third-Party Services Spec: Barbershop Virtual Queue (MVP)

Vocabulary follows [CONTEXT.md](../../CONTEXT.md). How each service is used in code is in [backend.md](./backend.md) and [frontend.md](./frontend.md).

> Plan prices and quotas below are what we planned around. **Check them on each vendor's pricing page before launch**, because they change.

## 1. Summary

| Service | Role | Plan at launch | Monthly cost |
|---|---|---|---|
| Netlify | Hosting (Next.js runtime), Server Actions, Route Handlers, Scheduled Functions | **Paid plan** (Personal or Pro): on the credit-based Free plan the site is paused when monthly credits run out, which would take every Shop's queue offline | ~US$9 (Personal) or ~US$20 per member (Pro) |
| Supabase | Postgres, Auth (Owners only), Realtime | Free, then Pro when limits are near | US$0, then ~US$25 |
| Browser push services (FCM for Chrome/Android, Mozilla Autopush, Apple Push for installed web apps) | Deliver Web Push | No account needed; uses the VAPID keys we generate | US$0 |
| Sentry | Error tracking for client and server | Free Developer plan | US$0 |
| npm libraries: `@supabase/supabase-js`, `@supabase/ssr`, `web-push`, `qrcode`, `@sentry/nextjs`, shadcn/ui (Radix), `sonner` | Code dependencies | Open source | US$0 |
| Dev tooling: Supabase CLI, Vitest, Playwright | Local database, tests | Open source | US$0 |

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
- **Next.js 16 support:** the Next.js docs say Netlify is building a verified adapter on the new Adapter API and currently uses its own integration. **Before writing features, deploy the empty app and confirm it builds and runs on Next 16.** Specifically test these three features, each of which has a fallback in [backend.md](./backend.md):
  - Server Actions
  - `proxy.ts` (Node.js runtime)
  - `after()`
- **Functions region:** Netlify runs functions in US East (Ohio) by default. Switch to **Asia Pacific (Singapore)** in *Site configuration → Build & deploy → Functions region* so functions sit next to Supabase `ap-southeast-1` and Malaysian customers. Check that your plan allows changing it. If it doesn't, every action pays two trans-Pacific hops (browser → US → Singapore database), so choose a plan that does.
- **Domain:** `<site-name>.netlify.app`.
  - This is the host every printed QR code points to, **so never rename the Netlify site**. Renaming changes the subdomain and breaks every printed QR code.
  - Set `APP_BASE_URL` to it.
- **Environment variables:** everything in [backend.md §10](./backend.md#10-environment-variables).
  - Set them under *Site configuration → Environment variables* with the **Functions** and **Runtime** scopes (the `NEXT_PUBLIC_*` values also need **Builds**).
  - Mark `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`, `OPERATOR_API_KEY` and `CRON_SECRET` as secret values where the plan supports it.
  - Use per-context values: **Production** points at the real Supabase project; **Deploy Previews** and **Branch deploys** point at a separate Supabase project, or aren't enabled.
- **Scheduled Functions:** one function, `netlify/functions/daily.mts`, scheduled `0 19 * * *` (UTC). It only calls `POST /api/cron/daily` with the `CRON_SECRET` header; see [backend.md §9](./backend.md#9-scheduled-jobs-netlify-scheduled-functions). Scheduled functions only run on published production deploys, and can be triggered with *Run now* in the Netlify UI for testing.
- **Function limits:** Netlify functions have a short synchronous execution limit. All queue work is one database call, and pushes go out in parallel with `Promise.allSettled`, so no request should come close to it.
- **Deploy Previews:** public by default. Either turn on password protection (plan-dependent) or disable Deploy Previews, because a preview wired to real data would expose the Operator API. Production must stay public for customers.

## 3. Supabase

- **Project:** region `ap-southeast-1` (Singapore). All schema, functions, RLS policies and the Realtime trigger are managed as **Supabase CLI migrations** in `supabase/migrations/`. Never edit the database directly in the dashboard.
- **Auth settings:**
  - Email provider on, **public sign-ups disabled**. Owners are created only through the Operator API with `auth.admin.createUser`.
  - Email confirmation isn't needed, because created users are pre-confirmed.
  - **JWT expiry: 600 s**, so revoked sessions stop working within 10 minutes.
  - Sessions: refresh tokens keep Owners signed in. Inactivity timeout and time-boxed sessions are Pro-plan settings; turn on a 30-day inactivity timeout after upgrading. Until then sessions last until revoked.
  - The built-in email sender is not used, because it only delivers to project team addresses and is heavily rate limited.
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
- Content: `https://<site-name>.netlify.app/s/<slug>`. PNG, 1024 px, error correction M, 4-module quiet zone.
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
| First paying Shop goes live | Netlify paid plan (so the site can't be paused for running out of credits, and the functions region can be set to Singapore). Supabase Pro strongly recommended (no pausing, backups, session timeouts) |
| Netlify credit usage passes ~70% mid-month | Move up a Netlify plan or add credits before the site is paused |
| Buy a domain | Add it to Netlify, reprint QR codes, add Resend with DNS records, enable owner forgot-password |
| Owners report missed alerts on iPhone | Phase 2: WhatsApp Cloud API (needs Meta Business verification, customer phone numbers and a per-message cost, to be weighed against RM0.25) |
| More than ~20 Shops or manual invoicing is painful | Phase 2: automated invoicing and a payment gateway |
