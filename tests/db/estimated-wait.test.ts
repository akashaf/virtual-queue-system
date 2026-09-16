import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  connectDb,
  createShop,
  metresNorthOf,
  resetTestData,
  serviceClient,
  SHOP_LNG,
} from "./helpers";

let db: Client;

beforeAll(async () => {
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

interface Estimate {
  min_minutes: number;
  max_minutes: number;
}

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
  return { deviceId, ticketId: envelope.result.ticket.id };
}

async function estimate(slug: string, deviceId: string) {
  const { data, error } = await serviceClient().rpc("get_customer_view", {
    p_slug: slug,
    p_device_id: deviceId,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as { estimate: Estimate | null }).estimate;
}

/**
 * Serves Tickets at the given minute gaps, ending at roughly now.
 *
 * `gaps[i]` is the interval between the i-th and (i+1)-th `served_at`, so the
 * median the estimate reads is the median of exactly these values.
 */
async function serveAtGaps(slug: string, gaps: number[]) {
  // Walk the gaps backwards from now, so the last serve is the most recent.
  let minutesAgo = 0;
  const offsets = [0];
  for (const gap of [...gaps].reverse()) {
    minutesAgo += gap;
    offsets.push(minutesAgo);
  }
  offsets.reverse();

  for (const offset of offsets) {
    const { ticketId } = await join(slug);
    await db.query(
      `update public.tickets
       set status = 'served',
           served_at = now() - make_interval(mins => $2),
           finished_at = now() - make_interval(mins => $2)
       where id = $1`,
      [ticketId, offset],
    );
  }
}

describe("Estimated Wait", () => {
  test("is null while fewer than 5 Tickets are Served today", async () => {
    const { shop } = await createShop();
    await serveAtGaps(shop.slug, [10, 10, 10]); // 4 Served
    const mine = await join(shop.slug);

    expect(await estimate(shop.slug, mine.deviceId)).toBeNull();
  });

  test("ranges −30%/+30% around (position + 1) × the median gap, rounded to 5", async () => {
    const { shop } = await createShop();
    // 5 Served with gaps [5, 10, 10, 20]: median 10 minutes.
    await serveAtGaps(shop.slug, [5, 10, 10, 20]);
    const first = await join(shop.slug);
    const second = await join(shop.slug);

    // Position 0: estimate 10, so 7..13 rounds to 5..15.
    expect(await estimate(shop.slug, first.deviceId)).toEqual({
      min_minutes: 5,
      max_minutes: 15,
    });
    // Position 1: estimate 20, so 14..26 rounds to 15..25.
    expect(await estimate(shop.slug, second.deviceId)).toEqual({
      min_minutes: 15,
      max_minutes: 25,
    });
  });

  test("reads only the last 10 Served", async () => {
    const { shop } = await createShop();
    // 12 Served. The two oldest sit 5 minutes apart; the last 10 gap
    // [10, 10, 10, 10, 20, 20, 20, 20, 30], whose median is 20. Counting the
    // old pair in would drag the median down to 10 and betray itself here.
    await serveAtGaps(shop.slug, [5, 5, 10, 10, 10, 10, 20, 20, 20, 20, 30]);
    const mine = await join(shop.slug);

    // Position 0: estimate 20, so 14..26 rounds to 15..25.
    expect(await estimate(shop.slug, mine.deviceId)).toEqual({
      min_minutes: 15,
      max_minutes: 25,
    });
  });

  test("counts only the current Queue Day's Served", async () => {
    const { shop } = await createShop();
    await serveAtGaps(shop.slug, [10, 10, 10, 10]); // 5 Served, enough — today
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
    const mine = await join(shop.slug);

    expect(await estimate(shop.slug, mine.deviceId)).toBeNull();
  });

  test("is null without a Waiting Ticket: the wait it estimates is over", async () => {
    const { shop } = await createShop();
    await serveAtGaps(shop.slug, [10, 10, 10, 10]);
    const mine = await join(shop.slug);
    await db.query(
      "update public.tickets set status = 'called', called_at = now() where id = $1",
      [mine.ticketId],
    );

    expect(await estimate(shop.slug, mine.deviceId)).toBeNull();
    expect(await estimate(shop.slug, crypto.randomUUID())).toBeNull();
  });
});
