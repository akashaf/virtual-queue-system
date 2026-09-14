import { expect, test } from "vitest";
import { GET } from "./route";

test("GET /api/health responds 200 with no-store JSON", async () => {
  const res = await GET();

  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toContain("no-store");
  expect(await res.json()).toEqual({ ok: true });
});
