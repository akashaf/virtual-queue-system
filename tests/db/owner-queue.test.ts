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
} from "./helpers";

let db: Client;

beforeAll(async () => {
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

interface OwnerQueue {
  shop: { id: string; name: string; joining_state: string };
  waiting: { id: string; number: number; name: string; joined_at: string }[];
  called: { id: string; number: number; name: string; called_at: string }[];
  just_served: {
    id: string;
    number: number;
    name: string;
    undo_expires_in_ms: number;
  }[];
}

async function join(slug: string, name: string) {
  const { data, error } = await serviceClient().rpc("join_queue", {
    p_slug: slug,
    p_device_id: crypto.randomUUID(),
    p_name: name,
    p_lat: metresNorthOf(0),
    p_lng: SHOP_LNG,
    p_accuracy_m: 0,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as { result: { ticket: { id: string } } }).result.ticket;
}

/** Signs the Owner in and reads their Queue with their own JWT, as the dashboard does. */
async function ownerQueue(email: string, password: string) {
  const client = await signInAs(email, password);
  const { data, error } = await client.rpc("get_owner_queue");
  if (error) throw new Error(error.message);
  return data as unknown as OwnerQueue;
}

describe("get_owner_queue", () => {
  test("returns an empty Queue for a Shop nobody has joined", async () => {
    const { owner, shop } = await createShop();

    expect(await ownerQueue(owner.email, owner.password)).toEqual({
      shop: { id: shop.id, name: shop.name, joining_state: "open" },
      waiting: [],
      called: [],
      just_served: [],
    });
  });

  test("lists Waiting Tickets in queue order with their names and join times", async () => {
    const { owner, shop } = await createShop();
    const first = await join(shop.slug, "Ali");
    const second = await join(shop.slug, "Siti");

    const queue = await ownerQueue(owner.email, owner.password);

    expect(queue.waiting).toEqual([
      { id: first.id, number: 1, name: "Ali", joined_at: expect.any(String) },
      { id: second.id, number: 2, name: "Siti", joined_at: expect.any(String) },
    ]);
    expect(queue.called).toEqual([]);
  });

  test("moves a Called Ticket out of Waiting and into the chair list", async () => {
    const { owner, shop } = await createShop();
    const first = await join(shop.slug, "Ali");
    await join(shop.slug, "Siti");
    await db.query(
      "update public.tickets set status = 'called', called_at = now() where id = $1",
      [first.id],
    );

    const queue = await ownerQueue(owner.email, owner.password);

    expect(queue.waiting.map((ticket) => ticket.number)).toEqual([2]);
    expect(queue.called).toEqual([
      { id: first.id, number: 1, name: "Ali", called_at: expect.any(String) },
    ]);
  });

  test("leaves out Tickets that have reached a final status", async () => {
    const { owner, shop } = await createShop();
    const gone = await join(shop.slug, "Ali");
    await join(shop.slug, "Siti");
    await db.query(
      "update public.tickets set status = 'left', finished_at = now() where id = $1",
      [gone.id],
    );

    const queue = await ownerQueue(owner.email, owner.password);

    expect(queue.waiting.map((ticket) => ticket.name)).toEqual(["Siti"]);
  });

  test("shows only the current Queue Day", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug, "Yesterday");
    // Close the day the way close_shop will in #11, and open the next one.
    const { rows } = await db.query(
      `update public.queue_days set closed_at = now() where shop_id = $1 returning id`,
      [shop.id],
    );
    const { rows: next } = await db.query(
      "insert into public.queue_days (shop_id) values ($1) returning id",
      [shop.id],
    );
    await db.query("update public.shops set current_queue_day_id = $2 where id = $1", [
      shop.id,
      next[0].id,
    ]);
    expect(rows).toHaveLength(1);

    const queue = await ownerQueue(owner.email, owner.password);

    expect(queue.waiting).toEqual([]);
  });

  test("shows an Owner their own Shop, never another Owner's", async () => {
    const theirs = await createShop();
    await join(theirs.shop.slug, "Ali");
    const mine = await createShop();

    const queue = await ownerQueue(mine.owner.email, mine.owner.password);

    expect(queue.shop.id).toBe(mine.shop.id);
    expect(queue.waiting).toEqual([]);
  });

  test("refuses the Owner of a Deactivated Shop", async () => {
    const { owner, shop } = await createShop();
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);
    const client = await signInAs(owner.email, owner.password);

    const { error } = await client.rpc("get_owner_queue");

    expect(error?.message).toBe("shop_inactive");
  });

  test("refuses a signed-out caller", async () => {
    await createShop();

    const { error } = await anonClient().rpc("get_owner_queue");

    expect(error).not.toBeNull();
  });
});

