// Harness for google-apps-script.js -> WHO MAY CALL (queue task A2).
//
// Runs the WHOLE script through doPost() against fakes of every Apps Script
// service (Firebase Auth lookup, Firestore REST, Drive, Telegram, FCM, cache).
// Nothing touches the network. It proves that the web app, although deployed
// with "Anyone" access, serves only a signed-in, Approved ETaske user:
//
//   A1  no token / the old shared secret / a forged token      -> Unauthorized
//   A2  a real token of a Pending or unknown user               -> Unauthorized
//   A3  an Approved user uploads; the file records who did it
//   A4  the admin e-mail passes only with a verified address
//   A5  Telegram / push only to an ETaske PERSON, ids looked up here (A3b)
//   A6  per-person hourly limit on uploads
//   A7  unknown action, bad file type, hostile file name
//   A8  a verified token is cached (one Auth lookup for a burst)
//   A9  the Telegram webhook still works without a token
//   A10 checkLink saves the chat id on the CALLER's private contact doc
//   A11 moveContactsToPrivate() empties the public doc
//
//   node scripts/harness/scriptauth.mjs

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'google-apps-script.js'), 'utf8');

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };

// ── Fixtures ─────────────────────────────────────────────────────────────────
const tok = (name) => `tok.${name}.` + 'x'.repeat(120); // real ID tokens are ~900 chars
const ACCOUNTS = {                 // what Firebase Auth says about each token
  [tok('ahmed')]: { localId: 'u-ahmed', email: 'a@eprom.com.eg', emailVerified: true },
  [tok('pending')]: { localId: 'u-pending', email: 'p@eprom.com.eg', emailVerified: true },
  [tok('ghost')]: { localId: 'u-ghost', email: 'g@gmail.com', emailVerified: true },
  [tok('admin')]: { localId: 'u-admin', email: 'tarekmoh123@gmail.com', emailVerified: true },
  [tok('fakeadmin')]: { localId: 'u-fake', email: 'tarekmoh123@gmail.com', emailVerified: false },
  [tok('disabled')]: { localId: 'u-ahmed', email: 'a@eprom.com.eg', emailVerified: true, disabled: true },
};
let USERS, CONTACTS;                // Firestore users/{uid} and users/{uid}/private/contact
const seedUsers = () => {
  USERS = {
    'u-ahmed': { status: 'Approved', role: 'Employee' },
    'u-pending': { status: 'Pending', role: 'Employee' },
    // Not moved yet: the ids still sit on the public doc (before moveContactsToPrivate).
    'u-old': { status: 'Approved', role: 'Employee', telegramChatId: '777', fcmToken: 'fcm-old' },
    'u-quiet': { status: 'Approved', role: 'Employee' },
  };
  CONTACTS = { 'u-ahmed': { telegramChatId: '555', fcmToken: 'fcm-ahmed' } };
};
seedUsers();
const DOC_RE = /^users\/([^/]+)(\/private\/contact)?$/;
// Resolve a Firestore doc path to the fake record (or undefined).
const docAt = (p) => {
  const m = p.match(DOC_RE);
  if (!m) return undefined;
  return m[2] ? CONTACTS[m[1]] : USERS[m[1]];
};

// ── Apps Script fakes ────────────────────────────────────────────────────────
let calls;   // every outbound fetch, by kind
let files;   // Drive files created
let cacheStore;

const enc = (v) => typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };
const encFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));
const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });

