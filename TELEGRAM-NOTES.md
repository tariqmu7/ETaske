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
  3. The app polls `checkLink`; the call that finds the code makes the **script**
     save the chat id on the caller's owner-only `users/{uid}/private/contact`
     doc (queue A3b). The app never writes a chat id, so nobody can attach
     someone else's chat to their account.
  - **Disconnect** (avatar menu) removes `telegramChatId` from that doc.

The chat id (`telegramChatId`) and the push token (`fcmToken`) live in
`users/{uid}/private/contact` (`src/lib/userContact.ts`) — **not** on the public
`users/{uid}` doc. Other people's browsers never see them: the app asks the
script to message a PERSON (`action: 'notify'`, `toUid`), and the script looks
the ids up.

## One-time setup (all free)

In [script.google.com](https://script.google.com) on the **existing** ETaske
Apps Script project:

1. **Paste** the updated `google-apps-script.js` into `Code.gs` (replace all).
2. **Script Properties** (Project Settings ⚙ → Script Properties → Add):
   - `TELEGRAM_BOT_TOKEN` = the token from @BotFather (e.g. `8762831803:AA…`)
   - `TELEGRAM_WEBHOOK_SECRET` = any long random string you invent
   - (`SHARED_SECRET` is no longer used — leave it or delete it.)
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
- Every app action (`upload`, `download`, `notify`, `checkLink`) needs the
  caller's Firebase ID token and an **Approved** user doc (queue task A2, 22 Sep
  2026 — `callerFromRequest()` in `google-apps-script.js`). `SHARED_SECRET` is no
  longer checked. A message may only go to an existing ETaske user (by uid), and
  each person has an hourly limit. The old `fcm` / `telegram` actions (send to a
  raw token / chat id) are gone.
- **Switch-over order matters:** publish the app build FIRST, then paste the new
  script straight after. The old app does NOT work with the new script (uploads
  and alerts would fail until the app is published). Since A3b the new app's
  alerts also need the new script (`notify`), so in the minutes between the two
  steps pushes and Telegram DMs are skipped — the bell entries are still written.
  The new script needs the `datastore` scope — the same one Reply-to-update needs
  below.
- **Private contact ids (queue task A3b, 22 Sep 2026).** Chat ids and push tokens
  moved off the public `users` directory into the owner-only
  `users/{uid}/private/contact`. Go-live: (1) publish the app, (2) paste + deploy
  the new script, (3) deploy the Firestore rules, (4) in the Apps Script editor
  pick **`moveContactsToPrivate`** and press Run once — it moves every old id into
  the private doc and deletes it from the public one (log ends "Done"; running it
  twice is harmless). Until step 4 the script still finds the old ids on the
  public doc, so nobody's alerts stop — but the ids stay visible until then.
- **Private Drive files (queue task A2b, 22 Sep 2026).** New uploads are no
  longer shared "anyone with the link"; the app reads each file back through the
  script's `download` action (same ID-token gate; only files inside the ETaske
  folder). Go-live, in this order: (1) publish the app, (2) paste + deploy the new
  script, (3) check one old attachment and one new upload open in the app, (4) in
  the Apps Script editor pick **`unshareAll`** and press Run — it closes the open
  link on the folder and every old file (people the folder was shared with by
  name keep access). If the log says "run unshareAll again", run it again until
  it says "Done". Until step 4 the old files are still open by link.
- The `users` directory stays readable by any signed-in user (see
  `RULES-NOTES.md`), but since A3b it no longer carries chat ids or push tokens.
```

## Reply-to-update ("done" / "delay to Sunday")

Reply to a bot message about a task or a correspondence and the record updates
itself — no login, no form:

- **"done"**, "finished", ✅, «تم», «خلصت», «اتقفلت» … → task **Done** (and its
  source letter Closed, as in the app) / correspondence **Closed**.
- **"delay to Sunday"**, "tomorrow", "in 3 days", "next week", "30/9",
  "5 Oct", «أجّل للأحد», «بكرة», «بعد 3 أيام», «الأسبوع الجاي», «٣٠/٩» … → the
  task's `dueDate` / the correspondence's `deadline` moves. "Sunday" always
  means the NEXT Sunday. Past dates, 31/9, and dates over a year out are refused.
- "ok" and «تمام» deliberately do **nothing** (people send them to mean "noted").
- The bot answers in the language the person wrote in, tells the assigner and
  the managers (bell + Telegram DM), and its confirmation carries the link again
  — so "actually Tuesday" in reply to the confirmation works too.
- Overdue and escalation reminders now end with a two-line hint explaining this.

**How it knows which record:** the "🔗 فتح في ETaske" link in the replied-to
message. Only the bot's own messages count. **Who may:** the Telegram chat must
be linked to exactly one Approved user, who must be allowed to edit that record
(same conditions as `firestore.rules`, plus: a correspondence's assignee).
Bids are never changed from Telegram.

### One-time setup for it (all free)

The writes use the script owner's Google login, so the script needs permission
to reach Firestore:

1. In the Apps Script editor: Project Settings ⚙ → tick **Show "appsscript.json"
   manifest file in editor**. Open `appsscript.json` and make sure
   `oauthScopes` contains **all** of these (add the missing ones, keep the rest):

   ```json
   "oauthScopes": [
     "https://www.googleapis.com/auth/script.external_request",
     "https://www.googleapis.com/auth/drive",
     "https://www.googleapis.com/auth/firebase.messaging",
     "https://www.googleapis.com/auth/datastore"
   ]
   ```

2. Paste the updated `google-apps-script.js` into `Code.gs` (replace all), then
   select `setup` → **Run** once and approve the new permission.
3. **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy.**
   Editing the existing deployment keeps the same URL, so nothing else changes
   (no env var, no webhook re-registration). If you make a *New deployment*
   instead, you must update `VITE_GOOGLE_SCRIPT_URL` and re-run `setWebhook`.
4. The Google account that owns the script must be an owner/editor of the
   Firebase project `gen-lang-client-0893475577` (it already is if FCM works).
5. Optional Script Property `TELEGRAM_BOT_USERNAME` — only if the bot is ever
   renamed from `E_TASK_bot`.

Test: make a task due yesterday, assigned to yourself → wait for the 🔴 Overdue
Telegram message → reply "delay to Sunday" → the task's date changes in ETaske.
