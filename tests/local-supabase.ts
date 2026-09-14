import { execFileSync } from "node:child_process";

export interface LocalSupabase {
  apiUrl: string;
  dbUrl: string;
  publishableKey: string;
  secretKey: string;
}

/**
 * Connection details of the stack started with `bun run db:start`. Shared by the
 * Vitest database project and the Playwright suite, which both need them and
 * must never reach the cloud project (third-party.md §3).
 */
export function readLocalSupabase(): LocalSupabase {
  let status: Record<string, string>;
  try {
    const out = execFileSync("bunx", ["supabase", "status", "--output", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    status = JSON.parse(out.slice(out.indexOf("{")));
  } catch (error) {
    throw new Error(
      "Local Supabase is not running. Start it with `bun run db:start` before running these tests.",
      { cause: error },
    );
  }

  return {
    apiUrl: status.API_URL,
    dbUrl: status.DB_URL,
    publishableKey: status.PUBLISHABLE_KEY,
    secretKey: status.SECRET_KEY,
  };
}
