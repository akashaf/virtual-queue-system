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

/** What `call_next` puts in the `{ result, alerts }` envelope. */
interface CalledTicket {
  id: string;
  number: number;
  name: string | null;
  called_at: string;
  no_show_in_ms: number;
}

async function join(slug: string, name: string) {
  const { data, error } = await serviceClient().rpc("join_queue", {
    p_slug: slug,
    p_device_id: crypto.randomUUID(),
    p_name: name,
    p_lat: metresNorthOf(0),
    p_lng: SHOP_LNG,
    p_accuracy_m: 0,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as { result: { ticket: { id: string; number: number } } })
    .result.ticket;
}

/** Calls `call_next` with the Owner's own JWT, as the dashboard's Server Action does. */
async function callNext(email: string, password: string) {
  const client = await signInAs(email, password);
  const { data, error } = await client.rpc("call_next");
  return {
    error: error?.message,
    ticket: (data as unknown as { result: CalledTicket } | null)?.result,
  };
}

describe("call_next", () => {
  test("calls the lowest-numbered Waiting Ticket", async () => {
    const { owner, shop } = await createShop();
    const first = await join(shop.slug, "Ali");
    await join(shop.slug, "Siti");

    const { ticket } = await callNext(owner.email, owner.password);

    expect(ticket).toEqual({
      id: first.id,
      number: 1,
      name: "Ali",
      called_at: expect.any(String),
      // The five minutes before the Owner may give up on them, just started.
      no_show_in_ms: 300_000,
    });
  });

  test("leaves the rest of the Queue waiting, and calls them in turn", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug, "Ali");
    const second = await join(shop.slug, "Siti");

    await callNext(owner.email, owner.password);
    const { ticket } = await callNext(owner.email, owner.password);

    expect(ticket?.id).toBe(second.id);
    // Both are in a chair at once: Call next is separate from marking one Served.
    const { rows } = await db.query(
      "select count(*) from public.tickets where shop_id = $1 and status = 'called'",
      [shop.id],
    );
    expect(rows[0].count).toBe("2");
  });

  test("refuses when nobody is Waiting", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug, "Ali");
    await callNext(owner.email, owner.password);

    const { error } = await callNext(owner.email, owner.password);

    expect(error).toBe("queue_empty");
  });

  test("ignores Tickets from a Queue Day that has closed", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug, "Yesterday");
    // Close the day the way close_shop will in #11, and open the next one.
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

    const { error } = await callNext(owner.email, owner.password);

    expect(error).toBe("queue_empty");
  });

  test("never reaches another Owner's Queue", async () => {
    const theirs = await createShop();
    await join(theirs.shop.slug, "Ali");
    const mine = await createShop();

    const { error } = await callNext(mine.owner.email, mine.owner.password);

    expect(error).toBe("queue_empty");
  });

  test("refuses the Owner of a Deactivated Shop", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug, "Ali");
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);

    const { error } = await callNext(owner.email, owner.password);

    expect(error).toBe("shop_inactive");
  });

  test("two Owner devices pressing together call two different Customers", async () => {
    const { owner, shop } = await createShop();
    const first = await join(shop.slug, "Ali");
    const second = await join(shop.slug, "Siti");
    // Separate connections: the Shop lock, not the application, is what keeps
    // these two apart.
    const [a, b] = await Promise.all([
      signInAs(owner.email, owner.password),
      signInAs(owner.email, owner.password),
    ]);

    const results = await Promise.all([a.rpc("call_next"), b.rpc("call_next")]);

    const called = results.map(
      ({ data }) => (data as unknown as { result: CalledTicket }).result.id,
    );
    expect(results.every(({ error }) => error === null)).toBe(true);
    expect(new Set(called)).toEqual(new Set([first.id, second.id]));
  });
});
