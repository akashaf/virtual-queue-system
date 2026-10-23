"use client";

import { BellOff } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Dictionary, Lang } from "@/lib/i18n";
import {
  canStillAsk,
  forgetPushDeclined,
  initPush,
  linkPushToTicket,
  pushPlan,
  readPushState,
  rememberPushDeclined,
  requestPushPermission,
} from "@/lib/push-client";

/**
 * What the page knows about push alerts for the Ticket it is showing.
 *
 * `unknown` is silence — before a join, or mid-subscription; `ask` is the
 * explanation sheet; `on`, `off` and `askable` are what the Waiting view
 * reports. `off` brings the keep-this-page-open banner with it, and `askable`
 * is the same banner with a way to turn alerts on: push is off only because the
 * Customer said no to our sheet, so the browser would still ask.
 */
export type PushStatus = "unknown" | "ask" | "on" | "off" | "askable";

/**
 * Step 5 of the join flow (frontend.md §3.2), and the bookkeeping around it.
 *
 * The effect keeps this browser's OneSignal login pointing at the Ticket the
 * Customer holds *now*: a reload while waiting logs in again silently, and
 * after a Rejoin it is what moves the subscription to the new Ticket. It never
 * asks: `ask` only ever comes from `offerPush`,
 * inside the join tap, so a Customer is prompted at the one moment the sheet
 * was explained by what they just did. A reload that finds the question still
 * unanswered reports push as off instead — the Waiting view has to say
 * something true, and re-prompting out of nowhere is not the way.
 */
export function usePushAlerts(activeTicketId: string | null, lang: Lang) {
  const [status, setStatus] = useState<PushStatus>("unknown");

  // OneSignal loads before the join tap, so that the sheet's button can reach
  // the browser's prompt while the tap still counts as one: iOS only shows it
  // from a user gesture.
  useEffect(() => {
    void initPush();
  }, []);

  useEffect(() => {
    if (activeTicketId === null) return;
    let cancelled = false;

    void syncSubscription(activeTicketId, lang).then((resolved) => {
      if (cancelled) return;
      if (resolved === "unanswered") {
        // The plan is "ask", but asking belongs to the join tap. Right after a
        // join, `offerPush` has already set "ask" and this must not close the
        // sheet; on a reload mid-sheet the status is still "unknown", and the
        // honest thing the Waiting view can say is that push is off — with the
        // button, since the Customer never answered.
        setStatus((current) => (current === "unknown" ? "askable" : current));
      } else {
        setStatus(resolved);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTicketId, lang]);

  /** Called on a successful join or Rejoin: show the sheet if there is anything to ask. */
  const offerPush = () => {
    if (pushPlan(readPushState()) === "ask") setStatus("ask");
  };

  /**
   * The sheet's yes, or the banner's "Turn on alerts": hand over to the
   * browser's own permission prompt.
   */
  const allowPush = async (ticketId: string) => {
    // Closes the sheet while the browser asks; the outcome sets the real state.
    // From the banner the status stays put, so the keep-this-page-open advice
    // does not vanish while a prompt is up (or never comes).
    setStatus((current) => (current === "ask" ? "unknown" : current));

    if (!(await requestPushPermission())) {
      rememberPushDeclined();
      // No button after a failed attempt: OneSignal may not have loaded, or
      // Chrome may be suppressing its prompt, and a button that does nothing
      // on every tap is worse than none. A reload offers it once more.
      setStatus("off");
      return;
    }
    forgetPushDeclined();
    setStatus((await linkPushToTicket(ticketId, lang)) ? "on" : "off");
  };

  /**
   * The sheet's no, remembered: the sheet is not offered again, though the
   * banner keeps a button for a Customer who changes their mind.
   */
  const declinePush = () => {
    rememberPushDeclined();
    setStatus(offStatus());
  };

  return { status, offerPush, allowPush, declinePush };
}

async function syncSubscription(
  ticketId: string,
  lang: Lang,
): Promise<PushStatus | "unanswered"> {
  const plan = pushPlan(readPushState());
  if (plan === "ask") return "unanswered";
  if (plan === "fallback") return offStatus();
  return (await linkPushToTicket(ticketId, lang)) ? "on" : "off";
}

/** Push is off: with a way back if the browser would still ask, without one if not. */
function offStatus(): "off" | "askable" {
  return canStillAsk(readPushState()) ? "askable" : "off";
}

/**
 * The explanation before the browser's own prompt (frontend.md §3.2): the
 * permission dialog names the site, not the reason, so the reason comes first.
 * Dismissing it counts as a no — "do not re-prompt" would mean nothing if
 * closing the sheet meant being shown it again.
 */
export function PushExplanationSheet({
  open,
  dict,
  onAllow,
  onDecline,
}: {
  open: boolean;
  dict: Dictionary;
  onAllow: () => void;
  onDecline: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onDecline()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{dict.pushExplainTitle}</AlertDialogTitle>
          <AlertDialogDescription>{dict.pushExplainBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11" onClick={onDecline}>
            {dict.pushExplainNotNow}
          </AlertDialogCancel>
          <AlertDialogAction className="h-11" onClick={onAllow}>
            {dict.pushExplainAllow}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The Waiting view's alert status (frontend.md §3.1): one quiet line when push
 * is on, and the persistent keep-this-page-open banner when the page's own
 * sound is all there is, with a reminder of which volume that sound obeys —
 * and "Turn on alerts" when only our sheet was turned down.
 */
export function PushStatusNote({
  status,
  dict,
  onTurnOn,
}: {
  status: PushStatus;
  dict: Dictionary;
  onTurnOn: () => void;
}) {
  if (status === "on") {
    return <p className="text-center text-sm text-muted-foreground">{dict.pushOn}</p>;
  }
  if (status === "off" || status === "askable") {
    return (
      <Alert role="status">
        <BellOff aria-hidden />
        <AlertTitle className="line-clamp-none">{dict.keepPageOpen}</AlertTitle>
        {/* An iPhone plays it at the media volume, which is easy to have down. */}
        <AlertDescription>
          <p>{dict.mediaVolumeHint}</p>
          {status === "askable" ? (
            // A tap the Customer makes, so the browser's prompt may show from it.
            <Button type="button" variant="outline" className="mt-2 h-11" onClick={onTurnOn}>
              {dict.pushExplainAllow}
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
