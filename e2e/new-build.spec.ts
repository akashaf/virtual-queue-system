import { expect, join, seedShop, SHOP_LAT, SHOP_LNG, test } from "./helpers";

test.use({
  geolocation: { latitude: SHOP_LAT, longitude: SHOP_LNG },
  permissions: ["geolocation", "notifications"],
});

test("a page left open across a deploy reloads instead of failing every press", async ({
  page,
}) => {
  const { shop } = await seedShop();
  await join(page, shop.slug, "Ali");
  await expect(page.getByText("You're next")).toBeVisible();

  // What the new build answers an old build's Server Action (the Sentry report
  // of 2026-10-23), for the next press only.
  let refused = false;
  await page.route((url) => url.pathname === `/s/${shop.slug}`, async (route) => {
    if (refused || route.request().method() !== "POST") return route.fallback();
    refused = true;
    await route.fulfill({
      status: 404,
      headers: { "content-type": "text/plain", "x-nextjs-action-not-found": "1" },
      body: "Server action not found.",
    });
  });

  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Leave queue" }).click();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await reloaded;

  // The device cookie kept the Ticket through the reload.
  expect(refused).toBe(true);
  await expect(page.getByText("You're next")).toBeVisible();
});

test("a form's Server Action from an older build reloads instead of the error page", async ({
  page,
}) => {
  const { shop } = await seedShop();
  await page.goto(`/s/${shop.slug}`);
  await expect(page.getByRole("heading", { name: shop.name })).toBeVisible();

  let refused = false;
  await page.route((url) => url.pathname === `/s/${shop.slug}`, async (route) => {
    if (refused || route.request().method() !== "POST") return route.fallback();
    refused = true;
    await route.fulfill({
      status: 404,
      headers: { "content-type": "text/plain", "x-nextjs-action-not-found": "1" },
      body: "Server action not found.",
    });
  });

  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "BM" }).click();
  await reloaded;

  expect(refused).toBe(true);
  await expect(page.getByRole("heading", { name: shop.name })).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
});
