import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  anonClient,
  connectDb,
  createShop,
  insertPushSubscription,
  joinQueue,
  resetTestData,
  serveOne,
  serviceClient,
  setCarriedOverAgo,
  setFinishedAgo,
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

interface ExpireEnvelope {
  result: { expired: number };
  alerts: { ticket_id: string; kind: string }[];
}

interface Erased {
  erased_tickets: number;
  deleted_subscriptions: number;
}

async function expireCarriedOver() {
  const { data, error } = await serviceClient().rpc("expire_carried_over");
  if (error) throw new Error(error.message);
  return data as unknown as ExpireEnvelope;
}

async function erasePersonalData() {
  const { data, error } = await serviceClient().rpc("erase_expired_personal_data");
  if (error) throw new Error(error.message);
  return data as unknown as Erased;
}

async function subscriptionCount(ticketId: string) {
  const { rows } = await db.query(
    "select count(*)::int as n from public.push_subscriptions where ticket_id = $1",
    [ticketId],
  );
  return rows[0].n as number;
}

interface TicketRow {
  status: string;
  removed_reason: string | null;
  finished_at: string | null;
  customer_name: string | null;
  device_id: string | null;
  served_at: string | null;
}

async function ticketRow(ticketId: string): Promise<TicketRow | undefined> {
  const { rows } = await db.query(
    `select status, removed_reason, finished_at, customer_name, device_id, served_at
     from public.tickets where id = $1`,
    [ticketId],
  );
  return rows[0] as TicketRow | undefined;
}

describe("expire_carried_over", () => {
  test("removes a Waiting Carried-over Ticket carried more than 3 days ago, and no other", async () => {
    const { shop } = await createShop({ p_heads_up_threshold: 10 });
    const expired = await joinQueue(shop.slug, "Ali");
    const fresh = await joinQueue(shop.slug, "Bala");
    const neverCarried = await joinQueue(shop.slug, "Chong");
    await setCarriedOverAgo(db, expired.id, "3 days 1 minute");
    await setCarriedOverAgo(db, fresh.id, "3 days -1 minute");
    await insertPushSubscription(db, expired.id);

    const { result } = await expireCarriedOver();

    expect(result.expired).toBe(1);
    expect(await ticketRow(expired.id)).toMatchObject({
      status: "removed",
      removed_reason: "carry_over_expired",
      finished_at: expect.anything(),
    });
    // An ending that can alert nobody again, so its subscriptions go (backend.md §3).
    expect(await subscriptionCount(expired.id)).toBe(0);
    expect((await ticketRow(fresh.id))?.status).toBe("waiting");
    expect((await ticketRow(neverCarried.id))?.status).toBe("waiting");
  });

  test("leaves a Called Carried-over Ticket in the chair, however old the carry", async () => {
    const { shop, owner } = await createShop();
    const ticket = await joinQueue(shop.slug);
    await setCarriedOverAgo(db, ticket.id, "4 days");
    const client = await signInAs(owner.email, owner.password);
    const { error } = await client.rpc("call_next");
    if (error) throw new Error(error.message);

    await expireCarriedOver();

    expect((await ticketRow(ticket.id))?.status).toBe("called");
  });

  test("returns the Heads-ups owed to the Tickets that moved up", async () => {
    const { shop } = await createShop({ p_heads_up_threshold: 1 });
    // The first two joined inside the threshold and were stamped then; the last two were not.
    const first = await joinQueue(shop.slug, "Ali");
    const second = await joinQueue(shop.slug, "Bala");
    const third = await joinQueue(shop.slug, "Chong");
    const fourth = await joinQueue(shop.slug, "Devi");
    await setCarriedOverAgo(db, first.id, "5 days");
    await setCarriedOverAgo(db, second.id, "5 days");

    const { alerts } = await expireCarriedOver();

    expect(alerts.filter((alert) => [third.id, fourth.id].includes(alert.ticket_id))).toEqual([
      { ticket_id: third.id, kind: "heads_up" },
      { ticket_id: fourth.id, kind: "heads_up" },
    ]);
  });

  test("sends no Heads-up for a Deactivated Shop, which nobody can be served at", async () => {
    const { shop } = await createShop({ p_heads_up_threshold: 1 });
    const carried = await joinQueue(shop.slug, "Ali");
    await joinQueue(shop.slug, "Bala");
    const behind = await joinQueue(shop.slug, "Chong");
    await setCarriedOverAgo(db, carried.id, "5 days");
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);

    const { alerts } = await expireCarriedOver();

    expect((await ticketRow(carried.id))?.status).toBe("removed");
    expect(alerts.map((alert) => alert.ticket_id)).not.toContain(behind.id);
  });

  test("is safe to run twice: the second run expires and alerts nobody", async () => {
    const { shop } = await createShop({ p_heads_up_threshold: 1 });
    const carried = await joinQueue(shop.slug, "Ali");
    await joinQueue(shop.slug, "Bala");
    await joinQueue(shop.slug, "Chong");
    await setCarriedOverAgo(db, carried.id, "5 days");
    await expireCarriedOver();

    const again = await expireCarriedOver();

    expect(again).toEqual({ result: { expired: 0 }, alerts: [] });
  });

  test("is not callable by a browser or an Owner", async () => {
    const { owner } = await createShop();
    const asOwner = await signInAs(owner.email, owner.password);

    const anon = await anonClient().rpc("expire_carried_over");
    const owned = await asOwner.rpc("expire_carried_over");

    expect(anon.error?.code).toBe("42501");
    expect(owned.error?.code).toBe("42501");
  });
});

