/**
 * Every time the Owner sees is Malaysia time, whatever their device says, so two
 * phones in the shop can never disagree about when a Customer joined
 * (frontend.md §5).
 */
export const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur";

const timeOfDay = new Intl.DateTimeFormat("en-MY", {
  timeZone: MALAYSIA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** A timestamp as a Malaysian clock time, e.g. `3:05 pm`. */
export function formatMalaysiaTime(timestamp: string | Date): string {
  return timeOfDay.format(new Date(timestamp));
}

/**
 * How long ago something happened, for the Owner's "called 3 min ago".
 *
 * `now` is a parameter rather than read here, so the caller's ticking clock
 * drives the re-render and the function stays a pure thing to test.
 *
 * The first minute is "just now": a Customer called eleven seconds ago is not
 * usefully different from one called thirty, and rounding the same span up and
 * down by turns is worse than saying nothing.
 */
export function formatMinutesAgo(since: string | Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(since).getTime()) / 60_000);

  if (minutes < 1) return "just now";
  return `${minutes} min ago`;
}

/**
 * A remaining duration as `m:ss`, for the Undo window running out.
 *
 * Rounded up, so a window with 400 ms left reads "0:01" rather than "0:00" while
 * the Undo still works.
 */
export function formatCountdown(remainingMs: number): string {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
