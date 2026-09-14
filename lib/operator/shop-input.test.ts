import { describe, expect, test } from "vitest";
import { parseCreateShopInput } from "./shop-input";

const valid = {
  slug: "kedai-ali",
  name: "Kedai Gunting Rambut Ali",
  lat: 3.1319,
  lng: 101.6841,
  ownerEmail: "ali@example.com",
  ownerPassword: "correct-horse-battery",
};

/** The field a rejected body blames, or "(accepted)" when it wasn't rejected. */
function rejectedField(body: unknown) {
  const result = parseCreateShopInput(body);
  return result.ok ? "(accepted)" : result.field;
}

describe("parseCreateShopInput", () => {
  test("accepts a complete body and trims the name", () => {
    const result = parseCreateShopInput({ ...valid, name: "  Kedai Ali  " });

    expect(result).toEqual({
      ok: true,
      value: { ...valid, name: "Kedai Ali" },
    });
  });

  test("leaves the optional settings out so the database defaults apply", () => {
    const result = parseCreateShopInput(valid);

    expect(result.ok && result.value).not.toHaveProperty("joinRadiusM");
    expect(result.ok && result.value).not.toHaveProperty("headsUpThreshold");
    expect(result.ok && result.value).not.toHaveProperty("maxQueueSize");
  });

  test("accepts the optional Shop settings", () => {
    const result = parseCreateShopInput({
      ...valid,
      joinRadiusM: 80,
      headsUpThreshold: 2,
      maxQueueSize: 15,
    });

    expect(result).toEqual({
      ok: true,
      value: { ...valid, joinRadiusM: 80, headsUpThreshold: 2, maxQueueSize: 15 },
    });
  });

  test("rejects a body that is not an object", () => {
    expect(rejectedField(null)).toBe("body");
    expect(rejectedField("kedai-ali")).toBe("body");
    expect(rejectedField([valid])).toBe("body");
  });

  test.each([
    ["too short", "ab"],
    ["too long", "a".repeat(41)],
    ["uppercase", "Kedai-Ali"],
    ["an underscore", "kedai_ali"],
    ["a space", "kedai ali"],
    ["a trailing newline", "kedai-ali\n"],
    ["not a string", 12345],
    ["missing", undefined],
  ])("rejects a slug that is %s", (_label, slug) => {
    expect(rejectedField({ ...valid, slug })).toBe("slug");
  });

  test.each([
    ["3 characters", "abc"],
    ["40 characters", "a".repeat(40)],
    ["digits and dashes", "kedai-24-jam"],
  ])("accepts a slug of %s", (_label, slug) => {
    expect(rejectedField({ ...valid, slug })).toBe("(accepted)");
  });

  test("rejects a blank or missing name", () => {
    expect(rejectedField({ ...valid, name: "   " })).toBe("name");
    expect(rejectedField({ ...valid, name: "" })).toBe("name");
    expect(rejectedField({ ...valid, name: undefined })).toBe("name");
    expect(rejectedField({ ...valid, name: 42 })).toBe("name");
  });

  test("rejects coordinates outside the world", () => {
    expect(rejectedField({ ...valid, lat: 91 })).toBe("lat");
    expect(rejectedField({ ...valid, lat: -91 })).toBe("lat");
    expect(rejectedField({ ...valid, lng: 181 })).toBe("lng");
    expect(rejectedField({ ...valid, lng: -181 })).toBe("lng");
  });

  test("rejects coordinates that are not finite numbers", () => {
    expect(rejectedField({ ...valid, lat: "3.13" })).toBe("lat");
    expect(rejectedField({ ...valid, lat: Number.NaN })).toBe("lat");
    expect(rejectedField({ ...valid, lng: Number.POSITIVE_INFINITY })).toBe("lng");
    expect(rejectedField({ ...valid, lng: undefined })).toBe("lng");
  });

  test("accepts the edges of the coordinate ranges", () => {
    expect(rejectedField({ ...valid, lat: 90, lng: 180 })).toBe("(accepted)");
    expect(rejectedField({ ...valid, lat: -90, lng: -180 })).toBe("(accepted)");
  });

  test("rejects an address that is not an email", () => {
    expect(rejectedField({ ...valid, ownerEmail: "ali" })).toBe("ownerEmail");
    expect(rejectedField({ ...valid, ownerEmail: "ali@" })).toBe("ownerEmail");
    expect(rejectedField({ ...valid, ownerEmail: "@example.com" })).toBe("ownerEmail");
    expect(rejectedField({ ...valid, ownerEmail: "ali example@com" })).toBe("ownerEmail");
    expect(rejectedField({ ...valid, ownerEmail: undefined })).toBe("ownerEmail");
  });

  test("rejects an owner password under 10 characters", () => {
    expect(rejectedField({ ...valid, ownerPassword: "short-one" })).toBe("ownerPassword");
    expect(rejectedField({ ...valid, ownerPassword: undefined })).toBe("ownerPassword");
    expect(rejectedField({ ...valid, ownerPassword: "exactly-10" })).toBe("(accepted)");
  });

  test.each([
    ["joinRadiusM", 0],
    ["joinRadiusM", -1],
    ["joinRadiusM", 12.5],
    ["headsUpThreshold", 0],
    ["headsUpThreshold", 2.5],
    ["maxQueueSize", 0],
    ["maxQueueSize", "30"],
  ])("rejects %s of %s", (field, value) => {
    expect(rejectedField({ ...valid, [field]: value })).toBe(field);
  });

  test("treats a null optional setting as absent", () => {
    const result = parseCreateShopInput({ ...valid, joinRadiusM: null });

    expect(result).toEqual({ ok: true, value: valid });
  });
});
