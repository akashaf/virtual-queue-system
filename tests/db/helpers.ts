import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { inject } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { metresNorthOf, SHOP_LAT, SHOP_LNG } from "../shop-location";

export { metresNorthOf, SHOP_LAT, SHOP_LNG };

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Secret-key client: how Next.js calls Customer, Operator and cron functions. */
export function serviceClient() {
  const { apiUrl, secretKey } = inject("supabase");
  return createClient<Database>(apiUrl, secretKey, noSession);
}

/** Publishable-key client: what a browser holds. */
export function anonClient() {
  const { apiUrl, publishableKey } = inject("supabase");
  return createClient<Database>(apiUrl, publishableKey, noSession);
}

/**
 * A direct Postgres connection as the superuser, for arranging fixtures and for
 * tests that need several independent connections (e.g. concurrent calls).
 * The caller must `end()` it.
 */
export async function connectDb() {
  const client = new Client({ connectionString: inject("supabase").dbUrl });
  await client.connect();
  return client;
}

/** A slug that won't collide with other tests in the shared local database. */
export function uniqueSlug(prefix = "shop") {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Creates a pre-confirmed Owner, the way the Operator API does. */
export async function createOwner(password = "correct-horse-battery") {
  const email = `owner-${crypto.randomUUID()}@example.test`;
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return { id: data.user.id, email, password };
}

/** Signs in as an Owner, giving a client whose requests carry their JWT. */
export async function signInAs(email: string, password: string) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

type ShopRow = Database["public"]["Tables"]["shops"]["Row"];

/** Creates a Shop the way the Operator API does, and returns it with its Owner. */
export async function createShop(
  overrides: Partial<Database["public"]["Functions"]["create_shop"]["Args"]> = {},
) {
  const owner = await createOwner();
  const { data, error } = await serviceClient().rpc("create_shop", {
    p_slug: uniqueSlug(),
    p_name: "Kedai Gunting Rambut",
    p_owner_user_id: owner.id,
    p_lat: SHOP_LAT,
    p_lng: SHOP_LNG,
    ...overrides,
  });
  if (error) throw error;
  return { owner, shop: data as ShopRow };
}

/**
 * Clears everything the database tests create. They share one long-lived local
 * stack, so each file starts from a clean slate rather than relying on `db reset`.
 */
export async function resetTestData(db: Client) {
  await db.query("truncate public.shops, public.queue_days, public.tickets cascade");
  await db.query("delete from auth.users where email like '%@example.test'");
}
