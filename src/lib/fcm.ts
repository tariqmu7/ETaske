import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { app } from './firebase';

// Get from Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
// After generating a key pair, paste the public key string here.
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY ?? '';

export function getFCMMessaging() {
  return getMessaging(app);
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // App-relative: production is served from a GitHub Pages subpath (/ETaske/),
    // where '/firebase-messaging-sw.js' 404s and a '/' scope is rejected.
    // The scope is Firebase's own push-only sub-scope, NOT the app base — the
    // app base belongs to the shell worker (src/lib/pwa.ts) and one scope can
    // only ever have one worker, so sharing it would evict the shell worker and
    // silently kill installability.
    return await navigator.serviceWorker.register(
      new URL('firebase-messaging-sw.js', window.location.href).href,
      { scope: new URL('./firebase-cloud-messaging-push-scope', window.location.href).href },
    );
  } catch (e) {
    console.error('SW registration failed:', e);
    return null;
  }
}

export async function requestFCMToken(): Promise<string | null> {
  if (!('Notification' in window)) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  if (!VAPID_KEY) {
    console.warn('VITE_FIREBASE_VAPID_KEY not set — FCM token skipped');
    return null;
  }

  const messaging = getFCMMessaging();
  const swReg = await registerServiceWorker();
  if (!swReg) return null;

  try {
    return await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
  } catch (e) {
    console.error('FCM token error:', e);
    return null;
  }
}

export function onForegroundMessage(callback: (payload: unknown) => void) {
  return onMessage(getFCMMessaging(), callback);
}
