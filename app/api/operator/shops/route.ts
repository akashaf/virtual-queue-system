import { appBaseUrl } from "@/lib/env";
import { reportUnexpected } from "@/lib/error-reporting";
import { noStoreJson as json } from "@/lib/http";
import { operatorRoute, readJsonBody } from "@/lib/operator/route";
import { parseCreateShopInput } from "@/lib/operator/shop-input";
import { shopUrls, toShopResource } from "@/lib/operator/shop-resource";
import { listShops } from "@/lib/operator/shops";
import { createAdminClient } from "@/lib/supabase/admin";

const UNIQUE_VIOLATION = "23505";

/** Every Shop, with its Owner's email and the month's Served count so far. */
export const GET = operatorRoute(async () => json({ shops: await listShops() }, 200));

/**
 * Onboards a Shop: the Owner's Auth user, the Shop and its first Queue Day.
 *
 * The Auth user has to be created before the Shop, because `shops.owner_user_id`
 * references it, and the two live in different systems so they can't share a
 * transaction. If the Shop is rejected, the Auth user is deleted again — without
 * that, a retry with a corrected slug would fail on the duplicate email.
 */
export const POST = operatorRoute(async (request) => {
  // Read before anything is written. Reading it at the end would throw after both
  // the Owner and the Shop had been committed, and the Operator would never learn
  // the new Shop's id — while a retry failed on the duplicate email.
  const baseUrl = appBaseUrl();

  const input = await readJsonBody(request, parseCreateShopInput);
  if (input instanceof Response) return input;

  const admin = createAdminClient();

  const { data: created, error: ownerError } = await admin.auth.admin.createUser({
    email: input.ownerEmail,
    password: input.ownerPassword,
    email_confirm: true,
  });

  if (ownerError || !created.user) {
    if (ownerError?.code === "email_exists") {
      return json(
        { error: "email_taken", message: "That email already has an Owner account." },
        409,
      );
    }
    reportUnexpected("Could not create the Owner", ownerError);
    return json({ error: "internal_error" }, 500);
  }

  const { data: shop, error: shopError } = await admin.rpc("create_shop", {
    p_slug: input.slug,
    p_name: input.name,
    p_owner_user_id: created.user.id,
    p_lat: input.lat,
    p_lng: input.lng,
    p_join_radius_m: input.joinRadiusM,
    p_heads_up_threshold: input.headsUpThreshold,
    p_max_queue_size: input.maxQueueSize,
  });

  if (shopError || !shop) {
    await admin.auth.admin.deleteUser(created.user.id);

    if (shopError?.code === UNIQUE_VIOLATION) {
      return json(
        { error: "slug_taken", message: "That slug is already in use." },
        409,
      );
    }
    reportUnexpected("Could not create the Shop", shopError);
    return json({ error: "internal_error" }, 500);
  }

  return json(
    {
      // A Shop that has just opened has Served nobody this month or any other.
      shop: toShopResource(shop, created.user.email ?? input.ownerEmail, 0),
      ...shopUrls(baseUrl, shop.slug),
    },
    201,
  );
});
