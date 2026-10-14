import type { Client } from "pg";

/**
 * Every Owner a test creates has an address on this domain, which is how test
 * data is told apart from anything made by hand in the same local database.
 */
export const TEST_EMAIL_DOMAIN = "example.test";

/**
 * Deletes the Owners the tests created and their Shops, which takes their Queue
 * Days, Tickets and push subscriptions with them. Shops and Owners made by hand
 * in the local database are left alone.
 *
 * Shared by the Vitest database suite, which runs it before each file, and the
 * Playwright suite, which runs it once all its tests have finished.
 */
export async function deleteTestData(db: Client) {
  const testOwners = `select id from auth.users where email like '%@${TEST_EMAIL_DOMAIN}'`;
  await db.query(`delete from public.shops where owner_user_id in (${testOwners})`);
  await db.query(`delete from auth.users where email like '%@${TEST_EMAIL_DOMAIN}'`);
}
