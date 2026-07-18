import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from './firebase';
import { checkTelegramLink } from './pushNotification';

// The bot users link against: https://t.me/E_TASK_bot
export const TELEGRAM_BOT_USERNAME = 'E_TASK_bot';

function makeLinkCode(): string {
  // 24 hex chars of randomness — unguessable, well under Telegram's 64-char
  // /start payload limit. The Apps Script webhook caches it against the chat id.
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export type ConnectResult = 'linked' | 'timeout';

/**
 * Open the bot deep link and wait for the user to tap Start.
 *
 * Flow: we generate a random code and open https://t.me/E_TASK_bot?start=<code>.
 * When the user taps Start, the bot posts `/start <code>` to the Apps Script
 * webhook, which caches code -> chatId. We poll checkTelegramLink until it comes
 * back, then store telegramChatId on the user's own doc (allowed by rules).
 *
 * Resolves 'linked' on success or 'timeout' after ~2 minutes.
 */
export async function connectTelegram(uid: string): Promise<ConnectResult> {
  const code = makeLinkCode();
  window.open(`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}`, '_blank', 'noopener');

  const deadline = Date.now() + 120_000; // 2 min
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const chatId = await checkTelegramLink(code);
    if (chatId) {
      await updateDoc(doc(db, 'users', uid), { telegramChatId: chatId });
      return 'linked';
    }
  }
  return 'timeout';
}

// Unlink from the app side. (The user can also send /stop to the bot.)
export async function disconnectTelegram(uid: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { telegramChatId: deleteField() });
}
