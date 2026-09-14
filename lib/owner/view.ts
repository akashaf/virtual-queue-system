import type { Database } from "@/lib/supabase/database.types";

type JoiningState = Database["public"]["Enums"]["joining_state"];

export interface WaitingTicket {
  id: string;
  number: number;
  /** Null only after personal data has been erased, 30 days on. */
  name: string | null;
  joinedAt: string;
}

export interface CalledTicket {
  id: string;
  number: number;
  name: string | null;
  calledAt: string;
}

/** A Ticket the Owner has marked done, while its Undo window is still open. */
export interface ServedTicket {
  id: string;
  number: number;
  name: string | null;
  /**
   * How long is left to take this Done back, measured by the database rather
   * than by the screen: a tablet with a wrong clock must not offer an Undo that
   * `undo_served` would then refuse.
   */
  undoExpiresInMs: number;
}

/** The Owner's live Queue: who is waiting, who is in a chair, what can still be undone. */
export interface OwnerQueue {
  shop: { id: string; name: string; joiningState: JoiningState };
  waiting: WaitingTicket[];
  called: CalledTicket[];
  justServed: ServedTicket[];
}

/** The JSON the owner functions return, in the database's own names. */
interface CalledTicketJson {
  id: string;
  number: number;
  name: string | null;
  called_at: string;
}

interface ServedTicketJson {
  id: string;
  number: number;
  name: string | null;
  undo_expires_in_ms: number;
}

interface OwnerQueueJson {
  shop: { id: string; name: string; joining_state: JoiningState };
  waiting: { id: string; number: number; name: string | null; joined_at: string }[];
  called: CalledTicketJson[];
  just_served: ServedTicketJson[];
}

export function toCalledTicket(json: unknown): CalledTicket {
  const ticket = json as CalledTicketJson;
  return {
    id: ticket.id,
    number: ticket.number,
    name: ticket.name,
    calledAt: ticket.called_at,
  };
}

export function toServedTicket(json: unknown): ServedTicket {
  const ticket = json as ServedTicketJson;
  return {
    id: ticket.id,
    number: ticket.number,
    name: ticket.name,
    undoExpiresInMs: ticket.undo_expires_in_ms,
  };
}

export function toOwnerQueue(json: unknown): OwnerQueue {
  const { shop, waiting, called, just_served: justServed } = json as OwnerQueueJson;

  return {
    shop: { id: shop.id, name: shop.name, joiningState: shop.joining_state },
    waiting: waiting.map((ticket) => ({
      id: ticket.id,
      number: ticket.number,
      name: ticket.name,
      joinedAt: ticket.joined_at,
    })),
    called: called.map(toCalledTicket),
    justServed: justServed.map(toServedTicket),
  };
}

/**
 * The reasons an owner function refuses, raised as the exception message. Like
 * the Customer's tokens, anything else is a bug rather than a situation the
 * Owner has run into, and is reported as one.
 */
export const OWNER_ERRORS = [
  "shop_inactive",
  "queue_empty",
  "ticket_not_found",
  "undo_expired",
] as const;

export type OwnerError = (typeof OWNER_ERRORS)[number];

export function isOwnerError(message: string | undefined): message is OwnerError {
  return OWNER_ERRORS.includes(message as OwnerError);
}

/** What one press of an owner button did, or why it did nothing. */
export type OwnerOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; reason: OwnerError | "failed" };
