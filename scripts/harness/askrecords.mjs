// Harness for src/lib/askRecords.ts -> the Ask box on Home (queue D11).
//
// Bundles the REAL module (and the quickCapture.ts / mailSuggest.ts it builds
// on) with esbuild. Nothing touches the network or Firebase.
//
//   node scripts/harness/askrecords.mjs
//
// `today` is injected and every fixture date is an offset from it, so the
// fixtures do not rot with the calendar. Month questions are checked from
// several "todays" so "in July" is tested both before and after July.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'askRecords.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/askRecords.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  logLevel: 'warning',
});

const {
  readQuestion, readPeriod, answerQuestion, findParty, isoDay,
  taskRecord, correspondingRecord, opportunityRecord, projectRecord,
} = await import(pathToFileURL(OUT).href);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = new Date(); TODAY.setHours(12, 0, 0, 0);
const Y = TODAY.getFullYear();
const M = TODAY.getMonth();
const off = n => iso(new Date(Y, M, TODAY.getDate() + n));
const firstOf = (y, m) => iso(new Date(y, m, 1));
const lastOf = (y, m) => iso(new Date(y, m + 1, 0));

const ME = { id: 'u-me', name: 'Tariq Mohamed' };
const PEOPLE = [
  ME,
  { id: 'u-mona', name: 'Mona Fathy' },
  { id: 'u-ahmed', name: 'Ahmed Samir' },
  { id: 'u-sara', name: 'سارة عبد الله' },
];
const PARTIES = ['NNPC', 'Petromint', 'بترومنت', 'AGIBA', 'AGIBA Meleiha', 'Petrojet', 'EGPC'];
const ctx = (today = TODAY) => ({ me: ME, people: PEOPLE, parties: PARTIES, today });
const q = (text, today = TODAY) => readQuestion(text, ctx(today));

// A fixed "today" for the month-rule checks: 21 Sep 2026.
const SEP21 = new Date(2026, 8, 21, 12);
const MAR10 = new Date(2026, 2, 10, 12);

// ── 1. Periods ──────────────────────────────────────────────────────────────
{
  const p = t => readPeriod(t, SEP21)?.period;
  eq(p('in July')?.from, '2026-07-01', 'July asked in Sep = this July (from)');
  eq(p('in July')?.to, '2026-07-31', 'July asked in Sep = this July (to)');
  eq(p('in October')?.from, '2025-10-01', 'October asked in Sep = LAST October');
  eq(readPeriod('bids closing in October', SEP21, true)?.period.from, '2026-10-01', 'due question: October = the coming one');
  eq(readPeriod('due in March', SEP21, true)?.period.from, '2027-03-01', 'due question: March in Sep = next March');
  eq(p('July 2025')?.from, '2025-07-01', 'month + year');
  eq(p('in 2025')?.to, '2025-12-31', 'bare year');
  eq(p('in 2025')?.code, 'year', 'bare year code');
  eq(p('this month'), { code: 'this-month', from: '2026-09-01', to: '2026-09-30' }, 'this month');
  eq(p('last month'), { code: 'last-month', from: '2026-08-01', to: '2026-08-31' }, 'last month');
  eq(p('next month')?.from, '2026-10-01', 'next month');
  eq(readPeriod('last month', new Date(2026, 0, 15))?.period.from, '2025-12-01', 'last month across a year');
  eq(p('this week')?.from, '2026-09-20', 'week starts Sunday');
  eq(p('this week')?.to, '2026-09-26', 'week ends Saturday');
  eq(p('last week')?.from, '2026-09-13', 'last week from');
  eq(p('last week')?.to, '2026-09-19', 'last week to');
  eq(p('next week')?.from, '2026-09-27', 'next week');
  eq(p('today')?.from, '2026-09-21', 'today');
  eq(p('yesterday')?.from, '2026-09-20', 'yesterday');
  eq(p('last 30 days')?.from, '2026-08-23', 'last 30 days');
  eq(p('last 30 days')?.days, 30, 'last 30 days count');
  eq(p('this year')?.from, '2026-01-01', 'this year');
  eq(p('last year')?.to, '2025-12-31', 'last year');
  eq(p('since June')?.code, 'since-month', 'since June');
  eq(p('since June')?.from, '2026-06-01', 'since June from');
  eq(p('since June')?.to, '2026-09-21', 'since June to today');
  eq(p('since November')?.from, '2025-11-01', 'since November (not yet this year) = last November');
  eq(p('what may we need'), undefined, '"may" as a verb is not a month');
  eq(p('in May')?.from, '2026-05-01', '"in May" is a month');
  eq(p('decision on the bid'), undefined, '"decision" is not December');
  eq(p('nothing about time'), undefined, 'no period');
  // Arabic
  eq(p('في يوليو')?.from, '2026-07-01', 'AR يوليو');
  eq(p('شهر 7')?.from, '2026-07-01', 'AR شهر 7');
  eq(p('شهر ٧')?.from, '2026-07-01', 'AR شهر ٧ (Arabic digits)');
  eq(p('شهر سبعة')?.from, '2026-07-01', 'AR شهر سبعة (spoken)');
  eq(p('الشهر اللي فات')?.code, 'last-month', 'AR الشهر اللي فات');
  eq(p('الشهر الماضي')?.from, '2026-08-01', 'AR الشهر الماضي');
  eq(p('الشهر ده')?.code, 'this-month', 'AR الشهر ده');
  eq(p('الأسبوع الجاي')?.code, 'next-week', 'AR الأسبوع الجاي');
  eq(p('الأسبوع اللي فات')?.code, 'last-week', 'AR الأسبوع اللي فات');
  eq(p('النهارده')?.code, 'today', 'AR النهارده');
  eq(p('امبارح')?.code, 'yesterday', 'AR امبارح');
  eq(p('السنة اللي فاتت')?.code, 'last-year', 'AR السنة اللي فاتت');
  eq(p('آخر 10 أيام')?.days, 10, 'AR آخر 10 أيام');
  eq(p('من أول يونيو')?.code, 'since-month', 'AR من أول يونيو');
  eq(p('في أكتوبر 2025')?.from, '2025-10-01', 'AR month + year');
  eq(readPeriod('in July', MAR10)?.period.from, '2025-07-01', 'July asked in March = last July');
}

