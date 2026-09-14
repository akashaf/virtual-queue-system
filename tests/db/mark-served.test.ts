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

/** What `mark_served` puts in the `{ result, alerts }` envelope. */
interface ServedTicket {
  id: string;
  number: number;
  name: string | null;
  called_at: string;
  no_show_in_ms: number;
  undo_expires_in_ms: number;
}

async function join(slug: string, name = "Ali") {
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

/** A Shop with one Customer already in a chair, which is where Done starts. */
async function shopWithCalledTicket() {
  const { owner, shop } = await createShop();
  const ticket = await join(shop.slug);
  const client = await signInAs(owner.email, owner.password);
  const { error } = await client.rpc("call_next");
  if (error) throw new Error(error.message);
  return { owner, shop, ticket, client };
}

async function markServed(
  client: Awaited<ReturnType<typeof signInAs>>,
  ticketId: string,
) {
  const { data, error } = await client.rpc("mark_served", { p_ticket_id: ticketId });
  return {
    error: error?.message,
    ticket: (data as unknown as { result: ServedTicket } | null)?.result,
  };
}

describe("mark_served", () => {
  test("marks the Customer in the chair Served, with the Undo window open", async () => {
    const { ticket, client } = await shopWithCalledTicket();

    const served = await markServed(client, ticket.id);

    expect(served.ticket).toEqual({
      id: ticket.id,
      number: 1,
      name: "Ali",
      called_at: expect.any(String),
      no_show_in_ms: expect.any(Number),
      undo_expires_in_ms: 120_000,
    });
    const { rows } = await db.query(
      "select status, served_at, finished_at from public.tickets where id = $1",
      [ticket.id],
    );
    expect(rows[0].status).toBe("served");
    expect(rows[0].served_at).not.toBeNull();
    expect(rows[0].finished_at).not.toBeNull();
  });

  test("keeps the call it came from, so an Undo does not restart the chair's clock", async () => {
    const { ticket, client } = await shopWithCalledTicket();
    await db.query(
      "update public.tickets set called_at = now() - interval '4 minutes' where id = $1",
      [ticket.id],
    );

    const served = await markServed(client, ticket.id);

    // One minute of the No-show wait left, not the whole five: the Customer has
    // been in that chair for four, and Undo puts them back in the same one.
    expect(served.ticket!.no_show_in_ms).toBeGreaterThan(58_000);
    expect(served.ticket!.no_show_in_ms).toBeLessThanOrEqual(60_000);
  });

  test("refuses a Ticket that is not in a chair", async () => {
    const { owner, shop } = await createShop();
    const waiting = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);

    const { error } = await markServed(client, waiting.id);

    expect(error).toBe("ticket_not_found");
  });

  test("refuses a second Done on the same Ticket", async () => {
    const { ticket, client } = await shopWithCalledTicket();
    await markServed(client, ticket.id);

    const { error } = await markServed(client, ticket.id);

    expect(error).toBe("ticket_not_found");
  });

  test("an Owner cannot act on another Shop's Ticket", async () => {
    const theirs = await shopWithCalledTicket();
    const mine = await createShop();
    const client = await signInAs(mine.owner.email, mine.owner.password);

    const { error } = await markServed(client, theirs.ticket.id);

    expect(error).toBe("ticket_not_found");
    const { rows } = await db.query("select status from public.tickets where id = $1", [
      theirs.ticket.id,
    ]);
    expect(rows[0].status).toBe("called");
  });

  test("refuses the Owner of a Deactivated Shop", async () => {
    const { shop, ticket, client } = await shopWithCalledTicket();
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);

    const { error } = await markServed(client, ticket.id);

    expect(error).toBe("shop_inactive");
  });
});