const UrlFetchApp = {
  fetch(url, opts) {
    const body = opts && opts.payload ? JSON.parse(opts.payload) : null;
    if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIza')) {
      calls.auth++;
      const acct = ACCOUNTS[body.idToken];
      return acct ? resp(200, { users: [acct] }) : resp(400, { error: { message: 'INVALID_ID_TOKEN' } });
    }
    if (url.includes('firestore.googleapis.com') && url.endsWith(':batchGet')) {
      calls.batchGet++;
      return resp(200, body.documents.map((name) => {
        const d = docAt(name.split('/documents/')[1]);
        return d ? { found: { name, fields: encFields(d) } } : { missing: name };
      }));
    }
    if (url.includes('firestore.googleapis.com') && opts.method === 'patch') {
      const [p, qs] = url.split('/documents/')[1].split('?');
      const mask = [...new URLSearchParams(qs).entries()].map(([, v]) => v);
      const fields = Object.fromEntries(Object.entries(body.fields).map(([k, v]) => [k, v.stringValue]));
      const m = decodeURIComponent(p).match(DOC_RE);
      const store = m[2] ? CONTACTS : USERS;
      const next = { ...(store[m[1]] || {}) };
      for (const k of mask) { if (k in fields) next[k] = fields[k]; else delete next[k]; }
      store[m[1]] = next;
      calls.patch.push(decodeURIComponent(p));
      return resp(200, {});
    }
    if (url.includes('firestore.googleapis.com') && /\/documents\/users\?pageSize=/.test(url)) {
      return resp(200, { documents: Object.entries(USERS).map(([id, u]) => ({ name: `x/users/${id}`, fields: encFields(u) })) });
    }
    if (url.includes('firestore.googleapis.com') && url.endsWith(':runQuery')) {
      calls.query++;
      const w = body.structuredQuery.where.fieldFilter;
      const want = w.value.stringValue;
      return resp(200, Object.entries(USERS)
        .filter(([, u]) => u[w.field.fieldPath] === want)
        .map(([id, u]) => ({ document: { name: `x/users/${id}`, fields: encFields(u) } })));
    }
    if (url.includes('firestore.googleapis.com') && url.includes('/users/')) {
      calls.fsGet++;
      const id = decodeURIComponent(url.split('/users/')[1]);
      return USERS[id] ? resp(200, { fields: encFields(USERS[id]) }) : resp(404, {});
    }
    if (url.startsWith('https://api.telegram.org/')) { calls.telegram.push(body); return resp(200, { ok: true }); }
    if (url.startsWith('https://fcm.googleapis.com/')) { calls.fcm.push(body); return resp(200, {}); }
    throw new Error('unexpected fetch ' + url);
  },
};
const CacheService = {
  getScriptCache: () => ({
    get: (k) => (cacheStore.has(k) ? cacheStore.get(k) : null),
    put: (k, v) => { cacheStore.set(k, String(v)); },
  }),
};
const Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
  computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
  base64Decode: (b) => [...Buffer.from(b, 'base64')],
  newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }),
};
const ContentService = {
  MimeType: { JSON: 'json', TEXT: 'text' },
  createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }),
};
const DriveApp = {
  Access: { ANYONE_WITH_LINK: 'link' }, Permission: { VIEW: 'view' },
  getFolderById: () => ({
    createFile(blob) {
      const f = { name: blob.name, mimeType: blob.mimeType, description: '', sharing: null, id: 'f' + (files.length + 1) };
      files.push(f);
      return {
        setDescription: (d) => { f.description = d; },
        setSharing: (a) => { f.sharing = a; },
        getId: () => f.id, getName: () => f.name, getDownloadUrl: () => 'https://dl/' + f.id,
      };
    },
  }),
};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => ({ SHARED_SECRET: 'old-secret', TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_WEBHOOK_SECRET: 'whs' })[k] || null,
  }),
};
const ctx = {
  UrlFetchApp, CacheService, Utilities, ContentService, DriveApp, PropertiesService,
  ScriptApp: { getOAuthToken: () => 'owner-token' },
  Logger: { log() {} },
  Session: { getScriptTimeZone: () => 'Africa/Cairo' },
  JSON, Date, Math, Number, String, Object, Array, Error, RegExp, encodeURIComponent, decodeURIComponent,
};
vm.createContext(ctx);
vm.runInContext(SRC, ctx);

function reset() {
  calls = { auth: 0, fsGet: 0, query: 0, batchGet: 0, patch: [], telegram: [], fcm: [] };
  seedUsers();
  files = [];
  cacheStore = new Map();
}
const post = (data) => JSON.parse(ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(data) } }).text);
const PNG = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');
const upload = (extra) => post({ action: 'upload', filename: 'letter.png', mimeType: 'image/png', base64: PNG, ...extra });

// ── A1 — nobody gets in without a real token ─────────────────────────────────
reset();
let r = upload({});
ok(r.status === 'error' && r.message === 'Unauthorized', 'A1 no token -> Unauthorized');
r = upload({ secret: 'old-secret' });
ok(r.message === 'Unauthorized', 'A1 the old shared secret alone no longer opens the door');
r = upload({ idToken: tok('forged-by-a-stranger') });
ok(r.message === 'Unauthorized', 'A1 a forged token (Auth says INVALID_ID_TOKEN) -> Unauthorized');
r = upload({ idToken: 'short' });
ok(r.message === 'Unauthorized' && calls.auth === 1, 'A1 a junk token is refused without even asking Auth');
r = upload({ idToken: tok('disabled') });
ok(r.message === 'Unauthorized', 'A1 a disabled account -> Unauthorized');
r = post({ action: 'notify', secret: 'old-secret', toUid: 'u-ahmed', title: 'spam' });
ok(r.message === 'Unauthorized' && calls.telegram.length === 0 && calls.fcm.length === 0, 'A1 old secret cannot send Telegram / push');
r = post({ action: 'checkLink', code: 'abc' });
ok(r.message === 'Unauthorized', 'A1 link polling needs a token too');
ok(files.length === 0, 'A1 not one file reached Drive');