// ── 2. Reading the question ─────────────────────────────────────────────────
{
  const a = q('What did we send NNPC in July?', SEP21);
  eq(a.party, 'NNPC', 'NNPC read as the client');
  eq(a.direction, 'sent', 'send → sent');
  eq(a.kinds, ['corresponding', 'task'], 'sending = letters + tasks');
  eq(a.period?.from, '2026-07-01', 'July read');
  eq(a.words, [], 'nothing left over');
  eq(a.person, undefined, '"we" is not a person');

  const b = q('open bids closing this month', SEP21);
  eq(b.kinds, ['opportunity'], 'bids → opportunity');
  eq(b.state, 'open', 'open');
  eq(b.dateField, 'due', 'closing → due date');
  eq(b.period?.code, 'this-month', 'this month');

  const c = q("Mona's late tasks");
  eq(c.person?.id, 'u-mona', 'Mona named');
  eq(c.state, 'late', 'late');
  eq(c.kinds, ['task'], 'tasks');
  eq(c.words, [], 'Mona consumed');

  const d = q('my open tasks');
  eq(d.person?.id, 'u-me', 'my → me');
  const d2 = q('show me the bids');
  eq(d2.person, undefined, '"show me" is not "my"');

  const e = q('how many tenders did we win this year?');
  eq(e.count, true, 'how many');
  eq(e.state, 'won', 'win → won');
  eq(e.kinds, ['opportunity'], 'tenders');

  const f = q('lost bids');
  eq(f.state, 'lost', 'lost');

  const g = q('letters from AGIBA Meleiha last week');
  eq(g.party, 'AGIBA Meleiha', 'longest party wins');
  eq(g.kinds, ['corresponding'], 'letters');

  const h = q('what did we receive from Petrojet');
  eq(h.direction, 'received', 'receive → received');
  eq(h.kinds, ['corresponding'], 'received = letters');

  const i = q('anything about the Zohr compressor');
  eq(i.words, ['zohr', 'compressor'], 'free words kept');
  eq(i.party, undefined, 'unknown client is just a word');

  eq(q(''), null, 'empty → null');
  eq(q('what is the'), null, 'only stop words → null');

  // Arabic
  const j = q('إيه اللي بعتناه لبترومنت الشهر اللي فات؟', SEP21);
  eq(j.party, 'بترومنت', 'AR party with ل prefix');
  eq(j.direction, 'sent', 'AR بعتناه');
  eq(j.period?.code, 'last-month', 'AR last month');
  eq(j.words, [], 'AR nothing left over');

  const k = q('المناقصات المفتوحة');
  eq(k.kinds, ['opportunity'], 'AR المناقصات');
  eq(k.state, 'open', 'AR المفتوحة');

  const l = q('مهام منى المتأخرة');
  eq(l.person?.id, 'u-mona', 'AR منى → Mona');
  eq(l.state, 'late', 'AR المتأخرة');
  eq(l.kinds, ['task'], 'AR مهام');

  const m = q('كام عطاء كسبنا السنة دي؟');
  eq(m.count, true, 'AR كام');
  eq(m.state, 'won', 'AR كسبنا');
  eq(m.period?.code, 'this-year', 'AR السنة دي');

  const n = q('الخطابات اللي وصلتنا من EGPC');
  eq(n.party, 'EGPC', 'AR question, Latin client');
  eq(n.kinds, ['corresponding'], 'AR الخطابات');

  const o = q('عقود سارة');
  eq(o.person?.id, 'u-sara', 'AR full-name colleague by first name');
  eq(o.kinds, ['project'], 'AR عقود');

  const p = q('اعرضلي المشاريع');
  eq(p.kinds, ['project'], '«اعرضلي» is not «عرض» (a bid)');
}

