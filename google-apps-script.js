// GOOGLE APPS SCRIPT FOR DRIVE UPLOADS
// 
// Instructions:
// 1. Go to https://script.google.com/ and open your existing project.
// 2. Paste this entire code into Code.gs (replace all existing code).
// 3. IMPORTANT: Select the "setup" function from the dropdown menu at the top and click "Run".
//    - This will prompt you to "Review permissions".
//    - Click Review Permissions -> Choose your account -> Click "Advanced" -> "Go to Untitled project (unsafe)" -> Click "Allow".
// 4. CRITICAL STEP: You MUST create a **New Deployment** for changes to take effect!
//    - Click "Deploy" at the top right.
//    - Select "New deployment" (Do NOT choose "Manage deployments" -> Edit).
//    - Ensure "Web app" is selected.
//    - Execute as "Me", and Who has access: "Anyone".
//    - Click "Deploy".
// 5. Copy the NEW "Web app URL" provided.
// 6. Go to your app's Settings -> Environment Variables, and set VITE_GOOGLE_SCRIPT_URL to the new URL.
// 7. Restart the dev server.
//
// WHO MAY CALL (queue task A2, 22 Sep 2026):
//   This web app is deployed with "Anyone" access, so its URL alone would let
//   anyone upload files to the Drive folder or send push notifications. Every
//   app request must therefore carry the caller's Firebase ID token
//   (`idToken`, from auth.currentUser.getIdToken()). The script checks it with
//   Firebase Auth (accounts:lookup — it rejects a forged, expired or other-
//   project token), then reads users/{uid} and serves only an Approved user
//   (or the admin e-mail, same as firestore.rules). See callerFromRequest().
//   The old SHARED_SECRET check is GONE: a VITE_ value ships inside the public
//   bundle, so it never kept anyone out. The client may still send `secret`
//   for a while; it is ignored.
//   Needs the https://www.googleapis.com/auth/datastore scope (TELEGRAM-NOTES.md)
//   to read users/{uid}.
//   Per-person hourly limits (RATE_LIMITS) cap what one account can do, and a
//   Telegram / push message may only go to a chat or device that belongs to an
//   ETaske user — the endpoint can no longer be used to message strangers.
//
// PRIVATE CONTACT IDS (queue task A3b, 22 Sep 2026):
//   A person's Telegram chat id and push-device token no longer sit on the
//   public users/{uid} doc (every signed-in user can read that directory). They
//   live in users/{uid}/private/contact, which only the owner can read. The app
//   now asks for a message by PERSON (`notify` + `toUid`); this script looks the
//   ids up itself. It also stores the chat id when a Telegram link completes
//   (checkLink), so nobody can claim someone else's chat. Ids already stored on
//   users/{uid}: run moveContactsToPrivate() once by hand after deploying.
//
// PRIVATE FILES (queue task A2b, 22 Sep 2026):
//   Uploads are no longer shared "anyone with the link". The app reads a file
//   back through the `download` action (same ID-token gate, file must be in
//   ETASKE_FOLDER_ID). Files uploaded before this change: run unshareAll()
//   once by hand from the editor, after this version is deployed.
//
// TELEGRAM NOTIFICATIONS (t.me/E_TASK_bot):
//   Add two more Script Properties (Project Settings gear -> Script Properties):
//     TELEGRAM_BOT_TOKEN     = the bot token from @BotFather (keep it here, NOT
//                              in the client bundle).
//     TELEGRAM_WEBHOOK_SECRET = any long random string of your choice.
//   After deploying a NEW web-app version, register the bot's webhook once
//   (Apps Script can't read headers, so we pass the secret as a query param):
//     https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<WEB_APP_URL>?tgsecret=<TELEGRAM_WEBHOOK_SECRET>
//   (URL-encode the inner "?" as %3F if your shell mangles it; expect {"ok":true}.)
//   Verify: https://api.telegram.org/bot<TOKEN>/getWebhookInfo

// Upload limits (defense in depth against the open endpoint).
var MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
var ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument', 'application/vnd.ms-excel',
  'text/plain'];

// The one Drive folder ETaske writes to and reads from.
var ETASKE_FOLDER_ID = "1BCyJMwQ1ve84jhPmp6THzd1Mwk9azpTD";

function setup() {
  // Run this function manually once to trigger the authorization prompt for DriveApp.
  DriveApp.getFolderById(ETASKE_FOLDER_ID);
  Logger.log("Authorization successful!");
}

/** Is this file directly inside the ETaske folder? `download` serves nothing else. */
function isInEtaskeFolder(file) {
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === ETASKE_FOLDER_ID) return true;
  }
  return false;
}

/**
 * ONE-OFF, run by hand from the Apps Script editor (queue task A2b), AFTER the
 * app and this script are both live. Until 22 Sep 2026 every upload was shared
 * "anyone with the link"; this turns link-sharing off on the folder and on
 * every file in it. People the folder was shared with by name keep their
 * access — only the open link is closed. Safe to run twice. If the log ends
 * with "stopped early", just run it again: it carries on where it left off.
 */
function unshareAll() {
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var folder = DriveApp.getFolderById(ETASKE_FOLDER_ID);
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    Logger.log("Folder link-sharing turned off.");
  }
  // Apps Script stops a run after 6 minutes; a resume token lets the next run
  // pick up exactly where this one stopped instead of starting over.
  var resume = props.getProperty('UNSHARE_RESUME_TOKEN');
  var files = resume ? DriveApp.continueFileIterator(resume) : folder.getFiles();
  var closed = 0, checked = 0;
  while (files.hasNext()) {
    if (Date.now() - started > 5 * 60 * 1000) {
      props.setProperty('UNSHARE_RESUME_TOKEN', files.getContinuationToken());
      Logger.log("Stopped early after " + checked + " files (" + closed + " closed) — run unshareAll again.");
      return;
    }
    var f = files.next();
    checked++;
    try {
      if (f.getSharingAccess() !== DriveApp.Access.PRIVATE) {
        f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
        closed++;
      }
    } catch (err) {
      Logger.log("Could not change " + f.getName() + " (" + f.getId() + "): " + err);
    }
  }
  props.deleteProperty('UNSHARE_RESUME_TOKEN');
  Logger.log("Done: " + checked + " files checked, " + closed + " were open by link and are now private.");
}

// ── Caller identity ──────────────────────────────────────────────────────────
// The Firebase WEB API key — public by design (it is in firebase-applet-config.json
// and every visitor's browser). It only names the project to Firebase Auth.
var FIREBASE_WEB_API_KEY = 'AIzaSyA5lIYwb7w2KyNcmC4bVpBcwa__EfkNxr4';
// Matches firestore.rules → isAdminEmail() and src/App.tsx; keep all three in step.
var ADMIN_EMAIL = 'tarekmoh123@gmail.com';

