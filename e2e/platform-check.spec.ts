import { expect, test } from "@playwright/test";

// Throwaway (#3). Run against the deployed site with
//   E2E_BASE_URL=https://virtual-queue-system.netlify.app bunx playwright test e2e/platform-check.spec.ts
const remote = !!process.env.E2E_BASE_URL;
const AFTER_DELAY_MS = 5000; // Mirrors app/platform-check/actions.ts.

test("proxy.ts on Node, a Server Action and after() all work", async ({ page }) => {
  test.setTimeout(90_000);

  const response = await page.goto("/platform-check");
  expect(response?.headers()["x-platform-check-proxied"]).toMatch(/^node-\d+\./);
  await expect(page.getByTestId("proxy")).toHaveText(/Proxy: ran on node-\d+\./);
  if (remote) {
    await expect(page.getByTestId("store")).toHaveText("Store: netlify-blobs");
  }

  // Warm up so a cold start or dev compile doesn't count against the response timing.
  await page.getByRole("button", { name: "Run Server Action" }).click();
  await expect(page.getByTestId("action")).toContainText("Server Action: ran at");
  const warmUpRunId = await runIdOf(page);

  const startedAt = Date.now();
  await page.getByRole("button", { name: "Run Server Action" }).click();
  await expect(page.getByTestId("action")).not.toContainText(warmUpRunId, {
    timeout: AFTER_DELAY_MS,
  });
  const respondedInMs = Date.now() - startedAt;
  const runId = await runIdOf(page);

  // The action responded before its after() callback could have finished.
  expect(respondedInMs).toBeLessThan(AFTER_DELAY_MS - 1000);
  console.log(`Server Action responded in ${respondedInMs} ms`);

  // Navigate with a fresh GET: reload() would re-submit the form if a click happened
  // before hydration (a progressively enhanced POST), starting a new run.
  await expect(async () => {
    await page.goto("/platform-check");
    await expect(page.getByTestId("after")).toContainText(`for run ${runId}`, {
      timeout: 1_000,
    });
  }).toPass({ timeout: 45_000, intervals: [2_000] });
});

async function runIdOf(page: import("@playwright/test").Page) {
  const text = await page.getByTestId("action").textContent();
  const runId = text?.match(/run ([0-9a-f-]{36})/)?.[1];
  expect(runId, `no run id in "${text}"`).toBeTruthy();
  return runId!;
}
