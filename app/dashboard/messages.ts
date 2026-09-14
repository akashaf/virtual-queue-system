// Kept out of actions.ts on purpose: a "use server" file may only export async
// functions, and adding one `const` there breaks every action in the file.

import type { OwnerError } from "@/lib/owner/view";

/**
 * What the Owner is told when a function refuses. The dashboard is English-only
 * (frontend.md §1), so these need no dictionary.
 */
export function ownerErrorMessage(reason: OwnerError | "failed"): string {
  switch (reason) {
    case "queue_empty":
      return "Nobody waiting";
    case "ticket_not_found":
      // One message for "already done", "already removed" and "not your shop":
      // all three mean the screen is behind, and the refetch will catch it up.
      return "That ticket is no longer in the queue";
    case "undo_expired":
      return "Too late to undo that";
    case "shop_inactive":
      return "This shop account is inactive, contact support";
    case "failed":
      return "Something went wrong. Please try again.";
  }
}
