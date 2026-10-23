import OneSignal from "react-onesignal";
import type { Lang } from "@/lib/i18n";

/**
 * The browser's half of Web Push (frontend.md §3.2 step 5): deciding whether to
 * ask, and signing this browser up with OneSignal under the Customer's Ticket
 * (ADR 0005). The server half — sending to that Ticket — lives in `lib/push.ts`.
 */

/**
 * Set once the Customer has said no — to our sheet or to the browser's prompt —
 * so the sheet is never offered again (frontend.md §3.2). localStorage rather
 * than session: "do not re-prompt" would mean little if every visit started
 * over. The Customer can still turn alerts on from the Waiting banner, which
 * clears it (`forgetPushDeclined`).
 */
export const PUSH_DECLINED_KEY = "vq_push_declined";

export type PushPlan = "subscribe" | "ask" | "fallback";

/**
 * What to do about push for a Ticket the Customer holds.
 *
 * The browser's own `denied` and our remembered decline both fall back; a
 * dismissed browser prompt leaves permission at `default`, which is why the
 * flag exists at all. Only the Customer's own tap on "Turn on alerts" asks
 * again after a decline (`canStillAsk`).
 */
export function pushPlan(state: {
  supported: boolean;
  permission: NotificationPermission;
  declined: boolean;
}): PushPlan {
  if (!state.supported || state.permission === "denied" || state.declined) {
    return "fallback";
  }
  return state.permission === "granted" ? "subscribe" : "ask";
}

/**
 * Whether the browser would still show its own prompt: push works here and the
 * Customer has not refused it in the browser. Our remembered decline does not
 * count, because it only stops *us* offering — a Customer who taps "Turn on
 * alerts" later is asking, not being re-prompted.
 */
export function canStillAsk(state: {
  supported: boolean;
  permission: NotificationPermission;
}): boolean {
  return state.supported && state.permission === "default";
}

/** The state `pushPlan` needs, read from this browser. */
export function readPushState(): {
  supported: boolean;
  permission: NotificationPermission;
  declined: boolean;
} {
  return {
    // No App ID (local development, e2e) is a browser without push: sound only.
    supported:
      Boolean(ONESIGNAL_APP_ID) && "PushManager" in window && "serviceWorker" in navigator,
    permission: "Notification" in window ? Notification.permission : "denied",
    declined: readPushDeclined(),
  };
}

function readPushDeclined(): boolean {
  // Storage can be walled off entirely (private mode, strict settings); a
  // browser that cannot remember a decline is treated as never having made one.
  try {
    return localStorage.getItem(PUSH_DECLINED_KEY) !== null;
  } catch {
    return false;
  }
}

/** Remembers that the Customer turned alerts down, so the sheet is not offered again. */
export function rememberPushDeclined(): void {
  try {
    localStorage.setItem(PUSH_DECLINED_KEY, "1");
  } catch {
    // Nothing to do: the worst case is asking again on the next visit.
  }
}

/**
 * Forgets a decline once the Customer has turned alerts on after all, or
 * `pushPlan` would keep answering "fallback" and the next reload would leave
 * the granted subscription unlinked.
 */
export function forgetPushDeclined(): void {
  try {
    localStorage.removeItem(PUSH_DECLINED_KEY);
  } catch {
    // Storage walled off: nothing was remembered either.
  }
}

const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;

let initialised: Promise<boolean> | null = null;

/**
 * Loads OneSignal's SDK and registers its service worker, once per page. False
 * when it cannot — no App ID, a blocked script, a browser OneSignal refuses —
 * which means the sound fallback, never wrong, so no error escapes.
 *
 * Its own prompts stay off: our explanation sheet is the only thing that asks
 * (frontend.md §3.2), from the join tap.
 */
export function initPush(): Promise<boolean> {
  initialised ??= (async () => {
    if (!ONESIGNAL_APP_ID) return false;
    try {
      await OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        serviceWorkerPath: "OneSignalSDKWorker.js",
        allowLocalhostAsSecureOrigin: process.env.NODE_ENV === "development",
        autoResubscribe: true,
        promptOptions: { slidedown: { prompts: [] } },
      });
      return true;
    } catch {
      return false;
    }
  })();
  return initialised;
}

/**
 * Points this browser's OneSignal user at the Ticket the Customer holds now:
 * the Ticket id is the External ID the server sends to, and never the device
 * id, which is the Customer's whole claim to the Ticket (ADR 0005). A Rejoin
 * logs in again and moves the subscription to the new Ticket.
 *
 * Resolves to whether this browser will get the Ticket's pushes.
 */
export async function linkPushToTicket(ticketId: string, lang: Lang): Promise<boolean> {
  if (!(await initPush())) return false;
  try {
    await OneSignal.login(ticketId);
    OneSignal.User.setLanguage(lang);
    if (OneSignal.Notifications.permission) await OneSignal.User.PushSubscription.optIn();
    return OneSignal.User.PushSubscription.optedIn === true;
  } catch {
    return false;
  }
}

/** The browser's own permission prompt, through OneSignal. True when granted. */
export async function requestPushPermission(): Promise<boolean> {
  if (!(await initPush())) return false;
  try {
    return await OneSignal.Notifications.requestPermission();
  } catch {
    return false;
  }
}
