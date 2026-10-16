import "server-only";
import { after } from "next/server";
import { appBaseUrl, requireEnv } from "@/lib/env";
import { reportUnexpected } from "@/lib/error-reporting";
import { dictionaries, format, type Dictionary, type Lang } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatTicketNumber } from "@/lib/ticket";

/**
 * Web Push dispatch through OneSignal (backend.md §7, ADR 0005): what happens
 * to the `alerts` half of the `{ result, alerts }` envelope after the mutation
 * that earned them. Every
 * mutating Server Action hands them here from inside `after()`, so no Customer
 * waits on OneSignal before seeing their own press land.
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
 * `after()` runs when the response is done, so nobody waits on OneSignal.
 * The alerts never reach the browser — they name other people's Tickets —
 * which is why they are peeled off here rather than returned. Server Actions
 * only, because `after` needs a request to run behind.
 */
export function dispatched<T>({ outcome, alerts }: Mutated<T>): T {
  after(() => dispatchAlerts(alerts));
  return outcome;
}

/**
 * One notification as OneSignal's Create Notification API takes it
 * (`POST /notifications`), addressed to a single Ticket by its External ID.
 */
export interface OneSignalNotification {
  app_id: string;
  include_aliases: { external_id: string[] };
  target_channel: "push";
  headings: Record<Lang, string>;
  contents: Record<Lang, string>;
  url: string;
  ttl: number;
  priority: 10 | 5;
  web_push_topic: AlertKind;
}

/** What OneSignal made of one notification. */
export type SendResult =
  | { outcome: "sent"; notificationId: string }
  | { outcome: "no_subscriber" };

/**
 * Hands one notification to OneSignal. Injectable so the tests exercise
 * everything around the network call without one; throwing means OneSignal
 * refused it or could not be reached.
 */
export type PushSender = (notification: OneSignalNotification) => Promise<SendResult>;

/**
 * How long OneSignal and the push service hold an undelivered notification.
 * "Almost your turn" and "your turn" are stale news within minutes; the
 * closing-time kinds are still worth reading within the hour.
 */
const URGENT_TTL_SECONDS = 600;
const SLOW_TTL_SECONDS = 3_600;

const TEXT_KEYS = {
  heads_up: "pushHeadsUp",
  called: "pushCalled",
  last_call: "pushLastCall",
  shop_closed: "pushShopClosed",
} as const satisfies Record<AlertKind, keyof Dictionary>;

/**
 * Sends `alerts` through OneSignal, one notification per alerted Ticket, in
 * parallel: a Netlify function has a short execution limit, and each send is
 * an HTTP round trip.
 *
 * Every attempt is written to `push_sends`, including the Tickets OneSignal
 * has no subscription for, which used to vanish without a trace
 * (docs/agents/gotchas.md). Errors also go to Sentry.
 *
 * OneSignal picks the text in the language the page set for the subscriber
 * (`OneSignal.User.setLanguage`), so both are always sent.
 */
export async function dispatchAlerts(
  alerts: QueueAlert[],
  send: PushSender = sendToOneSignal,
): Promise<void> {
  if (alerts.length === 0) return;

  const supabase = createAdminClient();
  const { data: tickets, error } = await supabase
    .from("tickets")
    .select("id, number, shop:shops!inner(name, slug)")
    .in(
      "id",
      alerts.map((alert) => alert.ticketId),
    );

  if (error) {
    reportUnexpected("loading alerted tickets", error);
    return;
  }

  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const appId = requireEnv(
    "NEXT_PUBLIC_ONESIGNAL_APP_ID",
    process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID,
  );
  const baseUrl = appBaseUrl();

  const rows = await Promise.all(
    alerts.flatMap((alert) => {
      const ticket = byId.get(alert.ticketId);
      if (!ticket) return [];

      const number = formatTicketNumber(ticket.number);
      const text = (lang: Lang) =>
        format(dictionaries[lang][TEXT_KEYS[alert.kind]], { number });
      const urgent = alert.kind === "called" || alert.kind === "heads_up";

      const notification: OneSignalNotification = {
        app_id: appId,
        include_aliases: { external_id: [ticket.id] },
        target_channel: "push",
        headings: { en: ticket.shop.name, ms: ticket.shop.name },
        contents: { en: text("en"), ms: text("ms") },
        url: `${baseUrl}/s/${ticket.shop.slug}`,
        ttl: urgent ? URGENT_TTL_SECONDS : SLOW_TTL_SECONDS,
        priority: alert.kind === "called" ? 10 : 5,
        // A newer alert of the same kind replaces the older one, as `tag` did.
        web_push_topic: alert.kind,
      };

      return [
        send(notification).then(
          (result) => ({
            ticket_id: ticket.id,
            kind: alert.kind,
            outcome: result.outcome,
            notification_id: result.outcome === "sent" ? result.notificationId : null,
          }),
          (cause: unknown) => {
            reportUnexpected("push send failed", cause);
            return {
              ticket_id: ticket.id,
              kind: alert.kind,
              outcome: "error" as const,
              notification_id: null,
            };
          },
        ),
      ];
    }),
  );

  if (rows.length === 0) return;
  const logged = await supabase.from("push_sends").insert(rows);
  if (logged.error) reportUnexpected("logging push sends", logged.error);
}

