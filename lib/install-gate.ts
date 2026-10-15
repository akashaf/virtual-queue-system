import { isInAppBrowser } from "./in-app-browser";

/**
 * What stands between this browser and the Join button (frontend.md §3.2
 * step 0, ADR 0001 amendment 2026-10-16).
 *
 * A locked iPhone freezes a Safari tab, so the page's own alerts never ring;
 * only push from a Home Screen install reaches it. So an iPhone that can get
 * that push — iOS 16.4 or later — must join from the Home Screen app:
 * - `install`: a real browser, not installed. Show the Add to Home Screen
 *   steps. Safari, and since iOS 16.4 Chrome, Firefox and the rest too.
 * - `open_in_safari`: an app's own webview, which has no Add to Home Screen.
 * - `none`: the normal form.
 */
export type InstallGate = "none" | "install" | "open_in_safari";

/** The first iOS with Web Push, and only for Home Screen apps. */
const FIRST_PUSH_IOS = [16, 4] as const;

/**
 * The iPhone itself, not "any iOS": the gate is for phones, and iPadOS Safari
 * calls itself a Mac anyway.
 */
const IPHONE_OS = /\biPhone\b.*\bOS (\d+)_(\d+)/;

/**
 * Every iPhone browser keeps Safari's `Safari/` token; most webviews drop it.
 * The Google app keeps it but cannot install, so it is named here.
 */
const SAFARI_TOKEN = /\bSafari\//;
const WEBVIEWS_WITH_SAFARI_TOKEN = /\bGSA\//;

/**
 * `standalone` is only known in the browser (`isStandalone`), so the server can
 * only ask what the answer would be outside the Home Screen app.
 */
export function installGate(userAgent: string | null, standalone: boolean): InstallGate {
  if (standalone || !userAgent) return "none";

  const iphone = IPHONE_OS.exec(userAgent);
  if (!iphone) return "none";

  const major = Number(iphone[1]);
  const minor = Number(iphone[2]);
  const [firstMajor, firstMinor] = FIRST_PUSH_IOS;
  if (major < firstMajor || (major === firstMajor && minor < firstMinor)) return "none";

  return canInstall(userAgent) ? "install" : "open_in_safari";
}

function canInstall(userAgent: string): boolean {
  return (
    SAFARI_TOKEN.test(userAgent) &&
    !WEBVIEWS_WITH_SAFARI_TOKEN.test(userAgent) &&
    !isInAppBrowser(userAgent)
  );
}

/**
 * Running from the Home Screen. iOS has long had its own flag for it; the media
 * query is the standard one, and what an installed manifest app matches.
 * Browser only.
 */
export function isStandalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}
