import { doc, onSnapshot, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from './firebase';

/**
 * A person's private contact ids (queue task A3b). They used to sit on the
 * public users/{uid} doc, which every signed-in user can read; now they live in
 * users/{uid}/private/contact, which only the owner can read (firestore.rules).
 * Other people's browsers never see them — a push or Telegram DM is asked for by
 * uid and the Apps Script looks the ids up (pushNotification.ts → notify).
 *
 * The chat id is written by the Apps Script when a Telegram link completes; the
 * app only ever REMOVES it (disconnect). The push token is written here.
 */
export interface UserContact {
  telegramChatId?: string;
  fcmToken?: string;
}

const contactRef = (uid: string) => doc(db, 'users', uid, 'private', 'contact');

/** Live view of the signed-in user's own contact doc. Returns the unsubscribe. */
export function watchMyContact(uid: string, onChange: (c: UserContact) => void): () => void {
  return onSnapshot(
    contactRef(uid),
    (snap) => onChange((snap.data() as UserContact | undefined) ?? {}),
    () => onChange({}),
  );
}

export async function saveMyPushToken(uid: string, token: string): Promise<void> {
  await setDoc(contactRef(uid), { fcmToken: token }, { merge: true });
  await clearLegacyContact(uid);
}

export async function removeMyTelegram(uid: string): Promise<void> {
  await setDoc(contactRef(uid), { telegramChatId: deleteField() }, { merge: true });
  await clearLegacyContact(uid);
}

/** Drop the old copies from the public doc (they may predate the move). */
async function clearLegacyContact(uid: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), { telegramChatId: deleteField(), fcmToken: deleteField() });
  } catch {
    // Best effort — moveContactsToPrivate() in the Apps Script clears them too.
  }
}
