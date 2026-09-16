import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import type { Client } from "pg";
import {
  connectDb,
  createShop,
  metresNorthOf,
  resetTestData,
  serviceClient,
  SHOP_LNG,
  uniqueSlug,
} from "./helpers";

let db: Client;
let GET: typeof import("@/app/api/s/[slug]/me/route").GET;

beforeAll(async () => {
  const { apiUrl, secretKey } = inject("supabase");
  process.env.NEXT_PUBLIC_SUPABASE_URL = apiUrl;
  process.env.SUPABASE_SECRET_KEY = secretKey;

  ({ GET } = await import("@/app/api/s/[slug]/me/route"));
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

/** Calls the Route Handler the way a refetching Customer page does. */
function get(slug: string, cookie?: string) {
  return GET(
    new Request(`https://queue.test/api/s/${slug}/me`, {
      headers: cookie ? { cookie } : {},
    }),
    { params: Promise.resolve({ slug }) },
  );
}

async function join(slug: string, deviceId: string, name = "Ali") {
  const { error } = await serviceClient().rpc("join_queue", {
    p_slug: slug,
    p_device_id: deviceId,
    p_name: name,
    p_lat: metresNorthOf(0),
    p_lng: SHOP_LNG,
    p_accuracy_m: 0,
  });
  if (error) throw new Error(error.message);
}

describe("GET /api/s/[slug]/me", () => {
  test("describes the Shop to a device that has not joined", async () => {
    const { shop } = await createShop();

    const response = await get(shop.slug);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      shop: {
        id: shop.id,
        name: shop.name,
        isActive: true,
        joiningState: "open",
        waitingCount: 0,
        headsUpThreshold: 3,
      },
      ticket: null,
      estimate: null,
    });
  });

  test("is never cached, because a stale position is worse than none", async () => {
    const { shop } = await createShop();

    const response = await get(shop.slug);

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("returns 404 for a slug no Shop has", async () => {
    const response = await get(uniqueSlug("nobody"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  test("gives the device in the cookie its own Ticket and position", async () => {
    const { shop } = await createShop();
    const deviceId = crypto.randomUUID();
    await join(shop.slug, crypto.randomUUID(), "Siti");
    await join(shop.slug, deviceId);

    const response = await get(shop.slug, `vq_device=${deviceId}`);

    expect(await response.json()).toMatchObject({
      shop: { waitingCount: 2 },
      ticket: { number: 2, status: "waiting", position: 1 },
    });
  });

  test("finds the device cookie among the others a browser sends", async () => {
    const { shop } = await createShop();
    const deviceId = crypto.randomUUID();
    await join(shop.slug, deviceId);

    const response = await get(shop.slug, `vq_lang=ms; vq_device=${deviceId}`);

    expect(await response.json()).toMatchObject({ ticket: { number: 1 } });
  });

  test("ignores a device named in the query string", async () => {
    // The only claim a Customer can make is the cookie the server gave them.
    const { shop } = await createShop();
    const theirs = crypto.randomUUID();
    await join(shop.slug, theirs);

    const response = await GET(
      new Request(`https://queue.test/api/s/${shop.slug}/me?device=${theirs}`),
      { params: Promise.resolve({ slug: shop.slug }) },
    );

    expect(await response.json()).toMatchObject({ ticket: null });
  });

  test("treats a forged cookie as no device at all, rather than failing", async () => {
    const { shop } = await createShop();

    const response = await get(shop.slug, "vq_device=not-a-uuid");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ticket: null });
  });

  test("reports a Deactivated Shop so the page can say it is closed", async () => {
    const { shop } = await createShop();
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);

    const response = await get(shop.slug);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ shop: { isActive: false } });
  });
});
