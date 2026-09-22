// Harness for src/lib/followUp.ts — the ready-made follow-up letters (AR/EN)
// and the escalation to the manager (queue task B4).
//
// Bundles the REAL module with esbuild, stubbing only the two things that need
// a browser or the network: ./pushNotification (createNotification) and
// firebase/firestore (serverTimestamp). The letters, the Arabic agreement, the
// quiet-day clock and the once-per-level ledger are the actual shipping code.
//
//   node scripts/harness/followup.mjs
//
// The escalation fixtures pin a REAL Monday on purpose: the whole point of the
// clock is WHICH day of the week a date falls on (Egypt's weekend is Fri+Sat).

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'followUp.bundle.mjs');

const stubPlugin = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /pushNotification$/ }, () => ({ path: 'stub-push', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'stub-fs', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-push'
        ? `export async function createNotification(data, users, url) { globalThis.__sent.push({ data, users, url }); }`
        : `export function serverTimestamp() { return '<serverTimestamp>'; }`,
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [path.join(ROOT, 'src/lib/followUp.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  // src/utils.ts (reached through mailThreads) reads import.meta.env at load.
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  plugins: [stubPlugin],
  logLevel: 'warning',
});

const sent = [];
globalThis.__sent = sent;

// Minimal localStorage so the real ledger code runs unmodified.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const {
  buildFollowUpLetter, buildFollowUpPair, toneFor, mailtoUrl, waitingSince,
  quietWorkingDays, escalationLevel, buildEscalationMessage, isEscalatable,
  runEscalations, localDay,
  FIRM_AFTER_WORKING_DAYS, FINAL_AFTER_WORKING_DAYS,
  ESCALATE_LEVEL_1, ESCALATE_LEVEL_2,
} = await import(pathToFileURL(OUT).href);

// ── assertions ───────────────────────────────────────────────────────────────
let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const has = (text, needle, label) =>
  ok(String(text).includes(needle), `${label} — "${needle}" missing from:\n${text}`);
const lacks = (text, needle, label) =>
  ok(!String(text).includes(needle), `${label} — "${needle}" should not appear in:\n${text}`);

// ── 1. Tone ──────────────────────────────────────────────────────────────────

eq(toneFor(0), 'gentle', 'T1 a fresh wait is a polite nudge');
eq(toneFor(FIRM_AFTER_WORKING_DAYS - 1), 'gentle', 'T2 …right up to the threshold');
eq(toneFor(FIRM_AFTER_WORKING_DAYS), 'firm', 'T3 a week of silence earns a firmer letter');
eq(toneFor(FINAL_AFTER_WORKING_DAYS - 1), 'firm', 'T4 …and stays firm until the last threshold');
eq(toneFor(FINAL_AFTER_WORKING_DAYS), 'final', 'T5 two weeks earns the final notice');
eq(toneFor(undefined), 'gentle', 'T6 an unknown wait never writes a threat');

const INFO = {
  subject: 'Tender 4412 — workover services',
  counterparty: 'AGIBA Petroleum',
  email: 'a.hassan@agiba.com.eg',
  ourName: 'Tariq Mohamed',
  reference: 'CR000121',
  lastContact: '10/09/2026',
  waitingDays: 3,
};

// ── 2. The English letters ───────────────────────────────────────────────────

{
  const g = buildFollowUpLetter(INFO, 'en');
  eq(g.tone, 'gentle', 'E1 the tone follows the wait when none is forced');
  eq(g.subject, 'Follow-up: Tender 4412 — workover services', 'E2 the polite subject line');
  has(g.body, 'Dear AGIBA Petroleum,', 'E3 it is addressed to them');
  has(g.body, 'ref CR000121', 'E4 the reference is quoted');
  has(g.body, '10/09/2026', 'E5 …and the date we last wrote');
  has(g.body, 'Kind regards,', 'E6 it closes as a letter');
  has(g.body, 'Tariq Mohamed', 'E7 …and is signed');
  lacks(g.body, 'management', 'E8 a first nudge never threatens an escalation');

  const f = buildFollowUpLetter({ ...INFO, waitingDays: 6 }, 'en');
  eq(f.tone, 'firm', 'E9 six quiet days is no longer a nudge');
  eq(f.subject, 'Second follow-up: Tender 4412 — workover services', 'E10 the firmer subject line');
  has(f.body, '6 working days', 'E11 the firmer letter names the wait');
  lacks(f.body, 'refer the matter', 'E12 …but still does not threaten');

  const x = buildFollowUpLetter({ ...INFO, waitingDays: 14, needBy: '30/09/2026' }, 'en');
  eq(x.tone, 'final', 'E13 a fortnight earns the final notice');
  eq(x.subject, 'Final reminder: Tender 4412 — workover services', 'E14 the final subject line');
  has(x.body, '14 working days', 'E15 the final letter names the wait');
  has(x.body, 'by 30/09/2026', 'E16 …and the date we need the answer by');
  has(x.body, 'refer the matter to our management', 'E17 …and says what happens next');

  eq(buildFollowUpLetter({ ...INFO, waitingDays: 1 }, 'en', 'firm').body.includes('1 working day '), true,
    'E18 one day is singular');
  has(buildFollowUpLetter({ subject: 'Offer' }, 'en').body, 'Dear Sir / Madam,',
    'E19 an unknown counterparty gets the neutral opening');
  lacks(buildFollowUpLetter({ subject: 'Offer' }, 'en').body, 'ref ',
    'E20 a missing reference leaves no empty bracket');
  lacks(buildFollowUpLetter({ subject: 'Offer' }, 'en').body, 'undefined',
    'E21 …and no missing field ever renders as "undefined"');
}

// ── 3. The internal nudge (a colleague, not a client) ────────────────────────

{
  const i = buildFollowUpLetter({ ...INFO, counterparty: 'Nevine', internal: true }, 'en');
  eq(i.subject, 'Reminder: Tender 4412 — workover services', 'I1 a colleague gets a reminder, not a letter');
  has(i.body, 'Hi Nevine,', 'I2 …opened as a message');
  lacks(i.body, 'Kind regards,', 'I3 …and closed as one');
  has(buildFollowUpLetter({ ...INFO, internal: true, waitingDays: 12 }, 'en').body, 'raise it with management',
    'I4 the final internal nudge says it goes upstairs');

  const ar = buildFollowUpLetter({ ...INFO, counterparty: 'نفين', internal: true }, 'ar');
  has(ar.body, 'الأستاذ/ نفين،', 'I5 the Arabic nudge opens on the person');
  lacks(ar.body, 'إلى السادة', 'I6 …and drops the letterhead opening');
}

// ── 4. The Arabic letters ────────────────────────────────────────────────────

{
  const g = buildFollowUpLetter(INFO, 'ar');
  eq(g.subject, 'متابعة: Tender 4412 — workover services', 'A1 the Arabic subject line');
  has(g.body, 'إلى السادة/ AGIBA Petroleum', 'A2 it is addressed to them');
  has(g.body, 'تحية طيبة وبعد،', 'A3 …with the opening a business letter has');
  has(g.body, 'المرجع: CR000121', 'A4 the reference is quoted');
  has(g.body, 'لم يصلنا ردكم حتى تاريخه', 'A5 …and says plainly that no reply came');
  has(g.body, 'وتفضلوا بقبول وافر الاحترام،', 'A6 it closes the way an Arabic letter closes');

  has(buildFollowUpLetter({ subject: 'عرض فني' }, 'ar').body, 'إلى السادة المعنيين',
    'A7 an unknown counterparty gets the neutral Arabic opening');

  // The count has to agree with the number — the thing a translated letter
  // always gets wrong.
  has(buildFollowUpLetter({ ...INFO, waitingDays: 1 }, 'ar', 'firm').body, 'يوم عمل واحد', 'A8 singular');
  has(buildFollowUpLetter({ ...INFO, waitingDays: 2 }, 'ar', 'firm').body, 'يومَي عمل', 'A9 dual');
  has(buildFollowUpLetter({ ...INFO, waitingDays: 5 }, 'ar', 'firm').body, '5 أيام عمل', 'A10 the 3–10 plural');
  has(buildFollowUpLetter({ ...INFO, waitingDays: 12 }, 'ar', 'firm').body, '12 يوم عمل', 'A11 singular again from 11');

  has(buildFollowUpLetter({ ...INFO, waitingDays: 14 }, 'ar').body, 'رفعنا الأمر إلى إدارتنا',
    'A12 the final Arabic letter says what happens next');
}

// Every Arabic letter we can produce, checked for the marks of a translation.
{
  const BANNED = ['تم ', 'يتم ', 'تمت ', 'بواسطة', 'الخاص بـ', 'القيام بـ', 'على أساس', 'فيما يتعلق'];
  const ARABIC_INDIC = /[٠-٩]/;
  let checked = 0;
  for (const tone of ['gentle', 'firm', 'final']) {
    for (const internal of [false, true]) {
      for (const info of [INFO, { subject: 'موضوع' }]) {
        const body = buildFollowUpLetter({ ...info, internal, waitingDays: 7 }, 'ar', tone).body;
        checked++;
        for (const word of BANNED) {
          ok(!body.includes(word), `A13 "${word}" appears in the ${tone}${internal ? ' internal' : ''} Arabic letter`);
        }
        ok(!ARABIC_INDIC.test(body), `A14 Arabic-Indic digits in the ${tone} letter (the app locale is latn)`);
        ok(!/[a-z]\,/.test(body), `A15 a Latin comma in the ${tone} letter`);
        ok(!body.includes('undefined'), `A16 a missing field rendered as "undefined" in the ${tone} letter`);
        ok(body.trim() === body, `A17 the ${tone} letter has no stray whitespace at either end`);
        ok(!body.includes('\n\n\n'), `A18 the ${tone} letter has no gap left by a missing field`);
      }
    }
  }
  eq(checked, 12, 'A19 every Arabic tone/audience combination was checked');
}

// ── 5. Both languages, and the mail draft ────────────────────────────────────

{
  const pair = buildFollowUpPair({ ...INFO, waitingDays: 8 });
  eq(pair.en.tone, 'firm', 'P1 both letters take the same tone');
  eq(pair.ar.tone, 'firm', 'P2 …in both languages');
  eq(pair.en.lang, 'en', 'P3 the English one is tagged English');
  eq(pair.ar.lang, 'ar', 'P4 …and the Arabic one Arabic');
  ok(pair.en.body !== pair.ar.body, 'P5 the Arabic is written, not transliterated');

  const url = mailtoUrl(pair.en, INFO.email);
  has(url, 'mailto:a.hassan%40agiba.com.eg', 'P6 the draft opens addressed to them');
  has(url, `subject=${encodeURIComponent(pair.en.subject)}`, 'P7 …with the subject filled in');
  has(url, encodeURIComponent('Dear AGIBA Petroleum'), 'P8 …and the body');
  has(mailtoUrl(pair.ar), 'mailto:?', 'P9 an unknown address still opens an empty draft');
}

// ── 6. The quiet clock ───────────────────────────────────────────────────────
//
// Monday 21 Sep 2026, 10:00 local. Fixed on purpose: the weekend rule is about
// which weekday a date falls on.

const NOW = new Date(2026, 8, 21, 10, 0, 0);
eq(NOW.getDay(), 1, 'setup: the fixture "now" is a Monday');

const task = (over = {}) => ({
  id: 'tk1', kind: 'task', label: 'Prepare the AGIBA offer', serial: 'TK000012',
  due: '2026-09-13', status: 'In Progress', priority: 'High',
  ownerId: 'u-ahmed', ownerName: 'Ahmed Hassan', ...over,
});

eq(quietWorkingDays(task({ due: '2026-09-14' }), NOW), 5, 'Q1 Monday to Monday is five working days');
eq(quietWorkingDays(task(), NOW), 6, 'Q2 …and a day earlier crosses the threshold');
eq(quietWorkingDays(task({ due: '2026-09-03' }), NOW), 12, 'Q3 the longer silence counts the weekends out too');
eq(quietWorkingDays(task({ due: '2026-09-21' }), NOW), 0, 'Q4 a record due today is not late');
eq(quietWorkingDays(task({ due: '2026-10-01' }), NOW), 0, 'Q5 …nor is one due next month');
eq(quietWorkingDays(task({ due: undefined }), NOW), 0, 'Q6 a record with no date can never be late');
eq(quietWorkingDays(task({ status: 'Done' }), NOW), 0, 'Q7 a finished record is not chased');
eq(quietWorkingDays(task({ status: 'Archived' }), NOW), 0, 'Q8 …nor an archived one');
eq(quietWorkingDays(task({ due: 'not a date' }), NOW), 0, 'Q9 an unparseable date does not spin');
eq(isEscalatable(task({ status: 'Closed' })), false, 'Q10 a closed record is out of scope');
eq(isEscalatable(task()), true, 'Q11 an open, dated record is in scope');

// An edit buys a fresh window — that is somebody moving it.
eq(quietWorkingDays(task({ updatedAt: new Date(2026, 8, 17, 9).getTime() }), NOW), 2,
  'Q12 the clock restarts at the last edit, not the due date');
eq(quietWorkingDays(task({ updatedAt: new Date(2026, 8, 21, 9).getTime() }), NOW), 0,
  'Q13 a record touched this morning is not quiet');
eq(quietWorkingDays(task({ updatedAt: new Date(2026, 8, 1).getTime() }), NOW), 6,
  'Q14 an edit made BEFORE the due date does not shorten the silence');

eq(escalationLevel(task({ due: '2026-09-14' }), NOW), 0, 'Q15 five quiet days is still the owner\'s problem');
eq(escalationLevel(task(), NOW), 1, `Q16 ${ESCALATE_LEVEL_1} quiet days reaches the manager`);
eq(escalationLevel(task({ due: '2026-09-03' }), NOW), 2, `Q17 ${ESCALATE_LEVEL_2} reaches them again, louder`);
eq(escalationLevel(task({ status: 'Done', due: '2026-09-03' }), NOW), 0, 'Q18 a finished record never escalates');

// ── 7. What the manager is told ──────────────────────────────────────────────

{
  const m = buildEscalationMessage(task(), 6, 1);
  has(m, "Ahmed Hassan's task", 'M1 the owner is named');
  has(m, 'TK000012 "Prepare the AGIBA offer"', 'M2 …and the record identified');
  has(m, '6 working days', 'M3 …and the silence measured');
  has(m, '2026-09-13', 'M4 …against the date it passed');
  has(m, 'Status: In Progress', 'M5 the state is in the message, not behind a click');
  has(m, 'Priority: High', 'M6 …with the priority');
  has(m, 'Reassign it, agree a new date, or close it.', 'M7 …and it says what to do');

  const m2 = buildEscalationMessage(task({ due: '2026-09-03' }), 12, 2);
  has(m2, 'still not moving', 'M8 the second notice says nothing changed');
  has(m2, 'escalated once already', 'M9 …and that it has been raised before');

  has(buildEscalationMessage(task({ ownerName: undefined }), 6, 1), 'Owner: nobody',
    'M10 an unowned record says so rather than blaming somebody');
  has(buildEscalationMessage({ ...task(), kind: 'corresponding', label: 'NNPC payment plan' }, 6, 1),
    'correspondence', 'M11 a correspondence is not announced as a task');
}

// ── 8. The run: who gets it, and how often ───────────────────────────────────

const USERS = [
  { id: 'u-boss', displayName: 'Tariq', role: 'Manager', status: 'Approved' },
  { id: 'u-ahmed', displayName: 'Ahmed Hassan', role: 'Employee', status: 'Approved' },
];

const reset = () => { sent.length = 0; store.clear(); };

{
  reset();
  await runEscalations({ uid: 'u-ahmed', isManager: false, users: USERS, items: [task()], now: NOW });
  eq(sent.length, 0, 'R1 an employee\'s browser escalates nothing');

  await runEscalations({ uid: 'u-boss', isManager: true, users: USERS, items: [task()], now: NOW });
  eq(sent.length, 1, 'R2 the manager\'s browser raises it');
  eq(sent[0].data.forUserId, 'u-boss', 'R3 …to the manager running it');
  eq(sent[0].data.type, 'task_escalated', 'R4 …with the type that deep-links to the task');
  eq(sent[0].data.relatedId, 'tk1', 'R5 …and the record it is about');
  eq(sent[0].data.read, false, 'R6 …unread');
  has(sent[0].data.title, 'Escalated', 'R7 …and titled so the bell reads at a glance');

  await runEscalations({ uid: 'u-boss', isManager: true, users: USERS, items: [task()], now: NOW });
  eq(sent.length, 1, 'R8 a second snapshot does not escalate the same thing twice');

  // The record rots on: the louder notice is a different level, so it is allowed.
  await runEscalations({
    uid: 'u-boss', isManager: true, users: USERS,
    items: [task({ due: '2026-09-03' })], now: NOW,
  });
  eq(sent.length, 2, 'R9 …but the second level still gets through');
  eq(sent[1].data.type, 'task_escalated', 'R10 …as the same kind of notification');
  has(sent[1].data.title, 'again', 'R11 …with a title that says it is a repeat');

  await runEscalations({
    uid: 'u-boss', isManager: true, users: USERS,
    items: [task({ due: '2026-09-03' })], now: NOW,
  });
  eq(sent.length, 2, 'R12 …and that one does not repeat either');
}

{
  reset();
  await runEscalations({
    uid: 'u-boss', isManager: true, users: USERS,
    items: [
      task({ id: 'ok1', due: '2026-09-18' }),
      task({ id: 'ok2', status: 'Done', due: '2026-09-03' }),
      task({ id: 'ok3', due: undefined }),
    ],
    now: NOW,
  });
  eq(sent.length, 0, 'R13 a board with nothing rotten is silent');
}

{
  reset();
  const many = Array.from({ length: 9 }, (_, i) => task({ id: `t${i}`, due: '2026-09-03' }));
  await runEscalations({ uid: 'u-boss', isManager: true, users: USERS, items: many, now: NOW });
  eq(sent.length, 5, 'R14 a neglected board does not dump nine notifications at once');

  await runEscalations({ uid: 'u-boss', isManager: true, users: USERS, items: many, now: NOW });
  eq(sent.length, 9, 'R15 the rest follow on later snapshots, up to the daily budget');

  const more = Array.from({ length: 6 }, (_, i) => task({ id: `x${i}`, due: '2026-09-03' }));
  await runEscalations({ uid: 'u-boss', isManager: true, users: USERS, items: more, now: NOW });
  eq(sent.length, 10, 'R16 …and the day stops at its budget');
}

{
  reset();
  // The worst offender must survive the per-run cap, whatever order the
  // snapshot hands the rows over in.
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => task({ id: `y${i}`, due: '2026-09-13' })),
    task({ id: 'worst', due: '2026-08-10', label: 'The forgotten one' }),
  ];
  await runEscalations({ uid: 'u-boss', isManager: true, users: USERS, items: rows, now: NOW });
  eq(sent[0].data.relatedId, 'worst', 'R17 the longest-quiet record is reported first');
}

