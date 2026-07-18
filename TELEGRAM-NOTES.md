# Telegram notifications

ETaske mirrors each user's notifications to their Telegram DM via the bot
**[@E_TASK_bot](https://t.me/E_TASK_bot)**, alongside the existing FCM web push.

**This runs entirely through the free Google Apps Script proxy — no Firebase
Blaze plan / Cloud Functions / credit card required.**

## How it works

- **Sending** — every notification is created client-side through the single
  `createNotification()` helper in `src/lib/pushNotification.ts`. Right after it
  writes the Firestore doc and fires the FCM push, it also POSTs
  `{ action: 'telegram', chatId, title, body }` to the Apps Script, which relays
  it to Telegram using the bot token stored server-side as a Script Property.
  Announcements go out the same way via `pushAnnouncement()`. This works because
  notifications are always created by someone who's online at that moment.
- **Linking** — avatar menu → **Connect Telegram** (`src/lib/telegram.ts`):
  1. The app generates a random code and opens `https://t.me/E_TASK_bot?start=<code>`.
  2. The user taps **Start**; the bot posts `/start <code>` to the Apps Script
     **webhook**, which caches `code → chatId` for 10 minutes.
  3. The app polls `checkLink` until the chat id appears, then stores it as
     `telegramChatId` on the user's own `users/{uid}` doc (allowed by the existing
     self-update rule — no `firestore.rules` change was needed).
  - **Disconnect** (avatar menu) clears `telegramChatId`.

The only new schema field is `telegramChatId` on `AppUser` (`src/types.ts`).

## One-time setup (all free)

In [script.google.com](https://script.google.com) on the **existing** ETaske
Apps Script project:

1. **Paste** the updated `google-apps-script.js` into `Code.gs` (replace all).
2. **Script Properties** (Project Settings ⚙ → Script Properties → Add):
   - `TELEGRAM_BOT_TOKEN` = the token from @BotFather (e.g. `8762831803:AA…`)
   - `TELEGRAM_WEBHOOK_SECRET` = any long random string you invent
   - (`SHARED_SECRET` should already be set from the upload/FCM feature.)
3. **Deploy → New deployment** → Web app, Execute as **Me**, Access **Anyone**.
   Copy the Web app URL. (If the URL changed, update `VITE_GOOGLE_SCRIPT_URL`
   and its GitHub Actions secret — otherwise leave it.)
4. **Register the bot webhook** once (the `?tgsecret=` param authenticates it,
   since Apps Script can't read request headers). URL-encode the inner `?`:

   ```
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<WEB_APP_URL>%3Ftgsecret%3D<TELEGRAM_WEBHOOK_SECRET>
   ```

   Expect `{"ok":true,"result":true,"description":"Webhook was set"}`.
   Verify anytime: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`

Then, in ETaske: avatar menu → **Connect Telegram** → tap **Start** in the bot →
the button flips to “Telegram connected”. Assign a task to yourself to test.

## Security notes

- The bot token grants full control of the bot — keep it **only** in the Apps
  Script Property, never in the client bundle or git. If it ever leaks, revoke &
  reissue via @BotFather (`/revoke`) and update the Script Property. Since the
  token was shared in plaintext during setup, rotating it once is worthwhile.
- The webhook rejects any request whose `?tgsecret=` doesn't match
  `TELEGRAM_WEBHOOK_SECRET`, so the public URL can't be driven by outsiders.
- The `checkLink`/`telegram` actions sit behind the same `SHARED_SECRET` gate as
  the existing upload/FCM proxy (a bundled `VITE_` value — it blocks drive-by
  hits, not a determined reader; see the note in `google-apps-script.js`).
- `telegramChatId` is readable by any signed-in user (the `users` directory is
  intentionally open — see `RULES-NOTES.md`). A chat id alone is harmless without
  the bot token.
```
