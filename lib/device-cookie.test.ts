import { describe, expect, test } from "vitest";
import {
  DEVICE_COOKIE_MAX_AGE,
  deviceCookieOptions,
  deviceIdFromCookieHeader,
  isDeviceId,
} from "./device-cookie";

const ID = "6f1a4c2e-9b3d-4a7e-8c15-2d0e5f7a9b31";

describe("isDeviceId", () => {
  test("accepts a random UUID, which is what the join action mints", () => {
    expect(isDeviceId(crypto.randomUUID())).toBe(true);
    expect(isDeviceId(ID)).toBe(true);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a word", "ali"],
    ["a truncated UUID", ID.slice(0, 20)],
    ["SQL", "'; drop table tickets; --"],
  ])("rejects %s", (_label, value) => {
    expect(isDeviceId(value)).toBe(false);
  });
});

describe("deviceIdFromCookieHeader", () => {
  test("finds the device id on its own", () => {
    expect(deviceIdFromCookieHeader(`vq_device=${ID}`)).toBe(ID);
  });

  test("finds it among other cookies", () => {
    expect(deviceIdFromCookieHeader(`vq_lang=ms; vq_device=${ID}; theme=dark`)).toBe(ID);
  });

  test("is not fooled by a cookie whose name merely ends the same way", () => {
    expect(deviceIdFromCookieHeader(`not_vq_device=${ID}`)).toBeNull();
  });

  test("returns null when the header is missing or has no device", () => {
    expect(deviceIdFromCookieHeader(null)).toBeNull();
    expect(deviceIdFromCookieHeader("")).toBeNull();
    expect(deviceIdFromCookieHeader("vq_lang=en")).toBeNull();
  });

  test("returns null for a forged value rather than passing it to Postgres", () => {
    expect(deviceIdFromCookieHeader("vq_device=not-a-uuid")).toBeNull();
  });

  test("decodes a percent-encoded value", () => {
    expect(deviceIdFromCookieHeader(`vq_device=${encodeURIComponent(ID)}`)).toBe(ID);
  });
});

describe("deviceCookieOptions", () => {
  test("keeps the cookie off JavaScript and away from cross-site requests", () => {
    expect(deviceCookieOptions).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_COOKIE_MAX_AGE,
    });
  });

  test("lasts 400 days, the browser maximum", () => {
    expect(DEVICE_COOKIE_MAX_AGE / 86_400).toBe(400);
  });
});