{
  reset();
  await runEscalations({
    uid: 'u-boss', isManager: true, users: USERS,
    items: [{ ...task(), id: 'cr1', kind: 'corresponding', label: 'NNPC payment plan' }],
    now: NOW,
  });
  eq(sent[0].data.type, 'corresponding_escalated', 'R18 a correspondence keeps its own deep link');
}

{
  reset();
  await runEscalations({ uid: '', isManager: true, users: USERS, items: [task()], now: NOW });
  eq(sent.length, 0, 'R19 a run with no signed-in user does nothing');
}

// ── 9. waitingSince + localDay ───────────────────────────────────────────────

eq(waitingSince(undefined, NOW), 0, 'W1 no date, no wait');
eq(waitingSince('2026-10-01', NOW), 0, 'W2 a future date is not a wait');
eq(waitingSince('2026-09-14', NOW), 5, 'W3 …and a past one counts working days');
eq(waitingSince('nonsense', NOW), 0, 'W4 an unparseable date does not spin');
eq(localDay(new Date(2026, 8, 21, 23, 30)), '2026-09-21', 'W5 the day is the LOCAL day, not UTC');
eq(localDay(new Date(2026, 0, 5)), '2026-01-05', 'W6 …zero-padded');

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\nfollowup: ${pass}/${pass + fails.length} assertions passed`);
if (fails.length) {
  console.error('\nFAILED:');
  fails.forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}
