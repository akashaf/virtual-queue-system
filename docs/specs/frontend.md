# Frontend Spec: Barbershop Virtual Queue (MVP)

Vocabulary follows [CONTEXT.md](../../CONTEXT.md). Server contracts are in [backend.md](./backend.md).

## 1. Stack and conventions

- **Framework:** Next.js 16 App Router, React 19, TypeScript, and bun.
  - Read `node_modules/next/dist/docs/` before implementing.
  - `params` and `searchParams` are Promises.
  - Session refresh lives in `proxy.ts`.
- **UI:** Tailwind CSS 4 plus shadcn/ui (Button, Input, Label, Card, Alert, AlertDialog, DropdownMenu, Sonner toast, Badge, Collapsible, Table).
  - Design mobile-first: 360 px minimum width, touch targets ≥ 44 px.
  - **Official shadcn components only.** Plain Tailwind is for layout (flex, grid, spacing, sizing), never for hand-styling a control.
  - **Theme:** burgundy `primary`, orange-red `destructive` (kept apart so a destructive action never reads as a normal one), faintly warm neutrals. Typeface is Clarity City, self-hosted from `@clr/city` through `next/font/local` because it is not on Google Fonts.
  - **Colours come from theme tokens only** (`bg-primary`, `text-muted-foreground`, …), never fixed Tailwind palette colours or arbitrary values, so a Shop's look can later be changed by overriding tokens. `lib/theme-tokens.test.ts` enforces this for every `.tsx` file in `app/` and `components/` outside the vendored `components/ui/`.
  - **Ticket status tokens:** `status-waiting`, `status-called`, `status-served` and `status-ended` (No-show, Left, Removed), each with a `-foreground` pair, so a status has the same colour on the Customer page and the queue board.
  - **Dark mode follows the device setting** through `next-themes` (class-based). There is no toggle.
- **Data:**
  - Server Components render the first view.
  - Client components refetch from Route Handlers when a Realtime ping arrives, every 30 s, and on `visibilitychange`.
  - Mutations use Server Actions with `useActionState` for pending and error states. Joining is the exception: the tap has to buy a geolocation fix *before* the action is called (§3.2), so the customer page calls `joinQueue` itself and holds the result in state. Its button stays disabled until the page has hydrated, because a form submitted before then would post with no coordinates at all.
- **Customer-page languages:** English and Bahasa Malaysia.
  - The language comes from `Accept-Language` and is stored in the `vq_lang` cookie.
  - A small EN | BM toggle overrides it.
  - Translations are plain dictionaries in `lib/i18n/{en,ms}.ts`, with no i18n library.
  - The Owner dashboard is English-only.
  - The one exception on an Owner page: `/login` has a line below its card telling a Customer who edited the URL to scan the QR code, in the language the Customer page would use.
- **Errors:** Sentry `@sentry/nextjs` on the client and server.

## 2. Routes

| Route | Audience | Rendering |
|---|---|---|
| `/` | Public | Temporary redirect to `/login`. Customers only arrive by QR code, so the bare domain is the Owner's way in |
| `/s/[slug]` | Customer | Dynamic. The QR code target and the whole customer experience |
| `/login` | Owner | Email and password form |
| `/dashboard` | Owner | Live queue |
| `/dashboard/history` | Owner | Today's Tickets plus Served counts |
| `/OneSignalSDKWorker.js` (in `public/`) | — | OneSignal's service worker for push |

## 3. Customer page `/s/[slug]`

The page is one component that switches on `get_customer_view`. It shows only the customer's own Ticket and never other customers' names.

### 3.1 States