// ── 3. findParty edges ──────────────────────────────────────────────────────
eq(findParty('what about agiba?', PARTIES)?.name, 'AGIBA', 'case-insensitive');
eq(findParty('NNPC\'s letters', PARTIES)?.name, 'NNPC', "possessive 's");
eq(findParty('petromints', PARTIES), null, 'inside a longer word is not a match');
eq(findParty('وبترومنت', PARTIES)?.name, 'بترومنت', 'AR و prefix');
eq(findParty('للبترومنت', PARTIES)?.name, 'بترومنت', 'AR لل prefix');
eq(findParty('xegpcx', PARTIES), null, 'Latin inside a word');

// ── 4. Answering ────────────────────────────────────────────────────────────
const ts = isoStr => ({ toDate: () => new Date(`${isoStr}T10:00:00`) });
const RECORDS = [
  // Letters
  correspondingRecord({ id: 'c1', serialNumber: 'CR000101', subject: 'Offer for tank cleaning', body: 'Our offer to NNPC', sentFrom: 'EPROM', dateReceived: '2026-07-05', status: 'Closed', assignedToId: 'u-mona', userId: 'u-mona' }),
  correspondingRecord({ id: 'c2', serialNumber: 'CR000102', subject: 'Request for clarification', body: 'Please clarify', sentFrom: 'NNPC', dateReceived: '2026-07-12', status: 'Assigned', assignedToId: 'u-ahmed', userId: 'u-me' }),
  correspondingRecord({ id: 'c3', serialNumber: 'CR000103', subject: 'Payment plan', body: 'NNPC payment schedule', sentFrom: 'EPROM', dateReceived: '2026-08-02', status: 'Closed', userId: 'u-me' }),
  correspondingRecord({ id: 'c4', serialNumber: 'CR000104', subject: 'عرض أسعار الصيانة', body: 'مرسل إلى بترومنت', sentFrom: 'EPROM', dateReceived: '2026-08-20', status: 'Closed', userId: 'u-me' }),
  correspondingRecord({ id: 'c5', serialNumber: 'CR000105', subject: 'Invitation', body: 'site visit', sentFrom: 'Petrojet', dateReceived: '2026-09-01', deadline: '2026-09-10', status: 'Reviewing', userId: 'u-me' }),
  // Tasks
  taskRecord({ id: 't1', serialNumber: 'TK000201', taskName: 'Send revised prices to NNPC', description: '', status: 'Done', createdAt: ts('2026-07-20'), dueDate: '2026-07-25', assignedToId: 'u-mona', assignedTo: 'Mona Fathy', userId: 'u-me' }),
  taskRecord({ id: 't2', serialNumber: 'TK000202', taskName: 'Zohr compressor inspection report', description: 'compressor', status: 'In Progress', createdAt: ts('2026-09-01'), dueDate: '2026-09-15', assignedToId: 'u-mona', assignedTo: 'Mona Fathy', userId: 'u-me' }),
  taskRecord({ id: 't3', serialNumber: 'TK000203', taskName: 'Prepare AGIBA invoice', description: '', status: 'Pending', createdAt: ts('2026-09-10'), dueDate: '2099-01-01', assignedToId: 'u-ahmed', collaboratorIds: ['u-mona'], userId: 'u-me' }),
  taskRecord({ id: 't4', serialNumber: 'TK000204', taskName: 'Old closed thing', description: '', status: 'Archived', createdAt: ts('2025-10-10'), dueDate: '2025-10-11', assignedToId: 'u-me', userId: 'u-me' }),
  // Bids
  opportunityRecord({ id: 'o1', serialNumber: 'OP000011', title: 'Tank farm maintenance', client: 'NNPC', stage: 'Won', submittedDate: '2026-03-01', decisionDate: '2026-05-01', ownerId: 'u-me', ownerName: 'Tariq Mohamed' }),
  opportunityRecord({ id: 'o2', serialNumber: 'OP000012', title: 'Algeria pipeline offer', client: 'Petrojet', stage: 'Bid Preparation', submissionDeadline: '2026-09-28', createdAt: ts('2026-09-02'), ownerId: 'u-ahmed' }),
  opportunityRecord({ id: 'o3', serialNumber: 'OP000013', title: 'Meleiha tanks', client: 'AGIBA', stage: 'Lost', submittedDate: '2026-02-01', awardedTo: 'Competitor X' }),
  opportunityRecord({ id: 'o4', serialNumber: 'OP000014', title: 'Refinery shutdown', client: 'EGPC', stage: 'Submitted', submissionDeadline: '2026-09-05', submittedDate: '2026-09-04' }),
  opportunityRecord({ id: 'o5', serialNumber: 'OP000015', title: 'Terminal upgrade', client: 'EGPC', stage: 'Identified', submissionDeadline: '2026-10-15', createdAt: ts('2026-09-15') }),
  // Projects
  projectRecord({ id: 'p1', serialNumber: 'PR000003', name: 'Meleiha tanks', client: 'AGIBA', status: 'Active', startDate: '2026-01-01', endDate: '2026-12-31', userId: 'u-me' }),
  projectRecord({ id: 'p2', serialNumber: 'PR000004', name: 'Old contract', client: 'NNPC', status: 'Completed', startDate: '2024-01-01', endDate: '2025-01-01', userId: 'u-me' }),
];
const ask = (text, today = SEP21) => {
  const qq = readQuestion(text, ctx(today));
  return qq ? answerQuestion(qq, RECORDS, today) : null;
};
const idsOf = a => a?.rows.map(r => r.id);

