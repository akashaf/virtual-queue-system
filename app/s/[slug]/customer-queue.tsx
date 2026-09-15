"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  checkCustomerName,
  isFinalStatus,
  MAX_CUSTOMER_NAME_LENGTH,
  type CustomerView,
  type CustomerError,
  type NameProblem,
} from "@/lib/customer/view";
import { formatTicketNumber } from "@/lib/ticket";
import { cn } from "@/lib/utils";
import { format, type Dictionary } from "@/lib/i18n";
import { useQueueChanged } from "@/lib/queue-changed";
import {
  acknowledgeCalled,
  initialPageAlerts,
  isHeadsUpReached,
  nextPageAlerts,
  type PageAlerts,
} from "@/lib/alerts";
import { unlockAudio, useAlertEffects } from "@/lib/alert-effects";
import { recordLocationFailure } from "@/lib/error-reporting";
import {
  joinQueue,
  leaveQueue,
  rejoinQueue,
  type TicketActionResult,
} from "./actions";

/**
 * The Ticket whose ending this tab has already been shown and tapped past.
 *
 * The server keeps answering with a finished Ticket for the rest of the Queue
 * Day, because that is the only way the page can know *which* ending it was.
 * Dismissal is the browser's business, not the Shop's, so it is kept here
 * (frontend.md §3.1) — and per session, so a Customer coming back later meets
 * the join form rather than yesterday's news.
 */
const DISMISSED_TICKET_KEY = "vq_dismissed_ticket";

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 0,
};

/**
 * What the page is busy with. The Customer's *place* lives in `view`, which the
 * server owns; this is only the part of the join that happens in the browser.
 */
type Stage =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "joining" }
  | { kind: "leaving" }
  | { kind: "rejoining" }
  | { kind: "location_denied" }
  | { kind: "location_unavailable" }
  | { kind: "rejected"; reason: CustomerError | "failed" };

/** The stages that are just a wait, each with something to say while it lasts. */
type BusyStage = Extract<
  Stage,
  { kind: "locating" | "joining" | "leaving" | "rejoining" }
>["kind"];

