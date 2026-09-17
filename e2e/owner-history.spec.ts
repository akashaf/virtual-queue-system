import { expect, test } from "@playwright/test";
import { seedShop, seedTicket, signInAsOwner } from "./helpers";

test("the Owner sees today's Tickets and what this month's Served Tickets come to", async ({
  page,
}) => {
  const { email, password, shop } = await seedShop();
  await seedTicket(shop.slug, "Ali");
  await seedTicket(shop.slug, "Bala");
  await signInAsOwner(page, email, password);
  await page.getByRole("button", { name: "Call next" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Waiting 1 · In chair 0")).toBeVisible();
  // Straight away, while the Undo toast is still up: it must not be in the way.
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: "History" }).click();

  // Waits for the navigation itself: `next dev` compiles the route on its first
  // visit, which under a full run can outlast an assertion's five seconds.
  await page.waitForURL("/dashboard/history");
  await expect(page.getByText("Served: 1 · Amount due: RM 0.25")).toBeVisible();
  const rows = page.getByRole("row");
  await expect(rows.filter({ hasText: "#001" })).toContainText(/Ali\s*Served/);
  await expect(rows.filter({ hasText: "#002" })).toContainText(/Bala\s*Waiting/);
  await expect(page.getByRole("listitem").first()).toContainText("1 served");
});
