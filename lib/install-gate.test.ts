import { describe, expect, test } from "vitest";
import { installGate } from "./install-gate";

/**
 * Real user-agent strings. What matters is the device token (iPhone, iPad,
 * Macintosh), the iOS version, and whether Safari's own tokens are there.
 */
const UA = {
  iphoneSafari17:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneSafari16_4:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1",
  iphoneSafari16_3:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1",
  iphoneSafari15:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.6 Mobile/15E148 Safari/604.1",
  iphoneSafari26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  // The Home Screen app reports a bare WebKit agent, without Safari's tokens.
  iphoneStandalone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  iphoneWhatsApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 WhatsApp/2.24.9.78",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 334.0.4.32.98 (iPhone14,3; iOS 17_5; en_US)",
  iphoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/442.0.0.23.109;FBBV/562498713]",
  // LINE keeps a Safari-looking agent but appends its own token.
  iphoneLine:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari Line/14.5.1",
  iphoneWhatsAppOld:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20B82 WhatsApp/2.23.1.75",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1",
  // The Google app's webview keeps Safari's token but has no Add to Home Screen.
  iphoneGoogleApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/320.0.651603347 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // iPadOS Safari asks for the desktop site and calls itself a Mac.
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
  androidWhatsApp:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 WhatsApp/2.24.9.78",
  desktopFirefox:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
};

describe("installGate", () => {
  test.each([
    ["iOS 17", UA.iphoneSafari17],
    ["iOS 16.4 exactly", UA.iphoneSafari16_4],
    ["iOS 26", UA.iphoneSafari26],
  ])("iPhone Safari on %s must install first", (_name, ua) => {
    expect(installGate(ua, false)).toBe("install");
  });

  test.each([
    ["WhatsApp", UA.iphoneWhatsApp],
    ["Instagram", UA.iphoneInstagram],
    ["Facebook", UA.iphoneFacebook],
    ["LINE", UA.iphoneLine],
  ])("an iPhone %s browser must open the page in Safari first", (_name, ua) => {
    expect(installGate(ua, false)).toBe("open_in_safari");
  });

  // Since iOS 16.4 they can add to the Home Screen too, from their own Share.
  test.each([
    ["Chrome", UA.iphoneChrome],
    ["Firefox", UA.iphoneFirefox],
  ])("iPhone %s must install first, like Safari", (_name, ua) => {
    expect(installGate(ua, false)).toBe("install");
  });

  test("the iPhone Google app must open the page in Safari first", () => {
    expect(installGate(UA.iphoneGoogleApp, false)).toBe("open_in_safari");
  });

  test("the installed Home Screen app joins as normal", () => {
    expect(installGate(UA.iphoneStandalone, true)).toBe("none");
    // Whatever agent it reports, standalone is what decides.
    expect(installGate(UA.iphoneSafari17, true)).toBe("none");
  });

  // No Web Push before 16.4, even installed, so installing would gain nothing.
  test.each([
    ["16.3", UA.iphoneSafari16_3],
    ["15", UA.iphoneSafari15],
    ["16.1 in WhatsApp", UA.iphoneWhatsAppOld],
  ])("iOS %s joins as normal", (_name, ua) => {
    expect(installGate(ua, false)).toBe("none");
  });

  test.each([
    ["iPad Safari", UA.ipadSafari],
    ["iPad in desktop mode", UA.ipadDesktopMode],
    ["Android Chrome", UA.androidChrome],
    ["Android WhatsApp", UA.androidWhatsApp],
    ["desktop Firefox", UA.desktopFirefox],
  ])("%s joins as normal", (_name, ua) => {
    expect(installGate(ua, false)).toBe("none");
  });

  test("a missing user agent joins as normal", () => {
    expect(installGate(null, false)).toBe("none");
    expect(installGate("", false)).toBe("none");
  });
});
