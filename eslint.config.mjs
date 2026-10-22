import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsdoc from "eslint-plugin-jsdoc";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // A local `netlify deploy` leaves generated bundles here, and flat config
    // does not read .gitignore: they failed lint and blocked a push.
    ".netlify/**",
  ]),
  {
    rules: {
      // A Server Action shaped for useActionState is handed a previous state and
      // a FormData whether it wants them or not. The repo already spells the
      // ones it ignores `_previous`; this makes that convention the rule.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // e2e/helpers.ts wraps Playwright's `test` to fail any test whose pages
    // break the Content-Security-Policy; a spec importing the plain one would
    // silently skip that check.
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              // `default` is `test` again.
              importNames: ["test", "expect", "default"],
              message: "Import test and expect from ./helpers, which checks the Content-Security-Policy.",
            },
          ],
        },
      ],
    },
  },
  {
    // The doc-comment rule and its exemptions: CODING_STANDARDS.md, Comments.
    files: ["{app,lib}/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "app/**/{page,layout,route,loading,error,global-error,not-found,forbidden,unauthorized,template,default}.{ts,tsx}",
      "app/**/{opengraph-image,twitter-image,icon,apple-icon,sitemap,robots,manifest}.{ts,tsx}",
      "app/**/actions.ts",
    ],
    plugins: { jsdoc },
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
        },
      ],
    },
  },
]);

export default eslintConfig;
