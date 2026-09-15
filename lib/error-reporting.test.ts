import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { CUSTOMER_ERRORS } from "@/lib/customer/view";
import { OWNER_ERRORS } from "@/lib/owner/view";
import {
  functionErrorReason,
  recordLocationFailure,
  reportUnexpected,
  scrubPii,
  sentryOptions,
} from "./error-reporting";

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const KNOWN = ["too_far", "queue_full"] as const;

describe("functionErrorReason", () => {
  test("passes a known code through without reporting it", () => {
    expect(functionErrorReason("join_queue", { message: "too_far" }, KNOWN)).toBe("too_far");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  test("reports anything else and answers failed", () => {
    const reason = functionErrorReason(
      "join_queue",
      { message: "deadlock detected", code: "40P01" },
      KNOWN,
    );

    expect(reason).toBe("failed");
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    const [error, hint] = vi.mocked(Sentry.captureException).mock.calls[0];
    expect((error as Error).message).toBe("join_queue failed: deadlock detected");
    expect(hint).toEqual({
      tags: { function: "join_queue" },
      extra: { code: "40P01" },
      fingerprint: ["function-error", "join_queue", "deadlock detected"],
    });
  });

  test("does not send the error's details, which Postgres fills with the failing row", () => {
    const postgrestError = {
      message: 'new row for relation "tickets" violates check constraint',
      code: "23514",
      details: "Failing row contains (…, Ali, 3.1390, 101.6869, …).",
      hint: "",
    };
    functionErrorReason("join_queue", postgrestError, KNOWN);

    const sent = JSON.stringify(vi.mocked(Sentry.captureException).mock.calls[0]);
    expect(sent).not.toContain("Ali");
    expect(sent).not.toContain("101.6869");
  });

  test("fingerprints by function and message, so a bug stays one issue however often it recurs", () => {
    functionErrorReason("call_next", { message: "boom" }, KNOWN);

    const [, hint] = vi.mocked(Sentry.captureException).mock.calls[0];
    expect(hint).toMatchObject({ fingerprint: ["function-error", "call_next", "boom"] });
  });
});

/**
 * Every reason the app ships, written out here rather than read from the source,
 * so that dropping or renaming one fails these tests instead of passing them with
 * one case fewer.
 *
 * The db suites pin what Postgres raises; these pin that the app still calls each
 * one a situation. Lose either half and a rule the user ran into quietly becomes a
 * generic failure and an alert, with the suite still green.
 */
const SHIPPED_CUSTOMER_REASONS = [
  "shop_inactive",
  "last_call",
  "already_in_queue",
  "too_far",
  "queue_full",
  "not_rejoinable",
  "ticket_not_found",
] as const;

const SHIPPED_OWNER_REASONS = [
  "shop_inactive",
  "queue_empty",
  "ticket_not_found",
  "undo_expired",
  "rejoined",
  "too_early",
] as const;

describe("the shipped reason lists", () => {
  test("the Customer list is exactly the one above", () => {
    expect([...CUSTOMER_ERRORS]).toEqual([...SHIPPED_CUSTOMER_REASONS]);
  });

  test("the Owner list is exactly the one above", () => {
    expect([...OWNER_ERRORS]).toEqual([...SHIPPED_OWNER_REASONS]);
  });

  test.each(SHIPPED_CUSTOMER_REASONS)(
    "%s is explained to the Customer, not reported",
    (message) => {
      expect(functionErrorReason("join_queue", { message }, CUSTOMER_ERRORS)).toBe(message);
      expect(Sentry.captureException).not.toHaveBeenCalled();
    },
  );

  test.each(SHIPPED_OWNER_REASONS)("%s is explained to the Owner, not reported", (message) => {
    expect(functionErrorReason("call_next", { message }, OWNER_ERRORS)).toBe(message);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe("reportUnexpected", () => {
  test("captures what was being attempted, the message and the code", () => {
    reportUnexpected("Could not create the Owner", { message: "auth down", code: "unexpected_failure" });

    const [error, hint] = vi.mocked(Sentry.captureException).mock.calls[0];
    expect((error as Error).message).toBe("Could not create the Owner: auth down");
    expect(hint).toEqual({ extra: { code: "unexpected_failure" } });
  });

  test("sends neither details nor hint, which can quote the row", () => {
    reportUnexpected("Could not create the Shop", {
      message: 'new row for relation "shops" violates check constraint',
      code: "23514",
      details: "Failing row contains (…, 3.1390, 101.6869, …).",
      hint: "Coordinates 101.6869 out of range",
    });

    const sent = JSON.stringify(vi.mocked(Sentry.captureException).mock.calls[0]);
    expect(sent).not.toContain("101.6869");
  });

  test("copes with something thrown that is not an error at all", () => {
    reportUnexpected("Could not create the Owner", "offline");

    const [error] = vi.mocked(Sentry.captureException).mock.calls[0];
    expect((error as Error).message).toBe("Could not create the Owner: offline");
  });
});

describe("scrubPii", () => {
  test("filters customer names and coordinates at any depth", () => {
    const event = {
      message: "join failed",
      extra: { customer_name: "Ali", lat: 3.139, lng: 101.6869, accuracyM: 12 },
      breadcrumbs: [{ data: { args: { p_name: "Ali", p_lat: 3.139, p_lng: 101.6869 } } }],
    };

    expect(scrubPii(event)).toEqual({
      message: "join failed",
      extra: { customer_name: "[Filtered]", lat: "[Filtered]", lng: "[Filtered]", accuracyM: 12 },
      breadcrumbs: [
        { data: { args: { p_name: "[Filtered]", p_lat: "[Filtered]", p_lng: "[Filtered]" } } },
      ],
    });
  });

  test("leaves everything else, and the original, untouched", () => {
    const event = { tags: { function: "call_next" }, extra: { lat: 1 } };
    scrubPii(event);

    expect(event.extra.lat).toBe(1);
    expect(scrubPii({ level: "error", count: 2, ok: null })).toEqual({
      level: "error",
      count: 2,
      ok: null,
    });
  });
});

describe("sentryOptions", () => {
  test("is disabled without a DSN, so local runs and tests send nothing", () => {
    expect(sentryOptions(undefined)).toMatchObject({ enabled: false });
    expect(sentryOptions("")).toMatchObject({ enabled: false });
  });

  test("never sends default PII, and scrubs events and breadcrumbs", () => {
    const options = sentryOptions("https://key@o1.ingest.sentry.io/1");

    expect(options).toMatchObject({ enabled: true, sendDefaultPii: false });
    expect(options.beforeSend({ extra: { customer_name: "Ali" } })).toEqual({
      extra: { customer_name: "[Filtered]" },
    });
    expect(options.beforeBreadcrumb({ data: { lat: 3.1 } })).toEqual({
      data: { lat: "[Filtered]" },
    });
  });
});

describe("recordLocationFailure", () => {
  const TIMEOUT = 3;

  test("leaves a breadcrumb for a timeout, and nothing more", () => {
    recordLocationFailure({ code: TIMEOUT, message: "Timeout expired" });

    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: "geolocation",
      message: "timeout",
      level: "warning",
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  test.each([
    ["a refused permission", { code: 1 }],
    ["a lost signal", { code: 2 }],
    ["an unsupported browser", new Error("geolocation_unsupported")],
  ])("records nothing for %s", (_label, error) => {
    recordLocationFailure(error);

    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
