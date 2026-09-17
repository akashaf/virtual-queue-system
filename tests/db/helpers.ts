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

/** A client carrying an Owner's JWT, as `signInAs` returns it. */
export type OwnerClient = Awaited<ReturnType<typeof signInAs>>;

/** Puts a Customer in a Shop's Queue from a fresh device, standing at the door. */
export async function joinQueue(slug: string, name = "Ali") {
  const { data, error } = await serviceClient().rpc("join_queue", {
    p_slug: slug,
    p_device_id: crypto.randomUUID(),
    p_name: name,
    p_lat: metresNorthOf(0),
    p_lng: SHOP_LNG,
    p_accuracy_m: 0,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as { result: { ticket: { id: string } } }).result.ticket;
}

export async function callNext(owner: OwnerClient) {
  const { error } = await owner.rpc("call_next");
  if (error) throw new Error(error.message);
}

/** Puts one Customer through the whole Queue, the only way a Ticket becomes Served. */
export async function serveOne(owner: OwnerClient, slug: string, name = "Ali") {
  const ticket = await joinQueue(slug, name);
  await callNext(owner);
  const { error } = await owner.rpc("mark_served", { p_ticket_id: ticket.id });
  if (error) throw new Error(error.message);
  return ticket;
}

/**
 * Moves a serve to another instant, so a test can place it either side of a
 * day or month boundary. `servedAt` is anything Postgres reads as a timestamptz.
 */
export async function setServedAt(db: Client, ticketId: string, servedAt: string) {
  await db.query("update public.tickets set served_at = $1 where id = $2", [servedAt, ticketId]);
}

/** Makes a Ticket a Carried-over one, carried `ago` (a Postgres interval) before now. */
export async function setCarriedOverAgo(db: Client, ticketId: string, ago: string) {
  await db.query(
    "update public.tickets set carried_over_at = now() - $1::interval where id = $2",
    [ago, ticketId],
  );
}

/** Moves a finished Ticket's ending `ago` (a Postgres interval) into the past. */
export async function setFinishedAgo(db: Client, ticketId: string, ago: string) {
  await db.query(
    "update public.tickets set finished_at = now() - $1::interval where id = $2",
    [ago, ticketId],
  );
}

/** Gives a Ticket a push subscription without a browser, returning its endpoint. */
export async function insertPushSubscription(db: Client, ticketId: string) {
  const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
  await db.query(
    `insert into public.push_subscriptions (ticket_id, endpoint, p256dh, auth)
     values ($1, $2, 'p256dh', 'auth')`,
    [ticketId, endpoint],
  );
  return endpoint;
}

/** SQL for the instant the current Billing Month began, in Malaysia time. */
export const MONTH_START_SQL = `
  date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur')
    at time zone 'Asia/Kuala_Lumpur'`;

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

/** How many devices an Owner is signed in on, straight from the Auth schema. */
export async function sessionCount(db: Client, email: string) {
  const { rows } = await db.query(
    `select count(*)::int as n from auth.sessions s
       join auth.users u on u.id = s.user_id
      where u.email = $1`,
    [email.toLowerCase()],
  );
  return rows[0].n as number;
}

/**
 * Clears everything the database tests create. They share one long-lived local
 * stack, so each file starts from a clean slate rather than relying on `db reset`.
 */
export async function resetTestData(db: Client) {
  await db.query("truncate public.shops, public.queue_days, public.tickets cascade");
  await db.query("delete from auth.users where email like '%@example.test'");
}
