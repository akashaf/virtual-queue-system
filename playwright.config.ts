import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["./e2e/load-reporter.ts"], [process.env.CI ? "github" : "list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Pixel 7"] } },
    // Screenshots, not tests (e2e/*.shots.ts): only `bun run shots` asks for them.
    ...(process.env.SHOTS
      ? [{ name: "shots", testMatch: /\.shots\.ts$/, use: { ...devices["Pixel 7"] } }]
      : []),
  ],
  webServer: {
    command: `bunx next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
