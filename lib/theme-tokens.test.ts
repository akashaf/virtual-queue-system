import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { findFixedColours } from "./theme-tokens";

describe("findFixedColours", () => {
  it("flags Tailwind palette colours, with or without shade, opacity or variant", () => {
    expect(
      findFixedColours(
        'className="bg-green-500 text-white hover:border-red-600/40 dark:bg-zinc-900"',
      ),
    ).toEqual(["bg-green-500", "text-white", "hover:border-red-600/40", "dark:bg-zinc-900"]);
  });

  it("knows Tailwind 4's newer palettes", () => {
    expect(findFixedColours('className="bg-olive-500 text-mauve-700 border-mist-200 ring-taupe-400"')).toEqual([
      "bg-olive-500",
      "text-mauve-700",
      "border-mist-200",
      "ring-taupe-400",
    ]);
  });

  it("flags arbitrary colour values", () => {
    expect(findFixedColours('className="bg-[#7a1f2b] text-[oklch(0.4_0.1_15)]"')).toEqual([
      "bg-[#7a1f2b]",
      "text-[oklch(0.4_0.1_15)]",
    ]);
  });

  it("allows theme tokens and non-colour utilities", () => {
    expect(
      findFixedColours(
        'className="bg-primary text-muted-foreground border-destructive bg-status-called text-lg text-center ring-ring/50"',
      ),
    ).toEqual([]);
  });
});

// Vendored shadcn primitives in components/ui are exempt.
describe("screen code", () => {
  const root = join(__dirname, "..");
  const files = ["app", "components"]
    .flatMap((dir) => readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).map((f) => join(root, dir, f)))
    .filter((f) => f.endsWith(".tsx") && !f.includes(join("components", "ui")));

  it.each(files.map((f) => [relative(root, f), f]))("%s uses only theme colour tokens", (_, file) => {
    expect(findFixedColours(readFileSync(file, "utf8"))).toEqual([]);
  });
});
