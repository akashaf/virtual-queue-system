import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isJoinError,
  toCustomerView,
  type CustomerView,
  type JoinError,
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
  | { ok: false; reason: JoinError | "failed" };

/**
 * Creates the Customer's Ticket, or says why not.
 *
 * Every rule lives in `join_queue`, including the Join Radius: the coordinates
 * here are a claim by the browser, and checking them anywhere but inside the
 * locked transaction would let two Customers take the same last place.
 */
export async function createTicket(
  request: CreateTicketRequest,
): Promise<CreateTicketOutcome> {
  const { data, error } = await createAdminClient().rpc("join_queue", {
    p_slug: request.slug,
    p_device_id: request.deviceId,
    p_name: request.name,
    p_lat: request.lat,
    p_lng: request.lng,
    p_accuracy_m: request.accuracyM,
  });

  if (error) {
    if (isJoinError(error.message)) return { ok: false, reason: error.message };
    console.error("join_queue failed", error);
    return { ok: false, reason: "failed" };
  }

  // `join_queue` returns jsonb, which the generated types can only call `Json`;
  // the shape is pinned by the `{ result, alerts }` contract in backend.md §5.
  const { result } = data as unknown as { result: unknown };
  return { ok: true, view: toCustomerView(result) };
}
