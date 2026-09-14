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
