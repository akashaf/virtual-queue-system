import type { MetadataRoute } from "next";
import { fetchCustomerView } from "@/lib/customer/queue";

/**
 * Each Shop's page as a Home Screen app (frontend.md §3.2 step 0).
 *
 * An iPhone Customer must join from the Home Screen, and before iOS 26 Add to
 * Home Screen only opens a page as an app when a manifest asks for
 * `standalone`; otherwise it is a bookmark back into Safari, where the install
 * gate would stop them again. Scoped to the one Shop, and named after it, so
 * the icon says where it queues.
 *
 * The path has a dot in it so `proxy.ts` leaves it alone: it needs no session.
 */
export async function GET(_request: Request, context: RouteContext<"/s/[slug]/app.webmanifest">) {
  const { slug } = await context.params;
  const view = await fetchCustomerView(slug, null);
  if (!view?.shop.isActive) return new Response(null, { status: 404 });

  const page = `/s/${slug}`;
  const manifest: MetadataRoute.Manifest = {
    id: page,
    name: view.shop.name,
    short_name: view.shop.name,
    start_url: page,
    scope: page,
    display: "standalone",
  };

  return Response.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
