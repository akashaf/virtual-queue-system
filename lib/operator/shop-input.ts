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

/** What `PATCH /api/operator/shops/[slug]` may change: everything but the slug and the Owner. */
export interface UpdateShopInput {
  name?: string;
  lat?: number;
  lng?: number;
  joinRadiusM?: number;
  headsUpThreshold?: number;
  maxQueueSize?: number;
  isActive?: boolean;
}

export type Rejected = { ok: false; field: string; message: string };
export type ParsedCreateShopInput = { ok: true; value: CreateShopInput } | Rejected;
export type ParsedUpdateShopInput = { ok: true; value: UpdateShopInput } | Rejected;
export type ParsedOwnerPasswordInput = { ok: true; value: { password: string } } | Rejected;

const SETTINGS = ["joinRadiusM", "headsUpThreshold", "maxQueueSize"] as const;

/**
 * Validates a `POST /api/operator/shops` body. The database enforces all of this
 * again; checking here turns constraint violations into messages that say which
 * field was wrong.
 */
export function parseCreateShopInput(body: unknown): ParsedCreateShopInput {
  const input = asObject(body);
  if (!input) return reject("body", "Expected a JSON object.");

  const slug = input.slug;
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    return reject("slug", "Must be 3-40 characters of a-z, 0-9 and dashes.");
  }

  const name = parseName(input.name);
  if (name === undefined) return reject("name", NAME_MESSAGE);

  const lat = parseCoordinate(input.lat, 90);
  if (lat === undefined) return reject("lat", LAT_MESSAGE);

  const lng = parseCoordinate(input.lng, 180);
  if (lng === undefined) return reject("lng", LNG_MESSAGE);

  const ownerEmail = input.ownerEmail;
  if (typeof ownerEmail !== "string" || !isEmail(ownerEmail)) {
    return reject("ownerEmail", "Must be an email address.");
  }

  const ownerPassword = input.ownerPassword;
  if (!isStrongEnough(ownerPassword)) return reject("ownerPassword", PASSWORD_MESSAGE);

  const value: CreateShopInput = { slug, name, lat, lng, ownerEmail, ownerPassword };

  for (const field of SETTINGS) {
    const raw = input[field];
    if (raw === undefined || raw === null) continue;
    const setting = parseSetting(raw);
    if (setting === undefined) return reject(field, SETTING_MESSAGE);
    value[field] = setting;
  }

  return { ok: true, value };
}

/**
 * Validates a `PATCH /api/operator/shops/[slug]` body: any subset of the Shop's
 * settings, each checked as on creation.
 *
 * The slug gets its own refusal because the trigger that guards it in the
 * database would otherwise surface as a bare 500: it is printed in the QR code
 * and the Operator has to be told so. Any other unknown field is refused too,
 * so a typo cannot pass as a no-op — a PATCH that changes nothing is a bug in
 * the caller, not a success.
 */
export function parseUpdateShopInput(body: unknown): ParsedUpdateShopInput {
  const input = asObject(body);
  if (!input) return reject("body", "Expected a JSON object.");

  const value: UpdateShopInput = {};

  for (const field of Object.keys(input)) {
    const raw = input[field];
    switch (field) {
      case "slug":
        return reject("slug", "The slug is printed in the QR code and cannot be changed.");
      case "name": {
        const name = parseName(raw);
        if (name === undefined) return reject(field, NAME_MESSAGE);
        value.name = name;
        break;
      }
      case "lat": {
        const lat = parseCoordinate(raw, 90);
        if (lat === undefined) return reject(field, LAT_MESSAGE);
        value.lat = lat;
        break;
      }
      case "lng": {
        const lng = parseCoordinate(raw, 180);
        if (lng === undefined) return reject(field, LNG_MESSAGE);
        value.lng = lng;
        break;
      }
      case "joinRadiusM":
      case "headsUpThreshold":
      case "maxQueueSize": {
        const setting = parseSetting(raw);
        if (setting === undefined) return reject(field, SETTING_MESSAGE);
        value[field] = setting;
        break;
      }
      case "isActive":
        if (typeof raw !== "boolean") return reject(field, "Must be true or false.");
        value.isActive = raw;
        break;
      default:
        return reject(field, "Unknown field.");
    }
  }

  if (Object.keys(value).length === 0) return reject("body", "Nothing to update.");

  return { ok: true, value };
}

/** Validates a `POST /api/operator/shops/[slug]/owner-password` body. */
export function parseOwnerPasswordInput(body: unknown): ParsedOwnerPasswordInput {
  const input = asObject(body);
  if (!input) return reject("body", "Expected a JSON object.");

  const password = input.password;
  if (!isStrongEnough(password)) return reject("password", PASSWORD_MESSAGE);

  return { ok: true, value: { password } };
}

const NAME_MESSAGE = "Must not be blank.";
const LAT_MESSAGE = "Must be a number between -90 and 90.";
const LNG_MESSAGE = "Must be a number between -180 and 180.";
const SETTING_MESSAGE = "Must be a whole number of at least 1.";
const PASSWORD_MESSAGE = `Must be at least ${MIN_OWNER_PASSWORD_LENGTH} characters.`;

function asObject(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function parseName(raw: unknown): string | undefined {
  const name = typeof raw === "string" ? raw.trim() : "";
  return name === "" ? undefined : name;
}

function parseCoordinate(raw: unknown, limit: number): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.abs(raw) <= limit ? raw : undefined;
}

function parseSetting(raw: unknown): number | undefined {
  return Number.isInteger(raw) && (raw as number) >= 1 ? (raw as number) : undefined;
}

function isStrongEnough(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length >= MIN_OWNER_PASSWORD_LENGTH;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function reject(field: string, message: string): Rejected {
  return { ok: false, field, message };
}
