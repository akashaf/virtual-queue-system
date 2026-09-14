import { NextResponse, type NextRequest } from "next/server";

// Throwaway (#3): proves proxy.ts runs on the deployed site, on the Node.js runtime
// (process.versions.node does not exist on edge runtimes). #4 replaces this with the
// Supabase session refresh.
export function proxy(request: NextRequest) {
  const runtime = `node-${process.versions?.node ?? "unavailable"}`;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-platform-check-proxy-runtime", runtime);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-platform-check-proxied", runtime);
  return response;
}

export const config = {
  matcher: "/platform-check",
};
