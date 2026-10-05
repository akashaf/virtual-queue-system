# Operator Guide

This guide explains how to run the Barbershop Virtual Queue every day: adding Shops, looking
after them, and collecting money at the end of the month. Words that start with a capital letter
(Shop, Owner, Ticket, Queue Day…) have a fixed meaning, explained in [CONTEXT.md](../CONTEXT.md).

- [1. Who uses the system](#1-who-uses-the-system)
- [2. Set up Postman](#2-set-up-postman)
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
| **You, the Operator** | Postman, using the requests in `docs/openapi.yaml` | A secret key called `OPERATOR_API_KEY` |
| **Owner** (the barber who runs a Shop) | The `/login` page, then `/dashboard`, on a phone or tablet | An email and password that **you** create for them. Owners cannot sign up or reset their own password |
| **Customer** (someone who walks in) | The Shop's page, opened by scanning the QR poster | No account needed. They must be at the Shop to join |

There is no admin website. Everything you do as Operator is a request you send from Postman.

---

## 2. Set up Postman

You send every Operator request from [Postman](https://www.postman.com/downloads/). The file
[`openapi.yaml`](openapi.yaml), next to this guide, describes every request, so Postman can turn
each one into a form with a **Send** button. You only need to set this up once.

### Step 1: Import the requests

1. In Postman, click **Import** and choose `docs/openapi.yaml`.
2. Import it as a **collection**. You now have a folder called *Barbershop Virtual Queue —
   Operator API*, with every request inside.

If `openapi.yaml` changes later, import it again and replace the old collection.

### Step 2: Create two environments

An environment tells Postman which site to talk to, and with which key. Click
**Environments → +** and create these two:

| Environment | `baseUrl` | `bearerToken` |
|---|---|---|
| **Production** | `https://virtual-queue-system.netlify.app` | Your Operator key (see below) |
| **Local** | `http://127.0.0.1:3000` | `local-operator-key` |

For `bearerToken` in *Production*, set the type to **secret**. Copy the key from the
`OPERATOR_API_KEY=` line in the file `.env.netlify.production`. That file is the only copy you
can read, so don't lose it.

Then click the collection and open its **Authorization** tab. It should say **Bearer Token**
with `{{bearerToken}}` as the token; if not, set it that way. Every request in the collection now uses the key from whichever environment
you choose in the top-right corner.

**Keep the key secret.** Never paste it into a chat, an email, a GitHub issue or a commit, and
never export the Production environment to share it. Anyone with this key can control every Shop.

### Step 3: Check it works

Choose the *Production* environment, open **See all Shops** and click **Send**. A **200** reply
with a list of Shops means everything is set up. A **401** means the key is wrong.

### How to read the request cards in this guide

Each request below has a card like this. The same details are in Postman:

- The first line is the **method** (`GET`, `POST` or `PATCH`) and the **path**. `{slug}` means
  "put the Shop's slug here". In Postman, fill it in under *Params → Path Variables*.
- **Body fields** go in Postman's *Body* tab, as JSON. Postman fills in the example for you;
  change it to the real values.
- **Replies** lists every answer you might get back, and what each one means.

---

## 3. Add a new Shop

You create a Shop and its Owner's login at the same time, with one request. Each Owner runs
exactly one Shop.

### Step 1: Create the Shop

In Postman: **Shops → Add a new Shop**. Fill in the body with the real details, then click
**Send**.

`POST /api/operator/shops` · needs the key

| Body field | Type | Required | Rules and tips |
|---|---|---|---|
| `slug` | text | yes | 3–40 characters, using only `a-z`, `0-9` and `-`. It becomes part of the QR code link, and **it can never be changed**. Pick it carefully, for example `kedai-ali-bangsar` |
| `name` | text | yes | The Shop's name. Can't be blank. Customers see it. You can change it later |
| `lat` | number | yes | Between -90 and 90. In Google Maps, press and hold on the Shop's front door, then copy the first number |
| `lng` | number | yes | Between -180 and 180. The second number from Google Maps |
| `ownerEmail` | text | yes | The Owner's email address. Used only to log in. The system never sends emails to it |
| `ownerPassword` | text | yes | At least 10 characters. To make a strong one, run `openssl rand -base64 15` in a terminal |
| `joinRadiusM` | whole number | no | At least 1. How close, in metres, a Customer must be to join. Default **150** |
| `headsUpThreshold` | whole number | no | At least 1. Customers get an "almost your turn" alert when this many people, or fewer, are ahead of them. Default **3** |
| `maxQueueSize` | whole number | no | At least 1. The most Customers allowed in the Queue at once. Default **30** |

Example body:

```json
{
  "slug": "kedai-ali-bangsar",
  "name": "Kedai Gunting Ali",
  "lat": 3.1319,
  "lng": 101.671,
  "ownerEmail": "ali@example.com",
  "ownerPassword": "paste-the-generated-password"
}
```

| Reply | Meaning |
|---|---|
| **201** | Success. The reply shows the Shop, plus `queueUrl` (the Customer page) and `qrUrl` (the QR code image) |
| **400** `invalid_body` | One of the details is wrong. `field` says which one and `message` says why |
| **401** `unauthorized` | The key is wrong or missing. Check your environment (§2) |
| **409** `slug_taken` | Another Shop already uses this slug. Pick a different one |
| **409** `email_taken` | This email already belongs to another Shop's Owner |

If something fails, nothing is saved. Just fix the mistake and click **Send** again.

### Step 2: Download the QR code

In Postman: **Shops → Download the QR code**. Put the slug in the path, click **Send**, then
choose **Save response → Save to a file** and name it, for example, `kedai-ali-bangsar-qr.png`.

`GET /api/operator/shops/{slug}/qr.png` · needs the key

| Path value | Meaning |
|---|---|
| `slug` | The Shop, for example `kedai-ali-bangsar` |

| Reply | Meaning |
|---|---|
| **200** | The QR code, as a 1024×1024 PNG image |
| **401** `unauthorized` | The key is wrong or missing |
| **404** `not_found` | No Shop has that slug |

Put the image on a poster (Canva works well) and print it. Then **scan the printed poster with
both an iPhone and an Android phone** to make sure it works.

### Step 3: Test it at the Shop

Go to the Shop, stand inside, scan the poster and join the Queue. If the page says you are too
far away, make the join distance bigger (see §5, *Change a Shop's settings*) and try again.
When it works, tap **Leave** so your test doesn't stay in the Queue.

### Step 4: Hand it over to the Owner

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

### See all Shops

In Postman: **Shops → See all Shops**.

For each Shop you see the Owner's email, whether the Shop is switched on (`isActive`), and
`servedThisMonth` (how many Customers were Served this month). The oldest Shop comes first.

`GET /api/operator/shops` · needs the key

| Reply | Meaning |
|---|---|
| **200** | `{ "shops": [...] }`, every Shop |
| **401** `unauthorized` | The key is wrong or missing |

### See one Shop

In Postman: **Shops → See one Shop**.

`GET /api/operator/shops/{slug}` · needs the key

| Path value | Meaning |
|---|---|
| `slug` | The Shop, for example `kedai-ali-bangsar` |

| Reply | Meaning |
|---|---|
| **200** | The Shop, plus `queueUrl` and `qrUrl` |
| **401** `unauthorized` | The key is wrong or missing |
| **404** `not_found` | No Shop has that slug |

### Change a Shop's settings, or switch it off

In Postman: **Shops → Change a Shop's settings, or switch it off or on**. Send only the settings
you want to change.

Switching a Shop off (for example, if it stops paying) means:
- The Owner is logged out on all devices within about 10 minutes, and cannot log in again.
- Customers cannot join the Queue.
- Nothing is deleted. All history is kept.

`PATCH /api/operator/shops/{slug}` · needs the key

| Path value | Meaning |
|---|---|
| `slug` | The Shop, for example `kedai-ali-bangsar` |

| Body field | Type | Required | Rules |
|---|---|---|---|
| `name` | text | no | Can't be blank |
| `lat` | number | no | Between -90 and 90 |
| `lng` | number | no | Between -180 and 180 |
| `joinRadiusM` | whole number | no | At least 1 |
| `headsUpThreshold` | whole number | no | At least 1 |
| `maxQueueSize` | whole number | no | At least 1 |
| `isActive` | true / false | no | `false` switches the Shop off, `true` switches it back on |

Send at least one field. The slug can't be changed, and any other field name is refused, so a
typo can't be silently ignored.

Example bodies (Postman offers all three):

```json
{ "joinRadiusM": 200 }
```

```json
{ "isActive": false }
```

```json
{ "isActive": true }
```

| Reply | Meaning |
|---|---|
| **200** | The Shop after the change, plus `queueUrl` and `qrUrl` |
| **400** `invalid_body` | One of the details is wrong. `field` says which one and `message` says why |
| **401** `unauthorized` | The key is wrong or missing |
| **404** `not_found` | No Shop has that slug |

### Reset an Owner's password

Use this when an Owner forgets their password. Make a new password with
`openssl rand -base64 15` in a terminal. Then, in Postman: **Owners → Reset an Owner's
password**. The old password isn't needed.

`POST /api/operator/shops/{slug}/owner-password` · needs the key

| Path value | Meaning |
|---|---|
| `slug` | The Owner's Shop, for example `kedai-ali-bangsar` |

| Body field | Type | Required | Rules |
|---|---|---|---|
| `password` | text | yes | At least 10 characters |

Example body:

```json
{ "password": "the-new-password" }
```

| Reply | Meaning |
|---|---|
| **204** | Done. The Owner is logged out on every device. Send them the new password privately |
| **400** `invalid_body` | The password is too short |
| **401** `unauthorized` | The key is wrong or missing |
| **404** `not_found` | No Shop has that slug |

### Change an Owner's email

This is not possible, and Shops cannot be deleted. If a Shop gets a new Owner, create a new Shop
with a new slug and a new poster, then switch the old Shop off.

---

## 6. Monthly billing

Owners pay **RM0.25 for every Served Customer** (every time they press **Done**). If they press
**Undo**, that Customer is not charged. Each charge belongs to the month, in Malaysia time, when
**Done** was pressed.

At the start of every month, get the totals for the month that just ended. In Postman:
**Billing → Get one month's bill for every Shop**. Set `month` under *Params* to that month.

`GET /api/operator/billing?month=YYYY-MM` · needs the key

| Query value | Type | Required | Rules |
|---|---|---|---|
| `month` | text | yes | Written as `YYYY-MM`, for example `2026-08` |

| Reply | Meaning |
|---|---|
| **200** | The month's totals (example below) |
| **400** `invalid_query` | The month is missing or not written as `YYYY-MM` |
| **401** `unauthorized` | The key is wrong or missing |

A **200** reply looks like this:

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

To check whether the site is up at all, use **Health → Check the site is up** in Postman
(`GET /api/health`, no key needed). A **200** reply with `{ "ok": true }` means the site is
running.

Any request can also reply **500** `internal_error`. That means something unexpected went wrong.
The details are in Sentry.

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
