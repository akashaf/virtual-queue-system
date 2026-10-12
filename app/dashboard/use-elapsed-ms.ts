import { useEffect, useState } from "react";

/**
 * Milliseconds on *this browser's* clock since `restartOn` last changed.
 *
 * The Undo window arrives from the database already measured, and is counted
 * down from here rather than against a wall-clock deadline, so a tablet whose
 * clock is wrong still shows the Owner the time they really have.
 *
 * Starting at zero also keeps the server's render and the browser's first one
 * identical, which a `Date.now()` in state would not.
 */
export function useElapsedMs(restartOn: unknown, counting: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [counted, setCounted] = useState(restartOn);

  // React's own "adjust state while rendering" pattern: a new Queue starts a new
  // count, without a frame in between that shows the old one.
  if (restartOn !== counted) {
    setCounted(restartOn);
    setElapsedMs(0);
  }

  useEffect(() => {
    if (!counting) return;

    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [restartOn, counting]);

  return elapsedMs;
}
