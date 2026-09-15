import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/error-reporting";

/**
 * Browser error tracking (third-party.md §5). Unhandled errors and rejections are
 * captured by the SDK's default integrations; session replay is deliberately not
 * among them.
 */
Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN));

/**
 * Required by the SDK, which warns on every build without it. It only feeds
 * navigation tracing, which is off, so it records nothing.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
