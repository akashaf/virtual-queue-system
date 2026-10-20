import { expect, test, type Browser, type Page } from "@playwright/test";
import { backdateCalls, seedShop, signInAsOwner, SHOP_LAT, SHOP_LNG } from "./helpers";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_WHATSAPP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 WhatsApp/2.24.9.78";
const ANDROID_WHATSAPP =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 WhatsApp/2.24.9.78";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const IN_APP_BANNER = "Open in Chrome/Safari to get alerts";
const IPHONE_OLD_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1";
const IPHONE_HOME_SCREEN =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

// Standing at the shop's front door, which is what the Join Radius asks for.
const AT_SHOP_FRONT = {
  geolocation: { latitude: SHOP_LAT, longitude: SHOP_LNG },
  permissions: ["geolocation", "notifications"],
};

test.use(AT_SHOP_FRONT);

async function join(page: Page, slug: string, name: string) {
  await page.goto(`/s/${slug}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join queue" }).click();
}

test.describe("iPhone Safari", () => {
  test.use({ userAgent: IPHONE_SAFARI });

  test("shows the install steps and no way to join", async ({ page }) => {
    const { shop } = await seedShop();
    await page.goto(`/s/${shop.slug}`);

    await expect(
      page.getByRole("heading", { name: "Add this page to your Home Screen to join" }),
    ).toBeVisible();
    await expect(page.getByText("Choose Add to Home Screen")).toBeVisible();
    await expect(page.getByRole("button", { name: "Join queue" })).toHaveCount(0);
    await expect(page.getByLabel("Your name")).toHaveCount(0);
  });

  test("links a manifest that opens this Shop as a Home Screen app", async ({ page }) => {
    const { shop } = await seedShop();
    await page.goto(`/s/${shop.slug}`);

    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBe(`/s/${shop.slug}/app.webmanifest`);

    const response = await page.request.get(href!);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({
      name: shop.name,
      start_url: `/s/${shop.slug}`,
      display: "standalone",
    });
  });
});

test.describe("an iPhone in-app browser", () => {
  test.use({ userAgent: IPHONE_WHATSAPP });

  test("says to open the page in Safari first", async ({ page }) => {
    const { shop } = await seedShop();
    await page.goto(`/s/${shop.slug}`);

    await expect(
      page.getByRole("heading", { name: "Open this page in Safari first" }),
    ).toBeVisible();
    await expect(page.getByText("Choose Add to Home Screen")).toBeVisible();
    await expect(page.getByRole("button", { name: "Join queue" })).toHaveCount(0);
    // The card says it already; the banner would only repeat it.
    await expect(page.getByText(IN_APP_BANNER)).toHaveCount(0);
  });

  test("still shows the banner over a Ticket it already holds", async ({
    page,
    browser,
  }) => {
    const { shop } = await seedShop();
    // A new context inherits this block's user agent, so it needs its own.
    const desktop = await browser.newContext({ ...AT_SHOP_FRONT, userAgent: DESKTOP_CHROME });
    const joined = await desktop.newPage();
    await join(joined, shop.slug, "Ali");
    await expect(joined.getByText("#001")).toBeVisible();

    await page.context().addCookies((await desktop.storageState()).cookies);
    await page.goto(`/s/${shop.slug}`);

    await expect(page.getByText("#001")).toBeVisible();
    await expect(page.getByText(IN_APP_BANNER)).toBeVisible();

    await desktop.close();
  });
});

test.describe("an Android in-app browser", () => {
  test.use({ userAgent: ANDROID_WHATSAPP });

  test("keeps the banner and the normal form", async ({ page }) => {
    const { shop } = await seedShop();
    await page.goto(`/s/${shop.slug}`);

    await expect(page.getByText(IN_APP_BANNER)).toBeVisible();
    await expect(page.getByRole("button", { name: "Join queue" })).toBeVisible();
  });
});

test.describe("an iPhone older than iOS 16.4", () => {
  test.use({ userAgent: IPHONE_OLD_SAFARI });

  test("joins from Safari as before", async ({ page }) => {
    const { shop } = await seedShop();
    await join(page, shop.slug, "Ali");

    await expect(page.getByText("#001")).toBeVisible();
  });
});

test.describe("the installed Home Screen app", () => {
  // Notifications not granted: headless Chromium then answers "denied", which
  // is where a Customer who declined ends up.
  test.use({ userAgent: IPHONE_HOME_SCREEN, permissions: ["geolocation"] });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { value: true });
    });
  });

  test("joins, and a Customer who declines alerts is still in the Queue", async ({
    page,
  }) => {
    const { shop } = await seedShop();
    await join(page, shop.slug, "Ali");

    await expect(page.getByText("#001")).toBeVisible();
    await expect(page.getByText("Keep this page open")).toBeVisible();
    await expect(
      page.getByText("The sound plays at your media volume, not your ringer"),
    ).toBeVisible();
  });
});

/** An iPhone Safari tab that inherits a device, and its Ticket, from `from`. */
async function iphoneSafariWith(browser: Browser, from: Page) {
  const context = await browser.newContext({
    userAgent: IPHONE_SAFARI,
    storageState: await from.context().storageState(),
    ...AT_SHOP_FRONT,
  });
  return { context, page: await context.newPage() };
}

test("a Ticket joined before the gate still shows in iPhone Safari", async ({
  page,
  browser,
}) => {
  const { shop } = await seedShop();
  await join(page, shop.slug, "Ali");
  await expect(page.getByText("#001")).toBeVisible();

  const iphone = await iphoneSafariWith(browser, page);
  await iphone.page.goto(`/s/${shop.slug}`);

  await expect(iphone.page.getByText("#001")).toBeVisible();
  await expect(iphone.page.getByText("Add this page to your Home Screen")).toHaveCount(0);

  await iphone.context.close();
});

test("Rejoin from a No-show is not gated in iPhone Safari", async ({ page, browser }) => {
  const { email, password, shop } = await seedShop();
  await join(page, shop.slug, "Ali");
  await expect(page.getByText("#001")).toBeVisible();

  const owner = await browser.newContext();
  const dashboard = await owner.newPage();
  await signInAsOwner(dashboard, email, password);
  await dashboard.getByRole("button", { name: "Call next" }).click();
  await expect(dashboard.getByText("Waiting 0 · In chair 1")).toBeVisible();
  await backdateCalls(shop.id, 6);
  await dashboard.goto("/dashboard");
  await dashboard.getByRole("button", { name: /^No-show for #\d{3}$/ }).click();
  await expect(page.getByText("You missed your turn")).toBeVisible();

  const iphone = await iphoneSafariWith(browser, page);
  await iphone.page.goto(`/s/${shop.slug}`);
  await iphone.page.getByRole("button", { name: "Join again" }).click();

  await expect(iphone.page.getByText("#002")).toBeVisible();

  await iphone.context.close();
  await owner.close();
});
