/** A Ticket number as it is printed and spoken: `#017` (backend.md §3). */
export function formatTicketNumber(number: number): string {
  return `#${String(number).padStart(3, "0")}`;
}

/** "#003 Raj Kumar", or just the number for a Ticket without a name. */
export function formatTicketLabel(ticket: { number: number; name: string | null }): string {
  const number = formatTicketNumber(ticket.number);
  return ticket.name ? `${number} ${ticket.name}` : number;
}
