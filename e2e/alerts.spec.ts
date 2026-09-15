import { expect, test, type Page } from "@playwright/test";
import { seedShop, seedTicket, signInAsOwner, SHOP_LAT, SHOP_LNG } from "./helpers";

test.use({
  geolocation: { latitude: SHOP_LAT, longitude: SHOP_LNG },
  permissions: ["geolocation"],
});

// Counts every sound the page starts. Headless Chromium has nothing to play it
// on, so the count — not the audio — is what these tests can see.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const counter = window as unknown as { soundsPlayed: number };
    counter.soundsPlayed = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      counter.soundsPlayed++;
      return play.call(this).catch(() => {});
    };
  });
});

function soundsPlayed(page: Page) {
  return page.evaluate(() => (window as unknown as { soundsPlayed: number }).soundsPlayed);
}

async function join(page: Page, slug: string, name: string) {
  await page.goto(`/s/${slug}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join queue" }).click();
  await expect(page.getByRole("button", { name: "Join queue" })).toHaveCount(0);
}

test("a Customer whose turn approaches is told to head back", async ({ page, browser }) => {
  // Four ahead, against the default threshold of three: just outside it.
  const { email, password, shop } = await seedShop();
  for (const name of ["Siti", "Ahmad", "Mei", "Raj"]) await seedTicket(shop.slug, name);
  await join(page, shop.slug, "Ali");
  await expect(page.getByText("4 people ahead of you")).toBeVisible();
  await expect(page.getByText("Head back to the shop now")).toHaveCount(0);
  // Only the Join tap's silent clip, which unlocks audio for later.
  expect(await soundsPlayed(page)).toBe(1);

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await dashboard.getByRole("button", { name: "Call next" }).click();

  await expect(page.getByText("3 people ahead of you")).toBeVisible();
  await expect(page.getByText("Head back to the shop now")).toBeVisible();
  await expect(page).toHaveTitle("⏰ Almost your turn");
  await expect.poll(() => soundsPlayed(page)).toBe(2);

  await owner.close();
});

test("a Called Customer is chimed at until they say they're coming", async ({
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
  await expect(page).toHaveTitle("🔔 Your turn!");
  // The chime on the call, and again five seconds later.
  await expect.poll(() => soundsPlayed(page), { timeout: 8_000 }).toBeGreaterThanOrEqual(3);

  await page.getByRole("button", { name: "I'm coming" }).click();

  await expect(page.getByRole("button", { name: "I'm coming" })).toHaveCount(0);
  await expect(page).toHaveTitle("Join the queue");
  const afterAcknowledging = await soundsPlayed(page);
  await page.waitForTimeout(6_000);
  expect(await soundsPlayed(page)).toBe(afterAcknowledging);
  // Still their turn: acknowledging silences the page, it does not leave the chair.
  await expect(page.getByText("It's your turn")).toBeVisible();

  await owner.close();
});

test("a Called Customer whose page reloaded is still chimed at", async ({ page, browser }) => {
  // iPhone Safari discards background tabs: the Customer comes back to a page
  // that loads already Called, and must not find it silent.
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await dashboard.getByRole("button", { name: "Call next" }).click();
  await expect(page.getByText("It's your turn")).toBeVisible();

  await page.goto(`/s/${shop.slug}`);

  await expect(page.getByRole("button", { name: "I'm coming" })).toBeVisible();
  await expect(page).toHaveTitle("🔔 Your turn!");
  await expect.poll(() => soundsPlayed(page)).toBeGreaterThanOrEqual(1);

  await owner.close();
});
