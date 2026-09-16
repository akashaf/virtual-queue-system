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
Next.js 16 on Netlify (Free plan; functions region us-east-2, Singapore is paid-only) ── after() ──► web-push ──► browser push services
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
| customer_name | text null | 1–30 characters, counted as Postgres `length()` does — an emoji is one, not the two that `String.length` sees. Set to null 30 days after `finished_at` (PDPA) |
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
- `shops.name` must not be blank
- Partial unique index on `queue_days (shop_id) WHERE closed_at IS NULL`: a Shop has exactly one Queue Day open at a time. Close Shop must therefore close the current Queue Day before opening the next one, not after
- `(queue_day_id, number)` unique
- Partial unique index `(shop_id, device_id) WHERE status IN ('waiting','called')` enforces one active Ticket per device per Shop. Scoped to the Shop rather than the Queue Day, so a Ticket left open across a Close Shop still blocks a second one. A null `device_id`, which is what erasure leaves behind, never collides
- Partial index `(queue_day_id, number) WHERE status = 'waiting'` serves both numbers a Customer sees: their position and the waiting count
- `(shop_id, served_at) WHERE status = 'served'` for billing queries
- `(queue_day_id, device_id, joined_at desc)` finds the Ticket a device last took in a Queue Day, which is what `get_customer_view` answers with
- `tickets.customer_name` is null or 1-30 characters; `tickets.number` is at least 1

### `push_subscriptions`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| ticket_id | uuid → tickets on delete cascade | |
| endpoint | text unique | |
| p256dh, auth | text | |
| created_at | timestamptz | |

A ticket's subscriptions are deleted when it reaches a final status, except No-show while a Rejoin is still possible. They are also deleted when a push service answers 404 or 410. Close Shop is the one ending that alerts the Tickets it finishes, so `close_shop` leaves their subscriptions in place and the dispatcher deletes them after sending the `shop_closed` push — deleting inside the function would silence the very alert it returns.

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
| served | Undo | Owner | called | `now() - served_at ≤ 2 min`, and the device holds no newer active Ticket |
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

All functions are `security definer` with `search_path = ''` and lock the Shop row first. Each returns `{ result, alerts }`. `alerts` is `[{ ticket_id, kind }]`, with `kind ∈ heads_up | called | last_call | shop_closed`, and Next.js dispatches them. The read-only `get_*` functions are the exception: they return their view directly, because there is nothing to alert about.

**Refusals are raised, not returned.** A rule a Customer or Owner has run into is `raise exception '<token>'`, which reaches supabase-js as `{ code: 'P0001', message: '<token>' }`. The tokens are the ones listed per function below, and TypeScript switches on them (`lib/customer/view.ts`); any other message is a bug rather than a situation, and is logged as one. Constraint violations keep their own SQLSTATE, so a name that is too long is a `23514` and not a token.

