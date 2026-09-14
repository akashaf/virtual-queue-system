import "server-only";
import { getStore } from "@netlify/blobs";

// Throwaway (#3): where the after() callback records that it finished.
// Netlify Blobs on Netlify, so the record survives across function instances;
// in-process memory under `next dev`.

export type AfterRecord = { runId: string; completedAt: string };

const LATEST_AFTER_RUN_KEY = "latest-after-run";
// On globalThis because `next dev` loads this module separately for the page and the action.
const memory = ((globalThis as { __platformCheck?: Map<string, AfterRecord> })
  .__platformCheck ??= new Map<string, AfterRecord>());

function blobStore() {
  try {
    return getStore("platform-check");
  } catch (error) {
    // Fall back only when not running on Netlify; surface any other Blobs failure.
    if (error instanceof Error && error.name === "MissingBlobsEnvironmentError") return null;
    throw error;
  }
}

export function storeBackend() {
  return blobStore() ? "netlify-blobs" : "memory";
}

export async function saveAfterRecord(record: AfterRecord) {
  const store = blobStore();
  if (store) await store.setJSON(LATEST_AFTER_RUN_KEY, record);
  else memory.set(LATEST_AFTER_RUN_KEY, record);
}

export async function readAfterRecord(): Promise<AfterRecord | null> {
  const store = blobStore();
  if (store) return (await store.get(LATEST_AFTER_RUN_KEY, { type: "json", consistency: "strong" })) ?? null;
  return memory.get(LATEST_AFTER_RUN_KEY) ?? null;
}
