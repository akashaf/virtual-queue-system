import { expect, test, type Page } from "@playwright/test";
import {
  seedShop,
  shopJoiningState,
  signInAsOwner,
  SHOP_LAT,
  SHOP_LNG,
} from "./helpers";

// Standing at the shop's front door, which is what the Join Radius asks for.
// Notifications granted, or the push explanation sheet blocks every later tap.
test.use({
  geolocation: { latitude: SHOP_LAT, longitude: SHOP_LNG },
  permissions: ["geolocation", "notifications"],
});

async function join(page: Page, slug: string, name: string) {
  await page.goto(`/s/${slug}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join queue" }).click();
  await expect(page.getByRole("button", { name: "Join queue" })).toHaveCount(0);
}

async function startLastCall(dashboard: Page, shopId: string) {
  await dashboard.getByRole("button", { name: "Last Call" }).click();
  await dashboard.getByRole("button", { name: "Start last call" }).click();
  await expect(dashboard.getByText("Last Call", { exact: true })).toBeVisible();
  // The badge above is optimistic; what follows must not outrun the server.
  await expect.poll(() => shopJoiningState(shopId)).toBe("last_call");
}

test("a carry choice moves the Customer to the front of the next day", async ({
  page,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");
  await expect(page.getByText("#001")).toBeVisible();

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await startLastCall(dashboard, shop.id);
  await expect(dashboard.getByRole("button", { name: "Reopen joining" })).toBeVisible();

  // The question reaches the waiting Customer, and their answer reaches the board.
  await expect(page.getByText("Shop is closing soon", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move to next day" }).click();
  await expect(page.getByRole("button", { name: "✓ Move to next day" })).toBeVisible();
  await expect(dashboard.getByText("Chose: next day")).toBeVisible();

  // The confirmation counts what Close Shop will do, then does it.
  await dashboard.getByRole("button", { name: "Close Shop" }).click();
  await expect(
    dashboard.getByText("1 moving to next day, 0 will be removed."),
  ).toBeVisible();
  await dashboard
    .getByRole("alertdialog")
    .getByRole("button", { name: "Close Shop" })
    .click();

  // A new day: the door is open, and the carried Customer is at its front.
  await expect(dashboard.getByText("Open", { exact: true })).toBeVisible();
  await expect(dashboard.getByText("Moved from previous day")).toBeVisible();
  await expect(page.getByText("#001")).toBeVisible();
  await expect(page.getByText("Moved from previous day")).toBeVisible();
  await expect(page.getByText("You're next")).toBeVisible();

  await owner.close();
});

test("staying ends at Close Shop, and the shop stops taking new customers", async ({
  page,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await startLastCall(dashboard, shop.id);

  // A visitor without a Ticket meets the closing notice, not the join form.
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(`/s/${shop.slug}`);
  await expect(
    visitorPage.getByText("Shop is closing soon, not taking new customers"),
  ).toBeVisible();
  await visitor.close();

  await page.getByRole("button", { name: "Stay today" }).click();
  await expect(dashboard.getByText("Chose: stay")).toBeVisible();

  await dashboard.getByRole("button", { name: "Close Shop" }).click();
  await expect(
    dashboard.getByText("0 moving to next day, 1 will be removed."),
  ).toBeVisible();
  await dashboard
    .getByRole("alertdialog")
    .getByRole("button", { name: "Close Shop" })
    .click();

  await expect(
    page.getByText("Shop closed, sorry, come back tomorrow"),
  ).toBeVisible();

  // Tapping past the goodbye meets the join form: a new Queue Day is open.
  await page.getByRole("button", { name: "Join queue" }).click();
  await expect(page.getByLabel("Your name")).toBeVisible();

  await owner.close();
});

test("Close Shop waits for the chairs, and Reopen joining takes Last Call back", async ({
  page,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await dashboard.getByRole("button", { name: "Call next" }).click();
  await expect(dashboard.getByText("Waiting 0 · In chair 1")).toBeVisible();
  await startLastCall(dashboard, shop.id);

  // A chair is busy: the dialog explains instead of offering to close.
  await dashboard.getByRole("button", { name: "Close Shop" }).click();
  await expect(
    dashboard.getByText("Finish or mark no-show for customers in chair first."),
  ).toBeVisible();
  await expect(
    dashboard.getByRole("alertdialog").getByRole("button", { name: "Close Shop" }),
  ).toHaveCount(0);
  await dashboard.getByRole("button", { name: "OK" }).click();

  await dashboard.getByRole("button", { name: "Reopen joining" }).click();
  await expect(dashboard.getByText("Open", { exact: true })).toBeVisible();
  await expect(dashboard.getByRole("button", { name: "Last Call" })).toBeVisible();

  await owner.close();
});