// Per-person, per-hour ceilings. Generous for real work (15 people), low enough
// that a stolen login cannot fill the Drive or flood Telegram.
var RATE_LIMITS = { upload: 60, message: 400, checkLink: 200, download: 300 };

function sha256Hex(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16); })
    .map(function (h) { return h.length === 1 ? '0' + h : h; }).join('');
}

/**
 * Who sent this request? Returns { uid, email, role } for an Approved ETaske
 * user (or the admin), else null. A good answer is cached for 5 minutes under a
 * hash of the token, so a burst of alerts costs one Auth + one Firestore call.
 */
function callerFromRequest(data) {
  var idToken = data && data.idToken;
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 4096) return null;

  var cache = CacheService.getScriptCache();
  var key = 'caller_' + sha256Hex(idToken);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  // accounts:lookup verifies the token's signature, expiry and project for us.
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' +
    FIREBASE_WEB_API_KEY, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ idToken: idToken }),
      muteHttpExceptions: true
    });
  if (res.getResponseCode() !== 200) return null;
  var acct = (JSON.parse(res.getContentText() || '{}').users || [])[0];
  if (!acct || !acct.localId || acct.disabled) return null;

  var email = String(acct.email || '').toLowerCase();
  var isAdmin = email === ADMIN_EMAIL && acct.emailVerified === true;
  var profile = fsGet('users', acct.localId);
  if (!isAdmin && !(profile && profile.status === 'Approved')) return null;

  var caller = {
    uid: acct.localId,
    email: email,
    role: isAdmin ? 'Admin' : String((profile && profile.role) || 'Employee')
  };
  cache.put(key, JSON.stringify(caller), 300);
  return caller;
}

/** Count one more `kind` for this person this hour; false once over the limit. */
function withinRateLimit(uid, kind) {
  var limit = RATE_LIMITS[kind];
  if (!limit) return true;
  var cache = CacheService.getScriptCache();
  var hour = Math.floor(Date.now() / 3600000);
  var key = 'rl_' + kind + '_' + uid + '_' + hour;
  var used = Number(cache.get(key) || 0);
  if (used >= limit) return false;
  cache.put(key, String(used + 1), 3700);
  return true;
}

// ── Contact ids (queue task A3b) ─────────────────────────────────────────────
// users/{uid}/private/contact = { telegramChatId?, fcmToken? }, owner-only in
// firestore.rules. Until moveContactsToPrivate() has run, an id may still sit
// on the public users/{uid} doc, so that is read as the fallback.
var CONTACT_FIELDS = ['telegramChatId', 'fcmToken'];

function contactPath(uid) { return 'users/' + encodeURIComponent(uid) + '/private/contact'; }

/** The contact ids of one person, from their private doc then (legacy) their user doc. */
function pickContact(priv, user) {
  var out = {};
  for (var i = 0; i < CONTACT_FIELDS.length; i++) {
    var f = CONTACT_FIELDS[i];
    var v = (priv && priv[f]) || (user && user[f]);
    if (v) out[f] = String(v);
  }
  return out;
}

/** uid -> contact for each user record given (one Firestore round-trip). */
function contactsFor(users) {
  var privs = fsBatchGet(users.map(function (u) { return contactPath(u.id); }));
  var out = {};
  for (var i = 0; i < users.length; i++) out[users[i].id] = pickContact(privs[i], users[i]);
  return out;
}

/** The contact of one person by uid, or null when there is no such ETaske user. */
function recipientContact(uid) {
  var got = fsBatchGet(['users/' + encodeURIComponent(uid), contactPath(uid)]);
  if (!got[0]) return null;
  return pickContact(got[1], got[0]);
}

/** The Approved users whose Telegram is linked to this chat. */
function usersForChat(chatId) {
  var approved = fsQueryEq('users', 'status', 'Approved');
  var contacts = contactsFor(approved);
  return approved.filter(function (u) { return contacts[u.id].telegramChatId === String(chatId); });
}

/**
 * Run ONCE by hand from the editor after deploying the A3b version: moves every
 * telegramChatId / fcmToken off the public users/{uid} doc into the owner-only
 * users/{uid}/private/contact. A value already in the private doc wins. Safe to
 * run again — the second run finds nothing to move.
 */
function moveContactsToPrivate() {
  var users = fsListAll('users');
  var moved = 0;
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    var legacy = pickContact(null, u);
    var names = Object.keys(legacy);
    if (!names.length) continue;
    var priv = fsBatchGet([contactPath(u.id)])[0] || {};
    var keep = {};
    for (var j = 0; j < names.length; j++) if (!priv[names[j]]) keep[names[j]] = legacy[names[j]];
    if (Object.keys(keep).length) fsSetFields(contactPath(u.id), keep, []);
    fsSetFields('users/' + encodeURIComponent(u.id), {}, names); // delete them from the public doc
    moved++;
  }
  Logger.log('Contact ids moved to private for ' + moved + ' of ' + users.length + ' users. Done.');
  return moved;
}

function jsonError(message) {
  return ContentService.createTextOutput(JSON.stringify({ status: "error", message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

function isAllowedMime(mimeType) {
  if (!mimeType) return false;
  for (var i = 0; i < ALLOWED_MIME_PREFIXES.length; i++) {
    if (mimeType.indexOf(ALLOWED_MIME_PREFIXES[i]) === 0) return true;
  }
  return false;
}

/**
 * Sends a push via the FCM HTTP v1 API using the script owner's OAuth token.
 * No server key or service account needed — just make sure the Google account
 * that owns this script has the "Firebase Cloud Messaging API Admin" role
 * (or is a project owner) in the Firebase/GCP project.
 *
 * The required OAuth scope (https://www.googleapis.com/auth/firebase.messaging)
 * must be listed in appsscript.json → oauthScopes. See instructions below.
 */
function sendFcmPush(token, title, body, url) {
  if (!token) return { status: 'skipped' };

  var projectId = 'gen-lang-client-0893475577';
  var url = 'https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send';

  var payload = JSON.stringify({
    message: {
      token: token,
      notification: { title: title, body: body },
      android: { priority: 'high' },
      webpush: {
        notification: { icon: '/favicon.png', badge: '/favicon.png' },
        fcm_options: { link: url || '/' },
      },
    },
  });

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: payload,
    muteHttpExceptions: true,
  });

  return { status: 'sent', fcm: response.getContentText() };
}

/**
 * Telegram helpers.
 * The bot token lives in a Script Property named TELEGRAM_BOT_TOKEN (never in the
 * client bundle). Notifications are sent with HTML parse mode, so we only need to
 * escape &, < and >.
 */
function tgEscapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sendTelegramMessage(chatId, title, body, url, replyHint) {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token || !chatId) return { status: 'skipped' };
  var text = body
    ? '<b>' + tgEscapeHtml(title) + '</b>\n' + tgEscapeHtml(body)
    : '<b>' + tgEscapeHtml(title) + '</b>';
  // Deep link to the exact task / correspondence, when the caller supplied one.
  // It is ALSO what reply-to-update reads back (tgRecordRefFromMessage), so a
  // reminder without a link cannot be answered from Telegram.
  if (url) {
    text += '\n\n<a href="' + tgEscapeHtml(url) + '">🔗 فتح في ETaske</a>';
    if (replyHint) text += '\n' + TG_REPLY_HINT;
  }
  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    muteHttpExceptions: true,
  });
  return { status: 'sent', telegram: response.getContentText() };
}

