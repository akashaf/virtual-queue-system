import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright drives the dev server over 127.0.0.1, which Next otherwise treats
  // as a cross-origin host and blocks from loading dev resources.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
