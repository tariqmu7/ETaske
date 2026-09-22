// Harness for google-apps-script.js -> REPLY-TO-UPDATE (queue task B5):
// answer a Telegram reminder with "done" / "delayed to Sunday" and the record
// updates itself.
//
// Two layers:
//   1. The PURE block (between "// PURE-START" and "// PURE-END") — the reply
//      parser, the link reader, the permission gate, the write plan.
//   2. The WHOLE script run end to end through doPost(), against an in-memory
//      Firestore REST fake and a fake Telegram API. Every Apps Script service
//      (UrlFetchApp, PropertiesService, CacheService, ...) is stubbed; nothing
//      touches the network.
//
//   node scripts/harness/telegramreply.mjs
//
// The parser tests pin "today" to Monday 21 Sep 2026 on purpose: which weekday
// "Sunday" lands on is the whole point. The flow tests stub the script's clock
// to the same day.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'google-apps-script.js'), 'utf8');

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ── 1. The pure block ────────────────────────────────────────────────────────
const start = SRC.indexOf('// PURE-START');
const end = SRC.indexOf('// PURE-END');
ok(start > 0 && end > start, 'setup: PURE-START / PURE-END markers present');
const P = {};
vm.runInNewContext(SRC.slice(start, end) + `
  Object.assign(__out, { tgParseReply, tgRecordRefFromMessage, tgCanUpdate, tgPlanUpdate,
    tgReplyText, tgWhoToTell, tgFormatDate, tgNormalize, TG_REPLY_HINT });`, { __out: P });

const TODAY = '2026-09-21';
eq(new Date(TODAY + 'T00:00:00Z').getUTCDay(), 1, 'setup: the fixture "today" is a Monday');
const parse = (t) => P.tgParseReply(t, TODAY);

// P1 — "done", in the ways people actually write it
for (const t of ['done', 'Done!', 'DONE.', 'finished', 'completed', 'closed', '✅', 'تم', 'تمت',
  'تمّ', 'خلصت', 'خلصتها', 'وتم', 'اتقفلت', 'انتهيت', 'أنجزت', 'تم ✅', 'done, thanks',
  'finished today', 'خلصتها النهارده', 'تم اليوم']) {
  eq(parse(t), { kind: 'done' }, `P1 "${t}" reads as done`);
}

// P2 — things that must NOT close a record
for (const t of ['ok', 'OK', 'تمام', 'noted', 'thanks', 'not done yet', 'not done', 'مش خلصت',
  'لسه ما خلصتش', 'لم ينته', 'hello', '', '   ', 'done sunday',
  'I will be done once the client answers our last letter about it']) {
  eq(parse(t).kind, 'unknown', `P2 "${t}" changes nothing`);
}

// P3 — "delay to …", English and Arabic (today = Mon 21 Sep 2026)
const delays = [
  ['delayed to Sunday', '2026-09-27'], ['delay to sunday', '2026-09-27'], ['Sunday', '2026-09-27'],
  ['sun', '2026-09-27'], ['move it to Thursday', '2026-09-24'], ['thu', '2026-09-24'],
  ['Monday', '2026-09-28'], ['next monday', '2026-09-28'], ['tomorrow', '2026-09-22'],
  ['day after tomorrow', '2026-09-23'], ['in 3 days', '2026-09-24'], ['3 days', '2026-09-24'],
  ['2 weeks', '2026-10-05'], ['next week', '2026-09-27'], ['a week', '2026-09-28'],
  ['30/9', '2026-09-30'], ['30-9', '2026-09-30'], ['30.9', '2026-09-30'], ['5/10/2026', '2026-10-05'],
  ['5/10/26', '2026-10-05'], ['2026-10-05', '2026-10-05'], ['5 Oct', '2026-10-05'],
  ['Oct 5th', '2026-10-05'], ['postpone to 5 October 2026', '2026-10-05'], ['today', '2026-09-21'],
  ['أجّل للأحد', '2026-09-27'], ['أجل للاحد', '2026-09-27'], ['الأحد', '2026-09-27'],
  ['تأجيل للأحد', '2026-09-27'], ['تم التأجيل للأحد', '2026-09-27'], ['للخميس', '2026-09-24'],
  ['يوم الخميس', '2026-09-24'], ['الاتنين', '2026-09-28'], ['بكرة', '2026-09-22'], ['بكره', '2026-09-22'],
  ['غدًا', '2026-09-22'], ['بعد بكرة', '2026-09-23'], ['بعد 3 أيام', '2026-09-24'],
  ['بعد ٣ أيام', '2026-09-24'], ['يومين', '2026-09-23'], ['أسبوعين', '2026-10-05'],
  ['الأسبوع الجاي', '2026-09-27'], ['الاسبوع القادم', '2026-09-27'], ['٣٠/٩', '2026-09-30'],
  ['أجلها لـ 30/9', '2026-09-30'], ['5 أكتوبر', '2026-10-05'], ['أجّله للسبت', '2026-09-26'],
  ['waiting for the client, will send it Thursday', '2026-09-24'],
];
for (const [t, d] of delays) eq(parse(t), { kind: 'delay', date: d }, `P3 "${t}" -> ${d}`);

