import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
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

interface CalledTicket {
  id: string;
  number: number;
  name: string | null;
  called_at: string;
  no_show_in_ms: number;
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

/** A Shop whose one Customer has just been marked Served — where Undo starts. */
async function shopWithServedTicket() {
  const { owner, shop } = await createShop();
  const ticket = await join(shop.slug);
  const client = await signInAs(owner.email, owner.password);
  const called = await client.rpc("call_next");
  if (called.error) throw new Error(called.error.message);
  const served = await client.rpc("mark_served", { p_ticket_id: ticket.id });
  if (served.error) throw new Error(served.error.message);
  return { owner, shop, ticket, client };
}

/** Moves a Ticket's Done back in time, to stand in for the window running out. */
function servedSecondsAgo(ticketId: string, seconds: number) {
  return db.query(
    `update public.tickets
     set served_at = now() - make_interval(secs => $2), finished_at = now() - make_interval(secs => $2)
     where id = $1`,
    [ticketId, seconds],
  );
}

async function undoServed(
  client: Awaited<ReturnType<typeof signInAs>>,
  ticketId: string,
) {
  const { data, error } = await client.rpc("undo_served", { p_ticket_id: ticketId });
  return {
    error: error?.message,
    ticket: (data as unknown as { result: CalledTicket } | null)?.result,
  };
}

describe("undo_served", () => {
  test("puts the Customer back in the chair within the window", async () => {
    const { ticket, client } = await shopWithServedTicket();

    const undone = await undoServed(client, ticket.id);

    expect(undone.ticket).toEqual({
      id: ticket.id,
      number: 1,
      name: "Ali",
      called_at: expect.any(String),
      no_show_in_ms: expect.any(Number),
    });
    const { rows } = await db.query(
      "select status, served_at, finished_at from public.tickets where id = $1",
      [ticket.id],
    );
    expect(rows[0]).toEqual({ status: "called", served_at: null, finished_at: null });
  });

  test("still works a second before the window closes", async () => {
    const { ticket, client } = await shopWithServedTicket();
    await servedSecondsAgo(ticket.id, 119);

    const { error } = await undoServed(client, ticket.id);

    expect(error).toBeUndefined();
  });

  test("refuses once the two minutes are up", async () => {
    const { ticket, client } = await shopWithServedTicket();
    await servedSecondsAgo(ticket.id, 121);

    const { error } = await undoServed(client, ticket.id);

    expect(error).toBe("undo_expired");
    const { rows } = await db.query("select status from public.tickets where id = $1", [
      ticket.id,
    ]);
    expect(rows[0].status).toBe("served");
  });

  test("keeps the time the Customer was originally called", async () => {
    const { ticket, client } = await shopWithServedTicket();
    const { rows: before } = await db.query(
      "select called_at from public.tickets where id = $1",
      [ticket.id],
    );

    await undoServed(client, ticket.id);

    const { rows: after } = await db.query(
      "select called_at from public.tickets where id = $1",
      [ticket.id],
    );
    expect(after[0].called_at).toEqual(before[0].called_at);
  });

  test("refuses when the Customer has already taken a new place in the Queue", async () => {
    const { shop, ticket, client } = await shopWithServedTicket();
    // Done freed the device: the one-active-Ticket-per-device rule no longer
    // holds it, so the Customer can join again — and often does, for a friend.
    await join(shop.slug, ticket.deviceId, "Ali");

    const { error } = await undoServed(client, ticket.id);

    expect(error).toBe("rejoined");
    const { rows } = await db.query("select status from public.tickets where id = $1", [
      ticket.id,
    ]);
    expect(rows[0].status).toBe("served");
  });

  test("refuses a Ticket that was never Served", async () => {
    const { owner, shop } = await createShop();
    const waiting = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);

    const { error } = await undoServed(client, waiting.id);

    expect(error).toBe("ticket_not_found");
  });

  test("an Owner cannot undo another Shop's Ticket", async () => {
    const theirs = await shopWithServedTicket();
    const mine = await createShop();
    const client = await signInAs(mine.owner.email, mine.owner.password);

    const { error } = await undoServed(client, theirs.ticket.id);

    expect(error).toBe("ticket_not_found");
    const { rows } = await db.query("select status from public.tickets where id = $1", [
      theirs.ticket.id,
    ]);
    expect(rows[0].status).toBe("served");
  });
});
