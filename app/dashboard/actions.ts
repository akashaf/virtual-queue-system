"use server";

import { redirect } from "next/navigation";
import {
  callNextTicket,
  cancelShopLastCall,
  closeShopDay,
  markTicketNoShow,
  markTicketServed,
  removeQueueTicket,
  startShopLastCall,
  undoTicketServed,
} from "@/lib/owner/queue";
import type {
  CalledTicket,
  CloseShopResult,
  JoiningStateResult,
  OwnerOutcome,
  ServedTicket,
  TicketRef,
} from "@/lib/owner/view";
import { dispatched } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";
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
  return dispatched(await callNextTicket());
}

export async function markServed(
  _previous: OwnerOutcome<ServedTicket> | null,
  formData: FormData,
): Promise<OwnerOutcome<ServedTicket>> {
  const ticketId = formData.get("ticketId");
  if (!isUuid(ticketId)) return { ok: false, reason: "failed" };
  return dispatched(await markTicketServed(ticketId));
}

export async function undoServed(
  _previous: OwnerOutcome<CalledTicket> | null,
  formData: FormData,
): Promise<OwnerOutcome<CalledTicket>> {
  const ticketId = formData.get("ticketId");
  if (!isUuid(ticketId)) return { ok: false, reason: "failed" };
  return dispatched(await undoTicketServed(ticketId));
}

export async function markNoShow(
  _previous: OwnerOutcome<TicketRef> | null,
  formData: FormData,
): Promise<OwnerOutcome<TicketRef>> {
  const ticketId = formData.get("ticketId");
  if (!isUuid(ticketId)) return { ok: false, reason: "failed" };
  return dispatched(await markTicketNoShow(ticketId));
}

export async function removeTicket(
  _previous: OwnerOutcome<TicketRef> | null,
  formData: FormData,
): Promise<OwnerOutcome<TicketRef>> {
  const ticketId = formData.get("ticketId");
  if (!isUuid(ticketId)) return { ok: false, reason: "failed" };
  return dispatched(await removeQueueTicket(ticketId));
}

export async function startLastCall(
  _previous: OwnerOutcome<JoiningStateResult> | null,
  _formData: FormData,
): Promise<OwnerOutcome<JoiningStateResult>> {
  return dispatched(await startShopLastCall());
}

export async function cancelLastCall(
  _previous: OwnerOutcome<JoiningStateResult> | null,
  _formData: FormData,
): Promise<OwnerOutcome<JoiningStateResult>> {
  return dispatched(await cancelShopLastCall());
}

export async function closeShop(
  _previous: OwnerOutcome<CloseShopResult> | null,
  _formData: FormData,
): Promise<OwnerOutcome<CloseShopResult>> {
  const outcome = dispatched(await closeShopDay());
  if (outcome.ok && outcome.result.signedOut) {
    // The Sign-in is already gone from the database; this only clears its
    // cookies. Other devices it ended learn on their next request, without a note.
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
    redirect("/login?error=weekly");
  }
  return outcome;
}
