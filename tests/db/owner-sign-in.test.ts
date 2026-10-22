import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test, vi } from "vitest";
import type { Client } from "pg";
import { WRONG_CREDENTIALS } from "@/app/login/messages";
import { connectDb, createShop, resetTestData } from "./helpers";

/** What the Server Action would read from the Owner's request. */
const request = vi.hoisted(() => ({
  headers: new Headers(),
  cookies: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    getAll: () => [...request.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      if (value) request.cookies.set(name, value);
      else request.cookies.delete(name);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

let db: Client;
let signIn: typeof import("@/app/login/actions").signIn;
let publishableKey: string;
let secretKey: string;

/** Every request the last submit made to Supabase, with the headers it sent. */
let sent: { path: string; headers: Headers }[] = [];

beforeAll(async () => {
  const supabase = inject("supabase");
  ({ publishableKey, secretKey } = supabase);
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabase.apiUrl;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
  process.env.SUPABASE_SECRET_KEY = secretKey;

  ({ signIn } = await import("@/app/login/actions"));
  db = await connectDb();
  await resetTestData(db);
});

beforeEach(() => {
  request.headers = new Headers();
  request.cookies.clear();
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const req = new Request(input, init);
    sent.push({ path: new URL(req.url).pathname, headers: req.headers });
    return realFetch(input, init);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.end();
});

function form(email: string, password: string) {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
}

/** Submits the login form the way the page does, answering a redirect as its message. */
async function submit(email: string, password: string) {
  sent = [];
  return signIn({ error: null, email: "" }, form(email, password)).catch((error: Error) => error.message);
}

/** The headers of the password sign-in call to Supabase Auth. */
function passwordSignIn() {
  const call = sent.find((r) => r.path === "/auth/v1/token");
  if (!call) throw new Error("no password sign-in was sent");
  return call.headers;
}

/** Whether this browser now holds an Owner's Sign-in. */
function holdsSignIn() {
  return [...request.cookies.keys()].some((name) => name.includes("auth-token"));
}

describe("Owner sign-in (#37)", () => {
  test("forwards the Owner's IP from Netlify's header, with the secret key", async () => {
    const { owner } = await createShop();
    request.headers.set("x-nf-client-connection-ip", "203.0.113.7");

    expect(await submit(owner.email, owner.password)).toBe("redirect /dashboard");

    expect(passwordSignIn().get("sb-forwarded-for")).toBe("203.0.113.7");
    expect(passwordSignIn().get("apikey")).toBe(secretKey);
  });

  test("signs in without forwarding when Netlify's header is missing", async () => {
    const { owner } = await createShop();

    expect(await submit(owner.email, owner.password)).toBe("redirect /dashboard");

    expect(passwordSignIn().has("sb-forwarded-for")).toBe(false);
  });

  test("never forwards x-forwarded-for, which anyone can forge", async () => {
    const { owner } = await createShop();
    request.headers.set("x-forwarded-for", "198.51.100.1, 203.0.113.7");

    await submit(owner.email, owner.password);

    expect(passwordSignIn().has("sb-forwarded-for")).toBe(false);
  });

  test("looks up the Shop as the signed-in Owner, with the publishable key", async () => {
    const { owner } = await createShop();
    request.headers.set("x-nf-client-connection-ip", "203.0.113.7");

    await submit(owner.email, owner.password);

    const lookups = sent.filter((r) => r.path === "/rest/v1/shops");
    expect(lookups).toHaveLength(1);
    expect(lookups[0].headers.get("apikey")).toBe(publishableKey);
    expect(lookups[0].headers.get("authorization")).toMatch(/^Bearer ey/);
    expect(lookups[0].headers.has("sb-forwarded-for")).toBe(false);
    // Only the password sign-in carries the secret key.
    expect(sent.filter((r) => r.headers.get("apikey") === secretKey)).toHaveLength(1);
  });

  test("leaves the Owner signed in on this device", async () => {
    const { owner } = await createShop();

    await submit(owner.email, owner.password);

    expect(holdsSignIn()).toBe(true);
  });

  test("refuses a wrong password", async () => {
    const { owner } = await createShop();

    expect(await submit(owner.email, "not-the-password")).toEqual({
      error: WRONG_CREDENTIALS,
      email: owner.email,
    });
    expect(request.cookies.size).toBe(0);
  });

  test("signs the Owner of a Deactivated Shop out again, with the publishable key", async () => {
    const { owner, shop } = await createShop();
    await db.query("update public.shops set is_active = false where id = $1", [shop.id]);

    const result = await submit(owner.email, owner.password);

    expect(result).toMatchObject({ email: owner.email });
    expect(result).not.toMatchObject({ error: WRONG_CREDENTIALS });
    const logout = sent.find((r) => r.path === "/auth/v1/logout");
    expect(logout?.headers.get("apikey")).toBe(publishableKey);
    expect(holdsSignIn()).toBe(false);
  });
});