// P4 — a weekday abbreviation inside a sentence is an English word, not a date
eq(parse('I sat with Ahmed about it and we agreed the scope').kind, 'unknown', 'P4 "sat" in a sentence is not Saturday');

// P5 — bad dates and "to when?"
eq(parse('1/9'), { kind: 'badDate', reason: 'past' }, 'P5 a past date is refused');
eq(parse('20/9'), { kind: 'badDate', reason: 'past' }, 'P5 yesterday is refused');
eq(parse('31/9'), { kind: 'badDate', reason: 'invalid' }, 'P5 31 September is no date');
eq(parse('5/10/2030'), { kind: 'badDate', reason: 'far' }, 'P5 four years out is a typo');
eq(parse('delay'), { kind: 'needDate' }, 'P5 "delay" alone asks to when');
eq(parse('postpone it please'), { kind: 'needDate' }, 'P5 "postpone it" asks to when');
eq(parse('أجّله'), { kind: 'needDate' }, 'P5 «أجّله» alone asks to when');

// P6 — "Sunday" on a Sunday means next week, never today
eq(P.tgParseReply('Sunday', '2026-09-27'), { kind: 'delay', date: '2026-10-04' }, 'P6 Sunday on a Sunday = +7');
eq(P.tgParseReply('30/1', '2026-12-20'), { kind: 'badDate', reason: 'past' },
  'P6 a day/month already gone this year is refused, not silently moved a year on');

// L — which record a bot message points at
const APP = 'https://tarekmoh123.github.io/ETaske/';
const botMsg = (url, extra = {}) => ({
  message_id: 7, from: { id: 1, is_bot: true, username: 'E_TASK_bot' }, text: '🔴 Overdue\n…\n\n🔗 فتح في ETaske',
  entities: [{ type: 'bold', offset: 0, length: 10 }, { type: 'text_link', offset: 20, length: 14, url }], ...extra,
});
eq(P.tgRecordRefFromMessage(botMsg(APP + '#/tasks?open=abc123'), 'E_TASK_bot'),
  { collection: 'tasks', id: 'abc123' }, 'L1 a task link');
eq(P.tgRecordRefFromMessage(botMsg(APP + '#/correspondences?open=Cx_9-z'), 'E_TASK_bot'),
  { collection: 'correspondences', id: 'Cx_9-z' }, 'L2 a correspondence link');
eq(P.tgRecordRefFromMessage(botMsg(APP + '#/manager-inbox?open=C1'), 'E_TASK_bot'),
  { collection: 'correspondences', id: 'C1' }, 'L3 the manager-inbox view is a correspondence');
eq(P.tgRecordRefFromMessage(botMsg(APP + '#/opportunities?open=O1'), 'E_TASK_bot'),
  { collection: 'opportunities', id: 'O1' }, 'L4 a bid link is recognised (and later refused)');
