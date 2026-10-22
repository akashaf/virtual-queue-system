// TEMPORARY (#37 diagnosis): which client-IP headers reach the server on Netlify. Never commit.
export async function GET(request: Request) {
  const names = ["x-nf-client-connection-ip", "x-forwarded-for", "x-real-ip", "x-nf-request-id"];
  const seen = Object.fromEntries(names.map((name) => [name, request.headers.get(name)]));
  return Response.json(seen, { headers: { "Cache-Control": "no-store" } });
}
