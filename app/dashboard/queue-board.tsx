"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EllipsisVerticalIcon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueueChanged } from "@/lib/queue-changed";
import {
  applyMove,
  closeShopPlan,
  type CalledTicket,
  type CloseShopResult,
  type OwnerOutcome,
  type OwnerQueue,
  type QueueMove,
  type ServedTicket,
} from "@/lib/owner/view";
import { formatCountdown, formatMalaysiaTime, formatMinutesAgo } from "@/lib/time";
import { formatTicketNumber } from "@/lib/ticket";
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
import { CHAIRS_STILL_BUSY, ownerErrorMessage } from "./messages";

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
    // Whichever Undo was pressed, the toast offering it is now stale.
    if (intent.kind === "undo_served") toast.dismiss(undoToastId(intent.ticketId));
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
    <main className="flex flex-1 flex-col gap-4 px-4 py-4">
      <div className="flex items-center gap-2">
        {/* Which door the shop is showing the street: open, or closing soon. */}
        <Badge variant={lastCallOn ? "destructive" : "secondary"}>
          {lastCallOn ? "Last Call" : "Open"}
        </Badge>
        <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
          Waiting {waiting.length} · In chair {called.length}
        </p>
      </div>

      {called.length > 0 ? (
        <ul className="flex flex-col gap-2">
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
              className="flex items-center gap-3 rounded-lg border px-4 py-3"
            >
              <span className="text-lg font-semibold tabular-nums">
                {formatTicketNumber(ticket.number)}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="truncate font-medium">{ticket.name}</span>
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

      {/* Ending the day, kept at the far end of the screen from Call next. */}
      <div className="mt-auto flex flex-col gap-2">
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
        <CallNextButton
          nobodyWaiting={waiting.length === 0}
          move={move}
          call={call}
        />
      </div>
    </main>
  );
}

/**
 * Last Call is confirmed: it pushes an alert to every Waiting Customer and
 * turns joiners away, which is not something to do with an elbow.
 */
function StartLastCallButton({
  move,
  lastCall,
}: {
  move: (intent: QueueMove) => void;
  lastCall: OwnerAction;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11 w-full">
          Last Call
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start last call?</AlertDialogTitle>
          <AlertDialogDescription>
            Stop new customers joining and ask waiting customers to choose?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <MoveForm
            move={move}
            intent={{ kind: "start_last_call" }}
            action={lastCall}
          >
            <AlertDialogAction type="submit" disabled={lastCall.pending}>
              Start last call
            </AlertDialogAction>
          </MoveForm>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Reopening needs no confirmation: it takes nothing from anybody, and the
 * choices already made are kept for the next Last Call (§12 rule 2).
 */
function ReopenJoiningButton({
  move,
  reopen,
}: {
  move: (intent: QueueMove) => void;
  reopen: OwnerAction;
}) {
  return (
    <MoveForm move={move} intent={{ kind: "cancel_last_call" }} action={reopen}>
      <Button
        type="submit"
        variant="outline"
        className="h-11 w-full"
        disabled={reopen.pending}
      >
        Reopen joining
      </Button>
    </MoveForm>
  );
}

/**
 * The confirmation counts what `close_shop` will actually do — or, while
 * anyone is still in a chair, says why it will refuse: those Tickets must be
 * finished first, because closing can neither bill them nor drop them.
 */
function CloseShopButton({
  queue,
  move,
  close,
}: {
  queue: OwnerQueue;
  move: (intent: QueueMove) => void;
  close: OwnerAction;
}) {
  const chairsBusy = queue.called.length > 0;
  const plan = closeShopPlan(queue.waiting);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" className="h-11 w-full">
          Close Shop
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {chairsBusy ? "Customers still in the chair" : "Close the shop?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {chairsBusy
              ? CHAIRS_STILL_BUSY
              : `${plan.moving} moving to next day, ${plan.removing} will be removed.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{chairsBusy ? "OK" : "Stay open"}</AlertDialogCancel>
          {chairsBusy ? null : (
            <MoveForm move={move} intent={{ kind: "close_shop" }} action={close}>
              <AlertDialogAction type="submit" disabled={close.pending}>
                Close Shop
              </AlertDialogAction>
            </MoveForm>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
  return (
    <MoveForm move={move} intent={{ kind: "call_next" }} action={call}>
      <Button
        type="submit"
        size="lg"
        className="h-14 w-full text-base"
        disabled={call.pending || nobodyWaiting}
      >
        Call next
      </Button>
    </MoveForm>
  );
}

/**
 * One press: the screen moves, then the Server Action goes. Every button here
 * has the same shape, and the Ticket it names comes from the move itself rather
 * than being passed alongside it and able to disagree.
 */
function MoveForm({
  move,
  intent,
  action,
  className,
  children,
}: {
  move: (intent: QueueMove) => void;
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

function CalledCard({
  ticket,
  elapsedMs,
  move,
  serve,
  noShow,
  remove,
}: {
  ticket: CalledTicket;
  elapsedMs: number;
  move: (intent: QueueMove) => void;
  serve: OwnerAction;
  noShow: OwnerAction;
  remove: OwnerAction;
}) {
  // The Customer may still be walking over, so the button waits with them.
  const noShowInMs = ticket.noShowInMs - elapsedMs;
  const tooEarly = noShowInMs > 0;

  return (
    <li className="flex flex-col gap-3 rounded-lg border-2 border-primary px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-lg font-semibold tabular-nums">
          {formatTicketNumber(ticket.number)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{ticket.name}</span>
          {/* The browser's own clock, which may differ from the shop's. */}
          <span className="text-sm text-muted-foreground" suppressHydrationWarning>
            called {formatMinutesAgo(ticket.calledAt, new Date())}
          </span>
        </span>
        <TicketMenu ticket={ticket} move={move} remove={remove} />
      </div>

      <div className="flex items-center gap-2">
        <MoveForm
          className="flex-1"
          move={move}
          intent={{ kind: "mark_served", ticketId: ticket.id }}
          action={serve}
        >
          <Button type="submit" className="h-11 w-full" disabled={serve.pending}>
            Done
          </Button>
        </MoveForm>

        <MoveForm
          className="flex-1"
          move={move}
          intent={{ kind: "mark_no_show", ticketId: ticket.id }}
          action={noShow}
        >
          <Button
            type="submit"
            variant="outline"
            className="h-11 w-full tabular-nums"
            disabled={noShow.pending || tooEarly}
          >
            {tooEarly ? `No-show ${formatCountdown(noShowInMs)}` : "No-show"}
          </Button>
        </MoveForm>
      </div>
    </li>
  );
}

/**
 * Remove, kept behind an overflow menu and a confirmation: it is the one action
 * here with nothing to undo, and it reads to the Customer as being turned away.
 */
function TicketMenu({
  ticket,
  move,
  remove,
}: {
  ticket: { id: string; number: number; name: string | null };
  move: (intent: QueueMove) => void;
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
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
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
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <MoveForm
              move={move}
              intent={{ kind: "remove_ticket", ticketId: ticket.id }}
              action={remove}
            >
              <AlertDialogAction type="submit" disabled={remove.pending}>
                Remove
              </AlertDialogAction>
            </MoveForm>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * The one Undo control, used both in the toast and in "Just served". Pressing
 * either dismisses the toast, so a Ticket already back in a chair is never still
 * being offered.
 */
/** The one Undo control, used both in the toast and in "Just served". */
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