/**
 * Telegram webhook handler. Telegram POSTs every bot message to this web app.
 * Apps Script can't read request headers, so we authenticate the webhook via a
 * `?tgsecret=` query param matched against the TELEGRAM_WEBHOOK_SECRET property
 * (set the webhook URL to <scripturl>?tgsecret=<secret>).
 *
 * On `/start <code>` we cache code -> chatId for 10 minutes; the ETaske client
 * polls checkLink, and that call saves the chat id on the user's private
 * contact doc (users/{uid}/private/contact).
 */
function handleTelegramWebhook(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('TELEGRAM_WEBHOOK_SECRET');
  if (!expected || e.parameter.tgsecret !== expected) {
    return ContentService.createTextOutput('forbidden');
  }
  var ok = ContentService.createTextOutput('ok');
  var update;
  try { update = JSON.parse(e.postData.contents); } catch (err) { return ok; }

  var cache = CacheService.getScriptCache();

  // ── Redelivery guard ───────────────────────────────────────────────────────
  // An Apps Script web app answers with a 302 to script.googleusercontent.com,
  // which Telegram scores as a failed delivery — so it redelivers the SAME
  // update on a backoff, forever, and every redelivery used to send another
  // reply. That is what produced the flood of identical "ETaske connected"
  // messages. update_id is unique and stable per update, so processing each one
  // at most once makes the redeliveries harmless no-ops.
  if (update && update.update_id != null) {
    var seenKey = 'tgseen_' + update.update_id;
    if (cache.get(seenKey)) return ok;
    cache.put(seenKey, '1', 21600); // 6 h — far longer than Telegram retries
  }

  var msg = update && update.message;
  if (!msg || !msg.chat || msg.chat.id == null) return ok;

  var chatId = String(msg.chat.id);
  var text = (msg.text || '').trim();

  if (text.indexOf('/start') === 0) {
    var code = text.slice('/start'.length).trim();
    if (code) {
      cache.put('tglink_' + code, chatId, 600); // 10 min
      // Second guard: repeated Start taps in one linking session shouldn't each
      // earn a confirmation DM.
      var greetKey = 'tggreet_' + chatId;
      if (!cache.get(greetKey)) {
        cache.put(greetKey, '1', 300); // 5 min
        sendTelegramMessage(chatId, '✅ ETaske connected',
          "You're all set — return to ETaske. Your notifications will arrive here. Send /stop to unsubscribe.");
      }
    } else {
      sendTelegramMessage(chatId, 'ETaske',
        'Open ETaske and tap “Connect Telegram” to link your account.');
    }
  } else if (text.indexOf('/stop') === 0) {
    sendTelegramMessage(chatId, 'ETaske',
      'To stop notifications, open ETaske → your avatar menu → Disconnect Telegram.');
  } else if (text) {
    // Reply-to-update ("done" / "delayed to Sunday"). It answers only a reply to
    // one of the bot's own messages, or a message that plainly reads as a
    // done/delay instruction — anything else still gets silence (below).
    try { handleReplyToUpdate(msg, chatId, text); } catch (err) {
      Logger.log('reply-to-update failed: ' + err);
      sendTelegramMessage(chatId, 'ETaske', tgReplyText('error', tgLangOf(text)));
    }
  }
  // Anything else: stay silent. Replying to every stray message is pure noise
  // and, combined with redelivery, was a second source of the flood.
  return ok;
}

// ═══════════════════════════════════════════════════════════════════════════
// REPLY-TO-UPDATE — answer a reminder with "done" / "delayed to Sunday" and the
// record updates itself: no login, no form.
//
// WHICH record: every reminder carries the "🔗 فتح في ETaske" link
// (#/tasks?open=<id>, #/correspondences?open=<id>). Telegram hands the replied-to
// message back in full, link included, so nothing is stored between reminder and
// reply. Only a reply to the BOT's own message counts — a user cannot aim the
// bot at a record by quoting a link they typed themselves.
//
// WHO may change it: the chat is matched to the Approved user whose private
// contact doc (users/{uid}/private/contact, queue A3b) holds it, and that
// person must be allowed to edit the record in the app. The writes go through
// the script owner's OAuth token, which firestore.rules do NOT apply to — so
// tgCanUpdate IS the gate. Keep it in step with firestore.rules.
//
// Needs the https://www.googleapis.com/auth/datastore scope in appsscript.json
// (TELEGRAM-NOTES.md → "Reply-to-update").
//
// Everything between PURE-START and PURE-END touches no Apps Script service, so
// scripts/harness/telegramreply.mjs loads and tests it under Node.
// ═══════════════════════════════════════════════════════════════════════════

var FS_PROJECT_ID = 'gen-lang-client-0893475577';
var FS_DATABASE_ID = 'ai-studio-82d500c4-619e-4632-9bd3-9466532da5e6';
var TG_TIMEZONE = 'Africa/Cairo';

// PURE-START
var TG_REPLY_HINT = '↩️ Reply "done" or "delay to Sunday" to update it.\n' +
  '↩️ ردّ بكلمة «تم» لإغلاقه، أو «أجّل للأحد» لنقل موعده.';

// Furthest a "delay to …" may push a date. Beyond it is almost surely a typo
// (25/9/2062), and a wrong year is worse than asking again.
var TG_MAX_DELAY_DAYS = 366;

var TG_MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  // Arabic, as tgNormalize leaves it (أ/إ/آ → ا).
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'ابريل': 4, 'مايو': 5, 'يونيو': 6,
  'يوليو': 7, 'اغسطس': 8, 'سبتمبر': 9, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12
};

