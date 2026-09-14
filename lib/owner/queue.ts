import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  isOwnerError,
  toCalledTicket,
  toOwnerQueue,
  toServedTicket,
  type CalledTicket,
  type OwnerOutcome,
  type OwnerQueue,
  type ServedTicket,
} from "./view";

/**
 * Every call here goes through the Owner's own JWT, so each function finds the
 * Shop from `auth.uid()` rather than from anything the request could claim, and
 * the Shop lock inside it — not this file — is what keeps two Owner devices
 * pressing at once from stepping on each other.
 */

/** What `get_owner_queue` raises when the caller runs no active Shop. */
const NO_ACTIVE_SHOP = "shop_inactive";

/**
 * Reads the Queue.
 *
 * Null means the caller has no active Shop, which is a state rather than a
 * failure: a Shop can be deactivated mid-session, and a layout and its page
 * render concurrently, so this one cannot lean on the layout's redirect having
 * happened first.
 */
export async function fetchOwnerQueue(): Promise<OwnerQueue | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_owner_queue");

  if (error) {
    if (error.message === NO_ACTIVE_SHOP) return null;
    throw new Error(`get_owner_queue failed: ${error.message}`);
  }

  return toOwnerQueue(data);
}

/** Summons the Customer at the front of the Queue. */
export async function callNextTicket(): Promise<OwnerOutcome<CalledTicket>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("call_next");

  if (error) return refusal("call_next", error);
  return { ok: true, result: toCalledTicket(resultOf(data)) };
}

/** Marks a haircut done — the Shop's one billable event. */
export async function markTicketServed(
  ticketId: string,
): Promise<OwnerOutcome<ServedTicket>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_served", { p_ticket_id: ticketId });

  if (error) return refusal("mark_served", error);
  return { ok: true, result: toServedTicket(resultOf(data)) };
}

/** Takes a Done back, while the Undo window is still open. */
export async function undoTicketServed(
  ticketId: string,
): Promise<OwnerOutcome<CalledTicket>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_served", { p_ticket_id: ticketId });

  if (error) return refusal("undo_served", error);
  return { ok: true, result: toCalledTicket(resultOf(data)) };
}

/**
 * The owner functions return `jsonb`, which the generated types can only call
 * `Json`; the `{ result, alerts }` envelope is pinned by backend.md §5. The
 * alerts stay unread until #10 builds the dispatcher that sends them.
 */
function resultOf(data: unknown): unknown {
  return (data as { result: unknown }).result;
}

/** A rule the Owner ran into, or a genuine failure worth reporting. */
function refusal(fn: string, error: PostgrestError): OwnerOutcome<never> {
  if (isOwnerError(error.message)) return { ok: false, reason: error.message };
  console.error(`${fn} failed`, error);
  return { ok: false, reason: "failed" };
}
