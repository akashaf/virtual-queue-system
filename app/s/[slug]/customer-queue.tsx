"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  checkCustomerName,
  MAX_CUSTOMER_NAME_LENGTH,
  type CustomerView,
  type JoinError,
  type NameProblem,
} from "@/lib/customer/view";
import { formatTicketNumber } from "@/lib/ticket";
import { format, type Dictionary } from "@/lib/i18n";
import { joinQueue } from "./actions";

/** How often a waiting page asks where it stands. */
const REFETCH_INTERVAL_MS = 30_000;

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
  | { kind: "location_denied" }
  | { kind: "location_unavailable" }
  | { kind: "rejected"; reason: JoinError | "failed" };

export function CustomerQueue({
  slug,
  initialView,
  dict,
}: {
  slug: string;
  initialView: CustomerView;
  dict: Dictionary;
}) {
  const [view, setView] = useState(initialView);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [name, setName] = useState("");
  const [nameProblem, setNameProblem] = useState<NameProblem | null>(null);

  // A form submitted before hydration would POST without any coordinates, and
  // the Join Radius check is the whole point of the button. This is the
  // hydration-safe way to ask "is the browser running this yet?": the server
  // snapshot is false and the client's is true.
  const hydrated = useSyncExternalStore(subscribeToNothing, onClient, onServer);

  const hasTicket = view.ticket !== null;

  const refetch = useCallback(async () => {
    try {
      const response = await fetch(`/api/s/${slug}/me`, { cache: "no-store" });
      if (response.ok) setView((await response.json()) as CustomerView);
    } catch {
      // Offline, or the tab was frozen mid-request. The next tick tries again.
    }
  }, [slug]);

  // Realtime arrives with #6; until then a poll and a look on every return to
  // the tab are what keep "N ahead of you" true.
  useEffect(() => {
    if (!hasTicket) return;

    const interval = setInterval(refetch, REFETCH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasTicket, refetch]);

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();

    const checked = checkCustomerName(name);
    if (!checked.ok) {
      setNameProblem(checked.problem);
      return;
    }
    setNameProblem(null);

    setStage({ kind: "locating" });
    let coords: GeolocationCoordinates;
    try {
      coords = (await currentPosition()).coords;
    } catch (error) {
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
      setView(result.view);
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

  if (stage.kind === "locating" || stage.kind === "joining") {
    return (
      <Busy
        message={stage.kind === "locating" ? dict.checkingLocation : dict.joining}
      />
    );
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

  // get_customer_view only ever returns a Waiting or a Called Ticket, and until
  // #6 gives the Owner a Call next button, only a Waiting one can exist.
  if (view.ticket) {
    return <Waiting ticket={view.ticket} dict={dict} />;
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
}: {
  ticket: NonNullable<CustomerView["ticket"]>;
  dict: Dictionary;
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
      <p className="text-sm text-muted-foreground">{dict.inPersonNote}</p>
    </div>
  );
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

function rejectionMessage(reason: JoinError | "failed", dict: Dictionary): string {
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
    case "failed":
      return dict.joinFailed;
  }
}

const subscribeToNothing = () => () => {};
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