// 0 = Sunday … 6 = Saturday (getUTCDay order). Arabic as tgNormalize leaves it.
var TG_WEEKDAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  'الاحد': 0, 'احد': 0, 'الاثنين': 1, 'اثنين': 1, 'الاتنين': 1, 'اتنين': 1,
  'الثلاثاء': 2, 'ثلاثاء': 2, 'التلات': 2, 'تلات': 2,
  'الاربعاء': 3, 'اربعاء': 3, 'الاربع': 3, 'اربع': 3,
  'الخميس': 4, 'خميس': 4, 'الجمعه': 5, 'جمعه': 5, 'السبت': 6, 'سبت': 6
};
// Short forms count only in a short reply ("sun", "thu 9am"): "sat", "sun" and
// "wed" are also ordinary English words inside a sentence.
var TG_WEEKDAY_ABBR = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6
};

var TG_WEEKDAY_NAMES = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
};
var TG_MONTH_NAMES = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر',
    'أكتوبر', 'نوفمبر', 'ديسمبر']
};

// Whole-word "it is finished". Deliberately NOT "ok" / «تمام»: people send those
// to mean "noted", and closing a record by mistake is the worse failure.
var TG_DONE_WORDS = [
  'done', 'finished', 'complete', 'completed', 'closed', 'close',
  'تم', 'تمت', 'خلص', 'خلصت', 'خلصنا', 'خلصتها', 'خلصناها', 'خلصان', 'انتهيت',
  'انتهت', 'انتهي', 'منتهي', 'منتهيه', 'اتعمل', 'اتعملت', 'انجزت', 'انجزناها',
  'اتقفل', 'اتقفلت', 'مقفول', 'اغلق', 'اغلقت', 'اقفل', 'اقفلها'
];
// Words that turn "done" into "NOT done" — then nothing is changed.
var TG_NEGATIONS = ['not', "isn't", "hasn't", "haven't", 'no', 'yet', 'مش', 'لسه', 'لسا', 'لم', 'ما', 'مو', 'لا'];
// "Move it" verbs: with no date after them, the bot asks "to when?".
var TG_DELAY_WORDS = [
  'delay', 'delayed', 'postpone', 'postponed', 'move', 'moved', 'push', 'pushed',
  'reschedule', 'rescheduled', 'extend', 'extended', 'defer', 'deferred',
  'اجل', 'اجلت', 'اجله', 'اجلها', 'اجلوه', 'اجلوها', 'اجلناها', 'تاجيل', 'التاجيل', 'تاجل', 'تتاجل', 'اتاجل', 'اتاجلت',
  'مؤجل', 'مؤجله', 'انقل', 'نقل', 'انقلها', 'مدد', 'تمديد', 'اخرها'
];

/** Lower-case, Arabic-Indic digits → Latin, strip tashkeel/tatweel, and unify
 *  the letter shapes people type interchangeably (أإآ → ا, ة → ه, ى → ي). */
function tgNormalize(s) {
  return String(s == null ? '' : s)
    .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[،؛؟]/g, ' ')
    .toLowerCase()
    .trim();
}

function tgLangOf(text) {
  return /[؀-ۿ]/.test(String(text || '')) ? 'ar' : 'en';
}

