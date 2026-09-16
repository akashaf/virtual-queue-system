import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";
import { readLocalSupabase } from "../tests/local-supabase";
import { SHOP_LAT, SHOP_LNG } from "../tests/shop-location";

export { SHOP_LAT, SHOP_LNG };

const { apiUrl, secretKey } = readLocalSupabase();

const admin = createClient<Database>(apiUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Onboards a Shop and its Owner against local Supabase, as the Operator API does. */
export async function seedShop({ isActive = true, maxQueueSize = 30 } = {}) {
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
    p_lat: SHOP_LAT,
    p_lng: SHOP_LNG,
    p_max_queue_size: maxQueueSize,
  });
  if (shopError) throw shopError;

  if (!isActive) await deactivateShop(shop.id);

  return { email, password, shop };
}

/** Puts a Customer in a Shop's Queue without a browser, to stand ahead of the one under test. */
export async function seedTicket(slug: string, name: string) {
  const { error } = await admin.rpc("join_queue", {
    p_slug: slug,
    p_device_id: crypto.randomUUID(),
    p_name: name,
    p_lat: SHOP_LAT,
    p_lng: SHOP_LNG,
    p_accuracy_m: 0,
  });
  if (error) throw new Error(error.message);
}

/** Signs an Owner in on their own page, landing them on the dashboard. */
export async function signInAsOwner(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");
}

/**
 * Moves a Shop's calls back in time, so a test can reach the five-minute No-show
 * window without waiting five minutes for it.
 */
export async function backdateCalls(shopId: string, minutes: number) {
  const calledAt = new Date(Date.now() - minutes * 60_000).toISOString();
  const { error } = await admin
    .from("tickets")
    .update({ called_at: calledAt })
    .eq("shop_id", shopId)
    .eq("status", "called");
  if (error) throw error;
}

/**
 * Reads a Shop's joining state straight from the database. The dashboard shows
 * a press optimistically, so a test that must not outrun the server — opening
 * another page that depends on Last Call being on — polls this instead.
 */
export async function shopJoiningState(id: string) {
  const { data, error } = await admin
    .from("shops")
    .select("joining_state")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data.joining_state;
}

/** Switches a Shop off, the way `PATCH /api/operator/shops/[slug]` will. */
export async function deactivateShop(id: string) {
  const { error } = await admin.from("shops").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}
