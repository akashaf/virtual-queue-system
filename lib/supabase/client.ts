import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client with the anon key. It has no table or function grants;
 * use it only for Auth and Realtime broadcast subscriptions.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
