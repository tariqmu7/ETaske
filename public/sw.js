/*
 * ETaske app service worker.
 *
 * Two jobs:
 *  1. Make the app installable. Chrome/Edge only offer "Install app" when the
 *     page is controlled by a service worker that has a `fetch` handler — the
 *     manifest alone is not enough. `firebase-messaging-sw.js` does NOT count:
 *     it has no fetch handler and lives in its own push-only scope.
 *  2. Serve the app shell offline. Firestore already keeps a persistent local
 *     cache (see src/lib/firebase.ts), so once the shell loads from here the
 *     installed app opens and shows cached data with no network.
 *
 * Deliberately dependency-free (no Workbox / vite-plugin-pwa): this file is
 * copied verbatim from public/ into dist/, so it must be plain browser JS with
 * no build step and no build-time asset manifest. Vite fingerprints everything
 * under assets/, so those files are immutable and safe to cache forever; the
 * HTML entry is always network-first so a fresh deploy is picked up on reload.
 *
 * Bump CACHE whenever this file's caching logic changes — the old cache is
 * dropped on activate.
 */

const CACHE = 'etaske-shell-v1';

// Resolved against the SW's own location, which is the deploy base (the app is
// served from a GitHub Pages subpath, /ETaske/, not the domain root).
const SHELL_URL = new URL('./index.html', self.location).href;
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One bad URL must not fail the whole install.
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Only same-origin GETs inside our scope are ours to touch. */
function isHandled(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false; // Firestore, Drive, FCM, gstatic…
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return false;
  if (url.pathname.includes('/downloads/')) return false; // the 22 MB bridge .exe
  if (url.pathname.endsWith('firebase-messaging-sw.js')) return false;
  if (request.headers.has('range')) return false; // partial content, leave to the network
  return true;
}

/** Fingerprinted build output — content can never change under the same URL. */
function isImmutableAsset(url) {
  return url.pathname.includes('/assets/');
}

async function networkFirstShell(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(SHELL_URL, response.clone());
    return response;
  } catch (err) {
    // Offline: any navigation renders the SPA shell, which then routes itself.
    const cached = (await cache.match(SHELL_URL)) || (await cache.match('./'));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isHandled(request)) return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }
  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
