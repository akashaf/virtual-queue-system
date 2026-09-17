/**
 * The daily cleanup job's schedule, and nothing else (backend.md §9). A Netlify
 * scheduled function cannot be called by URL and has a short time limit, so the
 * work lives in the Next.js route `POST /api/cron/daily`; this only calls it.
 *
 * Self-contained on purpose: Netlify bundles this file on its own, outside
 * Next.js, so it does not import from the app.
 */
export default async function daily(): Promise<void> {
  const siteUrl = process.env.URL;
  const secret = process.env.CRON_SECRET;
  // Netlify adds no credentials of its own. Calling without the secret would
  // only earn a 401 that reads like a wrong key.
  if (!siteUrl) throw new Error("Missing environment variable URL");
  if (!secret) throw new Error("Missing environment variable CRON_SECRET");

  const response = await fetch(`${siteUrl}/api/cron/daily`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });

  // Thrown so the run is logged as failed in Netlify rather than passing quietly.
  if (!response.ok) {
    throw new Error(`POST /api/cron/daily answered ${response.status}`);
  }
}

// 19:00 UTC = 03:00 Malaysia time, which has no daylight saving.
export const config = { schedule: "0 19 * * *" };
