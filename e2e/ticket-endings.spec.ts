import { expect, test, type Page } from "@playwright/test";
import { backdateCalls, seedShop, signInAsOwner, SHOP_LAT, SHOP_LNG } from "./helpers";

// Standing at the shop's front door, which is what the Join Radius asks for.
test.use({
  geolocation: { latitude: SHOP_LAT, longitude: SHOP_LNG },
  permissions: ["geolocation"],
});

/**
 * Calls the front of the Queue and gives up on the Customer, winding the clock
 * past the five minutes rather than waiting them out. The wait for "In chair 1"
 * matters: backdating before the call has landed would find nothing to move.
 */
async function callAndGiveUp(dashboard: Page, shopId: string) {
  await dashboard.getByRole("button", { name: "Call next" }).click();
  await expect(dashboard.getByText("Waiting 0 · In chair 1")).toBeVisible();

  await backdateCalls(shopId, 6);
  await dashboard.goto("/dashboard");
  await dashboard.getByRole("button", { name: "No-show", exact: true }).click();
}

async function join(page: Page, slug: string, name: string) {
  await page.goto(`/s/${slug}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join queue" }).click();
  await expect(page.getByRole("button", { name: "Join queue" })).toHaveCount(0);
}

test("a Customer leaves the queue, and the Owner's board empties", async ({
  page,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await expect(dashboard.getByText("Waiting 1 · In chair 0")).toBeVisible();

  await page.getByRole("button", { name: "Leave queue" }).click();
  await expect(page.getByText("Leave the queue?")).toBeVisible();
  await page.getByRole("button", { name: "Leave", exact: true }).click();

  await expect(page.getByText("You left the queue")).toBeVisible();
  await expect(dashboard.getByText("Waiting 0 · In chair 0")).toBeVisible();

  // Tapping past it is what brings the join form back.
  await page.getByRole("button", { name: "Join queue" }).click();
  await expect(page.getByLabel("Your name")).toBeVisible();

  await owner.close();
});

test("a Customer who changed their mind can stay", async ({ page }) => {
  const { shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  await page.getByRole("button", { name: "Leave queue" }).click();
  await page.getByRole("button", { name: "Stay in the queue" }).click();

  await expect(page.getByText("#001")).toBeVisible();
});

test("the Owner removes a Customer, and their page says so", async ({
  page,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);

  await dashboard.getByRole("button", { name: "More for #001" }).click();
  await dashboard.getByRole("menuitem", { name: "Remove" }).click();
  await expect(dashboard.getByText("Remove #001 · Ali?")).toBeVisible();
  await dashboard.getByRole("button", { name: "Remove", exact: true }).click();

  await expect(page.getByText("Your ticket was removed")).toBeVisible();
  await expect(dashboard.getByText("Waiting 0 · In chair 0")).toBeVisible();

  await owner.close();
});

test("No-show waits five minutes, then lets the Customer come back", async ({
  page,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await dashboard.getByRole("button", { name: "Call next" }).click();
  await expect(page.getByText("It's your turn")).toBeVisible();

  // The chair waits with the Customer, counting down rather than going quiet.
  const noShow = dashboard.getByRole("button", { name: /No-show/ });
  await expect(noShow).toBeDisabled();
  await expect(noShow).toContainText(/No-show \d:\d\d/);

  await backdateCalls(shop.id, 6);
  await dashboard.goto("/dashboard");
  await dashboard.getByRole("button", { name: "No-show", exact: true }).click();

  await expect(page.getByText("You missed your turn")).toBeVisible();
  await expect(dashboard.getByText("Waiting 0 · In chair 0")).toBeVisible();

  // The way back in skips the location check, so no prompt appears.
  await page.getByRole("button", { name: "Join again" }).click();

  await expect(page.getByText("#002")).toBeVisible();
  const row = dashboard.getByRole("listitem").filter({ hasText: "Ali" });
  await expect(row).toContainText("Rejoined");

  await owner.close();
});

test("a Customer may only rejoin once from one scan", async ({ page, browser }) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await callAndGiveUp(dashboard, shop.id);
  await expect(page.getByText("You missed your turn")).toBeVisible();
  await page.getByRole("button", { name: "Join again" }).click();
  await expect(page.getByText("#002")).toBeVisible();

  // Missing the rejoined Ticket too leaves no second way in: one scan, one Rejoin.
  await callAndGiveUp(dashboard, shop.id);

  await expect(page.getByText("You missed your turn")).toBeVisible();
  await expect(
    page.getByText("Scan the QR code at the shop to join again"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Join again" })).toHaveCount(0);

  // The offer has gone, but the screen has not: tapping past it is what makes
  // scanning the QR code — the very thing it asks for — lead anywhere.
  await page.getByRole("button", { name: "Join queue" }).click();
  await expect(page.getByLabel("Your name")).toBeVisible();

  await owner.close();
});
