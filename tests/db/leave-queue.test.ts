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

interface CustomerView {
  shop: { id: string; name: string; waiting_count: number };
  ticket: { id: string; number: number; status: string; position: number } | null;
}

async function join(slug: string, deviceId = crypto.randomUUID(), name = "Ali") {
  const { data, error } = await serviceClient().rpc("join_queue", {
    p_slug: slug,
    p_device_id: deviceId,
    p_name: name,
    p_lat: metresNorthOf(0),
    p_lng: SHOP_LNG,
    p_accuracy_m: 0,
  });
  if (error) throw new Error(error.message);
  const { ticket } = (data as unknown as { result: { ticket: { id: string } } }).result;
  return { ...ticket, deviceId };
}

async function leaveQueue(ticketId: string, deviceId: string) {
  const { data, error } = await serviceClient().rpc("leave_queue", {
    p_ticket_id: ticketId,
    p_device_id: deviceId,
  });
  return {
    error: error?.message,
    view: (data as unknown as { result: CustomerView } | null)?.result,
  };
}

async function statusOf(ticketId: string) {
  const { rows } = await db.query(
    "select status, finished_at from public.tickets where id = $1",
    [ticketId],
  );
  return rows[0];
}

describe("leave_queue", () => {
  test("lets a Waiting Customer give up their place", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);

    const { error, view } = await leaveQueue(ticket.id, ticket.deviceId);

    expect(error).toBeUndefined();
    expect(view?.ticket).toMatchObject({ id: ticket.id, status: "left" });
    const row = await statusOf(ticket.id);
    expect(row.status).toBe("left");
    expect(row.finished_at).not.toBeNull();
  });

  test("lets a Customer in the chair leave too, freeing it at once", async () => {
    // §12 rule 5: otherwise the Owner waits five minutes for No-show to unlock.
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("call_next");

    const { error } = await leaveQueue(ticket.id, ticket.deviceId);

    expect(error).toBeUndefined();
    expect((await statusOf(ticket.id)).status).toBe("left");
  });

  test("closes the Queue up behind them", async () => {
    const { shop } = await createShop();
    const first = await join(shop.slug);
    const second = await join(shop.slug, crypto.randomUUID(), "Siti");

    await leaveQueue(first.id, first.deviceId);

    const { data } = await serviceClient().rpc("get_customer_view", {
      p_slug: shop.slug,
      p_device_id: second.deviceId,
    });
    const view = data as unknown as CustomerView;
    expect(view.ticket?.position).toBe(0);
    expect(view.shop.waiting_count).toBe(1);
  });

  test("refuses a Ticket the device does not hold", async () => {
    const { shop } = await createShop();
    const mine = await join(shop.slug);
    const theirs = await join(shop.slug, crypto.randomUUID(), "Siti");

    const { error } = await leaveQueue(theirs.id, mine.deviceId);

    expect(error).toBe("ticket_not_found");
    expect((await statusOf(theirs.id)).status).toBe("waiting");
  });

  test("refuses a Ticket that has already ended", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);
    await leaveQueue(ticket.id, ticket.deviceId);

    const { error } = await leaveQueue(ticket.id, ticket.deviceId);

    expect(error).toBe("ticket_not_found");
  });

  test("frees the device, so the Customer can change their mind", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);
    await leaveQueue(ticket.id, ticket.deviceId);

    await expect(join(shop.slug, ticket.deviceId)).resolves.toBeDefined();
  });

  test("is not reachable by a browser", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);

    const { error } = await anonClient().rpc("leave_queue", {
      p_ticket_id: ticket.id,
      p_device_id: ticket.deviceId,
    });

    expect(error).not.toBeNull();
  });
});
