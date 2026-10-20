"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ServedTicket } from "@/lib/owner/view";
import { formatCountdown } from "@/lib/time";
import { formatTicketNumber } from "@/lib/ticket";
import { MoveForm, type Move, type OwnerAction } from "./move-form";
import { useElapsedMs } from "./use-elapsed-ms";

/**
 * The one Undo control, used both in the toast and in "Just served". Pressing
 * either dismisses the toast, so a Ticket already back in a chair is never still
 * being offered.
 */
export function UndoButton({
  ticketId,
  move,
  undo,
}: {
  ticketId: string;
  move: Move;
  undo: OwnerAction;
}) {
  return (
    <MoveForm move={move} intent={{ kind: "undo_served", ticketId }} action={undo}>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="h-11 px-4"
        disabled={undo.pending}
      >
        Undo
      </Button>
    </MoveForm>
  );
}

/** The toast after a Ticket is marked Served, offering to take it back while the Undo window lasts. */
export function UndoToast({
  served,
  move,
  undo,
}: {
  served: ServedTicket;
  move: Move;
  undo: OwnerAction;
}) {
  const elapsedMs = useElapsedMs(served.id, true);

  return (
    <div className="flex w-full items-center gap-3">
      <span className="flex-1">{formatTicketNumber(served.number)} marked done</span>
      <span className="text-sm text-muted-foreground tabular-nums">
        {formatCountdown(served.undoExpiresInMs - elapsedMs)}
      </span>
      <UndoButton ticketId={served.id} move={move} undo={undo} />
    </div>
  );
}

/** The toast for one Done, named so that either Undo control can dismiss it. */
export function undoToastId(ticketId: string): string {
  return `served-${ticketId}`;
}

/**
 * Every Done still inside its Undo window, folded away until wanted.
 *
 * The Collapsible sits on a native `<details>` and `<summary>`, because the e2e
 * suite finds this section by that element. The browser's toggle is the only
 * one: it fires after React has handled the click, so a Collapsible toggling
 * too would have the two flip the section open and straight back shut.
 */
export function JustServed({
  undoable,
  elapsedMs,
  move,
  undo,
}: {
  undoable: ServedTicket[];
  elapsedMs: number;
  move: Move;
  undo: OwnerAction;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="gap-0 py-0">
      <Collapsible open={open} asChild>
        <details onToggle={(event) => setOpen(event.currentTarget.open)}>
          <CollapsibleTrigger asChild>
            <Button asChild variant="ghost" className="h-11 w-full list-none justify-between px-4 [&::-webkit-details-marker]:hidden">
              <summary>
                Just served ({undoable.length})
                <ChevronDownIcon className={open ? "rotate-180" : undefined} />
              </summary>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent asChild>
            <ul className="flex flex-col gap-2 border-t px-4 py-3">
              {undoable.map((ticket) => (
                <li key={ticket.id} className="flex items-center gap-4">
                  <Badge variant="served" className="px-3 py-1 text-base font-semibold tabular-nums">
                    {formatTicketNumber(ticket.number)}
                  </Badge>
                  <span className="min-w-0 flex-1 break-words">{ticket.name}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatCountdown(ticket.undoExpiresInMs - elapsedMs)}
                  </span>
                  <UndoButton ticketId={ticket.id} move={move} undo={undo} />
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </details>
      </Collapsible>
    </Card>
  );
}
