import { bearerRoute } from "@/lib/bearer";
import { runDailyCleanup } from "@/lib/cron/daily";
import { noStoreJson as json } from "@/lib/http";

/**
 * The daily cleanup job, called at 03:00 Malaysia time by the Netlify scheduled
 * function in `netlify/functions/daily.mts` (backend.md §9). Netlify adds no
 * credentials of its own, so the function sends `CRON_SECRET` as a bearer key.
 */
export const POST = bearerRoute("CRON_SECRET", "Daily cleanup failed", async () =>
  json(await runDailyCleanup(), 200),
);
