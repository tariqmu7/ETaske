import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

admin.initializeApp();

const DB_ID = 'ai-studio-82d500c4-619e-4632-9bd3-9466532da5e6';
const db = admin.firestore();
(db as unknown as { settings: (s: object) => void }).settings({ databaseId: DB_ID });

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getFcmToken(uid: string): Promise<string | null> {
  const snap = await db.collection('users').doc(uid).get();
  return (snap.data()?.fcmToken as string) ?? null;
}

async function sendPush(token: string, title: string, body: string): Promise<void> {
  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      android: { priority: 'high' },
      webpush: {
        notification: { icon: '/favicon.png', badge: '/favicon.png' },
        fcmOptions: { link: '/' },
      },
    });
  } catch (err: unknown) {
    // Token stale / unregistered — clear it so we don't retry
    const code = (err as { code?: string }).code ?? '';
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token'
    ) {
      // Fire-and-forget cleanup; ignore failure
      db.collection('users').where('fcmToken', '==', token).get().then((q) => {
        q.forEach((d) => d.ref.update({ fcmToken: admin.firestore.FieldValue.delete() }));
      }).catch(() => undefined);
    } else {
      console.error('FCM send error:', err);
    }
  }
}

// ─── Trigger: new notification doc ────────────────────────────────────────────
// Fires when any document is created in the notifications collection.
// Sends a push to the forUserId's device if they have an FCM token.

export const onNotificationCreated = functions.firestore.onDocumentCreated(
  {
    document: 'notifications/{notifId}',
    database: DB_ID,
    region: 'us-central1',
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const forUserId: string = data.forUserId ?? '';
    const title: string = data.title ?? 'ETaske';
    const message: string = data.message ?? '';

    if (!forUserId) return;

    const token = await getFcmToken(forUserId);
    if (!token) return;

    await sendPush(token, title, message);
  }
);

// ─── Trigger: new announcement doc ────────────────────────────────────────────
// Fires when an announcement is created. Sends a push to every Approved user
// in the target department (or the explicit recipientIds list).

export const onAnnouncementCreated = functions.firestore.onDocumentCreated(
  {
    document: 'announcements/{announcementId}',
    database: DB_ID,
    region: 'us-central1',
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const title = `إعلان من ${(data.authorName as string) ?? 'ETaske'}`;
    const body: string = (data.text as string)?.slice(0, 200) ?? '';
    const department: string = data.department ?? '';
    const recipientIds: string[] = Array.isArray(data.recipientIds) ? data.recipientIds : [];
    const authorId: string = data.authorId ?? '';

    let targetUids: string[];

    if (recipientIds.length > 0) {
      // Explicit recipient list (+ author excluded — they sent it)
      targetUids = recipientIds.filter((uid) => uid !== authorId);
    } else {
      // Dept-wide: all Approved users in the same department
      const usersSnap = await db
        .collection('users')
        .where('status', '==', 'Approved')
        .where('department', '==', department)
        .get();
      targetUids = usersSnap.docs
        .map((d) => d.id)
        .filter((uid) => uid !== authorId);
    }

    if (targetUids.length === 0) return;

    // Fetch tokens for all targets in parallel
    const tokens = await Promise.all(targetUids.map(getFcmToken));

    await Promise.all(
      tokens.map((token) => {
        if (!token) return Promise.resolve();
        return sendPush(token, title, body);
      })
    );
  }
);
