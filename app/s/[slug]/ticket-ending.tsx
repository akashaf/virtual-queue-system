import { CircleCheck, CircleSlash, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CustomerView } from "@/lib/customer/view";
import type { Dictionary } from "@/lib/i18n";

/**
 * What became of a Ticket that has ended, kept on screen until the Customer taps
 * past it.
 *
 * Served has a way on for the same reason the others do. The server now answers
 * with a finished Ticket for the rest of the Queue Day, so without one a
 * Customer who has had their haircut could not queue again that day — for their
 * child, or for a second cut — however long they waited.
 */
export function Ended({
  ticket,
  dict,
  onRejoin,
  onDismiss,
}: {
  ticket: NonNullable<CustomerView["ticket"]>;
  dict: Dictionary;
  onRejoin: () => void;
  onDismiss: () => void;
}) {
  switch (ticket.status) {
    case "served":
      return (
        <Ending
          served
          title={dict.servedThanks}
          action={dict.joinButton}
          onAction={onDismiss}
        />
      );

    case "no_show":
      return ticket.canRejoin ? (
        <Ending
          title={dict.noShowTitle}
          action={dict.joinAgain}
          onAction={onRejoin}
        />
      ) : (
        // Still a way on, even though the offer has gone. The server keeps
        // answering with this Ticket all day, so without one the Customer would
        // scan the QR code as told and land straight back on this screen.
        <Ending
          title={dict.noShowTitle}
          detail={dict.scanToJoinAgain}
          action={dict.joinButton}
          onAction={onDismiss}
        />
      );

    case "left":
      return (
        <Ending
          title={dict.leftTitle}
          action={dict.joinButton}
          onAction={onDismiss}
        />
      );

    case "removed":
      return (
        <Ending
          // The shop closing for the day is not the Owner turning someone away,
          // and reads differently: come back tomorrow, not "you were removed".
          title={
            ticket.removedReason === "close_shop"
              ? dict.shopClosedTitle
              : dict.removedTitle
          }
          action={dict.joinButton}
          onAction={onDismiss}
        />
      );

    // Waiting and Called are not endings, and never reach here.
    default:
      return null;
  }
}

/** Served in its own status colour; No-show, Left and Removed share the ended one. */
function Ending({
  served = false,
  title,
  detail,
  action,
  onAction,
}: {
  served?: boolean;
  title: string;
  detail?: string;
  action: string;
  onAction: () => void;
}) {
  const Icon: LucideIcon = served ? CircleCheck : CircleSlash;

  return (
    <Card className="my-auto">
      <CardContent className="flex flex-col items-center gap-4 text-center">
        <Icon
          aria-hidden
          className={served ? "size-14 text-status-served" : "size-14 text-muted-foreground"}
        />
        <p role="status" aria-live="polite" className="text-2xl font-semibold tracking-tight">
          {title}
        </p>
        {detail ? <p className="text-muted-foreground">{detail}</p> : null}
        <Button type="button" size="lg" className="h-12 w-full text-base" onClick={onAction}>
          {action}
        </Button>
      </CardContent>
    </Card>
  );
}
