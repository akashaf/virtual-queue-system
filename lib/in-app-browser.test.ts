import { describe, expect, test } from "vitest";
import { isInAppBrowser } from "./in-app-browser";

/**
 * Real user-agent strings, abbreviated to the parts that matter: the token each
 * in-app browser adds to the platform WebView's own string.
 */
const IN_APP = {
  instagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 334.0.4.32.98 (iPhone14,3; iOS 17_5; en_US)",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/442.0.0.23.109;FBBV/562498713]",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/453.0.0.39.85;]",
  tiktok:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 musical_ly_2022803040 JsSdk/1.0 NetType/WIFI Channel/App Store",
  line: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari Line/14.5.1",
  wechat:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 XWEB/1160117 MMWEBSDK/20240301 MicroMessenger/8.0.47.2560",
  whatsapp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 WhatsApp/2.24.9.78",
};

const REAL_BROWSERS = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
  desktopFirefox:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
};

describe("isInAppBrowser", () => {
  test.each(Object.entries(IN_APP))("spots the %s webview", (_name, ua) => {
    expect(isInAppBrowser(ua)).toBe(true);
  });

  test.each(Object.entries(REAL_BROWSERS))("lets %s through", (_name, ua) => {
    expect(isInAppBrowser(ua)).toBe(false);
  });

  test("a missing user agent is not an in-app browser", () => {
    expect(isInAppBrowser(null)).toBe(false);
    expect(isInAppBrowser("")).toBe(false);
  });
});