Some helpers are never called from outside the database, and are revoked from every role including `service_role`:
- `haversine_m(lat_a, lng_a, lat_b, lng_b)` — metres between two points on a sphere of radius 6371 km.
- `customer_view_json(shop, ticket)` — builds the payload below. Shared by `get_customer_view` and `join_queue`, so a join and the refetch that follows it cannot disagree.
- `lock_owner_shop()` — the caller's Shop, locked, or `shop_inactive`. The first line of every owner mutation.
- `lock_ticket_shop(ticket_id)` — the Shop a Ticket belongs to, locked, or a null row. The same first line for the two mutations a Customer makes, which name a Ticket rather than a Shop. It answers with a null row rather than raising, because Leave and Rejoin each have their own word for a Ticket they cannot act on.
- `owner_ticket(shop, ticket_id, statuses[])` — one of the caller's Tickets in one of the expected statuses, or `ticket_not_found`. Takes an array because Remove accepts a Ticket from the Queue and from the chair alike.
- `add_ticket(shop, name, device_id, origin, parent_ticket_id?)` — the part Join and Rejoin do identically: check the Queue's size (`queue_full`), take the next number, stamp `heads_up_sent_at` on a Ticket that arrives already inside the threshold, insert. How the Customer earned the place — a location check for a scan, a No-show to come back from for a Rejoin — stays with the caller. The Shop must already be locked, which is what makes the size check safe against a simultaneous join.
- `no_show_window()`, `ticket_ref_json(ticket)` — the 5 minutes, and the `{ id, number }` an Owner's screen gets back from an ending.
- `called_ticket_json(ticket)`, `served_ticket_json(ticket)` — one Ticket as the Owner's screen shows it, shared by the mutations and `get_owner_queue` so a press and the refetch after it cannot disagree.
- `undo_window()` — the 2 minutes, in one place, so `undo_served` and `get_owner_queue` cannot drift apart.
- `broadcast_queue_changed()` — the trigger function behind [§6](#6-realtime).
- `stamp_heads_ups(shop)` — the §4 Heads-up rule in one place: stamps every Waiting Ticket inside the threshold that has not been told, and returns them as `heads_up` alerts. The last thing every mutation does, including the ones that move nobody up, so a Ticket owed a Heads-up for any reason — a threshold raised under it — is told by the very next press. A joining Ticket is never among them, because `add_ticket` has already stamped it. `close_shop` is the one exception (#11): the carried Tickets sit at the front of the new day, and stamping at closing time would push "almost your turn" to people who just chose to come back tomorrow — the new day's first mutation tells whoever is owed one. A carried Ticket keeps its `heads_up_sent_at` for the same reason the Heads-up is one-time per Ticket (CONTEXT.md): one already told is not told again tomorrow.

### Customer functions (execute granted to `service_role` only)
- `join_queue(slug, device_id, name, lat, lng, accuracy_m)` → `{ result: <the customer view below>, alerts }`. A join moves nobody up, so its alerts are only ever Heads-ups an earlier change left owed — never the joining Ticket
  - Distance is the haversine distance in metres.
  - Accept when `distance ≤ join_radius_m + least(greatest(accuracy_m, 0), 100)`.
  - Checked in this order: `shop_inactive`, `last_call`, `already_in_queue`, `too_far`, `queue_full`. The Join Radius comes before the queue size deliberately — "check back soon" is the wrong thing to tell someone who is not at the Shop at all.
  - A slug no Shop has raises `shop_inactive` too. A printed QR code outlives the Shop it was printed for, and a Customer holding an old one needs the same answer either way.
  - A Ticket that joins already inside the Heads-up Threshold gets `heads_up_sent_at = now()` and no alert, per §4: the Customer is looking at the page that is about to tell them how many are ahead, and marking it is what stops the next mutation alerting them for nothing. The threshold is measured against the Queue only, so Called Tickets do not push a new joiner out of it.
  - A null or blank name is refused as a `23514`, the same as one over 30 characters. The column itself allows null, because erasure leaves one behind.
- `rejoin_queue(ticket_id, device_id)` → the customer view
  - The source must be a No-show, `origin = scan`, in the Shop's **current** Queue Day, held by this device, and not already rejoined from. Everything else is `not_rejoinable`, so an old Ticket can never become a way in from anywhere (§12 rule 6).
  - Takes the new Ticket's name from the source, so the Customer is not asked again, and stamps `heads_up_sent_at` on a Ticket that rejoins already inside the threshold, exactly as `join_queue` does.
  - Errors: `shop_inactive`, `last_call`, `not_rejoinable`, `already_in_queue`, `queue_full`. `already_in_queue` covers the Customer who scanned again rather than waiting for the button, which would otherwise be a `23505` from the one-active-Ticket index.
- `leave_queue(ticket_id, device_id)` → the customer view
  - Allowed from the chair as well as from the Queue (§12 rule 5).
  - Errors: `ticket_not_found`, which is also what a Ticket belonging to another device gets: the device id is part of the lookup, not a check after it.
- `choose_last_call(ticket_id, device_id, choice)` → the customer view
  - Only allowed while `joining_state = last_call` and the Ticket is Waiting.
  - Can be changed until Close Shop.
  - Errors: `not_last_call` outside Last Call — the Owner reopened or closed just as the Customer tapped — and `ticket_not_found`, which covers another device's Ticket and one no longer Waiting alike.
- `get_customer_view(slug, device_id)` → `{ shop: { id, name, is_active, joining_state, waiting_count, heads_up_threshold }, ticket: { id, number, status, position, last_call_choice, carried_over, removed_reason, can_rejoin } | null, estimate: { min_minutes, max_minutes } | null }`
  - Never returns other customers' names, and never the rest of the Queue.
  - `waiting_count` belongs to the Shop rather than to the Ticket, because the join form shows it before there is a Ticket to hang it on.
  - `heads_up_threshold` is what the page shows "Head back to the shop now" against, and what it watches a Ticket cross to decide when to chime (frontend.md §3.3). A Shop setting, so it tells the browser nothing about anyone else.
  - `shop.id` is the `shop:{id}` topic the page subscribes to ([§6](#6-realtime)); a Customer cannot listen for their own Shop without it. Nothing is authorised by it: the topic is public and carries no data, and every read still comes back through this function with the device cookie.
  - `position` is the number of Waiting Tickets with a lower number, and is `0` for any other status: a Called Ticket is in a chair and a finished one is out of the Queue altogether, so counting past them would report somebody else's wait
  - `ticket` is the last Ticket this device took in the Shop's **current Queue Day**, whatever became of it — not only an active one. #7 changed this: No-show, Removed and Served are three different screens, and a page that only ever sees a Ticket disappear cannot tell them apart. `can_rejoin` needs it too, being a property of a No-show.
  - Scoped to the current Queue Day, so a Customer returning tomorrow meets the join form. Which ending has already been *read* is the browser's business, and stays in `sessionStorage` (frontend.md §3.1).
  - One exception to that scope: when the current day holds nothing for the device, a Ticket that Close Shop removed is looked for in a day closed within the last 6 hours. Close Shop moves the whole day into the past at once, so without this the one ending a Customer is owed *tonight* — "shop closed, come back tomorrow" — would vanish with it. Time-boxed because a Customer who does come back tomorrow must meet the join form, not last night's goodbye. `removed_reason` is what lets the page tell that goodbye apart from the Owner's Remove.
  - `can_rejoin` is the whole of the Rejoin offer: a No-show, from a scan, in today's Queue Day, not already rejoined from. The Shop-level reasons a Rejoin can still fail — Last Call, a full Queue — are deliberately left out, because they change from moment to moment and `rejoin_queue` answers them with a token the page can put into words.
  - Returns SQL `null` for a slug no Shop has, so the page can show a missing Shop and a Deactivated Shop the same way.
  - Delivered so far (#11): everything above but `estimate`, which arrives with #12.

### Owner functions (execute granted to `authenticated`, check that `auth.uid()` owns the Shop)
- `call_next()`: error `queue_empty`. Moves the lowest-numbered Waiting Ticket in the current Queue Day to Called. Separate from marking one Served, so several may be Called at once. Its alerts are a `called` alert for that Ticket, then the Heads-ups the Tickets behind are now owed
  - `undo_served` sends no second `called` alert: the Customer was told once, and is in the chair
- `mark_served(ticket_id)`, `undo_served(ticket_id)` (errors `undo_expired`, `rejoined`), `mark_no_show(ticket_id)` (error `too_early`), `remove_ticket(ticket_id)`
  - `mark_no_show` waits the full five minutes from `called_at`; the Customer may be walking over, and a No-show is final. It frees the device, which is what makes a Rejoin possible
  - `remove_ticket` takes a Ticket from the Queue or the chair alike, with `removed_reason = owner`
  - `rejoined`: Done frees the device, so the Customer may already hold a new Ticket. Putting the old one back would give them two active Tickets, which the one-active-Ticket-per-device index refuses — and a raw `23505` is no way to tell an Owner that the person in front of them is queueing again
- Every owner function raises `shop_inactive` when the caller runs no active Shop, because each one starts by locking their Shop
- Every function that names a Ticket raises `ticket_not_found` when it is not one of the caller's, is not in their current Queue Day, or is no longer in a status the action accepts. One token for all three: an Owner learns nothing about another Shop's Queue, and a stale button on their own screen is told the same true thing — that Ticket is not one they can act on now
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
- `get_owner_queue()` → `{ shop: { id, name, joining_state }, waiting: [{ id, number, name, joined_at, origin, last_call_choice, carried_over }], called: [{ id, number, name, called_at, no_show_in_ms }], just_served: [{ id, number, name, undo_expires_in_ms }] }` for the current Queue Day
  - `origin` is what the dashboard's "Rejoined" badge reads: the Ticket is at the back with a high number, but its Customer has been in the shop a while
  - `last_call_choice` and `carried_over` (#11) feed the Waiting rows' badges, and the Close Shop confirmation counts them the way `close_shop` will act: only an unspent carry choice moves
  - `no_show_in_ms` counts down to when No-show is allowed, measured by the database for the same reason `undo_expires_in_ms` is — a tablet with a wrong clock must not offer a button the function would answer `too_early`
  - `just_served` is the Tickets Served within the Undo window, most recent first, each also carrying the `called_at` and `no_show_in_ms` of the call it came from. It is what makes the Undo survive a reload and appear on the Shop's other phone — and `undo_served` leaves `called_at` alone, so the screen has to be able to put the Customer back in the chair they were already in rather than starting their clock again
  - `undo_expires_in_ms` is measured by the database rather than by the screen, so a tablet with a wrong clock cannot offer an Undo that `undo_served` would then refuse. The screen counts it down on its own clock from the moment it arrives
  - Takes no Shop argument: it finds the Shop from `auth.uid()`, so a request cannot name one.
  - Raises `shop_inactive` when the caller runs no active Shop. The dashboard treats that as a state, not a failure — a layout and its page render at the same time, so the page cannot lean on the layout's redirect having happened first.
  - Delivered so far (#7): all four keys.
- `get_owner_history(days int default 30)` → today's Tickets with statuses and timestamps, plus Served counts per day (Malaysia time) and the month-to-date total

### Estimated Wait (inside `get_customer_view`)
- Take Served Tickets in the current Queue Day ordered by `served_at`.
- If fewer than 5, return null.
- Otherwise `gap` = the median interval between consecutive `served_at` values, using the last 10. This reflects throughput, so it accounts for several chairs working at once.
- `estimate = (position + 1) × gap`, returned as a range of −30% to +30%, rounded to 5 minutes.

### Operator and cron functions (`service_role` only)
- `create_shop(slug, name, owner_user_id, lat, lng, join_radius_m?, heads_up_threshold?, max_queue_size?)` → the Shop
  - Inserts the Shop and opens its first Queue Day in one transaction, so a Shop can never exist without a current Queue Day.
  - Omitted settings take the column defaults, which are written down only in the schema.
  - The Owner's Auth user has to exist first, and lives outside this transaction: see [§8](#8-operator-admin-api).
- `billing_summary(month text 'YYYY-MM')` → `[{ slug, name, served_count, amount_sen }]`, where `amount_sen = served_count × 25`
  - Month bounds are computed in `Asia/Kuala_Lumpur`.
- `expire_carried_over()` → alerts
- `erase_expired_personal_data()` sets `customer_name` and `device_id` to null, and deletes push subscriptions, where `finished_at < now() - 30 days`
- `revoke_owner_sessions(user_id)` deletes the user's rows from `auth.sessions`. The access JWT stays valid until it expires, so set the JWT expiry to 10 minutes.

## 6. Realtime

- An `AFTER INSERT OR UPDATE` trigger on `tickets` and `shops` calls `realtime.send(jsonb_build_object('at', now()), 'queue_changed', 'shop:' || shop_id, false)`. One trigger function serves both tables, taking the column that holds the Shop id from its trigger argument.
- The payload carries **no ticket data**. A public broadcast is acceptable because it reveals only activity timing.
- Clients subscribe to `shop:{shop_id}` and refetch their view when a ping arrives, debounced by 300 ms.
- Clients also poll every 30 s and on `visibilitychange`, because mobile browsers drop sockets in the background.
- All three live in `lib/queue-changed.ts`, which both the Customer page and the dashboard use, so the two screens cannot fall out of step with each other.
- `realtime.send` swallows its own failures as a warning, so a Realtime outage can never roll back the mutation that triggered it; the poll covers the gap.

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
- `Secure` is set in production only. `next dev` on a LAN address is plain HTTP, where the browser would drop the cookie without a word and no Customer could ever hold a Ticket.
- Minted by the `joinQueue` Server Action, which is the only place it can be: Server Components cannot write cookies, so the first join is what gives a browser its identity.
- Read back as a UUID or not at all. A forged value would otherwise reach a `uuid` parameter and turn into a 500 instead of a view with no Ticket in it.

### Route Handlers (reads, `cache: no-store`)
- `GET /api/s/[slug]/me` → `get_customer_view`. 404 when the slug has no Shop. Reads the device from the raw `Cookie` header rather than `cookies()`, which keeps it testable as Request in, Response out
- `GET /api/owner/queue` → `get_owner_queue`. 403 `shop_inactive` when the caller runs no active Shop
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
| `POST /api/operator/shops` | `{ slug, name, lat, lng, ownerEmail, ownerPassword, joinRadiusM?, headsUpThreshold?, maxQueueSize? }` | Creates the Auth user with `auth.admin.createUser({ email_confirm: true })`, the Shop and its first Queue Day. `ownerPassword` has the same ≥ 10 character minimum as a reset, so a created password is never weaker than a replaced one. If the Shop insert fails, deletes the Auth user. Returns the Shop, `queueUrl`, `qrUrl` |
| `GET /api/operator/shops` | — | Lists Shops with owner email, `is_active` and month-to-date Served count |
| `GET /api/operator/shops/[slug]` | — | One Shop |
| `PATCH /api/operator/shops/[slug]` | Any of `{ name, lat, lng, joinRadiusM, headsUpThreshold, maxQueueSize, isActive }` | Updates the Shop. Setting `isActive: false` also calls `revoke_owner_sessions`. The slug cannot be changed |
| `POST /api/operator/shops/[slug]/owner-password` | `{ password }` (≥ 10 characters) | `auth.admin.updateUserById`, then `revoke_owner_sessions` |
| `GET /api/operator/shops/[slug]/qr.png` | — | 1024×1024 PNG with error correction level M, encoding `${APP_BASE_URL}/s/${slug}` |
| `GET /api/operator/billing?month=YYYY-MM` | — | `billing_summary`. Returns `{ month, shops: [...], totalSen }` |

Shops are never deleted; they are deactivated instead.

Responses use camelCase, so the database's column names are not part of the API. Errors are `{ error, field?, message? }`:

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_body` | Malformed JSON, or a field the `field` key names |
| 401 | `unauthorized` | Missing or wrong bearer key |
| 409 | `slug_taken`, `email_taken` | The slug or the owner email is already used |
| 500 | `internal_error` | Anything else; the detail is logged, not returned |

`POST /api/operator/shops` writes to two systems that cannot share a transaction. It creates the Auth user first, because `shops.owner_user_id` references it, then calls `create_shop`. If the Shop is rejected the Auth user is deleted again, so that retrying with a corrected slug doesn't then fail on a duplicate email.

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
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client + server | Supabase |
| `SUPABASE_SECRET_KEY` | server only | Customer and Operator functions |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:`) | public / server | Web Push |
| `OPERATOR_API_KEY` | server | Admin API |
| `CRON_SECRET` | server | Cron route |
| `APP_BASE_URL` | server | QR target: `https://virtual-queue-system.netlify.app` in production |
| `NEXT_PUBLIC_SENTRY_DSN` | client + server | Error tracking. Absent: nothing is sent |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | build | Source-map upload. Without the token the build skips it |

## 11. Testing

- **Types:** `bun run db:types` regenerates `lib/supabase/database.types.ts` from the local database, and every Supabase client is parameterised with it. Run it after each migration, and commit the result, so `tsc` catches a query that no longer matches the schema.
- **Queue rules (Vitest against `supabase start`):** these tests always run against the local stack, never the cloud project. One test file per function, covering:
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
