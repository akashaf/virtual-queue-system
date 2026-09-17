import { noStoreJson as json } from "@/lib/http";
import { billingSummary, parseBillingMonth } from "@/lib/operator/billing";
import { operatorRoute } from "@/lib/operator/route";

/**
 * What each Shop owes for one Billing Month, for the Operator to invoice by
 * hand (third-party.md). The month is required rather than defaulted: the run
 * is normally for the month just ended, and guessing wrong would bill nothing.
 */
export const GET = operatorRoute(async (request) => {
  const month = parseBillingMonth(new URL(request.url).searchParams.get("month"));
  if (!month.ok) {
    return json({ error: "invalid_query", field: month.field, message: month.message }, 400);
  }

  return json(await billingSummary(month.value), 200);
});
