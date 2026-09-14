/** A Ticket number as it is printed and spoken: `#017` (backend.md §3). */
export function formatTicketNumber(number: number): string {
  return `#${String(number).padStart(3, "0")}`;
}
