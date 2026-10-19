import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // Tests import server modules directly, outside the react-server condition.
    alias: {
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["{app,lib}/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          globalSetup: ["tests/db/global-setup.ts"],
          // Queue-function tests share one local database; run files one at a time.
          fileParallelism: false,
          // Every round trip goes through the Docker VM, so a busy Mac slows these tests
          // three to six times over: the slowest took 1 s quiet and 4.3 s loaded, and
          // crossing Vitest's 5 s default failed whichever test was unlucky. A hang
          // still fails, only later.
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
    ],
  },
});
