import { checkTelegramLink } from './pushNotification';
import { removeMyTelegram } from './userContact';

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
 * webhook, which caches code -> chatId. We poll checkTelegramLink; the call that
 * finds it makes the Apps Script save the chat id on the user's private contact
 * doc (src/lib/userContact.ts) — the app never writes a chat id itself.
 *
 * Resolves 'linked' on success or 'timeout' after ~2 minutes.
 */
export async function connectTelegram(): Promise<ConnectResult> {
  const code = makeLinkCode();
  window.open(`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}`, '_blank', 'noopener');

  const deadline = Date.now() + 120_000; // 2 min
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    if (await checkTelegramLink(code)) return 'linked';
  }
  return 'timeout';
}

// Unlink from the app side. (The user can also send /stop to the bot.)
export async function disconnectTelegram(uid: string): Promise<void> {
  await removeMyTelegram(uid);
}