eq(idsOf(ask('What did we send NNPC in July?')), ['t1', 'c1'], 'sent NNPC July: our letter + the task, NOT their letter to us');
eq(idsOf(ask('what did we receive from NNPC')), ['c2'], 'received from NNPC = their letter only');
eq(idsOf(ask('everything about NNPC')), ['c3', 't1', 'c2', 'c1', 'o1', 'p2'], 'all NNPC, newest first');
eq(ask('everything about NNPC').byKind, { task: 1, corresponding: 3, opportunity: 1, project: 1 }, 'byKind counts');
eq(idsOf(ask('open bids')), ['o5', 'o4', 'o2'], 'open bids (Submitted counts as open)');
eq(idsOf(ask('bids closing this month')), ['o4', 'o2'], 'closing this month, soonest first');
eq(idsOf(ask('bids closing in October')), ['o5'], 'October = the coming one');
eq(idsOf(ask('won bids')), ['o1'], 'won');
eq(idsOf(ask('lost tenders')), ['o3'], 'lost');
eq(idsOf(ask('submitted bids')), ['o4', 'o1', 'o3'], 'submitted includes decided bids');
eq(idsOf(ask("Mona's late tasks")), ['t2'], "Mona's late: past due, open");
eq(idsOf(ask('Mona tasks')), ['t3', 't2', 't1'], 'collaborator counts as Mona\'s');
eq(idsOf(ask('my tasks')), ['t3', 't2', 't1', 't4'], 'my = I entered or own it (userId)');
eq(idsOf(ask('late')), ['c5', 't2'], 'late across boards');
eq(idsOf(ask('Zohr compressor')), ['t2'], 'free words');
eq(ask('Zohr turbine')?.loosened, true, 'no row has both words → loosened');
eq(idsOf(ask('Zohr turbine')), ['t2'], 'loosened to any word');
eq(ask('Zohr compressor')?.loosened, false, 'not loosened when all words match');
eq(idsOf(ask('Zebra unicorn')), [], 'nothing found');
eq(idsOf(ask('إيه اللي بعتناه لبترومنت الشهر اللي فات؟')), ['c4'], 'AR: sent to Petromint last month');
eq(idsOf(ask('المناقصات المفتوحة')), ['o5', 'o4', 'o2'], 'AR open bids');
eq(idsOf(ask('مهام منى المتأخرة')), ['t2'], 'AR Mona late');
eq(ask('كام عطاء كسبنا السنة دي؟')?.rows.length, 1, 'AR how many won this year');
eq(idsOf(ask('المشاريع المنتهية')), ['p2'], 'AR finished projects');
eq(idsOf(ask('active projects')), ['p1'], 'active projects');
eq(idsOf(ask('contracts ending this year')), ['p1'], 'contracts ending this year (due field)');
eq(idsOf(ask('letters last month')), ['c4', 'c3'], 'letters last month');
eq(idsOf(ask('tasks in 2025')), ['t4'], 'bare year');
eq(idsOf(ask('closed letters from Petrojet')), [], 'Petrojet letter is not closed');
eq(idsOf(ask('Petrojet')), ['o2', 'c5'], 'party alone, newest first');

