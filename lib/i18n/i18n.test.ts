import { describe, expect, test } from "vitest";
import { dictionaries, format, resolveLang } from "./index";

describe("customer dictionaries", () => {
  test("en and ms define exactly the same keys", () => {
    expect(Object.keys(dictionaries.ms).sort()).toEqual(
      Object.keys(dictionaries.en).sort(),
    );
  });

  test("no translation is empty", () => {
    for (const dict of Object.values(dictionaries)) {
      for (const value of Object.values(dict)) {
        expect(value.trim()).not.toBe("");
      }
    }
  });
});

describe("resolveLang", () => {
  test("the vq_lang cookie wins over Accept-Language", () => {
    expect(resolveLang("ms", "en-US,en;q=0.9")).toBe("ms");
  });

  test("falls back to Accept-Language when there is no valid cookie", () => {
    expect(resolveLang(undefined, "ms-MY,ms;q=0.9,en;q=0.8")).toBe("ms");
    expect(resolveLang("fr", "en-GB")).toBe("en");
  });

  test("defaults to English", () => {
    expect(resolveLang(undefined, null)).toBe("en");
    expect(resolveLang(undefined, "zh-CN")).toBe("en");
  });
});

describe("format", () => {
  test("fills a placeholder", () => {
    expect(format("{count} people ahead of you", { count: 4 })).toBe(
      "4 people ahead of you",
    );
  });

  test("fills the same placeholder everywhere it appears", () => {
    expect(format("{n} and {n}", { n: 2 })).toBe("2 and 2");
  });

  test("leaves a placeholder nobody supplied alone, rather than printing undefined", () => {
    expect(format("{count} waiting", {})).toBe("{count} waiting");
  });

  test("returns a template with no placeholders unchanged", () => {
    expect(format("Queue full", { count: 1 })).toBe("Queue full");
  });
});
