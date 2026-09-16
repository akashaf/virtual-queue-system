import { describe, expect, test } from "vitest";
import { pushPlan } from "./push-client";

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
