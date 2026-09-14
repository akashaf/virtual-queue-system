import { fetchCustomerView } from "@/lib/customer/queue";
import { deviceIdFromCookieHeader } from "@/lib/device-cookie";
import { noStoreJson } from "@/lib/http";

/**
 * The Customer page's refetch target. Realtime only ever pings "something
 * changed" (backend.md §6), so this is where a Customer's own position comes
 * from — and it answers for the device in the cookie, never for a device the
 * request names.
 */
export async function GET(request: Request, context: RouteContext<"/api/s/[slug]/me">) {
  const { slug } = await context.params;
  const deviceId = deviceIdFromCookieHeader(request.headers.get("cookie"));

  const view = await fetchCustomerView(slug, deviceId);
  if (!view) return noStoreJson({ error: "not_found" }, 404);

  return noStoreJson(view, 200);
}
