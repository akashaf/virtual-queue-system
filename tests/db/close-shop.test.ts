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
  type OwnerClient,
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
  const { ticket } = (
    data as unknown as { result: { ticket: { id: string; number: number } } }
  ).result;
  return { ...ticket, deviceId };
}

async function choose(ticketId: string, deviceId: string, choice: "stay" | "carry") {
  const { error } = await serviceClient().rpc("choose_last_call", {
    p_ticket_id: ticketId,
    p_device_id: deviceId,
    p_choice: choice,
  });
  if (error) throw new Error(error.message);
}

interface TicketRow {
  id: string;
  number: number;
  status: string;
  removed_reason: string | null;
  last_call_choice: string | null;
  carried_over_at: string | null;
  queue_day_id: string;
}

async function ticketRow(ticketId: string): Promise<TicketRow> {
  const { rows } = await db.query(
    `select id, number, status, removed_reason, last_call_choice,
            carried_over_at, queue_day_id
     from public.tickets where id = $1`,
    [ticketId],
  );
  return rows[0] as TicketRow;
}

async function currentDayOf(shopId: string): Promise<string> {
  const { rows } = await db.query(
    "select current_queue_day_id from public.shops where id = $1",
    [shopId],
  );
  return rows[0].current_queue_day_id as string;
}

interface CloseEnvelope {
  result: { carried_over: number; removed: number; signed_out: boolean };
  alerts: { ticket_id: string; kind: string }[];
}

