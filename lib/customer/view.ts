import type { Database } from "@/lib/supabase/database.types";

type JoiningState = Database["public"]["Enums"]["joining_state"];
type TicketStatus = Database["public"]["Enums"]["ticket_status"];

/**
 * Everything a Customer is allowed to know: their Shop, and their own Ticket.
 * Deliberately not the Queue — names never reach a Customer's browser, so the
 * page cannot leak one however it is rendered.
 */
export interface CustomerView {
  shop: {
    name: string;
    isActive: boolean;
    joiningState: JoiningState;
    /** Waiting Tickets in the current Queue Day, shown before joining too. */
    waitingCount: number;
  };
  ticket: {
    id: string;
    number: number;
    status: TicketStatus;
    /** Waiting Tickets with a lower number. Called Tickets are ahead of nobody. */
    position: number;
  } | null;
}

/** The JSON `get_customer_view` and `join_queue` return, in the database's own names. */
interface CustomerViewJson {
  shop: {
    name: string;
    is_active: boolean;
    joining_state: JoiningState;
    waiting_count: number;
  };
  ticket: {
    id: string;
    number: number;
    status: TicketStatus;
    position: number;
  } | null;
}

/** Turns one of those payloads into the camelCase shape the app and its pages use. */
export function toCustomerView(json: unknown): CustomerView {
  const { shop, ticket } = json as CustomerViewJson;

  return {
    shop: {
      name: shop.name,
      isActive: shop.is_active,
      joiningState: shop.joining_state,
      waitingCount: shop.waiting_count,
    },
    ticket: ticket && {
      id: ticket.id,
      number: ticket.number,
      status: ticket.status,
      position: ticket.position,
    },
  };
}

/**
 * The reasons `join_queue` refuses, raised as the exception message. Anything
 * else is a bug rather than a Customer's situation, and is reported as such.
 */
export const JOIN_ERRORS = [
  "shop_inactive",
  "last_call",
  "already_in_queue",
  "too_far",
  "queue_full",
] as const;

export type JoinError = (typeof JOIN_ERRORS)[number];

export function isJoinError(message: string | undefined): message is JoinError {
  return JOIN_ERRORS.includes(message as JoinError);
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
