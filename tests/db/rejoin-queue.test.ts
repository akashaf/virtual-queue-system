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
  shop: { waiting_count: number };
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

/** A Customer who was called and never came: the only Ticket a Rejoin may come from. */
async function shopWithNoShow() {
  const { owner, shop } = await createShop();
  const ticket = await join(shop.slug);
  const client = await signInAs(owner.email, owner.password);
  await client.rpc("call_next");
  await db.query(
    "update public.tickets set called_at = now() - interval '6 minutes' where id = $1",
    [ticket.id],
  );
  const { error } = await client.rpc("mark_no_show", { p_ticket_id: ticket.id });
  if (error) throw new Error(error.message);
  return { owner, shop, ticket, client };
}

async function rejoin(ticketId: string, deviceId: string) {
  const { data, error } = await serviceClient().rpc("rejoin_queue", {
    p_ticket_id: ticketId,
    p_device_id: deviceId,
  });
  return {
    error: error?.message,
    view: (data as unknown as { result: CustomerView } | null)?.result,
  };
}

describe("rejoin_queue", () => {
  test("puts the Customer back at the end of the Queue, with no location check", async () => {
    const { shop, ticket } = await shopWithNoShow();
    await join(shop.slug, crypto.randomUUID(), "Siti");

    // No coordinates are passed at all: ADR 0002's deliberate exemption.
    const { error, view } = await rejoin(ticket.id, ticket.deviceId);

    expect(error).toBeUndefined();
    expect(view?.ticket).toMatchObject({ number: 3, status: "waiting", position: 1 });
    const { rows } = await db.query(
      "select origin, parent_ticket_id, customer_name from public.tickets where id = $1",
      [view!.ticket!.id],
    );
    expect(rows[0]).toEqual({
      origin: "rejoin",
      parent_ticket_id: ticket.id,
      customer_name: "Ali",
    });
  });

  test("only lets a Customer rejoin once", async () => {
    const { ticket } = await shopWithNoShow();
    await rejoin(ticket.id, ticket.deviceId);
    // Leave again, so the one-active-Ticket rule is not what refuses the second try.
    await serviceClient().rpc("leave_queue", {
      p_ticket_id: (await activeTicketId(ticket.deviceId))!,
      p_device_id: ticket.deviceId,
    });

    const { error } = await rejoin(ticket.id, ticket.deviceId);

    expect(error).toBe("not_rejoinable");
  });

  test("refuses a Rejoin of a Rejoin, so one scan is one way in", async () => {
    const { owner, ticket } = await shopWithNoShow();
    const { view } = await rejoin(ticket.id, ticket.deviceId);
    const second = view!.ticket!.id;
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("call_next");
    await db.query(
      "update public.tickets set called_at = now() - interval '6 minutes' where id = $1",
      [second],
    );
    await client.rpc("mark_no_show", { p_ticket_id: second });

    const { error } = await rejoin(second, ticket.deviceId);

    expect(error).toBe("not_rejoinable");
  });

  test("refuses a Ticket that is not a No-show", async () => {
    const { shop } = await createShop();
    const waiting = await join(shop.slug);

    const { error } = await rejoin(waiting.id, waiting.deviceId);

    expect(error).toBe("not_rejoinable");
  });

  test("refuses a No-show from a Queue Day that has closed", async () => {
    // §12 rule 6: otherwise an old No-show is a way in from anywhere, for ever.
    const { shop, ticket } = await shopWithNoShow();
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

    const { error } = await rejoin(ticket.id, ticket.deviceId);

    expect(error).toBe("not_rejoinable");
  });

  test("refuses a Ticket the device does not hold", async () => {
    const { ticket } = await shopWithNoShow();

    const { error } = await rejoin(ticket.id, crypto.randomUUID());

    expect(error).toBe("not_rejoinable");
  });

  test("refuses once the Shop has stopped taking new Customers", async () => {
    const { shop, ticket } = await shopWithNoShow();
    await db.query("update public.shops set joining_state = 'last_call' where id = $1", [
      shop.id,
    ]);

    const { error } = await rejoin(ticket.id, ticket.deviceId);

    expect(error).toBe("last_call");
  });

  test("refuses when the Queue is full", async () => {
    const { shop, ticket } = await shopWithNoShow();
    await db.query("update public.shops set max_queue_size = 1 where id = $1", [shop.id]);
    await join(shop.slug, crypto.randomUUID(), "Siti");

    const { error } = await rejoin(ticket.id, ticket.deviceId);

    expect(error).toBe("queue_full");
  });

  test("refuses a device that has already taken a new place", async () => {
    const { shop, ticket } = await shopWithNoShow();
    await join(shop.slug, ticket.deviceId, "Ali");

    const { error } = await rejoin(ticket.id, ticket.deviceId);

    expect(error).toBe("already_in_queue");
  });

  test("refuses a Deactivated Shop", async () => {
    const { shop, ticket } = await shopWithNoShow();
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);

    const { error } = await rejoin(ticket.id, ticket.deviceId);

    expect(error).toBe("shop_inactive");
  });

  test("is not reachable by a browser", async () => {
    const { ticket } = await shopWithNoShow();

    const { error } = await anonClient().rpc("rejoin_queue", {
      p_ticket_id: ticket.id,
      p_device_id: ticket.deviceId,
    });

    expect(error).not.toBeNull();
  });
});

async function activeTicketId(deviceId: string) {
  const { rows } = await db.query(
    "select id from public.tickets where device_id = $1 and status in ('waiting','called')",
    [deviceId],
  );
  return rows[0]?.id as string | undefined;
}
