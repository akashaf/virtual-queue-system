import { describe, expect, test } from "vitest";
import { isAuthorizedOperator } from "./auth";

const KEY = "b3c1f0e9a7d24f6b8e5c1a0d9f3b7e2c";

describe("isAuthorizedOperator", () => {
  test("accepts the configured key", () => {
    expect(isAuthorizedOperator(`Bearer ${KEY}`, KEY)).toBe(true);
  });

  test("accepts any capitalisation of the scheme, as HTTP allows", () => {
    expect(isAuthorizedOperator(`bearer ${KEY}`, KEY)).toBe(true);
    expect(isAuthorizedOperator(`BEARER ${KEY}`, KEY)).toBe(true);
  });

  test("rejects a wrong key of the same length", () => {
    const wrong = `${KEY.slice(0, -1)}0` === KEY ? `${KEY.slice(0, -1)}1` : `${KEY.slice(0, -1)}0`;
    expect(isAuthorizedOperator(`Bearer ${wrong}`, KEY)).toBe(false);
  });

  test("rejects a wrong key of a different length", () => {
    expect(isAuthorizedOperator(`Bearer ${KEY}extra`, KEY)).toBe(false);
    expect(isAuthorizedOperator(`Bearer ${KEY.slice(0, 4)}`, KEY)).toBe(false);
  });

  test("is case-sensitive about the key itself", () => {
    expect(isAuthorizedOperator(`Bearer ${KEY.toUpperCase()}`, KEY)).toBe(false);
  });

  test("rejects a missing header", () => {
    expect(isAuthorizedOperator(null, KEY)).toBe(false);
    expect(isAuthorizedOperator("", KEY)).toBe(false);
  });

  test("rejects another scheme or a bare key", () => {
    expect(isAuthorizedOperator(`Token ${KEY}`, KEY)).toBe(false);
    expect(isAuthorizedOperator(KEY, KEY)).toBe(false);
  });

  test("rejects an empty bearer value", () => {
    expect(isAuthorizedOperator("Bearer ", KEY)).toBe(false);
    expect(isAuthorizedOperator("Bearer", KEY)).toBe(false);
  });

  test("rejects everything when the key is not configured", () => {
    expect(isAuthorizedOperator("Bearer ", "")).toBe(false);
    expect(isAuthorizedOperator("Bearer anything", "")).toBe(false);
  });
});
