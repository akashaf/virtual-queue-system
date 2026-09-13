# Backend Spec: Barbershop Virtual Queue (MVP)

Vocabulary follows [CONTEXT.md](../../CONTEXT.md). Related: [frontend.md](./frontend.md), [third-party.md](./third-party.md), [ADRs](../adr/).

## 1. Scope

In scope for the MVP:
- Customer join, position tracking, leave, rejoin, and the Last Call choice
- The Owner queue operations
- The Operator admin API
- Web Push dispatch
- Scheduled cleanup jobs
- Billing counts

Out of scope: payments, WhatsApp/SMS, multi-shop Owners, Barbers, In-person Customers.

## 2. Architecture

```
Browser (customer / owner)
  │  Server Actions (mutations)      Route Handlers (reads, operator API, cron)
  ▼                                   ▼
Next.js 16 on Netlify (functions region ap-southeast-1) ── after() ──► web-push ──► browser push services
  │  supabase-js (@supabase/ssr)
  ▼
Supabase (ap-southeast-1): Postgres + Auth + Realtime
  │  trigger on tickets ──► realtime.send('queue_changed') ──► subscribed browsers refetch
```

Principles:
- **Every queue rule lives in a Postgres function.** Each function locks the Shop row (`SELECT … FOR UPDATE`) first, so all mutations for one Shop run one at a time. Two simultaneous "Call next" presses therefore call two different Tickets.
- **Next.js is a thin layer.** It authenticates the caller, calls one function, and then uses `after()` to send any push notifications the function returned.
- **Realtime carries no data.** It only sends a "queue changed" ping. Clients refetch their own view from a Route Handler, so names never reach customer browsers.
- **Next 16 conventions apply:**
  - Use `proxy.ts`, not `middleware.ts`
  - `params`, `searchParams`, `cookies()` and `headers()` are async
  - Read `node_modules/next/dist/docs/` before implementing

## 3. Data model

All timestamps are `timestamptz`, stored in UTC. Business-date logic uses `Asia/Kuala_Lumpur`.

### `shops`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| slug | text unique not null | Printed in the QR code, **immutable** after creation. Pattern `^[a-z0-9-]{3,40}$` |
| name | text not null | |
| owner_user_id | uuid unique not null → `auth.users.id` | One Owner per Shop |
| lat, lng | double precision not null | |
| join_radius_m | int not null default 150 | |
| heads_up_threshold | int not null default 3 | Must be ≥ 1 |
| max_queue_size | int not null default 30 | Counts Waiting + Called |
| is_active | boolean not null default true | false = Deactivated Shop |
| joining_state | enum `open` \| `last_call` not null default `open` | |
| current_queue_day_id | uuid → `queue_days.id` | Always set once the Shop is created |
| created_at | timestamptz default now() | |

### `queue_days`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| shop_id | uuid → shops | |
| started_at | timestamptz not null | |
| last_call_at | timestamptz null | |
| closed_at | timestamptz null | null = the current Queue Day |
| next_number | int not null default 1 | Ticket number counter |

### `tickets`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| shop_id | uuid → shops | Denormalised for billing queries |
| queue_day_id | uuid → queue_days | Changes when the Ticket is carried over |
| number | int not null | Unique per `queue_day_id`. Shown to customers as `#017` |
| customer_name | text null | 1–30 characters. Set to null 30 days after `finished_at` (PDPA) |
| device_id | uuid null | From the `vq_device` cookie. Set to null together with the name |
| status | enum `waiting` `called` `served` `no_show` `left` `removed` | |
| origin | enum `scan` \| `rejoin` | |
| parent_ticket_id | uuid null → tickets | The No-show Ticket a Rejoin came from |
| removed_reason | enum `owner` `close_shop` `carry_over_expired` null | |
| last_call_choice | enum `stay` \| `carry` null | |
| carried_over_at | timestamptz null | Non-null = Carried-over Ticket, which can carry over only once |
| heads_up_sent_at | timestamptz null | |
| joined_at | timestamptz not null default now() | |
| called_at, served_at, finished_at | timestamptz null | `finished_at` = when the status became final |

Indexes and constraints:
- `(queue_day_id, number)` unique
- Partial unique index `(shop_id, device_id) WHERE status IN ('waiting','called')` enforces one active Ticket per device per Shop
- `(shop_id, served_at) WHERE status = 'served'` for billing queries

### `push_subscriptions`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| ticket_id | uuid → tickets on delete cascade | |
| endpoint | text unique | |
| p256dh, auth | text | |
| created_at | timestamptz | |

A ticket's subscriptions are deleted when it reaches a final status, except No-show while a Rejoin is still possible. They are also deleted when a push service answers 404 or 410.

