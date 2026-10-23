import { unstable_isUnrecognizedActionError } from "next/navigation";

/**
 * What a Server Action call that threw means, for every screen that calls one.
 *
 * - **unreachable**: a failed fetch is a TypeError — offline, or the request
 *   died on the way — and it may still have landed.
 * - **an older build**: a page left open across a deploy still holds the old
 *   build's action ids, and the new build answers each one 404 "Server Action
 *   … was not found". Netlify serves only the newest build, so Next's
 *   `deploymentId` cannot route it back; the cure is the page's own code, so it
 *   reloads. Safe on the Customer page, whose Ticket lives in the device cookie,
 *   and on the board, which rereads the Queue on load. The promise then never
 *   settles, so the caller's busy state stays up until the reload lands rather
 *   than flashing an error. Seen in production on 2026-10-23: a page open
 *   through a deploy failed every press, and "Try again" only refetched.
 * - **failed**: anything else, which the caller reports.
 */
export async function classifyActionFailure(error: unknown): Promise<"unreachable" | "failed"> {
  if (error instanceof TypeError) return "unreachable";
  if (unstable_isUnrecognizedActionError(error) && reloadForNewBuild()) {
    return new Promise<never>(() => {});
  }
  return "failed";
}

/**
 * For an error boundary: reloads instead of showing the error when a form's
 * Server Action (the EN | BM toggle, sign-in, sign-out) came from an older
 * build. Returns whether it is reloading.
 */
export function reloadIfFromOlderBuild(error: unknown): boolean {
  return unstable_isUnrecognizedActionError(error) && reloadForNewBuild();
}

const LAST_RELOAD_KEY = "vq_reloaded_for_new_build";

/** At most one reload a minute, so a server that keeps refusing cannot loop the page. */
const RELOAD_GAP_MS = 60_000;

/**
 * Whether a reload last made at `lastAt` (ms, or null for never) leaves room
 * for another now. A stored value that is not a time, or is in the future (a
 * clock set back), counts as never, so it cannot block reloads for good.
 */
export function mayReloadAgain(lastAt: number | null, now: number): boolean {
  if (lastAt === null || !Number.isFinite(lastAt) || lastAt > now) return true;
  return now - lastAt >= RELOAD_GAP_MS;
}

/**
 * Reloads the page for the new build, unless it already did within the last
 * minute — or cannot remember that it did, since storage walled off would let
 * every reload allow the next. Returns whether it is reloading.
 */
function reloadForNewBuild(): boolean {
  const now = Date.now();
  try {
    const stored = sessionStorage.getItem(LAST_RELOAD_KEY);
    if (!mayReloadAgain(stored === null ? null : Number(stored), now)) return false;
    sessionStorage.setItem(LAST_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