// ── 5. Record builders ──────────────────────────────────────────────────────
eq(isoDay('2026-07-05T10:00'), '2026-07-05', 'isoDay string with time');
eq(isoDay(ts('2026-07-05')), '2026-07-05', 'isoDay Timestamp-like');
eq(isoDay(undefined), undefined, 'isoDay empty');
eq(isoDay('not a date'), undefined, 'isoDay junk');
eq(RECORDS.find(r => r.id === 't4').open, false, 'Archived task is closed');
eq(RECORDS.find(r => r.id === 'o4').open, true, 'Submitted bid is open');
eq(RECORDS.find(r => r.id === 'o1').date, '2026-03-01', 'bid date = submitted date');
eq(RECORDS.find(r => r.id === 'c2').from, 'NNPC', 'letter from');
eq(RECORDS.find(r => r.id === 't3').people.sort(), ['u-ahmed', 'u-me', 'u-mona'], 'task people');

// Relative today (keeps the real-clock path exercised)
ok(!!readPeriod('this month', TODAY) && readPeriod('this month', TODAY).period.from === firstOf(Y, M), 'this month from real today');
ok(readPeriod('this month', TODAY).period.to === lastOf(Y, M), 'this month to real today');
ok(readPeriod('today', TODAY).period.from === off(0), 'today real');


// ── 6. The example questions the Ask box offers (both languages) ────────────
{
  const EX = {
    'What did we send NNPC in July?': { party: 'NNPC', direction: 'sent', words: [] },
    'Open bids closing this month': { kinds: ['opportunity'], state: 'open', dateField: 'due', words: [] },
    'My overdue tasks': { kinds: ['task'], state: 'late', words: [] },
    'How many tenders did we win this year?': { kinds: ['opportunity'], state: 'won', count: true, words: [] },
    'ماذا أرسلنا إلى NNPC في يوليو؟': { party: 'NNPC', direction: 'sent', words: [] },
    'العطاءات المفتوحة التي تنتهي هذا الشهر': { kinds: ['opportunity'], state: 'open', dateField: 'due', words: [] },
    'مهامي المتأخرة': { kinds: ['task'], state: 'late', words: [] },
    'كم مناقصة فزنا بها هذا العام؟': { kinds: ['opportunity'], state: 'won', count: true, words: [] },
  };
  for (const [text, want] of Object.entries(EX)) {
    const got = q(text, SEP21);
    ok(!!got, `example reads: ${text}`);
    if (!got) continue;
    for (const [k, v] of Object.entries(want)) eq(got[k], v, `example ${text} → ${k}`);
  }
  eq(q('My overdue tasks').person?.id, 'u-me', 'example: My = me');
  eq(q('مهامي المتأخرة').person?.id, 'u-me', 'example: مهامي = me');
  eq(q('العطاءات المفتوحة التي تنتهي هذا الشهر', SEP21).period?.code, 'this-month', 'example AR this month');
}

// ── report ───────────────────────────────────────────────────────────────────
if (fails.length) {
  console.log(`askrecords: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`askrecords: all ${pass} assertions passed`);
