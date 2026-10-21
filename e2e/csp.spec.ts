import { expect, test, type BrowserContext } from "@playwright/test";
import { seedShop, seedTicket, signInAsOwner, SHOP_LAT, SHOP_LNG } from "./helpers";

test.use({
  geolocation: { latitude: SHOP_LAT, longitude: SHOP_LNG },
  permissions: ["geolocation", "notifications"],
});

/**
 * Collects every Content-Security-Policy violation any page in `context`
 * raises. The policy is report-only, so a violation blocks nothing and the
 * page works regardless: the browser's `securitypolicyviolation` event is the
 * only place it shows.
 */
async function watchViolations(context: BrowserContext) {
  const violations: string[] = [];
  await context.exposeBinding("__cspViolation", (_source, violation: string) => {
    violations.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __cspViolation: (v: string) => void })
        .__cspViolation;
      report(`${event.effectiveDirective} blocked ${event.blockedURI || "inline"} on ${event.documentURI}`);
    });
  });
  return violations;
}

test("pages are sent a report-only policy and no enforcing one", async ({ request }) => {
  const { shop } = await seedShop();

  for (const path of ["/login", `/s/${shop.slug}`]) {
    const response = await request.get(path);
    expect(response.headers()["content-security-policy-report-only"], path).toContain(
      "'strict-dynamic'",
    );
    expect(response.headers()["content-security-policy"], path).toBeUndefined();
  }
});

test("routes that serve JSON or files are sent no policy", async ({ request }) => {
  const { shop } = await seedShop();

  for (const response of [
    await request.get("/api/health"),
    await request.post("/api/cron/daily"),
    await request.get("/api/operator/shops"),
    await request.get(`/api/operator/shops/${shop.slug}/qr.png`),
  ]) {
    expect(response.headers()["content-security-policy-report-only"], response.url()).toBeUndefined();
    expect(response.headers()["content-security-policy"], response.url()).toBeUndefined();
  }
});

test("signing in, a live dashboard and a Customer joining raise no violations", async ({
  page,
  context,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await seedTicket(shop.slug, "Ali");

  const owner = await browser.newContext();
  const ownerViolations = await watchViolations(owner);
  const customerViolations = await watchViolations(context);

  // The login page, then the dashboard it lands on.
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  const board = dashboard.getByRole("main").getByRole("listitem");
  await expect(board.filter({ hasText: "Ali" })).toBeVisible();

  await page.goto(`/s/${shop.slug}`);
  await page.getByLabel("Your name").fill("Siti");
  await page.getByRole("button", { name: "Join queue" }).click();
  await expect(page.getByRole("button", { name: "Join queue" })).toHaveCount(0);

  // Siti reaches the board through Realtime, not a reload.
  await expect(board.filter({ hasText: "Siti" })).toBeVisible();
  await dashboard.getByRole("button", { name: "Call next" }).click();
  await expect(dashboard.getByText("Called #001 Ali")).toBeVisible();

  expect([...ownerViolations, ...customerViolations]).toEqual([]);
  await owner.close();
});
