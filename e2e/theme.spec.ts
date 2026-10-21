import { expect, seedShop, test } from "./helpers";

// next-themes puts the resolved theme on <html> as a class, which globals.css keys off.
for (const colorScheme of ["dark", "light"] as const) {
  test.describe(`on a ${colorScheme}-mode device`, () => {
    test.use({ colorScheme });

    test(`the Customer page uses the ${colorScheme} theme`, async ({ page }) => {
      const { shop } = await seedShop();

      await page.goto(`/s/${shop.slug}`);
      await expect(page.getByRole("heading", { name: shop.name })).toBeVisible();
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${colorScheme}\\b`));
    });
  });
}
