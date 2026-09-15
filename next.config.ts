import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Playwright drives the dev server over 127.0.0.1, which Next otherwise treats
  // as a cross-origin host and blocks from loading dev resources.
  allowedDevOrigins: ["127.0.0.1"],
};

export default withSentryConfig(nextConfig, {
  // SENTRY_ORG, SENTRY_PROJECT and SENTRY_AUTH_TOKEN are read from the build
  // environment. Without the token there is nothing to upload to, so a local or
  // CI build skips source maps rather than warning about it.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  silent: !process.env.CI,
  telemetry: false,
});
