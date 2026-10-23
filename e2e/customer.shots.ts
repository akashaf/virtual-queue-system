import { type Page } from "@playwright/test";
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

/**
 * Screenshots of every Customer state at the 360px floor, in light and dark,
 * into `.shots/` (`bun run shots`). Not tests: nothing here asserts a design,
 * it only waits for each state so a reviewer — or an agent that cannot open a
 * browser — can look at the rendered page.
 */

test.use({
  geolocation: { latitude: SHOP_LAT, longitude: SHOP_LNG },
  permissions: ["geolocation", "notifications"],
  viewport: { width: 360, height: 780 },
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    const shot = (page: Page, name: string) =>
      page.screenshot({ path: `.shots/customer-${name}-${scheme}.png`, fullPage: true });

    test("join form", async ({ page }) => {
      const { shop } = await seedShop();
      await seedTicket(shop.slug, "Siti");
      await page.goto(`/s/${shop.slug}`);
      await expect(page.getByText("1 person waiting now")).toBeVisible();
      await shot(page, "join");
    });

    test("waiting, then out of date", async ({ page, context }) => {
      // Four ahead, against the default threshold of three: plain Waiting.
      const { shop } = await seedShop();
      for (const name of ["Siti", "Ahmad", "Mei", "Raj"]) await seedTicket(shop.slug, name);
      await join(page, shop.slug, "Ali");
      await expect(page.getByText("4 people ahead of you")).toBeVisible();
      await shot(page, "waiting");

      await context.setOffline(true);
      await expect(page.getByText("Not up to date")).toBeVisible();
      await shot(page, "out-of-date");
    });

    test("heads-up", async ({ page }) => {
      const { shop } = await seedShop();
      await seedTicket(shop.slug, "Siti");
      await join(page, shop.slug, "Ali");
      await expect(page.getByText("Head back to the shop now")).toBeVisible();
      await shot(page, "heads-up");
    });

    test("called, then left", async ({ page, browser }) => {
      const { email, password, shop } = await seedShop();
      await join(page, shop.slug, "Ali");

      const owner = await browser.newContext();
      const dashboard = await owner.newPage();
      await signInAsOwner(dashboard, email, password);
      await dashboard.getByRole("button", { name: "Call next" }).click();
      await expect(page.getByText("It's your turn")).toBeVisible();
      await shot(page, "called");
      await owner.close();

      await page.getByRole("button", { name: "Leave queue" }).click();
      await page.getByRole("button", { name: "Leave", exact: true }).click();
      await expect(page.getByText("You left the queue")).toBeVisible();
      await shot(page, "left");
    });
  });
}
