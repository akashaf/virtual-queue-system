import { fetchOwnerQueue } from "@/lib/owner/queue";
import { noStoreJson } from "@/lib/http";

/**
 * The dashboard's refetch target. Realtime only ever pings "something changed"
 * (backend.md §6), so this is where the Owner's live Queue comes from — and
 * `get_owner_queue` finds the Shop from the session, never from the request.
 */
export async function GET() {
  const queue = await fetchOwnerQueue();
  if (!queue) return noStoreJson({ error: "shop_inactive" }, 403);

  return noStoreJson(queue, 200);
}
