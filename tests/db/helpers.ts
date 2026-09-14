import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { inject } from "vitest";

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client: how Next.js calls Customer, Operator and cron functions. */
export function serviceClient() {
  const { apiUrl, serviceRoleKey } = inject("supabase");
  return createClient(apiUrl, serviceRoleKey, noSession);
}

/** Anon-key client: what a browser holds. */
export function anonClient() {
  const { apiUrl, anonKey } = inject("supabase");
  return createClient(apiUrl, anonKey, noSession);
}

/**
 * A direct Postgres connection as the superuser, for arranging fixtures and for
 * tests that need several independent connections (e.g. concurrent calls).
 * The caller must `end()` it.
 */
export async function connectDb() {
  const client = new Client({ connectionString: inject("supabase").dbUrl });
  await client.connect();
  return client;
}
