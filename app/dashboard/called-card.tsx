import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CalledTicket } from "@/lib/owner/view";
import { formatCountdown, formatMinutesAgo } from "@/lib/time";
import { formatTicketNumber } from "@/lib/ticket";
import { MoveForm, type Move, type OwnerAction } from "./move-form";
import { TicketMenu } from "./ticket-menu";

/**
 * A Customer in a chair, outlined in the Called status colour so it stands
 * apart from the Waiting list below. Done is the filled button, No-show the
 * outlined narrow one, and Remove sits in the menu in orange-red: three presses that
 * should never be mistaken for one another.
 */
export function CalledCard({
  ticket,
  elapsedMs,
  move,
  serve,
  noShow,
  remove,
}: {
  ticket: CalledTicket;
  elapsedMs: number;
  move: Move;
  serve: OwnerAction;
  noShow: OwnerAction;
  remove: OwnerAction;
}) {
  // The Customer may still be walking over, so the button waits with them.
  const noShowInMs = ticket.noShowInMs - elapsedMs;
  const tooEarly = noShowInMs > 0;

  return (
    <li>
      <Card className="gap-4 border-2 border-status-called py-4">
        <CardContent className="flex items-center gap-3 px-4">
          <Badge variant="called" className="px-3 py-1 text-lg font-semibold tabular-nums">
            {formatTicketNumber(ticket.number)}
          </Badge>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="min-w-0 font-medium break-words">{ticket.name}</span>
            {/* The browser's own clock, which may differ from the shop's. */}
            <span className="text-sm text-muted-foreground" suppressHydrationWarning>
              called {formatMinutesAgo(ticket.calledAt, new Date())}
            </span>
          </span>
          <TicketMenu ticket={ticket} move={move} remove={remove} />
        </CardContent>

        {/* No-show is final and Done is not, so they are not a matching pair:
            Done takes the width, No-show stays narrow and a full gap away. */}
        <CardContent className="flex items-center gap-4 px-4">
          <MoveForm
            className="flex-1"
            move={move}
            intent={{ kind: "mark_served", ticketId: ticket.id }}
            action={serve}
          >
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={serve.pending}
              aria-label={`Done for ${formatTicketNumber(ticket.number)}`}
            >
              Done
            </Button>
          </MoveForm>

          <MoveForm
            className="shrink-0"
            move={move}
            intent={{ kind: "mark_no_show", ticketId: ticket.id }}
            action={noShow}
          >
            <Button
              type="submit"
              variant="outline"
              className="h-11 min-w-30 px-3 tabular-nums"
              disabled={noShow.pending || tooEarly}
            >
              {tooEarly ? `No-show ${formatCountdown(noShowInMs)}` : "No-show"}
              {/* Kept out of aria-label so a screen reader still hears the countdown. */}
              <span className="sr-only">for {formatTicketNumber(ticket.number)}</span>
            </Button>
          </MoveForm>
        </CardContent>
      </Card>
    </li>
  );
}
