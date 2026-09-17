import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { inject } from "vitest";
import type { Client } from "pg";
import {
  connectDb,
  createShop,
  insertPushSubscription,
  joinQueue,
  resetTestData,
  serveOne,
  setCarriedOverAgo,
  setFinishedAgo,
  signInAs,
} from "./helpers";

const CRON_SECRET = "test-cron-secret-9d2e4a7b1c6f";
const APP_BASE_URL = "https://virtual-queue-system.netlify.app";

let db: Client;
let POST: typeof import("@/app/api/cron/daily/route").POST;
let runDailyCleanup: typeof import("@/lib/cron/daily").runDailyCleanup;

beforeAll(async () => {
  const { apiUrl, secretKey } = inject("supabase");
  process.env.NEXT_PUBLIC_SUPABASE_URL = apiUrl;
  process.env.SUPABASE_SECRET_KEY = secretKey;
  process.env.CRON_SECRET = CRON_SECRET;

  ({ POST } = await import("@/app/api/cron/daily/route"));
  ({ runDailyCleanup } = await import("@/lib/cron/daily"));
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

/** What Next hands a route with no dynamic segment. */
const noParams = { params: Promise.resolve({}) };

function postDaily(authorization: string | null = `Bearer ${CRON_SECRET}`) {
  return POST(
    new Request(`${APP_BASE_URL}/api/cron/daily`, {
      method: "POST",
      headers: authorization === null ? {} : { Authorization: authorization },
    }),
    noParams,
  );
}

async function ticketRow(ticketId: string) {
  const { rows } = await db.query(
    "select status, customer_name, heads_up_sent_at from public.tickets where id = $1",
    [ticketId],
  );
  return rows[0] as { status: string; customer_name: string | null; heads_up_sent_at: string | null };
}

describe("POST /api/cron/daily", () => {
  test("answers 401 without the secret, or with the wrong one, and does nothing", async () => {
    const { shop } = await createShop();
    const carried = await joinQueue(shop.slug);
    await setCarriedOverAgo(db, carried.id, "5 days");

    for (const authorization of [null, "Bearer not-the-secret", CRON_SECRET]) {
      const response = await postDaily(authorization);

      expect(response.status, String(authorization)).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    expect((await ticketRow(carried.id)).status).toBe("waiting");

    // Leave nothing due behind for the tests that follow.
    await db.query("update public.tickets set status = 'left', finished_at = now() where id = $1", [
      carried.id,
    ]);
  });

  test("expires stale Carried-over Tickets, then erases old personal data, and is safe to run twice", async () => {
    const { shop, owner } = await createShop({ p_heads_up_threshold: 1 });
    const client = await signInAs(owner.email, owner.password);
    const old = await serveOne(client, shop.slug, "Ali");
    await setFinishedAgo(db, old.id, "31 days");
    const carried = await joinQueue(shop.slug, "Bala");
    await joinQueue(shop.slug, "Chong");
    const behind = await joinQueue(shop.slug, "Devi");
    await setCarriedOverAgo(db, carried.id, "5 days");

    const first = await postDaily();

    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({
      expired: 1,
      alerts: 1,
      erasedTickets: 1,
      deletedSubscriptions: 0,
    });
    expect((await ticketRow(carried.id)).status).toBe("removed");
    expect((await ticketRow(behind.id)).heads_up_sent_at).not.toBeNull();
    expect((await ticketRow(old.id)).customer_name).toBeNull();

    const second = await postDaily();

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      expired: 0,
      alerts: 0,
      erasedTickets: 0,
      deletedSubscriptions: 0,
    });
  });
});

describe("runDailyCleanup", () => {
  test("pushes the Heads-ups the expiry earned", async () => {
    const { shop } = await createShop({ p_heads_up_threshold: 1 });
    const carried = await joinQueue(shop.slug, "Ali");
    await joinQueue(shop.slug, "Bala");
    const behind = await joinQueue(shop.slug, "Chong");
    await setCarriedOverAgo(db, carried.id, "5 days");
    const endpoint = await insertPushSubscription(db, behind.id);
    const send = vi.fn(async () => undefined);

    await runDailyCleanup(send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint }),
      expect.stringContaining('"kind":"heads_up"'),
      expect.anything(),
    );
  });
});
