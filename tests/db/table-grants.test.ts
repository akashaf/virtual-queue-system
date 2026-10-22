import { afterAll, beforeAll, expect, test } from "vitest";
import type { Client } from "pg";
import { connectDb } from "./helpers";

let db: Client;

beforeAll(async () => {
  db = await connectDb();
});

afterAll(async () => {
  await db.end();
});

const ROLES = ["anon", "authenticated", "service_role"];
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

/**
 * What each Data API role may do to each public table. Supabase stops
 * auto-granting new tables from 2026-10-30, and still auto-grants them on older
 * stacks, so a table missing here, or granted more or less than listed, fails.
 */
const EXPECTED: Record<string, Record<string, string[]>> = {
  push_sends: { anon: [], authenticated: [], service_role: PRIVILEGES },
  queue_days: { anon: [], authenticated: ["SELECT"], service_role: PRIVILEGES },
  shops: { anon: [], authenticated: ["SELECT"], service_role: PRIVILEGES },
  tickets: { anon: [], authenticated: ["SELECT"], service_role: PRIVILEGES },
};

test("every public table grants each Data API role exactly what it needs", async () => {
  const { rows } = await db.query<{ table: string; role: string; privileges: string[] }>(
    `
    select c.relname as table, r.role,
           coalesce(
             array_agg(p.privilege order by p.n)
               filter (where has_table_privilege(r.role, c.oid, p.privilege)),
             '{}'
           ) as privileges
      from pg_class c
     cross join unnest($1::text[]) as r(role)
     cross join unnest($2::text[]) with ordinality as p(privilege, n)
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm')
     group by c.relname, r.role
  `,
    [ROLES, PRIVILEGES],
  );

  // Every table and view gets a row per role, even with no grants at all, so a
  // new one fails here until it is listed above.
  const actual: Record<string, Record<string, string[]>> = {};
  for (const { table, role, privileges } of rows) {
    actual[table] ??= {};
    actual[table][role] = privileges;
  }

  expect(actual).toEqual(EXPECTED);
});
