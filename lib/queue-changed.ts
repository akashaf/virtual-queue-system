"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Pings arrive in bursts — calling one Customer touches one Ticket, but Close
 * Shop touches every one of them — and a screen only needs to read the Queue
 * once afterwards.
 */
const PING_DEBOUNCE_MS = 300;

/** Mobile browsers drop sockets in the background, so nobody relies on the ping alone. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Keeps a screen level with the Queue: a `queue_changed` ping on the Shop's
 * topic, a slow poll, and a look every time the tab comes back.
 *
 * The ping carries no data (backend.md §6), so every one of these ends in the
 * caller refetching its own view — which is what stops a Customer's browser
 * ever learning about anyone else's Ticket.
 *
 * `refetch` is held in a ref, so a caller that rebuilds the callback on every
 * render does not tear the subscription down and put it back up again.
 */
export function useQueueChanged(shopId: string, refetch: () => void): void {
  const latest = useRef(refetch);

  useEffect(() => {
    latest.current = refetch;
  }, [refetch]);

  useEffect(() => {
    const run = () => latest.current();

    let debounce: ReturnType<typeof setTimeout> | undefined;
    const onPing = () => {
      clearTimeout(debounce);
      debounce = setTimeout(run, PING_DEBOUNCE_MS);
    };

    const supabase = createClient();
    const channel = supabase
      .channel(`shop:${shopId}`)
      .on("broadcast", { event: "queue_changed" }, onPing)
      .subscribe();

    const poll = setInterval(run, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(debounce);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [shopId]);
}
