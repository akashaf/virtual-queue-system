import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// The scheduled function lives outside app/ and lib/, where Vitest does not look.
import daily, { config } from "@/netlify/functions/daily.mjs";

const SITE_URL = "https://virtual-queue-system.netlify.app";
const CRON_SECRET = "test-cron-secret-9d2e4a7b1c6f";

describe("the Netlify scheduled function", () => {
  beforeEach(() => {
    vi.stubEnv("URL", SITE_URL);
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("runs at 19:00 UTC, which is 03:00 in Malaysia", () => {
    expect(config).toEqual({ schedule: "0 19 * * *" });
  });

  test("only calls the cron route, with the secret", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await daily();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${SITE_URL}/api/cron/daily`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
  });

  test("fails loudly when the route does, so the run shows as failed in Netlify", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));

    await expect(daily()).rejects.toThrow("401");
  });

  test("refuses to call without a secret rather than sending an empty one", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("CRON_SECRET", "");

    await expect(daily()).rejects.toThrow("CRON_SECRET");
    expect(fetch).not.toHaveBeenCalled();
  });
});
