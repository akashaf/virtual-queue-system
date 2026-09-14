"use server";

import {
  callNextTicket,
  markTicketServed,
  undoTicketServed,
} from "@/lib/owner/queue";
import type { CalledTicket, OwnerOutcome, ServedTicket } from "@/lib/owner/view";
import { isUuid } from "@/lib/uuid";

/**
 * The Owner's three buttons. Each one authenticates through the session cookie
 * and then calls exactly one Postgres function: the rules, including which Shop
 * the caller runs, live there and not here (backend.md §2).
 */

export async function callNext(): Promise<OwnerOutcome<CalledTicket>> {
  return callNextTicket();
}

export async function markServed(
  ticketId: unknown,
): Promise<OwnerOutcome<ServedTicket>> {
  if (!isUuid(ticketId)) return { ok: false, reason: "failed" };
  return markTicketServed(ticketId);
}

export async function undoServed(
  ticketId: unknown,
): Promise<OwnerOutcome<CalledTicket>> {
  if (!isUuid(ticketId)) return { ok: false, reason: "failed" };
  return undoTicketServed(ticketId);
}
