import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Client } from "pg";
import { inject } from "vitest";
import {
  connectDb,
  createShop,
  metresNorthOf,
  resetTestData,
  serviceClient,
  SHOP_LNG,
} from "./helpers";

let db: Client;
let dispatchAlerts: typeof import("@/lib/push").dispatchAlerts;

beforeAll(async () => {
  const { apiUrl, secretKey } = inject("supabase");
  process.env.NEXT_PUBLIC_SUPABASE_URL = apiUrl;
  process.env.SUPABASE_SECRET_KEY = secretKey;

  ({ dispatchAlerts } = await import("@/lib/push"));
  db = await connectDb();
  await resetTestData(db);
});

afterAll(async () => {
  await db.end();
});

beforeEach(() => {
  vi.restoreAllMocks();
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
  const envelope = data as unknown as {
    result: { ticket: { id: string; number: number } };
  };
  return { ...envelope.result.ticket, deviceId };
}

async function subscribe(
  ticket: { id: string; deviceId: string },
  endpoint: string,
  lang = "en",
) {
  const { error } = await serviceClient().rpc("save_push_subscription", {
    p_ticket_id: ticket.id,
    p_device_id: ticket.deviceId,
    p_endpoint: endpoint,
    p_p256dh: `p256dh-${endpoint}`,
    p_auth: `auth-${endpoint}`,
    p_lang: lang,
  });
  if (error) throw new Error(error.message);
}

/** The endpoints still subscribed for one Shop; the database is shared across tests. */
async function endpoints(shopId: string) {
  const { rows } = await db.query(
    `select s.endpoint from public.push_subscriptions s
     join public.tickets t on t.id = s.ticket_id
     where t.shop_id = $1 order by s.endpoint`,
    [shopId],
  );
  return (rows as { endpoint: string }[]).map((row) => row.endpoint);
}

/** A sender that always delivers, remembering everything it was handed. */
function recordingSender() {
  return vi.fn(
    (
      _subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
      _payload: string,
      _options: { TTL: number; urgency?: string },
    ) => Promise.resolve(),
  );
}

describe("dispatchAlerts", () => {
  test("sends each alerted Ticket's subscriptions the payload, TTL and urgency", async () => {
    const { shop } = await createShop();
    const called = await join(shop.slug);
    const next = await join(shop.slug);
    await subscribe(called, "https://push.test/called", "ms");
    await subscribe(next, "https://push.test/next", "en");

    const send = recordingSender();
    await dispatchAlerts(
      [
        { ticketId: called.id, kind: "called" },
        { ticketId: next.id, kind: "heads_up" },
      ],
      send,
    );

    expect(send).toHaveBeenCalledTimes(2);
    const byEndpoint = new Map(
      send.mock.calls.map(([subscription, payload, options]) => [
        subscription.endpoint,
        { subscription, payload: JSON.parse(payload), options },
      ]),
    );

    const calledPush = byEndpoint.get("https://push.test/called");
    expect(calledPush?.subscription.keys).toEqual({
      p256dh: "p256dh-https://push.test/called",
      auth: "auth-https://push.test/called",
    });
    expect(calledPush?.payload).toEqual({
      kind: "called",
      shopName: shop.name,
      number: called.number,
      url: `/s/${shop.slug}`,
      lang: "ms",
    });
    expect(calledPush?.options).toEqual({ TTL: 600, urgency: "high" });

    const headsUpPush = byEndpoint.get("https://push.test/next");
    expect(headsUpPush?.payload).toMatchObject({
      kind: "heads_up",
      number: next.number,
      lang: "en",
    });
    expect(headsUpPush?.options).toEqual({ TTL: 600, urgency: undefined });
  });

  test("the slower kinds keep for an hour", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);
    await subscribe(ticket, "https://push.test/slow");

    const send = recordingSender();
    await dispatchAlerts([{ ticketId: ticket.id, kind: "last_call" }], send);
    await dispatchAlerts([{ ticketId: ticket.id, kind: "shop_closed" }], send);

    expect(send.mock.calls.map(([, , options]) => options)).toEqual([
      { TTL: 3600, urgency: undefined },
      { TTL: 3600, urgency: undefined },
    ]);
  });

  test("deletes a subscription the push service says is gone", async () => {
    const { shop } = await createShop();
    const gone = await join(shop.slug);
    const alive = await join(shop.slug);
    await subscribe(gone, "https://push.test/gone");
    await subscribe(alive, "https://push.test/alive");
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});

    await dispatchAlerts(
      [
        { ticketId: gone.id, kind: "heads_up" },
        { ticketId: alive.id, kind: "heads_up" },
      ],
      (subscription) =>
        subscription.endpoint === "https://push.test/gone"
          ? Promise.reject({ statusCode: 410 })
          : Promise.resolve(),
    );

    expect(await endpoints(shop.id)).toEqual(["https://push.test/alive"]);
    // A gone subscription is expected wear, not a failure worth reporting.
    expect(reported).not.toHaveBeenCalled();
  });

  test("a 404 is gone too", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);
    await subscribe(ticket, "https://push.test/not-found");

    await dispatchAlerts([{ ticketId: ticket.id, kind: "heads_up" }], () =>
      Promise.reject({ statusCode: 404 }),
    );

    expect(await endpoints(shop.id)).toEqual([]);
  });

  test("any other failure keeps the subscription and is reported", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);
    await subscribe(ticket, "https://push.test/flaky");
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});

    await dispatchAlerts([{ ticketId: ticket.id, kind: "called" }], () =>
      Promise.reject({ statusCode: 500, message: "push service down" }),
    );

    expect(await endpoints(shop.id)).toEqual(["https://push.test/flaky"]);
    expect(reported).toHaveBeenCalled();
  });

  test("shop_closed is a goodbye: the Ticket's subscriptions go once it is sent", async () => {
    const { shop } = await createShop();
    const removed = await join(shop.slug);
    const staying = await join(shop.slug);
    await subscribe(removed, "https://push.test/removed");
    await subscribe(staying, "https://push.test/staying");

    const send = recordingSender();
    await dispatchAlerts([{ ticketId: removed.id, kind: "shop_closed" }], send);

    // Told first, deleted after: close_shop leaves the subscriptions in place
    // precisely so this send can happen.
    expect(send).toHaveBeenCalledTimes(1);
    expect(await endpoints(shop.id)).toEqual(["https://push.test/staying"]);
  });

  test("an alerted Ticket with no subscriptions sends nothing", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);

    const send = recordingSender();
    await dispatchAlerts([{ ticketId: ticket.id, kind: "called" }], send);

    expect(send).not.toHaveBeenCalled();
  });
});
