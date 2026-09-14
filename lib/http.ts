/**
 * A JSON reply that no cache may keep. Every read in this app is a live queue
 * position or an Operator's view of one, and a stale answer is worse than none.
 */
export function noStoreJson(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
