import type { Database } from "@/lib/supabase/database.types";

type JoiningState = Database["public"]["Enums"]["joining_state"];
type TicketOrigin = Database["public"]["Enums"]["ticket_origin"];

export interface WaitingTicket {
  id: string;
  number: number;
  /** Null only after personal data has been erased, 30 days on. */
  name: string | null;
  joinedAt: string;
  /**
   * Whether this Ticket came from a Rejoin. It sits at the back with a high
   * number, but its Customer has been in the shop a while — worth saying.
   */
  rejoined: boolean;
}

export interface CalledTicket {
  id: string;
  number: number;
  name: string | null;
  calledAt: string;
  /**
   * How long until the Owner may give up on this Customer, measured by the
   * database for the same reason the Undo window is: a tablet with a wrong clock
   * must not offer a No-show that `mark_no_show` would answer `too_early`.
   */
  noShowInMs: number;
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
  no_show_in_ms: number;
}

interface ServedTicketJson {
  id: string;
  number: number;
  name: string | null;
  undo_expires_in_ms: number;
}

interface OwnerQueueJson {
  shop: { id: string; name: string; joining_state: JoiningState };
  waiting: {
    id: string;
    number: number;
    name: string | null;
    joined_at: string;
    origin: TicketOrigin;
  }[];
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
    noShowInMs: ticket.no_show_in_ms,
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

/** The least that identifies a Ticket to the screen that just acted on it. */
export interface TicketRef {
  id: string;
  number: number;
}

export function toTicketRef(json: unknown): TicketRef {
  const ticket = json as TicketRef;
  return { id: ticket.id, number: ticket.number };
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
      rejoined: ticket.origin === "rejoin",
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
  "rejoined",
  "too_early",
] as const;

export type OwnerError = (typeof OWNER_ERRORS)[number];

export function isOwnerError(message: string | undefined): message is OwnerError {
  return OWNER_ERRORS.includes(message as OwnerError);
}

/** What one press of an owner button did, or why it did nothing. */
export type OwnerOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; reason: OwnerError | "failed" };

/** The Undo window, as `undo_window()` in the database measures it. */
export const UNDO_WINDOW_MS = 120_000;

/** The wait before No-show, as `no_show_window()` in the database measures it. */
export const NO_SHOW_WINDOW_MS = 300_000;

/** One press of an owner button, named after the function it calls. */
export type QueueMove =
  | { kind: "call_next" }
  | { kind: "mark_served"; ticketId: string }
  | { kind: "undo_served"; ticketId: string }
  | { kind: "mark_no_show"; ticketId: string }
  | { kind: "remove_ticket"; ticketId: string };

/**
 * The Queue as it will look once a press lands, so the screen can move before
 * the round trip does (frontend.md §4.2). The refetch that follows replaces it
 * with the truth, so this only has to be right about the common case — a move
 * whose Ticket the screen no longer holds is simply not made.
 *
 * `now` is a parameter because the timestamps this invents are the caller's
 * clock, and because a pure function is one that can be tested.
 */
export function applyMove(queue: OwnerQueue, move: QueueMove, now: Date): OwnerQueue {
  switch (move.kind) {
    case "call_next": {
      const [next, ...rest] = queue.waiting;
      if (!next) return queue;

      return {
        ...queue,
        waiting: rest,
        called: [
          ...queue.called,
          {
            id: next.id,
            number: next.number,
            name: next.name,
            calledAt: now.toISOString(),
            noShowInMs: NO_SHOW_WINDOW_MS,
          },
        ],
      };
    }

    case "mark_served": {
      const served = queue.called.find((ticket) => ticket.id === move.ticketId);
      if (!served) return queue;

      return {
        ...queue,
        called: queue.called.filter((ticket) => ticket.id !== move.ticketId),
        justServed: [
          {
            id: served.id,
            number: served.number,
            name: served.name,
            undoExpiresInMs: UNDO_WINDOW_MS,
          },
          ...queue.justServed,
        ],
      };
    }

    // Both endings simply take the Ticket off the screen: unlike Done, neither
    // leaves anything behind to undo.
    case "mark_no_show":
    case "remove_ticket":
      return {
        ...queue,
        waiting: queue.waiting.filter((ticket) => ticket.id !== move.ticketId),
        called: queue.called.filter((ticket) => ticket.id !== move.ticketId),
      };

    case "undo_served": {
      const undone = queue.justServed.find((ticket) => ticket.id === move.ticketId);
      if (!undone) return queue;

      return {
        ...queue,
        justServed: queue.justServed.filter((ticket) => ticket.id !== move.ticketId),
        // The real called_at is the one the Customer was first summoned at, and
        // the database keeps it; the refetch brings it back a moment later.
        called: [
          ...queue.called,
          {
            id: undone.id,
            number: undone.number,
            name: undone.name,
            calledAt: now.toISOString(),
            noShowInMs: NO_SHOW_WINDOW_MS,
          },
        ],
      };
    }
  }
}


