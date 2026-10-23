import { describe, expect, test } from "vitest";
import { classifyActionFailure, mayReloadAgain } from "./action-failure";

// The older-build branch reloads the page, so e2e/new-build.spec.ts covers it.
describe("classifyActionFailure", () => {
  test("a failed fetch is unreachable: it may still have landed", async () => {
    expect(await classifyActionFailure(new TypeError("Failed to fetch"))).toBe("unreachable");
  });

  test("anything else is a plain failure, for the caller to report", async () => {
    expect(
      await classifyActionFailure(new Error("An unexpected response was received from the server.")),
    ).toBe("failed");
  });
});

describe("mayReloadAgain", () => {
  test("allows the first reload", () => {
    expect(mayReloadAgain(null, 1_000)).toBe(true);
  });

  test("refuses another within a minute, so a refusing server cannot loop the page", () => {
    expect(mayReloadAgain(1_000, 1_000 + 59_999)).toBe(false);
  });

  test("allows one again after a minute", () => {
    expect(mayReloadAgain(1_000, 1_000 + 60_000)).toBe(true);
  });

  test("a stored value that is not a time, or lies in the future, cannot block reloads", () => {
    expect(mayReloadAgain(Number("garbage"), 1_000)).toBe(true);
    expect(mayReloadAgain(5_000, 1_000)).toBe(true);
  });
});
