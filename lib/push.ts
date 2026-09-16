import "server-only";
import { after } from "next/server";
import webPush from "web-push";
import { requireEnv } from "@/lib/env";
import { reportUnexpected } from "@/lib/error-reporting";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Web Push dispatch (backend.md §7): what happens to the `alerts` half of the
 * `{ result, alerts }` envelope after the mutation that earned them. Every
 * mutating Server Action hands them here from inside `after()`, so no Customer
 * waits on a push service before seeing their own press land.
 */

export type AlertKind = "heads_up" | "called" | "last_call" | "shop_closed";

/** One Ticket owed one notification, as a mutation returned it. */
export interface QueueAlert {
  ticketId: string;
  kind: AlertKind;
}

/**
 * What a mutation hands back to its Server Action: the caller's own outcome,
 * and the alerts other Customers are owed. Kept apart so the outcome can go to
 * the browser while the alerts never do — they name other people's Tickets.
 */
export interface Mutated<T> {
  outcome: T;
  alerts: QueueAlert[];
}

/** Parses a function's `alerts`, pinned to `[{ ticket_id, kind }]` by backend.md §5. */
export function toQueueAlerts(json: unknown): QueueAlert[] {
  const alerts = json as { ticket_id: string; kind: AlertKind }[];
  return alerts.map((alert) => ({ ticketId: alert.ticket_id, kind: alert.kind }));
}

/**
 * Sends the mutation's alerts once the caller has their answer (backend.md §7):
 * `after()` runs when the response is done, so nobody waits on a push service.
 * The alerts never reach the browser — they name other people's Tickets —
 * which is why they are peeled off here rather than returned. Server Actions
 * only, because `after` needs a request to run behind.
 */
export function dispatched<T>({ outcome, alerts }: Mutated<T>): T {
  after(() => dispatchAlerts(alerts));
  return outcome;
}

/**
 * Sends one notification, resolving on delivery to the push service. Injectable
 * so the tests exercise everything around the network call without one.
 */
export type PushSender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { TTL: number; urgency?: "high" },
) => Promise<unknown>;

/**
 * How long a push service holds an undelivered notification. "Almost your turn"
 * and "your turn" are stale news within minutes; the closing-time kinds are
 * still worth reading within the hour.
 */
const URGENT_TTL_SECONDS = 600;
const SLOW_TTL_SECONDS = 3_600;

/**
 * Sends `alerts` to every subscription of every alerted Ticket, in parallel: a
 * Netlify function has a short execution limit, and each send is a slow HTTP
 * round trip to somebody's push service.
 *
 * A 404 or 410 answer means the browser is gone for good — the app was
 * uninstalled, or the permission revoked — so the subscription is deleted
 * rather than reported. Anything else goes to Sentry.
 */
export async function dispatchAlerts(
  alerts: QueueAlert[],
  send: PushSender = sendWebPush,
): Promise<void> {
  if (alerts.length === 0) return;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    // supabase-js parses this literal at the type level, so it has to stay one
    // string — splitting it with `+` widens it to `string` and every row
    // property becomes GenericStringError (docs/agents/gotchas.md).
    .select(
      "id, ticket_id, endpoint, p256dh, auth, lang, ticket:tickets!inner(number, shop:shops!inner(name, slug))",
    )
    .in(
      "ticket_id",
      alerts.map((alert) => alert.ticketId),
    );

  if (error) {
    reportUnexpected("loading push subscriptions", error);
    return;
  }

  // A shop_closed alert is the last thing its Ticket can ever be told, so its
  // subscriptions are deleted here once it has been sent — close_shop cannot do
  // it, because this very dispatch still needs them (backend.md §3).
  const closedTicketIds = alerts
    .filter((alert) => alert.kind === "shop_closed")
    .map((alert) => alert.ticketId);

  const gone: string[] = [];
  await Promise.all(
    alerts.flatMap((alert) =>
      data
        .filter((subscription) => subscription.ticket_id === alert.ticketId)
        .map(async (subscription) => {
          const urgent = alert.kind === "called" || alert.kind === "heads_up";
          const payload = JSON.stringify({
            kind: alert.kind,
            shopName: subscription.ticket.shop.name,
            number: subscription.ticket.number,
            url: `/s/${subscription.ticket.shop.slug}`,
            lang: subscription.lang,
          });

          try {
            await send(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              payload,
              {
                TTL: urgent ? URGENT_TTL_SECONDS : SLOW_TTL_SECONDS,
                urgency: alert.kind === "called" ? "high" : undefined,
              },
            );
          } catch (cause) {
            const statusCode = (cause as { statusCode?: unknown } | null)?.statusCode;
            if (statusCode === 404 || statusCode === 410) gone.push(subscription.id);
            else reportUnexpected("push send failed", cause);
          }
        }),
    ),
  );

  if (gone.length > 0) {
    const deleted = await supabase.from("push_subscriptions").delete().in("id", gone);
    if (deleted.error) {
      reportUnexpected("deleting gone push subscriptions", deleted.error);
    }
  }

  if (closedTicketIds.length > 0) {
    const deleted = await supabase
      .from("push_subscriptions")
      .delete()
      .in("ticket_id", closedTicketIds);
    if (deleted.error) {
      reportUnexpected("deleting closed tickets' push subscriptions", deleted.error);
    }
  }
}

function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { TTL: number; urgency?: "high" },
): Promise<unknown> {
  return webPush.sendNotification(subscription, payload, {
    TTL: options.TTL,
    urgency: options.urgency,
    // Per call rather than webPush.setVapidDetails, which is module-global
    // state that an import would set for every caller.
    vapidDetails: {
      subject: requireEnv("VAPID_SUBJECT", process.env.VAPID_SUBJECT),
      publicKey: requireEnv(
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      ),
      privateKey: requireEnv("VAPID_PRIVATE_KEY", process.env.VAPID_PRIVATE_KEY),
    },
  });
}