### Row Level Security
- Enable RLS on every table.
- **Anonymous role:** no table access and no function execute grants. Customer operations go through Next.js using the service-role client, after the server has read the device cookie.
- **Authenticated role (Owner):** `SELECT` on `shops`, `queue_days` and `tickets` only where `shops.owner_user_id = auth.uid()`. No direct writes. All writes go through `security definer` functions that check `auth.uid()`.

## 4. Ticket state machine

| From | Action | Actor | To | Guard |
|---|---|---|---|---|
| — | Join | Customer | waiting | Shop active, `joining_state = open`, inside Join Radius, queue size < max, no active Ticket on this device |
| no_show | Rejoin | Customer | new Ticket, waiting, `origin = rejoin` | Source `origin = scan`, source is in the current Queue Day, `joining_state = open`, queue not full. **No location check** |
| waiting | Call next | Owner | called | Lowest `number` among Waiting in the current Queue Day |
| called | Done | Owner | served | — |
| served | Undo | Owner | called | `now() - served_at ≤ 2 min` |
| called | No-show | Owner | no_show | `now() - called_at ≥ 5 min` |
| waiting / called | Leave | Customer | left | Device matches |
| waiting / called | Remove | Owner | removed (`owner`) | — |
| waiting | Close Shop | system | removed (`close_shop`) | `last_call_choice ≠ carry`, or it is already a Carried-over Ticket |
| waiting | Close Shop | system | waiting, moved to the new Queue Day | `last_call_choice = carry` and `carried_over_at IS NULL` |
| waiting | daily cron | system | removed (`carry_over_expired`) | `carried_over_at < now() - 3 days` |

Rules:
- **Position** = the number of Waiting Tickets in the same Queue Day with a lower `number`. Called Tickets are not ahead of anyone.
- **Heads-up:** after any mutation, every Waiting Ticket with `position ≤ heads_up_threshold` and `heads_up_sent_at IS NULL` gets `heads_up_sent_at = now()`.
  - Tickets included in the function's return value are sent a push.
  - The exception is the Join call itself: a Ticket that joins already inside the threshold is marked sent without a push, because the customer is looking at the page.

## 5. Postgres functions

All functions are `security definer` with `search_path = ''` and lock the Shop row first. Each returns `{ result, alerts }`. `alerts` is `[{ ticket_id, kind }]`, with `kind ∈ heads_up | called | last_call | shop_closed`, and Next.js dispatches them.

### Customer functions (execute granted to `service_role` only)
- `join_queue(slug, device_id, name, lat, lng, accuracy_m)`
  - Distance is the haversine distance in metres.
  - Accept when `distance ≤ join_radius_m + least(accuracy_m, 100)`.
  - Errors: `shop_inactive`, `last_call`, `too_far`, `queue_full`, `already_in_queue`.
- `rejoin_queue(ticket_id, device_id)`
  - Errors: `not_rejoinable`, `last_call`, `queue_full`.
- `leave_queue(ticket_id, device_id)`
- `choose_last_call(ticket_id, device_id, choice)`
  - Only allowed while `joining_state = last_call` and the Ticket is Waiting.
  - Can be changed until Close Shop.
- `get_customer_view(slug, device_id)` → `{ shop: { name, is_active, joining_state }, ticket: { id, number, status, position, waiting_count, last_call_choice, carried_over, can_rejoin } | null, estimate: { min_minutes, max_minutes } | null }`
  - Never returns other customers' names.

### Owner functions (execute granted to `authenticated`, check that `auth.uid()` owns the Shop)
- `call_next()`: error `queue_empty`
- `mark_served(ticket_id)`, `undo_served(ticket_id)` (error `undo_expired`), `mark_no_show(ticket_id)` (error `too_early`), `remove_ticket(ticket_id)`
- `start_last_call()`
  - Sets `joining_state = last_call` and `queue_days.last_call_at`.
  - Returns a `last_call` alert for every Waiting Ticket.
- `cancel_last_call()`: sets `joining_state = open` and keeps existing choices
- `close_shop()`
  - Error `tickets_still_called` if any Ticket is Called; the Owner must resolve those first.
  - Closes the current Queue Day and creates a new one.
  - Moves carry-choice Tickets to the new Queue Day, numbered 1..k in their original order, with `carried_over_at = now()` and `last_call_choice = null`.
  - Removes the remaining Waiting Tickets, each with a `shop_closed` alert.
  - Resets `joining_state = open`.
