import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  anonClient,
  connectDb,
  createShop,
  metresNorthOf,
  resetTestData,
  serviceClient,
  SHOP_LNG,
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

interface CustomerView {
  shop: {
    id: string;
    name: string;
    is_active: boolean;
    joining_state: string;
    waiting_count: number;
  };
  ticket: {
    id: string;
    number: number;
    status: string;
    position: number;
  } | null;
}

async function join(slug: string, deviceId = crypto.randomUUID()) {
  const { data, error } = await serviceClient().rpc("join_queue", {
    p_slug: slug,
    p_device_id: deviceId,
    p_name: "Ali",
    p_lat: metresNorthOf(0),
    p_lng: SHOP_LNG,
    p_accuracy_m: 0,
  });
  if (error) throw new Error(error.message);
  const envelope = data as unknown as { result: CustomerView };
  return { deviceId, ticket: envelope.result.ticket! };
}

async function view(slug: string, deviceId?: string) {
  const { data, error } = await serviceClient().rpc("get_customer_view", {
    p_slug: slug,
    ...(deviceId === undefined ? {} : { p_device_id: deviceId }),
  });
  if (error) throw new Error(error.message);
  return data as unknown as CustomerView | null;
}

describe("get_customer_view", () => {
  test("returns null for a slug no Shop has", async () => {
    expect(await view(uniqueSlug("nobody"))).toBeNull();
  });

  test("describes an empty Queue to a device with no Ticket", async () => {
    const { shop } = await createShop();

    expect(await view(shop.slug, crypto.randomUUID())).toEqual({
      shop: {
        // The topic the page subscribes to for queue_changed pings; not a secret,
        // and the page cannot listen for its own Shop without it.
        id: shop.id,
        name: shop.name,
        is_active: true,
        joining_state: "open",
        waiting_count: 0,
      },
      ticket: null,
    });
  });

  test("works without a device at all, as it must before the first join", async () => {
    const { shop } = await createShop();
    await join(shop.slug);

    const result = await view(shop.slug);

    expect(result?.shop.waiting_count).toBe(1);
    expect(result?.ticket).toBeNull();
  });

  test("still describes a Deactivated Shop, so the page can say so", async () => {
    const { shop } = await createShop();
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);

    expect((await view(shop.slug))?.shop.is_active).toBe(false);
  });

  test("reports the joining state", async () => {
    const { shop } = await createShop();
    await db.query("update public.shops set joining_state = 'last_call' where id = $1", [
      shop.id,
    ]);

    expect((await view(shop.slug))?.shop.joining_state).toBe("last_call");
  });

  test("gives a device its own Ticket, its number and its position", async () => {
    const { shop } = await createShop();
    await join(shop.slug);
    const mine = await join(shop.slug);

    expect(await view(shop.slug, mine.deviceId)).toEqual({
      shop: {
        id: shop.id,
        name: shop.name,
        is_active: true,
        joining_state: "open",
        waiting_count: 2,
      },
      ticket: {
        id: mine.ticket.id,
        number: 2,
        status: "waiting",
        position: 1,
      },
    });
  });

  test("counts only Waiting Tickets with a lower number as ahead", async () => {
    const { shop } = await createShop();
    const first = await join(shop.slug);
    const second = await join(shop.slug);
    const mine = await join(shop.slug);

    // The one in a chair is not ahead of anyone; the one who left is gone.
    await db.query(
      "update public.tickets set status = 'called', called_at = now() where id = $1",
      [first.ticket.id],
    );
    await db.query(
      "update public.tickets set status = 'left', finished_at = now() where id = $1",
      [second.ticket.id],
    );

    const result = await view(shop.slug, mine.deviceId);

    expect(result?.ticket).toMatchObject({ number: 3, position: 0 });
    expect(result?.shop.waiting_count).toBe(1);
  });

  test("keeps showing a Ticket that has been Called", async () => {
    const { shop } = await createShop();
    const mine = await join(shop.slug);
    await db.query(
      "update public.tickets set status = 'called', called_at = now() where id = $1",
      [mine.ticket.id],
    );

    const result = await view(shop.slug, mine.deviceId);

    expect(result?.ticket).toMatchObject({ status: "called", position: 0 });
    expect(result?.shop.waiting_count).toBe(0);
  });

  test("forgets a Ticket once it reaches a final status", async () => {
    const { shop } = await createShop();
    const mine = await join(shop.slug);
    await db.query(
      "update public.tickets set status = 'served', served_at = now(), finished_at = now() where id = $1",
      [mine.ticket.id],
    );

    expect((await view(shop.slug, mine.deviceId))?.ticket).toBeNull();
  });

  test("never shows one Customer another Customer's Ticket or name", async () => {
    const { shop } = await createShop();
    const theirs = await join(shop.slug);
    const mine = await join(shop.slug);

    const result = await view(shop.slug, mine.deviceId);

    expect(JSON.stringify(result)).not.toContain(theirs.ticket.id);
    expect(JSON.stringify(result)).not.toContain("Ali");
  });

  test("does not leak a Ticket held on the same device at another Shop", async () => {
    const a = await createShop();
    const b = await createShop();
    const deviceId = crypto.randomUUID();
    await join(a.shop.slug, deviceId);

    expect((await view(b.shop.slug, deviceId))?.ticket).toBeNull();
  });
});

describe("customer function grants", () => {
  test("the anon role cannot read a Customer view", async () => {
    const { shop } = await createShop();

    const { error } = await anonClient().rpc("get_customer_view", {
      p_slug: shop.slug,
    });

    expect(error).not.toBeNull();
  });

  test("the anon role cannot join a Queue", async () => {
    const { shop } = await createShop();

    const { error } = await anonClient().rpc("join_queue", {
      p_slug: shop.slug,
      p_device_id: crypto.randomUUID(),
      p_name: "Ali",
      p_lat: metresNorthOf(0),
      p_lng: SHOP_LNG,
      p_accuracy_m: 0,
    });

    expect(error).not.toBeNull();
  });
});
