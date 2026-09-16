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
  const envelope = data as unknown as { result: { ticket: { id: string } } };
  return { id: envelope.result.ticket.id, deviceId };
}

/** Subscribes a Ticket's device the way the savePushSubscription action does. */
function save(
  ticketId: string,
  deviceId: string,
  overrides: Partial<{ endpoint: string; lang: string }> = {},
) {
  return serviceClient().rpc("save_push_subscription", {
    p_ticket_id: ticketId,
    p_device_id: deviceId,
    p_endpoint: overrides.endpoint ?? `https://push.test/${crypto.randomUUID()}`,
    p_p256dh: "BPtestkey",
    p_auth: "authsecret",
    p_lang: overrides.lang ?? "ms",
  });
}

async function subscriptions(ticketId: string) {
  const { rows } = await db.query(
    "select endpoint, p256dh, auth, lang from public.push_subscriptions where ticket_id = $1 order by created_at",
    [ticketId],
  );
  return rows as { endpoint: string; p256dh: string; auth: string; lang: string }[];
}

/** Summons the Ticket, waits out the No-show window, and marks it a No-show. */
async function callThenNoShow(
  owner: { email: string; password: string },
  ticketId: string,
) {
  const client = await signInAs(owner.email, owner.password);
  let result = await client.rpc("call_next");
  if (result.error) throw new Error(result.error.message);

  await db.query(
    "update public.tickets set called_at = now() - make_interval(mins => 6) where id = $1",
    [ticketId],
  );

  result = await client.rpc("mark_no_show", { p_ticket_id: ticketId });
  if (result.error) throw new Error(result.error.message);
}

describe("save_push_subscription", () => {
  test("saves a subscription for the device's own Ticket, language included", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);

    const { error } = await save(ticket.id, ticket.deviceId, {
      endpoint: "https://push.test/own-ticket",
      lang: "ms",
    });

    expect(error).toBeNull();
    expect(await subscriptions(ticket.id)).toEqual([
      {
        endpoint: "https://push.test/own-ticket",
        p256dh: "BPtestkey",
        auth: "authsecret",
        lang: "ms",
      },
    ]);
  });

  test("re-saving the same endpoint moves the subscription to the new Ticket", async () => {
    const { shop } = await createShop();
    const first = await join(shop.slug);
    const endpoint = "https://push.test/same-browser";
    await save(first.id, first.deviceId, { endpoint });

    // The same browser leaves and joins again: one endpoint, a new Ticket.
    await serviceClient().rpc("leave_queue", {
      p_ticket_id: first.id,
      p_device_id: first.deviceId,
    });
    const second = await join(shop.slug, first.deviceId);
    const { error } = await save(second.id, second.deviceId, { endpoint, lang: "en" });

    expect(error).toBeNull();
    expect(await subscriptions(first.id)).toEqual([]);
    expect(await subscriptions(second.id)).toMatchObject([{ endpoint, lang: "en" }]);
  });

  test("rejects a subscription for another device's Ticket", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);

    const { error } = await save(ticket.id, crypto.randomUUID());

    expect(error?.message).toBe("ticket_not_found");
    expect(await subscriptions(ticket.id)).toEqual([]);
  });

  test("rejects a subscription for a Ticket that has already ended", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);
    await serviceClient().rpc("leave_queue", {
      p_ticket_id: ticket.id,
      p_device_id: ticket.deviceId,
    });

    const { error } = await save(ticket.id, ticket.deviceId);

    expect(error?.message).toBe("ticket_not_found");
  });

  test("the anon role can neither call it nor read the table", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);
    await save(ticket.id, ticket.deviceId);

    const called = await anonClient().rpc("save_push_subscription", {
      p_ticket_id: ticket.id,
      p_device_id: ticket.deviceId,
      p_endpoint: "https://push.test/anon",
      p_p256dh: "k",
      p_auth: "a",
      p_lang: "en",
    });
    const read = await anonClient().from("push_subscriptions").select("endpoint");

    expect(called.error).not.toBeNull();
    expect(read.error).not.toBeNull();
  });
});

describe("subscriptions end with the Ticket", () => {
  test("leaving deletes the Ticket's subscriptions", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);
    await save(ticket.id, ticket.deviceId);

    const { error } = await serviceClient().rpc("leave_queue", {
      p_ticket_id: ticket.id,
      p_device_id: ticket.deviceId,
    });

    expect(error).toBeNull();
    expect(await subscriptions(ticket.id)).toEqual([]);
  });

  test("serving deletes the Ticket's subscriptions", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    await save(ticket.id, ticket.deviceId);

    const client = await signInAs(owner.email, owner.password);
    let result = await client.rpc("call_next");
    if (result.error) throw new Error(result.error.message);
    result = await client.rpc("mark_served", { p_ticket_id: ticket.id });
    if (result.error) throw new Error(result.error.message);

    expect(await subscriptions(ticket.id)).toEqual([]);
  });

  test("removing deletes the Ticket's subscriptions", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    await save(ticket.id, ticket.deviceId);

    const client = await signInAs(owner.email, owner.password);
    const { error } = await client.rpc("remove_ticket", { p_ticket_id: ticket.id });
    if (error) throw new Error(error.message);

    expect(await subscriptions(ticket.id)).toEqual([]);
  });

  test("a No-show that can still Rejoin keeps its subscriptions", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    await save(ticket.id, ticket.deviceId, { endpoint: "https://push.test/no-show" });

    await callThenNoShow(owner, ticket.id);

    expect(await subscriptions(ticket.id)).toMatchObject([
      { endpoint: "https://push.test/no-show" },
    ]);
  });

  test("a No-show of a rejoined Ticket cannot Rejoin again, so it loses them", async () => {
    const { owner, shop } = await createShop();
    const source = await join(shop.slug);
    await callThenNoShow(owner, source.id);

    const { data, error } = await serviceClient().rpc("rejoin_queue", {
      p_ticket_id: source.id,
      p_device_id: source.deviceId,
    });
    if (error) throw new Error(error.message);
    const rejoined = (data as unknown as { result: { ticket: { id: string } } }).result
      .ticket;
    await save(rejoined.id, source.deviceId);

    await callThenNoShow(owner, rejoined.id);

    expect(await subscriptions(rejoined.id)).toEqual([]);
  });

  test("rejoining deletes the source No-show's subscriptions", async () => {
    const { owner, shop } = await createShop();
    const source = await join(shop.slug);
    await save(source.id, source.deviceId);
    await callThenNoShow(owner, source.id);

    const { error } = await serviceClient().rpc("rejoin_queue", {
      p_ticket_id: source.id,
      p_device_id: source.deviceId,
    });

    expect(error).toBeNull();
    expect(await subscriptions(source.id)).toEqual([]);
  });
});
