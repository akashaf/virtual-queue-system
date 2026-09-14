import { describe, expect, test } from "vitest";
import { formatMalaysiaTime } from "./time";

describe("formatMalaysiaTime", () => {
  test("shows a UTC timestamp on a Malaysian clock, eight hours ahead", () => {
    expect(formatMalaysiaTime("2026-09-14T07:05:00Z")).toBe("3:05 pm");
  });

  test("uses 12-hour time with a leading hour and a padded minute", () => {
    expect(formatMalaysiaTime("2026-09-14T00:30:00Z")).toBe("8:30 am");
    expect(formatMalaysiaTime("2026-09-14T01:05:00Z")).toBe("9:05 am");
  });

  test("calls the hour after midnight 12 am, not 0 am", () => {
    expect(formatMalaysiaTime("2026-09-14T16:00:00Z")).toBe("12:00 am");
  });

  test("calls midday 12 pm", () => {
    expect(formatMalaysiaTime("2026-09-14T04:00:00Z")).toBe("12:00 pm");
  });

  test("accepts a Date as well as the database's ISO string", () => {
    expect(formatMalaysiaTime(new Date("2026-09-14T07:05:00Z"))).toBe("3:05 pm");
  });
});