// ── Calendar maths on plain YYYY-MM-DD strings (UTC, so no zone drift) ──────
function tgYmdToDate(ymd) {
  var p = ymd.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
}
function tgDateToYmd(d) {
  var m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
function tgAddDays(ymd, n) {
  var d = tgYmdToDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return tgDateToYmd(d);
}
function tgDaysBetween(fromYmd, toYmd) {
  return Math.round((tgYmdToDate(toYmd) - tgYmdToDate(fromYmd)) / 86400000);
}
function tgValidYmd(y, m, d) {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? tgDateToYmd(dt) : null; // rejects 31/9
}
/** "Sunday" means the NEXT Sunday: 1–7 days ahead, never today. */
function tgNextWeekday(todayYmd, wd) {
  var diff = (wd - tgYmdToDate(todayYmd).getUTCDay() + 7) % 7;
  return tgAddDays(todayYmd, diff === 0 ? 7 : diff);
}

/** "Sunday 27 Sep 2026" / "الأحد 27 سبتمبر 2026" — Latin digits, as the app. */
function tgFormatDate(ymd, lang) {
  var d = tgYmdToDate(ymd);
  var L = lang === 'ar' ? 'ar' : 'en';
  return TG_WEEKDAY_NAMES[L][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' +
    TG_MONTH_NAMES[L][d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

/** A token plus the forms without the Arabic clitics people glue on
 *  (للأحد → الأحد, بالخميس → الخميس, لبكرة → بكرة). */
function tgTokenForms(tok) {
  var forms = [tok];
  if (/^لل/.test(tok)) forms.push('ال' + tok.slice(2));
  if (/^[لبوف]/.test(tok)) forms.push(tok.slice(1));
  return forms;
}
function tgLookup(tok, table) {
  var forms = tgTokenForms(tok);
  for (var i = 0; i < forms.length; i++) {
    if (Object.prototype.hasOwnProperty.call(table, forms[i])) return table[forms[i]];
  }
  return undefined;
}
function tgHasWord(tokens, list) {
  for (var i = 0; i < tokens.length; i++) {
    var forms = tgTokenForms(tokens[i]);
    for (var j = 0; j < forms.length; j++) if (list.indexOf(forms[j]) !== -1) return true;
  }
  return false;
}
function tgTokens(norm) {
  return norm.split(/[\s,!?.;:()"'«»\-]+/).filter(Boolean);
}

/**
 * The date a message asks for, relative to `todayYmd` (Cairo).
 * Returns 'YYYY-MM-DD', 'invalid' for a date-shaped thing that is no date
 * (31/9), or null when the text names no date at all.
 */
function tgFindDate(norm, todayYmd) {
  var year = tgYmdToDate(todayYmd).getUTCFullYear();
  var m;

  // 2026-09-27
  m = norm.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return tgValidYmd(+m[1], +m[2], +m[3]) || 'invalid';

  // 27/9, 27-9, 27.9, 27/9/2026, 27/9/26 — day first, as written in Egypt.
  m = norm.match(/(^|[^\d])(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?(?!\d)/);
  if (m) {
    var y = m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : year;
    return tgValidYmd(y, +m[3], +m[2]) || 'invalid';
  }

  var tokens = tgTokens(norm);

  // "27 sep", "sep 27", "27th sep", "27 سبتمبر", "27 سبتمبر 2026"
  for (var i = 0; i < tokens.length; i++) {
    var mon = tgLookup(tokens[i], TG_MONTHS);
    if (mon === undefined) continue;
    var dayRe = /^(\d{1,2})(st|nd|rd|th)?$/;
    var before = dayRe.test(tokens[i - 1] || '') ? parseInt(tokens[i - 1], 10) : null;
    var after = dayRe.test(tokens[i + 1] || '') ? parseInt(tokens[i + 1], 10) : null;
    var day = before !== null ? before : after;
    if (day === null) continue;
    var yTok = tokens[before !== null ? i + 1 : i + 2] || '';
    return tgValidYmd(/^\d{4}$/.test(yTok) ? +yTok : year, mon, day) || 'invalid';
  }

  // Relative words — "after tomorrow" before "tomorrow".
  if (/after tomorrow|بعد (بكره|بكرا|غدا|الغد|غد)(\s|$)/.test(norm)) return tgAddDays(todayYmd, 2);
  if (tgHasWord(tokens, ['tomorrow', 'tmrw', 'tmr', 'بكره', 'بكرا', 'غدا', 'الغد'])) return tgAddDays(todayYmd, 1);
  if (/next week|الاسبوع (الجاي|القادم|المقبل|اللي جاي)/.test(norm)) {
    return tgNextWeekday(todayYmd, 0); // Egypt's working week starts on Sunday
  }

  // "in 3 days", "3 days", "بعد 3 ايام", "2 weeks", "يومين", "اسبوعين", "a week"
  m = norm.match(/(\d{1,3})\s*(days?|ايام|يوم|weeks?|اسابيع|اسبوع)(\s|$)/);
  if (m) return tgAddDays(todayYmd, +m[1] * (/^(weeks?|اسابيع|اسبوع)$/.test(m[2]) ? 7 : 1));
  if (tgHasWord(tokens, ['يومين'])) return tgAddDays(todayYmd, 2);
  if (tgHasWord(tokens, ['اسبوعين'])) return tgAddDays(todayYmd, 14);
  if (tgHasWord(tokens, ['اسبوع', 'week'])) return tgAddDays(todayYmd, 7);

  // Weekday names: "sunday", "next sunday", "للأحد", "يوم الخميس"
  for (var k = 0; k < tokens.length; k++) {
    var wd = tgLookup(tokens[k], TG_WEEKDAYS);
    if (wd === undefined && tokens.length <= 4) wd = tgLookup(tokens[k], TG_WEEKDAY_ABBR);
    if (wd !== undefined) return tgNextWeekday(todayYmd, wd);
  }

  // Today last: «اليوم» is also how people start a sentence about something else.
  if (tgHasWord(tokens, ['today', 'tonight', 'اليوم', 'النهارده'])) return todayYmd;
  return null;
}

/**
 * What does this reply ask for?
 *   { kind: 'done' }
 *   { kind: 'delay', date: 'YYYY-MM-DD' }
 *   { kind: 'badDate', reason: 'past' | 'far' | 'invalid' }
 *   { kind: 'needDate' }   — "delay it" with no date
 *   { kind: 'unknown' }
 * A date beats a done-word: «تم التأجيل للأحد» is a delay, not a close.
 */
function tgParseReply(text, todayYmd) {
  var norm = tgNormalize(text);
  if (!norm) return { kind: 'unknown' };
  var tokens = tgTokens(norm);
  var saysDelay = tgHasWord(tokens, TG_DELAY_WORDS);
  var saysDone = /[✅✔☑]/.test(norm) || tgHasWord(tokens, TG_DONE_WORDS);

  var date = tgFindDate(norm, todayYmd);
  // A done-word next to a date with no "move" verb: «خلصتها النهارده» = finished
  // today (a close); "done sunday" could be either, so ask rather than guess.
  if (date && saysDone && !saysDelay) {
    if (date !== todayYmd) return { kind: 'unknown' };
    date = null;
  }
  if (date === 'invalid') return { kind: 'badDate', reason: 'invalid' };
  if (date) {
    var ahead = tgDaysBetween(todayYmd, date);
    if (ahead < 0) return { kind: 'badDate', reason: 'past' };
    if (ahead > TG_MAX_DELAY_DAYS) return { kind: 'badDate', reason: 'far' };
    return { kind: 'delay', date: date };
  }
  if (saysDelay) return { kind: 'needDate' };

  if (saysDone) {
    if (tgHasWord(tokens, TG_NEGATIONS)) return { kind: 'unknown' };
    // A long sentence that merely contains "done" is conversation, not an order.
    if (tokens.length > 5) return { kind: 'unknown' };
    return { kind: 'done' };
  }
  return { kind: 'unknown' };
}

/**
 * Which record a bot message is about, read from its "🔗 فتح في ETaske" link.
 * Returns { collection: 'tasks' | 'correspondences' | 'opportunities', id } or
 * null. `botUsername` guards that the message really is ours.
 */
function tgRecordRefFromMessage(m, botUsername) {
  if (!m || !m.from || m.from.is_bot !== true) return null;
  if (botUsername && m.from.username &&
      String(m.from.username).toLowerCase() !== String(botUsername).toLowerCase()) return null;
  var urls = [];
  var ents = m.entities || [];
  for (var i = 0; i < ents.length; i++) {
    var e = ents[i];
    if (e.type === 'text_link' && e.url) urls.push(e.url);
    if (e.type === 'url' && m.text) urls.push(m.text.substr(e.offset, e.length));
  }
  for (var j = 0; j < urls.length; j++) {
    var hm = String(urls[j]).match(/#\/([a-z-]+)\?(?:[^#]*&)?open=([^&#\s]+)/);
    if (!hm) continue;
    var id;
    try { id = decodeURIComponent(hm[2]); } catch (err) { continue; }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || id === '--stats--') continue;
    var view = hm[1];
    if (view === 'tasks' || view === 'archive') return { collection: 'tasks', id: id };
    if (view === 'correspondences' || view === 'manager-inbox') return { collection: 'correspondences', id: id };
    if (view === 'opportunities') return { collection: 'opportunities', id: id };
  }
  return null;
}

/**
 * May `user` change this record from Telegram? Mirrors firestore.rules' update
 * rule, with ONE deliberate widening: a correspondence's assignee may close or
 * re-date it. The reminder is addressed to them, and in the app they can
 * already close it by marking its linked task Done.
 */
function tgCanUpdate(collection, rec, user) {
  if (!user || user.status !== 'Approved' || !rec || !user.id) return false;
  var uid = user.id;
  var manager = user.role === 'Manager' || user.role === 'Admin';
  if (collection === 'tasks') {
    if (rec.assignedToId === uid || (rec.collaboratorIds || []).indexOf(uid) !== -1) return true;
    if (rec.isPrivate === true) return false;
    return manager || rec.assignedById === uid;
  }
  if (collection === 'correspondences') {
    return manager || rec.userId === uid || rec.assignedToId === uid;
  }
  return false; // bids are never changed from Telegram
}

/**
 * The write to make for (record, intent), or a refusal.
 *   { ok: true, fields, closesCorrespondence?, before? }
 *   { ok: false, reason: 'alreadyDone' | 'archived' }
 */
function tgPlanUpdate(collection, rec, intent) {
  var isTask = collection === 'tasks';
  if (isTask && rec.status === 'Archived') return { ok: false, reason: 'archived' };
  if (rec.status === (isTask ? 'Done' : 'Closed')) return { ok: false, reason: 'alreadyDone' };
  if (intent.kind === 'done') {
    var plan = { ok: true, fields: { status: isTask ? 'Done' : 'Closed' } };
    // The app closes a task's source letter when the task is done — so do we.
    if (isTask && rec.correspondingId) plan.closesCorrespondence = rec.correspondingId;
    return plan;
  }
  var field = isTask ? 'dueDate' : 'deadline';
  var fields = {};
  fields[field] = intent.date;
  return { ok: true, fields: fields, before: rec[field] || null };
}

/** What the replier reads back. */
function tgReplyText(key, lang, a) {
  a = a || {};
  var ar = lang === 'ar';
  var name = a.name ? (ar ? '«' + a.name + '»' : '"' + a.name + '"') : '';
  switch (key) {
    case 'doneTask': return ar ? '✅ سجّلتُ المهمة ' + name + ' منجزة.' : '✅ Marked ' + name + ' as done.';
    case 'doneCorr': return ar ? '✅ أغلقتُ المراسلة ' + name + '.' : '✅ Closed ' + name + '.';
    case 'delayed': return ar
      ? '🗓 نقلتُ موعد ' + name + ' إلى ' + tgFormatDate(a.date, 'ar') + '.'
      : '🗓 Moved ' + name + ' to ' + tgFormatDate(a.date, 'en') + '.';
    case 'toldManager': return ar ? 'وأبلغتُ المدير بذلك.' : 'Your manager has been told.';
    case 'alreadyDone': return ar
      ? 'السجل ' + name + ' مغلق أصلًا، ولم أغيّر شيئًا.'
      : name + ' is already done — nothing changed.';
    case 'archived': return ar
      ? 'المهمة ' + name + ' مؤرشفة، ولا يمكن تعديلها من هنا.'
      : name + ' is archived — it cannot be changed from here.';
    case 'notAllowed': return ar
      ? 'لا تملك صلاحية تعديل هذا السجل. افتحه في ETaske، أو اطلب ذلك من صاحبه.'
      : 'You are not allowed to change this record. Open it in ETaske, or ask its owner.';
    case 'notLinked': return ar
      ? 'حساب تيليجرام هذا غير مربوط بـ ETaske. اربطه من قائمة صورتك في التطبيق ← Connect Telegram.'
      : 'This Telegram account is not linked to ETaske. Link it from your avatar menu → Connect Telegram.';
    case 'notFound': return ar ? 'لم أجد هذا السجل؛ ربما حُذف.' : 'That record no longer exists — it may have been deleted.';
    case 'bid': return ar
      ? 'لا تُحدَّث العطاءات من تيليجرام؛ افتح العطاء في ETaske.'
      : 'Bids are not updated from Telegram — open the bid in ETaske.';
    case 'pickMessage': return ar
      ? 'ردّ على رسالة التذكير نفسها (اضغط عليها مطوّلًا ثم اختر «ردّ»)، واكتب «تم» أو «أجّل للأحد».'
      : 'Reply to the reminder itself (long-press it → Reply), then write "done" or "delay to Sunday".';
    case 'needDate': return ar
      ? 'إلى متى؟ ردّ مثلًا: «أجّل للأحد» أو «أجّل إلى 30/9».'
      : 'To when? Reply e.g. "delay to Sunday" or "delay to 30/9".';
    case 'past': return ar ? 'مضى هذا التاريخ؛ اختر اليوم أو يومًا بعده.' : 'That date has passed — pick today or later.';
    case 'far': return ar ? 'يبعد هذا التاريخ أكثر من عام؛ راجعه من فضلك.' : 'That date is more than a year away — please check it.';
    case 'invalid': return ar ? 'لم أفهم التاريخ؛ اكتبه هكذا: 30/9.' : 'I could not read that date — write it like 30/9.';
    case 'error': return ar
      ? 'تعذّر تحديث السجل الآن. حاول بعد قليل، أو حدّثه من ETaske مباشرة.'
      : 'Could not update the record just now. Try again shortly, or update it in ETaske.';
    default: return ar
      ? 'لم أفهم الرد. ردّ على التذكير بكلمة «تم» لإغلاقه، أو «أجّل للأحد» لنقل موعده.'
      : 'I did not understand. Reply to the reminder with "done" to close it, or "delay to Sunday" to move it.';
  }
}

/** Who else hears about the change — the people the app itself would tell:
 *  the assigner, plus every approved manager unless the task is private.
 *  Never the actor. Returns uids. */
function tgWhoToTell(collection, rec, actor, approvedUsers) {
  var out = [];
  var add = function (uid) { if (uid && uid !== actor.id && out.indexOf(uid) === -1) out.push(uid); };
  if (collection === 'tasks') add(rec.assignedById);
  if (!(collection === 'tasks' && rec.isPrivate === true)) {
    for (var i = 0; i < approvedUsers.length; i++) {
      var u = approvedUsers[i];
      if (u.role === 'Manager' || u.role === 'Admin') add(u.id);
    }
  }
  return out;
}
// PURE-END

// ── Firestore REST, as the script owner (NOT subject to firestore.rules) ─────
var FS_NOW = { now: true }; // sentinel: "the time of the write"

function fsBase() {
  return 'https://firestore.googleapis.com/v1/projects/' + FS_PROJECT_ID +
    '/databases/' + FS_DATABASE_ID + '/documents';
}
function fsFetch(url, method, payload) {
  var opts = {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (payload) opts.payload = JSON.stringify(payload);
  var res = UrlFetchApp.fetch(url, opts);
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Firestore ' + method + ' ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || '{}');
}
function fsDecode(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsDecode);
  if ('mapValue' in v) return fsDecodeFields(v.mapValue.fields || {});
  return null;
}
function fsDecodeFields(fields) {
  var out = {};
  for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) out[k] = fsDecode(fields[k]);
  return out;
}
function fsEncode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v === FS_NOW) return { timestampValue: new Date().toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
function fsEncodeFields(obj) {
  var out = {};
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = fsEncode(obj[k]);
  return out;
}
function fsGet(collection, id) {
  var d = fsFetch(fsBase() + '/' + collection + '/' + encodeURIComponent(id), 'get');
  if (!d || !d.fields) return null;
  var rec = fsDecodeFields(d.fields);
  rec.id = id;
  return rec;
}
/** Change only the named fields; a missing doc fails instead of being created. */
function fsPatch(collection, id, fields) {
  var mask = Object.keys(fields).map(function (k) {
    return 'updateMask.fieldPaths=' + encodeURIComponent(k);
  }).join('&');
  return fsFetch(fsBase() + '/' + collection + '/' + encodeURIComponent(id) +
    '?' + mask + '&currentDocument.exists=true', 'patch', { fields: fsEncodeFields(fields) });
}
/** Write the named fields (creating the doc if missing) and delete `removeNames`. */
function fsSetFields(path, fields, removeNames) {
  var mask = Object.keys(fields).concat(removeNames).map(function (k) {
    return 'updateMask.fieldPaths=' + encodeURIComponent(k);
  }).join('&');
  return fsFetch(fsBase() + '/' + path + '?' + mask, 'patch', { fields: fsEncodeFields(fields) });
}
/** Several docs in one call, by path; the answer is in the same order, null where missing. */
function fsBatchGet(paths) {
  if (!paths.length) return [];
  var root = 'projects/' + FS_PROJECT_ID + '/databases/' + FS_DATABASE_ID + '/documents/';
  var names = paths.map(function (p) { return root + decodeURIComponent(p); });
  var rows = fsFetch(fsBase() + ':batchGet', 'post', { documents: names }) || [];
  var byName = {};
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].found) byName[rows[i].found.name] = fsDecodeFields(rows[i].found.fields || {});
  }
  return names.map(function (n) {
    var rec = byName[n] || null;
    if (rec) rec.id = n.split('/').pop();
    return rec;
  });
}
/** Every doc of a top-level collection (for the one-off moveContactsToPrivate). */
function fsListAll(collection) {
  var out = [], pageToken = '';
  do {
    var page = fsFetch(fsBase() + '/' + collection + '?pageSize=300' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), 'get') || {};
    var docs = page.documents || [];
    for (var i = 0; i < docs.length; i++) {
      var rec = fsDecodeFields(docs[i].fields || {});
      rec.id = docs[i].name.split('/').pop();
      out.push(rec);
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return out;
}
function fsCreate(collection, fields) {
  return fsFetch(fsBase() + '/' + collection, 'post', { fields: fsEncodeFields(fields) });
}
function fsQueryEq(collection, field, value) {
  var rows = fsFetch(fsBase() + ':runQuery', 'post', {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: fsEncode(value) } },
      limit: 500
    }
  }) || [];
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var d = rows[i].document;
    if (!d) continue;
    var rec = fsDecodeFields(d.fields || {});
    rec.id = d.name.split('/').pop();
    out.push(rec);
  }
  return out;
}