describe("erase_expired_personal_data", () => {
  test("erases the name and device of Tickets finished more than 30 days ago, and deletes their subscriptions", async () => {
    const { shop, owner } = await createShop();
    const client = await signInAs(owner.email, owner.password);
    const old = await serveOne(client, shop.slug, "Ali");
    const recent = await serveOne(client, shop.slug, "Bala");
    const waiting = await joinQueue(shop.slug, "Chong");
    await setFinishedAgo(db, old.id, "30 days 1 minute");
    await setFinishedAgo(db, recent.id, "30 days -1 minute");
    await insertPushSubscription(db, old.id);
    await insertPushSubscription(db, recent.id);
    await insertPushSubscription(db, waiting.id);

    const erased = await erasePersonalData();

    expect(erased).toEqual({ erased_tickets: 1, deleted_subscriptions: 1 });
    expect(await ticketRow(old.id)).toMatchObject({ customer_name: null, device_id: null });
    expect(await subscriptionCount(old.id)).toBe(0);
    expect(await ticketRow(recent.id)).toMatchObject({
      customer_name: "Bala",
      device_id: expect.any(String),
    });
    expect(await subscriptionCount(recent.id)).toBe(1);
    expect(await ticketRow(waiting.id)).toMatchObject({
      customer_name: "Chong",
      device_id: expect.any(String),
    });
    expect(await subscriptionCount(waiting.id)).toBe(1);
  });

  test("never deletes a Served Ticket: it is what the Shop is billed for", async () => {
    const { shop, owner } = await createShop();
    const client = await signInAs(owner.email, owner.password);
    const served = await serveOne(client, shop.slug);
    await setFinishedAgo(db, served.id, "90 days");

    await erasePersonalData();

    expect(await ticketRow(served.id)).toMatchObject({
      status: "served",
      served_at: expect.anything(),
      customer_name: null,
    });
  });

  test("is safe to run twice: the second run erases nothing", async () => {
    const { shop, owner } = await createShop();
    const client = await signInAs(owner.email, owner.password);
    const ticket = await serveOne(client, shop.slug);
    await setFinishedAgo(db, ticket.id, "31 days");
    await insertPushSubscription(db, ticket.id);
    await erasePersonalData();

    const again = await erasePersonalData();

    expect(again).toEqual({ erased_tickets: 0, deleted_subscriptions: 0 });
    expect(await ticketRow(ticket.id)).toMatchObject({
      status: "served",
      customer_name: null,
      device_id: null,
    });
  });

  test("is not callable by a browser or an Owner", async () => {
    const { owner } = await createShop();
    const asOwner = await signInAs(owner.email, owner.password);

    const anon = await anonClient().rpc("erase_expired_personal_data");
    const owned = await asOwner.rpc("erase_expired_personal_data");

    expect(anon.error?.code).toBe("42501");
    expect(owned.error?.code).toBe("42501");
  });
});
