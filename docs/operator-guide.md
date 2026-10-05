# Operator Guide

This guide explains how to run the Barbershop Virtual Queue every day: adding Shops, looking
after them, and collecting money at the end of the month. Words that start with a capital letter
(Shop, Owner, Ticket, Queue Day…) have a fixed meaning, explained in [CONTEXT.md](../CONTEXT.md).

- [1. Who uses the system](#1-who-uses-the-system)
- [2. Before you start](#2-before-you-start)
- [3. Add a new Shop](#3-add-a-new-shop)
- [4. How a normal day works](#4-how-a-normal-day-works)
- [5. Look after your Shops](#5-look-after-your-shops)
- [6. Monthly billing](#6-monthly-billing)
- [7. Things that happen automatically](#7-things-that-happen-automatically)
- [8. When something goes wrong](#8-when-something-goes-wrong)

---

## 1. Who uses the system

| Who | What they use | How they get in |
|---|---|---|
| **You, the Operator** | Commands you type in a terminal (`curl`) or Postman | A secret key called `OPERATOR_API_KEY` |
| **Owner** (the barber who runs a Shop) | The `/login` page, then `/dashboard`, on a phone or tablet | An email and password that **you** create for them. Owners cannot sign up or reset their own password |
| **Customer** (someone who walks in) | The Shop's page, opened by scanning the QR poster | No account needed. They must be at the Shop to join |

There is no admin website. Everything you do as Operator is a command sent to the system.

---

## 2. Before you start

Every command in this guide needs two things: the site address and your secret key. Run these
two lines once, each time you open a new terminal:

```bash
export BASE=https://virtual-queue-system.netlify.app
export OPERATOR_API_KEY=$(grep '^OPERATOR_API_KEY=' .env.netlify.production | cut -d= -f2-)
```

The key is saved in the file `.env.netlify.production`. This is the only copy you can read, so
don't lose it.

**Keep the key secret.** Never paste it into a chat, an email, a GitHub issue or a commit.
Anyone with this key can control every Shop.

---

## 3. Add a new Shop

You create a Shop and its Owner's login at the same time, with one command. Each Owner runs
exactly one Shop.

### Step 1: Prepare the details

| Field | What to enter | Tips |
|---|---|---|
| `slug` | 3–40 characters, using only `a-z`, `0-9` and `-` | This becomes part of the QR code link, and **it can never be changed**. Pick it carefully, for example `kedai-ali-bangsar` |
| `name` | The Shop's name | Customers see this. You can change it later |
| `lat`, `lng` | The Shop's location as two numbers | In Google Maps, press and hold on the Shop's front door, then copy the two numbers |
| `ownerEmail` | The Owner's email address | Used only to log in. The system never sends emails to it |
| `ownerPassword` | At least 10 characters | To make a strong one, run `openssl rand -base64 15` |
| `joinRadiusM` | Optional. A whole number of metres | How close a Customer must be to join. Default is **150** m |
| `headsUpThreshold` | Optional. A whole number | Customers get an "almost your turn" alert when this many people, or fewer, are ahead of them. Default is **3** |
| `maxQueueSize` | Optional. A whole number | The most Customers allowed in the Queue at once. Default is **30** |

### Step 2: Create the Shop

Change the values below to the real ones, then run it:

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

What the reply means:

| Reply | Meaning |
|---|---|
| **201** | Success. The reply includes `queueUrl` (the Customer page) and `qrUrl` (the poster image) |
| **400** `invalid_body` | One of the details is wrong. `field` says which one and `message` says why |
| **409** `slug_taken` | Another Shop already uses this slug. Pick a different one |
| **409** `email_taken` | This email already belongs to another Shop's Owner |
| **401** `unauthorized` | The key is wrong or missing. Repeat §2 |

If something fails, nothing is saved. Just fix the mistake and run the command again.

### Step 3: Download the QR code

```bash
curl -sS "$BASE/api/operator/shops/kedai-ali-bangsar/qr.png" \
  -H "Authorization: Bearer $OPERATOR_API_KEY" -o kedai-ali-bangsar-qr.png
```

This saves a square image. Put it on a poster (Canva works well) and print it. Then **scan the
printed poster with both an iPhone and an Android phone** to make sure it works.

### Step 4: Test it at the Shop

Go to the Shop, stand inside, scan the poster and join the Queue. If the page says you are too
far away, make the join distance bigger (see §5, *Change a Shop's settings*) and try again.
When it works, tap **Leave** so your test doesn't stay in the Queue.

### Step 5: Hand it over to the Owner

Give the Owner:
- the login page: `https://virtual-queue-system.netlify.app/login`
- their email and password (send these privately)
- the order of their day: **Call next → Done → Last Call → Close Shop** (see §4)

---

## 4. How a normal day works

```
Customer scans QR ─► joins (must be at the Shop) ─► Waiting, "N ahead of you"
                                                        │
                        "Almost your turn" alert ◄──────┤ when few people are ahead
                                                        │
Owner: Call next ─────────────────────────────────────► Called, "It's your turn"
                                                        │
          ┌──────────────────────┬──────────────────────┼──────────────────────┐
     Owner: Done            Owner: No-show         Owner: Remove        Customer: Leave
     (can Undo for 2 min)   (after 5 min)
          ▼                      ▼                      ▼                      ▼
       Served                 No-show                Removed                 Left
    (charged RM0.25)     (Customer can Rejoin once)
```

The Owner can **Remove**, and the Customer can **Leave**, at any time, not only after being called.

### What the Customer does

1. Scans the poster. This opens the Shop's page.
2. Types their name (1–30 characters) and taps **Join queue**. The phone asks to share
   location. Joining only works at the Shop, and only while the Shop is accepting people.
3. Allows notifications if the phone asks. Now they can walk away and wait somewhere else. They
   will get:
   - **Almost your turn**, when only a few people are ahead of them
   - **Your turn**, when the Owner calls them. If the page is open, this repeats until they tap
     *I'm coming*
4. Can tap **Leave** at any time.
5. If they miss their turn (No-show), they can **Rejoin** once, at the back of the Queue, on the
   same day. They don't need to be at the Shop to do this.

**iPhone users:** alerts only arrive while the page is open, unless they add the page to their
Home Screen. The page explains this to them.

### What the Owner does during the day

On the `/dashboard` page:

| Button | What it does |
|---|---|
| **Call next** | Calls the next Customer in line. If several chairs are free, press it once per chair |
| **Done** | The haircut is finished. The Customer is marked **Served**. **Undo** is available for 2 minutes in case of a mistake |
| **No-show** | The Customer was called but never came. This button appears 5 minutes after the call |
| **Remove** (in the ⋯ menu) | Takes someone out of the Queue |

The Owner can use the dashboard on several phones at the same time. They all stay in sync.

The `/dashboard/history` page shows today's Tickets, how many people were Served each day for
the last 30 days, and how much the Owner owes this month.

### What the Owner does at closing time

1. Press **Last Call**. Nobody new can join. Everyone still waiting is asked to choose:
   - **Stay today** (they might not get served before closing), or
   - **Move to next day** (they go to the front of the line next time the Shop opens)

   If the Owner changes their mind, **Reopen joining** undoes Last Call. Choices already made
   are kept.
2. Serve as many people as possible.
3. Press **Close Shop**. This only works when nobody is in the *Called* state, so finish those
   first with **Done** or **No-show**. After closing:
   - People who chose *Move to next day* are first in line next time, as #1, #2… in the same
     order as before.
   - Everyone else still waiting is removed and told the Shop has closed.
   - The Queue opens again straight away for the next day.

A Queue Day runs from one Close Shop to the next. It does not follow the calendar. Ticket numbers
start again at #1 after every Close Shop.

A Customer can only move to the next day **once**. If they are still waiting 3 days later, the
system removes them automatically (see §7).

---

## 5. Look after your Shops

All commands below need `BASE` and `OPERATOR_API_KEY` from §2.

### See all Shops

```bash
curl -sS "$BASE/api/operator/shops" -H "Authorization: Bearer $OPERATOR_API_KEY"
```

For each Shop you see the Owner's email, whether the Shop is switched on, and
`servedThisMonth` (how many Customers were Served this month).

### See one Shop

```bash
curl -sS "$BASE/api/operator/shops/kedai-ali-bangsar" -H "Authorization: Bearer $OPERATOR_API_KEY"
```

### Change a Shop's settings

Send only the settings you want to change. You can change `name`, `lat`, `lng`, `joinRadiusM`,
`headsUpThreshold`, `maxQueueSize` and `isActive`. You cannot change the slug.

This example makes the join distance 200 metres:

```bash
curl -sS -X PATCH "$BASE/api/operator/shops/kedai-ali-bangsar" \
  -H "Authorization: Bearer $OPERATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "joinRadiusM": 200 }'
```

### Switch a Shop off (for example, if it stops paying)

```bash
curl -sS -X PATCH "$BASE/api/operator/shops/kedai-ali-bangsar" \
  -H "Authorization: Bearer $OPERATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "isActive": false }'
```

After this:
- The Owner is logged out on all devices within about 10 minutes, and cannot log in again.
- Customers cannot join the Queue.
- Nothing is deleted. All history is kept.

To switch it back on, send `{ "isActive": true }` the same way.

### Reset an Owner's password

Use this when an Owner forgets their password. Make a new password with
`openssl rand -base64 15`, then:

```bash
curl -sS -X POST "$BASE/api/operator/shops/kedai-ali-bangsar/owner-password" \
  -H "Authorization: Bearer $OPERATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "password": "the-new-password" }'
```

A **204** reply means it worked. The Owner is logged out on every device, so send them the new
password privately.

### Change an Owner's email

This is not possible, and Shops cannot be deleted. If a Shop gets a new Owner, create a new Shop
with a new slug and a new poster, then switch the old Shop off.

---

## 6. Monthly billing

Owners pay **RM0.25 for every Served Customer** (every time they press **Done**). If they press
**Undo**, that Customer is not charged. Each charge belongs to the month, in Malaysia time, when
**Done** was pressed.

At the start of every month, get the totals for the month that just ended. Change `2026-08` to
that month:

```bash
curl -sS "$BASE/api/operator/billing?month=2026-08" -H "Authorization: Bearer $OPERATOR_API_KEY"
```

The reply looks like this:

```json
{
  "month": "2026-08",
  "shops": [{ "slug": "kedai-ali-bangsar", "name": "Kedai Gunting Ali", "servedCount": 412, "amountSen": 10300 }],
  "totalSen": 10300
}
```

Amounts are in **sen**, so 10300 means RM103.00. Every Shop is listed, even switched-off Shops
and Shops with nothing to pay.

Send each Owner their amount and ask them to pay by DuitNow or bank transfer. For now, you do
this by hand.

---

## 7. Things that happen automatically

| When | What happens |
|---|---|
| Every night at 3:00 am (Malaysia time) | The system cleans up: <br>1. Customers who moved to the next day but are still waiting after 3 days are removed. People behind them who move closer get their "almost your turn" alert <br>2. Customer names and device IDs are erased from Tickets older than 30 days, to protect their privacy (PDPA). The counts used for billing are kept |
| Whenever an error happens on the live site | It is recorded in Sentry, which can email you about it |

If the nightly cleanup didn't run, you can start it yourself: open Netlify → *Functions* →
`daily` → **Run now**. Running it twice does no harm.

---

## 8. When something goes wrong

| Problem | What to do |
|---|---|
| The whole site is down or shows "paused" | Open the Netlify dashboard. The free plan stops the site when its monthly allowance runs out. Upgrade to a paid plan |
| The Customer page or the dashboard shows errors | Open the Supabase dashboard. A free project goes to sleep after a week without use. Wake it up (restore it), and consider upgrading to Pro |
| You got an error email from Sentry | Open Sentry to see the error and which page it happened on |
| The nightly cleanup failed | Open Netlify → *Functions* → `daily` and read the log. If it shows **401**, the `CRON_SECRET` setting in Netlify is wrong. Fix it by hand in Netlify |
| A Customer is inside the Shop but the page says "too far" | Make `joinRadiusM` bigger (§5). Phone location indoors can be 20–100 m wrong |
| An Owner can't log in | Check whether the Shop is switched off (§5, *See one Shop*). If it is on, reset their password |
| Customers with iPhones miss their alerts | This is normal unless they added the page to their Home Screen. They need to keep the page open |

### Keep the site running safely

The site currently runs on free plans. **Before the first Shop starts paying you**, upgrade:
- **Netlify** to a paid plan. On the free plan, the whole site stops if the monthly allowance
  runs out, and every Shop's Queue goes offline. Until you upgrade, check the Netlify usage page
  often, and upgrade if it is above about 70% in the middle of the month.
- **Supabase** to Pro. The free plan has **no backups** and goes to sleep after 7 days without
  use. Pro makes a backup every day and never sleeps.
