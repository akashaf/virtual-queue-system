import type { CustomerView } from "@/lib/customer/view";

/**
 * What the open customer page is alerting about (frontend.md §3.3), decided by
 * comparing each view the page receives with the one before it.
 *
 * Pure, so every rule below is a unit test rather than a browser session; the
 * sound, vibration and title flashing that act on it live in
 * `lib/alert-effects.ts`.
 *
 * A Heads-up fires only on a *change the page saw happen*, never on a state it
 * merely found: a Customer who has just joined is looking at the page — the same
 * reason the database stamps a Ticket that joins inside the threshold without
 * alerting it (backend.md §4).
 *
 * Called is the exception, in `initialPageAlerts`. iPhone Safari discards tabs
 * left in the background, and this page is its only alert, so a Customer who
 * comes back to a reloaded page that is already Called is rung for. The page
 * cannot tell that from someone opening it fresh, and one chime too many is the
 * cheaper mistake. For the same reason a Called view arriving after one that
 * did not hold the Ticket rings too: views can land out of order (#31).
 */
export interface PageAlerts {
  /**
   * The Ticket this page has given its Heads-up. Kept, not cleared, because a
   * Heads-up is once per page: a Ticket pushed back out and in again is not told
   * twice.
   */
  headsUpTicketId: string | null;
  /** The Called Ticket whose chime repeats until the Customer taps "Stop the alert". */
  ringingTicketId: string | null;
  /**
   * The Ticket the Customer tapped "Stop the alert" for. Remembered rather than
   * inferred from the ringing having stopped, because views can arrive out of
   * order (#31): a Called view after a stale one must not ring for it again.
   */
  acknowledgedTicketId: string | null;
}

export const NO_PAGE_ALERTS: PageAlerts = {
  headsUpTicketId: null,
  ringingTicketId: null,
  acknowledgedTicketId: null,
};

/** The alerts for a page that has just loaded with `view`: ringing if already Called. */
export function initialPageAlerts(view: CustomerView): PageAlerts {
  return view.ticket?.status === "called"
    ? { ...NO_PAGE_ALERTS, ringingTicketId: view.ticket.id }
    : NO_PAGE_ALERTS;
}

/**
 * Whether the Ticket is Waiting with the Shop's Heads-up Threshold or fewer ahead
 * of it — when the page says "Head back to the shop now".
 *
 * Waiting only: every other status reports position 0, which would otherwise
 * read as being next.
 */
export function isHeadsUpReached(view: CustomerView): boolean {
  return (
    view.ticket?.status === "waiting" &&
    view.ticket.position <= view.shop.headsUpThreshold
  );
}

/**
 * The alerts after the page moves from `previous` to `next`.
 *
 * Returns `alerts` itself when nothing changed, so a caller holding it in state
 * does not re-render for every quiet refetch.
 */
export function nextPageAlerts(
  alerts: PageAlerts,
  previous: CustomerView,
  next: CustomerView,
): PageAlerts {
  const before = previous.ticket;
  const after = next.ticket;
  // A different Ticket — a join, a Rejoin — is a new place, not a move.
  const sameTicket = before !== null && after !== null && before.id === after.id;
  // Close Shop puts a carried Ticket at the front of the next Queue Day. That is
  // not a move up either: the Customer chose to come back tomorrow, and the
  // database stamps no Heads-up at closing time for the same reason (#11).
  // A tab that slept through Close Shop and wakes inside the threshold stays
  // quiet too; it only wakes when the Customer comes back to it, so they are
  // looking at the banner, and the server's own Heads-up push still reaches them.
  const carriedTonight = sameTicket && !before.carriedOver && after.carriedOver;

  let { headsUpTicketId, ringingTicketId } = alerts;

  if (
    sameTicket &&
    !carriedTonight &&
    headsUpTicketId !== after.id &&
    before.status === "waiting" &&
    !isHeadsUpReached(previous) &&
    isHeadsUpReached(next)
  ) {
    headsUpTicketId = after.id;
  }

  // Waiting to Called, or Called from a view without this Ticket, which the page
  // treats like loading already Called. Served back to Called is an Owner undoing
  // a mis-tap: the Customer was told once already, and is sitting in the chair.
  if (
    after?.status === "called" &&
    after.id !== alerts.acknowledgedTicketId &&
    (!sameTicket || before.status === "waiting")
  ) {
    ringingTicketId = after.id;
  } else if (after?.status !== "called" || after.id !== ringingTicketId) {
    ringingTicketId = null;
  }

  return headsUpTicketId === alerts.headsUpTicketId &&
    ringingTicketId === alerts.ringingTicketId
    ? alerts
    : { ...alerts, headsUpTicketId, ringingTicketId };
}

/** The Customer tapped "Stop the alert": the Called chime stops for good. */
export function acknowledgeCalled(alerts: PageAlerts): PageAlerts {
  return alerts.ringingTicketId === null
    ? alerts
    : { ...alerts, ringingTicketId: null, acknowledgedTicketId: alerts.ringingTicketId };
}
