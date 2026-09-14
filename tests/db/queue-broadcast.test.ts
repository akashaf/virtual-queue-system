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

interface Ping {
  id: string;
  event: string;
  payload: Record<string, unknown>;
  private: boolean;
}

/** Every ping Realtime would have delivered to a Shop's subscribers, oldest first. */
async function allPings(shopId: string): Promise<Ping[]> {
  const { rows } = await db.query(
    `select id, event, payload, private
     from realtime.messages
     where topic = $1
     order by inserted_at, id`,
    [`shop:${shopId}`],
  );
  return rows;
}

/**
 * Starts listening to a Shop's topic, and answers with what has arrived since.
 * Creating the Shop pings it too, and those are not what these tests are about.
 */
async function watchPings(shopId: string) {
  const before = new Set((await allPings(shopId)).map((ping) => ping.id));
  return async () => (await allPings(shopId)).filter((ping) => !before.has(ping.id));
}

describe("queue_changed broadcast", () => {
  test("pings the Shop's topic when a Customer joins", async () => {
    const { shop } = await createShop();
    const since = await watchPings(shop.id);

    await join(shop.slug);

    expect(await since()).toHaveLength(1);
  });

  test("pings again for every change to a Ticket", async () => {
    const { owner, shop } = await createShop();
    await join(shop.slug);
    const client = await signInAs(owner.email, owner.password);
    const since = await watchPings(shop.id);

    const called = await client.rpc("call_next");
    const id = (called.data as unknown as { result: { id: string } }).result.id;
    await client.rpc("mark_served", { p_ticket_id: id });

    expect(await since()).toHaveLength(2);
  });

  test("pings when the Shop itself changes", async () => {
    const { shop } = await createShop();
    const since = await watchPings(shop.id);

    await db.query("update public.shops set joining_state = 'last_call' where id = $1", [
      shop.id,
    ]);

    expect(await since()).toHaveLength(1);
  });

  test("carries no Ticket data, because the topic is public", async () => {
    const { shop } = await createShop();
    const since = await watchPings(shop.id);
    await join(shop.slug, "Ali");

    const [ping] = await since();

    expect(ping.event).toBe("queue_changed");
    expect(ping.private).toBe(false);
    // `id` is realtime.send's own message id; `at` is all we add.
    expect(Object.keys(ping.payload).sort()).toEqual(["at", "id"]);
  });

  test("never pings another Shop's topic", async () => {
    const mine = await createShop();
    const theirs = await createShop();
    const since = await watchPings(mine.shop.id);

    await join(theirs.shop.slug);

    expect(await since()).toEqual([]);
  });
});
