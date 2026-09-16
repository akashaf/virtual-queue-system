/**
 * Whether this user agent is a social app's in-app browser (frontend.md §3.1).
 *
 * Those webviews cannot deliver Web Push, and several of them also drop the
 * page the moment the Customer switches away — so the page tells them up front
 * to open the link in a real browser instead. Detection is a token search:
 * each app stamps its name into the platform webview's own user agent.
 *
 * Read on the server from the request's User-Agent header, so the banner is in
 * the first HTML rather than appearing after hydration.
 */
const IN_APP_MARKERS = [
  "Instagram",
  // Facebook's iOS and Android apps mark their webviews differently.
  "FBAN",
  "FBAV",
  "FB_IAB",
  // TikTok has worn both of these names.
  "musical_ly",
  "Bytedance",
  "MicroMessenger", // WeChat
  "WhatsApp",
];

/** LINE's token needs its slash: bare "Line" appears in unrelated agents. */
const LINE_MARKER = /\bLine\//;

export function isInAppBrowser(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return (
    IN_APP_MARKERS.some((marker) => userAgent.includes(marker)) ||
    LINE_MARKER.test(userAgent)
  );
}
