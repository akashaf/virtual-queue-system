"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createTicket } from "@/lib/customer/queue";
import {
  checkCustomerName,
  type CustomerView,
  type JoinError,
  type NameProblem,
} from "@/lib/customer/view";
import { DEVICE_COOKIE, deviceCookieOptions, isDeviceId } from "@/lib/device-cookie";
import { isLang, LANG_COOKIE, LANG_COOKIE_MAX_AGE } from "@/lib/i18n";

export interface Coords {
  lat: number;
  lng: number;
  accuracyM: number;
}

export type JoinResult =
  | { status: "joined"; view: CustomerView }
  | { status: "rejected"; reason: JoinError | "failed" }
  | { status: "invalid_name"; problem: NameProblem };

/**
 * Creates the Customer's Ticket, minting the device cookie if this browser has
 * never joined anything before.
 *
 * Arguments arrive from a browser and are checked as such: the name is measured
 * the way the column is, and the coordinates have to be real numbers on the
 * globe before they reach a `double precision` parameter.
 */
export async function joinQueue(
  slug: string,
  name: string,
  coords: Coords,
): Promise<JoinResult> {
  const checked = checkCustomerName(typeof name === "string" ? name : "");
  if (!checked.ok) return { status: "invalid_name", problem: checked.problem };

  if (!isCoords(coords)) return { status: "rejected", reason: "failed" };

  const outcome = await createTicket({
    slug,
    deviceId: await requireDeviceId(),
    name: checked.name,
    lat: coords.lat,
    lng: coords.lng,
    accuracyM: coords.accuracyM,
  });

  return outcome.ok
    ? { status: "joined", view: outcome.view }
    : { status: "rejected", reason: outcome.reason };
}

/** Remembers the Customer's choice of language for the next visit. */
export async function chooseLang(formData: FormData): Promise<void> {
  const lang = String(formData.get("lang") ?? "");
  if (!isLang(lang)) return;

  const cookieStore = await cookies();
  cookieStore.set(LANG_COOKIE, lang, {
    // Readable by scripts and sent cross-site: it is a display preference, and
    // nothing is authorised by it.
    sameSite: "lax",
    path: "/",
    maxAge: LANG_COOKIE_MAX_AGE,
  });

  const slug = String(formData.get("slug") ?? "");
  if (slug) revalidatePath(`/s/${slug}`);
}

/**
 * The device id in the cookie, or a fresh one. A Server Action is the only place
 * this can happen: Server Components cannot write cookies, so the first join is
 * what gives a browser its identity.
 */
async function requireDeviceId(): Promise<string> {
  const cookieStore = await cookies();

  const existing = cookieStore.get(DEVICE_COOKIE)?.value;
  if (isDeviceId(existing)) return existing;

  const deviceId = crypto.randomUUID();
  cookieStore.set(DEVICE_COOKIE, deviceId, deviceCookieOptions);
  return deviceId;
}

/**
 * Takes `unknown`, not `Coords`: the typed signature above describes what the
 * page sends, but a Server Action is a public endpoint and anything at all can
 * arrive at it.
 */
function isCoords(value: unknown): value is Coords {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng, accuracyM } = value as Partial<Coords>;

  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    Math.abs(lng) <= 180 &&
    typeof accuracyM === "number" &&
    Number.isFinite(accuracyM)
  );
}
