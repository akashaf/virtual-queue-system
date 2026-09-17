import { appBaseUrl } from "@/lib/env";
import { noStoreJson as json } from "@/lib/http";
import { operatorRoute, readJsonBody } from "@/lib/operator/route";
import { parseUpdateShopInput } from "@/lib/operator/shop-input";
import { shopUrls } from "@/lib/operator/shop-resource";
import { findShop, updateShop } from "@/lib/operator/shops";

type Context = RouteContext<"/api/operator/shops/[slug]">;

/** One Shop, with the URLs its poster needs, as `POST /api/operator/shops` returned them. */
export const GET = operatorRoute<Context>(async (_request, context) => {
  const { slug } = await context.params;
  const shop = await findShop(slug);
  if (!shop) return json({ error: "not_found" }, 404);

  return json({ shop, ...shopUrls(appBaseUrl(), slug) }, 200);
});

/**
 * Tunes a Shop, or switches it off. Deactivating is the only way a Shop leaves
 * service: it is never deleted, so its history and its Owner account stay.
 */
export const PATCH = operatorRoute<Context>(async (request, context) => {
  const input = await readJsonBody(request, parseUpdateShopInput);
  if (input instanceof Response) return input;

  const { slug } = await context.params;
  const shop = await updateShop(slug, input);
  if (!shop) return json({ error: "not_found" }, 404);

  return json({ shop, ...shopUrls(appBaseUrl(), slug) }, 200);
});
