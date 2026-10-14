import { Client } from "pg";
import { readLocalSupabase } from "../tests/local-supabase";
import { deleteTestData } from "../tests/test-data";

/** Removes the Owners and Shops the specs seeded, so runs don't pile up in the local database. */
export default async function globalTeardown() {
  const db = new Client({ connectionString: readLocalSupabase().dbUrl });
  await db.connect();
  try {
    await deleteTestData(db);
  } finally {
    await db.end();
  }
}
