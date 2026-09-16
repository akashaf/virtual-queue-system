import { describe, expect, test } from "vitest";
import {
  applyMove,
  closeShopPlan,
  toOwnerQueue,
  UNDO_WINDOW_MS,
  type WaitingTicket,
} from "./view";

const json = {
  shop: { id: "s-1", name: "Kedai Ali", joining_state: "open" },
  waiting: [
    {
      id: "t-1",
      number: 1,
      name: "Ali",
      joined_at: "2026-09-14T07:05:00Z",
      origin: "scan",
      last_call_choice: null,
      carried_over: true,
    },
    {
      id: "t-2",
      number: 2,
      name: "Siti",
      joined_at: "2026-09-14T07:09:00Z",
      origin: "rejoin",
      last_call_choice: "stay",
      carried_over: false,
    },
  ],
  called: [
    {
      id: "t-0",
      number: 9,
      name: "Zul",
      called_at: "2026-09-14T07:02:00Z",
      no_show_in_ms: 42_000,
    },
  ],
  just_served: [
    {
      id: "t-x",
      number: 8,
      name: "Mei",
      called_at: "2026-09-14T07:20:00Z",
      no_show_in_ms: 61_000,
      undo_expires_in_ms: 94_000,
    },
  ],
};

describe("toOwnerQueue", () => {
  test("renames the database's fields, keeping the Queue in order", () => {
    expect(toOwnerQueue(json)).toEqual({
      shop: { id: "s-1", name: "Kedai Ali", joiningState: "open" },
      waiting: [
        {
          id: "t-1",
          number: 1,
          name: "Ali",
          joinedAt: "2026-09-14T07:05:00Z",
          origin: "scan",
          lastCallChoice: null,
          carriedOver: true,
        },
        {
          id: "t-2",
          number: 2,
          name: "Siti",
          joinedAt: "2026-09-14T07:09:00Z",
          origin: "rejoin",
          lastCallChoice: "stay",
          carriedOver: false,
        },
      ],
      called: [
        {
          id: "t-0",
          number: 9,
          name: "Zul",
          calledAt: "2026-09-14T07:02:00Z",
          noShowInMs: 42_000,
        },
      ],
      justServed: [
        {
          id: "t-x",
          number: 8,
          name: "Mei",
          calledAt: "2026-09-14T07:20:00Z",
          noShowInMs: 61_000,
          undoExpiresInMs: 94_000,
        },
      ],
    });
  });

  test("handles an empty Queue", () => {
    const queue = toOwnerQueue({ ...json, waiting: [], called: [], just_served: [] });

    expect(queue.waiting).toEqual([]);
    expect(queue.called).toEqual([]);
    expect(queue.justServed).toEqual([]);
  });

  test("keeps an erased name as null rather than inventing one", () => {
    const queue = toOwnerQueue({
      ...json,
      waiting: [
        {
          id: "t-1",
          number: 1,
          name: null,
          joined_at: "2026-09-14T07:05:00Z",
          origin: "scan",
          last_call_choice: null,
          carried_over: false,
        },
      ],
    });

    expect(queue.waiting[0].name).toBeNull();
  });
});

