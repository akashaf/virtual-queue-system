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

async function choose(ticketId: string, deviceId: string, choice: "stay" | "carry") {
  const { data, error } = await serviceClient().rpc("choose_last_call", {
    p_ticket_id: ticketId,
    p_device_id: deviceId,
    p_choice: choice,
  });
  interface ChoiceView {
    ticket: { last_call_choice: string | null } | null;
  }
  return {
    error: error?.message,
    view: (data as unknown as { result: ChoiceView } | null)?.result,
  };
}

async function choiceOf(ticketId: string) {
  const { rows } = await db.query(
    "select last_call_choice from public.tickets where id = $1",
    [ticketId],
  );
  return rows[0].last_call_choice as string | null;
}

describe("start_last_call", () => {
  test("stops joining, stamps the Queue Day, and alerts every Waiting Ticket", async () => {
    const { owner, shop } = await createShop();
    const first = await join(shop.slug);
    const second = await join(shop.slug, crypto.randomUUID(), "Siti");
    const client = await signInAs(owner.email, owner.password);
    // A Called Ticket is in a chair, not among those asked to choose.
    await client.rpc("call_next");

    const { data, error } = await client.rpc("start_last_call");

    expect(error).toBeNull();
    const envelope = data as unknown as {
      result: { joining_state: string };
      alerts: { ticket_id: string; kind: string }[];
    };
    expect(envelope.result.joining_state).toBe("last_call");
    expect(envelope.alerts).toEqual([{ ticket_id: second.id, kind: "last_call" }]);
    expect(envelope.alerts.map((a) => a.ticket_id)).not.toContain(first.id);

    const { rows } = await db.query(
      `select s.joining_state, d.last_call_at
       from public.shops s join public.queue_days d on d.id = s.current_queue_day_id
       where s.id = $1`,
      [shop.id],
    );
    expect(rows[0].joining_state).toBe("last_call");
    expect(rows[0].last_call_at).not.toBeNull();
  });

  test("refuses new joins while it is on", async () => {
    const { owner, shop } = await createShop();
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");

    await expect(join(shop.slug)).rejects.toThrow("last_call");
  });

  test("a second press does nothing rather than alerting the Queue again", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");

    const { data, error } = await client.rpc("start_last_call");

    expect(error).toBeNull();
    const envelope = data as unknown as { alerts: unknown[] };
    expect(envelope.alerts).toEqual([]);
  });

  test("is not reachable by a browser without a session", async () => {
    const { error } = await anonClient().rpc("start_last_call");
    expect(error).not.toBeNull();
  });
});

describe("cancel_last_call", () => {
  test("reopens joining and keeps the choices already made", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");
    await choose(ticket.id, ticket.deviceId, "carry");

    const { data, error } = await client.rpc("cancel_last_call");

    expect(error).toBeNull();
    expect(
      (data as unknown as { result: { joining_state: string } }).result.joining_state,
    ).toBe("open");
    expect(await choiceOf(ticket.id)).toBe("carry");
    // The door really is open again.
    await expect(join(shop.slug)).resolves.toBeDefined();
  });
});

describe("choose_last_call", () => {
  test("records stay or carry, and can change until Close Shop", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");

    const stayed = await choose(ticket.id, ticket.deviceId, "stay");
    expect(stayed.error).toBeUndefined();
    expect(stayed.view?.ticket?.last_call_choice).toBe("stay");

    const carried = await choose(ticket.id, ticket.deviceId, "carry");
    expect(carried.error).toBeUndefined();
    expect(carried.view?.ticket?.last_call_choice).toBe("carry");
    expect(await choiceOf(ticket.id)).toBe("carry");
  });

  test("is refused outside Last Call", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);

    const { error } = await choose(ticket.id, ticket.deviceId, "carry");

    expect(error).toBe("not_last_call");
    expect(await choiceOf(ticket.id)).toBeNull();
  });

  test("is refused for a Called Ticket — a chair has no choice to make", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("call_next");
    await client.rpc("start_last_call");

    const { error } = await choose(ticket.id, ticket.deviceId, "carry");

    expect(error).toBe("ticket_not_found");
  });

  test("is refused for a Ticket the device does not hold", async () => {
    const { owner, shop } = await createShop();
    const mine = await join(shop.slug);
    const theirs = await join(shop.slug, crypto.randomUUID(), "Siti");
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");

    const { error } = await choose(theirs.id, mine.deviceId, "carry");

    expect(error).toBe("ticket_not_found");
    expect(await choiceOf(theirs.id)).toBeNull();
  });

  test("shows the Customer their current choice in the view", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");
    await choose(ticket.id, ticket.deviceId, "stay");

    const { data } = await serviceClient().rpc("get_customer_view", {
      p_slug: shop.slug,
      p_device_id: ticket.deviceId,
    });

    const view = data as unknown as {
      shop: { joining_state: string };
      ticket: { last_call_choice: string | null; carried_over: boolean };
    };
    expect(view.shop.joining_state).toBe("last_call");
    expect(view.ticket.last_call_choice).toBe("stay");
    expect(view.ticket.carried_over).toBe(false);
  });

  test("is not reachable by a browser", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");

    const { error } = await anonClient().rpc("choose_last_call", {
      p_ticket_id: ticket.id,
      p_device_id: ticket.deviceId,
      p_choice: "carry",
    });

    expect(error).not.toBeNull();
  });
});
