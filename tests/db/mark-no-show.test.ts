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

/** A Shop with one Customer already called to a chair — where No-show starts. */
async function shopWithCalledTicket() {
  const { owner, shop } = await createShop();
  const ticket = await join(shop.slug);
  const client = await signInAs(owner.email, owner.password);
  const { error } = await client.rpc("call_next");
  if (error) throw new Error(error.message);
  return { owner, shop, ticket, client };
}

/** Moves a call back in time, to stand in for the Customer keeping the chair waiting. */
function calledSecondsAgo(ticketId: string, seconds: number) {
  return db.query(
    "update public.tickets set called_at = now() - make_interval(secs => $2) where id = $1",
    [ticketId, seconds],
  );
}

async function markNoShow(
  client: Awaited<ReturnType<typeof signInAs>>,
  ticketId: string,
) {
  const { data, error } = await client.rpc("mark_no_show", { p_ticket_id: ticketId });
  return {
    error: error?.message,
    ticket: (data as unknown as { result: { id: string; number: number } } | null)
      ?.result,
  };
}

describe("mark_no_show", () => {
  test("refuses until five minutes have passed since the call", async () => {
    const { ticket, client } = await shopWithCalledTicket();

    const { error } = await markNoShow(client, ticket.id);

    expect(error).toBe("too_early");
    const { rows } = await db.query("select status from public.tickets where id = $1", [
      ticket.id,
    ]);
    expect(rows[0].status).toBe("called");
  });

  test("still refuses a second before the five minutes are up", async () => {
    const { ticket, client } = await shopWithCalledTicket();
    await calledSecondsAgo(ticket.id, 299);

    const { error } = await markNoShow(client, ticket.id);

    expect(error).toBe("too_early");
  });

  test("gives up on the Customer once five minutes have passed", async () => {
    const { ticket, client } = await shopWithCalledTicket();
    await calledSecondsAgo(ticket.id, 300);

    const { error, ticket: result } = await markNoShow(client, ticket.id);

    expect(error).toBeUndefined();
    expect(result).toEqual({ id: ticket.id, number: 1 });
    const { rows } = await db.query(
      "select status, finished_at from public.tickets where id = $1",
      [ticket.id],
    );
    expect(rows[0].status).toBe("no_show");
    expect(rows[0].finished_at).not.toBeNull();
  });

  test("frees the device, so the Customer could take a new place", async () => {
    const { shop, ticket, client } = await shopWithCalledTicket();
    await calledSecondsAgo(ticket.id, 300);

    await markNoShow(client, ticket.id);

    // tickets_one_active_per_device no longer holds this device.
    await expect(join(shop.slug, "Ali again")).resolves.toBeDefined();
  });

  test("refuses a Ticket that is not in a chair", async () => {
    const { owner, shop } = await createShop();
    const waiting = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);

    const { error } = await markNoShow(client, waiting.id);

    expect(error).toBe("ticket_not_found");
  });

  test("an Owner cannot give up on another Shop's Customer", async () => {
    const theirs = await shopWithCalledTicket();
    await calledSecondsAgo(theirs.ticket.id, 300);
    const mine = await createShop();
    const client = await signInAs(mine.owner.email, mine.owner.password);

    const { error } = await markNoShow(client, theirs.ticket.id);

    expect(error).toBe("ticket_not_found");
  });

  test("refuses the Owner of a Deactivated Shop", async () => {
    const { shop, ticket, client } = await shopWithCalledTicket();
    await calledSecondsAgo(ticket.id, 300);
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);

    const { error } = await markNoShow(client, ticket.id);

    expect(error).toBe("shop_inactive");
  });
});
