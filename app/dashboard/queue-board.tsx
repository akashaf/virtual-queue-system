"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useQueueChanged } from "@/lib/queue-changed";
import { formatTicketLabel } from "@/lib/ticket";
import { createViewOrder } from "@/lib/view-order";
import {
  applyMove,
  type CalledTicket,
  type CloseShopResult,
  type OwnerOutcome,
  type OwnerQueue,
  type QueueMove,
  type ServedTicket,
} from "@/lib/owner/view";
import {
  callNext,
  cancelLastCall,
  closeShop,
  markNoShow,
  markServed,
  removeTicket,
  startLastCall,
  undoServed,
} from "./actions";
import { CalledCard } from "./called-card";
import { ownerErrorMessage } from "./messages";
import type { OwnerAction } from "./move-form";
import {
  CallNextButton,
  CloseShopButton,
  ReopenJoiningButton,
  StartLastCallButton,
} from "./queue-controls";
import { JustServed, UndoToast, undoToastId } from "./undo";
import { useElapsedMs } from "./use-elapsed-ms";
import { EmptyQueue, WaitingList } from "./waiting-list";

/**
 * The Owner's live Queue and the buttons that move it.
 *
 * The server renders the first view. A press moves the screen at once and then
 * refetches the whole Queue rather than patching it, so two phones behind the
 * counter and the Customer's own page can never drift apart.
 */
