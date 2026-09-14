import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import { connectDb, createShop, resetTestData, SHOP_LAT, SHOP_LNG } from "./helpers";

let db: Client;

beforeAll(async () => {
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

/** Inserts a Ticket directly, bypassing join_queue, to test the table's own rules. */
async function insertTicket(
  shop: { id: string; current_queue_day_id: string | null },
  overrides: Record<string, unknown> = {},
) {
  const row = {
    shop_id: shop.id,
    queue_day_id: shop.current_queue_day_id,
    number: 1,
    customer_name: "Ali",
    device_id: crypto.randomUUID(),
    status: "waiting",
    origin: "scan",
    ...overrides,
  };
  const columns = Object.keys(row);
  const values = Object.values(row);
  return db.query(
    `insert into public.tickets (${columns.join(", ")})
     values (${columns.map((_, i) => `$${i + 1}`).join(", ")})
     returning id`,
    values,
  );
}

describe("tickets constraints", () => {
  test("a Ticket number is unique within its Queue Day", async () => {
    const { shop } = await createShop();
    await insertTicket(shop, { number: 7 });

    await expect(insertTicket(shop, { number: 7 })).rejects.toThrow(
      /tickets_queue_day_number/,
    );
  });

  test("the same number is free again in another Queue Day", async () => {
    const a = await createShop();
    const b = await createShop();
    await insertTicket(a.shop, { number: 7 });

    await expect(insertTicket(b.shop, { number: 7 })).resolves.toBeDefined();
  });

  test("a device may hold only one active Ticket per Shop", async () => {
    const { shop } = await createShop();
    const deviceId = crypto.randomUUID();
    await insertTicket(shop, { number: 1, device_id: deviceId });

    await expect(
      insertTicket(shop, { number: 2, device_id: deviceId, status: "called" }),
    ).rejects.toThrow(/tickets_one_active_per_device/);
  });

  test("a device may join again once its Ticket is finished", async () => {
    const { shop } = await createShop();
    const deviceId = crypto.randomUUID();
    await insertTicket(shop, { number: 1, device_id: deviceId, status: "left" });

    await expect(
      insertTicket(shop, { number: 2, device_id: deviceId }),
    ).resolves.toBeDefined();
  });

  test("two devices with no id at all do not collide", async () => {
    // Personal data is erased 30 days after a Ticket finishes, leaving many rows
    // with a null device_id.
    const { shop } = await createShop();
    await insertTicket(shop, { number: 1, device_id: null, status: "served" });

    await expect(
      insertTicket(shop, { number: 2, device_id: null, status: "served" }),
    ).resolves.toBeDefined();
  });

  test.each([
    ["blank", ""],
    ["31 characters", "a".repeat(31)],
  ])("rejects a name that is %s", async (_label, name) => {
    const { shop } = await createShop();

    await expect(insertTicket(shop, { customer_name: name })).rejects.toThrow(
      /tickets_customer_name_length/,
    );
  });

  test("allows a name to be erased", async () => {
    const { shop } = await createShop();

    await expect(
      insertTicket(shop, { customer_name: null, device_id: null, status: "served" }),
    ).resolves.toBeDefined();
  });

  test("rejects a Ticket number below 1", async () => {
    const { shop } = await createShop();

    await expect(insertTicket(shop, { number: 0 })).rejects.toThrow(
      /tickets_number_positive/,
    );
  });
});

describe("haversine_m", () => {
  async function distance(latA: number, lngA: number, latB: number, lngB: number) {
    const { rows } = await db.query(
      "select public.haversine_m($1, $2, $3, $4) as m",
      [latA, lngA, latB, lngB],
    );
    return rows[0].m as number;
  }

  test("is zero for the same point", async () => {
    expect(await distance(SHOP_LAT, SHOP_LNG, SHOP_LAT, SHOP_LNG)).toBe(0);
  });

  test("measures a degree of latitude as ~111.2 km", async () => {
    expect(await distance(0, 0, 1, 0)).toBeCloseTo(111194.93, 1);
  });

  test("measures Kuala Lumpur to Singapore to within a kilometre", async () => {
    // The great-circle distance, which is shorter than the ~350 km drive.
    expect(await distance(SHOP_LAT, SHOP_LNG, 1.3521, 103.8198)).toBeCloseTo(309_000, -3);
  });

  test("is symmetric", async () => {
    const there = await distance(SHOP_LAT, SHOP_LNG, 1.3521, 103.8198);
    const back = await distance(1.3521, 103.8198, SHOP_LAT, SHOP_LNG);
    expect(there).toBeCloseTo(back, 6);
  });
});