/** The error OneSignal answered with, carrying its status but no body: no names. */
export class OneSignalError extends Error {
  constructor(readonly status: number) {
    super(`OneSignal answered ${status}`);
    this.name = "OneSignalError";
  }
}

async function sendToOneSignal(notification: OneSignalNotification): Promise<SendResult> {
  const response = await fetch("https://api.onesignal.com/notifications?c=push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${requireEnv(
        "ONESIGNAL_REST_API_KEY",
        process.env.ONESIGNAL_REST_API_KEY,
      )}`,
    },
    body: JSON.stringify(notification),
  });
  if (!response.ok) throw new OneSignalError(response.status);

  return parseOneSignalAnswer(await response.json());
}

/**
 * Reads a 200 from OneSignal. An empty `id` means nobody was subscribed under
 * that External ID — the Customer declined, or has not finished the sheet; a
 * non-empty one means it went to at least one subscription.
 */
export function parseOneSignalAnswer(body: unknown): SendResult {
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === "string" && id !== ""
    ? { outcome: "sent", notificationId: id }
    : { outcome: "no_subscriber" };
}

/**
 * Deletes one Ticket's user in OneSignal, subscriptions and all. "not_found" is
 * the usual answer: only a Customer who allowed alerts ever had a user there.
 * Injectable for the same reason `PushSender` is.
 */
export type OneSignalUserRemover = (ticketId: string) => Promise<"deleted" | "not_found">;

/** How many deletes run at once: enough to finish quickly, few enough not to be rate limited. */
const DELETE_CONCURRENCY = 10;

/**
 * PDPA (backend.md §9): once a Ticket's personal data is erased, the phone's
 * subscription OneSignal keeps under that Ticket id goes too. Failures are
 * reported and not retried, since the erasure that named the Ticket will not
 * name it again. Resolves to how many users were actually deleted.
 */
export async function forgetTicketsInOneSignal(
  ticketIds: string[],
  remove: OneSignalUserRemover = deleteOneSignalUser,
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < ticketIds.length; i += DELETE_CONCURRENCY) {
    const batch = ticketIds.slice(i, i + DELETE_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((ticketId) =>
        remove(ticketId).catch((cause: unknown) => {
          reportUnexpected("OneSignal user delete failed", cause);
          return "failed" as const;
        }),
      ),
    );
    deleted += outcomes.filter((outcome) => outcome === "deleted").length;
  }
  return deleted;
}

async function deleteOneSignalUser(ticketId: string): Promise<"deleted" | "not_found"> {
  const appId = requireEnv(
    "NEXT_PUBLIC_ONESIGNAL_APP_ID",
    process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID,
  );
  const response = await fetch(
    `https://api.onesignal.com/apps/${appId}/users/by/external_id/${encodeURIComponent(ticketId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Key ${requireEnv(
          "ONESIGNAL_REST_API_KEY",
          process.env.ONESIGNAL_REST_API_KEY,
        )}`,
      },
    },
  );
  if (response.status === 404) return "not_found";
  if (!response.ok) throw new OneSignalError(response.status);
  return "deleted";
}
