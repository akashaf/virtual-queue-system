import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  connectDb,
  createShop,
  metresNorthOf,
  resetTestData,
  serviceClient,
  SHOP_LNG,
  uniqueSlug,
} from "./helpers";

let db: Client;

beforeAll(async () => {
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

interface JoinArgs {
  slug: string;
  deviceId?: string;
  name?: string;
  lat?: number;
  lng?: number;
  accuracyM?: number | null;
}

/** Calls `join_queue` the way the joinQueue Server Action does. */
function join({
  slug,
  deviceId = crypto.randomUUID(),
  name = "Ali",
  lat = metresNorthOf(0),
  lng = SHOP_LNG,
  accuracyM = 0,
}: JoinArgs) {
  return serviceClient().rpc("join_queue", {
    p_slug: slug,
    p_device_id: deviceId,
    p_name: name,
    p_lat: lat,
    p_lng: lng,
    ...(accuracyM === null ? {} : { p_accuracy_m: accuracyM }),
  });
}

/** The `{ result, alerts }` envelope, narrowed to what #5 fills in. */
interface JoinEnvelope {
  result: {
    shop: { name: string; is_active: boolean; joining_state: string; waiting_count: number };
    ticket: { id: string; number: number; status: string; position: number } | null;
  };
  alerts: unknown[];
}

async function joinOrThrow(args: JoinArgs) {
  const { data, error } = await join(args);
  if (error) throw new Error(error.message);
  return data as unknown as JoinEnvelope;
}

describe("join_queue", () => {
  test("creates the first Ticket of the Queue Day and describes the Customer's view", async () => {
    const { shop } = await createShop();

    const { result, alerts } = await joinOrThrow({ slug: shop.slug, name: "Ali" });

    expect(result.shop).toEqual({
      name: shop.name,
      is_active: true,
      joining_state: "open",
      waiting_count: 1,
    });
    expect(result.ticket).toEqual({
      id: expect.any(String),
      number: 1,
      status: "waiting",
      position: 0,
    });
    // Joining raises none: the Customer is looking at the page already.
    expect(alerts).toEqual([]);
  });

  test("numbers Tickets in joining order and puts each behind the last", async () => {
    const { shop } = await createShop();

    const first = await joinOrThrow({ slug: shop.slug });
    const second = await joinOrThrow({ slug: shop.slug });
    const third = await joinOrThrow({ slug: shop.slug });

    expect(first.result.ticket?.number).toBe(1);
    expect(second.result.ticket).toMatchObject({ number: 2, position: 1 });
    expect(third.result.ticket).toMatchObject({ number: 3, position: 2 });
    expect(third.result.shop.waiting_count).toBe(3);
  });

  test("stores the name trimmed, the device and the scan origin", async () => {
    const { shop } = await createShop();
    const deviceId = crypto.randomUUID();

    const { result } = await joinOrThrow({
      slug: shop.slug,
      deviceId,
      name: "  Siti  ",
    });

    const { rows } = await db.query(
      "select customer_name, device_id, origin, status, shop_id, queue_day_id from public.tickets where id = $1",
      [result.ticket?.id],
    );
    expect(rows[0]).toEqual({
      customer_name: "Siti",
      device_id: deviceId,
      origin: "scan",
      status: "waiting",
      shop_id: shop.id,
      queue_day_id: shop.current_queue_day_id,
    });
  });

  test("numbers restart per Queue Day, so two Shops both start at 1", async () => {
    const a = await createShop();
    const b = await createShop();

    const first = await joinOrThrow({ slug: a.shop.slug });
    const second = await joinOrThrow({ slug: b.shop.slug });

    expect(first.result.ticket?.number).toBe(1);
    expect(second.result.ticket?.number).toBe(1);
    expect(second.result.shop.waiting_count).toBe(1);
  });
});

describe("join_queue errors", () => {
  test("refuses an unknown slug as shop_inactive, revealing nothing", async () => {
    const { error } = await join({ slug: uniqueSlug("nobody") });

    expect(error?.message).toBe("shop_inactive");
  });

  test("refuses a Deactivated Shop", async () => {
    const { shop } = await createShop();
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);

    const { error } = await join({ slug: shop.slug });

    expect(error?.message).toBe("shop_inactive");
  });

  test("refuses to join during Last Call", async () => {
    const { shop } = await createShop();
    await db.query("update public.shops set joining_state = 'last_call' where id = $1", [
      shop.id,
    ]);

    const { error } = await join({ slug: shop.slug });

    expect(error?.message).toBe("last_call");
  });

  test("refuses a second Ticket for a device that already holds one", async () => {
    const { shop } = await createShop();
    const deviceId = crypto.randomUUID();
    await joinOrThrow({ slug: shop.slug, deviceId });

    const { error } = await join({ slug: shop.slug, deviceId });

    expect(error?.message).toBe("already_in_queue");
  });

  test("lets the same device join a different Shop", async () => {
    const a = await createShop();
    const b = await createShop();
    const deviceId = crypto.randomUUID();
    await joinOrThrow({ slug: a.shop.slug, deviceId });

    const { result } = await joinOrThrow({ slug: b.shop.slug, deviceId });

    expect(result.ticket?.number).toBe(1);
  });

  test("refuses a Customer outside the Join Radius", async () => {
    const { shop } = await createShop();

    const { error } = await join({ slug: shop.slug, lat: metresNorthOf(151) });

    expect(error?.message).toBe("too_far");
  });

  test("refuses to join a full Queue", async () => {
    const { shop } = await createShop({ p_max_queue_size: 2 });
    await joinOrThrow({ slug: shop.slug });
    await joinOrThrow({ slug: shop.slug });

    const { error } = await join({ slug: shop.slug });

    expect(error?.message).toBe("queue_full");
  });

  test("counts Called Tickets towards the queue size", async () => {
    const { shop } = await createShop({ p_max_queue_size: 2 });
    const first = await joinOrThrow({ slug: shop.slug });
    await joinOrThrow({ slug: shop.slug });
    await db.query(
      "update public.tickets set status = 'called', called_at = now() where id = $1",
      [first.result.ticket?.id],
    );

    const { error } = await join({ slug: shop.slug });

    expect(error?.message).toBe("queue_full");
  });

  test("does not count finished Tickets towards the queue size", async () => {
    const { shop } = await createShop({ p_max_queue_size: 2 });
    const first = await joinOrThrow({ slug: shop.slug });
    await joinOrThrow({ slug: shop.slug });
    await db.query(
      "update public.tickets set status = 'left', finished_at = now() where id = $1",
      [first.result.ticket?.id],
    );

    const { result } = await joinOrThrow({ slug: shop.slug });

    expect(result.ticket?.number).toBe(3);
  });

  test("tells a Customer standing outside a full Queue that they are too far", async () => {
    // Being far away is the reason they may not join at all; "check back soon"
    // would be the wrong advice.
    const { shop } = await createShop({ p_max_queue_size: 1 });
    await joinOrThrow({ slug: shop.slug });

    const { error } = await join({ slug: shop.slug, lat: metresNorthOf(400) });

    expect(error?.message).toBe("too_far");
  });

  test("refuses a blank name", async () => {
    const { shop } = await createShop();

    const { error } = await join({ slug: shop.slug, name: "   " });

    expect(error?.code).toBe("23514");
  });

  test("refuses a name longer than 30 characters", async () => {
    const { shop } = await createShop();

    const { error } = await join({ slug: shop.slug, name: "a".repeat(31) });

    expect(error?.code).toBe("23514");
  });

  test("takes a 30-character name, counting an emoji as one character", async () => {
    const { shop } = await createShop();

    const { error } = await join({ slug: shop.slug, name: "\u{1F600}".repeat(30) });

    expect(error).toBeNull();
  });

  test("refuses a missing name, which the column would otherwise take as erased", async () => {
    const { shop } = await createShop();

    const { data, error } = await serviceClient().rpc("join_queue", {
      p_slug: shop.slug,
      p_device_id: crypto.randomUUID(),
      p_name: null as unknown as string,
      p_lat: metresNorthOf(0),
      p_lng: SHOP_LNG,
      p_accuracy_m: 0,
    });

    expect(error?.code).toBe("23514");
    expect(data).toBeNull();
  });
});

describe("join_queue and the Join Radius", () => {
  test.each([
    ["just inside the radius", 149, 0, true],
    ["just outside the radius", 151, 0, false],
    ["inside once the fix's own accuracy is allowed", 199, 50, true],
    ["outside even with that accuracy", 201, 50, false],
    ["inside with the accuracy capped at 100 m", 249, 300, true],
    ["outside because the cap stops a vague fix", 251, 300, false],
    ["outside when no accuracy is reported at all", 151, null, false],
    ["inside when no accuracy is reported at all", 149, null, true],
  ])("%s", async (_label, metres, accuracyM, accepted) => {
    const { shop } = await createShop();

    const { data, error } = await join({
      slug: shop.slug,
      lat: metresNorthOf(metres),
      accuracyM,
    });

    if (accepted) {
      expect(error).toBeNull();
      expect((data as unknown as JoinEnvelope).result.ticket?.number).toBe(1);
    } else {
      expect(error?.message).toBe("too_far");
    }
  });

  test("measures east-west distance too, not just latitude", async () => {
    const { shop } = await createShop();
    // One degree of longitude is ~111 km at the equator; 0.01° here is ~1.1 km.
    const { error } = await join({ slug: shop.slug, lng: SHOP_LNG + 0.01 });

    expect(error?.message).toBe("too_far");
  });

  test("honours a Shop's own Join Radius", async () => {
    const { shop } = await createShop({ p_join_radius_m: 20 });

    const inside = await join({ slug: shop.slug, lat: metresNorthOf(19) });
    const outside = await join({ slug: shop.slug, lat: metresNorthOf(21) });

    expect(inside.error).toBeNull();
    expect(outside.error?.message).toBe("too_far");
  });
});

describe("join_queue under concurrency", () => {
  test("admits exactly one of two joins racing for the last place", async () => {
    // The Shop row lock is what makes this safe: the second call waits for the
    // first to commit, and only then counts the Queue.
    const { shop } = await createShop({ p_max_queue_size: 2 });
    await joinOrThrow({ slug: shop.slug });

    const blocker = await connectDb();
    try {
      await blocker.query("begin");
      await blocker.query("select 1 from public.shops where id = $1 for update", [
        shop.id,
      ]);

      // Starts, then blocks on the Shop lock the fixture connection holds.
      const contender = join({ slug: shop.slug });
      await new Promise((resolve) => setTimeout(resolve, 200));

      await blocker.query(
        `select public.join_queue($1, $2, 'Ali', $3, $4, 0)`,
        [shop.slug, crypto.randomUUID(), metresNorthOf(0), SHOP_LNG],
      );
      await blocker.query("commit");

      const { error } = await contender;
      expect(error?.message).toBe("queue_full");
    } finally {
      await blocker.end();
    }

    const { rows } = await db.query(
      "select count(*)::int as n from public.tickets where shop_id = $1",
      [shop.id],
    );
    expect(rows[0].n).toBe(2);
  });

  test("never oversells the last place when five devices join at once", async () => {
    const { shop } = await createShop({ p_max_queue_size: 3 });
    await joinOrThrow({ slug: shop.slug });
    await joinOrThrow({ slug: shop.slug });

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => join({ slug: shop.slug })),
    );

    const admitted = attempts.filter((attempt) => attempt.error === null);
    expect(admitted).toHaveLength(1);
    for (const rejected of attempts.filter((attempt) => attempt.error !== null)) {
      expect(rejected.error?.message).toBe("queue_full");
    }
  });

  test("gives two simultaneous joins different Ticket numbers", async () => {
    const { shop } = await createShop();

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => join({ slug: shop.slug })),
    );

    const numbers = attempts.map(
      (attempt) => (attempt.data as unknown as JoinEnvelope).result.ticket?.number,
    );
    expect(new Set(numbers).size).toBe(5);
    expect([...numbers].sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("join_queue and the Heads-up Threshold", () => {
  /** The `heads_up_sent_at` of the Ticket a join returned. */
  async function headsUpSentAt(db: Client, ticketId: string) {
    const { rows } = await db.query(
      "select heads_up_sent_at from public.tickets where id = $1",
      [ticketId],
    );
    return rows[0].heads_up_sent_at as Date | null;
  }

  test("marks a Ticket that joins already inside the threshold as told", async () => {
    // The Customer is looking at the page that says how many are ahead, so the
    // Heads-up has in effect been delivered. Marking it stops the next mutation
    // sending a pointless alert.
    const { shop } = await createShop({ p_heads_up_threshold: 1 });

    const first = await joinOrThrow({ slug: shop.slug });
    const second = await joinOrThrow({ slug: shop.slug });

    expect(await headsUpSentAt(db, first.result.ticket!.id)).toBeInstanceOf(Date);
    expect(await headsUpSentAt(db, second.result.ticket!.id)).toBeInstanceOf(Date);
  });

  test("leaves a Ticket that joins behind the threshold to be alerted later", async () => {
    const { shop } = await createShop({ p_heads_up_threshold: 1 });
    await joinOrThrow({ slug: shop.slug });
    await joinOrThrow({ slug: shop.slug });

    const third = await joinOrThrow({ slug: shop.slug });

    expect(third.result.ticket?.position).toBe(2);
    expect(await headsUpSentAt(db, third.result.ticket!.id)).toBeNull();
  });

  test("counts only the Queue, not the chairs, when deciding", async () => {
    // A Called Ticket is in a chair and ahead of nobody, so it must not push a
    // new joiner outside the threshold.
    const { shop } = await createShop({ p_heads_up_threshold: 1 });
    const first = await joinOrThrow({ slug: shop.slug });
    const second = await joinOrThrow({ slug: shop.slug });
    await db.query(
      "update public.tickets set status = 'called', called_at = now() where id in ($1, $2)",
      [first.result.ticket!.id, second.result.ticket!.id],
    );

    const third = await joinOrThrow({ slug: shop.slug });

    expect(third.result.ticket?.position).toBe(0);
    expect(await headsUpSentAt(db, third.result.ticket!.id)).toBeInstanceOf(Date);
  });
});
