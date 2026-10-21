/**
 * The request header the proxy passes this request's nonce in, for the scripts
 * Next does not render itself.
 */
export const NONCE_HEADER = "x-nonce";

/** The Reporting API group name that `report-to` names. */
const REPORT_GROUP = "csp";

/**
 * The Content-Security-Policy headers every page is served with (third-party.md §9).
 *
 * The Owner's Sign-in tokens live in cookies page scripts can read, because the
 * Supabase browser client needs them for Realtime, so the policy's job is to
 * stop a script we did not ship from running at all.
 */
export function cspHeaders({
  nonce,
  supabaseUrl,
  sentryDsn,
  dev,
}: {
  nonce: string;
  supabaseUrl: string;
  sentryDsn: string | undefined;
  dev: boolean;
}): Record<string, string> {
  const supabase = new URL(supabaseUrl);
  // Realtime is the same host over WebSocket: wss beside https, ws beside
  // local Supabase's plain http.
  const realtime = `${supabase.protocol === "https:" ? "wss:" : "ws:"}//${supabase.host}`;
  const sentry = sentryDsn ? new URL(sentryDsn) : null;
  // A DSN is https://<public key>@<host>/<project id>; the key is public by design.
  const reportUrl = sentry
    ? `${sentry.origin}/api${sentry.pathname}/security/?sentry_key=${sentry.username}`
    : null;

  const policy: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next puts this request's nonce on its own scripts and on next-themes'
    // inline one; 'strict-dynamic' then trusts whatever those load, which is
    // how OneSignal's SDK arrives. The hosts after it are only read by
    // browsers too old for 'strict-dynamic'.
    "script-src": [
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // React rebuilds server error stacks with eval in development;
      // production never evals.
      ...(dev ? ["'unsafe-eval'"] : []),
      "'self'",
      "https://cdn.onesignal.com",
    ],
    // Radix, sonner and React's own style props write inline styles, and a
    // nonce here would switch 'unsafe-inline' off. Styles cannot read cookies.
    "style-src": ["'self'", "'unsafe-inline'", "https://onesignal.com"],
    "img-src": ["'self'", "data:", "blob:"],
    // Clarity City is served from our own origin (app/layout.tsx).
    "font-src": ["'self'"],
    // The alert chimes are synthesised in the page and played from blob URLs
    // (lib/alert-effects.ts).
    "media-src": ["'self'", "blob:"],
    // Without this the browser falls back to script-src, whose
    // 'strict-dynamic' ignores 'self' and so blocks OneSignal's worker.
    "worker-src": ["'self'"],
    "connect-src": [
      "'self'",
      supabase.origin,
      realtime,
      ...(sentry ? [sentry.origin] : []),
      // OneSignal's page SDK registers the subscription through both.
      "https://api.onesignal.com",
      "https://onesignal.com",
    ],
    "object-src": ["'none'"],
    // A <base> tag would re-point every relative script URL.
    "base-uri": ["'none'"],
    // Server Actions post to the page itself.
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  if (reportUrl) {
    // Chromium follows report-to and ignores report-uri; Safari and Firefox
    // only know report-uri.
    policy["report-uri"] = [reportUrl];
    policy["report-to"] = [REPORT_GROUP];
  }

  return {
    "Content-Security-Policy-Report-Only": Object.entries(policy)
      .map(([name, sources]) => [name, ...sources].join(" "))
      .join("; "),
    ...(reportUrl ? { "Reporting-Endpoints": `${REPORT_GROUP}="${reportUrl}"` } : {}),
  };
}
