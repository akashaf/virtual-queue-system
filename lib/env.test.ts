import { afterEach, describe, expect, test, vi } from "vitest";
import { MissingEnvError, ownerSignInMaxDays } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ownerSignInMaxDays", () => {
  test("reads the number of days", () => {
    vi.stubEnv("OWNER_SIGN_IN_MAX_DAYS", "7");
    expect(ownerSignInMaxDays()).toBe(7);
  });

  test("fails loudly when it is missing", () => {
    vi.stubEnv("OWNER_SIGN_IN_MAX_DAYS", "");
    expect(() => ownerSignInMaxDays()).toThrow(MissingEnvError);
  });

  test.each(["0", "-7", "7.5", "seven", "7 days", "1e1"])(
    "fails loudly on %j, which is not a positive whole number",
    (value) => {
      vi.stubEnv("OWNER_SIGN_IN_MAX_DAYS", value);
      expect(() => ownerSignInMaxDays()).toThrow(MissingEnvError);
    },
  );
});
