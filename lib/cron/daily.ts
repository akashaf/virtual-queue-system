import "server-only";
import { dispatchAlerts, toQueueAlerts, type PushSender } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";

/** What one run did, for the scheduled function's log. Counts only: no names. */
export interface DailyCleanupReport {
  expired: number;
  alerts: number;
  erasedTickets: number;
  deletedSubscriptions: number;
}

/**
 * The daily job (backend.md §9), in the order the spec gives: expire stale
 * Carried-over Tickets, push the Heads-ups that moved the Queue up, then erase
 * personal data past its 30 days.
 *
 * The alerts are sent inline rather than in `after()`: nobody is waiting on
 * this response but the scheduled function, and the job is not done until the
 * Customers who moved up have been told.
 *
 * Safe to run twice: both functions only act on what is still due.
 */
export async function runDailyCleanup(send?: PushSender): Promise<DailyCleanupReport> {
  const supabase = createAdminClient();

  const expiry = await supabase.rpc("expire_carried_over");
  if (expiry.error) throw new Error(`expire_carried_over failed: ${expiry.error.message}`);
  const { result, alerts: rawAlerts } = expiry.data as {
    result: { expired: number };
    alerts: unknown;
  };
  const alerts = toQueueAlerts(rawAlerts);

  await dispatchAlerts(alerts, send);

  const erasure = await supabase.rpc("erase_expired_personal_data");
  if (erasure.error) {
    throw new Error(`erase_expired_personal_data failed: ${erasure.error.message}`);
  }
  const erased = erasure.data as { erased_tickets: number; deleted_subscriptions: number };

  return {
    expired: result.expired,
    alerts: alerts.length,
    erasedTickets: erased.erased_tickets,
    deletedSubscriptions: erased.deleted_subscriptions,
  };
}