| State | Condition | Shows | Actions |
|---|---|---|---|
| Shop not found / inactive | 404 or `is_active = false` | "This shop isn't accepting customers right now" | — |
| In-app browser warning | UA matches Instagram, FB, TikTok, Line, WeChat or WhatsApp webviews | Banner shown above any state: "Open in Chrome/Safari to get alerts". Not over the iPhone install gate's "Open this page in Safari first" card, which says it already | — |
| Join form | No active Ticket, `joining_state = open` | Shop name, waiting count, name input (1–30 characters), privacy notice, and a line saying the phone will ask for location, checked once and not kept | **Join queue** |
| Last Call, not joined | No Ticket, `last_call` | "Shop is closing soon, not taking new customers" | — |
| Location denied | Geolocation permission denied | Why the location check exists (nobody can queue from home), then where the setting lives: the phone's Settings app on an iPhone (the path differs between iOS versions and browsers, so it names the steps loosely), the browser's site settings otherwise. The browser remembers a refusal, so trying again without changing it fails at once | **Try again** |
| Location unavailable | Geolocation timed out or returned no fix | "We couldn't find your location", and to move somewhere with a clearer signal. Kept apart from denied because only a refusal is the customer's to fix | **Try again** |
| Too far | `too_far` | "You need to be at the shop to join" | **Try again** |
| Queue full | `queue_full` | "Queue full, please check back soon" | **Try again** |
| Waiting | `waiting` | Big ticket number, "N ahead of you", Estimated Wait range if available, the note "Customers waiting in person may be served in between", alert status (push on/off) | **Leave queue** (confirmation) |
| Out of date | `waiting`, and a refetch failed or the browser went offline | Waiting view plus, above the ticket, "Not up to date · As of 3:37 pm. Trying again…" as an inverted ink block (near-black on light, light on dark; not a status colour), with the ticket card dimmed to 60%. Retries every 5 s while the tab is showing and at once when back online; a refetch that hangs for 10 s counts as failed; goes when a refetch or an action succeeds. A Leave or Last Call choice that gets no answer while Waiting goes back to the Ticket and raises the notice: it may still have landed, so the refetch says what happened. Anywhere else (a Join, a Rejoin, a Leave while Called) it shows "Something went wrong. Please try again." with **Try again**, rather than leaving the busy screen up. A press from a page left open across a deploy (the server no longer knows the old build's Server Action) reloads the page instead, at most once a minute, with the busy screen up until it does (`lib/action-failure.ts`); the device cookie keeps the Ticket. The same holds for every Server Action in the app, the board's presses and the forms (EN | BM, sign-in, sign-out) included. The same notice as the Owner's board (§4.2), because the open page is the alert of last resort | **Retry** |
| Not calling yet | `waiting`, and `shop.day_started` is false | Waiting view plus a calm line in place of any Heads-up: "You're first in line. We'll alert you when the shop starts calling" at position 0 (the first Call next calls them, so the Called alert keeps that promise), otherwise "The shop hasn't started calling yet. Your place in line is kept", which promises no Heads-up because a carried Ticket told yesterday is not told again. Not shown beside the Last Call question. No wake lock. Covers Carried-over Tickets after Close Shop and anyone who joins before the day's first Call next (#41) | Leave |
| Heads-up reached | `waiting`, `position ≤ threshold` and `shop.day_started` | Same as Waiting plus a highlighted "Head back to the shop now" | Leave |
| Last Call prompt | `waiting`, shop `last_call` | Modal-like card: "Shop is closing soon. Move to the next day's queue, or stay today? If you stay, you may not be served." Shows the current choice | **Move to next day** / **Stay today** (can change until close) |
| Carried-over | `waiting`, `carried_over` | Waiting view plus the badge "Moved from previous day". Close Shop moving the Ticket to the front of the new day is not a Heads-up: the new day has not Started, so the Ticket shows Not calling yet until its first Call next (§3.3) | Leave |
| Called | `called` | Full-screen high-contrast "It's your turn: #017, go to the counter" | **Leave** |
| Served | `served` | "Thanks! See you next time" | **Join queue** (back to the join form) |
| No-show | `no_show` | "You missed your turn" | **Join again** if `can_rejoin` (no location prompt); otherwise "Scan the QR code at the shop to join again" |
| Left | `left` | "You left the queue" | Back to join form |
| Removed | `removed` | "Your ticket was removed" (or "Shop closed, sorry, come back tomorrow" after Close Shop) | Back to join form |

Once a Ticket reaches a final state, the page keeps showing that state until the customer taps to continue.

`get_customer_view` answers with that Ticket for the rest of the Queue Day (backend.md §5), because No-show, Removed and Served are three different screens and a page that only sees a Ticket disappear cannot tell them apart. Dismissal is the browser's business rather than the Shop's, so the **dismissed** Ticket's id is kept in `sessionStorage`: the page shows the ending until that id matches, and the join form afterwards. Per session, so a Customer returning later meets the join form rather than yesterday's news.

Every final state therefore has a way on, Served included — otherwise a Customer who has had their haircut could not queue again that day, for a child or for a second cut.

### 3.2 Join flow
0. **iPhone install gate** ([ADR 0001 amendment](../adr/0001-web-push-not-whatsapp-for-mvp-alerts.md#amendment-2026-10-16-iphone-customers-must-install-to-join)). Before the form is usable, on an iPhone with iOS 16.4 or later only (iPads are not gated):
   - **In Safari** (not standalone): show the install steps (Share → Add to Home Screen → open it from there and join) in place of the join form. The name field goes too, because a name typed in Safari would not follow the Customer into the installed app. There is no way to join from Safari.
   - **In an in-app browser** (WhatsApp, Instagram, Facebook and the like): say to open the page in Safari first, then show the same steps.
   - **Standalone (installed)**, iOS older than 16.4, and every non-iOS browser: the normal form.
   - The gate is for new joins only. A device already holding a Ticket sees that Ticket, and Rejoin is never gated.
   - Other iPhone browsers (Chrome, Firefox and the like) get the same install steps: since iOS 16.4 they can add to the Home Screen from their own Share button.
   - Each Shop's page links a web app manifest (`/s/{slug}/app.webmanifest`, `display: standalone`, scoped to the Shop and named after it). Before iOS 26, Add to Home Screen without one makes a bookmark that opens in Safari, which the gate would stop again.
   - Detection runs in the browser (`lib/install-gate.ts`). The server renders nothing in place of the form for a phone the gate might stop, so no Join button flashes before the steps.
1. The customer taps **Join queue**. This tap is the user gesture that everything below needs.
2. **Unlock audio:** play a silent audio clip, which lets the alert sound play later on iOS.
3. **Get location:** call `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })` and show "Checking you're at the shop…".
4. Call `joinQueue(slug, name, { lat, lng, accuracy })`.
5. **Ask for notifications** through OneSignal ([ADR 0005](../adr/0005-onesignal-delivers-web-push.md)). The page initialises the OneSignal Web SDK on load, with its own prompts off, so the sheet's button reaches the browser's prompt inside the tap. On success, if `'PushManager' in window` and `NEXT_PUBLIC_ONESIGNAL_APP_ID` is set:
   - Show a short explanation sheet ("Turn on alerts" / "No thanks, sound only", both 44 px), then `OneSignal.Notifications.requestPermission()`.
   - If granted: `OneSignal.login(ticketId)` (the Ticket id is the External ID, never the device id), `OneSignal.User.setLanguage(lang)`, and opt the push subscription in. A reload or a Rejoin logs in again silently, which moves the subscription to the Ticket the Customer holds now.
   - If denied or unsupported (for example iOS Safari that isn't installed to the Home Screen): show a persistent banner "Keep this page open, we'll alert you with sound" and **do not re-prompt**. The banner also tells the Customer that alerts play at the media volume, not the ringer, so turn it up.
   - If the Customer only said no to our sheet (or dismissed the browser's prompt), the browser would still ask, so the banner carries a **Turn on alerts** button. Tapping it is the Customer asking, not a re-prompt; a grant there forgets the remembered decline.
6. Switch to the Waiting state.

### 3.3 Alerts on the open page
The page compares the previous view with the new one after each refetch, in `lib/alerts.ts`, which is pure; `lib/alert-effects.ts` makes the noise. A Heads-up fires only on a change the page *saw happen*, never on a state it merely found: a Customer who has just joined is looking at it, which is the same reason the database stamps a Ticket that joins inside the threshold without alerting it (backend.md §4). Called is the exception: a page that loads already Called rings too. iPhone Safari discards background tabs and this page is its only alert, so a Customer coming back to a reloaded page must not find it silent; the page cannot tell that from a fresh visit, and one chime too many is the cheaper mistake.
- **Heads-up** (the same Ticket goes from Waiting outside the threshold to Waiting inside it, where inside also needs `shop.day_started`):
  - Plays a chime once, and never again for that Ticket on this page, however the position moves afterwards
  - Not before the Queue Day has Started (CONTEXT.md): after Close Shop the carried Tickets, and anyone who joins overnight, sit inside the threshold with nobody being called, and the database sends no Heads-up then either (backend.md §4, #41). A Ticket already inside the threshold gets it when the view turns `day_started`, at the day's first Call next. The page takes `day_started` from the server, never from position, `carried_over` or the clock
  - Vibrates `[200,100,200]` where supported
  - Flashes the tab title "⏰ Almost your turn" for 10 s
- **Called** (the same Ticket goes from Waiting to Called, or the page loads already Called; not Served back to Called while the page watches, which is an Owner undoing a mis-tap on a Customer already in the chair):
  - Plays a louder chime every 5 s until the customer taps "Stop the alert", which only shows while it rings. It only silences this page: the Owner is not told, so it is not worded as a promise to come
  - Vibrates `[500,200,500]` with each chime
  - Flashes the title "🔔 Your turn!" until acknowledged
- **Sounds** are synthesised in the browser as WAV clips and played through one `<audio>` element, rather than shipped as files. `<audio>`, not Web Audio, because iOS mutes Web Audio on the silent switch. iOS only plays from an element that has played inside a tap: the Join (and Rejoin) tap plays a silent clip on it, and so does the first tap anywhere on the page, so a Customer who reloads while waiting is not left silent.
- **Screen Wake Lock:** request `navigator.wakeLock` while the Ticket is Called, or Waiting in a Queue Day that has Started — Called too, or the screen could go dark while the chime rings; not Waiting before then, or a page left open after Close Shop keeps the screen on all night — and re-acquire it on `visibilitychange`. Treat it as a best-effort extra, not a guarantee. The first-tap audio unlock stays armed for any active Ticket, so a page reloaded overnight still chimes when the day Starts.
- **Push over an open page:** a push that arrives while the page is focused is still shown as a notification, so the Customer is alerted twice. Safari revokes a push subscription after three pushes that show nothing, so the service worker must never skip one.

### 3.4 Service worker `public/OneSignalSDKWorker.js`
- OneSignal's standard worker, one `importScripts` line. It shows every push and opens the notification's `url` on click.
- The text is written by the server (backend.md §7): the Shop's name as the title, and the message in English and Malay, of which OneSignal shows the subscriber's language.
- No offline caching in the MVP.

## 4. Owner app

### 4.1 `/login`
- Email and password fields.
- Errors: "Wrong email or password"; "This Shop has been switched off. Contact the Operator to turn it back on." The second is not the Owner's mistake, so on this page it shows as a calm notice (`role="status"`) rather than an error. The dashboard still shows it as an error toast, because there the Owner's action did fail.
- A refused attempt keeps the email and puts the cursor back in the password field.
- After a Close Shop that ended the Owner's own week-old Sign-in (ADR 0006), a calm notice: "The Shop closed as usual. Owners sign in again once a week, and this does not affect the Queue." Other devices that Close Shop signed out arrive at `/login` with no notice: nothing can tell them why by then.
- No sign-up and no forgot-password link. Owners contact the Operator instead (deferred).
- An Owner who is already signed in is sent on to `/dashboard`. `/` relies on this rather than checking the session itself.
- Below the card, a small line for Customers: "Waiting for a haircut? Scan the QR code at the shop." (§1 covers its language).

### 4.2 `/dashboard`
The layout checks the session and `is_active` on the server, and redirects to `/login` otherwise.

Layout, from top to bottom:
1. **Header:** shop name, joining state badge (Open / Last Call), menu (Queue, History, Settings, Sign out) behind one 44 px button. The counts are the section headings below; a screen-reader-only line "Waiting N · In chair N" announces them when they change.
2. **Primary button:** **Call next** (large, sticky at the bottom on phones), with the Ticket it will take beneath the label ("#003 Raj Kumar"). Disabled when nobody is Waiting, and then says "Nobody waiting". After a call, a toast "Called #003 Raj Kumar".
3. **Called list**, headed "In chair N": one card per Called Ticket showing number, name and "called 3 min ago", with these actions:
   - **Done**, the wide filled button
   - **No-show:** a narrow outline button a full gap from Done, because it is final and Done is not. Disabled until 5 minutes after the call, with a countdown shown
   - **Remove** in an overflow menu, with confirmation
4. **Waiting list**, headed "Waiting N": ordered rows showing number, name, time joined, and badges for "Next" on the first row (the one Call next takes), "Moved from previous day", "Rejoined" and "Chose: next day / stay" during Last Call. **Remove** is in an overflow menu with confirmation.
5. **Undo toast:** after Done, a Sonner toast, shown at the bottom just above Call next so it never covers the header's menu, "#017 marked done · Undo" stays for the remaining undo window (2 min) with a visible countdown. Recently Served Tickets still in the window are also listed in a collapsed "Just served" section with Undo, so the undo survives a page reload.
6. **Footer actions:**
   - **Last Call** (confirmation: "Stop new customers joining and ask waiting customers to choose?"). While Last Call is active this becomes **Reopen joining** and **Close Shop**.
   - **Close Shop:** the confirmation summarises "N moving to next day, N will be removed". If any Ticket is Called, it shows "Finish or mark no-show for customers in chair first".

Behaviour:
- **After a Server Action:** apply the optimistic update, then refetch `/api/owner/queue`.
- **Error messages:** errors from the functions become toasts, e.g. `queue_empty` → "Nobody waiting", `too_early`, `undo_expired`, `tickets_still_called`.
- **Several devices:** they can be open at once and stay in sync through Realtime.
- **Out of date:** when a refetch fails or the browser goes offline, a notice under the joining state badge says "Not up to date · As of 3:37 pm. Trying again…" with a **Retry** button; the board retries every 5 s while the tab is showing and at once when the browser is back online, and the notice goes when a refetch succeeds. A refetch that hangs for 10 s counts as failed. A press that gets no answer is a toast ("No connection, so that may not have gone through. The queue will update when you're back online.") and raises the notice; it may still have landed, so the board keeps its optimistic view until a refetch says what happened, and the toast does not invite a second press. A press from a board left open across a deploy reloads it instead, as on the Customer page (§3.1). A refetch answered 403 (no active Shop for this session) refreshes the page, so the layout sends a switched-off Shop's Owner to `/login?error=inactive` and a signed-out one to `/login`.
- **Accidental taps:** guard against double taps by disabling buttons while an action is pending.

### 4.3 `/dashboard/history`
- **Today:** a table of the current Queue Day's Tickets with number, name, status, joined, called and served times.
- **Last 30 days:** a simple list or bar row of Served counts per day, plus a **This month** total shown as "Served: N · Amount due: RM x.xx".
- No exports.

### 4.4 `/dashboard/settings`
- Behind the same gate as the rest of the dashboard (the layout's).
- **Sign out other devices**, for a lost device or a former staff member who still has access. The confirmation asks "Sign out every other device? They'll need the password to get back in." Confirming ends every one of the Owner's Sign-ins except this device's; the Owner stays on the page and reads "Every other device is signed out." The devices signed out arrive at `/login` on their next request, with no notice.

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
  dashboard/{called-card,waiting-list,ticket-menu,undo,queue-controls,move-form}.tsx, use-elapsed-ms.ts
                              (presentational pieces of the queue board; state and actions stay in queue-board.tsx)
  dashboard/history/page.tsx
  dashboard/settings/page.tsx, sign-out-others.tsx, actions.ts
  api/s/[slug]/me/route.ts
  api/owner/queue/route.ts, api/owner/history/route.ts
  api/operator/…            (see backend.md §8)
  api/cron/daily/route.ts
lib/supabase/{server,client,admin}.ts, lib/supabase/database.types.ts (generated)
lib/auth/owner.ts             (the Owner's Shop, the authoritative session check)
lib/customer/{view,queue}.ts  (view.ts is pure and shared with the client component)
lib/owner/{view,queue}.ts     (same split: view.ts is pure, queue.ts calls the database)
lib/owner/{history-view,history}.ts (the same split for the history page)
lib/operator/{auth,shop-input,shop-resource}.ts
lib/queue-changed.ts          (the ping, the poll and the visibilitychange refetch, shared by both screens)
lib/push.ts, lib/push-client.ts, lib/device-cookie.ts, lib/uuid.ts, lib/time.ts, lib/i18n/{en,ms}.ts
lib/alerts.ts                 (pure: which alert a view change calls for)
lib/alert-effects.ts          (sound, vibration, title flash and wake lock, acting on it)
components/ui/…              (shadcn; only what a screen imports, which lib/ui-components.test.ts checks)
public/OneSignalSDKWorker.js
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
