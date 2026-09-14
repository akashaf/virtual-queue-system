import { describe, expect, test } from "vitest";
import { applyMove, toOwnerQueue, UNDO_WINDOW_MS } from "./view";

const json = {
  shop: { id: "s-1", name: "Kedai Ali", joining_state: "open" },
  waiting: [
    { id: "t-1", number: 1, name: "Ali", joined_at: "2026-09-14T07:05:00Z" },
    { id: "t-2", number: 2, name: "Siti", joined_at: "2026-09-14T07:09:00Z" },
  ],
  called: [{ id: "t-0", number: 9, name: "Zul", called_at: "2026-09-14T07:02:00Z" }],
  just_served: [
    { id: "t-x", number: 8, name: "Mei", undo_expires_in_ms: 94_000 },
  ],
};

describe("toOwnerQueue", () => {
  test("renames the database's fields, keeping the Queue in order", () => {
    expect(toOwnerQueue(json)).toEqual({
      shop: { id: "s-1", name: "Kedai Ali", joiningState: "open" },
      waiting: [
        { id: "t-1", number: 1, name: "Ali", joinedAt: "2026-09-14T07:05:00Z" },
        { id: "t-2", number: 2, name: "Siti", joinedAt: "2026-09-14T07:09:00Z" },
      ],
      called: [{ id: "t-0", number: 9, name: "Zul", calledAt: "2026-09-14T07:02:00Z" }],
      justServed: [{ id: "t-x", number: 8, name: "Mei", undoExpiresInMs: 94_000 }],
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
      waiting: [{ id: "t-1", number: 1, name: null, joined_at: "2026-09-14T07:05:00Z" }],
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
      undoExpiresInMs: UNDO_WINDOW_MS,
    });
  });

  test("Undo puts a Ticket back in the chair", () => {
    const moved = applyMove(queue, { kind: "undo_served", ticketId: "t-x" }, now);

    expect(moved.justServed).toEqual([]);
    expect(moved.called.map((ticket) => ticket.number)).toEqual([9, 8]);
  });

  test("leaves a Ticket the screen no longer has alone", () => {
    expect(applyMove(queue, { kind: "mark_served", ticketId: "gone" }, now)).toEqual(
      queue,
    );
  });
});