describe("get_owner_queue just served", () => {
  /** Calls and then serves the front of the Queue, as the two buttons do. */
  async function serveNext(email: string, password: string) {
    const client = await signInAs(email, password);
    const called = await client.rpc("call_next");
    if (called.error) throw new Error(called.error.message);
    const { id } = (called.data as unknown as { result: { id: string } }).result;
    const served = await client.rpc("mark_served", { p_ticket_id: id });
    if (served.error) throw new Error(served.error.message);
    return id;
  }

  test("keeps a Served Ticket listed while its Undo window is open", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug, "Ali");
    const id = await serveNext(owner.email, owner.password);

    const queue = await ownerQueue(owner.email, owner.password);

    expect(queue.just_served).toEqual([
      { id, number: 1, name: "Ali", undo_expires_in_ms: expect.any(Number) },
    ]);
    // It is neither waiting nor in a chair any more; only undoable.
    expect(queue.waiting).toEqual([]);
    expect(queue.called).toEqual([]);
  });

  test("counts the Undo window down rather than restarting it on each read", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug, "Ali");
    const id = await serveNext(owner.email, owner.password);
    await db.query(
      "update public.tickets set served_at = now() - interval '90 seconds' where id = $1",
      [id],
    );

    const queue = await ownerQueue(owner.email, owner.password);

    // 2 minutes less the 90 seconds already gone, give or take the round trip.
    expect(queue.just_served[0].undo_expires_in_ms).toBeGreaterThan(28_000);
    expect(queue.just_served[0].undo_expires_in_ms).toBeLessThanOrEqual(30_000);
  });

  test("drops a Ticket once its Undo window has passed", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug, "Ali");
    const id = await serveNext(owner.email, owner.password);
    await db.query(
      "update public.tickets set served_at = now() - interval '121 seconds' where id = $1",
      [id],
    );

    const queue = await ownerQueue(owner.email, owner.password);

    expect(queue.just_served).toEqual([]);
  });

  test("lists the most recent Done first", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug, "Ali");
    await join(shop.slug, "Siti");
    await serveNext(owner.email, owner.password);
    await serveNext(owner.email, owner.password);

    const queue = await ownerQueue(owner.email, owner.password);

    expect(queue.just_served.map((ticket) => ticket.name)).toEqual(["Siti", "Ali"]);
  });

  test("shows an Owner their own Shop's Done, never another Owner's", async () => {
    const theirs = await createShop();
    await join(theirs.shop.slug, "Ali");
    await serveNext(theirs.owner.email, theirs.owner.password);
    const mine = await createShop();

    const queue = await ownerQueue(mine.owner.email, mine.owner.password);

    expect(queue.just_served).toEqual([]);
  });
});

describe("tickets row level security", () => {
  test("an Owner reads their own Shop's Tickets", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug, "Ali");
    const client = await signInAs(owner.email, owner.password);

    const { data } = await client.from("tickets").select("id, customer_name");

    expect(data).toEqual([{ id: ticket.id, customer_name: "Ali" }]);
  });

  test("an Owner cannot read another Owner's Tickets", async () => {
    const theirs = await createShop();
    await join(theirs.shop.slug, "Ali");
    const mine = await createShop();
    const client = await signInAs(mine.owner.email, mine.owner.password);

    const { data } = await client
      .from("tickets")
      .select("id")
      .eq("shop_id", theirs.shop.id);

    expect(data).toEqual([]);
  });

  test("an Owner cannot write a Ticket directly", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug, "Ali");
    const client = await signInAs(owner.email, owner.password);

    const { error } = await client
      .from("tickets")
      .update({ status: "served" })
      .eq("id", ticket.id);

    expect(error).not.toBeNull();
  });

  test("the anon role has no access to tickets", async () => {
    const { shop } = await createShop();
    await join(shop.slug, "Ali");

    const { error } = await anonClient().from("tickets").select("id");

    expect(error).not.toBeNull();
  });
});
