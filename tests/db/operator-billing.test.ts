import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import type { Client } from "pg";
import {
  connectDb,
  createShop,
  resetTestData,
  serveOne,
  setServedAt,
  signInAs,
} from "./helpers";

const OPERATOR_API_KEY = "test-operator-key-4f6b8e5c1a0d9f3b7e2c";
const APP_BASE_URL = "https://virtual-queue-system.netlify.app";

let db: Client;
let GET: typeof import("@/app/api/operator/billing/route").GET;

beforeAll(async () => {
  const { apiUrl, secretKey } = inject("supabase");
  process.env.NEXT_PUBLIC_SUPABASE_URL = apiUrl;
  process.env.SUPABASE_SECRET_KEY = secretKey;
  process.env.OPERATOR_API_KEY = OPERATOR_API_KEY;

  ({ GET } = await import("@/app/api/operator/billing/route"));
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

/** What Next hands a route with no dynamic segment. */
const noParams = { params: Promise.resolve({}) };

function billing(query: string, key: string | null = OPERATOR_API_KEY) {
  return GET(
    new Request(`${APP_BASE_URL}/api/operator/billing${query}`, {
      headers: key === null ? {} : { Authorization: `Bearer ${key}` },
    }),
    noParams,
  );
}

/** Serves `count` Customers at the Shop, each moved to the same instant. */
async function serve(
  shop: { slug: string },
  owner: { email: string; password: string },
  count: number,
  servedAt: string,
) {
  const client = await signInAs(owner.email, owner.password);
  for (let i = 0; i < count; i++) {
    const ticket = await serveOne(client, shop.slug);
    await setServedAt(db, ticket.id, servedAt);
  }
}

describe("GET /api/operator/billing", () => {
  test("returns each Shop's Served count and amount for the month, and the total", async () => {
    const first = await createShop({ p_name: "Kedai Ali" });
    const second = await createShop({ p_name: "Kedai Bala" });
    await serve(first.shop, first.owner, 3, "2026-06-15T12:00:00+08:00");
    await serve(second.shop, second.owner, 1, "2026-06-30T23:59:00+08:00");
    // The first minute of July in Malaysia is still June in UTC, and not June's to bill.
    await serve(second.shop, second.owner, 1, "2026-07-01T00:01:00+08:00");

    const response = await billing("?month=2026-06");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      month: "2026-06",
      shops: [
        { slug: first.shop.slug, name: "Kedai Ali", servedCount: 3, amountSen: 75 },
        { slug: second.shop.slug, name: "Kedai Bala", servedCount: 1, amountSen: 25 },
      ],
      totalSen: 100,
    });
  });

  test("answers 401 without the Operator key, or with the wrong one", async () => {
    for (const key of [null, "not-the-key"]) {
      const response = await billing("?month=2026-06", key);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
  });

  test("answers 400 naming the month when it is missing or not YYYY-MM", async () => {
    for (const query of ["", "?month=", "?month=2026-6", "?month=2026-13", "?month=June"]) {
      const response = await billing(query);

      expect(response.status, query).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid_query",
        field: "month",
        message: "Expected a month as YYYY-MM.",
      });
    }
  });
});
