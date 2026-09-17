import type { Database } from "@/lib/supabase/database.types";

type TicketStatus = Database["public"]["Enums"]["ticket_status"];

/** One of today's Tickets, whatever became of it, as the history table lists it. */
export interface HistoryTicket {
  id: string;
  number: number;
  /** Null only after personal data has been erased, 30 days on. */
  name: string | null;
  status: TicketStatus;
  joinedAt: string;
  calledAt: string | null;
  servedAt: string | null;
}

/** Served Tickets on one Malaysian calendar date (`YYYY-MM-DD`). */
export interface ServedDay {
  day: string;
  servedCount: number;
}

/** What the Owner's history page shows (frontend.md §4.3). */
export interface OwnerHistory {
  today: HistoryTicket[];
  /** Newest first, one entry per day, quiet days included. */
  servedByDay: ServedDay[];
  /** The Billing Month so far, priced by the database as the invoice will be. */
  thisMonth: { servedCount: number; amountSen: number };
}

interface OwnerHistoryJson {
  today: {
    id: string;
    number: number;
    name: string | null;
    status: TicketStatus;
    joined_at: string;
    called_at: string | null;
    served_at: string | null;
  }[];
  served_by_day: { day: string; served_count: number }[];
  this_month: { served_count: number; amount_sen: number };
}

export function toOwnerHistory(json: unknown): OwnerHistory {
  const history = json as OwnerHistoryJson;

  return {
    today: history.today.map((ticket) => ({
      id: ticket.id,
      number: ticket.number,
      name: ticket.name,
      status: ticket.status,
      joinedAt: ticket.joined_at,
      calledAt: ticket.called_at,
      servedAt: ticket.served_at,
    })),
    servedByDay: history.served_by_day.map((day) => ({
      day: day.day,
      servedCount: day.served_count,
    })),
    thisMonth: {
      servedCount: history.this_month.served_count,
      amountSen: history.this_month.amount_sen,
    },
  };
}

/** How the history table names each Ticket status, in the glossary's words. */
export const STATUS_LABELS: Record<TicketStatus, string> = {
  waiting: "Waiting",
  called: "Called",
  served: "Served",
  no_show: "No-show",
  left: "Left",
  removed: "Removed",
};

const ringgit = new Intl.NumberFormat("en-MY", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * An amount in sen as ringgit, e.g. `RM 3.25`. The database counts in whole sen
 * so no sum is ever a float; only this last step divides.
 */
export function formatRinggit(sen: number): string {
  return `RM ${ringgit.format(sen / 100)}`;
}