describe("close_shop", () => {
  test("is refused while any Ticket is Called, and the day stays open", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("call_next");
    await client.rpc("start_last_call");

    const { error } = await client.rpc("close_shop", { p_sign_in_max_days: 7 });

    expect(error?.message).toBe("tickets_still_called");
    expect(await currentDayOf(shop.id)).toBe(shop.current_queue_day_id);
  });

  test("carries the carry-choosers renumbered 1..k in order, removes the rest", async () => {
    const { owner, shop } = await createShop();
    const staying = await join(shop.slug, crypto.randomUUID(), "Siti");
    const firstCarry = await join(shop.slug, crypto.randomUUID(), "Ali");
    const undecided = await join(shop.slug, crypto.randomUUID(), "Mei");
    const secondCarry = await join(shop.slug, crypto.randomUUID(), "Raj");
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");
    await choose(staying.id, staying.deviceId, "stay");
    await choose(firstCarry.id, firstCarry.deviceId, "carry");
    await choose(secondCarry.id, secondCarry.deviceId, "carry");

    const { data, error } = await client.rpc("close_shop", { p_sign_in_max_days: 7 });

    expect(error).toBeNull();
    const envelope = data as unknown as CloseEnvelope;
    expect(envelope.result).toEqual({ carried_over: 2, removed: 2, signed_out: false });
    expect(envelope.alerts).toEqual([
      { ticket_id: staying.id, kind: "shop_closed" },
      { ticket_id: undecided.id, kind: "shop_closed" },
    ]);

    const newDay = await currentDayOf(shop.id);
    expect(newDay).not.toBe(shop.current_queue_day_id);

    // 1..k in original order, choice honoured and therefore cleared.
    const first = await ticketRow(firstCarry.id);
    expect(first).toMatchObject({
      status: "waiting",
      number: 1,
      queue_day_id: newDay,
      last_call_choice: null,
    });
    expect(first.carried_over_at).not.toBeNull();
    const second = await ticketRow(secondCarry.id);
    expect(second).toMatchObject({ status: "waiting", number: 2, queue_day_id: newDay });

    // Stay and no answer end the same way: removed when the day closed.
    for (const gone of [staying, undecided]) {
      const row = await ticketRow(gone.id);
      expect(row.status).toBe("removed");
      expect(row.removed_reason).toBe("close_shop");
    }

    // Joining reopens, and the next number follows the carried Tickets.
    const next = await join(shop.slug, crypto.randomUUID(), "Lina");
    expect(next.number).toBe(3);
  });

  test("ticket numbers restart at 1 in a new Queue Day nobody carried into", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug);
    await join(shop.slug, crypto.randomUUID(), "Siti");
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");

    await client.rpc("close_shop", { p_sign_in_max_days: 7 });

    const fresh = await join(shop.slug);
    expect(fresh.number).toBe(1);
  });

  test("a Carried-over Ticket cannot carry twice", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");
    await choose(ticket.id, ticket.deviceId, "carry");
    await client.rpc("close_shop", { p_sign_in_max_days: 7 });
    expect((await ticketRow(ticket.id)).status).toBe("waiting");

    // The next evening: choosing carry again changes nothing at Close Shop.
    await client.rpc("start_last_call");
    await choose(ticket.id, ticket.deviceId, "carry");
    const { data } = await client.rpc("close_shop", { p_sign_in_max_days: 7 });

    expect((data as unknown as CloseEnvelope).result).toEqual({
      carried_over: 0,
      removed: 1,
      signed_out: false,
    });
    const row = await ticketRow(ticket.id);
    expect(row.status).toBe("removed");
    expect(row.removed_reason).toBe("close_shop");
  });

  test("Rejoin is refused once the No-show's Queue Day has closed", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("call_next");
    await db.query(
      "update public.tickets set called_at = called_at - interval '6 minutes' where id = $1",
      [ticket.id],
    );
    await client.rpc("mark_no_show", { p_ticket_id: ticket.id });
    await client.rpc("close_shop", { p_sign_in_max_days: 7 });

    const { error } = await serviceClient().rpc("rejoin_queue", {
      p_ticket_id: ticket.id,
      p_device_id: ticket.deviceId,
    });

    expect(error?.message).toBe("not_rejoinable");
  });

  test("tells the removed Customer the shop closed, for the evening only", async () => {
    const { owner, shop } = await createShop();
    const ticket = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");
    await client.rpc("close_shop", { p_sign_in_max_days: 7 });

    const { data } = await serviceClient().rpc("get_customer_view", {
      p_slug: shop.slug,
      p_device_id: ticket.deviceId,
    });
    const view = data as unknown as {
      shop: { joining_state: string };
      ticket: { id: string; status: string; removed_reason: string } | null;
    };
    expect(view.shop.joining_state).toBe("open");
    expect(view.ticket).toMatchObject({
      id: ticket.id,
      status: "removed",
      removed_reason: "close_shop",
    });

    // The morning after, the goodbye has expired and the join form is back.
    await db.query(
      `update public.queue_days set closed_at = closed_at - interval '7 hours'
       where shop_id = $1 and closed_at is not null`,
      [shop.id],
    );
    const { data: later } = await serviceClient().rpc("get_customer_view", {
      p_slug: shop.slug,
      p_device_id: ticket.deviceId,
    });
    expect((later as unknown as { ticket: unknown }).ticket).toBeNull();
  });

  test("shows the carried Customer their place in the new day, with the badge", async () => {
    const { owner, shop } = await createShop();
    const leader = await join(shop.slug, crypto.randomUUID(), "Siti");
    const carried = await join(shop.slug, crypto.randomUUID(), "Ali");
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");
    await choose(leader.id, leader.deviceId, "carry");
    await choose(carried.id, carried.deviceId, "carry");
    await client.rpc("close_shop", { p_sign_in_max_days: 7 });

    const { data } = await serviceClient().rpc("get_customer_view", {
      p_slug: shop.slug,
      p_device_id: carried.deviceId,
    });

    const view = data as unknown as {
      ticket: {
        number: number;
        status: string;
        position: number;
        carried_over: boolean;
        last_call_choice: string | null;
      };
    };
    expect(view.ticket).toMatchObject({
      number: 2,
      status: "waiting",
      position: 1,
      carried_over: true,
      last_call_choice: null,
    });
  });

  test("reports the new Queue Day as not started until its first Call next", async () => {
    const { owner, shop } = await createShop();
    const client = await signInAs(owner.email, owner.password);
    const served = await join(shop.slug);
    await client.rpc("call_next");
    await client.rpc("mark_served", { p_ticket_id: served.id });
    const carried = await join(shop.slug);
    await client.rpc("start_last_call");
    await choose(carried.id, carried.deviceId, "carry");

    const dayStarted = async () => {
      const { data } = await serviceClient().rpc("get_customer_view", {
        p_slug: shop.slug,
        p_device_id: carried.deviceId,
      });
      return (data as unknown as { shop: { day_started: boolean } }).shop.day_started;
    };

    expect(await dayStarted()).toBe(true);
    await client.rpc("close_shop", { p_sign_in_max_days: 7 });
    expect(await dayStarted()).toBe(false);
    await join(shop.slug);
    expect(await dayStarted()).toBe(false);
    await client.rpc("call_next");
    expect(await dayStarted()).toBe(true);
  });

  test("shows the Owner each Waiting row's choice and origin day", async () => {
    const { owner, shop } = await createShop();
    const carried = await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("start_last_call");
    await choose(carried.id, carried.deviceId, "carry");
    await client.rpc("close_shop", { p_sign_in_max_days: 7 });

    // The next day: a fresh join, then Last Call again and one answer so far.
    const fresh = await join(shop.slug, crypto.randomUUID(), "Siti");
    await client.rpc("start_last_call");
    await choose(fresh.id, fresh.deviceId, "stay");
    const { data } = await client.rpc("get_owner_queue");

    const queue = data as unknown as {
      shop: { joining_state: string };
      waiting: { id: string; last_call_choice: string | null; carried_over: boolean }[];
    };
    expect(queue.shop.joining_state).toBe("last_call");
    expect(queue.waiting).toHaveLength(2);
    expect(queue.waiting[0]).toMatchObject({
      id: carried.id,
      last_call_choice: null,
      carried_over: true,
    });
    expect(queue.waiting[1]).toMatchObject({
      id: fresh.id,
      last_call_choice: "stay",
      carried_over: false,
    });
  });
});

