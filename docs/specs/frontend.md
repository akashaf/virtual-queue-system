# Frontend Spec: Barbershop Virtual Queue (MVP)

Vocabulary follows [CONTEXT.md](../../CONTEXT.md). Server contracts are in [backend.md](./backend.md).

## 1. Stack and conventions

- **Framework:** Next.js 16 App Router, React 19, TypeScript, and bun.
  - Read `node_modules/next/dist/docs/` before implementing.
  - `params` and `searchParams` are Promises.
  - Session refresh lives in `proxy.ts`.
- **UI:** Tailwind CSS 4 plus shadcn/ui (Button, Input, Card, Dialog, AlertDialog, Sonner toast, Badge, Tabs).
  - Design mobile-first: 360 px minimum width, touch targets ≥ 44 px.
- **Data:**
  - Server Components render the first view.
  - Client components refetch from Route Handlers when a Realtime ping arrives, every 30 s, and on `visibilitychange`.
  - Mutations use Server Actions with `useActionState` for pending and error states. Joining is the exception: the tap has to buy a geolocation fix *before* the action is called (§3.2), so the customer page calls `joinQueue` itself and holds the result in state. Its button stays disabled until the page has hydrated, because a form submitted before then would post with no coordinates at all.
- **Customer-page languages:** English and Bahasa Malaysia.
  - The language comes from `Accept-Language` and is stored in the `vq_lang` cookie.
  - A small EN | BM toggle overrides it.
  - Translations are plain dictionaries in `lib/i18n/{en,ms}.ts`, with no i18n library.
  - The Owner dashboard is English-only.
- **Errors:** Sentry `@sentry/nextjs` on the client and server.

## 2. Routes

| Route | Audience | Rendering |
|---|---|---|
| `/` | Public | Static page: "Scan the QR code at your barbershop" |
| `/s/[slug]` | Customer | Dynamic. The QR code target and the whole customer experience |
| `/login` | Owner | Email and password form |
| `/dashboard` | Owner | Live queue |
| `/dashboard/history` | Owner | Today's Tickets plus Served counts |
| `/sw.js` (in `public/`) | — | Service worker for push |

## 3. Customer page `/s/[slug]`

The page is one component that switches on `get_customer_view`. It shows only the customer's own Ticket and never other customers' names.

### 3.1 States

| State | Condition | Shows | Actions |
|---|---|---|---|
| Shop not found / inactive | 404 or `is_active = false` | "This shop isn't accepting customers right now" | — |
| In-app browser warning | UA matches Instagram, FB, TikTok, Line, WeChat or WhatsApp webviews | Banner shown above any state: "Open in Chrome/Safari to get alerts" | — |
| Join form | No active Ticket, `joining_state = open` | Shop name, waiting count, name input (1–30 characters), privacy notice | **Join queue** |
| Last Call, not joined | No Ticket, `last_call` | "Shop is closing soon, not taking new customers" | — |
| Location denied | Geolocation permission denied | How to enable location in the browser settings | **Try again** |
| Location unavailable | Geolocation timed out or returned no fix | "We couldn't find your location", and to move somewhere with a clearer signal. Kept apart from denied because only a refusal is the customer's to fix | **Try again** |
| Too far | `too_far` | "You need to be at the shop to join" | **Try again** |
| Queue full | `queue_full` | "Queue full, please check back soon" | **Try again** |
| Waiting | `waiting` | Big ticket number, "N ahead of you", Estimated Wait range if available, the note "Customers waiting in person may be served in between", alert status (push on/off) | **Leave queue** (confirmation) |
| Heads-up reached | `waiting` and `position ≤ threshold` | Same as Waiting plus a highlighted "Head back to the shop now" | Leave |
| Last Call prompt | `waiting`, shop `last_call` | Modal-like card: "Shop is closing soon. Move to the next day's queue, or stay today? If you stay, you may not be served." Shows the current choice | **Move to next day** / **Stay today** (can change until close) |
| Carried-over | `waiting`, `carried_over` | Waiting view plus the badge "Moved from previous day" | Leave |
| Called | `called` | Full-screen high-contrast "It's your turn: #017, go to the counter" | **Leave** |
| Served | `served` | "Thanks! See you next time" | **Join queue** (back to the join form) |
| No-show | `no_show` | "You missed your turn" | **Join again** if `can_rejoin` (no location prompt); otherwise "Scan the QR code at the shop to join again" |
| Left | `left` | "You left the queue" | Back to join form |
| Removed | `removed` | "Your ticket was removed" (or "Shop closed, sorry, come back tomorrow" after Close Shop) | Back to join form |

