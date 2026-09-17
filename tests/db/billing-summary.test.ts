import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  anonClient,
  connectDb,
  createShop,
  type OwnerClient,
  resetTestData,
  serveOne,
  serviceClient,
  setServedAt,
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

async function serveAt(owner: OwnerClient, slug: string, servedAt: string) {
  const ticket = await serveOne(owner, slug);
  await setServedAt(db, ticket.id, servedAt);
}

async function billingSummary(month: string) {
  const { data, error } = await serviceClient().rpc("billing_summary", { p_month: month });
  if (error) throw new Error(error.message);
  return data;
}

// 23:59 on 31 August and 00:01 on 1 September in Malaysia are both still
// 31 August in UTC, so a month counted in UTC would put both in August.
const LAST_MINUTE_OF_AUGUST = "2026-08-31T23:59:00+08:00";
const FIRST_MINUTE_OF_SEPTEMBER = "2026-09-01T00:01:00+08:00";

describe("billing_summary", () => {
  test("puts each Served Ticket in its Malaysia-time Billing Month, at RM0.25 each", async () => {
    const { owner, shop } = await createShop();
    const client = await signInAs(owner.email, owner.password);
    await serveAt(client, shop.slug, LAST_MINUTE_OF_AUGUST);
    await serveAt(client, shop.slug, FIRST_MINUTE_OF_SEPTEMBER);
    await serveAt(client, shop.slug, "2026-09-30T23:59:00+08:00");

    expect(await billingSummary("2026-08")).toContainEqual({
      slug: shop.slug,
      name: shop.name,
      served_count: 1,
      amount_sen: 25,
    });
    expect(await billingSummary("2026-09")).toContainEqual({
      slug: shop.slug,
      name: shop.name,
      served_count: 2,
      amount_sen: 50,
    });
  });

  test("lists a Shop that Served nobody, and a Deactivated one, at zero", async () => {
    const { shop } = await createShop();
    const { shop: deactivated } = await createShop();
    await db.query("update public.shops set is_active = false where id = $1", [deactivated.id]);

    const rows = await billingSummary("2026-07");

    expect(rows).toContainEqual({ slug: shop.slug, name: shop.name, served_count: 0, amount_sen: 0 });
    expect(rows).toContainEqual(expect.objectContaining({ slug: deactivated.slug, served_count: 0 }));
  });

  test("refuses a month that is not YYYY-MM", async () => {
    for (const month of ["2026-13", "2026-00", "2026-9", "26-09", "September", ""]) {
      const { error } = await serviceClient().rpc("billing_summary", { p_month: month });
      expect(error, month).toMatchObject({ code: "22023" });
    }
  });

  test("is for the Operator alone: an Owner and a browser cannot call it", async () => {
    const { owner } = await createShop();
    const client = await signInAs(owner.email, owner.password);

    for (const caller of [client, anonClient()]) {
      const { error } = await caller.rpc("billing_summary", { p_month: "2026-09" });
      expect(error).toMatchObject({ code: "42501" });
    }
  });
});
