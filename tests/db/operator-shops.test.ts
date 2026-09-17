import jsQR from "jsqr";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import type { Client } from "pg";
import {
  anonClient,
  connectDb,
  metresNorthOf,
  resetTestData,
  serviceClient,
  sessionCount,
  SHOP_LNG,
  signInAs,
  uniqueSlug,
} from "./helpers";

const OPERATOR_API_KEY = "test-operator-key-4f6b8e5c1a0d9f3b7e2c";
const APP_BASE_URL = "https://virtual-queue-system.netlify.app";

let db: Client;
let POST: typeof import("@/app/api/operator/shops/route").POST;
let GET: typeof import("@/app/api/operator/shops/route").GET;
let shopRoute: typeof import("@/app/api/operator/shops/[slug]/route");
let passwordRoute: typeof import("@/app/api/operator/shops/[slug]/owner-password/route");
let qrRoute: typeof import("@/app/api/operator/shops/[slug]/qr.png/route");

beforeAll(async () => {
  const { apiUrl, secretKey } = inject("supabase");
  process.env.NEXT_PUBLIC_SUPABASE_URL = apiUrl;
  process.env.SUPABASE_SECRET_KEY = secretKey;
  process.env.OPERATOR_API_KEY = OPERATOR_API_KEY;
  process.env.APP_BASE_URL = APP_BASE_URL;

  ({ POST, GET } = await import("@/app/api/operator/shops/route"));
  shopRoute = await import("@/app/api/operator/shops/[slug]/route");
  passwordRoute = await import("@/app/api/operator/shops/[slug]/owner-password/route");
  qrRoute = await import("@/app/api/operator/shops/[slug]/qr.png/route");
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

function body(overrides: Record<string, unknown> = {}) {
  return {
    slug: uniqueSlug(),
    name: "Kedai Gunting Rambut Ali",
    lat: 3.1319,
    lng: 101.6841,
    ownerEmail: `owner-${crypto.randomUUID()}@example.test`,
    ownerPassword: "correct-horse-battery",
    ...overrides,
  };
}

function authHeaders(key: string | null): Record<string, string> {
  return key === null ? {} : { Authorization: `Bearer ${key}` };
}

/** What Next hands a route with no dynamic segment. */
const noParams = { params: Promise.resolve({}) };

function post(payload: unknown, key: string | null = OPERATOR_API_KEY) {
  return POST(
    new Request(`${APP_BASE_URL}/api/operator/shops`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(key) },
      body: JSON.stringify(payload),
    }),
    noParams,
  );
}

/** Onboards a Shop through the API and hands back what the Operator would hold. */
async function createShopViaApi(overrides: Record<string, unknown> = {}) {
  const payload = body(overrides);
  const response = await post(payload);
  if (response.status !== 201) throw new Error(`Setup failed: ${await response.text()}`);
  const { shop } = await response.json();
  return { shop, ownerEmail: payload.ownerEmail, ownerPassword: payload.ownerPassword };
}

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

function list(key: string | null = OPERATOR_API_KEY) {
  return GET(
    new Request(`${APP_BASE_URL}/api/operator/shops`, { headers: authHeaders(key) }),
    noParams,
  );
}

function getShop(slug: string, key: string | null = OPERATOR_API_KEY) {
  return shopRoute.GET(
    new Request(`${APP_BASE_URL}/api/operator/shops/${slug}`, { headers: authHeaders(key) }),
    params(slug),
  );
}

function patch(slug: string, payload: unknown, key: string | null = OPERATOR_API_KEY) {
  return shopRoute.PATCH(
    new Request(`${APP_BASE_URL}/api/operator/shops/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(key) },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
    params(slug),
  );
}

function resetPassword(slug: string, payload: unknown, key: string | null = OPERATOR_API_KEY) {
  return passwordRoute.POST(
    new Request(`${APP_BASE_URL}/api/operator/shops/${slug}/owner-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(key) },
      body: JSON.stringify(payload),
    }),
    params(slug),
  );
}

