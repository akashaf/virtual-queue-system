import "server-only";
import { functionErrorReason } from "@/lib/error-reporting";
import type { Lang } from "@/lib/i18n";
import { toQueueAlerts, type Mutated } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CUSTOMER_ERRORS,
  toCustomerView,
  type CustomerView,
  type CustomerError,
} from "./view";

/**
 * Customer traffic reaches Postgres through the secret-key client, never the
 * browser's: a Customer has no session, and the device cookie the server has
 * already read is the whole of their claim (backend.md §3).
 */

/** The Customer page's view of a Shop, or null when the slug belongs to no Shop. */
export async function fetchCustomerView(
  slug: string,
  deviceId: string | null,
): Promise<CustomerView | null> {
  const { data, error } = await createAdminClient().rpc("get_customer_view", {
    p_slug: slug,
    p_device_id: deviceId ?? undefined,
  });

  if (error) throw new Error(`get_customer_view failed: ${error.message}`);

  return data === null ? null : toCustomerView(data);
}

export interface CreateTicketRequest {
  slug: string;
  deviceId: string;
  name: string;
  lat: number;
  lng: number;
  accuracyM: number;
}

export type CreateTicketOutcome =
  | { ok: true; view: CustomerView }
  | { ok: false; reason: CustomerError | "failed" };

/**
 * Creates the Customer's Ticket, or says why not.
 *
 * Every rule lives in `join_queue`, including the Join Radius: the coordinates
 * here are a claim by the browser, and checking them anywhere but inside the
 * locked transaction would let two Customers take the same last place.
 */
export async function createTicket(
  request: CreateTicketRequest,
): Promise<Mutated<CreateTicketOutcome>> {
  const { data, error } = await createAdminClient().rpc("join_queue", {
    p_slug: request.slug,
    p_device_id: request.deviceId,
    p_name: request.name,
    p_lat: request.lat,
    p_lng: request.lng,
    p_accuracy_m: request.accuracyM,
  });

  if (error) {
    return {
      outcome: { ok: false, reason: functionErrorReason("join_queue", error, CUSTOMER_ERRORS) },
      alerts: [],
    };
  }

  // `join_queue` returns jsonb, which the generated types can only call `Json`;
  // the shape is pinned by the `{ result, alerts }` contract in backend.md §5.
  const { result, alerts } = data as unknown as { result: unknown; alerts: unknown };
  return {
    outcome: { ok: true, view: toCustomerView(result) },
    alerts: toQueueAlerts(alerts),
  };
}

export type TicketOutcome =
  | { ok: true; view: CustomerView }
  | { ok: false; reason: CustomerError | "failed" };

/**
 * The Customer gives up their place, from the Queue or from the chair.
 *
 * The device id is the whole of their claim, so it goes to the function rather
 * than being checked here: a Ticket another device holds is not this one's to
 * find, and says so with the same token as a Ticket that has already ended.
 */
export async function leaveTicket(
  ticketId: string,
  deviceId: string,
): Promise<Mutated<TicketOutcome>> {
  return customerCall("leave_queue", { p_ticket_id: ticketId, p_device_id: deviceId });
}

/**
 * A Customer who missed their turn takes a new place at the back.
 *
 * No coordinates: ADR 0002's exemption lives in `rejoin_queue`, which keeps it
 * narrow by only ever accepting a No-show from a scan in the current Queue Day.
 */
export async function rejoinTicket(
  ticketId: string,
  deviceId: string,
): Promise<Mutated<TicketOutcome>> {
  return customerCall("rejoin_queue", { p_ticket_id: ticketId, p_device_id: deviceId });
}

/**
 * Stores the browser's push subscription against the Customer's Ticket. The
 * device id is the whole of their claim, checked inside the function as ever:
 * a Ticket another device holds gets the same answer as one that has ended.
 */
export async function savePushSubscriptionForTicket(subscription: {
  ticketId: string;
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lang: Lang;
}): Promise<{ ok: boolean }> {
  const { error } = await createAdminClient().rpc("save_push_subscription", {
    p_ticket_id: subscription.ticketId,
    p_device_id: subscription.deviceId,
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.p256dh,
    p_auth: subscription.auth,
    p_lang: subscription.lang,
  });

  if (error) {
    // ticket_not_found is a situation — a stale page, someone else's Ticket —
    // and the page has nothing to say about it beyond falling back to sound;
    // anything else is a bug, which functionErrorReason reports.
    functionErrorReason("save_push_subscription", error, CUSTOMER_ERRORS);
    return { ok: false };
  }

  return { ok: true };
}

async function customerCall(
  fn: "leave_queue" | "rejoin_queue",
  args: { p_ticket_id: string; p_device_id: string },
): Promise<Mutated<TicketOutcome>> {
  const { data, error } = await createAdminClient().rpc(fn, args);

  if (error) {
    return {
      outcome: { ok: false, reason: functionErrorReason(fn, error, CUSTOMER_ERRORS) },
      alerts: [],
    };
  }

  const { result, alerts } = data as unknown as { result: unknown; alerts: unknown };
  return {
    outcome: { ok: true, view: toCustomerView(result) },
    alerts: toQueueAlerts(alerts),
  };
}