// ── A2 — a real login is not enough: the person must be Approved ─────────────
reset();
ok(upload({ idToken: tok('pending') }).message === 'Unauthorized', 'A2 Pending user -> Unauthorized');
ok(upload({ idToken: tok('ghost') }).message === 'Unauthorized', 'A2 signed-in stranger with no user record -> Unauthorized');
ok(files.length === 0, 'A2 no file reached Drive');

// ── A3 — an Approved user uploads ────────────────────────────────────────────
reset();
r = upload({ idToken: tok('ahmed'), secret: 'anything' });
ok(r.status === 'success' && r.url === 'https://drive.google.com/uc?export=view&id=f1', 'A3 Approved user uploads and gets the Drive link');
ok(files.length === 1 && files[0].description.includes('a@eprom.com.eg') && files[0].description.includes('u-ahmed'),
  'A3 the Drive file records who uploaded it');

// ── A4 — the admin e-mail, only when Google has verified it ──────────────────
reset();
ok(upload({ idToken: tok('admin') }).status === 'success', 'A4 verified admin e-mail passes with no user record');
ok(upload({ idToken: tok('fakeadmin') }).message === 'Unauthorized', 'A4 unverified copy of the admin e-mail -> Unauthorized');

// ── A5 — messages only to ETaske people ──────────────────────────────────────
reset();
r = post({ action: 'notify', idToken: tok('ahmed'), toUid: 'u-nobody', title: 'hi', body: 'x' });
ok(r.message === 'Unknown recipient' && calls.telegram.length === 0 && calls.fcm.length === 0, 'A5 a message to someone who is not an ETaske user is refused');
r = post({ action: 'notify', idToken: tok('ahmed'), toUid: '../tasks/T1', title: 'hi' });
ok(r.message === 'Unknown recipient' && calls.batchGet === 1, 'A5 a hostile uid is refused before any lookup');
r = post({ action: 'notify', idToken: tok('ahmed'), toUid: 'u-ahmed', title: 'Due today', body: 'x', url: 'https://app/#/tasks?open=T1' });
ok(r.status === 'sent' && r.telegram && r.fcm, 'A5 message to a person reaches both their channels');
ok(calls.telegram.length === 1 && calls.telegram[0].chat_id === '555', 'A5 Telegram went to the chat id from the PRIVATE contact doc');
ok(calls.fcm.length === 1 && calls.fcm[0].message.token === 'fcm-ahmed', 'A5 push went to the token from the PRIVATE contact doc');
r = post({ action: 'notify', idToken: tok('ahmed'), toUid: 'u-old', title: 'hi' });
ok(r.status === 'sent' && calls.telegram[1].chat_id === '777' && calls.fcm[1].message.token === 'fcm-old',
  'A5 a person not moved yet is still reached through the old ids on the public doc');
r = post({ action: 'notify', idToken: tok('ahmed'), toUid: 'u-quiet', title: 'hi' });
ok(r.status === 'none' && calls.telegram.length === 2 && calls.fcm.length === 2, 'A5 a person with no channel: nothing sent, no error');
ok(!JSON.stringify(r).includes('555') && !JSON.stringify(r).includes('fcm-'), 'A5 the answer never carries an id back');
r = post({ action: 'telegram', idToken: tok('ahmed'), chatId: '555', title: 'hi' });
ok(r.message === 'Unknown action' && calls.telegram.length === 2, 'A5 the old send-to-a-chat-id action is gone');
r = post({ action: 'fcm', idToken: tok('ahmed'), token: 'fcm-ahmed', title: 'hi' });
ok(r.message === 'Unknown action' && calls.fcm.length === 2, 'A5 the old send-to-a-token action is gone');
r = post({ action: 'checkLink', idToken: tok('ahmed'), code: 'abc' });
ok(r.status === 'ok' && r.linked === false && calls.patch.length === 0, 'A5 link polling works for an Approved user (not linked yet, nothing written)');

// ── A6 — per-person hourly limit ─────────────────────────────────────────────
reset();
let okCount = 0;
for (let i = 0; i < 60; i++) if (upload({ idToken: tok('ahmed') }).status === 'success') okCount++;
ok(okCount === 60, `A6 60 uploads in an hour are fine (got ${okCount})`);
r = upload({ idToken: tok('ahmed') });
ok(r.status === 'error' && /Too many uploads/.test(r.message) && files.length === 60, 'A6 the 61st upload this hour is refused');
ok(upload({ idToken: tok('admin') }).status === 'success', 'A6 the limit is per person — someone else can still upload');