function qr(slug: string, key: string | null = OPERATOR_API_KEY) {
  return qrRoute.GET(
    new Request(`${APP_BASE_URL}/api/operator/shops/${slug}/qr.png`, { headers: authHeaders(key) }),
    params(slug),
  );
}

async function joinQueue(slug: string) {
  return serviceClient().rpc("join_queue", {
    p_slug: slug,
    p_device_id: crypto.randomUUID(),
    p_name: "Ali",
    p_lat: metresNorthOf(0),
    p_lng: SHOP_LNG,
    p_accuracy_m: 0,
  });
}

async function ownerExists(email: string) {
  const { rows } = await db.query("select 1 from auth.users where email = $1", [
    email.toLowerCase(),
  ]);
  return rows.length === 1;
}

describe("POST /api/operator/shops", () => {
  test("creates the Shop, its Owner and its first Queue Day", async () => {
    const payload = body({ slug: "kedai-ali-1" });

    const response = await post(payload);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      shop: {
        id: expect.any(String),
        slug: "kedai-ali-1",
        name: "Kedai Gunting Rambut Ali",
        ownerEmail: payload.ownerEmail.toLowerCase(),
        lat: 3.1319,
        lng: 101.6841,
        joinRadiusM: 150,
        headsUpThreshold: 3,
        maxQueueSize: 30,
        isActive: true,
        joiningState: "open",
        currentQueueDayId: expect.any(String),
        createdAt: expect.any(String),
        servedThisMonth: 0,
      },
      queueUrl: `${APP_BASE_URL}/s/kedai-ali-1`,
      qrUrl: `${APP_BASE_URL}/api/operator/shops/kedai-ali-1/qr.png`,
    });

    const { rows } = await db.query(
      `select q.next_number, q.closed_at
         from public.queue_days q
         join public.shops s on s.current_queue_day_id = q.id
        where s.slug = 'kedai-ali-1'`,
    );
    expect(rows).toEqual([{ next_number: 1, closed_at: null }]);
  });

  test("answers with no-store, because Shop state is never cacheable", async () => {
    const response = await post(body());

    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("passes the optional Shop settings through", async () => {
    const response = await post(
      body({ joinRadiusM: 80, headsUpThreshold: 2, maxQueueSize: 15 }),
    );

    const { shop } = await response.json();
    expect(shop).toMatchObject({
      joinRadiusM: 80,
      headsUpThreshold: 2,
      maxQueueSize: 15,
    });
  });

  test("creates an Owner who can sign in straight away", async () => {
    const payload = body();

    await post(payload);

    const { error } = await anonClient().auth.signInWithPassword({
      email: payload.ownerEmail,
      password: payload.ownerPassword,
    });
    expect(error).toBeNull();
  });

  test("never echoes the owner password", async () => {
    const payload = body({ ownerPassword: "sup3r-secret-password" });

    const response = await post(payload);

    expect(await response.text()).not.toContain("sup3r-secret-password");
  });

  describe("authorisation", () => {
    test("401 without an Authorization header", async () => {
      const payload = body();

      const response = await post(payload, null);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(await ownerExists(payload.ownerEmail)).toBe(false);
    });

    test("401 with the wrong key", async () => {
      const payload = body();

      const response = await post(payload, "not-the-operator-key");

      expect(response.status).toBe(401);
      expect(await ownerExists(payload.ownerEmail)).toBe(false);
    });
  });

  describe("invalid input", () => {
    test("400 with the offending field for a bad slug", async () => {
      const payload = body({ slug: "Kedai Ali" });

      const response = await post(payload);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "invalid_body",
        field: "slug",
      });
      expect(await ownerExists(payload.ownerEmail)).toBe(false);
    });

    test("400 for a body that isn't JSON", async () => {
      const response = await POST(
        new Request(`${APP_BASE_URL}/api/operator/shops`, {
          method: "POST",
          headers: { Authorization: `Bearer ${OPERATOR_API_KEY}` },
          body: "not json",
        }),
        noParams,
      );

      expect(response.status).toBe(400);
    });

    test("400 for a short owner password, before the Owner is created", async () => {
      const payload = body({ ownerPassword: "short" });

      const response = await post(payload);

      expect(response.status).toBe(400);
      expect(await ownerExists(payload.ownerEmail)).toBe(false);
    });
  });

  describe("misconfiguration", () => {
    test("refuses to write anything when APP_BASE_URL is missing", async () => {
      // Read at the end instead, this would throw after the Owner and the Shop
      // were both committed, and the Operator would never see the new Shop.
      const payload = body();
      delete process.env.APP_BASE_URL;

      try {
        await expect(post(payload)).rejects.toThrow(/APP_BASE_URL/);
      } finally {
        process.env.APP_BASE_URL = APP_BASE_URL;
      }

      expect(await ownerExists(payload.ownerEmail)).toBe(false);
      const { rows } = await db.query(
        "select 1 from public.shops where slug = $1",
        [payload.slug],
      );
      expect(rows).toHaveLength(0);
    });

    test("fails loudly rather than 401ing when OPERATOR_API_KEY is missing", async () => {
      delete process.env.OPERATOR_API_KEY;

      try {
        await expect(post(body())).rejects.toThrow(/OPERATOR_API_KEY/);
      } finally {
        process.env.OPERATOR_API_KEY = OPERATOR_API_KEY;
      }
    });
  });

  describe("conflicts", () => {
    test("409 when the slug is taken, leaving no orphan Owner behind", async () => {
      const slug = uniqueSlug();
      await post(body({ slug }));
      const second = body({ slug });

      const response = await post(second);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "slug_taken" });
      expect(await ownerExists(second.ownerEmail)).toBe(false);
    });

    test("409 when the email already belongs to an Owner", async () => {
      const first = body();
      await post(first);

      const response = await post(body({ ownerEmail: first.ownerEmail }));

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "email_taken" });
    });

    test("the Shop from a rejected duplicate is not created", async () => {
      const slug = uniqueSlug();
      await post(body({ slug }));

      await post(body({ slug }));

      const { rows } = await db.query(
        "select count(*)::int as n from public.shops where slug = $1",
        [slug],
      );
      expect(rows[0].n).toBe(1);
    });
  });
});

