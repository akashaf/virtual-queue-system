/** The slug is printed in the QR code and can never change: keep it in sync with
 * the `shops_slug_format` check in the migration. */
export const SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;

/** Long enough to be worth generating rather than typing; also §8's reset rule. */
export const MIN_OWNER_PASSWORD_LENGTH = 10;

export interface CreateShopInput {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  ownerEmail: string;
  ownerPassword: string;
  /** Left out when the Operator didn't ask for one, so the column default applies. */
  joinRadiusM?: number;
  headsUpThreshold?: number;
  maxQueueSize?: number;
}

export type ParsedCreateShopInput =
  | { ok: true; value: CreateShopInput }
  | { ok: false; field: string; message: string };

/**
 * Validates a `POST /api/operator/shops` body. The database enforces all of this
 * again; checking here turns constraint violations into messages that say which
 * field was wrong.
 */
export function parseCreateShopInput(body: unknown): ParsedCreateShopInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return reject("body", "Expected a JSON object.");
  }
  const input = body as Record<string, unknown>;

  const slug = input.slug;
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    return reject("slug", "Must be 3-40 characters of a-z, 0-9 and dashes.");
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name === "") {
    return reject("name", "Must not be blank.");
  }

  const lat = parseCoordinate(input.lat, 90);
  if (lat === undefined) {
    return reject("lat", "Must be a number between -90 and 90.");
  }

  const lng = parseCoordinate(input.lng, 180);
  if (lng === undefined) {
    return reject("lng", "Must be a number between -180 and 180.");
  }

  const ownerEmail = input.ownerEmail;
  if (typeof ownerEmail !== "string" || !isEmail(ownerEmail)) {
    return reject("ownerEmail", "Must be an email address.");
  }

  const ownerPassword = input.ownerPassword;
  if (
    typeof ownerPassword !== "string" ||
    ownerPassword.length < MIN_OWNER_PASSWORD_LENGTH
  ) {
    return reject(
      "ownerPassword",
      `Must be at least ${MIN_OWNER_PASSWORD_LENGTH} characters.`,
    );
  }

  const value: CreateShopInput = { slug, name, lat, lng, ownerEmail, ownerPassword };

  for (const field of ["joinRadiusM", "headsUpThreshold", "maxQueueSize"] as const) {
    const raw = input[field];
    if (raw === undefined || raw === null) continue;
    if (!Number.isInteger(raw) || (raw as number) < 1) {
      return reject(field, "Must be a whole number of at least 1.");
    }
    value[field] = raw as number;
  }

  return { ok: true, value };
}

function parseCoordinate(raw: unknown, limit: number): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.abs(raw) <= limit ? raw : undefined;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function reject(field: string, message: string): ParsedCreateShopInput {
  return { ok: false, field, message };
}
