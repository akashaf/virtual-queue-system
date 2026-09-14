import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";
import { readLocalSupabase } from "../tests/local-supabase";

const { apiUrl, secretKey } = readLocalSupabase();

const admin = createClient<Database>(apiUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Onboards a Shop and its Owner against local Supabase, as the Operator API does. */
export async function seedShop({ isActive = true } = {}) {
  const email = `owner-${crypto.randomUUID()}@example.test`;
  const password = "correct-horse-battery";

  const { data: created, error: ownerError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (ownerError) throw ownerError;
  const owner = created.user;

  const { data: shop, error: shopError } = await admin.rpc("create_shop", {
    p_slug: `shop-${crypto.randomUUID().slice(0, 8)}`,
    p_name: "Kedai Gunting Rambut Ali",
    p_owner_user_id: owner.id,
    p_lat: 3.1319,
    p_lng: 101.6841,
  });
  if (shopError) throw shopError;

  if (!isActive) await deactivateShop(shop.id);

  return { email, password, shop };
}

/** Switches a Shop off, the way `PATCH /api/operator/shops/[slug]` will. */
export async function deactivateShop(id: string) {
  const { error } = await admin.from("shops").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}
