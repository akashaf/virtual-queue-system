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
 *
 * Each is shaped for `useActionState`, so each kind of press gets its own pending
 * state and its own result. The Ticket comes in as a form field like any other,
 * and is checked as such: a Server Action is a public endpoint, and a forged id
 * would otherwise reach a `uuid` parameter.
 */

export async function callNext(
  _previous: OwnerOutcome<CalledTicket> | null,
  _formData: FormData,
): Promise<OwnerOutcome<CalledTicket>> {
  return callNextTicket();
}

export async function markServed(
  _previous: OwnerOutcome<ServedTicket> | null,
  formData: FormData,
): Promise<OwnerOutcome<ServedTicket>> {
  const ticketId = formData.get("ticketId");
  if (!isUuid(ticketId)) return { ok: false, reason: "failed" };
  return markTicketServed(ticketId);
}

export async function undoServed(
  _previous: OwnerOutcome<CalledTicket> | null,
  formData: FormData,
): Promise<OwnerOutcome<CalledTicket>> {
  const ticketId = formData.get("ticketId");
  if (!isUuid(ticketId)) return { ok: false, reason: "failed" };
  return undoTicketServed(ticketId);
}
