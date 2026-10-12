import type { ReactNode } from "react";
import type { QueueMove } from "@/lib/owner/view";

/** Moves the screen before the round trip; the refetch replaces it with the truth. */
export type Move = (intent: QueueMove) => void;

/** What one kind of press needs from the screen: somewhere to go, and whether it is busy. */
export interface OwnerAction {
  submit: (formData: FormData) => void;
  pending: boolean;
}

/**
 * One press: the screen moves, then the Server Action goes. Every button here
 * has the same shape, and the Ticket it names comes from the move itself rather
 * than being passed alongside it and able to disagree.
 */
export function MoveForm({
  move,
  intent,
  action,
  className,
  children,
}: {
  move: Move;
  intent: QueueMove;
  action: OwnerAction;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      className={className}
      action={(formData) => {
        move(intent);
        action.submit(formData);
      }}
    >
      {"ticketId" in intent ? (
        <input type="hidden" name="ticketId" value={intent.ticketId} />
      ) : null}
      {children}
    </form>
  );
}