eq(P.tgRecordRefFromMessage(botMsg(APP + '#/tasks?open=abc', { from: { id: 5, is_bot: false } }), 'E_TASK_bot'),
  null, 'L5 a message the USER wrote never counts');
eq(P.tgRecordRefFromMessage(botMsg(APP + '#/tasks?open=abc', { from: { id: 9, is_bot: true, username: 'OtherBot' } }), 'E_TASK_bot'),
  null, 'L6 another bot\'s message never counts');
eq(P.tgRecordRefFromMessage(botMsg(APP + '#/tasks?open=..%2Fusers%2Fx'), 'E_TASK_bot'), null, 'L7 a path-like id is rejected');
eq(P.tgRecordRefFromMessage(botMsg(APP + '#/tasks?open=--stats--'), 'E_TASK_bot'), null, 'L8 the counter doc is rejected');
eq(P.tgRecordRefFromMessage(botMsg(APP + '#/due-soon'), 'E_TASK_bot'), null, 'L9 the daily briefing link points at no record');
eq(P.tgRecordRefFromMessage({ from: { is_bot: true, username: 'E_TASK_bot' }, text: 'hi' }, 'E_TASK_bot'), null, 'L10 no link, no record');
eq(P.tgRecordRefFromMessage(undefined, 'E_TASK_bot'), null, 'L11 not a reply at all');
{
  const text = 'see ' + APP + '#/tasks?open=T77';
  eq(P.tgRecordRefFromMessage({ from: { is_bot: true, username: 'E_TASK_bot' }, text,
    entities: [{ type: 'url', offset: 4, length: text.length - 4 }] }, 'E_TASK_bot'),
    { collection: 'tasks', id: 'T77' }, 'L12 a plain URL entity works too');
}

// G — the permission gate (mirrors firestore.rules; the script owner bypasses them)
const U = (id, role = 'Employee', status = 'Approved') => ({ id, role, status });
const task = { assignedToId: 'emp', assignedById: 'boss', collaboratorIds: ['col'] };
ok(P.tgCanUpdate('tasks', task, U('emp')), 'G1 the owner may');
ok(P.tgCanUpdate('tasks', task, U('col')), 'G2 a collaborator may');
ok(P.tgCanUpdate('tasks', task, U('boss')), 'G3 the assigner may');
ok(P.tgCanUpdate('tasks', task, U('mgr', 'Manager')), 'G4 a manager may, on a public task');
ok(!P.tgCanUpdate('tasks', task, U('other')), 'G5 a colleague may not');
ok(!P.tgCanUpdate('tasks', task, U('emp', 'Employee', 'Pending')), 'G6 a not-yet-approved owner may not');
ok(!P.tgCanUpdate('tasks', { ...task, isPrivate: true }, U('mgr', 'Admin')), 'G7 an admin may not touch a private task');
ok(!P.tgCanUpdate('tasks', { ...task, isPrivate: true }, U('boss')), 'G8 nor may its assigner');
ok(P.tgCanUpdate('tasks', { ...task, isPrivate: true }, U('emp')), 'G9 the owner of a private task may');
const corr = { userId: 'clerk', assignedToId: 'emp' };
ok(P.tgCanUpdate('correspondences', corr, U('clerk')), 'G10 the one who logged a letter may');
ok(P.tgCanUpdate('correspondences', corr, U('emp')), 'G11 its assignee may (the one deliberate widening)');
ok(P.tgCanUpdate('correspondences', corr, U('mgr', 'Manager')), 'G12 a manager may');
ok(!P.tgCanUpdate('correspondences', corr, U('other')), 'G13 a colleague may not');
ok(!P.tgCanUpdate('opportunities', { ownerId: 'emp' }, U('emp', 'Admin')), 'G14 bids are never changed from Telegram');
ok(!P.tgCanUpdate('tasks', task, null), 'G15 no user, no change');

