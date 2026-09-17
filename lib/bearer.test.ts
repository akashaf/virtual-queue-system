import { describe, expect, test } from "vitest";
import { isAuthorizedBearer } from "./bearer";

const KEY = "b3c1f0e9a7d24f6b8e5c1a0d9f3b7e2c";

describe("isAuthorizedBearer", () => {
  test("accepts the configured key", () => {
    expect(isAuthorizedBearer(`Bearer ${KEY}`, KEY)).toBe(true);
  });

  test("accepts any capitalisation of the scheme, as HTTP allows", () => {
    expect(isAuthorizedBearer(`bearer ${KEY}`, KEY)).toBe(true);
    expect(isAuthorizedBearer(`BEARER ${KEY}`, KEY)).toBe(true);
  });

  test("rejects a wrong key of the same length", () => {
    const wrong = `${KEY.slice(0, -1)}0` === KEY ? `${KEY.slice(0, -1)}1` : `${KEY.slice(0, -1)}0`;
    expect(isAuthorizedBearer(`Bearer ${wrong}`, KEY)).toBe(false);
  });

  test("rejects a wrong key of a different length", () => {
    expect(isAuthorizedBearer(`Bearer ${KEY}extra`, KEY)).toBe(false);
    expect(isAuthorizedBearer(`Bearer ${KEY.slice(0, 4)}`, KEY)).toBe(false);
  });

  test("is case-sensitive about the key itself", () => {
    expect(isAuthorizedBearer(`Bearer ${KEY.toUpperCase()}`, KEY)).toBe(false);
  });

  test("rejects a missing header", () => {
    expect(isAuthorizedBearer(null, KEY)).toBe(false);
    expect(isAuthorizedBearer("", KEY)).toBe(false);
  });

  test("rejects another scheme or a bare key", () => {
    expect(isAuthorizedBearer(`Token ${KEY}`, KEY)).toBe(false);
    expect(isAuthorizedBearer(KEY, KEY)).toBe(false);
  });

  test("rejects an empty bearer value", () => {
    expect(isAuthorizedBearer("Bearer ", KEY)).toBe(false);
    expect(isAuthorizedBearer("Bearer", KEY)).toBe(false);
  });

  test("rejects everything when the key is not configured", () => {
    expect(isAuthorizedBearer("Bearer ", "")).toBe(false);
    expect(isAuthorizedBearer("Bearer anything", "")).toBe(false);
  });
});
