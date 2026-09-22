import { addDoc, collection, WithFieldValue } from 'firebase/firestore';
import { db } from './firebase';
import { AppNotification, AppUser } from '../types';
import { buildDeepLinkUrl, refTypeForNotification } from './deepLink';
import { SCRIPT_URL, callScript } from './scriptProxy';

/** Fire-and-forget push + Telegram DM to one PERSON via the Apps Script proxy.
 *  The app names the uid; the script looks up their device token and chat id
 *  (owner-only, users/{uid}/private/contact — queue task A3b) and sends to
 *  whichever they have. `url` (when given) is the click-through target and the
 *  "Open in ETaske" link. `replyHint` adds the "reply done / delay to Sunday"
 *  line — the bot reads such a reply back and updates the record
 *  (google-apps-script.js → REPLY-TO-UPDATE). */
async function pushToUser(
  toUid: string, title: string, body: string, url?: string, replyHint?: boolean,
): Promise<void> {
  if (!SCRIPT_URL || !toUid) return;
  try {
    await callScript({ action: 'notify', toUid, title, body, url, replyHint });
  } catch {
    // Non-critical — in-app notification already written
  }
}

/**
 * Ask the proxy whether a pending Telegram link code has been claimed yet (the
 * user tapped Start in the bot). True once linked — by then the script has
 * saved the chat id on the caller's private contact doc.
 */
export async function checkTelegramLink(code: string): Promise<boolean> {
  if (!SCRIPT_URL) return false;
  try {
    const data = await callScript<{ linked?: boolean }>({ action: 'checkLink', code });
    return data.linked === true;
  } catch {
    return false;
  }
}

/**
 * Write a notification doc to Firestore and push it (device + Telegram) to the
 * recipient, when they are in the projectUsers list.
 *
 * `urlOverride` is for notifications that are not about a single record — the
 * daily briefing points at "Needs you today", not at a row on a board — and
 * wins over the deep link derived from relatedId below.
 */
export async function createNotification(
  data: WithFieldValue<Omit<AppNotification, 'id'>>,
  projectUsers: AppUser[],
  urlOverride?: string,
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
  const url = urlOverride ?? (relatedId && refType ? buildDeepLinkUrl(refType, relatedId) : undefined);

  if (recipient) {
    // Only the "this is late / due" nudges invite a reply. Any task or
    // correspondence message can still be answered — the hint is just noise
    // on the rest.
    const replyHint = !!url && !urlOverride && REPLYABLE_TYPES.has(data.type as string);
    pushToUser(recipient.id, title, message, url, replyHint);
  }
}

// Reminders the Telegram bot invites a "done" / "delay to Sunday" reply on.
const REPLYABLE_TYPES = new Set<string>([
  'task_overdue', 'corresponding_overdue', 'task_escalated', 'corresponding_escalated',
]);

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
  for (const user of targetUsers) pushToUser(user.id, title, body);
}