/** The app's own deep link for the record, rebuilt from the one the reminder carried. */
function tgRecordUrl(replyTo, ref) {
  var ents = (replyTo && replyTo.entities) || [];
  for (var i = 0; i < ents.length; i++) {
    if (ents[i].type === 'text_link' && /#\//.test(ents[i].url || '')) {
      return ents[i].url.split('#')[0] + '#/' + ref.collection + '?open=' + encodeURIComponent(ref.id);
    }
  }
  return undefined;
}

/** Bell entry + Telegram DM to everyone tgWhoToTell names. FCM is left out: the
 *  app's FCM path runs from the client. Returns how many were told. */
function tgNotifyOthers(ref, rec, actor, intent, before, url) {
  var isTask = ref.collection === 'tasks';
  var name = isTask ? rec.taskName : rec.subject;
  var who = actor.displayName || actor.email || 'Someone';
  var type, title, message;
  if (intent.kind === 'done') {
    type = isTask ? 'task_done' : 'correspondence_updated';
    title = isTask ? 'Task Completed' : 'Correspondence Closed';
    message = who + (isTask ? ' marked "' + name + '" as Done' : ' closed "' + name + '"') + ' from Telegram.';
  } else {
    type = isTask ? 'task_updated' : 'correspondence_updated';
    title = isTask ? 'Task Rescheduled' : 'Correspondence Rescheduled';
    message = who + ' moved "' + name + '" to ' + tgFormatDate(intent.date, 'en') +
      (before ? ' (was ' + before + ')' : '') + ' from Telegram.';
  }
  var approved = fsQueryEq('users', 'status', 'Approved');
  var uids = tgWhoToTell(ref.collection, rec, actor, approved);
  var told = approved.filter(function (u) { return uids.indexOf(u.id) !== -1; });
  var contacts = contactsFor(told);
  for (var i = 0; i < uids.length; i++) {
    var user = null;
    for (var j = 0; j < told.length; j++) if (told[j].id === uids[i]) user = told[j];
    fsCreate('notifications', {
      type: type, title: title, message: message, forUserId: uids[i],
      forRole: user ? user.role : null, read: false, relatedId: ref.id, createdAt: FS_NOW
    });
    var chat = user && contacts[user.id].telegramChatId;
    if (chat) sendTelegramMessage(chat, title, message, url);
  }
  return uids.length;
}

