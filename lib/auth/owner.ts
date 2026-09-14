import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export interface OwnerShop {
  id: string;
  slug: string;
  name: string;
}

/**
 * Why an Owner may or may not use the dashboard. "inactive" and "signed-out" are
 * kept apart because they send the Owner to different places: a Deactivated Shop
 * has to be explained, a missing session does not.
 */
export type OwnerSession =
  | { status: "active"; shop: OwnerShop }
  | { status: "inactive" }
  | { status: "signed-out" };

/**
 * The Shop an Owner may run, or null when they have none or it is a Deactivated
 * Shop. Both callers must agree on this, or signing in would succeed only for the
 * dashboard to bounce the Owner straight back out.
 */
export async function findOwnerShop(
  supabase: SupabaseClient<Database>,
  ownerUserId: string,
): Promise<OwnerShop | null> {
  const { data: shop } = await supabase
    .from("shops")
    .select("id, slug, name, is_active")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (!shop || !shop.is_active) return null;

  return { id: shop.id, slug: shop.slug, name: shop.name };
}

/**
 * The authoritative dashboard gate: a valid session AND an active Shop.
 * `proxy.ts` only redirects optimistically on a missing cookie, and cannot see
 * `is_active` at all.
 */
export async function getOwnerSession(): Promise<OwnerSession> {
  const supabase = await createClient();

  // getUser() revalidates the JWT with Supabase; getSession() would trust the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "signed-out" };

  const shop = await findOwnerShop(supabase, user.id);
  return shop ? { status: "active", shop } : { status: "inactive" };
}
