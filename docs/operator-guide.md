# Operator Guide

How to run the Barbershop Virtual Queue: on your laptop, in production, and day to day with
real Shops. Capitalised words (Shop, Owner, Ticket, Queue Day…) are defined in
[CONTEXT.md](../CONTEXT.md).

- [1. The three people in the system](#1-the-three-people-in-the-system)
- [2. What's next](#2-whats-next)
- [3. Run it on your laptop](#3-run-it-on-your-laptop)
- [4. Add a Shop and its Owner](#4-add-a-shop-and-its-owner)
- [5. The daily flow](#5-the-daily-flow)
- [6. Looking after Shops](#6-looking-after-shops)
- [7. Monthly billing](#7-monthly-billing)
- [8. What runs by itself](#8-what-runs-by-itself)
- [9. When something goes wrong](#9-when-something-goes-wrong)

---

## 1. The three people in the system

| Who | What they use | How they get in |
|---|---|---|
| **Operator** (you) | The admin API, with `curl` or Postman | A bearer key, `OPERATOR_API_KEY` |
| **Owner** (the barber running a Shop) | `/login`, then `/dashboard` on their phone or tablet | Email and password that **you** create. There is no sign-up and no "forgot password" |
| **Customer** (a walk-in) | `/s/<slug>`, opened by scanning the Shop's QR poster | Nothing: no account. Must be standing at the Shop to join |

There is no admin web page. Everything the Operator does is an API call.

---

## 2. What's next

Every build ticket is closed (#2–#18). The MVP is built and deployed at
`https://virtual-queue-system.netlify.app`. What's left isn't code; it's getting a real Shop live:

1. **Run the manual checklist** on real phones, using a test Shop (§4) at a place you can stand in:
   - iPhone Safari: joining works, the sound plays after the Join tap, and the screen stays awake.
     iPhones get **no push** unless the page is added to the Home Screen.
   - Android Chrome with the screen locked: the "almost your turn" and "your turn" pushes arrive.
   - Location permission denied: the page explains how to turn it back on.
   - Two Owner phones pressing **Call next** at the same moment: two different Customers are called.
2. **Onboard the first real Shop** (§4), print its poster, and stand inside to check the Join
   Radius.
3. **Before the first Shop pays**, upgrade the hosting plans ([third-party.md §8](specs/third-party.md#8-upgrade-triggers)):
   - **Netlify paid plan:** on Free, running out of monthly credits pauses the whole site and
     every Shop's Queue goes offline.
   - **Supabase Pro:** adds daily backups and never pauses. Free pauses after 7 days with no
     activity (the daily job keeps it awake for now) and has **no backups**.
4. **Watch the Netlify usage page** while still on Free. Upgrade if it passes ~70% mid-month.
5. **Close the parent spec, issue #1**, once you're happy the MVP is done.

---

## 3. Run it on your laptop

You need [bun](https://bun.sh) and a Docker runtime ([Colima](https://github.com/abiosoft/colima)).

### First time only

```bash
bun install
bunx playwright install chromium
```

### Every session

```bash
colima start          # Docker for the local database
bun run db:start      # local Postgres, Auth and Realtime (run again if it fails while booting)
bun run dev           # the app at http://127.0.0.1:3000
```

`.env.local` already points at the local database. If it's ever lost, rebuild it:
`bun run db:env > .env.local`, then copy the other values from `.env.example`.

Stop everything with:

```bash
bun run db:stop && colima stop
```

### Useful local addresses

| Address | What |
|---|---|
| http://127.0.0.1:3000 | The app |
| http://127.0.0.1:3000/login | Owner login |
| http://127.0.0.1:54323 | Supabase Studio: **look only**. Change the database through migrations, never here |

### Pretending to be at the Shop

Customers can only join from within the Shop's Join Radius (150 m by default). On a laptop:

1. Create the local Shop (§4) using **your own current coordinates**, or
2. In Chrome, open DevTools → ⋮ → *More tools* → **Sensors**, and set *Location* to the Shop's
   latitude and longitude.

Use `127.0.0.1` or `localhost` in the browser. A phone opening your laptop's LAN address
(`http://192.168.x.x:3000`) **cannot join**: browsers only share location over HTTPS or
localhost. Test real phones against production instead.

### Checks before you push code

```bash
bun run typecheck
bun run lint
bun run test          # unit + database tests (needs db:start)
bun run e2e           # browser tests
```

If a change adds a migration, then after pushing to `main`:

```bash
bunx supabase db push --dry-run   # lists what production is missing
bunx supabase db push             # applies it
```

**Pushing to `main` deploys the code but does not update the production database.** You have
to run `db push` yourself.

---

## 4. Add a Shop and its Owner

A Shop and its Owner are created together, in one call. One Owner account runs exactly one Shop.

### Step 1: decide the details

| Field | Rules | Notes |
|---|---|---|
| `slug` | 3–40 characters: `a-z`, `0-9`, `-` | Printed in the QR code. **It can never be changed**, so choose carefully, e.g. `kedai-ali-bangsar` |
| `name` | Not blank | Shown to Customers. Can be changed later |
| `lat`, `lng` | Numbers | In Google Maps, long-press the Shop's doorway and copy the two numbers |
| `ownerEmail` | An email address | The Owner's login. No email is ever sent to it |
| `ownerPassword` | At least 10 characters | Generate one: `openssl rand -base64 15` |
| `joinRadiusM` | Optional, whole number ≥ 1 | Default **150** metres |
| `headsUpThreshold` | Optional, whole number ≥ 1 | Default **3**: "almost your turn" when 3 or fewer are ahead |
| `maxQueueSize` | Optional, whole number ≥ 1 | Default **30** Customers Waiting + Called |

### Step 2: load the key

**Production.** The key is in `.env.netlify.production`, the only readable copy:

```bash
export BASE=https://virtual-queue-system.netlify.app
export OPERATOR_API_KEY=$(grep '^OPERATOR_API_KEY=' .env.netlify.production | cut -d= -f2-)
```

**Local** (the app running from §3):

```bash
export BASE=http://127.0.0.1:3000
export OPERATOR_API_KEY=$(grep '^OPERATOR_API_KEY=' .env.local | cut -d= -f2-)
```

Never paste the production key into a chat, an issue or a commit.

### Step 3: create it

```bash
curl -sS -X POST "$BASE/api/operator/shops" \
  -H "Authorization: Bearer $OPERATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "slug": "kedai-ali-bangsar",
  "name": "Kedai Gunting Ali",
  "lat": 3.1319,
  "lng": 101.6710,
  "ownerEmail": "ali@example.com",
  "ownerPassword": "paste-the-generated-password"
}
EOF
```

| Answer | Meaning |
|---|---|
| **201** | Done. The reply includes `queueUrl` (the Customer page) and `qrUrl` (the poster image) |
| **400** `invalid_body` | The `field` in the reply is wrong, and `message` says why |
| **409** `slug_taken` / `email_taken` | Choose another slug, or that email already runs a Shop |
| **401** `unauthorized` | Wrong or missing key |

If the Shop is rejected, the Owner account is removed again, so you can simply fix the mistake
and retry.

### Step 4: download the QR code

```bash
curl -sS "$BASE/api/operator/shops/kedai-ali-bangsar/qr.png" \
  -H "Authorization: Bearer $OPERATOR_API_KEY" -o kedai-ali-bangsar-qr.png
```

It's a 1024×1024 PNG that opens `https://virtual-queue-system.netlify.app/s/kedai-ali-bangsar`.
Put it on a poster (Canva is fine), print it, and **test-scan the printed poster with both an
iPhone and an Android camera**.

### Step 5: check it at the Shop

Stand inside the Shop, scan the poster and join. If it says you're too far away, raise the radius
(§6) and try again. Then **Leave** so the test Ticket isn't left in the Queue.

### Step 6: hand over

Give the Owner:
- the login page, `https://virtual-queue-system.netlify.app/login`
- their email and password, sent privately
- the one-line rule of their day: **Call next → Done → Last Call → Close Shop** (§5)

---

## 5. The daily flow

```
Customer scans QR ─► joins (must be at the Shop) ─► Waiting, "N ahead of you"
                                                        │
                        "Almost your turn" push ◄───────┤ N ≤ Heads-up Threshold
                                                        │
Owner: Call next ─────────────────────────────────────► Called, "It's your turn"
                                                        │
          ┌──────────────────────┬──────────────────────┼──────────────────────┐
     Owner: Done            Owner: No-show         Owner: Remove        Customer: Leave
     (Undo for 2 min)       (after 5 min)
          ▼                      ▼                      ▼                      ▼
       Served                 No-show                Removed                 Left
    (billed RM0.25)      (Customer may Rejoin once)
```

Remove and Leave work while Waiting too, not only once Called.

### The Customer

1. Scans the poster, which opens `/s/<slug>`.
2. Types a name (1–30 characters) and taps **Join queue**. The phone asks for location. Joining
   only works at the Shop, and only while the Shop is open to joining.
3. Allows notifications if asked. Then they can walk away:
   - **Almost your turn** when few enough people are ahead of them
   - **Your turn** when the Owner calls them, repeating on an open page until they tap
     *I'm coming*
4. They can **Leave** at any time, while Waiting or Called.
5. If they miss their call (No-show), they get **one** Rejoin to the back of the Queue, same
   day, without the location check.

On iPhone, alerts only reach them while the page is open, unless they added it to the Home
Screen. The page tells them this.

### The Owner, during the day

On `/dashboard`:

| Button | What it does |
|---|---|
| **Call next** | Calls the first Waiting Customer. Press again for each free chair: several can be Called at once |
| **Done** | Haircut finished: the Ticket is **Served**. An **Undo** stays available for 2 minutes |
| **No-show** | Customer never came. Unlocks 5 minutes after the call |
| **Remove** (⋯ menu) | Takes a Ticket out of the Queue |

Several phones can run the same dashboard at once and stay in sync.

`/dashboard/history` shows today's Tickets, the Served count for each of the last 30 days, and
**This month: Served N · Amount due RM x.xx**.

### The Owner, at closing time

1. **Last Call**: nobody new can join. Every Waiting Customer is asked to choose:
   - **Stay today** (they may not be served), or
   - **Move to next day** (they go to the front of the next Queue Day)

   If the Owner changes their mind, **Reopen joining** cancels it and keeps the choices made.
2. Serve whoever they can.
3. **Close Shop**, only once nobody is Called (finish them first with Done or No-show).
   - Customers who chose *Move to next day* go to the front of tomorrow, numbered #1, #2… in
     their original order.
   - Everyone else still Waiting is Removed and told "Shop closed".
   - Joining reopens straight away, for the next Queue Day.

A Queue Day runs from one Close Shop to the next, not by the calendar. Ticket numbers restart
at #1 after each Close Shop.

A Ticket moved to the next day can only move **once**. If it's still Waiting 3 days later, the
nightly job removes it (§8).

---

## 6. Looking after Shops

Every call uses the same `BASE` and `OPERATOR_API_KEY` as §4.

### List every Shop

```bash
curl -sS "$BASE/api/operator/shops" -H "Authorization: Bearer $OPERATOR_API_KEY"
```

Each Shop comes back with its Owner's email, whether it's active, and `servedThisMonth`.

### See one Shop

```bash
curl -sS "$BASE/api/operator/shops/kedai-ali-bangsar" -H "Authorization: Bearer $OPERATOR_API_KEY"
```

### Change settings

Send only the fields you want to change: `name`, `lat`, `lng`, `joinRadiusM`,
`headsUpThreshold`, `maxQueueSize`, `isActive`. The slug can never be changed.

```bash
curl -sS -X PATCH "$BASE/api/operator/shops/kedai-ali-bangsar" \
  -H "Authorization: Bearer $OPERATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "joinRadiusM": 200 }'
```

### Switch a Shop off (e.g. it stopped paying)

```bash
curl -sS -X PATCH "$BASE/api/operator/shops/kedai-ali-bangsar" \
  -H "Authorization: Bearer $OPERATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "isActive": false }'
```

- The Owner is signed out everywhere within about 10 minutes and can't log back in.
- Customers can't join.
- Nothing is deleted.

Send `{ "isActive": true }` to switch it back on.

### Reset an Owner's password

```bash
curl -sS -X POST "$BASE/api/operator/shops/kedai-ali-bangsar/owner-password" \
  -H "Authorization: Bearer $OPERATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "password": "a-new-generated-password" }'
```

It answers **204**, and signs the Owner out of every device.

### Change an Owner's email

The API can't do this. Shops are never deleted either. If an Owner must change, create a new
Shop with a new slug and poster, then switch the old one off.

---

## 7. Monthly billing

Each **Served** Ticket costs the Owner **RM0.25**. It counts in the month (Malaysia time) in
which it was marked Done. An undone Done isn't counted.

At the start of each month, pull the month that just ended:

```bash
curl -sS "$BASE/api/operator/billing?month=2026-08" -H "Authorization: Bearer $OPERATOR_API_KEY"
```

```json
{
  "month": "2026-08",
  "shops": [{ "slug": "kedai-ali-bangsar", "name": "Kedai Gunting Ali", "servedCount": 412, "amountSen": 10300 }],
  "totalSen": 10300
}
```

Amounts are in **sen** (10300 = RM103.00). Every Shop is listed, including switched-off ones and
Shops at 0. Send each Owner their amount for payment by DuitNow or bank transfer. Invoicing is
manual for now.

---

## 8. What runs by itself

| When | What |
|---|---|
| Every night, 03:00 Malaysia time | Netlify's `daily` function calls `/api/cron/daily`, which: <br>1. removes moved-to-next-day Tickets still Waiting after 3 days, and sends "almost your turn" to anyone who moved up <br>2. erases Customer names and devices from Tickets that finished more than 30 days ago (PDPA). Ticket counts and billing are kept |
| Every push to `main` | Netlify builds and deploys the site. **Not** the database: see §3 |
| Any error in production | Recorded in Sentry, which emails the Operator if its alert rule is set up |

To run the nightly job by hand, open Netlify → *Functions* → `daily` → **Run now**. Running it
twice is safe.

---

## 9. When something goes wrong

| Symptom | Where to look |
|---|---|
| The whole site is down or "paused" | Netlify dashboard: credits used up on the Free plan. Upgrade |
| The Customer page or dashboard shows errors | Supabase dashboard: a Free project **pauses** after a week idle. Restore it, and consider Pro |
| An error email from Sentry | Sentry, for the message and the page it happened on |
| The nightly job failed | Netlify → *Functions* → `daily` log. A 401 there means `CRON_SECRET` in Netlify is wrong: fix it by hand in the Netlify UI |
| A Customer says "too far" while inside the Shop | Raise `joinRadiusM` (§6). Indoor GPS is often 20–100 m off |
| An Owner can't log in | Is the Shop switched off? (§6 *See one Shop*.) Otherwise reset the password |
| iPhone Customers miss alerts | Expected without Home Screen install. They must keep the page open |
| A code change works locally but breaks in production | Did the migration reach production? `bunx supabase db push --dry-run` |

More detail on every service is in [third-party.md](specs/third-party.md). Surprises found while
building are in [agents/gotchas.md](agents/gotchas.md).
