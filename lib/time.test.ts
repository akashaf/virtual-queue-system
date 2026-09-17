import { describe, expect, test } from "vitest";
import {
  formatCountdown,
  formatMalaysiaDay,
  formatMalaysiaTime,
  formatMinutesAgo,
} from "./time";

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

describe("formatMinutesAgo", () => {
  const called = "2026-09-14T07:05:00Z";
  const at = (iso: string) => new Date(iso);

  test("calls the first minute just now, because a number would be noise", () => {
    expect(formatMinutesAgo(called, at("2026-09-14T07:05:00Z"))).toBe("just now");
    expect(formatMinutesAgo(called, at("2026-09-14T07:05:59Z"))).toBe("just now");
  });

  test("counts whole minutes once one has passed", () => {
    expect(formatMinutesAgo(called, at("2026-09-14T07:06:00Z"))).toBe("1 min ago");
    expect(formatMinutesAgo(called, at("2026-09-14T07:06:59Z"))).toBe("1 min ago");
    expect(formatMinutesAgo(called, at("2026-09-14T07:12:00Z"))).toBe("7 min ago");
  });

  test("does not run backwards when a clock is a little ahead", () => {
    expect(formatMinutesAgo(called, at("2026-09-14T07:04:00Z"))).toBe("just now");
  });
});

describe("formatCountdown", () => {
  test("shows the whole undo window as minutes and padded seconds", () => {
    expect(formatCountdown(120_000)).toBe("2:00");
  });

  test("rounds part-seconds up, so the last second is not skipped", () => {
    expect(formatCountdown(9_400)).toBe("0:10");
    expect(formatCountdown(500)).toBe("0:01");
  });

  test("stops at zero rather than going negative", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});

describe("formatMalaysiaDay", () => {
  test("names a Malaysian calendar date by weekday, day and month", () => {
    expect(formatMalaysiaDay("2026-09-17")).toBe("Thu, 17 Sept");
  });

  test("keeps the date the database gave, whatever the machine's time zone", () => {
    // A date read as local midnight would slip to the day before west of UTC.
    expect(formatMalaysiaDay("2026-09-01")).toBe("Tue, 1 Sept");
  });
});
