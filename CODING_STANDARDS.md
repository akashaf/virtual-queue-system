# Coding standards

The rules a reviewer checks a diff against. Each one is a judgement call; anything typecheck,
lint or a test already enforces is left to them. The domain words are defined in `CONTEXT.md`,
the decisions in `docs/adr/`, and the traps in `docs/agents/gotchas.md`.

## Domain language

- **Code, comments, UI copy and SQL use the `CONTEXT.md` words**: Shop, Owner, Customer, Queue,
  Ticket, Called, Served, Heads-up. A diff that says "user", "booking", "appointment" or "client"
  for one of these is a violation. In prose and comments the terms are capitalised.
- **A new domain idea gets a `CONTEXT.md` entry in the same change.** A word the diff relies on
  that the glossary does not define is a finding. First look for an existing word that fits
  ("visitor" at the login page is the Owner); only a genuinely new idea earns a new entry.

## Comments

- **Comments say why, not what.** The reason a line is the way it is, the case it guards
  against, the decision it rests on.
- **A comment that rests on a decision cites it**: a spec section (`backend.md §7`) or an ADR
  (`ADR 0005`). A cited section must still say what the comment claims.
- **Every exported function and component in `app/` and `lib/` has a one-sentence doc
  comment** naming what it is in domain terms. Exempt: Next.js's special files (`page`,
  `layout`, `route` and the rest, where the file name says what it is), Server Actions (the
  `actions.ts` files; one kept anywhere else needs adding to the lint ignores) and types.
  `bun run lint` enforces its presence (`jsdoc/require-jsdoc`); review checks that it sits on
  the function it describes and says what it claims.

## Customer data

- **A Customer's name and coordinates reach only the Shop.** They never go to Sentry, OneSignal
  or a log line. Errors go through `lib/error-reporting.ts`; a new column or argument carrying
  either is added to its `PII_KEYS`. OneSignal is given the Ticket ID and nothing else
  (ADR 0005).
- **Alerts stay on the server.** They name other Customers' Tickets, so a mutation's `alerts`
  go through `dispatched()` and are never returned to the browser.

## Errors

- **A refusal the Customer or Owner can run into is a value, not a throw.** Server Actions
  return a result union whose reason is one the UI can show: `{ status: "rejected", reason }`
  on the Customer page, `OwnerOutcome` (`{ ok: false, reason }`, `lib/owner/view.ts`) on the
  dashboard. A new action takes the shape of its side of the app.
- **Anything else is a bug and is reported as one**: `functionErrorReason` or
  `reportUnexpected`, answered `failed`. A missing environment variable goes through
  `requireEnv` and fails loudly.
- **A thrown Server Action goes through `classifyActionFailure` (`lib/action-failure.ts`),
  and never leaves a busy screen up.** It is the one place that knows a `TypeError` is
  unreachable, that an older build's action reloads the page, and that anything else is
  `failed` for the caller to report. A called action catches and hands the error to it (the
  Customer page's `reachServer`, the board's `useOwnerAction`); a form's action is covered by
  `app/global-error.tsx`. A caller with its own `catch` ladder is a violation: the first deploy
  fix missed four callers for exactly that reason.

## Customer-facing text

- **Every string a Customer sees comes from `lib/i18n`**, written in English and Bahasa
  Malaysia. A hard-coded English string on the Customer page is a violation. The Owner
  dashboard and sign-in stay English-only.
- **Copy no code can verify is flagged in the hand-over**: steps through another app's menus
  or a phone's Settings (paths differ between OS versions and browsers), and new Bahasa
  Malaysia wording. List each one as needing a real-device or a BM speaker's check.

## Database

- **Every queue rule lives in a Postgres function** (backend.md §2). The app calls the function;
  it does not repeat the rule in TypeScript.
- **A migration opens with a comment** naming its issue or ADR and saying why it exists.
- **A redefined function is copied from the database, not an old migration** (see gotchas).

## Tests

- **A changed queue rule gets a database test** in `tests/db/`; pure logic gets a unit test in
  a `*.test.ts` file beside it in `app/` or `lib/`.
- **A test is named for the behaviour, in domain words**: "a Called Customer is chimed at until
  they say they're coming", not "test handleCall".
