import { expect, test, type Page } from "@playwright/test";
import {
  deactivateShop,
  seedShop,
  seedTicket,
  signInAsOwner,
  SHOP_LAT,
  SHOP_LNG,
} from "./helpers";

// Standing at the shop's front door, which is what the Join Radius asks for.
test.use({
  geolocation: { latitude: SHOP_LAT, longitude: SHOP_LNG },
  permissions: ["geolocation", "notifications"],
});

async function join(page: Page, slug: string, name: string) {
  await page.goto(`/s/${slug}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join queue" }).click();
}

test("a Customer at the shop joins and sees their number and position", async ({
  page,
}) => {
  const { shop } = await seedShop();
  await seedTicket(shop.slug, "Siti");

  await page.goto(`/s/${shop.slug}`);
  await expect(page.getByRole("heading", { name: shop.name })).toBeVisible();
  await expect(page.getByText("1 person waiting now")).toBeVisible();

  await join(page, shop.slug, "Ali");

  await expect(page.getByText("#002")).toBeVisible();
  await expect(page.getByText("1 person ahead of you")).toBeVisible();
  await expect(
    page.getByText("Customers waiting in person may be served in between"),
  ).toBeVisible();
});

test("the first Customer of the day is told they are next", async ({ page }) => {
  const { shop } = await seedShop();

  await join(page, shop.slug, "Ali");

  await expect(page.getByText("#001")).toBeVisible();
  await expect(page.getByText("You're next")).toBeVisible();
});

test("the Ticket survives a reload, because the device cookie does", async ({ page }) => {
  const { shop } = await seedShop();
  await join(page, shop.slug, "Ali");
  await expect(page.getByText("#001")).toBeVisible();

  await page.goto(`/s/${shop.slug}`);

  await expect(page.getByText("#001")).toBeVisible();
  await expect(page.getByRole("button", { name: "Join queue" })).toHaveCount(0);
});

test("the Owner sees the Customer in the Waiting list", async ({ page, browser }) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");
  await expect(page.getByText("#001")).toBeVisible();

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);

  await expect(dashboard.getByText("Waiting 1 · In chair 0")).toBeVisible();
  const row = dashboard.getByRole("listitem").filter({ hasText: "Ali" });
  await expect(row).toContainText("#001");
  await expect(row).toContainText(/\d{1,2}:\d{2} (am|pm)/);

  await owner.close();
});

test("a Customer's page never shows another Customer's name", async ({ page }) => {
  const { shop } = await seedShop();
  await seedTicket(shop.slug, "Siti");

  await join(page, shop.slug, "Ali");

  await expect(page.getByText("#002")).toBeVisible();
  await expect(page.getByText("Siti")).toHaveCount(0);
});

test("a Customer cannot take two places in one queue", async ({ page }) => {
  const { shop } = await seedShop();
  await join(page, shop.slug, "Ali");
  await expect(page.getByText("#001")).toBeVisible();

  // The join form is gone, so reaching it again means clearing the page's idea
  // of the Ticket — the server still knows.
  await page.goto(`/s/${shop.slug}`);
  await expect(page.getByText("#001")).toBeVisible();
});

test("a Shop that does not exist says only that it is not taking customers", async ({
  page,
}) => {
  await page.goto("/s/no-such-shop");

  await expect(
    page.getByText("This shop isn't accepting customers right now"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Join queue" })).toHaveCount(0);
});

test("a Deactivated Shop says the same thing", async ({ page }) => {
  const { shop } = await seedShop();
  await deactivateShop(shop.id);

  await page.goto(`/s/${shop.slug}`);

  await expect(
    page.getByText("This shop isn't accepting customers right now"),
  ).toBeVisible();
});

test("the Customer page can be read in Bahasa Malaysia", async ({ page }) => {
  const { shop } = await seedShop();

  await page.goto(`/s/${shop.slug}`);
  await page.getByRole("button", { name: "BM" }).click();

  await expect(page.getByLabel("Nama anda")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sertai giliran" })).toBeVisible();

  await page.getByLabel("Nama anda").fill("Ali");
  await page.getByRole("button", { name: "Sertai giliran" }).click();

  await expect(page.getByText("#001")).toBeVisible();
  await expect(page.getByText("Anda seterusnya")).toBeVisible();
});

test("the chosen language outlasts the visit", async ({ page }) => {
  const { shop } = await seedShop();
  await page.goto(`/s/${shop.slug}`);
  await page.getByRole("button", { name: "BM" }).click();
  await expect(page.getByLabel("Nama anda")).toBeVisible();

  await page.goto(`/s/${shop.slug}`);

  await expect(page.getByLabel("Nama anda")).toBeVisible();
});

test("a Customer who has not typed a name is asked for one", async ({ page }) => {
  const { shop } = await seedShop();

  await page.goto(`/s/${shop.slug}`);
  await page.getByRole("button", { name: "Join queue" }).click();

  await expect(page.getByText("Please enter your name")).toBeVisible();
  await expect(page.getByText("#001")).toHaveCount(0);
});

test.describe("away from the shop", () => {
  test.use({ geolocation: { latitude: SHOP_LAT + 0.05, longitude: SHOP_LNG } });

  test("a Customer far from the shop is refused and can try again", async ({ page }) => {
    const { shop } = await seedShop();

    await join(page, shop.slug, "Ali");

    await expect(page.getByText("You need to be at the shop to join")).toBeVisible();

    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("button", { name: "Join queue" })).toBeVisible();
  });
});

test.describe("with location refused", () => {
  test.use({ permissions: [] });

  test("a Customer who blocks location is told how to allow it", async ({ page }) => {
    const { shop } = await seedShop();

    await join(page, shop.slug, "Ali");

    await expect(
      page.getByText("We need your location to let you join"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

test.describe("a full Queue", () => {
  test("turns away the next Customer", async ({ page }) => {
    const { shop } = await seedShop({ maxQueueSize: 1 });
    await seedTicket(shop.slug, "Siti");

    await join(page, shop.slug, "Ali");

    await expect(page.getByText("Queue full, please check back soon")).toBeVisible();
  });
});
