/**
 * The browser's half of Web Push (frontend.md §3.2 step 5): deciding whether to
 * ask, and turning a granted permission into a saved subscription. The server
 * half — storing it, sending to it — lives in `lib/push.ts`.
 */

/** What `PushSubscription.toJSON()` gives the page to send to the server. */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Set once the Customer has said no — to our sheet or to the browser's prompt —
 * and never asked again (frontend.md §3.2). localStorage rather than session:
 * "do not re-prompt" would mean little if every visit started over.
 */
export const PUSH_DECLINED_KEY = "vq_push_declined";

export type PushPlan = "subscribe" | "ask" | "fallback";

/**
 * What to do about push for a Ticket the Customer holds.
 *
 * The browser's own `denied` and our remembered decline both fall back for
 * good; a dismissed browser prompt leaves permission at `default`, which is why
 * the flag exists at all.
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

/** The state `pushPlan` needs, read from this browser. */
export function readPushState(): {
  supported: boolean;
  permission: NotificationPermission;
  declined: boolean;
} {
  return {
    supported: "PushManager" in window && "serviceWorker" in navigator,
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

export function rememberPushDeclined(): void {
  try {
    localStorage.setItem(PUSH_DECLINED_KEY, "1");
  } catch {
    // Nothing to do: the worst case is asking again on the next visit.
  }
}

/**
 * Registers the service worker and subscribes this browser, or null when any
 * step refuses — a missing VAPID key, a push service that cannot be reached.
 * Null means the sound fallback, which is never wrong, so no error escapes.
 */
export async function subscribeToPush(): Promise<PushSubscriptionInput | null> {
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return null;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toApplicationServerKey(vapidKey),
    });

    const { endpoint, keys } = subscription.toJSON();
    if (!endpoint || !keys?.p256dh || !keys.auth) return null;
    return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
  } catch {
    return null;
  }
}

/** The VAPID public key as bytes: base64url strings still trip some browsers. */
function toApplicationServerKey(vapidKey: string): Uint8Array<ArrayBuffer> {
  const base64 = vapidKey.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = atob(padded);

  const key = new Uint8Array(new ArrayBuffer(bytes.length));
  for (let i = 0; i < bytes.length; i++) key[i] = bytes.charCodeAt(i);
  return key;
}
