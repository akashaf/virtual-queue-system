import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { WaitingTicket } from "@/lib/owner/view";
import { formatMalaysiaTime } from "@/lib/time";
import { formatTicketNumber } from "@/lib/ticket";
import type { Move, OwnerAction } from "./move-form";
import { TicketMenu } from "./ticket-menu";

/** The Waiting Tickets in Queue order, each number in the Waiting status colour. */
export function WaitingList({
  waiting,
  lastCallOn,
  move,
  remove,
}: {
  waiting: WaitingTicket[];
  lastCallOn: boolean;
  move: Move;
  remove: OwnerAction;
}) {
  return (
    <ol className="flex flex-col gap-2">
      {waiting.map((ticket, index) => (
        <li key={ticket.id}>
          <Card className="py-2">
            <CardContent className="flex items-center gap-3 pr-1 pl-4">
              <Badge
                variant="waiting"
                className="px-3 py-1 text-base font-semibold tabular-nums"
              >
                {formatTicketNumber(ticket.number)}
              </Badge>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="min-w-0 font-medium break-words">{ticket.name}</span>
                {/* The one Call next will take, in the burgundy of the shop's
                    next step. */}
                {index === 0 ? <Badge>Next</Badge> : null}
                {/* They are at the back with a high number, but they have been
                    in the shop a while. */}
                {ticket.origin === "rejoin" ? (
                  <Badge variant="secondary">Rejoined</Badge>
                ) : null}
                {ticket.carriedOver ? (
                  <Badge variant="secondary">Moved from previous day</Badge>
                ) : null}
                {/* Only while the question is open: yesterday's answer means
                    nothing once joining reopens. */}
                {lastCallOn && ticket.lastCallChoice ? (
                  <Badge variant="outline">
                    {ticket.lastCallChoice === "carry"
                      ? "Chose: next day"
                      : "Chose: stay"}
                  </Badge>
                ) : null}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatMalaysiaTime(ticket.joinedAt)}
              </span>
              <TicketMenu ticket={ticket} move={move} remove={remove} />
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  );
}

/** Before the first scan of the day, the board says what will fill it. */
export function EmptyQueue() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-muted-foreground">Nobody is waiting yet.</p>
      <p className="text-sm text-muted-foreground">
        Customers appear here when they scan your QR code.
      </p>
    </div>
  );
}
