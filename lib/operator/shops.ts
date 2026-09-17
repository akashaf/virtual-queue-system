import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UpdateShopInput } from "./shop-input";
import { toOperatorShopResource, type ShopResource } from "./shop-resource";

/**
 * What the Operator admin API does to Shops, behind the bearer key the routes
 * have already checked. Reads go through `operator_shops`, so a list and a
 * single Shop can never disagree about the Owner's email or the month's count.
 */

export async function listShops(): Promise<ShopResource[]> {
  return operatorShops();
}

/** One Shop, or null when no Shop has the slug. */
export async function findShop(slug: string): Promise<ShopResource | null> {
  return (await operatorShops(slug))[0] ?? null;
}

async function operatorShops(slug?: string): Promise<ShopResource[]> {
  const { data, error } = await createAdminClient().rpc(
    "operator_shops",
    slug === undefined ? {} : { p_slug: slug },
  );
  if (error) throw new Error(`operator_shops failed: ${error.message}`);

  return data.map(toOperatorShopResource);
}

/**
 * Applies the settings and returns the Shop as it now stands, or null when no
 * Shop has the slug.
 *
 * Switching a Shop off also signs its Owner out everywhere: the dashboard would
 * turn them away on its next render regardless, but a tablet left open on the
 * Queue should not keep working for up to ten minutes on an unexpired token.
 * The Queue itself needs nothing more — `join_queue` reads `is_active` — and
 * every Ticket stays where it is, because history outlives the Shop.
 *
 * Two writes in two systems, so a failed revocation leaves the Shop already
 * off with its sessions live; the Operator sees a 500 and a retry finishes the
 * job, and in the meantime every owner function refuses an inactive Shop.
 */
export async function updateShop(
  slug: string,
  input: UpdateShopInput,
): Promise<ShopResource | null> {
  const admin = createAdminClient();

  const { data: updated, error } = await admin
    .from("shops")
    .update({
      name: input.name,
      lat: input.lat,
      lng: input.lng,
      join_radius_m: input.joinRadiusM,
      heads_up_threshold: input.headsUpThreshold,
      max_queue_size: input.maxQueueSize,
      is_active: input.isActive,
    })
    .eq("slug", slug)
    .select("owner_user_id")
    .maybeSingle();
  if (error) throw new Error(`Could not update the Shop: ${error.message}`);
  if (!updated) return null;

  if (input.isActive === false) await revokeOwnerSessions(updated.owner_user_id);

  return findShop(slug);
}

export type PasswordResetOutcome = "done" | "not_found";

/**
 * Replaces the Owner's password and signs them out everywhere, so whoever knew
 * the old one is out — the point of a reset — and the Owner signs back in with
 * the new one on each device.
 */
export async function resetOwnerPassword(
  slug: string,
  password: string,
): Promise<PasswordResetOutcome> {
  const admin = createAdminClient();

  const { data: shop, error } = await admin
    .from("shops")
    .select("owner_user_id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Could not find the Shop: ${error.message}`);
  if (!shop) return "not_found";

  const { error: authError } = await admin.auth.admin.updateUserById(shop.owner_user_id, {
    password,
  });
  if (authError) throw new Error(`Could not update the Owner's password: ${authError.message}`);

  await revokeOwnerSessions(shop.owner_user_id);
  return "done";
}

async function revokeOwnerSessions(ownerUserId: string) {
  const { error } = await createAdminClient().rpc("revoke_owner_sessions", {
    p_user_id: ownerUserId,
  });
  if (error) throw new Error(`revoke_owner_sessions failed: ${error.message}`);
}
