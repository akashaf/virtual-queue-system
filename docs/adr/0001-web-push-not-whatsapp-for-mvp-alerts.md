# Web push plus in-page alerts, not WhatsApp or SMS, for MVP

Customers are alerted by Web Push where the browser supports it, plus in-page sound, vibration and title flashing while the queue page is open. iOS Safari only delivers Web Push to sites installed to the Home Screen (iOS 16.4+), which walk-in customers will not do, so many iPhone users get in-page alerts only. We accept that gap for the MVP because WhatsApp (Meta Cloud API) needs business verification, customer phone numbers and a per-message fee, and SMS costs eat into the RM0.25 per Served Ticket margin. WhatsApp is the planned phase 2 upgrade.

## Amendment (2026-10-16): iPhone Customers must install to join

Testing in production showed that the "keep this page open" fallback does not hold up on an iPhone. Locking the phone, or switching apps, freezes the Safari tab, so no alert arrives until the Customer looks again. Push from a Home Screen install did arrive on a locked phone. So for the MVP, an iPhone on iOS 16.4 or later must join from the Home Screen app. In Safari, the join form shows the install steps instead of the Join button. Inside WhatsApp, Instagram and other in-app browsers, which cannot install, it first says to open the page in Safari.

- **Advice comes before joining, never after.** The Home Screen app does not share cookies with Safari, so a Ticket joined in Safari stays in Safari. Advising someone to install after they join would put them in the Queue twice.
- **Installing is required; allowing notifications is not.** A refusal cannot be asked again, so requiring it would lock a Customer out for good. A Customer who declines still joins and gets the in-page alerts.
- **iOS older than 16.4 is exempt.** It has no Web Push even when installed, so it joins from Safari as before.
- **Existing Tickets are exempt.** A Ticket already joined in Safari keeps working there, and Rejoin from a No-show page stays allowed wherever that page is open.
- **Accepted cost.** An iPhone Customer who will not install cannot get a Ticket. They wait in the shop as an In-person Customer, unrecorded and unbilled. We chose reliable alerts over that lost Served Ticket for the MVP, and may revisit it with an escape link, or with WhatsApp in phase 2.
