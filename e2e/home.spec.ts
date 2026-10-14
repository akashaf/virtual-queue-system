import { expect, test } from "@playwright/test";
import { seedShop, signInAsOwner } from "./helpers";

test("the home page sends visitors to sign in, temporarily", async ({ page, request }) => {
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe("/login");

  await page.goto("/");

  await expect(page).toHaveURL("/login");
  await expect(page.getByText("Waiting for a haircut? Scan the QR code at the shop.")).toBeVisible();
});

test("a signed-in Owner who opens the home page lands on the dashboard", async ({ page }) => {
  const { email, password, shop } = await seedShop();
  await signInAsOwner(page, email, password);

  await page.goto("/");

  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByRole("heading", { name: shop.name })).toBeVisible();
});

test("a Customer who chose Bahasa Malaysia is told to scan in Bahasa Malaysia", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "vq_lang", value: "ms", url: baseURL }]);

  await page.goto("/");

  await expect(
    page.getByText("Menunggu giliran untuk gunting rambut? Imbas kod QR di kedai."),
  ).toBeVisible();
  // Only the Customer's line is translated; the form stays the Owner's.
  await expect(page.getByRole("heading", { name: "Shop sign in" })).toBeVisible();
});

test.describe("with a Malay browser", () => {
  test.use({ locale: "ms-MY" });

  test("the line follows the browser's language", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByText("Menunggu giliran untuk gunting rambut? Imbas kod QR di kedai."),
    ).toBeVisible();
  });
});
