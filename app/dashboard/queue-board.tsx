"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useQueueChanged } from "@/lib/queue-changed";
import type { OwnerOutcome, OwnerQueue, ServedTicket } from "@/lib/owner/view";
import { formatCountdown, formatMalaysiaTime, formatMinutesAgo } from "@/lib/time";
import { formatTicketNumber } from "@/lib/ticket";
import { callNext, markServed, undoServed } from "./actions";
import { ownerErrorMessage } from "./messages";

/**
 * The Owner's live Queue and the two buttons that move it.
 *
 * The server renders the first view; from then on this component refetches the
 * whole Queue rather than patching it, so two phones behind the counter and the
 * Customer's own page can never drift apart.
 */
export function QueueBoard({ initialQueue }: { initialQueue: OwnerQueue }) {
  const [queue, setQueue] = useState(initialQueue);
  // One flag for every button: the cheapest guard against a double tap, and the
  // Queue has moved under the screen by the time the press lands anyway.
  const [pending, setPending] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const response = await fetch("/api/owner/queue", { cache: "no-store" });
      if (response.ok) setQueue((await response.json()) as OwnerQueue);
    } catch {
      // Offline, or the tab was frozen mid-request. The next tick tries again.
    }
  }, []);

  useQueueChanged(queue.shop.id, refetch);

  const { waiting, called, justServed } = queue;
  // The clock only needs to run while something on screen is counting.
  const elapsedMs = useElapsedMs(queue, called.length + justServed.length > 0);
  const undoable = justServed.filter(
    (ticket) => ticket.undoExpiresInMs - elapsedMs > 0,
  );

  async function run<T>(
    action: () => Promise<OwnerOutcome<T>>,
    onDone?: (result: T) => void,
  ) {
    setPending(true);
    try {
      const outcome = await action();
      if (outcome.ok) onDone?.(outcome.result);
      else toast.error(ownerErrorMessage(outcome.reason));
      await refetch();
    } finally {
      setPending(false);
    }
  }

  function undo(ticketId: string) {
    void run(() => undoServed(ticketId));
  }

  /** Done is undoable for two minutes, so it says so until the window shuts. */
  function offerUndo(served: ServedTicket) {
    const id = `served-${served.id}`;
    toast(
      <UndoToast
        number={served.number}
        expiresInMs={served.undoExpiresInMs}
        onUndo={() => {
          toast.dismiss(id);
          undo(served.id);
        }}
      />,
      { id, duration: served.undoExpiresInMs },
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-4">
      <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
        Waiting {waiting.length} · In chair {called.length}
      </p>

      {called.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {called.map((ticket) => (
            <li
              key={ticket.id}
              className="flex items-center gap-4 rounded-lg border-2 border-primary px-4 py-3"
            >
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
              <Button
                type="button"
                size="sm"
                className="h-11 px-5"
                disabled={pending}
                onClick={() => void run(() => markServed(ticket.id), offerUndo)}
              >
                Done
              </Button>
            </li>
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11 px-4"
                  disabled={pending}
                  onClick={() => undo(ticket.id)}
                >
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="sticky bottom-0 mt-auto -mx-4 border-t bg-background px-4 py-3">
        <Button
          type="button"
          size="lg"
          className="h-14 w-full text-base"
          disabled={pending || waiting.length === 0}
          onClick={() => void run(callNext)}
        >
          Call next
        </Button>
      </div>
    </main>
  );
}

function UndoToast({
  number,
  expiresInMs,
  onUndo,
}: {
  number: number;
  expiresInMs: number;
  onUndo: () => void;
}) {
  const elapsedMs = useElapsedMs(number, true);

  return (
    <div className="flex w-full items-center gap-3">
      <span className="flex-1">{formatTicketNumber(number)} marked done</span>
      <span className="text-sm text-muted-foreground tabular-nums">
        {formatCountdown(expiresInMs - elapsedMs)}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}

/**
 * Milliseconds on *this browser's* clock since `key` last changed.
 *
 * The Undo window arrives from the database already measured, and is counted
 * down from here rather than against a wall-clock deadline, so a tablet whose
 * clock is wrong still shows the Owner the time they really have.
 *
 * Starting at zero also keeps the server's render and the browser's first one
 * identical, which a `Date.now()` in state would not.
 */
function useElapsedMs(key: unknown, ticking: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [counting, setCounting] = useState(key);

  // React's own "adjust state while rendering" pattern: a new Queue starts a new
  // count, without a frame in between that shows the old one.
  if (key !== counting) {
    setCounting(key);
    setElapsedMs(0);
  }

  useEffect(() => {
    if (!ticking) return;

    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [key, ticking]);

  return elapsedMs;
}
