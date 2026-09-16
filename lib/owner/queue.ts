import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { functionErrorReason } from "@/lib/error-reporting";
import { toQueueAlerts, type Mutated } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";
import {
  OWNER_ERRORS,
  toCalledTicket,
  toOwnerQueue,
  toServedTicket,
  toTicketRef,
  type CalledTicket,
  type OwnerOutcome,
  type OwnerQueue,
  type ServedTicket,
  type TicketRef,
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
export async function callNextTicket(): Promise<Mutated<OwnerOutcome<CalledTicket>>> {
  const supabase = await createClient();
  return outcome("call_next", await supabase.rpc("call_next"), toCalledTicket);
}

/** Marks a haircut done — the Shop's one billable event. */
export async function markTicketServed(
  ticketId: string,
): Promise<Mutated<OwnerOutcome<ServedTicket>>> {
  const supabase = await createClient();
  return outcome(
    "mark_served",
    await supabase.rpc("mark_served", { p_ticket_id: ticketId }),
    toServedTicket,
  );
}

/** Takes a Done back, while the Undo window is still open. */
export async function undoTicketServed(
  ticketId: string,
): Promise<Mutated<OwnerOutcome<CalledTicket>>> {
  const supabase = await createClient();
  return outcome(
    "undo_served",
    await supabase.rpc("undo_served", { p_ticket_id: ticketId }),
    toCalledTicket,
  );
}

/** The Customer never came to the chair. */
export async function markTicketNoShow(
  ticketId: string,
): Promise<Mutated<OwnerOutcome<TicketRef>>> {
  const supabase = await createClient();
  return outcome(
    "mark_no_show",
    await supabase.rpc("mark_no_show", { p_ticket_id: ticketId }),
    toTicketRef,
  );
}

/** The Owner takes a Ticket out, from the Queue or from the chair. */
export async function removeQueueTicket(
  ticketId: string,
): Promise<Mutated<OwnerOutcome<TicketRef>>> {
  const supabase = await createClient();
  return outcome(
    "remove_ticket",
    await supabase.rpc("remove_ticket", { p_ticket_id: ticketId }),
    toTicketRef,
  );
}

/**
 * What one owner function did, or why it did nothing — plus the alerts it
 * returned, which the Server Action dispatches after its response is sent.
 *
 * A message in OWNER_ERRORS is a rule the Owner ran into and worth showing them;
 * anything else is a bug rather than a situation, and is reported as one.
 *
 * The functions return `jsonb`, which the generated types can only call `Json`;
 * the `{ result, alerts }` envelope is pinned by backend.md §5.
 */
function outcome<T>(
  fn: string,
  { data, error }: { data: unknown; error: PostgrestError | null },
  toResult: (json: unknown) => T,
): Mutated<OwnerOutcome<T>> {
  if (error) {
    return {
      outcome: { ok: false, reason: functionErrorReason(fn, error, OWNER_ERRORS) },
      alerts: [],
    };
  }

  const envelope = data as { result: unknown; alerts: unknown };
  return {
    outcome: { ok: true, result: toResult(envelope.result) },
    alerts: toQueueAlerts(envelope.alerts),
  };
}