export function QueueBoard({ initialQueue }: { initialQueue: OwnerQueue }) {
  const [queue, setQueue] = useState(initialQueue);
  // Refetches overlap, so an older Queue can land after a newer one (#32).
  const [order] = useState(createViewOrder);

  const refetch = useCallback(async () => {
    const issued = order.next();
    try {
      const response = await fetch("/api/owner/queue", { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as OwnerQueue;
      if (order.accept(issued)) setQueue(next);
    } catch {
      // Offline, or the tab was frozen mid-request. The next tick tries again.
    }
  }, [order]);

  useQueueChanged(queue.shop.id, refetch);

  /** Moves the screen before the round trip; the refetch replaces it with the truth. */
  const move = useCallback((intent: QueueMove) => {
    // Whichever Undo was pressed, the toast offering it is now stale.
    if (intent.kind === "undo_served") toast.dismiss(undoToastId(intent.ticketId));
    // Any refetch already in flight was read before the press.
    order.claim();
    setQueue((current) => applyMove(current, intent, new Date()));
  }, [order]);

  /** Every press ends the same way: say so if it was refused, then re-read the Queue. */
  const settle = useCallback(
    (outcome: OwnerOutcome<unknown>) => {
      if (!outcome.ok) toast.error(ownerErrorMessage(outcome.reason));
      void refetch();
    },
    [refetch],
  );

  // One action state per kind of press, held here rather than on each row: an
  // optimistic move unmounts the row it moved, and a button cannot be told how
  // its own press went once it has gone.
  /** A call alerts a Customer, so the Owner is told whose phone just rang. */
  const announceCall = useCallback(
    (outcome: OwnerOutcome<CalledTicket>) => {
      if (outcome.ok) toast(`Called ${formatTicketLabel(outcome.result)}`);
      settle(outcome);
    },
    [settle],
  );
  const call = useOwnerAction(callNext, announceCall);
  const undo = useOwnerAction(undoServed, settle);
  const noShow = useOwnerAction(markNoShow, settle);
  const remove = useOwnerAction(removeTicket, settle);
  const lastCall = useOwnerAction(startLastCall, settle);
  const reopen = useOwnerAction(cancelLastCall, settle);

  /** Closing the day is worth a receipt: who moved to the new day, who did not. */
  const settleClose = useCallback(
    (outcome: OwnerOutcome<CloseShopResult>) => {
      if (outcome.ok) {
        const { carriedOver, removed } = outcome.result;
        toast.success(
          `Day closed — ${carriedOver} moved to the next day, ${removed} removed`,
        );
      }
      settle(outcome);
    },
    [settle],
  );
  const close = useOwnerAction(closeShop, settleClose);

  /** Done is undoable for two minutes, so it says so until the window shuts. */
  const offerUndo = useCallback(
    (outcome: OwnerOutcome<ServedTicket>) => {
      if (outcome.ok) {
        const served = outcome.result;
        toast(<UndoToast served={served} move={move} undo={undo} />, {
          id: undoToastId(served.id),
          duration: served.undoExpiresInMs,
        });
      }
      settle(outcome);
    },
    [move, settle, undo],
  );
  const serve = useOwnerAction(markServed, offerUndo);

  const { waiting, called, justServed } = queue;
  // The clock only needs to run while something on screen is counting.
  const elapsedMs = useElapsedMs(queue, called.length + justServed.length > 0);
  const undoable = justServed.filter(
    (ticket) => ticket.undoExpiresInMs - elapsedMs > 0,
  );

  const lastCallOn = queue.shop.joiningState === "last_call";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Which door the shop is showing the street: open, or closing soon.
            Filled while Last Call is on, so the closed door is hard to miss. */}
        <Badge
          variant={lastCallOn ? "default" : "outline"}
          className="px-3 py-1 text-sm"
        >
          {lastCallOn ? "Last Call" : "Open"}
        </Badge>
        {/* The counts are on screen as the section headings; this line is
            what a screen reader hears when they change. */}
        <p className="sr-only" aria-live="polite">
          Waiting {waiting.length} · In chair {called.length}
        </p>
      </div>

      {/* Both headings stay up while anyone is in the Queue, so a zero is
          read as a free chair or an empty line rather than a missing section. */}
      {waiting.length === 0 && called.length === 0 ? (
        <EmptyQueue />
      ) : (
        <>
          <section aria-labelledby="in-chair-heading" className="flex flex-col gap-2">
            <SectionHeading id="in-chair-heading" label="In chair" count={called.length} />
            {called.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {called.map((ticket) => (
                  <CalledCard
                    key={ticket.id}
                    ticket={ticket}
                    elapsedMs={elapsedMs}
                    move={move}
                    serve={serve}
                    noShow={noShow}
                    remove={remove}
                  />
                ))}
              </ul>
            ) : null}
          </section>

          <section aria-labelledby="waiting-heading" className="flex flex-col gap-2">
            <SectionHeading id="waiting-heading" label="Waiting" count={waiting.length} />
            {waiting.length > 0 ? (
              <WaitingList
                waiting={waiting}
                lastCallOn={lastCallOn}
                move={move}
                remove={remove}
              />
            ) : null}
          </section>
        </>
      )}

      {/* Read from the database rather than remembered here, so the Undo
          survives a reload and shows up on the shop's other phone too. */}
      {undoable.length > 0 ? (
        <JustServed undoable={undoable} elapsedMs={elapsedMs} move={move} undo={undo} />
      ) : null}

      {/* Ending the day, kept at the far end of the screen from Call next. The
          space below it is where toasts land (layout.tsx), so the two-minute
          Undo toast never sits on Last Call or Close Shop. */}
      <div className="mt-auto flex flex-col gap-2 pt-4 pb-24">
        {lastCallOn ? (
          <>
            <ReopenJoiningButton move={move} reopen={reopen} />
            <CloseShopButton queue={queue} move={move} close={close} />
          </>
        ) : (
          <StartLastCallButton move={move} lastCall={lastCall} />
        )}
      </div>

      <div className="sticky bottom-0 -mx-4 border-t bg-background px-4 py-3">
        <CallNextButton next={waiting[0]} move={move} call={call} />
      </div>
    </main>
  );
}

/** A group's name with its count, the count large enough to read from the chair. */
function SectionHeading({ id, label, count }: { id: string; label: string; count: number }) {
  return (
    <h2 id={id} className="flex items-baseline gap-2">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{count}</span>
    </h2>
  );
}

/**
 * One kind of owner press: a `useActionState` (frontend.md §1) whose result is
 * handed back exactly once, however the buttons that use it come and go.
 *
 * `pending` is per kind rather than per button, which is also the double-tap
 * guard §4.2 asks for: a second Done cannot land while the first is in flight,
 * and Call next stays live throughout because it is a different press.
 */
function useOwnerAction<T>(
  action: (
    previous: OwnerOutcome<T> | null,
    formData: FormData,
  ) => Promise<OwnerOutcome<T>>,
  onOutcome: (outcome: OwnerOutcome<T>) => void,
): OwnerAction {
  const [outcome, submit, pending] = useActionState(action, null);
  const latest = useRef(onOutcome);

  useEffect(() => {
    latest.current = onOutcome;
  }, [onOutcome]);

  useEffect(() => {
    if (outcome) latest.current(outcome);
  }, [outcome]);

  return { submit, pending };
}
