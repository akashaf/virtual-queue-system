import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toOwnerHistory, type OwnerHistory } from "./history-view";
import { NO_ACTIVE_SHOP } from "./queue";

/**
 * Reads today's Tickets, the Served counts of recent days and the Billing Month
 * so far, through the Owner's own JWT: `get_owner_history` finds the Shop from
 * `auth.uid()`, never from anything the request could claim.
 *
 * Null means the caller has no active Shop, a state rather than a failure, for
 * the same reason as `fetchOwnerQueue`.
 */
export async function fetchOwnerHistory(): Promise<OwnerHistory | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_owner_history");

  if (error) {
    if (error.message === NO_ACTIVE_SHOP) return null;
    throw new Error(`get_owner_history failed: ${error.message}`);
  }

  return toOwnerHistory(data);
}