export function CustomerQueue({
  slug,
  initialView,
  dict,
}: {
  slug: string;
  initialView: CustomerView;
  dict: Dictionary;
}) {
  // The view and the alerts move together: every alert is decided by comparing
  // the view the page had with the one that just arrived (lib/alerts.ts).
  const [page, setPage] = useState<{ view: CustomerView; alerts: PageAlerts }>(() => ({
    view: initialView,
    alerts: initialPageAlerts(initialView),
  }));
  const { view, alerts } = page;
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [name, setName] = useState("");
  const [nameProblem, setNameProblem] = useState<NameProblem | null>(null);

  // A form submitted before hydration would POST without any coordinates, and
  // the Join Radius check is the whole point of the button. This is the
  // hydration-safe way to ask "is the browser running this yet?": the server
  // snapshot is false and the client's is true.
  const hydrated = useSyncExternalStore(subscribeToNothing, onClient, onServer);

  const storageKey = `${DISMISSED_TICKET_KEY}:${slug}`;

  const receive = useCallback((next: CustomerView) => {
    setPage((current) => ({
      view: next,
      alerts: nextPageAlerts(current.alerts, current.view, next),
    }));
  }, []);

  const refetch = useCallback(async () => {
    try {
      const response = await fetch(`/api/s/${slug}/me`, { cache: "no-store" });
      if (response.ok) receive((await response.json()) as CustomerView);
    } catch {
      // Offline, or the tab was frozen mid-request. The next tick tries again.
    }
  }, [slug, receive]);

  useQueueChanged(view.shop.id, refetch);

  const active = view.ticket !== null && !isFinalStatus(view.ticket.status);
  useAlertEffects(alerts, {
    headsUpTitle: dict.headsUpTitle,
    calledTitle: dict.calledTitle,
    // frontend.md §3.3 asks for the wake lock while Waiting. It is held in the
    // chair too, or the screen could go dark while the Called chime rings.
    keepAwake: active,
  });

  // sessionStorage is where dismissal lives, so the page reads it from there
  // rather than shadowing it in state. The server snapshot is "nothing
  // dismissed", which is also what a tab that has never held a Ticket reads.
  const dismissed = useSyncExternalStore(
    subscribeToDismissals,
    () => sessionStorage.getItem(storageKey),
    () => null,
  );

  const ended =
    view.ticket && isFinalStatus(view.ticket.status) && view.ticket.id !== dismissed
      ? view.ticket
      : null;

  async function act(
    run: () => Promise<TicketActionResult>,
    busy: BusyStage,
  ) {
    setStage({ kind: busy });
    const result = await run();
    if (result.status === "done") {
      receive(result.view);
      setStage({ kind: "idle" });
    } else {
      setStage({ kind: "rejected", reason: result.reason });
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();

    const checked = checkCustomerName(name);
    if (!checked.ok) {
      setNameProblem(checked.problem);
      return;
    }
    setNameProblem(null);

    // Synchronously, while this is still the tap: iOS will not let the page play
    // a sound later unless one was started inside a user gesture (§3.2 step 2).
    unlockAudio();

    setStage({ kind: "locating" });
    let coords: GeolocationCoordinates;
    try {
      coords = (await currentPosition()).coords;
    } catch (error) {
      recordLocationFailure(error);
      setStage({ kind: locationFailure(error) });
      return;
    }

    setStage({ kind: "joining" });
    const result = await joinQueue(slug, checked.name, {
      lat: coords.latitude,
      lng: coords.longitude,
      accuracyM: coords.accuracy,
    });

    if (result.status === "joined") {
      receive(result.view);
      setStage({ kind: "idle" });
    } else if (result.status === "invalid_name") {
      setNameProblem(result.problem);
      setStage({ kind: "idle" });
    } else {
      setStage({ kind: "rejected", reason: result.reason });
    }
  }

  function tryAgain() {
    setStage({ kind: "idle" });
    // A refused join may well have been a race with another Customer, so start
    // again from what the server says rather than from what the page remembers.
    void refetch();
  }

  if (isBusy(stage)) {
    return <Busy message={busyMessage(stage.kind, dict)} />;
  }

  if (stage.kind === "location_denied" || stage.kind === "location_unavailable") {
    const denied = stage.kind === "location_denied";
    return (
      <Blocked
        title={denied ? dict.locationDeniedTitle : dict.locationUnavailableTitle}
        detail={denied ? dict.locationDeniedHelp : dict.locationUnavailableHelp}
        action={dict.tryAgain}
        onRetry={tryAgain}
      />
    );
  }

  if (stage.kind === "rejected") {
    return (
      <Blocked
        title={rejectionMessage(stage.reason, dict)}
        action={dict.tryAgain}
        onRetry={tryAgain}
      />
    );
  }

  if (ended) {
    return (
      <Ended
        ticket={ended}
        dict={dict}
        onRejoin={() => {
          unlockAudio();
          void act(() => rejoinQueue(ended.id), "rejoining");
        }}
        onDismiss={() => rememberDismissed(storageKey, ended.id)}
      />
    );
  }

  if (view.ticket && active) {
    const ticket = view.ticket;
    const leave = () => void act(() => leaveQueue(ticket.id), "leaving");

    return ticket.status === "called" ? (
      <Called
        ticket={ticket}
        dict={dict}
        ringing={alerts.ringingTicketId === ticket.id}
        onAcknowledge={() =>
          setPage((current) => ({
            ...current,
            alerts: acknowledgeCalled(current.alerts),
          }))
        }
        onLeave={leave}
      />
    ) : (
      <Waiting
        ticket={ticket}
        dict={dict}
        headsUp={isHeadsUpReached(view)}
        onLeave={leave}
      />
    );
  }

  if (view.shop.joiningState === "last_call") {
    return (
      <Announcement shopName={view.shop.name} message={dict.lastCallClosed} />
    );
  }

  return (
    <JoinForm
      dict={dict}
      shopName={view.shop.name}
      waitingCount={view.shop.waitingCount}
      name={name}
      onNameChange={(value) => {
        setName(value);
        setNameProblem(null);
      }}
      nameProblem={nameProblem}
      ready={hydrated}
      onSubmit={handleJoin}
    />
  );
}

function JoinForm({
  dict,
  shopName,
  waitingCount,
  name,
  onNameChange,
  nameProblem,
  ready,
  onSubmit,
}: {
  dict: Dictionary;
  shopName: string;
  waitingCount: number;
  name: string;
  onNameChange: (value: string) => void;
  nameProblem: NameProblem | null;
  ready: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{shopName}</h1>
        <p className="text-muted-foreground" aria-live="polite">
          {waitingCountLabel(waitingCount, dict)}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="customer-name" className="text-sm font-medium">
            {dict.nameLabel}
          </label>
          <Input
            id="customer-name"
            name="name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={dict.namePlaceholder}
            // In UTF-16 units, which is what the attribute counts. An astral
            // character is two of them, so this is the widest a 30-character
            // name can be: a soft guard that can never refuse a valid name,
            // with checkCustomerName as the real one.
            maxLength={MAX_CUSTOMER_NAME_LENGTH * 2}
            autoComplete="given-name"
            enterKeyHint="go"
            aria-invalid={nameProblem !== null}
            aria-describedby="customer-name-privacy"
            className="h-12 text-base"
          />
          {nameProblem ? (
            <p role="alert" className="text-sm text-destructive">
              {nameProblem === "required" ? dict.nameRequired : dict.nameTooLong}
            </p>
          ) : null}
        </div>

        <p id="customer-name-privacy" className="text-sm text-muted-foreground">
          {dict.privacyNotice}
        </p>

        <Button type="submit" size="lg" className="h-12 text-base" disabled={!ready}>
          {dict.joinButton}
        </Button>
      </form>
    </div>
  );
}

function Waiting({
  ticket,
  dict,
  headsUp,
  onLeave,
}: {
  ticket: NonNullable<CustomerView["ticket"]>;
  dict: Dictionary;
  /** Inside the Heads-up Threshold: time to walk back. */
  headsUp: boolean;
  onLeave: () => void;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 text-center"
      aria-live="polite"
    >
      <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        {dict.yourNumber}
      </p>
      {/* frontend.md §5: at least 64px, readable at arm's length across a shop. */}
      <p className="text-7xl font-bold tabular-nums">
        {formatTicketNumber(ticket.number)}
      </p>
      <p className="text-xl font-medium">{aheadLabel(ticket.position, dict)}</p>
      {headsUp ? (
        <p className="rounded-lg bg-primary px-4 py-3 text-lg font-semibold text-primary-foreground">
          {dict.headBackNow}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">{dict.inPersonNote}</p>
      <LeaveButton dict={dict} onLeave={onLeave} className="mt-4" />
    </div>
  );
}

function Called({
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
    // Over the whole screen and in the shop's loudest colours: this is the one
    // state a Customer has to notice from across the room (frontend.md §5).
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-primary p-6 text-center text-primary-foreground"
    >
      <p className="text-3xl font-semibold tracking-tight">{dict.yourTurn}</p>
      <p className="text-8xl font-bold tabular-nums">
        {formatTicketNumber(ticket.number)}
      </p>
      <p className="text-2xl font-medium">{dict.goToCounter}</p>
      {ringing ? (
        <Button
          type="button"
          size="lg"
          variant="secondary"
          className="mt-6 h-14 px-10 text-lg"
          onClick={onAcknowledge}
        >
          {dict.imComing}
        </Button>
      ) : null}
      <LeaveButton
        dict={dict}
        onLeave={onLeave}
        className="mt-6 border-primary-foreground/40 text-primary-foreground"
      />
    </div>
  );
}

/**
 * What became of a Ticket that has ended, kept on screen until the Customer taps
 * past it.
 *
 * Served has a way on for the same reason the others do. The server now answers
 * with a finished Ticket for the rest of the Queue Day, so without one a
 * Customer who has had their haircut could not queue again that day — for their
 * child, or for a second cut — however long they waited.
 */
function Ended({
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
          title={dict.removedTitle}
          action={dict.joinButton}
          onAction={onDismiss}
        />
      );

    // Waiting and Called are not endings, and never reach here.
    default:
      return null;
  }
}

function Ending({
  title,
  detail,
  action,
  onAction,
}: {
  title: string;
  detail?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 text-center">
      <p role="status" aria-live="polite" className="text-2xl font-semibold tracking-tight">
        {title}
      </p>
      {detail ? <p className="text-muted-foreground">{detail}</p> : null}
      {action && onAction ? (
        <Button type="button" size="lg" className="h-12 text-base" onClick={onAction}>
          {action}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Leaving is confirmed, in the chair as much as in the Queue: a mis-tap costs
 * the Customer their place, and the only way back is the QR code at the shop.
 */
function LeaveButton({
  dict,
  onLeave,
  className,
}: {
  dict: Dictionary;
  onLeave: () => void;
  className?: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className={cn("h-12 px-6", className)}>
          {dict.leaveQueue}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{dict.leaveConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{dict.leaveConfirmBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{dict.leaveConfirmStay}</AlertDialogCancel>
          <AlertDialogAction onClick={onLeave}>
            {dict.leaveConfirmLeave}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function isBusy(stage: Stage): stage is Stage & { kind: BusyStage } {
  return (
    stage.kind === "locating" ||
    stage.kind === "joining" ||
    stage.kind === "leaving" ||
    stage.kind === "rejoining"
  );
}

function busyMessage(stage: BusyStage, dict: Dictionary): string {
  switch (stage) {
    case "locating":
      return dict.checkingLocation;
    case "leaving":
      return dict.leaving;
    case "rejoining":
    case "joining":
      return dict.joining;
  }
}

function Busy({ message }: { message: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="my-auto text-center text-lg text-muted-foreground"
    >
      {message}
    </p>
  );
}

function Blocked({
  title,
  detail,
  action,
  onRetry,
}: {
  title: string;
  detail?: string;
  action: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 text-center">
      <p role="alert" className="text-lg font-medium">
        {title}
      </p>
      {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
      <Button type="button" size="lg" className="h-12 text-base" onClick={onRetry}>
        {action}
      </Button>
    </div>
  );
}

function Announcement({ shopName, message }: { shopName: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-2 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{shopName}</h1>
      <p role="status" className="text-lg text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

function waitingCountLabel(count: number, dict: Dictionary): string {
  if (count === 0) return dict.waitingNowNone;
  if (count === 1) return dict.waitingNowOne;
  return format(dict.waitingNow, { count });
}

function aheadLabel(position: number, dict: Dictionary): string {
  if (position === 0) return dict.youAreNext;
  if (position === 1) return dict.aheadOfYouOne;
  return format(dict.aheadOfYou, { count: position });
}

function rejectionMessage(reason: CustomerError | "failed", dict: Dictionary): string {
  switch (reason) {
    case "too_far":
      return dict.tooFar;
    case "queue_full":
      return dict.queueFull;
    case "last_call":
      return dict.lastCallClosed;
    case "already_in_queue":
      return dict.alreadyInQueue;
    case "shop_inactive":
      return dict.shopUnavailable;
    case "not_rejoinable":
      return dict.cannotRejoin;
    case "ticket_not_found":
      return dict.ticketGone;
    case "failed":
      return dict.joinFailed;
  }
}

const subscribeToNothing = () => () => {};

/**
 * sessionStorage fires no events of its own for the tab that writes to it, so
 * the few readers of the dismissed-Ticket key are kept here and told directly.
 */
const dismissalListeners = new Set<() => void>();

function subscribeToDismissals(onChange: () => void) {
  dismissalListeners.add(onChange);
  return () => {
    dismissalListeners.delete(onChange);
  };
}

function rememberDismissed(key: string, ticketId: string) {
  sessionStorage.setItem(key, ticketId);
  for (const listener of dismissalListeners) listener();
}
const onClient = () => true;
const onServer = () => false;

function currentPosition(): Promise<GeolocationPosition> {
  if (!("geolocation" in navigator)) {
    return Promise.reject(new Error("geolocation_unsupported"));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, GEOLOCATION_OPTIONS);
  });
}

/**
 * A refused permission is the Customer's to fix and is worth explaining; a
 * timeout or a lost signal is not, and only needs trying again.
 *
 * Read off `code` rather than through `instanceof`, because the error class is
 * spelled differently across browsers while the code is fixed by the standard.
 */
function locationFailure(error: unknown): "location_denied" | "location_unavailable" {
  const PERMISSION_DENIED = 1;
  const code = (error as { code?: unknown } | null)?.code;

  return code === PERMISSION_DENIED ? "location_denied" : "location_unavailable";
}
