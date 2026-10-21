import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { cspHeaders, NONCE_HEADER } from "@/lib/csp";
import { requireEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Refreshes the Owner's Supabase session on every request, because Server
 * Components cannot write cookies, sends signed-out visitors away from the
 * dashboard, and gives every page its Content-Security-Policy (third-party.md §9).
 *
 * The redirect here is only an optimisation: it can see whether a session cookie
 * is valid, but not whether the Shop is still active. `app/dashboard/layout.tsx`
 * and every owner function do the authoritative check.
 */
export async function proxy(request: NextRequest) {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  // Only pages need a policy. The Route Handlers left in the matcher answer
  // with JSON, which no browser renders (third-party.md §9).
  const nonce = btoa(crypto.randomUUID());
  const csp = request.nextUrl.pathname.startsWith("/api/")
    ? null
    : cspHeaders({
        nonce,
        supabaseUrl,
        sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        dev: process.env.NODE_ENV === "development",
      });
  if (csp) {
    // Next reads the nonce from the request's policy header and puts it on
    // every script it renders; the root layout reads NONCE_HEADER for
    // next-themes' one. Every NextResponse.next({ request }) below forwards
    // these.
    for (const [name, value] of Object.entries(csp)) request.headers.set(name, value);
    request.headers.set(NONCE_HEADER, nonce);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    supabaseUrl,
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Without a session cookie this is local and free; with one it refreshes the
  // tokens and writes them onto `response` through setAll above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    const redirect = NextResponse.redirect(login);
    // Carry over anything setAll wrote, in particular the cookies Supabase emits
    // to clear an expired refresh token. Without this the stale cookie survives
    // every dashboard visit.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  if (csp) {
    for (const [name, value] of Object.entries(csp)) response.headers.set(name, value);
  }
  return response;
}

export const config = {
  // Everything except:
  //   * Next's internals, and any path with a file extension (the service
  //     worker, sounds, images and the QR route)
  //   * the routes that authenticate with a bearer key rather than a session.
  //     They need no refresh, and the liveness check in particular must not
  //     depend on Supabase being configured — it exists to verify a deploy.
  matcher: [
    "/((?!_next/static|_next/image|api/health|api/cron|api/operator|.*\\..*).*)",
  ],
};
