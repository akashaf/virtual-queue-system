import { describe, expect, test } from "vitest";
import { formatRinggit } from "./history-view";

describe("formatRinggit", () => {
  test("shows sen as ringgit with two decimal places", () => {
    expect(formatRinggit(25)).toBe("RM 0.25");
    expect(formatRinggit(350)).toBe("RM 3.50");
  });

  test("shows nothing owed as RM 0.00", () => {
    expect(formatRinggit(0)).toBe("RM 0.00");
  });

  test("groups thousands, for a busy Shop's month", () => {
    expect(formatRinggit(123_475)).toBe("RM 1,234.75");
  });
});
