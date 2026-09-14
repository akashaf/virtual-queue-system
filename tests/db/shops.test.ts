import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  anonClient,
  connectDb,
  createOwner,
  createShop,
  resetTestData,
  serviceClient,
  signInAs,
  uniqueSlug,
} from "./helpers";

let db: Client;

beforeAll(async () => {
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

describe("create_shop", () => {
  test("creates a Shop with the documented defaults and its first Queue Day", async () => {
    const { owner, shop } = await createShop({ p_slug: "kedai-ali" });

    expect(shop).toMatchObject({
      slug: "kedai-ali",
      name: "Kedai Gunting Rambut",
      owner_user_id: owner.id,
      join_radius_m: 150,
      heads_up_threshold: 3,
      max_queue_size: 30,
      is_active: true,
      joining_state: "open",
    });
    expect(shop.current_queue_day_id).toEqual(expect.any(String));

    const { rows } = await db.query(
      "select shop_id, closed_at, next_number from public.queue_days where id = $1",
      [shop.current_queue_day_id],
    );
    expect(rows).toEqual([
      { shop_id: shop.id, closed_at: null, next_number: 1 },
    ]);
  });

  test("applies the Operator's overrides for radius, threshold and queue size", async () => {
    const { shop } = await createShop({
      p_join_radius_m: 40,
      p_heads_up_threshold: 1,
      p_max_queue_size: 12,
    });

    expect(shop).toMatchObject({
      join_radius_m: 40,
      heads_up_threshold: 1,
      max_queue_size: 12,
    });
  });

  test("rejects a second Shop for the same Owner", async () => {
    const { owner } = await createShop();

    const { error } = await serviceClient().rpc("create_shop", {
      p_slug: uniqueSlug(),
      p_name: "Second Shop",
      p_owner_user_id: owner.id,
      p_lat: 3.1,
      p_lng: 101.6,
    });

    expect(error?.code).toBe("23505");
  });

  test("rejects a slug that is already taken", async () => {
    const slug = uniqueSlug();
    await createShop({ p_slug: slug });
    const owner = await createOwner();

    const { error } = await serviceClient().rpc("create_shop", {
      p_slug: slug,
      p_name: "Copycat",
      p_owner_user_id: owner.id,
      p_lat: 3.1,
      p_lng: 101.6,
    });

    expect(error?.code).toBe("23505");
  });

  test("leaves no Shop behind when a later step fails", async () => {
    // The function is one transaction, so the rejected threshold takes the Shop
    // row and its Queue Day down with it.
    const owner = await createOwner();
    const slug = uniqueSlug();

    const { error } = await serviceClient().rpc("create_shop", {
      p_slug: slug,
      p_name: "Bad Shop",
      p_owner_user_id: owner.id,
      p_lat: 3.1,
      p_lng: 101.6,
      p_heads_up_threshold: 0,
    });

    expect(error).not.toBeNull();
    const { rows } = await db.query("select 1 from public.shops where slug = $1", [
      slug,
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("shops constraints", () => {
  test.each([
    ["too short", "ab"],
    ["uppercase", "Kedai-Ali"],
    ["an underscore", "kedai_ali"],
    ["a space", "kedai ali"],
    ["41 characters", "a".repeat(41)],
  ])("rejects a slug with %s", async (_label, slug) => {
    const owner = await createOwner();

    const { error } = await serviceClient().rpc("create_shop", {
      p_slug: slug,
      p_name: "Shop",
      p_owner_user_id: owner.id,
      p_lat: 3.1,
      p_lng: 101.6,
    });

    expect(error?.code).toBe("23514");
  });

  test.each([
    ["3 characters", "abc"],
    ["40 characters", "a".repeat(40)],
    ["digits and dashes", "kedai-24-jam"],
  ])("accepts a slug of %s", async (_label, slug) => {
    const { shop } = await createShop({ p_slug: slug });

    expect(shop.slug).toBe(slug);
  });

  test("rejects a Heads-up Threshold below 1", async () => {
    const owner = await createOwner();

    const { error } = await serviceClient().rpc("create_shop", {
      p_slug: uniqueSlug(),
      p_name: "Shop",
      p_owner_user_id: owner.id,
      p_lat: 3.1,
      p_lng: 101.6,
      p_heads_up_threshold: 0,
    });

    expect(error?.code).toBe("23514");
  });

  test("refuses to change a slug once the QR code could be printed", async () => {
    const { shop } = await createShop();

    await expect(
      db.query("update public.shops set slug = $2 where id = $1", [
        shop.id,
        uniqueSlug("renamed"),
      ]),
    ).rejects.toThrow(/slug_immutable/);
  });

  test("allows the rest of the Shop to be updated", async () => {
    const { shop } = await createShop();

    await db.query(
      "update public.shops set name = 'New Name', is_active = false where id = $1",
      [shop.id],
    );

    const { rows } = await db.query(
      "select name, is_active from public.shops where id = $1",
      [shop.id],
    );
    expect(rows[0]).toEqual({ name: "New Name", is_active: false });
  });
});

describe("row level security", () => {
  test("an Owner reads their own Shop and its Queue Days", async () => {
    const { owner, shop } = await createShop();
    const client = await signInAs(owner.email, owner.password);

    const { data: shops } = await client.from("shops").select("id, slug, name");
    expect(shops).toEqual([
      { id: shop.id, slug: shop.slug, name: shop.name },
    ]);

    const { data: days } = await client.from("queue_days").select("id, shop_id");
    expect(days).toEqual([{ id: shop.current_queue_day_id, shop_id: shop.id }]);
  });

  test("an Owner cannot read another Owner's Shop", async () => {
    const { shop: theirs } = await createShop();
    const { owner } = await createShop();
    const client = await signInAs(owner.email, owner.password);

    const { data } = await client.from("shops").select("id").eq("id", theirs.id);

    expect(data).toEqual([]);
  });

  test("an Owner cannot read another Owner's Queue Days", async () => {
    const { shop: theirs } = await createShop();
    const { owner } = await createShop();
    const client = await signInAs(owner.email, owner.password);

    const { data } = await client
      .from("queue_days")
      .select("id")
      .eq("shop_id", theirs.id);

    expect(data).toEqual([]);
  });

  test("an Owner cannot write to their own Shop directly", async () => {
    const { owner, shop } = await createShop();
    const client = await signInAs(owner.email, owner.password);

    const { error } = await client
      .from("shops")
      .update({ name: "Renamed by the Owner" })
      .eq("id", shop.id);

    expect(error).not.toBeNull();
  });

  test("the anon role has no access to shops or queue_days", async () => {
    await createShop();
    const client = anonClient();

    const shops = await client.from("shops").select("id");
    const days = await client.from("queue_days").select("id");

    expect(shops.error).not.toBeNull();
    expect(days.error).not.toBeNull();
  });

  test("the anon role cannot call create_shop", async () => {
    const owner = await createOwner();

    const { error } = await anonClient().rpc("create_shop", {
      p_slug: uniqueSlug(),
      p_name: "Shop",
      p_owner_user_id: owner.id,
      p_lat: 3.1,
      p_lng: 101.6,
    });

    expect(error).not.toBeNull();
  });
});
