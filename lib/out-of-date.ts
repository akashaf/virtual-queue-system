"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How often a screen that has fallen behind tries to catch up. */
const RETRY_MS = 5_000;

/** How long a refetch may hang before it counts as a failure. */
export const REFETCH_TIMEOUT_MS = 10_000;

/**
 * Whether a live screen has stopped hearing from the server, and since when —
 * the Owner's board and the Customer's page both say so rather than showing a
 * Queue that has already moved on (frontend.md §3.1, §4.2).
 *
 * The caller's refetch reports each attempt through `settle`, numbered as
 * `createViewOrder` numbers it, so a slow old refetch failing after a newer one
 * got through does not raise the notice again. `raise` is for a press that got
 * no answer: it may still have landed, and only a refetch can say.
 */
export function useOutOfDate(readAt: string) {
  const [outOfDate, setOutOfDate] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(() => new Date(readAt));
  // The newest attempt to have finished.
  const lastSettled = useRef(0);

  const settle = useCallback((issued: number, ok: boolean) => {
    if (issued < lastSettled.current) return;
    lastSettled.current = issued;
    setOutOfDate(!ok);
    if (ok) setUpdatedAt(new Date());
  }, []);

  const raise = useCallback(() => setOutOfDate(true), []);

  useEffect(() => {
    window.addEventListener("offline", raise);
    return () => window.removeEventListener("offline", raise);
  }, [raise]);

  return { outOfDate, updatedAt, settle, raise };
}

/**
 * While a screen is behind, try again often rather than waiting out the
 * 30-second poll, and at once when the browser says the network is back. Only
 * while the tab is showing: `useQueueChanged` refetches when it comes back.
 * `behind` is the caller's to narrow — the Customer page only catches up while
 * it holds a Ticket.
 */
export function useCatchUp(behind: boolean, refetch: () => void): void {
  const latest = useRef(refetch);

  useEffect(() => {
    latest.current = refetch;
  }, [refetch]);

  useEffect(() => {
    if (!behind) return;
    const retry = setInterval(() => {
      if (document.visibilityState === "visible") latest.current();
    }, RETRY_MS);
    const onOnline = () => latest.current();
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(retry);
      window.removeEventListener("online", onOnline);
    };
  }, [behind]);
}
