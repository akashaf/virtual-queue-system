// Liveness check, used when verifying a deploy.
export async function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
