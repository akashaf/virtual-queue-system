import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type JoiningState = Database["public"]["Enums"]["joining_state"];

export interface WaitingTicket {
  id: string;
  number: number;
  /** Null only after personal data has been erased, 30 days on. */
  name: string | null;
  joinedAt: string;
}

export interface CalledTicket {
  id: string;
  number: number;
  name: string | null;
  calledAt: string;
}

/** The Owner's live Queue: who is waiting, and who is in a chair. */
export interface OwnerQueue {
  shop: { id: string; name: string; joiningState: JoiningState };
  waiting: WaitingTicket[];
  called: CalledTicket[];
}

interface OwnerQueueJson {
  shop: { id: string; name: string; joining_state: JoiningState };
  waiting: { id: string; number: number; name: string | null; joined_at: string }[];
  called: { id: string; number: number; name: string | null; called_at: string }[];
}

export function toOwnerQueue(json: unknown): OwnerQueue {
  const { shop, waiting, called } = json as OwnerQueueJson;

  return {
    shop: { id: shop.id, name: shop.name, joiningState: shop.joining_state },
    waiting: waiting.map((ticket) => ({
      id: ticket.id,
      number: ticket.number,
      name: ticket.name,
      joinedAt: ticket.joined_at,
    })),
    called: called.map((ticket) => ({
      id: ticket.id,
      number: ticket.number,
      name: ticket.name,
      calledAt: ticket.called_at,
    })),
  };
}

/** What `get_owner_queue` raises when the caller runs no active Shop. */
const NO_ACTIVE_SHOP = "shop_inactive";

/**
 * Reads the Queue with the Owner's own JWT, so `get_owner_queue` finds the Shop
 * from `auth.uid()` rather than from anything the request could claim.
 *
 * Null means the caller has no active Shop, which is a state rather than a
 * failure: a Shop can be deactivated mid-session, and a layout and its page
 * render concurrently, so this one cannot lean on the layout's redirect having
 * happened first.
 */
export async function fetchOwnerQueue(): Promise<OwnerQueue | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_owner_queue");

  if (error) {
    if (error.message === NO_ACTIVE_SHOP) return null;
    throw new Error(`get_owner_queue failed: ${error.message}`);
  }

  return toOwnerQueue(data);
}
