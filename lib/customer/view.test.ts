import { describe, expect, test } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import {
  checkCustomerName,
  isFinalStatus,
  MAX_CUSTOMER_NAME_LENGTH,
  toCustomerView,
} from "./view";

type TicketStatus = Database["public"]["Enums"]["ticket_status"];

describe("toCustomerView", () => {
  test("renames the database's fields without changing them", () => {
    expect(
      toCustomerView({
        shop: {
          id: "s-1",
          name: "Kedai Ali",
          is_active: true,
          joining_state: "open",
          waiting_count: 4,
          heads_up_threshold: 3,
        },
        ticket: {
          id: "t-1",
          number: 17,
          status: "waiting",
          position: 3,
          last_call_choice: "carry",
          carried_over: true,
          removed_reason: null,
          can_rejoin: false,
        },
      }),
    ).toEqual({
      shop: {
        id: "s-1",
        name: "Kedai Ali",
        isActive: true,
        joiningState: "open",
        waitingCount: 4,
        headsUpThreshold: 3,
      },
      ticket: {
        id: "t-1",
        number: 17,
        status: "waiting",
        position: 3,
        lastCallChoice: "carry",
        carriedOver: true,
        removedReason: null,
        canRejoin: false,
      },
    });
  });

  test("says why a Removed Ticket was removed, which decides the goodbye", () => {
    const view = toCustomerView({
      shop: {
        id: "s-1",
        name: "Kedai Ali",
        is_active: true,
        joining_state: "open",
        waiting_count: 0,
        heads_up_threshold: 3,
      },
      ticket: {
        id: "t-1",
        number: 17,
        status: "removed",
        position: 0,
        last_call_choice: null,
        carried_over: false,
        removed_reason: "close_shop",
        can_rejoin: false,
      },
    });

    expect(view.ticket?.removedReason).toBe("close_shop");
  });

  test("carries the Rejoin offer through, which only a No-show ever has", () => {
    const view = toCustomerView({
      shop: {
        id: "s-1",
        name: "Kedai Ali",
        is_active: true,
        joining_state: "open",
        waiting_count: 0,
        heads_up_threshold: 3,
      },
      ticket: {
        id: "t-1",
        number: 17,
        status: "no_show",
        position: 0,
        last_call_choice: null,
        carried_over: false,
        removed_reason: null,
        can_rejoin: true,
      },
    });

    expect(view.ticket).toEqual({
      id: "t-1",
      number: 17,
      status: "no_show",
      position: 0,
      lastCallChoice: null,
      carriedOver: false,
      removedReason: null,
      canRejoin: true,
    });
  });

  test("keeps a device with no Ticket as no Ticket", () => {
    const view = toCustomerView({
      shop: {
        id: "s-1",
        name: "Kedai Ali",
        is_active: false,
        joining_state: "last_call",
        waiting_count: 0,
        heads_up_threshold: 3,
      },
      ticket: null,
    });

    expect(view.ticket).toBeNull();
    expect(view.shop).toEqual({
      id: "s-1",
      name: "Kedai Ali",
      isActive: false,
      joiningState: "last_call",
      waitingCount: 0,
      headsUpThreshold: 3,
    });
  });
});

describe("checkCustomerName", () => {
  test("trims, the way the database stores it", () => {
    expect(checkCustomerName("  Siti  ")).toEqual({ ok: true, name: "Siti" });
  });

  test.each([
    ["empty", ""],
    ["only spaces", "   "],
  ])("rejects a name that is %s", (_label, raw) => {
    expect(checkCustomerName(raw)).toEqual({ ok: false, problem: "required" });
  });

  test("accepts exactly the longest name the column allows", () => {
    const name = "a".repeat(MAX_CUSTOMER_NAME_LENGTH);
    expect(checkCustomerName(name)).toEqual({ ok: true, name });
  });

  test("rejects one character more", () => {
    expect(checkCustomerName("a".repeat(MAX_CUSTOMER_NAME_LENGTH + 1))).toEqual({
      ok: false,
      problem: "too_long",
    });
  });

  test("measures the trimmed name, not the padding around it", () => {
    const padded = `  ${"a".repeat(MAX_CUSTOMER_NAME_LENGTH)}  `;
    expect(checkCustomerName(padded).ok).toBe(true);
  });

  test("counts an astral character once, as Postgres length() does", () => {
    // "😀".length is 2 in JavaScript but 1 in the column's check constraint.
    const name = "😀".repeat(MAX_CUSTOMER_NAME_LENGTH);
    expect(checkCustomerName(name)).toEqual({ ok: true, name });
  });

  test("still refuses one astral character too many", () => {
    expect(checkCustomerName("😀".repeat(MAX_CUSTOMER_NAME_LENGTH + 1))).toEqual({
      ok: false,
      problem: "too_long",
    });
  });
});

describe("isFinalStatus", () => {
  test("knows the statuses a Ticket never comes back from", () => {
    const final: TicketStatus[] = ["served", "no_show", "left", "removed"];

    expect(final.map(isFinalStatus)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  test("knows the ones that are still in play", () => {
    const active: TicketStatus[] = ["waiting", "called"];

    expect(active.map(isFinalStatus)).toEqual([false, false]);
  });
});