// ── A7 — unknown action, bad type, hostile name ──────────────────────────────
reset();
ok(post({ action: 'deleteEverything', idToken: tok('ahmed') }).message === 'Unknown action', 'A7 unknown action refused');
ok(upload({ idToken: tok('ahmed'), mimeType: 'text/html' }).message === 'Unsupported file type', 'A7 HTML upload refused');
r = upload({ idToken: tok('ahmed'), filename: '../../evil\u0000name.png' });
ok(r.status === 'success' && !/[\/\\\u0000]/.test(files[0].name), `A7 slashes and control characters stripped from the file name (${JSON.stringify(files[0].name)})`);
r = upload({ idToken: tok('ahmed'), filename: 'x'.repeat(500) + '.png' });
ok(files[1].name.length === 200, 'A7 file name capped at 200 characters');
r = post({ idToken: tok('ahmed'), filename: 'legacy.png', mimeType: 'image/png', base64: PNG });
ok(r.status === 'success', 'A7 an upload without "action" (older app build) still works');

// ── A8 — one Auth lookup for a burst ─────────────────────────────────────────
reset();
for (let i = 0; i < 5; i++) post({ action: 'checkLink', idToken: tok('ahmed'), code: 'c' + i });
ok(calls.auth === 1 && calls.fsGet === 1, `A8 five calls, one Auth + one Firestore lookup (auth=${calls.auth}, fs=${calls.fsGet})`);
for (let i = 0; i < 3; i++) post({ action: 'notify', idToken: tok('ahmed'), toUid: 'u-ahmed', title: 't' });
ok(calls.auth === 1 && calls.batchGet === 3, `A8 each message is one Firestore round-trip (batchGets=${calls.batchGet})`);
reset();
upload({ idToken: tok('pending') }); upload({ idToken: tok('pending') });
ok(calls.auth === 2, 'A8 a refusal is NOT cached — approving someone takes effect at once');

// ── A9 — the Telegram webhook still works without a token ────────────────────
reset();
const wh = ctx.doPost({
  parameter: { tgsecret: 'whs' },
  postData: { contents: JSON.stringify({ update_id: 1, message: { chat: { id: 777 }, text: '/start' } }) },
});
ok(wh.text === 'ok' && calls.telegram.length === 1, 'A9 webhook with its own secret is answered');
const bad = ctx.doPost({ parameter: { tgsecret: 'wrong' }, postData: { contents: '{}' } });
ok(bad.text === 'forbidden', 'A9 webhook with a wrong secret is refused');

// ── A10 — linking Telegram: the script writes the chat id, for the caller only ─
reset();
cacheStore.set('tglink_code-ahmed', '9001');
r = post({ action: 'checkLink', idToken: tok('ahmed'), code: 'code-ahmed' });
ok(r.status === 'ok' && r.linked === true && !('chatId' in r), 'A10 a finished link answers "linked" without echoing the chat id');
ok(CONTACTS['u-ahmed'].telegramChatId === '9001' && CONTACTS['u-ahmed'].fcmToken === 'fcm-ahmed',
  "A10 the chat id is saved on the caller's private doc, push token untouched");
ok(calls.patch.length === 1 && calls.patch[0] === 'users/u-ahmed/private/contact', "A10 only the caller's own contact doc is written");
ok(USERS['u-ahmed'].telegramChatId === undefined, 'A10 nothing lands on the public user doc');
r = post({ action: 'checkLink', idToken: tok('ahmed') });
ok(r.linked === false && calls.patch.length === 1, 'A10 no code, no write');

// ── A11 — the one-off move empties the public docs ───────────────────────────
reset();
CONTACTS['u-old'] = { fcmToken: 'fcm-newer' }; // a newer token already saved privately wins
const moved = ctx.moveContactsToPrivate();
ok(moved === 1, `A11 one user had ids to move (got ${moved})`);
ok(USERS['u-old'].telegramChatId === undefined && USERS['u-old'].fcmToken === undefined && USERS['u-old'].status === 'Approved',
  'A11 the public doc loses both ids and keeps everything else');
ok(CONTACTS['u-old'].telegramChatId === '777' && CONTACTS['u-old'].fcmToken === 'fcm-newer',
  'A11 the chat id moved to the private doc; the newer private token was kept');
ok(ctx.moveContactsToPrivate() === 0, 'A11 running it again moves nothing');

// ── Report ───────────────────────────────────────────────────────────────────
for (const f of fails) console.log('FAIL ' + f);
console.log(`\nscriptauth: ${pass}/${pass + fails.length} assertions passed`);
process.exit(fails.length ? 1 : 0);