/** The Sign-in a client holds, read from the `session_id` claim of its access token. */
async function signInIdOf(client: OwnerClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const payload = data.session!.access_token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString()).session_id as string;
}

/** Backdates a Sign-in, as if the Owner had signed in on that device `days` ago. */
async function ageSignIn(client: OwnerClient, days: number) {
  await db.query(
    "update auth.sessions set created_at = now() - make_interval(days => $2) where id = $1",
    [await signInIdOf(client), days],
  );
}

/** Whether the Auth server still accepts this device's Sign-in. */
async function stillSignedIn(client: OwnerClient): Promise<boolean> {
  const { error } = await client.auth.getUser();
  return error === null;
}

describe("close_shop and Sign-ins (ADR 0006)", () => {
  test("ends the closing device's own Sign-in once it is seven days old, and says so", async () => {
    const { owner } = await createShop();
    const client = await signInAs(owner.email, owner.password);
    await ageSignIn(client, 7);

    const { data, error } = await client.rpc("close_shop", { p_sign_in_max_days: 7 });

    expect(error).toBeNull();
    expect((data as unknown as CloseEnvelope).result.signed_out).toBe(true);
    expect(await stillSignedIn(client)).toBe(false);
  });

  test("ends an old Sign-in on another device and keeps the young one that closed", async () => {
    const { owner } = await createShop();
    const lostTablet = await signInAs(owner.email, owner.password);
    await ageSignIn(lostTablet, 30);
    const phone = await signInAs(owner.email, owner.password);
    await ageSignIn(phone, 6);

    const { data } = await phone.rpc("close_shop", { p_sign_in_max_days: 7 });

    expect((data as unknown as CloseEnvelope).result.signed_out).toBe(false);
    expect(await stillSignedIn(lostTablet)).toBe(false);
    expect(await stillSignedIn(phone)).toBe(true);
  });

  test("leaves another Owner's old Sign-in alone", async () => {
    const { owner } = await createShop();
    const { owner: neighbour } = await createShop();
    const client = await signInAs(owner.email, owner.password);
    const neighbourClient = await signInAs(neighbour.email, neighbour.password);
    await ageSignIn(neighbourClient, 30);

    await client.rpc("close_shop", { p_sign_in_max_days: 7 });

    expect(await stillSignedIn(neighbourClient)).toBe(true);
  });

  test("a refused Close Shop ends no Sign-in", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    await client.rpc("call_next");
    await ageSignIn(client, 30);

    const { error } = await client.rpc("close_shop", { p_sign_in_max_days: 7 });

    expect(error?.message).toBe("tickets_still_called");
    expect(await stillSignedIn(client)).toBe(true);
  });

  test("refuses a limit that is not a positive number of days, closing nothing", async () => {
    const { owner, shop } = await createShop();
    const client = await signInAs(owner.email, owner.password);

    const { error } = await client.rpc("close_shop", { p_sign_in_max_days: 0 });

    expect(error?.code).toBe("22023");
    expect(await currentDayOf(shop.id)).toBe(shop.current_queue_day_id);
    expect(await stillSignedIn(client)).toBe(true);
  });
});
