import { expect, test } from "@playwright/test";
import { deactivateShop, seedShop } from "./helpers";

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an Owner signs in, sees their Shop, and signs out again", async ({ page }) => {
  const { email, password, shop } = await seedShop();

  await signIn(page, email, password);

  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByRole("heading", { name: shop.name })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL("/login");
});

test("a wrong password is refused without saying which field was wrong", async ({ page }) => {
  const { email } = await seedShop();

  await signIn(page, email, "not-the-password");

  await expect(page.getByText("Wrong email or password")).toBeVisible();
  await expect(page).toHaveURL("/login");
});

test("an unknown email is refused the same way", async ({ page }) => {
  await signIn(page, "nobody@example.test", "correct-horse-battery");

  await expect(page.getByText("Wrong email or password")).toBeVisible();
});

test("the Owner of a Deactivated Shop is turned away", async ({ page }) => {
  const { email, password } = await seedShop({ isActive: false });

  await signIn(page, email, password);

  await expect(
    page.getByText("This shop account is inactive, contact support"),
  ).toBeVisible();
  await expect(page).toHaveURL("/login");
});

test("a Deactivated Shop's Owner cannot stay on the dashboard", async ({ page }) => {
  const { email, password, shop } = await seedShop();
  await signIn(page, email, password);
  await expect(page).toHaveURL("/dashboard");

  await deactivateShop(shop.id);

  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login\?error=inactive/);
  await expect(
    page.getByText("This shop account is inactive, contact support"),
  ).toBeVisible();
});

test("a signed-out visitor is sent from the dashboard to login", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("there is no sign-up or forgot-password way out of the login page", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("link", { name: /sign up|forgot/i })).toHaveCount(0);
});
