"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useQueueChanged } from "@/lib/queue-changed";
import {
  applyMove,
  type CalledTicket,
  type OwnerOutcome,
  type OwnerQueue,
  type QueueMove,
  type ServedTicket,
} from "@/lib/owner/view";
import { formatCountdown, formatMalaysiaTime, formatMinutesAgo } from "@/lib/time";
import { formatTicketNumber } from "@/lib/ticket";
import { callNext, markServed, undoServed } from "./actions";
import { ownerErrorMessage } from "./messages";

/**
 * The Owner's live Queue and the buttons that move it.
 *
 * The server renders the first view. A press moves the screen at once and then
 * refetches the whole Queue rather than patching it, so two phones behind the
 * counter and the Customer's own page can never drift apart.
 */
export function QueueBoard({ initialQueue }: { initialQueue: OwnerQueue }) {
  const [queue, setQueue] = useState(initialQueue);

  const refetch = useCallback(async () => {
    try {
      const response = await fetch("/api/owner/queue", { cache: "no-store" });
      if (response.ok) setQueue((await response.json()) as OwnerQueue);
    } catch {
      // Offline, or the tab was frozen mid-request. The next tick tries again.
    }
  }, []);

  useQueueChanged(queue.shop.id, refetch);

  /** Moves the screen before the round trip; the refetch replaces it with the truth. */
  const move = useCallback((intent: QueueMove) => {
    setQueue((current) => applyMove(current, intent, new Date()));
  }, []);

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
  const call = useOwnerAction(callNext, settle);
  const undo = useOwnerAction(undoServed, settle);

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

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-4">
      <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
        Waiting {waiting.length} · In chair {called.length}
      </p>

      {called.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {called.map((ticket) => (
            <CalledCard key={ticket.id} ticket={ticket} move={move} serve={serve} />
          ))}
        </ul>
      ) : null}

      {waiting.length === 0 && called.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <p className="text-muted-foreground">Nobody is waiting yet.</p>
          <p className="text-sm text-muted-foreground">
            Customers appear here when they scan your QR code.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {waiting.map((ticket) => (
            <li
              key={ticket.id}
              className="flex items-center gap-4 rounded-lg border px-4 py-3"
            >
              <span className="text-lg font-semibold tabular-nums">
                {formatTicketNumber(ticket.number)}
              </span>
              <span className="flex-1 truncate font-medium">{ticket.name}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatMalaysiaTime(ticket.joinedAt)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* Read from the database rather than remembered here, so the Undo
          survives a reload and shows up on the shop's other phone too. */}
      {undoable.length > 0 ? (
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Just served ({undoable.length})
          </summary>
          <ul className="flex flex-col gap-2 border-t px-4 py-3">
            {undoable.map((ticket) => (
              <li key={ticket.id} className="flex items-center gap-4">
                <span className="font-semibold tabular-nums">
                  {formatTicketNumber(ticket.number)}
                </span>
                <span className="flex-1 truncate">{ticket.name}</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatCountdown(ticket.undoExpiresInMs - elapsedMs)}
                </span>
                <UndoButton ticketId={ticket.id} move={move} undo={undo} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="sticky bottom-0 mt-auto -mx-4 border-t bg-background px-4 py-3">
        <CallNextButton
          nobodyWaiting={waiting.length === 0}
          move={move}
          call={call}
        />
      </div>
    </main>
  );
}

function CallNextButton({
  nobodyWaiting,
  move,
  call,
}: {
  nobodyWaiting: boolean;
  move: (intent: QueueMove) => void;
  call: OwnerAction;
}) {
  const { submit, pending } = call;

  return (
    <form
      action={(formData) => {
        move({ kind: "call_next" });
        submit(formData);
      }}
    >
      <Button
        type="submit"
        size="lg"
        className="h-14 w-full text-base"
        disabled={pending || nobodyWaiting}
      >
        Call next
      </Button>
    </form>
  );
}

function CalledCard({
  ticket,
  move,
  serve,
}: {
  ticket: CalledTicket;
  move: (intent: QueueMove) => void;
  serve: OwnerAction;
}) {
  return (
    <li className="flex items-center gap-4 rounded-lg border-2 border-primary px-4 py-3">
      <span className="text-lg font-semibold tabular-nums">
        {formatTicketNumber(ticket.number)}
      </span>
      <span className="flex flex-1 flex-col truncate">
        <span className="truncate font-medium">{ticket.name}</span>
        {/* The browser's own clock, which may differ from the shop's. */}
        <span className="text-sm text-muted-foreground" suppressHydrationWarning>
          called {formatMinutesAgo(ticket.calledAt, new Date())}
        </span>
      </span>
      <form
        action={(formData) => {
          move({ kind: "mark_served", ticketId: ticket.id });
          serve.submit(formData);
        }}
      >
        <input type="hidden" name="ticketId" value={ticket.id} />
        <Button
          type="submit"
          size="sm"
          className="h-11 px-5"
          disabled={serve.pending}
        >
          Done
        </Button>
      </form>
    </li>
  );
}

/**
 * The one Undo control, used both in the toast and in "Just served". Pressing
 * either dismisses the toast, so a Ticket already back in a chair is never still
 * being offered.
 */
function UndoButton({
  ticketId,
  move,
  undo,
}: {
  ticketId: string;
  move: (intent: QueueMove) => void;
  undo: OwnerAction;
}) {
  return (
    <form
      action={(formData) => {
        // Both Undo controls dismiss the toast, so a Ticket already back in a
        // chair is never still being offered by the one that was not pressed.
        toast.dismiss(undoToastId(ticketId));
        move({ kind: "undo_served", ticketId });
        undo.submit(formData);
      }}
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="h-11 px-4"
        disabled={undo.pending}
      >
        Undo
      </Button>
    </form>
  );
}

function UndoToast({
  served,
  move,
  undo,
}: {
  served: ServedTicket;
  move: (intent: QueueMove) => void;
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
function undoToastId(ticketId: string): string {
  return `served-${ticketId}`;
}

/** What one kind of press needs from the screen: somewhere to go, and whether it is busy. */
interface OwnerAction {
  submit: (formData: FormData) => void;
  pending: boolean;
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

/**
 * Milliseconds on *this browser's* clock since `restartOn` last changed.
 *
 * The Undo window arrives from the database already measured, and is counted
 * down from here rather than against a wall-clock deadline, so a tablet whose
 * clock is wrong still shows the Owner the time they really have.
 *
 * Starting at zero also keeps the server's render and the browser's first one
 * identical, which a `Date.now()` in state would not.
 */
function useElapsedMs(restartOn: unknown, counting: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [counted, setCounted] = useState(restartOn);

  // React's own "adjust state while rendering" pattern: a new Queue starts a new
  // count, without a frame in between that shows the old one.
  if (restartOn !== counted) {
    setCounted(restartOn);
    setElapsedMs(0);
  }

  useEffect(() => {
    if (!counting) return;

    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [restartOn, counting]);

  return elapsedMs;
}