describe("GET /api/operator/shops", () => {
  test("lists every Shop with its Owner's email and the month's Served count", async () => {
    const a = await createShopViaApi();
    const b = await createShopViaApi();

    const response = await list();

    expect(response.status).toBe(200);
    const { shops } = await response.json();
    expect(shops).toEqual(
      expect.arrayContaining([
        { ...a.shop, ownerEmail: a.ownerEmail.toLowerCase(), servedThisMonth: 0 },
        { ...b.shop, ownerEmail: b.ownerEmail.toLowerCase(), servedThisMonth: 0 },
      ]),
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("401 without the key, and with the wrong one", async () => {
    expect((await list(null)).status).toBe(401);
    expect((await list("not-the-operator-key")).status).toBe(401);
  });

  test("answers internal_error, not a crash, when the database refuses", async () => {
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SECRET_KEY = "sb_secret_not_the_real_one";

    try {
      const response = await list();

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "internal_error" });
    } finally {
      process.env.SUPABASE_SECRET_KEY = secretKey;
    }
  });
});

describe("GET /api/operator/shops/[slug]", () => {
  test("returns one Shop with its queue and QR URLs", async () => {
    const { shop } = await createShopViaApi();

    const response = await getShop(shop.slug);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      shop,
      queueUrl: `${APP_BASE_URL}/s/${shop.slug}`,
      qrUrl: `${APP_BASE_URL}/api/operator/shops/${shop.slug}/qr.png`,
    });
  });

  test("404 for a slug no Shop has", async () => {
    const response = await getShop(uniqueSlug("nobody"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  test("401 without the key", async () => {
    const { shop } = await createShopViaApi();

    expect((await getShop(shop.slug, null)).status).toBe(401);
  });
});

describe("PATCH /api/operator/shops/[slug]", () => {
  test("updates the settings it is given and leaves the rest alone", async () => {
    const { shop } = await createShopViaApi();

    const response = await patch(shop.slug, {
      name: "Kedai Ali Baru",
      lat: 3.2,
      lng: 101.7,
      joinRadiusM: 80,
      headsUpThreshold: 2,
      maxQueueSize: 15,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      shop: {
        ...shop,
        name: "Kedai Ali Baru",
        lat: 3.2,
        lng: 101.7,
        joinRadiusM: 80,
        headsUpThreshold: 2,
        maxQueueSize: 15,
      },
      queueUrl: `${APP_BASE_URL}/s/${shop.slug}`,
      qrUrl: `${APP_BASE_URL}/api/operator/shops/${shop.slug}/qr.png`,
    });
  });

  test("a partial body changes only what it names", async () => {
    const { shop } = await createShopViaApi();

    const response = await patch(shop.slug, { headsUpThreshold: 5 });

    expect((await response.json()).shop).toEqual({ ...shop, headsUpThreshold: 5 });
  });

  test("refuses to change the slug, and the printed one stays", async () => {
    const { shop } = await createShopViaApi();

    const response = await patch(shop.slug, { slug: "kedai-renamed", name: "Kedai Ali" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_body", field: "slug" });
    const { rows } = await db.query("select name from public.shops where slug = $1", [shop.slug]);
    expect(rows).toEqual([{ name: shop.name }]);
  });

  test("400 with the offending field for a bad value, an unknown field or an empty body", async () => {
    const { shop } = await createShopViaApi();

    expect(await (await patch(shop.slug, { joinRadiusM: 0 })).json()).toMatchObject({
      field: "joinRadiusM",
    });
    expect(await (await patch(shop.slug, { ownerEmail: "x@example.test" })).json()).toMatchObject({
      field: "ownerEmail",
    });
    expect(await (await patch(shop.slug, {})).json()).toMatchObject({ field: "body" });
    expect((await patch(shop.slug, "not json")).status).toBe(400);
  });

  test("404 for a slug no Shop has", async () => {
    expect((await patch(uniqueSlug("nobody"), { name: "Nobody" })).status).toBe(404);
  });

  test("401 without the key, before anything changes", async () => {
    const { shop } = await createShopViaApi();

    const response = await patch(shop.slug, { name: "Changed" }, null);

    expect(response.status).toBe(401);
    expect((await (await getShop(shop.slug)).json()).shop.name).toBe(shop.name);
  });

  describe("deactivating", () => {
    test("signs the Owner out everywhere, shuts the Queue and keeps the history", async () => {
      const { shop, ownerEmail, ownerPassword } = await createShopViaApi();
      const joined = await joinQueue(shop.slug);
      expect(joined.error).toBeNull();
      const tablet = await signInAs(ownerEmail, ownerPassword);
      expect(await sessionCount(db, ownerEmail)).toBe(1);

      const response = await patch(shop.slug, { isActive: false });

      expect(response.status).toBe(200);
      expect((await response.json()).shop).toMatchObject({ isActive: false });
      // Signed out everywhere: the session is gone, the Auth server no longer
      // answers for the tablet's token, and the tablet cannot refresh.
      expect(await sessionCount(db, ownerEmail)).toBe(0);
      expect((await tablet.auth.getUser()).data.user).toBeNull();
      expect((await tablet.auth.refreshSession()).error).not.toBeNull();
      // The Queue rejects joins...
      expect((await joinQueue(shop.slug)).error?.message).toBe("shop_inactive");
      // ...and the Shop and its Tickets are still there.
      const { rows } = await db.query(
        "select count(*)::int as n from public.tickets where shop_id = $1",
        [shop.id],
      );
      expect(rows[0].n).toBe(1);
      expect((await getShop(shop.slug)).status).toBe(200);
    });

    test("the sign-in gate finds no Shop for the Owner afterwards", async () => {
      // Auth knows nothing about Shops, so a fresh password sign-in still
      // succeeds; the sign-in action then asks findOwnerShop, which reads the
      // Owner's own row and treats an inactive Shop as none, and signs them
      // straight back out. The action itself needs a request's cookies, so this
      // drives the check it makes rather than the action.
      const { findOwnerShop } = await import("@/lib/auth/owner");
      const { shop, ownerEmail, ownerPassword } = await createShopViaApi();
      await patch(shop.slug, { isActive: false });

      const asOwner = await signInAs(ownerEmail, ownerPassword);
      const {
        data: { user },
      } = await asOwner.auth.getUser();

      expect(await findOwnerShop(asOwner, user!.id)).toBeNull();
    });

    test("reactivating opens the Queue and the dashboard again", async () => {
      const { findOwnerShop } = await import("@/lib/auth/owner");
      const { shop, ownerEmail, ownerPassword } = await createShopViaApi();
      await patch(shop.slug, { isActive: false });

      const response = await patch(shop.slug, { isActive: true });

      expect((await response.json()).shop).toMatchObject({ isActive: true });
      expect((await joinQueue(shop.slug)).error).toBeNull();
      const asOwner = await signInAs(ownerEmail, ownerPassword);
      const { data } = await asOwner.auth.getUser();
      expect(await findOwnerShop(asOwner, data.user!.id)).toMatchObject({ id: shop.id });
    });
  });
});

describe("POST /api/operator/shops/[slug]/owner-password", () => {
  test("replaces the password and signs the Owner out everywhere", async () => {
    const { shop, ownerEmail, ownerPassword } = await createShopViaApi();
    await signInAs(ownerEmail, ownerPassword);
    expect(await sessionCount(db, ownerEmail)).toBe(1);

    const response = await resetPassword(shop.slug, { password: "new-horse-battery" });

    expect(response.status).toBe(204);
    expect(await sessionCount(db, ownerEmail)).toBe(0);
    const old = await anonClient().auth.signInWithPassword({
      email: ownerEmail,
      password: ownerPassword,
    });
    expect(old.error).not.toBeNull();
    const fresh = await anonClient().auth.signInWithPassword({
      email: ownerEmail,
      password: "new-horse-battery",
    });
    expect(fresh.error).toBeNull();
  });

  test("400 for a password under 10 characters, leaving the old one working", async () => {
    const { shop, ownerEmail, ownerPassword } = await createShopViaApi();

    const response = await resetPassword(shop.slug, { password: "short" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_body", field: "password" });
    const { error } = await anonClient().auth.signInWithPassword({
      email: ownerEmail,
      password: ownerPassword,
    });
    expect(error).toBeNull();
  });

  test("404 for a slug no Shop has", async () => {
    const response = await resetPassword(uniqueSlug("nobody"), { password: "new-horse-battery" });

    expect(response.status).toBe(404);
  });

  test("401 without the key", async () => {
    const { shop } = await createShopViaApi();

    const response = await resetPassword(shop.slug, { password: "new-horse-battery" }, null);

    expect(response.status).toBe(401);
  });
});

describe("GET /api/operator/shops/[slug]/qr.png", () => {
  test("answers a 1024×1024 PNG that scans to the Shop's queue URL", async () => {
    const { shop } = await createShopViaApi();

    const response = await qr(shop.slug);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toContain(`${shop.slug}-qr.png`);
    const image = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
    expect([image.width, image.height]).toEqual([1024, 1024]);
    const pixels = new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.length);
    expect(jsQR(pixels, image.width, image.height)?.data).toBe(`${APP_BASE_URL}/s/${shop.slug}`);
  });

  test("404 for a slug no Shop has, rather than a code for nowhere", async () => {
    const response = await qr(uniqueSlug("nobody"));

    expect(response.status).toBe(404);
  });

  test("401 without the key", async () => {
    const { shop } = await createShopViaApi();

    expect((await qr(shop.slug, null)).status).toBe(401);
  });
});
