import { expect, test, type Page } from "@playwright/test";
import { seedShop, seedTicket, signInAsOwner, SHOP_LAT, SHOP_LNG } from "./helpers";

// Standing at the shop's front door, which is what the Join Radius asks for.
test.use({
  geolocation: { latitude: SHOP_LAT, longitude: SHOP_LNG },
  permissions: ["geolocation", "notifications"],
});

/** A promise settled from outside, for holding a response until the test says so. */
function deferred() {
  let settle!: () => void;
  const done = new Promise<void>((resolve) => (settle = resolve));
  return { done, settle };
}

async function join(page: Page, slug: string, name: string) {
  await page.goto(`/s/${slug}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join queue" }).click();
  await expect(page.getByRole("button", { name: "Join queue" })).toHaveCount(0);
}

/**
 * The core loop, on the two screens that have to agree about it. Nothing here
 * reloads the Customer's page: everything it shows after the join arrives
 * through the queue_changed ping and the refetch it triggers.
 */
test("the Owner calls the Customer and marks them done, live on both screens", async ({
  page,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  const row = dashboard.getByRole("listitem").filter({ hasText: "Ali" });
  await expect(row).toContainText("#001");

  await dashboard.getByRole("button", { name: "Call next" }).click();

  await expect(dashboard.getByText("Waiting 0 · In chair 1")).toBeVisible();
  await expect(row).toContainText("called just now");
  await expect(page.getByText("It's your turn")).toBeVisible();
  await expect(page.getByText("Go to the counter")).toBeVisible();

  await dashboard.getByRole("button", { name: "Done" }).click();

  await expect(dashboard.getByText("Waiting 0 · In chair 0")).toBeVisible();
  await expect(page.getByText("Thanks! See you next time")).toBeVisible();

  await owner.close();
});

test("Call next is not offered when nobody is waiting", async ({ page }) => {
  const { email, password } = await seedShop();
  await signInAsOwner(page, email, password);

  await expect(page.getByRole("button", { name: "Call next" })).toBeDisabled();
});

test("a Done can be taken back, and the Customer is in the chair again", async ({
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
  await dashboard.getByRole("button", { name: "Done" }).click();

  // The toast counts the window down while the Owner decides.
  const toast = dashboard.getByText("#001 marked done");
  await expect(toast).toBeVisible();
  await dashboard.getByRole("button", { name: "Undo" }).first().click();

  await expect(dashboard.getByText("Waiting 0 · In chair 1")).toBeVisible();
  await expect(page.getByText("It's your turn")).toBeVisible();

  await owner.close();
});

test("a Done still waiting to be undone survives a reload of the dashboard", async ({
  page,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await dashboard.getByRole("button", { name: "Call next" }).click();
  await dashboard.getByRole("button", { name: "Done" }).click();
  await expect(dashboard.getByText("Just served (1)")).toBeVisible();

  await dashboard.goto("/dashboard");

  await expect(dashboard.getByText("Just served (1)")).toBeVisible();
  await dashboard.getByText("Just served (1)").click();
  await dashboard.getByRole("button", { name: "Undo" }).click();

  await expect(dashboard.getByText("Waiting 0 · In chair 1")).toBeVisible();

  await owner.close();
});

test("undoing from Just served takes the toast's offer away too", async ({
  page,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await dashboard.getByRole("button", { name: "Call next" }).click();
  await dashboard.getByRole("button", { name: "Done" }).click();
  await expect(dashboard.getByText("#001 marked done")).toBeVisible();

  const justServed = dashboard.locator("details");
  await justServed.getByText("Just served (1)").click();
  await justServed.getByRole("button", { name: "Undo" }).click();

  // Otherwise the toast would keep counting down and offering an Undo that can
  // only answer "that ticket is no longer in the queue".
  await expect(dashboard.getByText("#001 marked done")).toHaveCount(0);
  await expect(dashboard.getByText("Waiting 0 · In chair 1")).toBeVisible();

  await owner.close();
});

test("a Customer who rejoins after being served cannot be undone over", async ({
  page,
  browser,
}) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await dashboard.getByRole("button", { name: "Call next" }).click();
  await dashboard.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Thanks! See you next time")).toBeVisible();

  // Done freed the device, so the same phone can take a new place — which is
  // what puts the old Ticket and the new one in each other's way.
  await page.getByRole("button", { name: "Join queue" }).click();
  await join(page, shop.slug, "Ali");
  await expect(page.getByText("#002")).toBeVisible();

  await dashboard.getByRole("button", { name: "Undo" }).first().click();

  await expect(
    dashboard.getByText("That customer has already rejoined the queue"),
  ).toBeVisible();
  await expect(dashboard.getByText("Waiting 1 · In chair 0")).toBeVisible();

  await owner.close();
});

test("an older Queue arriving late does not replace the Owner's newer one", async ({ page }) => {
  // #32: the board applied whichever answer landed last, and one read before
  // Call next but delivered after it put the called Customer back in Waiting
  // until the 30 s poll.
  const { email, password, shop } = await seedShop();
  await seedTicket(shop.slug, "Siti");
  await signInAsOwner(page, email, password);
  await expect(page.getByText("Waiting 1 · In chair 0")).toBeVisible();

  // The refetch Ahmad's join triggers is answered at once and delivered later.
  // If the ping were missed, `answered` never settles and the test times out.
  const answered = deferred();
  const release = deferred();
  const delivered = deferred();
  let heldOne = false;
  await page.route("**/api/owner/queue", async (route) => {
    if (heldOne) return route.continue();
    heldOne = true;
    const response = await route.fetch();
    answered.settle();
    await release.done;
    await route.fulfill({ response });
    delivered.settle();
  });
  await seedTicket(shop.slug, "Ahmad");
  await answered.done;

  await page.getByRole("button", { name: "Call next" }).click();
  await expect(page.getByText("Waiting 1 · In chair 1")).toBeVisible();
  // Long enough for the press's own refetch and the call's ping to land first.
  await page.waitForTimeout(2_000);
  release.settle();
  await delivered.done;
  // Time for the board to render whatever it made of it.
  await page.waitForTimeout(1_000);

  await expect(page.getByText("Waiting 1 · In chair 1")).toBeVisible();
  await expect(page.getByText("Waiting 2 · In chair 0")).toHaveCount(0);
});

test("the Customer sees their turn in Bahasa Malaysia too", async ({ page, browser }) => {
  const { email, password, shop } = await seedShop();
  await page.goto(`/s/${shop.slug}`);
  await page.getByRole("button", { name: "BM" }).click();
  await page.getByLabel("Nama anda").fill("Ali");
  await page.getByRole("button", { name: "Sertai giliran" }).click();
  await expect(page.getByText("#001")).toBeVisible();

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await dashboard.getByRole("button", { name: "Call next" }).click();

  await expect(page.getByText("Giliran anda")).toBeVisible();
  await expect(page.getByText("Sila ke kaunter")).toBeVisible();

  await owner.close();
});
