import { afterAll, beforeAll, expect, test } from "vitest";
import type { Client } from "pg";
import { anonClient, connectDb, serviceClient } from "./helpers";

let db: Client;

beforeAll(async () => {
  db = await connectDb();
});

afterAll(async () => {
  await db.end();
});

test("connects directly to local Postgres with the Supabase schemas", async () => {
  const { rows } = await db.query(
    "select count(*)::int as n from pg_namespace where nspname in ('auth', 'realtime')",
  );
  expect(rows[0].n).toBe(2);
});

test("the service-role client reaches the Auth admin API", async () => {
  const { error } = await serviceClient().auth.admin.listUsers({ perPage: 1 });
  expect(error).toBeNull();
});

test("public sign-ups are disabled, so the anon key cannot create Owners", async () => {
  const { error } = await anonClient().auth.signUp({
    email: `nobody-${Date.now()}@example.com`,
    password: "correct-horse-battery",
  });
  expect(error?.code).toBe("signup_disabled");
});

test("an Owner created by the service role can sign in with a password", async () => {
  const email = `owner-${Date.now()}@example.com`;
  const password = "correct-horse-battery";
  const admin = serviceClient();
  const { data, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(createError).toBeNull();

  try {
    const { error } = await anonClient().auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
  } finally {
    await admin.auth.admin.deleteUser(data.user!.id);
  }
});
