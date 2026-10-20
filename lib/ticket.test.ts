import { describe, expect, test } from "vitest";
import { formatTicketLabel, formatTicketNumber } from "./ticket";

describe("formatTicketNumber", () => {
  test.each([
    [1, "#001"],
    [17, "#017"],
    [130, "#130"],
  ])("prints %i as %s", (number, expected) => {
    expect(formatTicketNumber(number)).toBe(expected);
  });

  test("does not truncate a Queue Day long enough to pass 999", () => {
    expect(formatTicketNumber(1042)).toBe("#1042");
  });
});

describe("formatTicketLabel", () => {
  test("puts the name after the number", () => {
    expect(formatTicketLabel({ number: 3, name: "Raj Kumar" })).toBe("#003 Raj Kumar");
  });

  test("is just the number for a Ticket without a name", () => {
    expect(formatTicketLabel({ number: 3, name: null })).toBe("#003");
  });
});