function handleReplyToUpdate(msg, chatId, text) {
  var lang = tgLangOf(text);
  var say = function (key, a) { sendTelegramMessage(chatId, 'ETaske', tgReplyText(key, lang, a)); };
  var botName = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_USERNAME') || 'E_TASK_bot';
  var ref = tgRecordRefFromMessage(msg.reply_to_message, botName);
  var intent = tgParseReply(text, Utilities.formatDate(new Date(), TG_TIMEZONE, 'yyyy-MM-dd'));

  if (!ref) {
    // Not a reply to one of our reminders. Speak only when it plainly meant to
    // be an instruction; otherwise keep the old silence.
    if (intent.kind !== 'unknown') say('pickMessage');
    return;
  }
  if (ref.collection === 'opportunities') { say('bid'); return; }
  if (intent.kind === 'unknown' || intent.kind === 'needDate') { say(intent.kind); return; }
  if (intent.kind === 'badDate') { say(intent.reason); return; }

  // Two accounts on one chat would make the actor ambiguous — refuse, don't guess.
  var linked = usersForChat(chatId); // Approved users only
  var actor = linked.length === 1 ? linked[0] : null;
  if (!actor) { say('notLinked'); return; }

  var rec = fsGet(ref.collection, ref.id);
  if (!rec) { say('notFound'); return; }
  if (!tgCanUpdate(ref.collection, rec, actor)) { say('notAllowed'); return; }

  var isTask = ref.collection === 'tasks';
  var name = isTask ? rec.taskName : rec.subject;
  var plan = tgPlanUpdate(ref.collection, rec, intent);
  if (!plan.ok) { say(plan.reason, { name: name }); return; }

  plan.fields.updatedAt = FS_NOW;
  fsPatch(ref.collection, ref.id, plan.fields);
  if (plan.closesCorrespondence) {
    try { fsPatch('correspondences', plan.closesCorrespondence, { status: 'Closed', updatedAt: FS_NOW }); }
    catch (e) { Logger.log('linked correspondence not closed: ' + e); }
  }

  // From here the record IS updated — a failure below must not read as "not saved".
  var url = tgRecordUrl(msg.reply_to_message, ref);
  var told = 0;
  try { told = tgNotifyOthers(ref, rec, actor, intent, plan.before, url); }
  catch (e) { Logger.log('notify after reply-to-update failed: ' + e); }

  var line = intent.kind === 'done'
    ? tgReplyText(isTask ? 'doneTask' : 'doneCorr', lang, { name: name })
    : tgReplyText('delayed', lang, { name: name, date: intent.date });
  if (told > 0) line += ' ' + tgReplyText('toldManager', lang);
  // The link rides along, so replying to THIS confirmation ("actually, Monday")
  // works exactly like replying to the reminder.
  sendTelegramMessage(chatId, 'ETaske', line, url);
}

