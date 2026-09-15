import * as Sentry from "@sentry/nextjs";

/**
 * Everything this app sends to Sentry goes through here, on both the client and
 * the server (third-party.md §5).
 *
 * What a Customer gives the Shop is their name and where they stood when they
 * joined. Neither is the Operator's business when debugging, so both are filtered
 * out of every event and breadcrumb by key, wherever they turn up — the column
 * names and the function arguments alike.
 */
const PII_KEYS = new Set(["customer_name", "p_name", "lat", "lng", "p_lat", "p_lng"]);

const FILTERED = "[Filtered]";

/** A copy of `value` with every PII key's value replaced, at any depth. */
export function scrubPii<T>(value: T): T {
  if (Array.isArray(value)) return value.map(scrubPii) as T;
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      PII_KEYS.has(key) ? FILTERED : scrubPii(inner),
    ]),
  ) as T;
}

/**
 * The `Sentry.init` options every runtime shares.
 *
 * Without a DSN the SDK is disabled outright, so local development, the test
 * suites and a deploy that has not been given one send nothing. No replay
 * integration is added anywhere: session replay is out of the MVP.
 */
export function sentryOptions(dsn: string | undefined) {
  return {
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
    sendDefaultPii: false,
    beforeSend: <T extends object>(event: T): T => scrubPii(event),
    beforeBreadcrumb: <T extends object>(breadcrumb: T): T => scrubPii(breadcrumb),
  };
}

/**
 * Why a Postgres function refused, as the caller should show it.
 *
 * A rule the user ran into is passed through; anything else is a bug rather than
 * a situation, and is reported as one and answered `failed`.
 *
 * The functions `RAISE` their reasons as the error *message*, so that is what
 * `knownReasons` is matched against, not the Postgres `code` beside it.
 */
export function functionErrorReason<Reason extends string>(
  fn: string,
  error: { message: string; code?: string },
  knownReasons: readonly Reason[],
): Reason | "failed" {
  if (knownReasons.includes(error.message as Reason)) return error.message as Reason;

  capture(`${fn} failed`, error, {
    tags: { function: fn },
    fingerprint: ["function-error", fn, error.message],
  });
  return "failed";
}

/** Reports an error that was handled — turned into a 500, say — but should not have happened. */
export function reportUnexpected(context: string, error: unknown): void {
  capture(context, error, {});
}

/**
 * Sends a fresh error carrying only the message and the code, never the original.
 *
 * A Supabase error's `details` and `hint` are Postgres's, and for a constraint
 * violation `details` is the whole failing row — name and coordinates included,
 * as text no key-based scrubber can see into.
 */
function capture(
  title: string,
  error: unknown,
  hint: { tags?: Record<string, string>; fingerprint?: string[] },
): void {
  const { message, code } = (typeof error === "object" && error !== null ? error : {}) as {
    message?: unknown;
    code?: unknown;
  };
  const summary = {
    message: typeof message === "string" ? message : String(error),
    code: typeof code === "string" ? code : undefined,
  };

  console.error(title, summary);
  Sentry.captureException(new Error(`${title}: ${summary.message}`), {
    ...hint,
    extra: { code: summary.code },
  });
}

const GEOLOCATION_TIMEOUT = 3;

/**
 * Leaves a trail when the browser could not find the Customer in time.
 *
 * A timeout is weather, not a bug — a phone indoors often takes longer than we
 * wait — so it is only a breadcrumb, there to explain whatever error follows it.
 * A refused permission is the Customer's choice and is not recorded at all.
 */
export function recordLocationFailure(error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  if (code !== GEOLOCATION_TIMEOUT) return;

  Sentry.addBreadcrumb({ category: "geolocation", message: "timeout", level: "warning" });
}
