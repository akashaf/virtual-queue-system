import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/error-reporting";

/**
 * Server-side error tracking (third-party.md §5). `@sentry/nextjs` resolves to
 * the right SDK for whichever runtime calls this, so one init serves both.
 */
export function register() {
  Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN));
}

/** Unhandled errors from Server Components, Route Handlers, Server Actions and the proxy. */
export const onRequestError = Sentry.captureRequestError;
