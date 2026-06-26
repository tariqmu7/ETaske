import { addDoc, collection, WithFieldValue } from 'firebase/firestore';
import { db } from './firebase';
import { AppNotification, AppUser } from '../types';

const SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_URL as string | undefined;
const SCRIPT_SECRET = import.meta.env.VITE_GOOGLE_SCRIPT_SECRET as string | undefined;

/** Fire-and-forget push to one FCM token via the Apps Script proxy. */
async function pushToToken(token: string, title: string, body: string): Promise<void> {
  if (!SCRIPT_URL || !token) return;
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'fcm', secret: SCRIPT_SECRET, token, title, body }),
    });
  } catch {
    // Non-critical — in-app notification already written
  }
}

/**
 * Write a notification doc to Firestore and send a push to the recipient
 * if they have an FCM token in the projectUsers list.
 */
export async function createNotification(
  data: WithFieldValue<Omit<AppNotification, 'id'>>,
  projectUsers: AppUser[],
): Promise<void> {
  await addDoc(collection(db, 'notifications'), data);

  const forUserId = data.forUserId as string;
  const title = data.title as string;
  const message = data.message as string;
  const recipient = projectUsers.find((u) => u.id === forUserId);
  if (recipient?.fcmToken) {
    pushToToken(recipient.fcmToken, title, message);
  }
}

/**
 * Send a push to every recipient of an announcement.
 * targetUsers should already be filtered to the intended audience (excl. author).
 */
export function pushAnnouncement(
  targetUsers: AppUser[],
  authorName: string,
  text: string,
): void {
  if (!SCRIPT_URL) return;
  const title = `إعلان من ${authorName}`;
  const body = text.slice(0, 200);
  for (const user of targetUsers) {
    if (user.fcmToken) pushToToken(user.fcmToken, title, body);
  }
}
