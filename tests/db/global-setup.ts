import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

export interface LocalSupabase {
  apiUrl: string;
  dbUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    supabase: LocalSupabase;
  }
}

/** Reads the connection details of the local stack started with `bun run db:start`. */
export default function setup(project: TestProject) {
  let status: Record<string, string>;
  try {
    const out = execFileSync("bunx", ["supabase", "status", "--output", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    status = JSON.parse(out.slice(out.indexOf("{")));
  } catch (error) {
    throw new Error(
      "Local Supabase is not running. Start it with `bun run db:start` before running database tests.",
      { cause: error },
    );
  }

  project.provide("supabase", {
    apiUrl: status.API_URL,
    dbUrl: status.DB_URL,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
  });
}
