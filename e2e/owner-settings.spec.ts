import { expect, seedShop, signInAsOwner, test } from "./helpers";

test("the Owner signs out every other device and stays signed in on this one", async ({
  page,
  browser,
}) => {
  const { email, password } = await seedShop();
  const lost = await browser.newContext();
  const lostPhone = await lost.newPage();
  await signInAsOwner(lostPhone, email, password);
  await signInAsOwner(page, email, password);

  await page.getByRole("button", { name: "Menu" }).click();
  // Settings sits between History and Sign out.
  await expect(page.getByRole("menuitem")).toHaveText(["Queue", "History", "Settings", "Sign out"]);
  await page.getByRole("menuitem", { name: "Settings" }).click();
  // `next dev` compiles the route on its first visit; wait for the navigation itself.
  await page.waitForURL("/dashboard/settings");

  // Cancelling does nothing.
  await page.getByRole("button", { name: "Sign out other devices" }).click();
  await expect(
    page.getByText("Sign out every other device? They'll need the password to get back in."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await lostPhone.goto("/dashboard");
  await expect(lostPhone).toHaveURL("/dashboard");

  await page.getByRole("button", { name: "Sign out other devices" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sign out other devices" }).click();

  await expect(page.getByText("Every other device is signed out.")).toBeVisible();
  await expect(page).toHaveURL("/dashboard/settings");
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/dashboard");

  await lostPhone.goto("/dashboard");
  await expect(lostPhone).toHaveURL("/login");

  await lost.close();
});