- `get_owner_queue()` → the current Queue Day's Waiting and Called Tickets with names, plus Tickets Served within the undo window
- `get_owner_history(days int default 30)` → today's Tickets with statuses and timestamps, plus Served counts per day (Malaysia time) and the month-to-date total

### Estimated Wait (inside `get_customer_view`)
- Take Served Tickets in the current Queue Day ordered by `served_at`.
- If fewer than 5, return null.
- Otherwise `gap` = the median interval between consecutive `served_at` values, using the last 10. This reflects throughput, so it accounts for several chairs working at once.
- `estimate = (position + 1) × gap`, returned as a range of −30% to +30%, rounded to 5 minutes.

### Operator and cron functions (`service_role` only)
- `billing_summary(month text 'YYYY-MM')` → `[{ slug, name, served_count, amount_sen }]`, where `amount_sen = served_count × 25`
  - Month bounds are computed in `Asia/Kuala_Lumpur`.
- `expire_carried_over()` → alerts
- `erase_expired_personal_data()` sets `customer_name` and `device_id` to null, and deletes push subscriptions, where `finished_at < now() - 30 days`
- `revoke_owner_sessions(user_id)` deletes the user's rows from `auth.sessions`. The access JWT stays valid until it expires, so set the JWT expiry to 10 minutes.

## 6. Realtime

- An `AFTER INSERT OR UPDATE` trigger on `tickets` and `shops` calls `realtime.send(jsonb_build_object('at', now()), 'queue_changed', 'shop:' || shop_id, false)`.
- The payload carries **no ticket data**. A public broadcast is acceptable because it reveals only activity timing.
- Clients subscribe to `shop:{shop_id}` and refetch their view when a ping arrives, debounced by 300 ms.
- Clients also poll every 30 s and on `visibilitychange`, because mobile browsers drop sockets in the background.

## 7. Next.js server surface

### Server Actions (mutations)
| Action | Auth | Calls |
|---|---|---|
| `joinQueue(slug, name, coords)` | Device cookie (created here if missing) | `join_queue` |
| `rejoinQueue(ticketId)`, `leaveQueue(ticketId)`, `chooseLastCall(ticketId, choice)` | Device cookie | Matching function |
| `savePushSubscription(ticketId, subscription)` | Device cookie; the Ticket must belong to the device | Upsert into `push_subscriptions` |
| `callNext()`, `markServed(id)`, `undoServed(id)`, `markNoShow(id)`, `removeTicket(id)`, `startLastCall()`, `cancelLastCall()`, `closeShop()` | Supabase session, Shop active | Matching function via the user-JWT client |
| `signIn(email, password)`, `signOut()` | — | Supabase Auth. `signIn` rejects Deactivated Shops |

After a successful call, each action runs `after(() => dispatchAlerts(alerts))`.

Device cookie `vq_device`:
- Random UUID
- `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=34560000` (400 days, the browser maximum)

### Route Handlers (reads, `cache: no-store`)
- `GET /api/s/[slug]/me` → `get_customer_view`
- `GET /api/owner/queue` → `get_owner_queue`
- `GET /api/owner/history` → `get_owner_history`

### Proxy (`proxy.ts`)
- Refreshes the Supabase session cookie using the `@supabase/ssr` pattern.
- Optimistically redirects `/dashboard/*` to `/login` when there is no session.
- The authoritative check, including `is_active`, happens in the dashboard layout and inside every owner function.

### Push dispatch (`lib/push.ts`)
- `dispatchAlerts(alerts)`:
  1. Load the subscriptions for the alerted Tickets.
  2. Send with `web-push`, TTL 10 min for `called` and `heads_up`, 1 h for the others, and urgency `high` for `called`.
  3. Delete subscriptions that return 404 or 410.
  4. Report other failures to Sentry.
- Payload: `{ kind, shopName, number, url: '/s/{slug}' }`. Text is localised in the service worker using the language stored when the customer subscribed.

## 8. Operator admin API

Requests need `Authorization: Bearer <OPERATOR_API_KEY>`, compared in constant time. Missing or wrong key returns 401. Responses are JSON unless stated otherwise.

