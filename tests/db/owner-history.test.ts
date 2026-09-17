import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  anonClient,
  callNext,
  connectDb,
  createShop,
  joinQueue,
  MONTH_START_SQL,
  type OwnerClient,
  resetTestData,
  serveOne,
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

interface OwnerHistory {
  today: {
    id: string;
    number: number;
    name: string | null;
    status: string;
    joined_at: string;
    called_at: string | null;
    served_at: string | null;
  }[];
  served_by_day: { day: string; served_count: number }[];
  this_month: { served_count: number; amount_sen: number };
}

async function ownerHistory(client: OwnerClient, days?: number) {
  const { data, error } = await client.rpc(
    "get_owner_history",
    days === undefined ? {} : { p_days: days },
  );
  if (error) throw new Error(error.message);
  return data as unknown as OwnerHistory;
}

/** The Malaysian calendar date `offset` days from today, as `YYYY-MM-DD`. */
function malaysiaDate(offset: number) {
  const day = new Date(Date.now() + offset * 86_400_000);
  return day.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

async function ownerWithShop() {
  const { owner, shop } = await createShop();
  return { shop, client: await signInAs(owner.email, owner.password) };
}

describe("get_owner_history", () => {
  test("lists the current Queue Day's Tickets in number order, with statuses and times", async () => {
    const { shop, client } = await ownerWithShop();
    const served = await serveOne(client, shop.slug, "Ali");
    const called = await joinQueue(shop.slug, "Bala");
    const waiting = await joinQueue(shop.slug, "Chong");
    await callNext(client);

    const { today } = await ownerHistory(client);

    const { rows } = await db.query(
      "select id, joined_at, called_at, served_at from public.tickets where shop_id = $1",
      [shop.id],
    );
    const at = (id: string, column: string) =>
      new Date(rows.find((row) => row.id === id)[column]).getTime();

    expect(today.map(({ id, number, name, status }) => ({ id, number, name, status }))).toEqual([
      { id: served.id, number: 1, name: "Ali", status: "served" },
      { id: called.id, number: 2, name: "Bala", status: "called" },
      { id: waiting.id, number: 3, name: "Chong", status: "waiting" },
    ]);
    expect(new Date(today[0].joined_at).getTime()).toBe(at(served.id, "joined_at"));
    expect(new Date(today[0].called_at!).getTime()).toBe(at(served.id, "called_at"));
    expect(new Date(today[0].served_at!).getTime()).toBe(at(served.id, "served_at"));
    expect(today[1].served_at).toBeNull();
    expect(today[2].called_at).toBeNull();
  });

  test("counts Served Tickets per Malaysian calendar day, newest first, quiet days included", async () => {
    const { shop, client } = await ownerWithShop();
    const lastMinuteOfYesterday = await serveOne(client, shop.slug);
    const firstMinuteOfToday = await serveOne(client, shop.slug);
    await serveOne(client, shop.slug);
    await setServedAt(db, lastMinuteOfYesterday.id, `${malaysiaDate(-1)}T23:59:00+08:00`);
    await setServedAt(db, firstMinuteOfToday.id, `${malaysiaDate(0)}T00:01:00+08:00`);

    const { served_by_day: days } = await ownerHistory(client);

    expect(days).toHaveLength(30);
    expect(days.slice(0, 3)).toEqual([
      { day: malaysiaDate(0), served_count: 2 },
      { day: malaysiaDate(-1), served_count: 1 },
      { day: malaysiaDate(-2), served_count: 0 },
    ]);
    expect(days[29]).toEqual({ day: malaysiaDate(-29), served_count: 0 });
  });

  test("covers as many days as asked for", async () => {
    const { client } = await ownerWithShop();

    const { served_by_day: days } = await ownerHistory(client, 7);

    expect(days.map(({ day }) => day)).toEqual(
      [0, -1, -2, -3, -4, -5, -6].map(malaysiaDate),
    );
  });

  test("totals the Billing Month so far in Malaysia time, at RM0.25 each", async () => {
    const { shop, client } = await ownerWithShop();
    const lastMinuteOfLastMonth = await serveOne(client, shop.slug);
    const firstMinuteOfThisMonth = await serveOne(client, shop.slug);
    await serveOne(client, shop.slug);
    await db.query(
      `update public.tickets set served_at = ${MONTH_START_SQL} - interval '1 minute' where id = $1`,
      [lastMinuteOfLastMonth.id],
    );
    await db.query(
      `update public.tickets set served_at = ${MONTH_START_SQL} + interval '1 minute' where id = $1`,
      [firstMinuteOfThisMonth.id],
    );

    const { this_month: month } = await ownerHistory(client);

    expect(month).toEqual({ served_count: 2, amount_sen: 50 });
  });

  test("shows an Owner only their own Shop", async () => {
    const mine = await ownerWithShop();
    const theirs = await ownerWithShop();
    await serveOne(theirs.client, theirs.shop.slug);
    await joinQueue(theirs.shop.slug);

    const history = await ownerHistory(mine.client);

    expect(history.today).toEqual([]);
    expect(history.served_by_day.every(({ served_count }) => served_count === 0)).toBe(true);
    expect(history.this_month).toEqual({ served_count: 0, amount_sen: 0 });
  });

  test("leaves out the Tickets of Queue Days already closed", async () => {
    const { shop, client } = await ownerWithShop();
    await serveOne(client, shop.slug, "Yesterday");
    const closed = await client.rpc("close_shop");
    if (closed.error) throw new Error(closed.error.message);
    const today = await joinQueue(shop.slug, "Today");

    const history = await ownerHistory(client);

    expect(history.today.map(({ id }) => id)).toEqual([today.id]);
    // The Served Ticket is still billed, whichever Queue Day it belonged to.
    expect(history.this_month.served_count).toBe(1);
  });

  test("refuses the Owner of a Deactivated Shop with shop_inactive", async () => {
    const { shop, client } = await ownerWithShop();
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);

    const { error } = await client.rpc("get_owner_history");

    expect(error).toMatchObject({ code: "P0001", message: "shop_inactive" });
  });

  test("refuses a number of days outside 1 to 366", async () => {
    const { client } = await ownerWithShop();

    for (const days of [0, -1, 367]) {
      const { error } = await client.rpc("get_owner_history", { p_days: days });
      expect(error, String(days)).toMatchObject({ code: "22023" });
    }
  });

  test("cannot be called without an Owner's session", async () => {
    const { error } = await anonClient().rpc("get_owner_history");

    expect(error).toMatchObject({ code: "42501" });
  });
});
