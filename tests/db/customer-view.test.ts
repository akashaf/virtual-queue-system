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

interface CustomerView {
  shop: {
    id: string;
    name: string;
    is_active: boolean;
    joining_state: string;
    waiting_count: number;
    heads_up_threshold: number;
  };
  ticket: {
    id: string;
    number: number;
    status: string;
    position: number;
    can_rejoin: boolean;
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
        // The page decides "Head back to the shop now" from it (frontend.md §3.1).
        heads_up_threshold: 3,
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
        heads_up_threshold: 3,
      },
      ticket: {
        id: mine.ticket.id,
        number: 2,
        status: "waiting",
        position: 1,
        last_call_choice: null,
        carried_over: false,
        removed_reason: null,
        can_rejoin: false,
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

  test("keeps showing a Ticket that has ended, so the Customer is told what became of it", async () => {
    // #7 replaced #5's active-only rule: No-show, Removed and Served are three
    // different screens, and a page that only sees a Ticket vanish cannot tell
    // them apart. The page taps past the state; the server does not forget it.
    const { shop } = await createShop();
    const mine = await join(shop.slug);
    await db.query(
      "update public.tickets set status = 'served', served_at = now(), finished_at = now() where id = $1",
      [mine.ticket.id],
    );

    expect((await view(shop.slug, mine.deviceId))?.ticket).toMatchObject({
      id: mine.ticket.id,
      status: "served",
      can_rejoin: false,
    });
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

describe("get_customer_view after a Ticket has ended", () => {
  /** Calls the front of the Queue and gives up on them, as the Owner's two buttons do. */
  async function noShow(shop: { slug: string }, email: string, password: string) {
    const client = await signInAs(email, password);
    const called = await client.rpc("call_next");
    const { id } = (called.data as unknown as { result: { id: string } }).result;
    await db.query(
      "update public.tickets set called_at = now() - interval '6 minutes' where id = $1",
      [id],
    );
    const { error } = await client.rpc("mark_no_show", { p_ticket_id: id });
    if (error) throw new Error(error.message);
    return id;
  }

  test("still shows the Customer the Ticket they were told to leave on", async () => {
    const { shop } = await createShop();
    const mine = await join(shop.slug);
    await serviceClient().rpc("leave_queue", {
      p_ticket_id: mine.ticket.id,
      p_device_id: mine.deviceId,
    });

    const result = await view(shop.slug, mine.deviceId);

    expect(result?.ticket).toMatchObject({ id: mine.ticket.id, status: "left" });
  });

  test("offers a No-show Customer their way back in", async () => {
    const { owner, shop } = await createShop();
    const mine = await join(shop.slug);
    const id = await noShow(shop, owner.email, owner.password);

    const result = await view(shop.slug, mine.deviceId);

    expect(result?.ticket).toMatchObject({ id, status: "no_show", can_rejoin: true });
  });

  test("withdraws the offer once it has been taken", async () => {
    const { owner, shop } = await createShop();
    const mine = await join(shop.slug);
    const id = await noShow(shop, owner.email, owner.password);
    await serviceClient().rpc("rejoin_queue", {
      p_ticket_id: id,
      p_device_id: mine.deviceId,
    });

    const result = await view(shop.slug, mine.deviceId);

    // The newest Ticket is the one the device holds now.
    expect(result?.ticket).toMatchObject({ status: "waiting", can_rejoin: false });
  });

  test("never offers it on a Ticket that is still in the Queue", async () => {
    const { shop } = await createShop();
    const mine = await join(shop.slug);

    const result = await view(shop.slug, mine.deviceId);

    expect(result?.ticket?.can_rejoin).toBe(false);
  });

  test("starts the next Queue Day with a clean page", async () => {
    const { shop } = await createShop();
    const mine = await join(shop.slug);
    await serviceClient().rpc("leave_queue", {
      p_ticket_id: mine.ticket.id,
      p_device_id: mine.deviceId,
    });
    await db.query("update public.queue_days set closed_at = now() where shop_id = $1", [
      shop.id,
    ]);
    const { rows } = await db.query(
      "insert into public.queue_days (shop_id) values ($1) returning id",
      [shop.id],
    );
    await db.query("update public.shops set current_queue_day_id = $2 where id = $1", [
      shop.id,
      rows[0].id,
    ]);

    const result = await view(shop.slug, mine.deviceId);

    expect(result?.ticket).toBeNull();
  });
});
