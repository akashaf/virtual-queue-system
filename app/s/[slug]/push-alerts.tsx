"use client";

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
import type { Dictionary } from "@/lib/i18n";
import {
  pushPlan,
  readPushState,
  rememberPushDeclined,
  subscribeToPush,
} from "@/lib/push-client";
import { savePushSubscription } from "./actions";

/**
 * What the page knows about push alerts for the Ticket it is showing.
 *
 * `unknown` is silence — before a join, or mid-subscription; `ask` is the
 * explanation sheet; `on` and `off` are what the Waiting view reports, `off`
 * bringing the keep-this-page-open banner with it.
 */
export type PushStatus = "unknown" | "ask" | "on" | "off";

/**
 * Step 5 of the join flow (frontend.md §3.2), and the bookkeeping around it.
 *
 * The effect keeps the browser's one subscription pointing at the Ticket the
 * Customer holds *now*: a reload while waiting re-saves it silently, and after
 * a Rejoin — whose new Ticket the database moved nothing to — it is what signs
 * the new Ticket up. It never asks: `ask` only ever comes from `offerPush`,
 * inside the join tap, so a Customer is prompted at the one moment the sheet
 * was explained by what they just did. A reload that finds the question still
 * unanswered reports push as off instead — the Waiting view has to say
 * something true, and re-prompting out of nowhere is not the way.
 */
export function usePushAlerts(activeTicketId: string | null) {
  const [status, setStatus] = useState<PushStatus>("unknown");

  useEffect(() => {
    if (activeTicketId === null) return;
    let cancelled = false;

    void syncSubscription(activeTicketId).then((resolved) => {
      if (cancelled) return;
      if (resolved === "unanswered") {
        // The plan is "ask", but asking belongs to the join tap. Right after a
        // join, `offerPush` has already set "ask" and this must not close the
        // sheet; on a reload mid-sheet the status is still "unknown", and the
        // honest thing the Waiting view can say is that push is off.
        setStatus((current) => (current === "unknown" ? "off" : current));
      } else {
        setStatus(resolved);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTicketId]);

  /** Called on a successful join or Rejoin: show the sheet if there is anything to ask. */
  const offerPush = () => {
    if (pushPlan(readPushState()) === "ask") setStatus("ask");
  };

  /** The sheet's yes: hand over to the browser's own permission prompt. */
  const allowPush = async (ticketId: string) => {
    // Closes the sheet while the browser asks; the outcome sets the real state.
    setStatus("unknown");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      rememberPushDeclined();
      setStatus("off");
      return;
    }
    setStatus(await saveSubscription(ticketId));
  };

  /** The sheet's no, remembered for good: they are not asked again. */
  const declinePush = () => {
    rememberPushDeclined();
    setStatus("off");
  };

  return { status, offerPush, allowPush, declinePush };
}

async function syncSubscription(
  ticketId: string,
): Promise<PushStatus | "unanswered"> {
  const plan = pushPlan(readPushState());
  if (plan === "ask") return "unanswered";
  if (plan === "fallback") return "off";
  return saveSubscription(ticketId);
}

async function saveSubscription(ticketId: string): Promise<PushStatus> {
  const subscription = await subscribeToPush();
  if (subscription === null) return "off";

  const { ok } = await savePushSubscription(ticketId, subscription);
  return ok ? "on" : "off";
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
          <AlertDialogCancel onClick={onDecline}>
            {dict.pushExplainNotNow}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onAllow}>
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
 * sound is all there is.
 */
export function PushStatusNote({
  status,
  dict,
}: {
  status: PushStatus;
  dict: Dictionary;
}) {
  if (status === "on") {
    return <p className="text-sm text-muted-foreground">{dict.pushOn}</p>;
  }
  if (status === "off") {
    return (
      <p role="status" className="rounded-lg bg-muted px-4 py-3 text-sm font-medium">
        {dict.keepPageOpen}
      </p>
    );
  }
  return null;
}
