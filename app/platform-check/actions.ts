"use server";

import { after } from "next/server";
import { saveAfterRecord } from "./store";

export type CheckResult = { runId: string; ranAt: string; node: string } | null;

// How long the after() callback waits before recording. The e2e check requires the
// action to respond well within this, proving the callback runs after the response.
// Not exported: "use server" files may only export async functions.
const AFTER_DELAY_MS = 5000;

// Throwaway (#3): proves Server Actions run and that after() work finishes once the
// response has been sent, as push dispatch will rely on.
export async function runCheck(): Promise<CheckResult> {
  const runId = crypto.randomUUID();

  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, AFTER_DELAY_MS));
    await saveAfterRecord({ runId, completedAt: new Date().toISOString() });
  });

  return { runId, ranAt: new Date().toISOString(), node: process.version };
}
