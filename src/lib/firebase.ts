import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Use experimentalForceLongPolling to avoid the WebSocket state-machine bug
// (INTERNAL ASSERTION FAILED: ca9 / b815) that occurs when multiple listeners
// all receive permission-denied at the same time.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
