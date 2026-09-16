import type { Database } from "@/lib/supabase/database.types";

type JoiningState = Database["public"]["Enums"]["joining_state"];
type TicketOrigin = Database["public"]["Enums"]["ticket_origin"];
type LastCallChoice = Database["public"]["Enums"]["last_call_choice"];

export interface WaitingTicket {
  id: string;
  number: number;
  /** Null only after personal data has been erased, 30 days on. */
  name: string | null;
  joinedAt: string;
  /**
   * How the Customer got here. A Rejoin sits at the back with a high number, but
   * its Customer has been in the shop a while — worth saying on the screen.
   */
  origin: TicketOrigin;
  /** What this Customer answered during Last Call, if anything yet. */
  lastCallChoice: LastCallChoice | null;
  /** Moved from the previous Queue Day; one carry is all a Ticket gets. */
  carriedOver: boolean;
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
   * The call this Ticket came from, kept because Undo puts the Customer back in
   * the chair they were already in — `undo_served` deliberately leaves
   * `called_at` alone, so the screen must not start the clock again either.
   */
  calledAt: string;
  noShowInMs: number;
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
  called_at: string;
  no_show_in_ms: number;
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
    last_call_choice: LastCallChoice | null;
    carried_over: boolean;
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
    calledAt: ticket.called_at,
    noShowInMs: ticket.no_show_in_ms,
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

/** Where a Last Call press left the door: the least its screen needs back. */
export interface JoiningStateResult {
  joiningState: JoiningState;
}

export function toJoiningStateResult(json: unknown): JoiningStateResult {
  const result = json as { joining_state: JoiningState };
  return { joiningState: result.joining_state };
}

/** What Close Shop did: who moved to the new Queue Day, and who was removed. */
export interface CloseShopResult {
  carriedOver: number;
  removed: number;
}

export function toCloseShopResult(json: unknown): CloseShopResult {
  const result = json as { carried_over: number; removed: number };
  return { carriedOver: result.carried_over, removed: result.removed };
}

/**
 * Whether `close_shop` will move this Ticket to the new Queue Day: only a
 * carry choice that has not already been honoured — a Carried-over Ticket used
 * its one carry, whatever it answers tonight. The confirmation's counts and
 * the optimistic close both read this, so neither can drift from the rule.
 */
function willCarry(ticket: WaitingTicket): boolean {
  return ticket.lastCallChoice === "carry" && !ticket.carriedOver;
}

/** What Close Shop is about to do, for the confirmation dialog. */
export function closeShopPlan(waiting: WaitingTicket[]): {
  moving: number;
  removing: number;
} {
  const moving = waiting.filter(willCarry).length;
  return { moving, removing: waiting.length - moving };
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
      origin: ticket.origin,
      lastCallChoice: ticket.last_call_choice,
      carriedOver: ticket.carried_over,
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
  "tickets_still_called",
] as const;

export type OwnerError = (typeof OWNER_ERRORS)[number];

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
  | { kind: "remove_ticket"; ticketId: string }
  | { kind: "start_last_call" }
  | { kind: "cancel_last_call" }
  | { kind: "close_shop" };

/**
 * The Queue as it will look once a press lands, so the screen can move before
 * the round trip does (frontend.md §4.2). The refetch that follows replaces it
 * with the truth, so this only has to be right about the common case — a move
 * whose Ticket the screen no longer holds is simply not made.
 *
 * `now` is a parameter because the timestamps this invents are the caller's
 * clock, and because a pure function is one that can be tested.
 */
function inChair(
  ticket: { id: string; number: number; name: string | null },
  calledAt: string,
  noShowInMs: number,
): CalledTicket {
  return {
    id: ticket.id,
    number: ticket.number,
    name: ticket.name,
    calledAt,
    noShowInMs,
  };
}

export function applyMove(queue: OwnerQueue, move: QueueMove, now: Date): OwnerQueue {
  switch (move.kind) {
    case "call_next": {
      const [next, ...rest] = queue.waiting;
      if (!next) return queue;

      return {
        ...queue,
        waiting: rest,
        // A call just made: the whole No-show wait is still ahead of it.
        called: [
          ...queue.called,
          inChair(next, now.toISOString(), NO_SHOW_WINDOW_MS),
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
            calledAt: served.calledAt,
            noShowInMs: served.noShowInMs,
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
        // Back in the chair they never really left: `undo_served` keeps the
        // original call, so the screen restores it rather than starting again.
        called: [
          ...queue.called,
          inChair(undone, undone.calledAt, undone.noShowInMs),
        ],
      };
    }

    case "start_last_call":
      return { ...queue, shop: { ...queue.shop, joiningState: "last_call" } };

    case "cancel_last_call":
      return { ...queue, shop: { ...queue.shop, joiningState: "open" } };

    case "close_shop":
      return {
        ...queue,
        shop: { ...queue.shop, joiningState: "open" },
        // The same rule close_shop applies: unspent carry choices move to the
        // front of the new day, renumbered 1..k in original order with the
        // choice honoured and cleared; everyone else's day is over — as is the
        // old day's undo window, which belonged to the Queue Day that closed.
        waiting: queue.waiting
          .filter(willCarry)
          .map((ticket, index) => ({
            ...ticket,
            number: index + 1,
            lastCallChoice: null,
            carriedOver: true,
          })),
        justServed: [],
      };
  }
}


