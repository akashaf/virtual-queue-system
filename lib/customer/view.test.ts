import { describe, expect, test } from "vitest";
import {
  checkCustomerName,
  isJoinError,
  MAX_CUSTOMER_NAME_LENGTH,
  toCustomerView,
} from "./view";

describe("toCustomerView", () => {
  test("renames the database's fields without changing them", () => {
    expect(
      toCustomerView({
        shop: {
          name: "Kedai Ali",
          is_active: true,
          joining_state: "open",
          waiting_count: 4,
        },
        ticket: { id: "t-1", number: 17, status: "waiting", position: 3 },
      }),
    ).toEqual({
      shop: {
        name: "Kedai Ali",
        isActive: true,
        joiningState: "open",
        waitingCount: 4,
      },
      ticket: { id: "t-1", number: 17, status: "waiting", position: 3 },
    });
  });

  test("keeps a device with no Ticket as no Ticket", () => {
    const view = toCustomerView({
      shop: { name: "Kedai Ali", is_active: false, joining_state: "last_call", waiting_count: 0 },
      ticket: null,
    });

    expect(view.ticket).toBeNull();
    expect(view.shop).toEqual({
      name: "Kedai Ali",
      isActive: false,
      joiningState: "last_call",
      waitingCount: 0,
    });
  });
});

describe("isJoinError", () => {
  test.each(["shop_inactive", "last_call", "already_in_queue", "too_far", "queue_full"])(
    "recognises %s as something to explain to the Customer",
    (message) => {
      expect(isJoinError(message)).toBe(true);
    },
  );

  test.each([
    ["a constraint violation", 'new row violates check constraint "x"'],
    ["a connection failure", "fetch failed"],
    ["nothing", undefined],
  ])("treats %s as a bug, not a situation", (_label, message) => {
    expect(isJoinError(message)).toBe(false);
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
