/**
 * Where the test Shop stands, and how to step a known distance from it.
 *
 * Shared by the Vitest database suite and the Playwright suite, which both seed
 * a Shop here — Playwright then stands its browser on the same spot, so the
 * Join Radius lets it in.
 */
export const SHOP_LAT = 3.1319;
export const SHOP_LNG = 101.6841;

/**
 * Metres per degree of latitude on the same sphere `haversine_m` uses. Moving
 * only north or south makes the function's answer exactly the distance asked
 * for, which is what lets the Join Radius boundaries be tested to the metre.
 */
const METRES_PER_DEGREE_LAT = (6371000 * Math.PI) / 180;

/** A point `metres` due north of `lat`, on the Shop's meridian. */
export function metresNorthOf(metres: number, lat = SHOP_LAT) {
  return lat + metres / METRES_PER_DEGREE_LAT;
}
