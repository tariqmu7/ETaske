import { addDoc, collection, WithFieldValue } from 'firebase/firestore';
import { db } from './firebase';
import { AppNotification, AppUser } from '../types';
import { buildDeepLinkUrl, refTypeForNotification } from './deepLink';

const SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_URL as string | undefined;
const SCRIPT_SECRET = import.meta.env.VITE_GOOGLE_SCRIPT_SECRET as string | undefined;

/** Fire-and-forget push to one FCM token via the Apps Script proxy.
 *  `url` (when given) becomes the notification's click-through target. */
async function pushToToken(token: string, title: string, body: string, url?: string): Promise<void> {
  if (!SCRIPT_URL || !token) return;
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'fcm', secret: SCRIPT_SECRET, token, title, body, url }),
    });
  } catch {
    // Non-critical — in-app notification already written
  }
}

/** Fire-and-forget Telegram DM to one chat id via the Apps Script proxy.
 *  `url` (when given) is rendered as an "Open in ETaske" link under the body. */
export async function pushTelegram(chatId: string, title: string, body: string, url?: string): Promise<void> {
  if (!SCRIPT_URL || !chatId) return;
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'telegram', secret: SCRIPT_SECRET, chatId, title, body, url }),
    });
  } catch {
    // Non-critical — in-app notification already written
  }
}

/**
 * Ask the proxy whether a pending Telegram link code has been claimed yet (the
 * user tapped Start in the bot). Returns the chat id once linked, else null.
 */
export async function checkTelegramLink(code: string): Promise<string | null> {
  if (!SCRIPT_URL) return null;
  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'checkLink', secret: SCRIPT_SECRET, code }),
    });
    const data = (await res.json()) as { chatId?: string | null };
    return data.chatId ?? null;
  } catch {
    return null;
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

  // Deep link straight to the record the notification is about, so an out-of-app
  // push is actionable instead of just dropping the user on the dashboard.
  const relatedId = data.relatedId as string | undefined;
  const refType = refTypeForNotification(data.type as string);
  const url = relatedId && refType ? buildDeepLinkUrl(refType, relatedId) : undefined;

  if (recipient?.fcmToken) {
    pushToToken(recipient.fcmToken, title, message, url);
  }
  if (recipient?.telegramChatId) {
    pushTelegram(recipient.telegramChatId, title, message, url);
  }
}

/**
 * Fan a notification out to every approved Manager/Admin so the management side
 * sees all workflow activity, not just the one manager who happens to be a
 * record's `assignedById`.
 *
 * `actorId` (whoever performed the action) and `excludeIds` (recipients who
 * already got a direct, differently-worded notification) are skipped so nobody
 * is notified twice about one event.
 */
export async function notifyManagers(
  data: WithFieldValue<Omit<AppNotification, 'id' | 'forUserId'>>,
  projectUsers: AppUser[],
  opts: { actorId?: string; excludeIds?: (string | undefined)[] } = {},
): Promise<void> {
  const skip = new Set(
    [opts.actorId, ...(opts.excludeIds ?? [])].filter(Boolean) as string[],
  );

  const managers = projectUsers.filter(
    (u) =>
      (u.role === 'Manager' || u.role === 'Admin') &&
      u.status === 'Approved' &&
      !skip.has(u.id),
  );

  await Promise.all(
    managers.map((m) =>
      createNotification({ ...data, forUserId: m.id, forRole: m.role }, projectUsers),
    ),
  );
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
    if (user.telegramChatId) pushTelegram(user.telegramChatId, title, body);
  }
}
