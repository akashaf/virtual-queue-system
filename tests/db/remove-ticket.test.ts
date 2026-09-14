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

async function removeTicket(
  client: Awaited<ReturnType<typeof signInAs>>,
  ticketId: string,
) {
  const { data, error } = await client.rpc("remove_ticket", { p_ticket_id: ticketId });
  return {
    error: error?.message,
    ticket: (data as unknown as { result: { id: string; number: number } } | null)
      ?.result,
  };
}

async function statusOf(ticketId: string) {
  const { rows } = await db.query(
    "select status, removed_reason, finished_at from public.tickets where id = $1",
    [ticketId],
  );
  return rows[0];
}

describe("remove_ticket", () => {
  test("takes a Waiting Customer out of the Queue", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);

    const { error, ticket: result } = await removeTicket(client, ticket.id);

    expect(error).toBeUndefined();
    expect(result).toEqual({ id: ticket.id, number: 1 });
    const row = await statusOf(ticket.id);
    expect(row.status).toBe("removed");
    expect(row.removed_reason).toBe("owner");
    expect(row.finished_at).not.toBeNull();
  });

  test("takes a Customer out of the chair too", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("call_next");

    const { error } = await removeTicket(client, ticket.id);

    expect(error).toBeUndefined();
    expect((await statusOf(ticket.id)).status).toBe("removed");
  });

  test("closes the Queue up behind the Customer who left", async () => {
    const { owner, shop } = await createShop();
    const first = await join(shop.slug);
    const second = await join(shop.slug, crypto.randomUUID(), "Siti");
    const client = await signInAs(owner.email, owner.password);

    await removeTicket(client, first.id);

    // The Ticket behind is now at the front, without being renumbered.
    const { data } = await client.rpc("get_owner_queue");
    const queue = data as unknown as { waiting: { id: string; number: number }[] };
    expect(queue.waiting).toEqual([
      {
        id: second.id,
        number: 2,
        name: "Siti",
        joined_at: expect.any(String),
        origin: "scan",
      },
    ]);
  });

  test("frees the device, so the Customer could join again", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await removeTicket(client, ticket.id);

    await expect(join(shop.slug, ticket.deviceId)).resolves.toBeDefined();
  });

  test("refuses a Ticket that has already ended", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await removeTicket(client, ticket.id);

    const { error } = await removeTicket(client, ticket.id);

    expect(error).toBe("ticket_not_found");
  });

  test("an Owner cannot remove another Shop's Customer", async () => {
    const theirs = await createShop();
    const ticket = await join(theirs.shop.slug);
    const mine = await createShop();
    const client = await signInAs(mine.owner.email, mine.owner.password);

    const { error } = await removeTicket(client, ticket.id);

    expect(error).toBe("ticket_not_found");
    expect((await statusOf(ticket.id)).status).toBe("waiting");
  });

  test("refuses the Owner of a Deactivated Shop", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);

    const { error } = await removeTicket(client, ticket.id);

    expect(error).toBe("shop_inactive");
  });
});
