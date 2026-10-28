import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import type { Database } from "../lib/supabase/database.types";
import { readLocalSupabase } from "../tests/local-supabase";
import { SHOP_LAT, SHOP_LNG } from "../tests/shop-location";

export { SHOP_LAT, SHOP_LNG };

/**
 * Playwright's `test`, failing any test in which a page breaks the
 * Content-Security-Policy (third-party.md §9). Every spec imports it from here.
 *
 * The policy is enforced, so a violation blocks the script or connection,
 * and the page may fail later in a way that looks unrelated. The browser's
 * `securitypolicyviolation` event names the real cause, so every test fails
 * on it directly. Contexts a test opens itself through `browser.newContext`
 * are watched too.
 */
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    // Not `use`, Playwright's usual name: the React hooks lint rule claims it.
    async ({ context, browser }, runTest) => {
      const violations: string[] = [];
      await watchViolations(context, violations);

      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const created = await newContext(options);
        await watchViolations(created, violations);
        return created;
      };
      try {
        await runTest(violations);
      } finally {
        browser.newContext = newContext;
      }

      expect(violations, "Content-Security-Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

async function watchViolations(context: BrowserContext, violations: string[]) {
  await context.exposeBinding("__cspViolation", (_source, violation: string) => {
    violations.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __cspViolation: (v: string) => void })
        .__cspViolation;
      const blocked = event.blockedURI || "inline";
      report(`${event.effectiveDirective} blocked ${blocked} on ${event.documentURI}`);
    });
  });
}

const { apiUrl, dbUrl, publishableKey, secretKey } = readLocalSupabase();

const admin = createClient<Database>(apiUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Onboards a Shop and its Owner against local Supabase, as the Operator API does. */
export async function seedShop({ isActive = true, maxQueueSize = 30 } = {}) {
  const email = `owner-${crypto.randomUUID()}@example.test`;
  const password = "correct-horse-battery";

  const { data: created, error: ownerError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (ownerError) throw ownerError;
  const owner = created.user;

  const { data: shop, error: shopError } = await admin.rpc("create_shop", {
    p_slug: `shop-${crypto.randomUUID().slice(0, 8)}`,
    p_name: "Kedai Gunting Rambut Ali",
    p_owner_user_id: owner.id,
    p_lat: SHOP_LAT,
    p_lng: SHOP_LNG,
    p_max_queue_size: maxQueueSize,
  });
  if (shopError) throw shopError;

  if (!isActive) await deactivateShop(shop.id);

  return { email, password, shop };
}

/** Puts a Customer in a Shop's Queue without a browser, to stand ahead of the one under test. */
export async function seedTicket(slug: string, name: string) {
  const { error } = await admin.rpc("join_queue", {
    p_slug: slug,
    p_device_id: crypto.randomUUID(),
    p_name: name,
    p_lat: SHOP_LAT,
    p_lng: SHOP_LNG,
    p_accuracy_m: 0,
  });
  if (error) throw new Error(error.message);
}

/**
 * Starts the Shop's Queue Day by serving one Customer through the Owner's own
 * presses. Until a day's first Call next nobody is told to head back (#41), so
 * a test of the Heads-up banner starts the day first.
 */
export async function startQueueDay(slug: string, email: string, password: string) {
  await seedTicket(slug, "Zul");
  const owner = createClient<Database>(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await owner.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const { data, error: callError } = await owner.rpc("call_next");
  if (callError) throw new Error(callError.message);
  const called = (data as { result: { id: string } }).result;
  const { error: serveError } = await owner.rpc("mark_served", { p_ticket_id: called.id });
  if (serveError) throw new Error(serveError.message);
  await owner.auth.signOut();
}

/** Fills in a Shop's join form as a Customer and submits it, without waiting for the outcome. */
export async function submitJoin(page: Page, slug: string, name: string) {
  await page.goto(`/s/${slug}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join queue" }).click();
}

/** Joins a Shop's Queue as a Customer, returning once the join has gone through. */
export async function join(page: Page, slug: string, name: string) {
  await submitJoin(page, slug, name);
  await expect(page.getByRole("button", { name: "Join queue" })).toHaveCount(0);
}

/** Signs an Owner in on their own page, landing them on the dashboard. */
export async function signInAsOwner(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");
}

/**
 * Moves a Shop's calls back in time, so a test can reach the five-minute No-show
 * window without waiting five minutes for it.
 */
export async function backdateCalls(shopId: string, minutes: number) {
  const calledAt = new Date(Date.now() - minutes * 60_000).toISOString();
  const { error } = await admin
    .from("tickets")
    .update({ called_at: calledAt })
    .eq("shop_id", shopId)
    .eq("status", "called");
  if (error) throw error;
}

/**
 * Reads a Shop's joining state straight from the database. The dashboard shows
 * a press optimistically, so a test that must not outrun the server — opening
 * another page that depends on Last Call being on — polls this instead.
 */
export async function shopJoiningState(id: string) {
  const { data, error } = await admin
    .from("shops")
    .select("joining_state")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data.joining_state;
}

/** Switches a Shop off, the way `PATCH /api/operator/shops/[slug]` will. */
export async function deactivateShop(id: string) {
  const { error } = await admin.from("shops").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}

/**
 * Backdates every one of an Owner's Sign-ins, as if they had signed in `days`
 * ago. `auth.sessions` is not exposed through the Data API, so this goes
 * straight to Postgres.
 */
export async function ageSignIns(email: string, days: number) {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  try {
    await db.query(
      `update auth.sessions s set created_at = now() - make_interval(days => $2)
         from auth.users u
        where u.id = s.user_id and u.email = $1`,
      [email.toLowerCase(), days],
    );
  } finally {
    await db.end();
  }
}
