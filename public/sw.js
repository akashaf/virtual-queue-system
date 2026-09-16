/*
 * Web Push service worker (frontend.md §3.4). Push only — no offline caching
 * in the MVP, so there is nothing to install and nothing to invalidate.
 *
 * Plain JavaScript, outside the app's build: the browser fetches this file by
 * URL and runs it alone, so it shares no imports with the app. The payload it
 * parses — { kind, shopName, number, url, lang } — is built in lib/push.ts,
 * and the language was stored when the Customer subscribed, so a closed tab is
 * still told in the words they chose.
 */

const TEXTS = {
  en: {
    heads_up: (shopName) => `Almost your turn at ${shopName}`,
    called: (shopName, number) => `Your turn at ${shopName}: ${number}`,
    last_call: (shopName) =>
      `${shopName} is closing soon, choose to stay or move to the next day`,
    shop_closed: (shopName) => `${shopName} has closed`,
  },
  ms: {
    heads_up: (shopName) => `Hampir giliran anda di ${shopName}`,
    called: (shopName, number) => `Giliran anda di ${shopName}: ${number}`,
    last_call: (shopName) =>
      `${shopName} akan tutup sebentar lagi, pilih untuk kekal atau pindah ke hari esok`,
    shop_closed: (shopName) => `${shopName} telah tutup`,
  },
};

// A new worker takes over straight away: it only handles push, so there is no
// in-flight state an update could corrupt by replacing an old one mid-life.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  if (!event.data) return;

  // Parsed here rather than in showPush so a malformed payload — only ever our
  // own bug — drops the event instead of throwing outside the waitUntil.
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(showPush(payload));
});

async function showPush({ kind, shopName, number, url, lang }) {
  // A focused queue page is already chiming and vibrating (frontend.md §3.3);
  // a notification on top would alert the Customer twice for one event.
  if (await hasFocusedClient(url)) return;

  const texts = TEXTS[lang] || TEXTS.en;
  const text = texts[kind];
  if (!text) return;

  await self.registration.showNotification(text(shopName, formatNumber(number)), {
    tag: kind,
    // "Your turn" must not quietly time out of the notification shade.
    requireInteraction: kind === "called",
    data: { url },
  });
}

async function hasFocusedClient(url) {
  const path = new URL(url, self.location.origin).pathname;
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  return clients.some(
    (client) => client.focused && new URL(client.url).pathname === path,
  );
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (url) event.waitUntil(openQueuePage(new URL(url, self.location.origin).href));
});

/** Brings an open queue page to the front, or opens one. */
async function openQueuePage(url) {
  const path = new URL(url).pathname;
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  const open = clients.find((client) => new URL(client.url).pathname === path);
  if (open) return open.focus();
  return self.clients.openWindow(url);
}

/** `#017`, as lib/ticket.ts prints it — duplicated because nothing is shared here. */
function formatNumber(number) {
  return `#${String(number).padStart(3, "0")}`;
}