describe("applyMove", () => {
  const now = new Date("2026-09-14T07:30:00Z");
  const queue = toOwnerQueue(json);

  test("Call next puts the front of the Queue in a chair", () => {
    const moved = applyMove(queue, { kind: "call_next" }, now);

    expect(moved.waiting.map((ticket) => ticket.number)).toEqual([2]);
    expect(moved.called.map((ticket) => ticket.number)).toEqual([9, 1]);
    expect(moved.called[1].calledAt).toBe(now.toISOString());
  });

  test("Call next on an empty Queue changes nothing", () => {
    const empty = { ...queue, waiting: [] };

    expect(applyMove(empty, { kind: "call_next" }, now)).toEqual(empty);
  });

  test("Done moves a Ticket from the chair into the undo window", () => {
    const moved = applyMove(queue, { kind: "mark_served", ticketId: "t-0" }, now);

    expect(moved.called).toEqual([]);
    expect(moved.justServed[0]).toEqual({
      id: "t-0",
      number: 9,
      name: "Zul",
      calledAt: "2026-09-14T07:02:00Z",
      noShowInMs: 42_000,
      undoExpiresInMs: UNDO_WINDOW_MS,
    });
  });

  test("Undo puts a Ticket back in the chair it never really left", () => {
    const moved = applyMove(queue, { kind: "undo_served", ticketId: "t-x" }, now);

    expect(moved.justServed).toEqual([]);
    // The call it came from, not a new one: undo_served leaves called_at alone,
    // so inventing a fresh five minutes here would disable No-show for nothing.
    expect(moved.called[1]).toEqual({
      id: "t-x",
      number: 8,
      name: "Mei",
      calledAt: "2026-09-14T07:20:00Z",
      noShowInMs: 61_000,
    });
  });

  test("No-show takes the Customer out of the chair", () => {
    const moved = applyMove(queue, { kind: "mark_no_show", ticketId: "t-0" }, now);

    expect(moved.called).toEqual([]);
    // Nothing to undo: unlike Done, giving up on a Customer is final at once.
    expect(moved.justServed).toEqual(queue.justServed);
  });

  test("Remove takes a Ticket out of the Queue or the chair alike", () => {
    expect(
      applyMove(queue, { kind: "remove_ticket", ticketId: "t-1" }, now).waiting.map(
        (ticket) => ticket.id,
      ),
    ).toEqual(["t-2"]);
    expect(
      applyMove(queue, { kind: "remove_ticket", ticketId: "t-0" }, now).called,
    ).toEqual([]);
  });

  test("leaves a Ticket the screen no longer has alone", () => {
    expect(applyMove(queue, { kind: "mark_served", ticketId: "gone" }, now)).toEqual(
      queue,
    );
  });

  test("Last Call and Reopen only swing the door", () => {
    const closing = applyMove(queue, { kind: "start_last_call" }, now);
    expect(closing.shop.joiningState).toBe("last_call");
    expect(closing.waiting).toEqual(queue.waiting);

    const reopened = applyMove(closing, { kind: "cancel_last_call" }, now);
    expect(reopened.shop.joiningState).toBe("open");
    // Choices survive a reopen (§12 rule 2); only Close Shop spends them.
    expect(reopened.waiting).toEqual(queue.waiting);
  });

  test("Close Shop keeps only the unspent carry choices, renumbered from 1", () => {
    const waiting = [
      waitingTicket({ id: "w-1", number: 4, lastCallChoice: "stay" }),
      waitingTicket({ id: "w-2", number: 7, lastCallChoice: "carry" }),
      // Already carried once: tonight's carry choice no longer moves it.
      waitingTicket({ id: "w-3", number: 9, lastCallChoice: "carry", carriedOver: true }),
      waitingTicket({ id: "w-4", number: 11, lastCallChoice: "carry" }),
    ];
    const closing = { ...queue, shop: { ...queue.shop, joiningState: "last_call" as const }, waiting };

    const closed = applyMove(closing, { kind: "close_shop" }, now);

    expect(closed.shop.joiningState).toBe("open");
    expect(closed.waiting).toEqual([
      { ...waiting[1], number: 1, lastCallChoice: null, carriedOver: true },
      { ...waiting[3], number: 2, lastCallChoice: null, carriedOver: true },
    ]);
    // The old day's undo window closed with the old day.
    expect(closed.justServed).toEqual([]);
  });
});

describe("closeShopPlan", () => {
  test("counts the way close_shop will act, not the way the badges read", () => {
    const plan = closeShopPlan([
      waitingTicket({ id: "w-1", lastCallChoice: "carry" }),
      waitingTicket({ id: "w-2", lastCallChoice: "carry", carriedOver: true }),
      waitingTicket({ id: "w-3", lastCallChoice: "stay" }),
      waitingTicket({ id: "w-4" }),
    ]);

    expect(plan).toEqual({ moving: 1, removing: 3 });
  });

  test("an empty Queue moves and removes nobody", () => {
    expect(closeShopPlan([])).toEqual({ moving: 0, removing: 0 });
  });
});

function waitingTicket(overrides: Partial<WaitingTicket> & { id: string }): WaitingTicket {
  return {
    number: 1,
    name: "Ali",
    joinedAt: "2026-09-14T07:05:00Z",
    origin: "scan",
    lastCallChoice: null,
    carriedOver: false,
    ...overrides,
  };
}
