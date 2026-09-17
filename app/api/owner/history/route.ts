import { fetchOwnerHistory } from "@/lib/owner/history";
import { noStoreJson } from "@/lib/http";

/**
 * The Owner's history (backend.md §7). Like the Queue, `get_owner_history`
 * finds the Shop from the session, never from the request.
 */
export async function GET() {
  const history = await fetchOwnerHistory();
  if (!history) return noStoreJson({ error: "shop_inactive" }, 403);

  return noStoreJson(history, 200);
}
