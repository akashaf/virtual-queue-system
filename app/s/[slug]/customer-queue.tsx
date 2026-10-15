"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  checkCustomerName,
  isFinalStatus,
  type CustomerView,
  type CustomerError,
  type NameProblem,
} from "@/lib/customer/view";
import type { Dictionary } from "@/lib/i18n";
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
import { installGate, isStandalone } from "@/lib/install-gate";
import {
  chooseLastCall,
  joinQueue,
  leaveQueue,
  rejoinQueue,
  type TicketActionResult,
} from "./actions";
import { Called } from "./called-ticket";
import { JoinForm } from "./join-form";
import { Announcement, Blocked, Busy, InAppBrowserWarning } from "./page-notices";
import { PushExplanationSheet, usePushAlerts } from "./push-alerts";
import { Ended } from "./ticket-ending";
import { Waiting } from "./waiting-ticket";

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
  | { kind: "choosing" }
  | { kind: "location_denied" }
  | { kind: "location_unavailable" }
  | { kind: "rejected"; reason: CustomerError | "failed" };

/** The stages that are just a wait, each with something to say while it lasts. */
type BusyStage = Extract<
  Stage,
  { kind: "locating" | "joining" | "leaving" | "rejoining" | "choosing" }
>["kind"];

export function CustomerQueue({
  slug,
  initialView,
  dict,
  userAgent,
  inAppBrowser,
}: {
  slug: string;
  initialView: CustomerView;
  dict: Dictionary;
  /** The request's, so the server can tell which phones the gate might stop. */
  userAgent: string | null;
  inAppBrowser: boolean;
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

  // The iPhone install gate (frontend.md §3.2 step 0). Whether the page is
  // running as a Home Screen app is only known in the browser, so for a phone
  // that might be installed the server answers "pending", and the form waits
  // for the browser's answer instead of flashing a Join button it may not keep.
  // A webview is never installed, so its answer is already certain.
  const gate = useSyncExternalStore(
    subscribeToNothing,
    () => installGate(navigator.userAgent, isStandalone()),
    () => {
      const outside = installGate(userAgent, false);
      return outside === "install" ? "pending" : outside;
    },
  );

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
  const push = usePushAlerts(active && view.ticket ? view.ticket.id : null);
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
  ): Promise<TicketActionResult> {
    setStage({ kind: busy });
    const result = await run();
    if (result.status === "done") {
      receive(result.view);
      setStage({ kind: "idle" });
    } else {
      setStage({ kind: "rejected", reason: result.reason });
    }
    return result;
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
      // Step 5 of the join flow: the explanation sheet, if there is one to show.
      push.offerPush();
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

  // Above every screen (frontend.md §3.1): these webviews get no Web Push, and
  // some of them drop the page as soon as the Customer switches away.
  const withWarning = (screen: React.ReactNode) => (
    <>
      {inAppBrowser ? <InAppBrowserWarning message={dict.inAppBrowserWarning} /> : null}
      {screen}
    </>
  );

  if (isBusy(stage)) {
    return withWarning(<Busy message={busyMessage(stage.kind, dict)} />);
  }

  if (stage.kind === "location_denied" || stage.kind === "location_unavailable") {
    const denied = stage.kind === "location_denied";
    return withWarning(
      <Blocked
        title={denied ? dict.locationDeniedTitle : dict.locationUnavailableTitle}
        detail={denied ? dict.locationDeniedHelp : dict.locationUnavailableHelp}
        action={dict.tryAgain}
        onRetry={tryAgain}
      />
    );
  }

  if (stage.kind === "rejected") {
    return withWarning(
      <Blocked
        title={rejectionMessage(stage.reason, dict)}
        action={dict.tryAgain}
        onRetry={tryAgain}
      />
    );
  }

  if (ended) {
    return withWarning(
      <Ended
        ticket={ended}
        dict={dict}
        onRejoin={() => {
          unlockAudio();
          void act(() => rejoinQueue(ended.id), "rejoining").then((result) => {
            // The new Ticket needs its own subscription; a Customer never yet
            // asked is asked now, and a granted browser re-saves silently.
            if (result.status === "done") push.offerPush();
          });
        }}
        onDismiss={() => rememberDismissed(storageKey, ended.id)}
      />
    );
  }

  if (view.ticket && active) {
    const ticket = view.ticket;
    const leave = () => void act(() => leaveQueue(ticket.id), "leaving");

    return withWarning(
      <>
        <PushExplanationSheet
          open={push.status === "ask"}
          dict={dict}
          onAllow={() => void push.allowPush(ticket.id)}
          onDecline={push.declinePush}
        />
        {ticket.status === "called" ? (
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
            estimate={view.estimate}
            dict={dict}
            headsUp={isHeadsUpReached(view)}
            lastCall={view.shop.joiningState === "last_call"}
            pushStatus={push.status}
            onChoose={(choice) =>
              void act(() => chooseLastCall(ticket.id, choice), "choosing")
            }
            onLeave={leave}
          />
        )}
      </>
    );
  }

  if (view.shop.joiningState === "last_call") {
    return withWarning(
      <Announcement shopName={view.shop.name} message={dict.lastCallClosed} />
    );
  }

  const joinForm = (
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
      gate={gate}
      onSubmit={handleJoin}
    />
  );
  // The gate's own card already says to open the page in Safari.
  return gate === "open_in_safari" ? joinForm : withWarning(joinForm);
}

function isBusy(stage: Stage): stage is Stage & { kind: BusyStage } {
  return (
    stage.kind === "locating" ||
    stage.kind === "joining" ||
    stage.kind === "leaving" ||
    stage.kind === "rejoining" ||
    stage.kind === "choosing"
  );
}

function busyMessage(stage: BusyStage, dict: Dictionary): string {
  switch (stage) {
    case "locating":
      return dict.checkingLocation;
    case "leaving":
      return dict.leaving;
    case "choosing":
      return dict.savingChoice;
    case "rejoining":
    case "joining":
      return dict.joining;
  }
}

function rejectionMessage(reason: CustomerError | "failed", dict: Dictionary): string {
  switch (reason) {
    case "too_far":
      return dict.tooFar;
    case "queue_full":
      return dict.queueFull;
    case "last_call":
      return dict.lastCallClosed;
    case "not_last_call":
      return dict.choiceUnavailable;
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
