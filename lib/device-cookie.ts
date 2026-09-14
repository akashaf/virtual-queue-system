/**
 * The `vq_device` cookie is the only thing that identifies a Customer. It is not
 * a login: it says "the browser that holds this Ticket", which is exactly the
 * claim a walk-in Customer can make (backend.md §7).
 */
export const DEVICE_COOKIE = "vq_device";

/** 400 days, the longest lifetime browsers will keep (they cap anything longer). */
export const DEVICE_COOKIE_MAX_AGE = 34_560_000;

export const deviceCookieOptions = {
  httpOnly: true,
  // Chrome and Safari treat localhost as a secure origin, but `next dev` over a
  // LAN address is plain HTTP, where a Secure cookie would be dropped silently.
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: DEVICE_COOKIE_MAX_AGE,
} as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A device id has to be a UUID before it reaches Postgres, where the parameter is
 * typed `uuid`: anything else turns a forged cookie into a 500 instead of a view
 * with no Ticket in it.
 */
export function isDeviceId(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * The device id in a raw `Cookie` header, or null.
 *
 * Route Handlers could read `cookies()` from `next/headers` instead, but taking
 * the header keeps them testable as Request in, Response out.
 */
export function deviceIdFromCookieHeader(header: string | null | undefined): string | null {
  for (const pair of (header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== DEVICE_COOKIE) continue;

    const value = decodeURIComponent(pair.slice(separator + 1).trim());
    return isDeviceId(value) ? value : null;
  }
  return null;
}
