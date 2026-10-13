import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

// shadcn components are copied in on install, so one nobody uses lingers unnoticed.
describe("components/ui", () => {
  const root = join(__dirname, "..");
  const uiDir = join(root, "components", "ui");
  const sources = ["app", "components", "lib"]
    .flatMap((dir) => readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).map((f) => join(root, dir, f)))
    .filter((f) => /(?<!\.test)\.tsx?$/.test(f) && !f.startsWith(uiDir + sep))
    .map((f) => readFileSync(f, "utf8"));
  const imported = new Set(
    sources.flatMap((source) => [...source.matchAll(/"@\/components\/ui\/([\w-]+)"/g)].map((m) => m[1])),
  );
  const components = readdirSync(uiDir).map((f) => f.replace(/\.tsx$/, ""));

  it.each(components)("%s is imported outside components/ui", (name) => {
    expect([...imported]).toContain(name);
  });
});
