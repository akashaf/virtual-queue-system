import { requireEnv } from "@/lib/env";
import { noStoreJson as json } from "@/lib/http";
import { isAuthorizedOperator } from "@/lib/operator/auth";
import { parseCreateShopInput } from "@/lib/operator/shop-input";
import { shopUrls, toShopResource } from "@/lib/operator/shop-resource";
import { createAdminClient } from "@/lib/supabase/admin";

const UNIQUE_VIOLATION = "23505";

/**
 * Onboards a Shop: the Owner's Auth user, the Shop and its first Queue Day.
 *
 * The Auth user has to be created before the Shop, because `shops.owner_user_id`
 * references it, and the two live in different systems so they can't share a
 * transaction. If the Shop is rejected, the Auth user is deleted again — without
 * that, a retry with a corrected slug would fail on the duplicate email.
 */
export async function POST(request: Request) {
  // requireEnv, not `?? ""`: a missing key must fail loudly rather than turn
  // every Operator request into a plain 401 that looks like a typo.
  const operatorKey = requireEnv("OPERATOR_API_KEY", process.env.OPERATOR_API_KEY);
  if (!isAuthorizedOperator(request.headers.get("authorization"), operatorKey)) {
    return json({ error: "unauthorized" }, 401);
  }

  // Read before anything is written. Reading it at the end would throw after both
  // the Owner and the Shop had been committed, and the Operator would never learn
  // the new Shop's id — while a retry failed on the duplicate email.
  const baseUrl = requireEnv("APP_BASE_URL", process.env.APP_BASE_URL);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(
      { error: "invalid_body", field: "body", message: "Expected JSON." },
      400,
    );
  }

  const parsed = parseCreateShopInput(payload);
  if (!parsed.ok) {
    return json(
      { error: "invalid_body", field: parsed.field, message: parsed.message },
      400,
    );
  }
  const input = parsed.value;

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
    console.error("Could not create the Owner", ownerError);
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
    console.error("Could not create the Shop", shopError);
    return json({ error: "internal_error" }, 500);
  }

  return json(
    {
      shop: toShopResource(shop, created.user.email ?? input.ownerEmail),
      ...shopUrls(baseUrl, shop.slug),
    },
    201,
  );
}
