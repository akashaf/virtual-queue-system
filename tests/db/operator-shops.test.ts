import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import type { Client } from "pg";
import { anonClient, connectDb, resetTestData, uniqueSlug } from "./helpers";

const OPERATOR_API_KEY = "test-operator-key-4f6b8e5c1a0d9f3b7e2c";
const APP_BASE_URL = "https://virtual-queue-system.netlify.app";

let db: Client;
let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  const { apiUrl, serviceRoleKey } = inject("supabase");
  process.env.NEXT_PUBLIC_SUPABASE_URL = apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
  process.env.OPERATOR_API_KEY = OPERATOR_API_KEY;
  process.env.APP_BASE_URL = APP_BASE_URL;

  ({ POST } = await import("@/app/api/operator/shops/route"));
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

function post(payload: unknown, key: string | null = OPERATOR_API_KEY) {
  return POST(
    new Request(`${APP_BASE_URL}/api/operator/shops`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key === null ? {} : { Authorization: `Bearer ${key}` }),
      },
      body: JSON.stringify(payload),
    }),
  );
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
