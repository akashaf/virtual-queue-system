import type { Database } from "@/lib/supabase/database.types";

type JoiningState = Database["public"]["Enums"]["joining_state"];
type TicketStatus = Database["public"]["Enums"]["ticket_status"];
export type LastCallChoice = Database["public"]["Enums"]["last_call_choice"];
type RemovedReason = Database["public"]["Enums"]["removed_reason"];

/**
 * Everything a Customer is allowed to know: their Shop, and their own Ticket.
 * Deliberately not the Queue — names never reach a Customer's browser, so the
 * page cannot leak one however it is rendered.
 */
export interface CustomerView {
  shop: {
    /** The `shop:{id}` topic the page listens on for `queue_changed` pings. */
    id: string;
    name: string;
    isActive: boolean;
    joiningState: JoiningState;
    /** Waiting Tickets in the current Queue Day, shown before joining too. */
    waitingCount: number;
    /**
     * How few Waiting Tickets ahead count as "almost your turn". A Shop setting,
     * so it tells the browser nothing about anyone else.
     */
    headsUpThreshold: number;
  };
  /**
   * The last Ticket this device took in the Shop's current Queue Day, whatever
   * became of it. Not only an active one: a Customer whose Ticket the Owner
   * ended cannot otherwise be told which of No-show, Removed and Served happened
   * to them, because all three look the same from a page that only sees a Ticket
   * disappear.
   */
  ticket: {
    id: string;
    number: number;
    status: TicketStatus;
    /** Waiting Tickets with a lower number. Called Tickets are ahead of nobody. */
    position: number;
    /** The Customer's Last Call answer so far, changeable until Close Shop. */
    lastCallChoice: LastCallChoice | null;
    /** A Carried-over Ticket: moved from the previous Queue Day, once only. */
    carriedOver: boolean;
    /**
     * Why a Removed Ticket was removed: the Owner's doing reads differently
     * from the shop closing for the day.
     */
    removedReason: RemovedReason | null;
    /** Whether this Ticket is a No-show the Customer may still come back from. */
    canRejoin: boolean;
  } | null;
  /**
   * The Estimated Wait range, held only by a Waiting Ticket once the Shop has
   * Served enough Tickets today (backend.md §5) — null hides it entirely.
   */
  estimate: {
    minMinutes: number;
    maxMinutes: number;
  } | null;
}

/** The JSON `get_customer_view` and `join_queue` return, in the database's own names. */
interface CustomerViewJson {
  shop: {
    id: string;
    name: string;
    is_active: boolean;
    joining_state: JoiningState;
    waiting_count: number;
    heads_up_threshold: number;
  };
  ticket: {
    id: string;
    number: number;
    status: TicketStatus;
    position: number;
    last_call_choice: LastCallChoice | null;
    carried_over: boolean;
    removed_reason: RemovedReason | null;
    can_rejoin: boolean;
  } | null;
  estimate: {
    min_minutes: number;
    max_minutes: number;
  } | null;
}

/** Turns one of those payloads into the camelCase shape the app and its pages use. */
export function toCustomerView(json: unknown): CustomerView {
  const { shop, ticket, estimate } = json as CustomerViewJson;

  return {
    shop: {
      id: shop.id,
      name: shop.name,
      isActive: shop.is_active,
      joiningState: shop.joining_state,
      waitingCount: shop.waiting_count,
      headsUpThreshold: shop.heads_up_threshold,
    },
    ticket: ticket && {
      id: ticket.id,
      number: ticket.number,
      status: ticket.status,
      position: ticket.position,
      lastCallChoice: ticket.last_call_choice,
      carriedOver: ticket.carried_over,
      removedReason: ticket.removed_reason,
      canRejoin: ticket.can_rejoin,
    },
    estimate: estimate && {
      minMinutes: estimate.min_minutes,
      maxMinutes: estimate.max_minutes,
    },
  };
}

/**
 * The reasons a Customer function refuses, raised as the exception message.
 * Anything else is a bug rather than a Customer's situation, and is reported as
 * such.
 *
 * One list for all three of Join, Leave and Rejoin: they overlap heavily —
 * a Shop switched off or closing to new Customers refuses both ways in — and the
 * page needs one sentence for each token however it got there.
 */
export const CUSTOMER_ERRORS = [
  "shop_inactive",
  "last_call",
  "not_last_call",
  "already_in_queue",
  "too_far",
  "queue_full",
  "not_rejoinable",
  "ticket_not_found",
] as const;

export type CustomerError = (typeof CUSTOMER_ERRORS)[number];

/**
 * The statuses a Ticket never comes back from. The page shows one of these until
 * the Customer taps past it, rather than dropping them straight back on the join
 * form as though nothing had happened.
 */
const FINAL_STATUSES: TicketStatus[] = ["served", "no_show", "left", "removed"];

export function isFinalStatus(status: TicketStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

/** The longest name the `tickets_customer_name_length` constraint will take. */
export const MAX_CUSTOMER_NAME_LENGTH = 30;

export type NameProblem = "required" | "too_long";

/**
 * Checks a name the way the database does, so a bad one never reaches it.
 *
 * Measured in characters rather than in `String.length`, which counts an emoji
 * or any other astral character twice — Postgres `length()` counts it once, so
 * anything else would refuse a name the column would happily have taken.
 */
export function checkCustomerName(
  raw: string,
): { ok: true; name: string } | { ok: false; problem: NameProblem } {
  const name = raw.trim();
  if (name === "") return { ok: false, problem: "required" };
  if ([...name].length > MAX_CUSTOMER_NAME_LENGTH) {
    return { ok: false, problem: "too_long" };
  }
  return { ok: true, name };
}
