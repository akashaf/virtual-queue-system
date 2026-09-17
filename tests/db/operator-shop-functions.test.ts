import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  anonClient,
  connectDb,
  createShop,
  metresNorthOf,
  resetTestData,
  serviceClient,
  sessionCount,
  SHOP_LNG,
  signInAs,
} from "./helpers";

let db: Client;

beforeAll(async () => {
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

async function join(slug: string, name = "Ali") {
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

/** Puts one Customer through the whole Queue, the only way a Ticket becomes Served. */
async function serveOne(client: Awaited<ReturnType<typeof signInAs>>, slug: string) {
  const ticket = await join(slug);
  const called = await client.rpc("call_next");
  if (called.error) throw new Error(called.error.message);
  const served = await client.rpc("mark_served", { p_ticket_id: ticket.id });
  if (served.error) throw new Error(served.error.message);
  return ticket;
}

async function operatorShops(slug?: string) {
  const { data, error } = await serviceClient().rpc(
    "operator_shops",
    slug === undefined ? {} : { p_slug: slug },
  );
  if (error) throw new Error(error.message);
  return data;
}

/** The instant the current Billing Month began, as Postgres computes it. */
const MONTH_START = `
  date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur')
    at time zone 'Asia/Kuala_Lumpur'`;

describe("operator_shops", () => {
  test("lists every Shop with its Owner's email, oldest first", async () => {
    const first = await createShop();
    const second = await createShop();

    const rows = await operatorShops();

    const ours = rows.filter((row) => [first.shop.id, second.shop.id].includes(row.id));
    expect(ours).toEqual([
      expect.objectContaining({
        id: first.shop.id,
        slug: first.shop.slug,
        name: first.shop.name,
        owner_email: first.owner.email.toLowerCase(),
        lat: first.shop.lat,
        lng: first.shop.lng,
        join_radius_m: 150,
        heads_up_threshold: 3,
        max_queue_size: 30,
        is_active: true,
        joining_state: "open",
        current_queue_day_id: first.shop.current_queue_day_id,
        created_at: first.shop.created_at,
        served_this_month: 0,
      }),
      expect.objectContaining({
        id: second.shop.id,
        owner_email: second.owner.email.toLowerCase(),
      }),
    ]);
  });

  test("returns one Shop for a slug, and nothing for a slug no Shop has", async () => {
    const { shop } = await createShop();

    expect(await operatorShops(shop.slug)).toEqual([expect.objectContaining({ id: shop.id })]);
    expect(await operatorShops("nobody-has-this")).toEqual([]);
  });

  test("counts the Tickets Served in the current Billing Month, Malaysia time", async () => {
    const { owner, shop } = await createShop();
    const client = await signInAs(owner.email, owner.password);
    const lastMonth = await serveOne(client, shop.slug);
    const onTheStroke = await serveOne(client, shop.slug);
    await serveOne(client, shop.slug);
    await db.query(
      `update public.tickets set served_at = ${MONTH_START} - interval '1 minute' where id = $1`,
      [lastMonth.id],
    );
    await db.query(`update public.tickets set served_at = ${MONTH_START} where id = $1`, [
      onTheStroke.id,
    ]);

    const [row] = await operatorShops(shop.slug);

    expect(row.served_this_month).toBe(2);
  });

  test("does not count a Done that was undone", async () => {
    const { owner, shop } = await createShop();
    const client = await signInAs(owner.email, owner.password);
    const ticket = await serveOne(client, shop.slug);
    const { error } = await client.rpc("undo_served", { p_ticket_id: ticket.id });
    if (error) throw new Error(error.message);

    const [row] = await operatorShops(shop.slug);

    expect(row.served_this_month).toBe(0);
  });

  test("is not callable by the anon role or by an Owner", async () => {
    const { owner } = await createShop();
    const asOwner = await signInAs(owner.email, owner.password);

    const anon = await anonClient().rpc("operator_shops", {});
    const owned = await asOwner.rpc("operator_shops", {});

    expect(anon.error?.code).toBe("42501");
    expect(owned.error?.code).toBe("42501");
  });
});

describe("revoke_owner_sessions", () => {
  test("signs the Owner out of every device, and nobody else", async () => {
    const { owner } = await createShop();
    const other = await createShop();
    const phone = await signInAs(owner.email, owner.password);
    await signInAs(owner.email, owner.password);
    await signInAs(other.owner.email, other.owner.password);
    expect(await sessionCount(db, owner.email)).toBe(2);

    const { error } = await serviceClient().rpc("revoke_owner_sessions", {
      p_user_id: owner.id,
    });

    expect(error).toBeNull();
    expect(await sessionCount(db, owner.email)).toBe(0);
    expect(await sessionCount(db, other.owner.email)).toBe(1);
    // The refresh token went with the session, so the phone cannot quietly
    // come back once its access token expires.
    const refreshed = await phone.auth.refreshSession();
    expect(refreshed.error).not.toBeNull();
  });

  test("is not callable by the anon role or by an Owner", async () => {
    const { owner } = await createShop();
    const asOwner = await signInAs(owner.email, owner.password);

    const anon = await anonClient().rpc("revoke_owner_sessions", { p_user_id: owner.id });
    const owned = await asOwner.rpc("revoke_owner_sessions", { p_user_id: owner.id });

    expect(anon.error?.code).toBe("42501");
    expect(owned.error?.code).toBe("42501");
    expect(await sessionCount(db, owner.email)).toBe(1);
  });
});