Once a Ticket reaches a final state, the page keeps showing that state until the customer taps to continue.

`get_customer_view` answers with that Ticket for the rest of the Queue Day (backend.md §5), because No-show, Removed and Served are three different screens and a page that only sees a Ticket disappear cannot tell them apart. Dismissal is the browser's business rather than the Shop's, so the **dismissed** Ticket's id is kept in `sessionStorage`: the page shows the ending until that id matches, and the join form afterwards. Per session, so a Customer returning later meets the join form rather than yesterday's news.

Every final state therefore has a way on, Served included — otherwise a Customer who has had their haircut could not queue again that day, for a child or for a second cut.

### 3.2 Join flow
1. The customer taps **Join queue**. This tap is the user gesture that everything below needs.
2. **Unlock audio:** play a silent audio clip, which lets the alert sound play later on iOS.
3. **Get location:** call `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })` and show "Checking you're at the shop…".
4. Call `joinQueue(slug, name, { lat, lng, accuracy })`.
5. **Ask for notifications.** On success, if `'PushManager' in window`:
   - Show a short explanation sheet, then `Notification.requestPermission()`.
   - If granted: register `/sw.js`, subscribe with `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and call `savePushSubscription`.
   - If denied or unsupported (for example iOS Safari that isn't installed to the Home Screen): show a persistent banner "Keep this page open, we'll alert you with sound" and **do not re-prompt**.
6. Switch to the Waiting state.

### 3.3 Alerts on the open page
The page compares the previous view with the new one after each refetch.
- **Heads-up** (position drops to ≤ threshold for the first time on this page):
  - Plays a chime once
  - Vibrates `[200,100,200]` where supported
  - Flashes the tab title "⏰ Almost your turn"
- **Called:**
  - Plays a louder repeating chime every 5 s until the customer taps "I'm coming"
  - Vibrates `[500,200,500]`
  - Flashes the title "🔔 Your turn!"
- **Screen Wake Lock:** request `navigator.wakeLock` while Waiting and re-acquire it on `visibilitychange`. Treat it as a best-effort extra, not a guarantee.
- **Push already shown:** if a push notification arrives while the page is focused, the service worker skips it (it checks `clients.matchAll`) so the alert isn't shown twice.

### 3.4 Service worker `public/sw.js`
- `push`: parse `{ kind, shopName, number, url, lang }`, then `showNotification` with localised text:
  - `heads_up`: "Almost your turn at {shop}"
  - `called`: "Your turn at {shop}: #{number}", with `requireInteraction: true`
  - `last_call`: "{shop} is closing soon, choose to stay or move to the next day"
  - `shop_closed`: "{shop} has closed"
- `notificationclick`: focus an existing `/s/{slug}` window or open one.
- No offline caching in the MVP.

## 4. Owner app

### 4.1 `/login`
- Email and password fields.
- Errors: "Wrong email or password"; "This shop account is inactive, contact support".
- No sign-up and no forgot-password link. Owners contact the Operator instead (deferred).

### 4.2 `/dashboard`
The layout checks the session and `is_active` on the server, and redirects to `/login` otherwise.

Layout, from top to bottom:
1. **Header:** shop name, joining state badge (Open / Last Call), counts "Waiting N · In chair N", menu (History, Sign out).
2. **Primary button:** **Call next** (large, sticky at the bottom on phones). Disabled when nobody is Waiting.
3. **Called list:** one card per Called Ticket showing number, name and "called 3 min ago", with these actions:
   - **Done**
   - **No-show:** disabled until 5 minutes after the call, with a countdown shown
   - **Remove** in an overflow menu, with confirmation
4. **Waiting list:** ordered rows showing number, name, time joined, and badges for "Moved from previous day", "Rejoined" and "Chose: next day / stay" during Last Call. **Remove** is in an overflow menu with confirmation.
5. **Undo toast:** after Done, a Sonner toast "#017 marked done · Undo" stays for the remaining undo window (2 min) with a visible countdown. Recently Served Tickets still in the window are also listed in a collapsed "Just served" section with Undo, so the undo survives a page reload.
6. **Footer actions:**
   - **Last Call** (confirmation: "Stop new customers joining and ask waiting customers to choose?"). While Last Call is active this becomes **Reopen joining** and **Close Shop**.
   - **Close Shop:** the confirmation summarises "N moving to next day, N will be removed". If any Ticket is Called, it shows "Finish or mark no-show for customers in chair first".

Behaviour:
- **After a Server Action:** apply the optimistic update, then refetch `/api/owner/queue`.
- **Error messages:** errors from the functions become toasts, e.g. `queue_empty` → "Nobody waiting", `too_early`, `undo_expired`, `tickets_still_called`.
- **Several devices:** they can be open at once and stay in sync through Realtime.
- **Accidental taps:** guard against double taps by disabling buttons while an action is pending.

### 4.3 `/dashboard/history`
- **Today:** a table of the current Queue Day's Tickets with number, name, status, joined, called and served times.
- **Last 30 days:** a simple list or bar row of Served counts per day, plus a **This month** total shown as "Served: N · Amount due: RM x.xx".
- No exports.

## 5. Accessibility and UX rules
- Ticket number ≥ 64 px on the customer page, AA contrast, and states announced with `aria-live="polite"` (`assertive` for Called).
- Never rely on sound alone: the Called state is also a full-screen colour change.
- All times are shown in Malaysia time using 12-hour format.

## 6. Suggested file layout

```
app/
  page.tsx
  s/[slug]/page.tsx, customer-queue.tsx, language-toggle.tsx, actions.ts
  login/page.tsx, actions.ts, messages.ts
  dashboard/layout.tsx, page.tsx, queue-board.tsx, actions.ts, messages.ts
  dashboard/history/page.tsx
  api/s/[slug]/me/route.ts
  api/owner/queue/route.ts, api/owner/history/route.ts
  api/operator/…            (see backend.md §8)
  api/cron/daily/route.ts
