/**
 * App service-worker registration (public/sw.js).
 *
 * The app is served from a GitHub Pages subpath (/ETaske/), so every URL here is
 * resolved against the page instead of the domain root — an absolute '/sw.js'
 * 404s in production and, worse, a scope of '/' is rejected outright.
 *
 * Registered in production only: in dev the SW would cache Vite's module graph
 * and fight HMR, so any previously installed one is torn down instead.
 */

/** Same base the built asset URLs use — './' per vite.config.ts. */
function scoped(path: string): string {
  return new URL(path, window.location.href).href;
}

export async function registerAppServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  if (import.meta.env.DEV) {
    const regs = await navigator.serviceWorker.getRegistrations();
    // Keep the FCM push worker (its own scope); drop any app shell worker.
    await Promise.all(
      regs
        .filter(r => !r.active?.scriptURL.includes('firebase-messaging-sw'))
        .map(r => r.unregister()),
    );
    return;
  }

  try {
    await navigator.serviceWorker.register(scoped('sw.js'), {
      scope: scoped('./'),
      // Always revalidate sw.js itself, so a new deploy's worker is seen.
      updateViaCache: 'none',
    });
  } catch (e) {
    // A missing/blocked SW only costs installability and offline — never break boot.
    console.warn('App service worker registration failed:', e);
  }
}