// W — the write plan
eq(P.tgPlanUpdate('tasks', { status: 'Pending' }, { kind: 'done' }), { ok: true, fields: { status: 'Done' } }, 'W1 task done');
eq(P.tgPlanUpdate('tasks', { status: 'In Progress', correspondingId: 'C9' }, { kind: 'done' }),
  { ok: true, fields: { status: 'Done' }, closesCorrespondence: 'C9' }, 'W2 a done task closes its source letter, as the app does');
eq(P.tgPlanUpdate('tasks', { status: 'Pending', dueDate: '2026-09-18' }, { kind: 'delay', date: '2026-09-27' }),
  { ok: true, fields: { dueDate: '2026-09-27' }, before: '2026-09-18' }, 'W3 task delay writes dueDate (NOT deadline)');
eq(P.tgPlanUpdate('correspondences', { status: 'Assigned', deadline: '2026-09-18' }, { kind: 'delay', date: '2026-09-27' }),
  { ok: true, fields: { deadline: '2026-09-27' }, before: '2026-09-18' }, 'W4 correspondence delay writes deadline');
eq(P.tgPlanUpdate('correspondences', { status: 'Reviewing' }, { kind: 'done' }), { ok: true, fields: { status: 'Closed' } }, 'W5 correspondence done = Closed');
eq(P.tgPlanUpdate('tasks', { status: 'Done' }, { kind: 'done' }), { ok: false, reason: 'alreadyDone' }, 'W6 already done');
eq(P.tgPlanUpdate('tasks', { status: 'Done' }, { kind: 'delay', date: '2026-09-27' }), { ok: false, reason: 'alreadyDone' }, 'W7 a done task is not re-dated');
eq(P.tgPlanUpdate('tasks', { status: 'Archived' }, { kind: 'done' }), { ok: false, reason: 'archived' }, 'W8 archived');
eq(P.tgPlanUpdate('correspondences', { status: 'Closed' }, { kind: 'done' }), { ok: false, reason: 'alreadyDone' }, 'W9 already closed');

// N — who hears about it
const staff = [U('emp'), U('boss', 'Manager'), U('mgr2', 'Manager'), U('adm', 'Admin'), U('x')];
eq(P.tgWhoToTell('tasks', { assignedById: 'boss' }, U('emp'), staff).sort(), ['adm', 'boss', 'mgr2'], 'N1 assigner + managers, deduped');
eq(P.tgWhoToTell('tasks', { assignedById: 'boss' }, U('boss', 'Manager'), staff).sort(), ['adm', 'mgr2'], 'N2 never the actor');
eq(P.tgWhoToTell('tasks', { assignedById: 'emp', isPrivate: true }, U('emp'), staff), [], 'N3 a private task tells no manager');
eq(P.tgWhoToTell('correspondences', { assignedById: 'x' }, U('emp'), staff).sort(), ['adm', 'boss', 'mgr2'], 'N4 a letter tells the managers');

// T — the texts. Arabic house rules: no «بواسطة», no Latin comma or question
// mark, no Arabic-Indic digits; «تم» only ever as the quoted word to type.
eq(P.tgFormatDate('2026-09-27', 'en'), 'Sunday 27 Sep 2026', 'T1 English date');
eq(P.tgFormatDate('2026-09-27', 'ar'), 'الأحد 27 سبتمبر 2026', 'T2 Arabic date, Latin digits');
const keys = ['doneTask', 'doneCorr', 'delayed', 'toldManager', 'alreadyDone', 'archived', 'notAllowed',
  'notLinked', 'notFound', 'bid', 'pickMessage', 'needDate', 'past', 'far', 'invalid', 'error', 'unknown'];