lib/supabase/{server,client,admin}.ts, lib/supabase/database.types.ts (generated)
lib/auth/owner.ts             (the Owner's Shop, the authoritative session check)
lib/customer/{view,queue}.ts  (view.ts is pure and shared with the client component)
lib/owner/{view,queue}.ts     (same split: view.ts is pure, queue.ts calls the database)
lib/operator/{auth,shop-input,shop-resource}.ts
lib/queue-changed.ts          (the ping, the poll and the visibilitychange refetch, shared by both screens)
lib/push.ts, lib/device-cookie.ts, lib/uuid.ts, lib/time.ts, lib/i18n/{en,ms}.ts, lib/alerts.ts
components/ui/…              (shadcn)
public/sw.js, public/sounds/{chime,called}.mp3
proxy.ts
netlify/functions/daily.mts  (schedule only; calls api/cron/daily)
netlify.toml
```

## 7. Testing
- **Playwright end-to-end (Chromium):**
  - Setup: seed a Shop with the Operator API against local Supabase, and grant geolocation and notification permissions in the browser context.
  - Main flow: customer joins, then the Owner (second browser context) sees the Ticket and presses Call next, then the customer page shows Called, then the Owner presses Done, then the customer page shows Served.
- **Unit (Vitest):** state derivation from view diffs in `lib/alerts.ts` (when to chime and flash), and i18n key completeness between `en` and `ms`.
- **Manual checklist before a pilot:**
  - iPhone Safari (no push, sound after the join tap, wake lock)
  - Android Chrome with the screen locked (push arrives)
  - Location denied
  - Two Owner phones pressing Call next together
