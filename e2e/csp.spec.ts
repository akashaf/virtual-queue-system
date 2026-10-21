import {
  expect,
  join,
  seedShop,
  seedTicket,
  SHOP_LAT,
  SHOP_LNG,
  signInAsOwner,
  test,
} from "./helpers";

test.use({
  geolocation: { latitude: SHOP_LAT, longitude: SHOP_LNG },
  permissions: ["geolocation", "notifications"],
});

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

/**
 * The flows the policy must not get in the way of, end to end in one test. The
 * shared `test` fails it on any violation; every other spec gets the same check
 * on the pages it visits.
 */
test("signing in, a live dashboard and a Customer joining raise no violations", async ({
  page,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await seedTicket(shop.slug, "Ali");

  // The login page, then the dashboard it lands on.
  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  const board = dashboard.getByRole("main").getByRole("listitem");
  await expect(board.filter({ hasText: "Ali" })).toBeVisible();

  await join(page, shop.slug, "Siti");

  // Siti reaches the board through Realtime, not a reload.
  await expect(board.filter({ hasText: "Siti" })).toBeVisible();
  await dashboard.getByRole("button", { name: "Call next" }).click();
  await expect(dashboard.getByText("Called #001 Ali")).toBeVisible();

  await owner.close();
});
