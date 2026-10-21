import { describe, expect, test } from "vitest";
import { cspHeaders } from "./csp";

const PRODUCTION = {
  nonce: "bm9uY2U=",
  supabaseUrl: "https://beolqxlclwhnvmoglgmo.supabase.co",
  sentryDsn: "https://abc123@o4512090327023616.ingest.us.sentry.io/4512090330000000",
  dev: false,
};

const PRODUCTION_POLICY = directives(cspHeaders(PRODUCTION));

/** The policy's directives, keyed by name, each a list of its sources. */
function directives(headers: Record<string, string>): Record<string, string[]> {
  const policy = headers["Content-Security-Policy-Report-Only"];
  return Object.fromEntries(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources]),
  );
}

describe("cspHeaders", () => {
  test("lets scripts run only with this request's nonce", () => {
    expect(PRODUCTION_POLICY["script-src"]).toEqual(
      expect.arrayContaining(["'nonce-bm9uY2U='", "'strict-dynamic'"]),
    );
    expect(PRODUCTION_POLICY["script-src"]).not.toContain("'unsafe-inline'");
  });

  test("allows eval in development only, where React uses it to rebuild server stacks", () => {
    expect(PRODUCTION_POLICY["script-src"]).not.toContain("'unsafe-eval'");
    expect(directives(cspHeaders({ ...PRODUCTION, dev: true }))["script-src"]).toContain(
      "'unsafe-eval'",
    );
  });

  test("lets the page register OneSignal's service worker from our own origin", () => {
    // Without worker-src the browser falls back to script-src, whose
    // 'strict-dynamic' ignores 'self' and so blocks the worker.
    expect(PRODUCTION_POLICY["worker-src"]).toEqual(["'self'"]);
  });

  test("plays the alert chimes, which the page synthesises into blob URLs", () => {
    expect(PRODUCTION_POLICY["media-src"]).toEqual(["'self'", "blob:"]);
  });

  test("shuts the doors a script can be smuggled in through", () => {
    expect(PRODUCTION_POLICY["default-src"]).toEqual(["'self'"]);
    expect(PRODUCTION_POLICY["object-src"]).toEqual(["'none'"]);
    expect(PRODUCTION_POLICY["base-uri"]).toEqual(["'none'"]);
    expect(PRODUCTION_POLICY["form-action"]).toEqual(["'self'"]);
    expect(PRODUCTION_POLICY["frame-ancestors"]).toEqual(["'none'"]);
  });

  test("connects only to ourselves, Supabase's API and Realtime, Sentry and OneSignal", () => {
    expect([...PRODUCTION_POLICY["connect-src"]].sort()).toEqual(
      [
        "'self'",
        "https://beolqxlclwhnvmoglgmo.supabase.co",
        "wss://beolqxlclwhnvmoglgmo.supabase.co",
        "https://o4512090327023616.ingest.us.sentry.io",
        "https://api.onesignal.com",
        "https://onesignal.com",
      ].sort(),
    );
  });

  test("reports violations to the Sentry project's security endpoint", () => {
    const endpoint =
      "https://o4512090327023616.ingest.us.sentry.io/api/4512090330000000/security/?sentry_key=abc123";
    const headers = cspHeaders(PRODUCTION);

    // report-uri for browsers without the Reporting API (Safari, Firefox);
    // Chromium follows report-to and ignores it.
    expect(directives(headers)["report-uri"]).toEqual([endpoint]);
    expect(directives(headers)["report-to"]).toEqual(["csp"]);
    expect(headers["Reporting-Endpoints"]).toBe(`csp="${endpoint}"`);
  });

  test("reports nowhere without a Sentry DSN, as Sentry itself sends nothing then", () => {
    const headers = cspHeaders({ ...PRODUCTION, sentryDsn: undefined });

    expect(directives(headers)["report-uri"]).toBeUndefined();
    expect(directives(headers)["report-to"]).toBeUndefined();
    expect(headers["Reporting-Endpoints"]).toBeUndefined();
    expect(headers["Content-Security-Policy-Report-Only"]).not.toContain("sentry");
  });

  test("reaches local Supabase over plain HTTP and WebSocket", () => {
    const local = cspHeaders({ ...PRODUCTION, supabaseUrl: "http://127.0.0.1:54321" });
    expect(directives(local)["connect-src"]).toEqual(
      expect.arrayContaining(["http://127.0.0.1:54321", "ws://127.0.0.1:54321"]),
    );
  });
});
