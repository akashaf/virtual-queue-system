import { describe, expect, test } from "vitest";
import { canStillAsk, pushPlan } from "./push-client";

describe("pushPlan", () => {
  test("a browser without push falls straight back to sound", () => {
    expect(
      pushPlan({ supported: false, permission: "default", declined: false }),
    ).toBe("fallback");
  });

  test("permission already granted means subscribe without asking again", () => {
    expect(
      pushPlan({ supported: true, permission: "granted", declined: false }),
    ).toBe("subscribe");
  });

  test("a refusal is never asked about twice", () => {
    expect(
      pushPlan({ supported: true, permission: "denied", declined: false }),
    ).toBe("fallback");
  });

  test("a dismissed prompt counts as a refusal, even though the browser forgot it", () => {
    // Dismissing the browser prompt leaves permission at "default"; the
    // declined flag is what remembers the Customer already said no.
    expect(
      pushPlan({ supported: true, permission: "default", declined: true }),
    ).toBe("fallback");
  });

  test("otherwise the Customer is asked, explanation first", () => {
    expect(
      pushPlan({ supported: true, permission: "default", declined: false }),
    ).toBe("ask");
  });
});

describe("canStillAsk", () => {
  test("a Customer who only declined our sheet can still turn alerts on", () => {
    expect(canStillAsk({ supported: true, permission: "default" })).toBe(true);
  });

  test("not once the browser itself has refused, or has no push at all", () => {
    expect(canStillAsk({ supported: true, permission: "denied" })).toBe(false);
    expect(canStillAsk({ supported: false, permission: "default" })).toBe(false);
  });

  test("not when alerts are already allowed", () => {
    expect(canStillAsk({ supported: true, permission: "granted" })).toBe(false);
  });
});
