import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { parseBillingMonth } from "./billing";
import {
  parseCreateShopInput,
  parseOwnerPasswordInput,
  parseUpdateShopInput,
} from "./shop-input";

/**
 * `docs/openapi.yaml` is what the Operator imports into Postman, so it has to
 * describe the routes that actually exist, and its examples have to be bodies
 * the routes accept: a wrong one is only found while standing in a Shop.
 */

const ROOT = join(__dirname, "..", "..");
const DOCUMENTED_ROUTE_DIRS = ["app/api/operator", "app/api/health"];
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

interface Operation {
  operationId: string;
  parameters?: { name: string; in: string; example?: unknown }[];
  requestBody?: {
    content: {
      "application/json": { example?: unknown; examples?: Record<string, { value: unknown }> };
    };
  };
}

type PathItem = Partial<Record<(typeof HTTP_METHODS)[number], Operation>>;

const spec = parse(readFileSync(join(ROOT, "docs/openapi.yaml"), "utf8")) as {
  paths: Record<string, PathItem>;
};

/** `app/api/operator/shops/[slug]/route.ts` → `/api/operator/shops/{slug}`. */
function routePath(file: string): string {
  const dir = relative(join(ROOT, "app"), file).split(sep).slice(0, -1);
  return "/" + dir.map((part) => part.replace(/^\[(.+)\]$/, "{$1}")).join("/");
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

/** Each route's methods, as `"GET /api/..."`, read from its exported handlers. */
function routesInCode(): string[] {
  return DOCUMENTED_ROUTE_DIRS.flatMap((dir) => routeFiles(join(ROOT, dir))).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const exported = source.matchAll(/export\s+(?:const|async\s+function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g);
    return [...exported].map(([, method]) => `${method} ${routePath(file)}`);
  });
}

function routesInSpec(): string[] {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    HTTP_METHODS.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${path}`),
  );
}

function operation(operationId: string): Operation {
  for (const item of Object.values(spec.paths)) {
    for (const method of HTTP_METHODS) {
      if (item[method]?.operationId === operationId) return item[method];
    }
  }
  throw new Error(`No operation ${operationId} in docs/openapi.yaml`);
}

/** Every example body an operation offers, named so a failure says which. */
function exampleBodies(operationId: string): [string, unknown][] {
  const json = operation(operationId).requestBody?.content["application/json"];
  if (!json) throw new Error(`${operationId} has no JSON request body`);

  const named = Object.entries(json.examples ?? {}).map(
    ([name, example]) => [name, example.value] as [string, unknown],
  );
  return json.example === undefined ? named : [["example", json.example], ...named];
}

describe("docs/openapi.yaml", () => {
  test("documents exactly the Operator routes and the health check", () => {
    expect(routesInSpec().sort()).toEqual(routesInCode().sort());
  });

  test.each([
    ["createShop", parseCreateShopInput],
    ["updateShop", parseUpdateShopInput],
    ["resetOwnerPassword", parseOwnerPasswordInput],
  ] as const)("every %s example body is accepted", (operationId, parseBody) => {
    const bodies = exampleBodies(operationId);
    expect(bodies.length).toBeGreaterThan(0);

    for (const [name, body] of bodies) {
      expect(parseBody(body), `${operationId} example "${name}"`).toMatchObject({ ok: true });
    }
  });

  test("the billing example month is accepted", () => {
    const month = operation("getBilling").parameters?.find((p) => p.name === "month");
    expect(parseBillingMonth(month?.example as string)).toMatchObject({ ok: true });
  });
});
