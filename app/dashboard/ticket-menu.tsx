"use client";

import { useState } from "react";
import { EllipsisVerticalIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTicketNumber } from "@/lib/ticket";
import { MoveForm, type Move, type OwnerAction } from "./move-form";

/**
 * Remove, kept behind an overflow menu and a confirmation: it is the one action
 * here with nothing to undo, and it reads to the Customer as being turned away.
 */
export function TicketMenu({
  ticket,
  move,
  remove,
}: {
  ticket: { id: string; number: number; name: string | null };
  move: Move;
  remove: OwnerAction;
}) {
  const [confirming, setConfirming] = useState(false);
  const number = formatTicketNumber(ticket.number);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="size-11 shrink-0"
            aria-label={`More for ${number}`}
          >
            <EllipsisVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            className="min-h-11"
            onSelect={() => setConfirming(true)}
          >
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {number}
              {ticket.name ? ` · ${ticket.name}` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They lose their place, and their page tells them their ticket was
              removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Keep them</AlertDialogCancel>
            <MoveForm
              move={move}
              intent={{ kind: "remove_ticket", ticketId: ticket.id }}
              action={remove}
            >
              <AlertDialogAction
                type="submit"
                variant="destructive"
                className="h-11 w-full"
                disabled={remove.pending}
              >
                Remove
              </AlertDialogAction>
            </MoveForm>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
