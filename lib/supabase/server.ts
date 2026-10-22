import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";
import type { Database } from "./database.types";

/** Supabase client acting as the signed-in Owner, from the request's session cookies. */
export async function createClient() {
  return createCookieClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  );
}

/**
 * Supabase client for the password sign-in call alone, writing the session
 * cookies as `createClient` does (#37). Supabase Auth rate-limits sign-ins per
 * caller IP, and the caller is our server, so the Owner's IP is forwarded in
 * `sb-forwarded-for`. Auth honours that header only with the secret key, so this
 * client must make no other call: everything after sign-in uses `createClient`,
 * where Row Level Security applies (third-party.md §3).
 */
export async function createSignInClient(ownerIp: string | null) {
  return createCookieClient(
    requireEnv("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY),
    ownerIp ? { "sb-forwarded-for": ownerIp } : {},
  );
}

async function createCookieClient(key: string, headers: Record<string, string> = {}) {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    key,
    {
      global: { headers },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // proxy.ts refreshes the session instead.
          }
        },
      },
    },
  );
}
