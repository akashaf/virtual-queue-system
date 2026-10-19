# Setting up OneSignal

This guide sets up OneSignal for the queue's Web Push ([ADR 0005](adr/0005-onesignal-delivers-web-push.md)), from a new account to a notification arriving on a locked iPhone. Do the parts in order. Part 4 changes production, so do it at a time when no Shop is open.

You will end up with two values:

| Name | What it is | Secret? | Where it goes |
|---|---|---|---|
| `NEXT_PUBLIC_ONESIGNAL_APP_ID` | Your OneSignal app's ID, a UUID | No, the browser sees it | Netlify, and `.env.local` for a dev app |
| `ONESIGNAL_REST_API_KEY` | An App API key, starting `os_v2_app_` | **Yes** | Netlify UI only, typed by hand |

Never paste the API key into a chat with an agent, a commit, a ticket or a terminal command. If it leaks, rotate it (Part 6).

OneSignal changes its dashboard from time to time. If a button has moved, its [Web Push setup docs](https://documentation.onesignal.com/docs/en/web-push-setup) describe the current layout.

---

## Part 1: Create the production app

1. Sign up or sign in at [onesignal.com](https://onesignal.com). The free plan is enough.
2. Create an **app** (OneSignal may call it an *app* or a *project*). Name it something you'll recognise, such as `Virtual Queue (production)`.
3. When asked which platform to set up first, choose **Web**.
4. For the integration type, choose **Custom Code**.
   - Not *Typical Site* and not *WordPress*. Custom Code means our code controls the prompt and the service worker, which it already does.
5. Fill in **Site setup**:

   | Field | Value | Why |
   |---|---|---|
   | **Site Name** | `Virtual Queue` | The fallback notification title. Ours always sends the Shop's name instead, so this rarely shows. |
   | **Site URL** | `https://virtual-queue-system.netlify.app` | Exactly this, with `https://` and no trailing slash or path. It must match the address in the QR codes. |
   | **Auto Resubscribe** | **On** | A Customer who clears their browser data is subscribed again without being asked. |
   | **Default Icon URL** | Optional. A square 256×256 PNG. | The icon shown on the notification. Without one, the browser uses its default. |

6. If the setup shows anything about **permission prompts**, a **slide prompt**, a **subscription bell** or a **welcome notification**, leave them **off**. The customer page asks through its own "Turn on alerts" sheet, and a second prompt would confuse people.
7. If it asks about **service worker paths**, ignore it. Custom Code doesn't use those fields. Our code registers `/OneSignalSDKWorker.js`, which is already in `public/`.
8. Click **Save**. If OneSignal then shows code to paste into your site, **skip it**: the code is already written.

### Safari settings

Older OneSignal setups asked for a separate *Safari Web ID* for Mac Safari. Current Safari (macOS 13+, iOS 16.4+) uses standard Web Push, so you don't need one. If the dashboard asks for Safari certificates, skip that step.

---

## Part 2: Get the App ID and create the API key

1. In the app, open **Settings** (the gear icon), then **Keys & IDs**.
2. Copy the **App ID** (a UUID such as `1a2b3c4d-…`). It isn't secret. Keep it to hand for Part 3.
3. Under **App API Keys**, click **Add Key**.
   - Name: `netlify-production`, so you can tell which key to revoke if it ever leaks.
   - IP allowlist: leave it **empty**. Netlify's functions don't have fixed IP addresses, so an allowlist would block our own server.
4. Click **Create**. The key, starting `os_v2_app_`, is shown **only once**.
   - Keep the page open and go straight to Part 3, step 3. Or save it in your password manager first.
   - If you lose it before saving it, delete the key and create a new one. A key can't be shown again.

---

## Part 3: Put the values in Netlify

Do this before deploying the code. The new code fails loudly without them: every alert errors, and the page treats push as off.

1. Open [app.netlify.com](https://app.netlify.com), then the `virtual-queue-system` site, then **Site configuration**, then **Environment variables**.
2. **Add the App ID** (public):
   - Click **Add a variable**, then **Add a single variable**.
   - Key: `NEXT_PUBLIC_ONESIGNAL_APP_ID`. Value: the App ID from Part 2.
   - Leave **Contains secret values** unticked. Same value for all deploy contexts.
   - Or, from a terminal (public values are fine through the CLI):
     `netlify env:set NEXT_PUBLIC_ONESIGNAL_APP_ID <app id> --context production`
3. **Add the API key** (secret), **in the browser only**:
   - Click **Add a variable**, then **Add a single variable**.
   - Key: `ONESIGNAL_REST_API_KEY`. Value: the `os_v2_app_…` key.
   - Tick **Contains secret values**.
   - On the Free plan the secret lands in every context and scope, and you can't narrow it. That's expected (see `docs/agents/gotchas.md`, *Netlify and secrets*).
4. Check both are there, by name and length only:
   `netlify env:list --context production`
   - Secret values can't be read back. The only real check is the test in Part 5.
5. **Keep the three `VAPID_*` variables for now.** The code running in production still uses them until Part 4. You remove them in Part 4, step 6.

---

## Part 4: Deploy

Pick a time when **no Shop has an open Queue**, such as late at night. Customers already waiting during the deploy lose phone notifications for the rest of that Ticket. In-page sound still works.

1. Confirm Part 3 is done: both OneSignal variables are in Netlify.
2. Push the commit that closes #29 to `main`. Netlify builds and deploys it, which takes a few minutes. Wait until the deploy shows **Published**.
3. **Straight away, migrate the production database.** A push to `main` doesn't do this.
   - Preview what will change: `bunx supabase db push --dry-run`. It should list `20261016120000_onesignal_push.sql`.
   - Apply it: `bunx supabase db push`.
   - Check: run `bunx supabase db push --dry-run` again. It should say *Remote database is up to date*.
   - Until the migration runs, the new code can't write to `push_sends`. That's why you migrate right after the deploy, and why the deploy happens while nobody is waiting.
4. Check the site is alive: `https://virtual-queue-system.netlify.app/api/health`.
5. Do the end-to-end test in Part 5.
6. Once Part 5 passes, **delete the old variables** in the Netlify UI: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. Nothing reads them any more.

---

## Part 5: Test it end to end

You need a test Shop, or a real Shop outside its hours, and two phones or a phone and a laptop: one as the Customer, one as the Owner dashboard.

### Android (quickest)

1. On an Android phone in Chrome, open the Shop's page (scan its QR code), join, and tap **Turn on alerts**, then **Allow**.
2. The page should say *Alerts are on — we'll notify you*.
3. In the OneSignal dashboard, open **Audience**, then **Subscriptions** (or **Users**). A new web push subscription should appear within a minute. Its user's **External ID** is the Ticket's ID, a UUID.
4. Lock the phone. On the Owner dashboard, press **Call next**.
5. The phone should show a notification titled with the Shop's name, reading *Queue alert: it's your turn (#001). Please go to the counter now.*. Tapping it opens the queue page.
6. In Supabase (Dashboard, then **SQL Editor**), run:
   ```sql
   select kind, outcome, notification_id, created_at
   from push_sends order by created_at desc limit 10;
   ```
   You should see a `called` row with outcome `sent` and a notification id. That id matches **Messages** (or **Delivery**) in the OneSignal dashboard.

### iPhone (the one that matters)

1. On an iPhone with iOS 16.4 or later, open the Shop's page in **Safari**. You'll see the install steps instead of the Join button.
2. Tap **Share**, then **Add to Home Screen**, then open the new icon from the Home Screen.
3. Join from inside the Home Screen app. Tap **Turn on alerts**, then **Allow**.
   - If the iPhone's permission dialog **doesn't appear** after tapping *Turn on alerts*, that's the one thing that couldn't be tested before deploy: iOS only shows it from a tap. Note what happened and report it so it can be fixed.
4. Lock the iPhone. Press **Call next** on the Owner dashboard. The notification should arrive on the lock screen.
5. Check `push_sends` as above.
   - OneSignal's dashboard will show this message as *sent*, never *delivered*: OneSignal can't confirm delivery for Safari. The lock screen is your proof.

### Malay text

Switch the queue page to **BM** before joining, and the notification should come in Malay (*Makluman giliran: tiba giliran anda (#001). Sila ke kaunter sekarang.*).

---

## Part 6: Day to day

- **"A Customer says they weren't notified."** Look up their Ticket's id, then:
  ```sql
  select kind, outcome, notification_id, created_at
  from push_sends where ticket_id = '<ticket id>' order by created_at;
  ```
  - **No rows:** no alert was due, or our code never sent one. That's a bug worth reporting.
  - **`no_subscriber`:** the Customer declined alerts, or hadn't finished the sheet yet.
  - **`error`:** OneSignal refused or couldn't be reached. Sentry has the status code.
  - **`sent`:** OneSignal accepted it. On an iPhone nobody can see further than that. Check the phone is on, has Focus/Do Not Disturb off, and that the Customer joined from the Home Screen app.
- **Nightly cleanup:** 30 days after a Ticket finishes, the nightly job deletes its user in OneSignal, along with the phone's subscription. The job's log (Netlify, then **Logs**, then **Functions**, then `daily`) reports `deletedOneSignalUsers`. Most nights it's 0 or small, because only Customers who allowed alerts ever had a user.
- **Rotating the API key** (if it leaks, or once a year):
  1. In OneSignal, open **Settings**, then **Keys & IDs**, then **Add Key**, and name it `netlify-production-2`.
  2. In the Netlify UI, edit `ONESIGNAL_REST_API_KEY` and paste the new key. Editing keeps it secret.
  3. Trigger a deploy (**Deploys**, then **Trigger deploy**) so the functions pick it up.
  4. Test one alert (Part 5), then delete the old key in OneSignal.
- **Free plan limit:** each send may target up to 10,000 web push subscribers. We send to one Ticket at a time, so this is never close.

---

## Optional: a dev app for testing on your laptop

Without OneSignal values in `.env.local`, local development treats push as off. This is deliberate: you get no sheet, the "keep this page open" banner, and a *Missing environment variable* log whenever an alert is due. To test push locally:

1. Repeat Part 1 with a **second app** named `Virtual Queue (dev)` and **Site URL** `http://localhost:3000`. Never point the production app at localhost.
2. Repeat Part 2 for that app, naming the key `local-dev`.
3. Put both values in `.env.local`:
   ```
   NEXT_PUBLIC_ONESIGNAL_APP_ID=<dev app id>
   ONESIGNAL_REST_API_KEY=<dev key>
   ```
4. Restart `bun run dev`. Desktop Chrome on `http://localhost:3000` can now subscribe (the code sets `allowLocalhostAsSecureOrigin` in development), and alerts arrive as desktop notifications.
5. iPhones can't test against localhost. Use the production test in Part 5 for those.

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| The page always says *Keep this page open*, even after allowing | `NEXT_PUBLIC_ONESIGNAL_APP_ID` missing from the build, or the Site URL doesn't match | Check the Netlify variable, then **Trigger deploy** (a `NEXT_PUBLIC_` value is baked in at build time). Check that the Site URL is exactly `https://virtual-queue-system.netlify.app`. |
| Every alert is `error` in `push_sends`, Sentry says *OneSignal answered 401/403* | Wrong or revoked API key | Re-enter `ONESIGNAL_REST_API_KEY` in the Netlify UI and trigger a deploy. |
| Netlify logs *Missing environment variable ONESIGNAL_REST_API_KEY* | The key was never added, or was added with the CLI `--scope` flag (fails silently on Free) | Add it in the UI (Part 3, step 3). |
| Everything is `no_subscriber`, even for Customers who allowed | The page subscribed in a different OneSignal app from the one the server sends with | Make sure the App ID in Netlify and the API key both come from the **production** app. |
| Android works, iPhone gets nothing | Customer joined in Safari, not the Home Screen app; or iOS older than 16.4; or Focus mode | The install gate should stop Safari joins. Check the iOS version, and Settings, then Notifications, then the app's name. |
| `push_sends` errors saying *relation does not exist* | Part 4, step 3 (database migration) not run | Run `bunx supabase db push`. |