| Method & path | Body | Effect |
|---|---|---|
| `POST /api/operator/shops` | `{ slug, name, lat, lng, ownerEmail, ownerPassword, joinRadiusM?, headsUpThreshold?, maxQueueSize? }` | Creates the Auth user with `auth.admin.createUser({ email_confirm: true })`, the Shop and its first Queue Day. If the Shop insert fails, deletes the Auth user. Returns the Shop, `queueUrl`, `qrUrl` |
| `GET /api/operator/shops` | — | Lists Shops with owner email, `is_active` and month-to-date Served count |
| `GET /api/operator/shops/[slug]` | — | One Shop |
| `PATCH /api/operator/shops/[slug]` | Any of `{ name, lat, lng, joinRadiusM, headsUpThreshold, maxQueueSize, isActive }` | Updates the Shop. Setting `isActive: false` also calls `revoke_owner_sessions`. The slug cannot be changed |
| `POST /api/operator/shops/[slug]/owner-password` | `{ password }` (≥ 10 characters) | `auth.admin.updateUserById`, then `revoke_owner_sessions` |
| `GET /api/operator/shops/[slug]/qr.png` | — | 1024×1024 PNG with error correction level M, encoding `${APP_BASE_URL}/s/${slug}` |
| `GET /api/operator/billing?month=YYYY-MM` | — | `billing_summary`. Returns `{ month, shops: [...], totalSen }` |

Shops are never deleted; they are deactivated instead.

## 9. Scheduled jobs (Netlify Scheduled Functions)

Netlify Scheduled Functions can't be called by URL in production and have a short execution limit. So the schedule lives in a tiny Netlify function, and the work stays in a Next.js Route Handler that the whole app shares.

`netlify/functions/daily.mts`:
```ts
export default async () => {
  await fetch(`${process.env.URL}/api/cron/daily`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
}
export const config = { schedule: '0 19 * * *' } // 19:00 UTC = 03:00 Malaysia time
```

`POST /api/cron/daily`:
- Verifies `Authorization: Bearer ${CRON_SECRET}` in constant time; returns 401 otherwise. Netlify does **not** add this header automatically, so the scheduled function sends it.
- Runs `expire_carried_over`, dispatches the resulting alerts, then runs `erase_expired_personal_data`.
- Must be idempotent, because a manual "Run now" from the Netlify UI or a retry may call it twice.

## 10. Environment variables

| Name | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Customer and Operator functions |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:`) | public / server | Web Push |
| `OPERATOR_API_KEY` | server | Admin API |
| `CRON_SECRET` | server | Cron route |
| `APP_BASE_URL` | server | QR target, e.g. `https://<project>.vercel.app` |
| `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | client / build | Error tracking |

## 11. Testing

- **Queue rules (Vitest against `supabase start`):** one test file per function covering:
  - Every row of the state machine table, including guards and error codes
  - Concurrent `call_next` from two connections calls two different Tickets
  - A concurrent join at `max_queue_size - 1` admits exactly one
  - Heads-up fires once and not on join inside the threshold
  - Close Shop carry-over renumbering and removal
  - A carried-over Ticket can't carry twice; 3-day expiry
  - Only one Rejoin; Rejoin skips the location check
  - Undo within and after 2 minutes; No-show before and after 5 minutes
  - Join Radius boundaries, including the accuracy tolerance and its 100 m cap
  - Close Shop refused while a Ticket is Called; Last Call cancel keeps choices; Leave while Called; Rejoin refused after Close Shop
  - Billing month boundaries in Malaysia time (a Ticket served at 23:59 MYT on the 31st vs 00:01 on the 1st)
  - Personal-data erasure
  - An Owner can't act on another Shop
- **Admin API:** create, patch, deactivate, password reset, QR response type, 401 without the key.
- **End-to-end:** see [frontend.md](./frontend.md#testing).

## 12. Deferred items and confirmed rules

**Deferred (agreed):**
- Recovering a Ticket after the browser data is cleared (for example a secret ticket link)
- Owner forgot-password by email (needs a custom domain and Resend)
- WhatsApp alerts
- Automated invoicing and payment
- A "+1 served in person" counter
- Barbers
- Multi-shop Owners

**Rules confirmed after the first draft (2026-09-13):**
1. **Close Shop is blocked while any Ticket is Called.** Auto-resolving would either bill an unconfirmed haircut or drop a real one.
2. **Last Call can be cancelled** ("Reopen joining") before Close Shop. Existing stay/next-day choices are kept; a new Last Call can change them.
3. **Carried-over Tickets are renumbered 1..k** in the new Queue Day, in their original order. They are at the front anyway, and keeping old numbers would clash with the new day's numbers.
4. **Join Radius tolerance is `radius + min(accuracy, 100 m)`**, so at most 250 m with the default radius. Indoor GPS is often off by 20–100 m; the cap stops very inaccurate readings passing from far away. Tune per Shop during onboarding.
5. **Leave is allowed while Called**, not only while Waiting, so the Owner frees the chair immediately instead of waiting 5 minutes for No-show.
6. **Rejoin is only offered for a No-show in the current Queue Day.** Otherwise an old No-show would let a Customer join from anywhere, bypassing [ADR 0002](../adr/0002-join-radius-location-check.md).
