import { describe, expect, test } from "vitest";
import { toOwnerQueue } from "./view";

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
