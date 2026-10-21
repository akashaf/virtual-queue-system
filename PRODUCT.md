# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three audiences, defined in [CONTEXT.md](CONTEXT.md):

- **Customer**: a walk-in at a Shop (today, a Malaysian barbershop) who scans the Shop's QR poster on their own phone. No account; known only by the display name they type and their device. Their job is to hold a place in the Queue, leave the shop if they like, and come back in time. They glance at the page in short bursts, often from another tab or a locked phone, and rely on the alert to come back.
- **Owner**: the person who runs a Shop's Queue from a phone or tablet at the counter, while also serving (at a barbershop, the barber, between and during haircuts). Their job is to call the next Customer, mark each one Served, and close the day, with as few taps and as few mistakes as possible.
- **Operator**: the platform owner, who onboards Shops, creates Owner accounts and bills monthly. Works through Postman against `docs/openapi.yaml`; there is no Operator website.

## Product Purpose

Walk-in customers join a Shop's queue from their phone instead of waiting on site, and are alerted when their turn approaches. Owners run the queue from a dashboard. Success for a Customer is coming back at the right time without missing their turn; for an Owner, a queue that runs itself with no arguments over who was first.

This is a general virtual queue system. Barbershops in Malaysia are the first market; other walk-in businesses (clinics, service counters and the like) are meant to run on the same system later, so barbershop wording belongs in copy, not in the queue model. WhatsApp and SMS alerts are a planned upgrade alongside web push (ADR 0001).

## Positioning

- **Nothing to install.** Customers scan a QR code and join in the browser, with no app and no account. Owners run the Queue from a phone browser. (iPhone Customers add the page to the Home Screen so push alerts work; that is a browser step, not an app install.)
- **Pay only per customer served.** RM0.25 per Served Ticket (at a barbershop, per haircut), from the first day, invoiced monthly. No monthly fee, so a quiet month costs almost nothing.
- **An honest walk-in queue.** A Customer must be within the Shop's Join Radius to join, a device holds at most one active Ticket per Shop, and there are no bookings, so the Queue cannot be gamed from home.

## Operating Context

- Customers arrive only by the QR poster; the bare domain sends Owners to `/login`.
- One shop-wide, first-come Queue per Shop; any free chair takes the next Ticket. Barbers and in-person Customers without a Ticket are not modelled.
- The Queue Day runs from one Close Shop to the next, not by calendar or opening hours. Last Call lets waiting Customers move to the next day.
- Alerts are web push via OneSignal plus sound, vibration and title flashing on the open page. Push may be unavailable (in-app browsers, iPhone Safari not added to the Home Screen), so the open page must work as the only alert. WhatsApp, then possibly SMS, is the planned next channel.
- All times are Malaysia time, 12-hour format. Billing months follow Asia/Kuala_Lumpur.
- Full behaviour per screen and state: [docs/specs/frontend.md](docs/specs/frontend.md); daily operation: [docs/operator-guide.md](docs/operator-guide.md).

## Capabilities and Constraints

- Customer page `/s/[slug]`: join, wait, Heads-up, Called, Leave, Rejoin, Last Call choice, and every final-state screen. English and Bahasa Malaysia with an EN | BM toggle.
- Owner app: `/login`, `/dashboard` (live queue), `/dashboard/history` (today's Tickets, Served counts, amount due). English only.
- Shops are onboarded by the Operator only; Owners cannot sign up or reset their own password.
- Mobile-first: 360 px minimum width, touch targets of at least 44 px.
- Official shadcn/ui components only; colours come from theme tokens only, so a Shop's look can later change by overriding tokens (enforced by `lib/theme-tokens.test.ts`).
- Dark mode follows the device setting; there is no toggle.
- Hosted on Netlify's free plan until the first paying Shop (ADR 0003).
- Domain vocabulary in CONTEXT.md is binding in UI copy (Ticket, Queue, Called, Served, No-show…); avoid the listed synonyms.
- **Undecided:** the product name. "Virtual Queue System" is a working title; the name should not tie the product to barbershops.

## Brand Commitments

None yet. No name, logo or voice guide has been decided.

## Evidence on Hand

None. No Shop is live, so there are no real customers, usage numbers, testimonials, photos or Owner quotes. Future work must not invent any of these.

## Product Principles

1. **The open page is the alert of last resort.** Never rely on push or sound alone; the Customer must be able to see their state at a glance.
2. **Fairness is visible.** The Customer sees only their own Ticket and how many are ahead, and the rules (be at the shop, one Ticket per device) are explained plainly when they block someone.
3. **Owners work with their hands full.** Every dashboard action is one obvious tap, guarded against double taps and mis-taps, with Undo where a mistake costs a Customer.
4. **Every ending has a way on.** No Customer state is a dead end.
5. **Say it in the Shop's words, in the Customer's language.** Plain English or Bahasa Malaysia, using the domain terms, never jargon.

## Accessibility & Inclusion

- Ticket number at least 64 px on the Customer page, AA contrast.
- States announced with `aria-live="polite"`, and `assertive` for Called.
- Called is also a full-screen colour change, so sound is never the only signal.
- Customer copy in English and Bahasa Malaysia.
