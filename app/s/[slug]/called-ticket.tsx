import { Button } from "@/components/ui/button";
import type { CustomerView } from "@/lib/customer/view";
import type { Dictionary } from "@/lib/i18n";
import { formatTicketNumber } from "@/lib/ticket";
import { LeaveButton } from "./leave-button";

export function Called({
  ticket,
  dict,
  ringing,
  onAcknowledge,
  onLeave,
}: {
  ticket: NonNullable<CustomerView["ticket"]>;
  dict: Dictionary;
  /** The chime is repeating; "I'm coming" is what stops it. */
  ringing: boolean;
  onAcknowledge: () => void;
  onLeave: () => void;
}) {
  return (
    // Over the whole screen in the Called status colour, nothing like the
    // Waiting card: this is the one state a Customer has to notice from across
    // the room (frontend.md §5).
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-status-called p-4 text-center text-status-called-foreground"
    >
      <p className="text-3xl font-semibold tracking-tight">{dict.yourTurn}</p>
      {/* As large as a four-digit #1000 allows at 360px. */}
      <p className="text-8xl leading-none font-bold tracking-tight tabular-nums">
        {formatTicketNumber(ticket.number)}
      </p>
      <p className="text-2xl font-medium">{dict.goToCounter}</p>
      {ringing ? (
        <Button
          type="button"
          size="lg"
          className="mt-6 h-14 w-full max-w-xs text-lg"
          onClick={onAcknowledge}
        >
          {dict.imComing}
        </Button>
      ) : null}
      <LeaveButton
        dict={dict}
        onLeave={onLeave}
        className="mt-6 w-full max-w-xs border-status-called-foreground/40 bg-transparent text-status-called-foreground"
      />
    </div>
  );
}
