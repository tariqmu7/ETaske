importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyA5lIYwb7w2KyNcmC4bVpBcwa__EfkNxr4",
  authDomain: "gen-lang-client-0893475577.firebaseapp.com",
  projectId: "gen-lang-client-0893475577",
  storageBucket: "gen-lang-client-0893475577.firebasestorage.app",
  messagingSenderId: "1052151865674",
  appId: "1:1052151865674:web:9f949b2fa3914f046de1b3"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? 'ETaske';
  const body = payload.notification?.body ?? '';
  const icon = payload.notification?.icon ?? './favicon.png';

  self.registration.showNotification(title, {
    body,
    icon,
    badge: './favicon.png',
    data: payload.data,
    vibrate: [200, 100, 200],
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(self.location.origin);
    })
  );
});