for (const k of keys) {
  const ar = P.tgReplyText(k, 'ar', { name: 'عرض أجيبا', date: '2026-09-27' });
  const en = P.tgReplyText(k, 'en', { name: 'AGIBA offer', date: '2026-09-27' });
  ok(ar && en && ar !== en, `T3 "${k}" exists in both languages`);
  ok(!/بواسطة|[,?]|[٠-٩]/.test(ar), `T4 "${k}" Arabic is clean: ${ar}`);
  // Whole word only — «سبتمبر» and «تملك» merely contain the letters.
  ok(!ar.replace(/«تم»/g, '').split(/[\s،؛.:()«»]+/).includes('تم'), `T5 "${k}" uses no passive «تم»: ${ar}`);
}
ok(P.tgReplyText('delayed', 'ar', { name: 'X', date: '2026-09-27' }).includes('الأحد 27 سبتمبر 2026'), 'T6 the Arabic confirmation names the new day');
ok(!/[,?]|[٠-٩]/.test(P.TG_REPLY_HINT.split('\n')[1]), 'T7 the Arabic hint line is clean');

// ── 2. The whole script, end to end through doPost ───────────────────────────
function makeWorld() {
  const docs = new Map(); // "col/id" -> plain object
  const sent = [];        // telegram sendMessage payloads
  const cache = new Map();
  let failPatch = false;
  let seq = 0;

  const enc = (v) => v === null || v === undefined ? { nullValue: null }
    : typeof v === 'boolean' ? { booleanValue: v }
      : typeof v === 'number' ? { integerValue: String(v) }
        : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
          : { stringValue: String(v) };
  const encFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));
  const dec = (v) => 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue
    : 'integerValue' in v ? +v.integerValue : 'timestampValue' in v ? { ts: v.timestampValue }
      : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec) : null;
  const decFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, dec(v)]));
  const NAME = 'projects/gen-lang-client-0893475577/databases/ai-studio-82d500c4-619e-4632-9bd3-9466532da5e6/documents/';
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => body === undefined ? '' : JSON.stringify(body) });

  const UrlFetchApp = {
    fetch(url, opts) {
      if (url.startsWith('https://api.telegram.org/')) {
        sent.push(JSON.parse(opts.payload));
        return resp(200, { ok: true });
      }
      const m = url.match(/\/documents(.*)$/);
      if (!m) throw new Error('unexpected fetch ' + url);
      ok(opts.headers && /^Bearer /.test(opts.headers.Authorization), 'F0 every Firestore call carries the owner token');
      const [p, qs = ''] = m[1].split('?');
      const method = (opts.method || 'get').toLowerCase();
      if (p === ':batchGet') {
        return resp(200, JSON.parse(opts.payload).documents.map((name) => {
          const k = name.slice(NAME.length);
          return docs.has(k) ? { found: { name, fields: encFields(docs.get(k)) } } : { missing: name };
        }));
      }
      if (p === ':runQuery') {
        const q = JSON.parse(opts.payload).structuredQuery;
        const col = q.from[0].collectionId;
        const { field, value } = q.where.fieldFilter;
        const want = dec(value);
        const rows = [...docs].filter(([k, d]) => k.startsWith(col + '/') && d[field.fieldPath] === want)
          .map(([k, d]) => ({ document: { name: NAME + k, fields: encFields(d) } }));
        return resp(200, rows);
      }
      const key = decodeURIComponent(p.replace(/^\//, ''));
      if (method === 'get') return docs.has(key) ? resp(200, { name: NAME + key, fields: encFields(docs.get(key)) }) : resp(404, {});
      if (method === 'patch') {
        if (failPatch) return resp(500, { error: 'boom' });
        if (!docs.has(key)) return resp(404, {});
        const mask = [...new URLSearchParams(qs).entries()].filter(([k]) => k === 'updateMask.fieldPaths').map(([, v]) => v);
        const fields = decFields(JSON.parse(opts.payload).fields);
        ok(mask.length && mask.every(f => f in fields), 'F0 a PATCH names exactly the fields it sends');
        docs.set(key, { ...docs.get(key), ...fields });
        return resp(200, {});
      }
      if (method === 'post') {
        const id = 'n' + (++seq);
        docs.set(key + '/' + id, decFields(JSON.parse(opts.payload).fields));
        return resp(200, { name: NAME + key + '/' + id });
      }
      throw new Error('unexpected ' + method + ' ' + url);
    },
  };

  const props = {
    TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_WEBHOOK_SECRET: 'hook', SHARED_SECRET: 'shh',
  };
  const out = (s) => ({ s, setMimeType() { return this; }, getContent() { return s; } });
  const ctx = {
    UrlFetchApp,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
    ContentService: { createTextOutput: out, MimeType: { JSON: 'json', TEXT: 'text' } },
    ScriptApp: { getOAuthToken: () => 'owner-token' },
    Utilities: { formatDate: () => TODAY },
    Logger: { log: () => {} },
    DriveApp: {},
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return {
    docs, sent, ctx,
    set failPatch(v) { failPatch = v; },
    hook(update, secret = 'hook') {
      return ctx.doPost({ parameter: { tgsecret: secret }, postData: { contents: JSON.stringify(update) } });
    },
  };
}

let upd = 1000;
const reply = (chatId, text, replyTo) => ({
  update_id: ++upd,
  message: { message_id: upd, chat: { id: +chatId }, from: { id: +chatId, is_bot: false }, text,
    ...(replyTo ? { reply_to_message: replyTo } : {}) },
});
const seed = (w) => {
  // Chat ids live in the owner-only private contact doc (queue A3b)...
  w.docs.set('users/emp', { displayName: 'Mona', role: 'Employee', status: 'Approved' });
  w.docs.set('users/emp/private/contact', { telegramChatId: '111' });
  w.docs.set('users/boss', { displayName: 'Tariq', role: 'Manager', status: 'Approved' });
  w.docs.set('users/boss/private/contact', { telegramChatId: '222', fcmToken: 'fcm-boss' });
  w.docs.set('users/adm', { displayName: 'Admin', role: 'Admin', status: 'Approved' });
  // ...except for people not moved yet, whose id still sits on the public doc.
  w.docs.set('users/other', { displayName: 'Omar', role: 'Employee', status: 'Approved', telegramChatId: '333' });
  w.docs.set('users/new', { displayName: 'New', role: 'Employee', status: 'Pending' });
  w.docs.set('users/new/private/contact', { telegramChatId: '444' });
  w.docs.set('tasks/T1', { taskName: 'Send AGIBA prices', status: 'Pending', dueDate: '2026-09-17',
    assignedToId: 'emp', assignedById: 'boss', correspondingId: 'C1' });
  w.docs.set('tasks/T2', { taskName: 'Private note', status: 'Pending', dueDate: '2026-09-17',
    assignedToId: 'emp', assignedById: 'emp', isPrivate: true });
  w.docs.set('tasks/T3', { taskName: 'Old one', status: 'Done', dueDate: '2026-09-01', assignedToId: 'emp', assignedById: 'boss' });
  w.docs.set('correspondences/C1', { subject: 'AGIBA RFQ', status: 'Assigned', deadline: '2026-09-17', userId: 'boss', assignedToId: 'emp' });
  w.docs.set('correspondences/C2', { subject: 'NOC letter', status: 'Assigned', deadline: '2026-09-17', userId: 'boss', assignedToId: 'emp' });
};
const reminderFor = (view, id) => botMsg(APP + `#/${view}?open=${id}`);
const lastText = (w, chat) => { const m = w.sent.filter(s => String(s.chat_id) === chat).pop(); return m ? m.text : ''; };
const notifs = (w) => [...w.docs].filter(([k]) => k.startsWith('notifications/')).map(([, d]) => d);

// F1 — the owner answers "done" to the task reminder
{
  const w = makeWorld(); seed(w);
  w.hook(reply('111', 'done', reminderFor('tasks', 'T1')));
  const t = w.docs.get('tasks/T1');
  eq(t.status, 'Done', 'F1 the task is Done');
  ok(t.updatedAt && t.updatedAt.ts, 'F1 updatedAt is stamped');
  eq(w.docs.get('correspondences/C1').status, 'Closed', 'F1 its source letter is closed too');
  eq(t.dueDate, '2026-09-17', 'F1 the due date is left alone');
  const n = notifs(w);
  eq(n.map(x => x.forUserId).sort(), ['adm', 'boss'], 'F1 the assigner and the admin get a bell entry, the actor does not');
  ok(n.every(x => x.type === 'task_done' && x.relatedId === 'T1' && x.read === false && x.createdAt?.ts), 'F1 bell entries are well-formed');
  ok(/Mona marked "Send AGIBA prices" as Done from Telegram/.test(n[0].message), 'F1 the bell says who and how');
  ok(lastText(w, '222').includes('Task Completed'), 'F1 the manager gets a Telegram DM too');
  const conf = lastText(w, '111');
  ok(conf.includes('✅ Marked "Send AGIBA prices" as done.') && conf.includes('Your manager has been told.'), 'F1 the owner gets a confirmation: ' + conf);
  ok(conf.includes('#/tasks?open=T1'), 'F1 the confirmation carries the link, so it can be answered too');
}

// F2 — Arabic delay, then a correction by replying to the confirmation
{
  const w = makeWorld(); seed(w);
  w.hook(reply('111', 'أجّل للأحد', reminderFor('tasks', 'T1')));
  eq(w.docs.get('tasks/T1').dueDate, '2026-09-27', 'F2 dueDate moved to Sunday');
  eq(w.docs.get('tasks/T1').status, 'Pending', 'F2 the status is left alone');
  eq(w.docs.get('correspondences/C1').status, 'Assigned', 'F2 a delay does not close the letter');
  ok(lastText(w, '111').includes('نقلتُ موعد «Send AGIBA prices» إلى الأحد 27 سبتمبر 2026.'), 'F2 Arabic reply to an Arabic message');
  ok(notifs(w).some(x => x.type === 'task_updated' && /\(was 2026-09-17\)/.test(x.message)), 'F2 the manager sees the old date too');
  const confirmation = { ...botMsg(APP + '#/tasks?open=T1'), text: w.sent.at(-1).text };
  w.hook(reply('111', 'actually tuesday', confirmation));
  eq(w.docs.get('tasks/T1').dueDate, '2026-09-22', 'F2 replying to the confirmation re-dates it again');
}

// F3 — the correspondence reminder, answered by its assignee
{
  const w = makeWorld(); seed(w);
  w.hook(reply('111', 'تم', reminderFor('correspondences', 'C2')));
  eq(w.docs.get('correspondences/C2').status, 'Closed', 'F3 the letter is Closed');
  ok(lastText(w, '111').includes('أغلقتُ المراسلة «NOC letter»'), 'F3 Arabic confirmation');
  w.hook(reply('111', '30/9', reminderFor('correspondences', 'C1')));
  eq(w.docs.get('correspondences/C1').deadline, '2026-09-30', 'F3 a letter\'s deadline moves');
}

// F4 — refusals change nothing
{
  const w = makeWorld(); seed(w);
  const before = JSON.stringify([...w.docs]);
  w.hook(reply('333', 'done', reminderFor('tasks', 'T1')));
  ok(lastText(w, '333').includes('not allowed'), 'F4 a colleague is refused');
  w.hook(reply('222', 'done', reminderFor('tasks', 'T2')));
  ok(lastText(w, '222').includes('not allowed'), 'F4 a manager is refused on a private task');
  w.hook(reply('999', 'done', reminderFor('tasks', 'T1')));
  ok(lastText(w, '999').includes('not linked'), 'F4 an unknown chat is told to link first');
  w.hook(reply('444', 'done', reminderFor('tasks', 'T1')));
  ok(lastText(w, '444').includes('not linked'), 'F4 a pending account is refused');
  w.hook(reply('111', 'done', reminderFor('tasks', 'T3')));
  ok(lastText(w, '111').includes('already done'), 'F4 already done');
  w.hook(reply('111', 'done', reminderFor('tasks', 'GONE')));
  ok(lastText(w, '111').includes('no longer exists'), 'F4 a deleted record');
  w.hook(reply('111', 'done', reminderFor('opportunities', 'O1')));
  ok(lastText(w, '111').includes('Bids are not updated'), 'F4 a bid');
  w.hook(reply('111', 'maybe', reminderFor('tasks', 'T1')));
  ok(lastText(w, '111').includes('did not understand'), 'F4 gibberish gets the how-to');
  w.hook(reply('111', 'delay', reminderFor('tasks', 'T1')));
  ok(lastText(w, '111').includes('To when?'), 'F4 "delay" alone asks to when');
  w.hook(reply('111', '1/9', reminderFor('tasks', 'T1')));
  ok(lastText(w, '111').includes('has passed'), 'F4 a past date');
  eq(JSON.stringify([...w.docs]), before, 'F4 not one document changed');
}

// F5 — outside a reply: speak only when it was meant as an instruction
{
  const w = makeWorld(); seed(w);
  w.hook(reply('111', 'done'));
  ok(lastText(w, '111').includes('Reply to the reminder itself'), 'F5 a bare "done" is told to reply to the reminder');
  const n = w.sent.length;
  w.hook(reply('111', 'hello there'));
  w.hook(reply('111', 'thanks'));
  eq(w.sent.length, n, 'F5 small talk still gets silence');
  const own = { from: { id: 111, is_bot: false }, text: APP + '#/tasks?open=T1',
    entities: [{ type: 'url', offset: 0, length: (APP + '#/tasks?open=T1').length }] };
  w.hook(reply('111', 'done', own));
  eq(w.docs.get('tasks/T1').status, 'Pending', 'F5 replying to your OWN link cannot aim the bot');
}

// F6 — Telegram redelivers the same update: it is applied once
{
  const w = makeWorld(); seed(w);
  const u = reply('111', 'أجّل للأحد', reminderFor('tasks', 'T1'));
  w.hook(u); w.hook(u); w.hook(u);
  eq(notifs(w).length, 2, 'F6 three deliveries, one set of notifications');
  eq(w.sent.filter(s => String(s.chat_id) === '111').length, 1, 'F6 one confirmation');
}

// F7 — a forged webhook call does nothing
{
  const w = makeWorld(); seed(w);
  const r = w.hook(reply('111', 'done', reminderFor('tasks', 'T1')), 'wrong');
  eq(r.s, 'forbidden', 'F7 wrong webhook secret is refused');
  eq(w.docs.get('tasks/T1').status, 'Pending', 'F7 and nothing changed');
}

// F8 — Firestore failing is reported, not swallowed
{
  const w = makeWorld(); seed(w);
  w.failPatch = true;
  const r = w.hook(reply('111', 'done', reminderFor('tasks', 'T1')));
  eq(r.s, 'ok', 'F8 the webhook still answers Telegram');
  ok(lastText(w, '111').includes('Could not update'), 'F8 the user is told it did not save');
  eq(w.docs.get('tasks/T1').status, 'Pending', 'F8 and nothing half-written');
}

// F9 — the reminder itself carries the hint only when asked
{
  const w = makeWorld();
  // The caller gate (ID token + Approved) is proven by scriptauth.mjs; here it
  // is waved through so F9 tests only the message text.
  w.ctx.callerFromRequest = () => ({ uid: 'u1', email: 'a@x', role: 'Employee' });
  w.ctx.recipientContact = () => ({ telegramChatId: '1' });
  w.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action: 'notify', idToken: 't', toUid: 'u1',
    title: '🔴 Overdue', body: 'x', url: APP + '#/tasks?open=T1', replyHint: true }) } });
  ok(w.sent[0].text.includes('Reply "done"') && w.sent[0].text.includes('«أجّل للأحد»'), 'F9 an overdue reminder shows the hint in both languages');
  w.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action: 'notify', idToken: 't', toUid: 'u1',
    title: 'Task assigned', body: 'x', url: APP + '#/tasks?open=T1' }) } });
  ok(!w.sent[1].text.includes('Reply "done"'), 'F9 other messages do not');
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\ntelegramreply: ${pass}/${pass + fails.length} assertions passed`);
if (fails.length) {
  console.error('\nFAILED:');
  fails.forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}
