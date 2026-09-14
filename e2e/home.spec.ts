import { expect, test } from "@playwright/test";

test("home page tells visitors to scan the shop's QR code", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Scan the QR code at your barbershop" }),
  ).toBeVisible();
});
