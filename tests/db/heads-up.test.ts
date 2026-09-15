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

/** One entry of the `alerts` half of the `{ result, alerts }` envelope. */
interface Alert {
  ticket_id: string;
  kind: string;
}

type Envelope = { result: unknown; alerts: Alert[] };

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
  const envelope = data as unknown as Envelope & {
    result: { ticket: { id: string } };
  };
  return { id: envelope.result.ticket.id, deviceId, alerts: envelope.alerts };
}

/** Runs one owner function with the Owner's JWT and hands back its alerts. */
async function asOwner(
  owner: { email: string; password: string },
  fn: "call_next" | "mark_served" | "undo_served" | "mark_no_show" | "remove_ticket",
  ticketId?: string,
): Promise<Alert[]> {
  const client = await signInAs(owner.email, owner.password);
  const { data, error } =
    fn === "call_next"
      ? await client.rpc(fn)
      : await client.rpc(fn, { p_ticket_id: ticketId! });
  if (error) throw new Error(error.message);
  return (data as unknown as Envelope).alerts;
}

async function headsUpSentAt(ticketId: string) {
  const { rows } = await db.query(
    "select heads_up_sent_at from public.tickets where id = $1",
    [ticketId],
  );
  return rows[0].heads_up_sent_at as Date | null;
}

describe("Heads-up after a mutation", () => {
  test("call_next alerts the Called Ticket and the one that moved inside the threshold", async () => {
    const { owner, shop } = await createShop({ p_heads_up_threshold: 1 });
    const first = await join(shop.slug);
    await join(shop.slug);
    const third = await join(shop.slug);
    expect(await headsUpSentAt(third.id)).toBeNull();

    const alerts = await asOwner(owner, "call_next");

    // The third Ticket now has one Waiting Ticket ahead of it: inside a threshold of 1.
    expect(alerts).toEqual([
      { ticket_id: first.id, kind: "called" },
      { ticket_id: third.id, kind: "heads_up" },
    ]);
    expect(await headsUpSentAt(third.id)).toBeInstanceOf(Date);
  });

  test("fires exactly once per Ticket", async () => {
    const { owner, shop } = await createShop({ p_heads_up_threshold: 1 });
    await join(shop.slug);
    await join(shop.slug);
    const third = await join(shop.slug);
    await asOwner(owner, "call_next");

    const stampedAt = await headsUpSentAt(third.id);
    const alerts = await asOwner(owner, "call_next");

    expect(alerts.filter((alert) => alert.kind === "heads_up")).toEqual([]);
    expect(await headsUpSentAt(third.id)).toEqual(stampedAt);
  });

  test("is not sent to a Ticket that joined inside the threshold", async () => {
    const { owner, shop } = await createShop({ p_heads_up_threshold: 2 });
    const first = await join(shop.slug);
    const second = await join(shop.slug);

    // The join itself stamps silently: the Customer is looking at the page.
    expect(second.alerts).toEqual([]);

    // Nor does the next mutation alert them for a place they were already told of.
    const alerts = await asOwner(owner, "call_next");
    expect(alerts).toEqual([{ ticket_id: first.id, kind: "called" }]);
  });

  test("follows a Customer leaving from ahead", async () => {
    const { shop } = await createShop({ p_heads_up_threshold: 1 });
    const first = await join(shop.slug);
    await join(shop.slug);
    const third = await join(shop.slug);

    const { data, error } = await serviceClient().rpc("leave_queue", {
      p_ticket_id: first.id,
      p_device_id: first.deviceId,
    });

    expect(error).toBeNull();
    expect((data as unknown as Envelope).alerts).toEqual([
      { ticket_id: third.id, kind: "heads_up" },
    ]);
  });

  test("follows the Owner removing a Ticket from ahead", async () => {
    const { owner, shop } = await createShop({ p_heads_up_threshold: 1 });
    const first = await join(shop.slug);
    await join(shop.slug);
    const third = await join(shop.slug);

    const alerts = await asOwner(owner, "remove_ticket", first.id);

    expect(alerts).toEqual([{ ticket_id: third.id, kind: "heads_up" }]);
  });

  test("catches up in any mutation, even one that moves nobody", async () => {
    // The rule is "after every mutation", so a Ticket owed a Heads-up — here
    // because the threshold was raised under it — is told by the next press,
    // whatever that press was.
    const { owner, shop } = await createShop({ p_heads_up_threshold: 1 });
    const first = await join(shop.slug);
    await asOwner(owner, "call_next");
    await join(shop.slug);
    await join(shop.slug);
    const fourth = await join(shop.slug);
    await db.query("update public.shops set heads_up_threshold = 3 where id = $1", [
      shop.id,
    ]);

    const alerts = await asOwner(owner, "mark_served", first.id);

    expect(alerts).toEqual([{ ticket_id: fourth.id, kind: "heads_up" }]);
  });

  test("ignores Tickets that are not Waiting", async () => {
    const { owner, shop } = await createShop({ p_heads_up_threshold: 1 });
    const first = await join(shop.slug);
    await asOwner(owner, "call_next");
    await db.query("update public.tickets set heads_up_sent_at = null where id = $1", [
      first.id,
    ]);

    // A Called Ticket in a chair is past needing a Heads-up.
    const alerts = await asOwner(owner, "mark_served", first.id);

    expect(alerts).toEqual([]);
    expect(await headsUpSentAt(first.id)).toBeNull();
  });
});