function doPost(e) {
  try {
    // Telegram webhook calls arrive with ?tgsecret=... and no shared secret in the
    // body — handle (and authenticate) them before the app's secret gate.
    if (e && e.parameter && e.parameter.tgsecret) {
      return handleTelegramWebhook(e);
    }

    var data = JSON.parse(e.postData.contents);

    // Gate: only a signed-in, Approved ETaske user gets past this line.
    var caller = callerFromRequest(data);
    if (!caller) {
      return jsonError("Unauthorized");
    }

    // Push + Telegram to one ETaske PERSON (queue A3b). The app names the
    // person; the device token and chat id never leave this script.
    if (data.action === 'notify') {
      var toUid = String(data.toUid || '');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(toUid)) return jsonError("Unknown recipient");
      if (!withinRateLimit(caller.uid, 'message')) return jsonError("Too many requests");
      var contact = recipientContact(toUid);
      if (!contact) return jsonError("Unknown recipient");
      var sent = { status: 'sent', fcm: false, telegram: false };
      if (contact.fcmToken) { sendFcmPush(contact.fcmToken, data.title, data.body, data.url); sent.fcm = true; }
      if (contact.telegramChatId) {
        sendTelegramMessage(contact.telegramChatId, data.title, data.body, data.url, !!data.replyHint);
        sent.telegram = true;
      }
      if (!sent.fcm && !sent.telegram) sent.status = 'none';
      return ContentService.createTextOutput(JSON.stringify(sent))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Link polling: has the user finished /start yet? Once they have, the chat
    // id is saved HERE on the caller's own private contact doc — the app never
    // writes it, so nobody can attach someone else's chat to their account.
    if (data.action === 'checkLink') {
      if (!withinRateLimit(caller.uid, 'checkLink')) return jsonError("Too many requests");
      var linkedChatId = typeof data.code === 'string' && data.code
        ? CacheService.getScriptCache().get('tglink_' + data.code) : null;
      if (linkedChatId) fsSetFields(contactPath(caller.uid), { telegramChatId: linkedChatId }, []);
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', linked: !!linkedChatId }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Read one file back (queue task A2b). Files are private, so this is the
    // only way the app can show or download them — and only a file that sits
    // in the ETaske folder, never anything else in the script owner's Drive.
    if (data.action === 'download') {
      if (!withinRateLimit(caller.uid, 'download')) return jsonError("Too many requests");
      var fileId = String(data.fileId || '');
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return jsonError("Bad file id");
      var wanted;
      try { wanted = DriveApp.getFileById(fileId); } catch (notFound) { return jsonError("Not found"); }
      if (wanted.isTrashed() || !isInEtaskeFolder(wanted)) return jsonError("Not found");
      if (wanted.getSize() > MAX_UPLOAD_BYTES) return jsonError("File too large");
      var fileBlob = wanted.getBlob();
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        fileName: wanted.getName(),
        mimeType: fileBlob.getContentType() || wanted.getMimeType(),
        base64: Utilities.base64Encode(fileBlob.getBytes())
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action && data.action !== 'upload') {
      return jsonError("Unknown action");
    }
    if (!withinRateLimit(caller.uid, 'upload')) {
      return jsonError("Too many uploads this hour — try again later");
    }

    // Drive would accept any name; keep it printable and bounded.
    var filename = String(data.filename || 'file').replace(/[\u0000-\u001f\/\\]/g, '_').slice(0, 200);
    var mimeType = data.mimeType;

    if (!isAllowedMime(mimeType)) {
      return jsonError("Unsupported file type");
    }
    if (typeof data.base64 !== 'string' || data.base64.indexOf(',') === -1) {
      return jsonError("Malformed upload payload");
    }

    var base64 = data.base64.split(',')[1];
    // base64 expands ~4/3; reject oversized uploads before decoding.
    if (!base64 || base64.length * 0.75 > MAX_UPLOAD_BYTES) {
      return jsonError("File too large");
    }

    var folder = DriveApp.getFolderById(ETASKE_FOLDER_ID);
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, filename);
    var file = folder.createFile(blob);
    // Audit trail: every file says who put it there.
    file.setDescription('Uploaded via ETaske by ' + caller.email + ' (' + caller.uid + ')');

    // The file stays PRIVATE (queue task A2b) — no "anyone with the link". The
    // app reads it back through the `download` action above, so only a
    // signed-in, Approved user ever sees it. The URL below is kept only as the
    // place the app finds the file id; opened directly it asks for a Google
    // login with access to the folder.
    var directLink = "https://drive.google.com/uc?export=view&id=" + file.getId();

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      url: directLink,
      fileName: file.getName()
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doOptions(e) {
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService.createTextOutput("Web App is running.")
    .setMimeType(ContentService.MimeType.TEXT);
}
