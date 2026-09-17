import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  anonClient,
  connectDb,
  createShop,
  MONTH_START_SQL,
  resetTestData,
  serveOne,
  serviceClient,
  sessionCount,
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

async function operatorShops(slug?: string) {
  const { data, error } = await serviceClient().rpc(
    "operator_shops",
    slug === undefined ? {} : { p_slug: slug },
  );
  if (error) throw new Error(error.message);
  return data;
}

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
      `update public.tickets set served_at = ${MONTH_START_SQL} - interval '1 minute' where id = $1`,
      [lastMonth.id],
    );
    await db.query(`update public.tickets set served_at = ${MONTH_START_SQL} where id = $1`, [
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
