import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Client } from "pg";
import { inject } from "vitest";
import type { OneSignalNotification, SendResult } from "@/lib/push";
import { formatTicketNumber } from "@/lib/ticket";
import {
  connectDb,
  createShop,
  metresNorthOf,
  resetTestData,
  serviceClient,
  SHOP_LNG,
} from "./helpers";

const APP_ID = "00000000-0000-4000-8000-000000000000";
const APP_BASE_URL = "https://virtual-queue-system.netlify.app";

let db: Client;
let dispatchAlerts: typeof import("@/lib/push").dispatchAlerts;
let parseOneSignalAnswer: typeof import("@/lib/push").parseOneSignalAnswer;
let OneSignalError: typeof import("@/lib/push").OneSignalError;
let forgetTicketsInOneSignal: typeof import("@/lib/push").forgetTicketsInOneSignal;

beforeAll(async () => {
  const { apiUrl, secretKey } = inject("supabase");
  process.env.NEXT_PUBLIC_SUPABASE_URL = apiUrl;
  process.env.SUPABASE_SECRET_KEY = secretKey;

  process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID = APP_ID;
  process.env.APP_BASE_URL = APP_BASE_URL;

  ({ dispatchAlerts, parseOneSignalAnswer, OneSignalError, forgetTicketsInOneSignal } =
    await import("@/lib/push"));
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

/** Everything logged for one Ticket, oldest first. */
async function sends(ticketId: string) {
  const { rows } = await db.query(
    `select kind, outcome, notification_id from public.push_sends
     where ticket_id = $1 order by created_at, kind`,
    [ticketId],
  );
  return rows as { kind: string; outcome: string; notification_id: string | null }[];
}

/** A sender OneSignal accepts everything from, remembering what it was handed. */
function recordingSender() {
  let n = 0;
  return vi.fn((_notification: OneSignalNotification) =>
    Promise.resolve<SendResult>({ outcome: "sent", notificationId: `n-${++n}` }),
  );
}

describe("dispatchAlerts", () => {
  test("sends each alerted Ticket one notification, by its Ticket id, in both languages", async () => {
    const { shop } = await createShop();
    const called = await join(shop.slug);
    const next = await join(shop.slug);

    const send = recordingSender();
    await dispatchAlerts(
      [
        { ticketId: called.id, kind: "called" },
        { ticketId: next.id, kind: "heads_up" },
      ],
      send,
    );

    expect(send).toHaveBeenCalledTimes(2);
    const byTicket = new Map(
      send.mock.calls.map(([notification]) => [
        notification.include_aliases.external_id[0],
        notification,
      ]),
    );

    expect(byTicket.get(called.id)).toEqual({
      app_id: APP_ID,
      include_aliases: { external_id: [called.id] },
      target_channel: "push",
      headings: { en: shop.name, ms: shop.name },
      contents: {
        en: `Queue alert: it's your turn (${formatTicketNumber(called.number)}). Please go to the counter now.`,
        ms: `Makluman giliran: tiba giliran anda (${formatTicketNumber(called.number)}). Sila ke kaunter sekarang.`,
      },
      url: `${APP_BASE_URL}/s/${shop.slug}`,
      ttl: 600,
      priority: 10,
      web_push_topic: "called",
    });
    expect(byTicket.get(next.id)).toMatchObject({
      contents: {
        en: `Queue alert: you're nearly next (${formatTicketNumber(next.number)}). Please head back to the shop now.`,
        ms: `Makluman giliran: giliran anda hampir tiba (${formatTicketNumber(next.number)}). Sila kembali ke kedai sekarang.`,
      },
      ttl: 600,
      priority: 10,
      web_push_topic: "heads_up",
    });
  });

  test("the slower kinds say what happened, keep for an hour, and go at normal priority", async () => {
    const { shop } = await createShop();
    const ticket = await join(shop.slug);

    const send = recordingSender();
    await dispatchAlerts([{ ticketId: ticket.id, kind: "last_call" }], send);
    await dispatchAlerts([{ ticketId: ticket.id, kind: "shop_closed" }], send);

    expect(send.mock.calls.map(([notification]) => notification.ttl)).toEqual([3600, 3600]);
    expect(send.mock.calls.map(([notification]) => notification.priority)).toEqual([5, 5]);
    expect(send.mock.calls.map(([notification]) => notification.contents)).toEqual([
      {
        en: "Queue alert: the shop is closing soon. Open the page to stay in the queue or move to the next day.",
        ms: "Makluman giliran: kedai akan tutup sebentar lagi. Buka halaman untuk kekal dalam giliran atau pindah ke hari esok.",
      },
      {
        en: "Queue alert: the shop has closed for today. Thank you for waiting.",
        ms: "Makluman giliran: kedai telah tutup untuk hari ini. Terima kasih kerana menunggu.",
      },
    ]);
  });

  test("logs every send: sent with OneSignal's id, or no subscriber", async () => {
    const { shop } = await createShop();
    const subscribed = await join(shop.slug);
    const declined = await join(shop.slug);

    await dispatchAlerts(
      [
        { ticketId: subscribed.id, kind: "heads_up" },
        { ticketId: declined.id, kind: "heads_up" },
      ],
      (notification) =>
        Promise.resolve<SendResult>(
          notification.include_aliases.external_id[0] === subscribed.id
            ? { outcome: "sent", notificationId: "onesignal-1" }
            : { outcome: "no_subscriber" },
        ),
    );

    expect(await sends(subscribed.id)).toEqual([
      { kind: "heads_up", outcome: "sent", notification_id: "onesignal-1" },
    ]);
    expect(await sends(declined.id)).toEqual([
      { kind: "heads_up", outcome: "no_subscriber", notification_id: null },
    ]);
  });

  test("a refused send is logged as an error, reported, and does not stop the others", async () => {
    const { shop } = await createShop();
    const failing = await join(shop.slug);
    const fine = await join(shop.slug);
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});

    await dispatchAlerts(
      [
        { ticketId: failing.id, kind: "called" },
        { ticketId: fine.id, kind: "heads_up" },
      ],
      (notification) =>
        notification.include_aliases.external_id[0] === failing.id
          ? Promise.reject(new OneSignalError(503))
          : Promise.resolve<SendResult>({ outcome: "sent", notificationId: "onesignal-2" }),
    );

    expect(await sends(failing.id)).toEqual([
      { kind: "called", outcome: "error", notification_id: null },
    ]);
    expect(await sends(fine.id)).toEqual([
      { kind: "heads_up", outcome: "sent", notification_id: "onesignal-2" },
    ]);
    expect(reported).toHaveBeenCalled();
  });

  test("no alerts, no sends", async () => {
    const send = recordingSender();
    await dispatchAlerts([], send);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("parseOneSignalAnswer", () => {
  test("an id means sent; an empty one means nobody was subscribed", () => {
    expect(parseOneSignalAnswer({ id: "abc", errors: {} })).toEqual({
      outcome: "sent",
      notificationId: "abc",
    });
    expect(
      parseOneSignalAnswer({ id: "", errors: ["All included players are not subscribed"] }),
    ).toEqual({ outcome: "no_subscriber" });
    expect(parseOneSignalAnswer(null)).toEqual({ outcome: "no_subscriber" });
  });
});

describe("forgetTicketsInOneSignal", () => {
  test("asks for every Ticket, counts the deletes, and reports a failure without stopping", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    const ids = Array.from({ length: 25 }, (_, i) => `ticket-${i}`);
    const remove = vi.fn(async (ticketId: string) => {
      if (ticketId === "ticket-3") throw new OneSignalError(429);
      return ticketId.endsWith("0") ? ("deleted" as const) : ("not_found" as const);
    });

    const deleted = await forgetTicketsInOneSignal(ids, remove);

    expect(remove).toHaveBeenCalledTimes(25);
    expect(deleted).toBe(3); // ticket-0, ticket-10, ticket-20
    expect(reported).toHaveBeenCalled();
  });
});
