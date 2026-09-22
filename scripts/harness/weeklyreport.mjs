// Harness for src/lib/weeklyReport.ts -> the weekly Arabic department report (queue D9).
//
// Bundles the REAL module with esbuild. Nothing touches the network or Firebase.
//
//   node scripts/harness/weeklyreport.mjs
//
// Every date is an offset from a Sunday near today, so the fixtures do not rot
// with the calendar.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'weeklyreport.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/weeklyReport.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  logLevel: 'warning',
});

const {
  weekOf, shiftWeek, defaultWeek, parseWeekParam, buildWeeklyFacts, activityCount, taskDoneDay,
  arDate, arWeekRange, arCount, AR, arabicSummary, writeArabicReport, arabicSubject, clip,
} = await import(pathToFileURL(OUT).href);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const NOW = new Date(); NOW.setHours(12, 0, 0, 0);
// LAST_SUN = the Sunday that opened LAST week. Report week = that week, fully past.
const LAST_SUN = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - NOW.getDay() - 7, 12);
const d = n => iso(new Date(LAST_SUN.getFullYear(), LAST_SUN.getMonth(), LAST_SUN.getDate() + n));
const ts = n => { const ms = new Date(LAST_SUN.getFullYear(), LAST_SUN.getMonth(), LAST_SUN.getDate() + n, 10).getTime(); return { toMillis: () => ms }; };
const WEEK = { start: d(0), end: d(6) };

// ── Weeks ────────────────────────────────────────────────────────────────────
eq(weekOf(d(3)), WEEK, 'weekOf: Wednesday → its Sunday–Saturday');
eq(weekOf(d(0)), WEEK, 'weekOf: Sunday is the first day');
eq(weekOf(d(6)), WEEK, 'weekOf: Saturday is the last day');
eq(weekOf(d(7)).start, d(7), 'weekOf: next Sunday starts a new week');
eq(shiftWeek(WEEK, 1), { start: d(7), end: d(13) }, 'shiftWeek +1');
eq(shiftWeek(WEEK, -1), { start: d(-7), end: d(-1) }, 'shiftWeek −1');
eq(weekOf('2026-12-30'), { start: '2026-12-27', end: '2027-01-02' }, 'a week across the new year');
eq(defaultWeek(new Date(2026, 8, 21, 9)), { start: '2026-09-13', end: '2026-09-19' }, 'Monday → the week just finished');
eq(defaultWeek(new Date(2026, 8, 20, 9)), { start: '2026-09-13', end: '2026-09-19' }, 'Sunday → the week just finished');
eq(defaultWeek(new Date(2026, 8, 23, 9)), { start: '2026-09-20', end: '2026-09-26' }, 'Wednesday → this week');
eq(defaultWeek(new Date(2026, 8, 24, 9)), { start: '2026-09-20', end: '2026-09-26' }, 'Thursday → this week');
eq(parseWeekParam('2026-09-16'), { start: '2026-09-13', end: '2026-09-19' }, '?w= any day → its week');
eq(parseWeekParam('2026-02-30'), null, '?w= impossible date refused');
eq(parseWeekParam('next'), null, '?w= garbage refused');
eq(parseWeekParam(null), null, '?w= missing');

// ── Arabic dates and counts ──────────────────────────────────────────────────
eq(arDate('2026-09-13'), 'الأحد 13 سبتمبر', 'arDate');
eq(arDate('2026-09-19', true), 'السبت 19 سبتمبر 2026', 'arDate with year');
eq(arWeekRange({ start: '2026-09-13', end: '2026-09-19' }), 'من الأحد 13 سبتمبر إلى السبت 19 سبتمبر 2026', 'week range, one year');
eq(arWeekRange({ start: '2026-12-27', end: '2027-01-02' }), 'من الأحد 27 ديسمبر 2026 إلى السبت 2 يناير 2027', 'week range across years names both');
eq(arCount(1, AR.task), 'مهمة واحدة', '1 task');
eq(arCount(2, AR.task), 'مهمتين', '2 tasks = dual');
eq(arCount(3, AR.task), '3 مهام', '3 tasks = plural');
eq(arCount(10, AR.task), '10 مهام', '10 tasks = plural');
eq(arCount(11, AR.task), '11 مهمة', '11 tasks = singular');
eq(arCount(1, AR.letter), 'خطابًا واحدًا', '1 letter, accusative');
eq(arCount(1, AR.letter, true), 'خطاب واحد', '1 letter, genitive');
eq(arCount(12, AR.letter), '12 خطابًا', '12 letters = accusative singular');
eq(arCount(2, AR.day, true), 'يومين', '2 days');
eq(arCount(1, AR.day, true), 'يوم واحد', '1 day, genitive');
eq(arCount(15, AR.day), '15 يومًا', '15 days');
eq(arCount(2, AR.overdueLetter), 'خطابين تجاوزا موعدهما', 'dual verb agrees');
eq(clip('a  b\n c'), 'a b c', 'clip collapses spaces');
ok(clip('word '.repeat(60), 50).endsWith('…') && clip('word '.repeat(60), 50).length <= 51, 'clip cuts on a word with an ellipsis');

// ── Fixtures: last week, fully past ──────────────────────────────────────────
const USERS = [
  { id: 'u-mona', displayName: 'Mona Fathy', status: 'Approved' },
  { id: 'u-sami', displayName: 'Sami Adel', status: 'Approved' },
  { id: 'u-idle', displayName: 'Idle Person', status: 'Approved' },
];
const tasks = [
  // finished in the week, stamped exactly
  { id: 't1', serialNumber: 'TK000001', taskName: 'Prepare AGIBA offer', status: 'Done', assignedToId: 'u-mona', assignedTo: 'Mona Fathy', createdAt: ts(-20), completedAt: ts(2), updatedAt: ts(9) },
  // finished in the week, no completedAt → updatedAt estimate
  { id: 't2', serialNumber: 'TK000002', taskName: 'Reply to WEPCO', status: 'Done', assignedToId: 'u-sami', assignedTo: 'Sami Adel', createdAt: ts(-5), updatedAt: ts(4) },
  // finished AFTER the week (completedAt next week) → was open and late at week end
  { id: 't3', serialNumber: 'TK000003', taskName: 'Chase PETROGAS invoice', status: 'Done', assignedToId: 'u-mona', assignedTo: 'Mona Fathy', createdAt: ts(-10), dueDate: d(1), completedAt: ts(8) },
  // created in the week, still open, due next week
  { id: 't4', serialNumber: 'TK000004', taskName: 'Site visit Meleiha', status: 'Pending', assignedToId: 'u-sami', assignedTo: 'Sami Adel', createdAt: ts(3), dueDate: d(9) },
  // created AFTER the week → not open at week end
  { id: 't5', serialNumber: 'TK000005', taskName: 'Future task', status: 'Pending', assignedToId: 'u-sami', createdAt: ts(8), dueDate: d(10) },
  // archived long ago, no stamps at all
  { id: 't6', taskName: 'Ancient', status: 'Archived', assignedToId: 'u-mona' },
  // open, late by 4 days at week end
  { id: 't7', serialNumber: 'TK000007', taskName: 'Update risk register', status: 'In Progress', assignedToId: 'u-mona', assignedTo: 'Mona Fathy', createdAt: ts(-30), dueDate: d(2) },
  { id: '--stats--', count: 7 },
];
const correspondences = [
  { id: 'l1', serialNumber: 'CR000001', subject: 'Invoice 45', sentFrom: 'AGIBA', dateReceived: d(1), status: 'Closed', updatedAt: ts(3), deadline: d(4) },
  { id: 'l2', serialNumber: 'CR000002', subject: 'Site access', sentFrom: 'agiba', dateReceived: d(2), status: 'Unread', deadline: d(4) },
  { id: 'l3', serialNumber: 'CR000003', subject: 'Payment plan', sentFrom: 'NNPC', dateReceived: d(3), status: 'Assigned', deadline: d(10) },
  { id: 'l4', serialNumber: 'CR000004', subject: 'Old letter', sentFrom: 'EGPC', dateReceived: d(-20), status: 'Closed', updatedAt: ts(-15) },
];
const opportunities = [
  { id: 'o1', serialNumber: 'OP000001', title: 'Tank cleaning 2026', client: 'AGIBA', stage: 'Submitted', submittedDate: d(3), createdAt: ts(-30) },
  { id: 'o2', serialNumber: 'OP000002', title: 'Valve overhaul', client: 'WEPCO', stage: 'Won', decisionDate: d(4), createdAt: ts(-60) },
  { id: 'o3', serialNumber: 'OP000003', title: 'Pipeline inspection', client: 'GASCO', stage: 'Lost', awardedTo: 'Petrojet', updatedAt: ts(5), createdAt: ts(-90) },
  { id: 'o4', serialNumber: 'OP000004', title: 'New RFQ', client: 'ENPPI', stage: 'Identified', createdAt: ts(2), submissionDeadline: d(10) },
  { id: 'o5', serialNumber: 'OP000005', title: 'Missed tender', client: 'APC', stage: 'Bid Preparation', createdAt: ts(-40), submissionDeadline: d(3) },
  { id: 'o6', serialNumber: 'OP000006', title: 'Old lost', client: 'X', stage: 'Lost', decisionDate: d(-30), createdAt: ts(-100) },
];
const projects = [
  { id: 'p1', serialNumber: 'PR000001', name: 'AGIBA Meleiha', client: 'AGIBA', status: 'Active', createdAt: ts(-200),
    checklist: [{ id: 'c1', title: 'Kick-off', done: true, doneAt: d(2) }, { id: 'c2', title: 'Old', done: true, doneAt: d(-10) }, { id: 'c3', title: 'Open', done: false }] },
  { id: 'p2', serialNumber: 'PR000002', name: 'WEPCO services', client: 'WEPCO', status: 'Active', createdAt: ts(1) },
];
const projectUpdates = [
  { id: 'u1', projectId: 'p1', text: 'First update', createdAt: ts(1), authorName: 'Mona Fathy' },
  { id: 'u2', projectId: 'p1', text: 'Mobilisation finished, crews on site', createdAt: ts(4), authorName: 'Mona Fathy' },
  { id: 'u3', projectId: 'p1', text: 'Last week noise', createdAt: ts(-3) },
];
const contracts = [
  { id: 'k1', projectId: 'p1', parentId: null, subject: 'Main contract', contractNumber: '4600001234', endDate: d(6 + 30) },
  { id: 'k2', projectId: 'p1', parentId: null, subject: 'Far contract', endDate: d(6 + 200) },
];
const meetings = [
  { id: 'm1', title: 'Weekly coordination', date: d(1), attendeeIds: [], agenda: [], actions: [{ id: 'a1', text: 'Send prices', taskId: 'tx' }, { id: 'a2', text: 'Call client' }, { id: 'a3', text: ' ' }] },
  { id: 'm2', title: 'Next week meeting', date: d(8), attendeeIds: [], agenda: [], actions: [] },
];

const input = { tasks, correspondences, opportunities, projects, projectUpdates, contracts, meetings, users: USERS };
const f = buildWeeklyFacts(input, WEEK, NOW);

// ── Facts ────────────────────────────────────────────────────────────────────
eq(f.asOf, WEEK.end, 'a past week is measured on its Saturday');
eq(f.current, false, 'past week is not current');
eq(f.next, { start: d(7), end: d(13) }, 'next week');
eq(f.tasks.done.map(t => t.id), ['t1', 't2'], 'done in the week: exact + estimated, not the one finished later');
eq(f.tasks.doneEstimated, 1, 'one done date is an estimate');
eq(taskDoneDay({ status: 'Archived' }), { day: '0000-00-00', estimated: true }, 'no stamps = long ago');
eq(taskDoneDay({ status: 'Pending', completedAt: ts(1) }), null, 'an open task has no done day');
eq(f.tasks.added.map(t => t.id), ['t4'], 'added in the week');
eq(f.tasks.openAtEnd, 3, 'open at week end: t3 (finished later), t4, t7');
eq(f.tasks.late.map(t => [t.id, t.days]), [['t3', 5], ['t7', 4]], 'late at week end, most late first');
eq(f.letters.received.map(l => l.id), ['l1', 'l2', 'l3'], 'letters received in the week');
eq(f.letters.topSenders, [{ name: 'AGIBA', count: 2 }], 'busiest sender, case-folded');
eq(f.letters.closed, 1, 'closed in the week (by updatedAt)');
eq(f.letters.unread, 1, 'received this week, still unread');
eq(f.letters.overdue.map(l => [l.id, l.days]), [['l2', 2]], 'open letter past its deadline; the closed one is not');
eq(f.bids.submitted.map(b => b.id), ['o1'], 'submitted in the week');
eq(f.bids.won.map(b => b.id), ['o2'], 'won in the week (decisionDate)');
eq(f.bids.lost.map(b => [b.id, b.note]), [['o3', 'Petrojet']], 'lost in the week (updatedAt fallback) with the winner');
eq(f.bids.added.map(b => b.id), ['o4'], 'new bid in the week');
eq(f.bids.missed.map(b => [b.id, b.days]), [['o5', 3]], 'bid still in preparation after its deadline');
eq(f.bids.awaitingDecision, 1, 'awaiting decision');
eq(f.bids.open, 3, 'open pipeline');
eq(f.coming.bidsClosing.map(b => b.id), ['o4'], 'bid closing next week');
eq(f.coming.tasksDue.map(t => t.id), ['t4', 't5'], 'tasks due next week (open ones)');
eq(f.coming.lettersDue.map(l => l.id), ['l3'], 'letter due next week');
eq(f.projects.updated.map(p => [p.title, p.note]), [['AGIBA Meleiha', 'Mobilisation finished, crews on site']], 'one row per project, latest update');
eq(f.projects.added.map(p => p.id), ['p2'], 'new project');
eq(f.projects.stepsDone, 1, 'checklist steps ticked in the week');
eq(f.projects.contractsEnding.map(c => [c.title, c.days]), [['Main contract', 30]], 'contract ending within 60 days of week end');
eq(f.meetings.held.map(m => m.id), ['m1'], 'meetings held in the week');
eq([f.meetings.actionPoints, f.meetings.actionTasks], [2, 1], 'action points (blank ignored) and those made into tasks');
eq(f.people.map(p => [p.name, p.done, p.added, p.open, p.late]),
  [['Mona Fathy', 1, 0, 2, 2], ['Sami Adel', 1, 1, 1, 0]], 'per person (most done, then most late first): done, added, open, late; idle people left out');
ok(activityCount(f) > 0 && f.empty === false, 'not empty');

// Private tasks never reach the module — but make sure a task with no owner is not a person.
const noOwner = buildWeeklyFacts({ tasks: [{ id: 'x', taskName: 'Orphan', status: 'Pending', createdAt: ts(1) }] }, WEEK, NOW);
eq(noOwner.people, [], 'an unowned task adds no person line');
eq(noOwner.tasks.openAtEnd, 1, '…but still counts as open');

// ── The current week: measured today ─────────────────────────────────────────
const thisWeek = weekOf(iso(NOW));
const cur = buildWeeklyFacts(input, thisWeek, NOW);
eq(cur.asOf, iso(NOW), 'current week measured on today');
eq(cur.current, true, 'current week flagged');

// ── Empty ────────────────────────────────────────────────────────────────────
const none = buildWeeklyFacts({}, WEEK, NOW);
eq(none.empty, true, 'nothing at all = empty');
ok(writeArabicReport(none).includes('لم يسجّل الفريق في ETaske أي إنجاز خلال الأسبوع.'), 'empty week says so in Arabic');

// ── Arabic text ──────────────────────────────────────────────────────────────
const summary = arabicSummary(f);
ok(summary.startsWith('أنجز الفريق خلال الأسبوع مهمتين، واستقبل 3 خطابات، وقدّم عرضًا واحدًا، وفاز بعطاء واحد، وحدّث موقف مشروع واحد، وعقد اجتماعًا واحدًا.'),
  `summary sentence — got: ${summary}`);
ok(summary.includes('وحمل الفريق إلى الأسبوع التالي مهمتين متأخرتين وخطابًا واحدًا تجاوز موعده وعطاءً واحدًا فات موعد تقديمه.'), `carry-over sentence — got: ${summary}`);
ok(summary.includes('وفي الأسبوع المقبل يُغلق باب التقديم في عطاء واحد، ويحل موعد مهمتين.'), `next-week sentence — got: ${summary}`);
ok(arabicSummary(cur).includes('حتى الآن هذا الأسبوع') || !activityCount(cur), 'current week summary says "so far"');

const text = writeArabicReport(f, { department: 'إدارة تطوير الأعمال' });
const lines = text.split('\n');
eq(lines[0], 'التقرير الأسبوعي — إدارة تطوير الأعمال', 'heading with the department');
eq(lines[1], `الأسبوع ${arWeekRange(WEEK)}`, 'week line');
eq(writeArabicReport(f).split('\n')[0], 'التقرير الأسبوعي للإدارة', 'heading without a department');
ok(text.includes('أولًا: المهام') && text.includes('ثانيًا: المراسلات') && text.includes('ثالثًا: العطاءات')
  && text.includes('رابعًا: المشروعات والعقود') && text.includes('خامسًا: الاجتماعات') && text.includes('سادسًا: حصة كل زميل من المهام')
  && text.includes('سابعًا: الأسبوع المقبل'), 'seven ordered sections');
ok(text.includes('• المفتوحة في نهاية الأسبوع: 3، المتأخرة منها: 2'), 'open / late line');
ok(text.includes('  - TK000003 Chase PETROGAS invoice (Mona Fathy) — متأخرة 5 أيام'), 'late task line with days');
ok(text.includes('• الواردة: 3 (أكثرها من: AGIBA 2)'), 'letters with top sender');
ok(text.includes('  - CR000002 Site access (agiba) — متأخر يومين'), 'overdue letter, dual days');
ok(text.includes('  - OP000002 Valve overhaul (WEPCO) — رسا علينا'), 'won line');
ok(text.includes('  - OP000003 Pipeline inspection (GASCO) — لم يرسُ علينا، ورسا على Petrojet'), 'lost line with winner');
ok(text.includes('  - OP000005 Missed tender (APC) — منذ 3 أيام'), 'missed bid');
ok(text.includes('  - AGIBA Meleiha: Mobilisation finished, crews on site'), 'project update line');
ok(text.includes('• عقود تنتهي خلال 60 يومًا: 1') && text.includes('(بعد 30 يومًا)'), 'contract ending line');
ok(text.includes('• نقاط العمل المسجلة: 2، تحوّل منها إلى مهام: 1'), 'meeting action points');
ok(text.includes('  - Mona Fathy: المنجز 1 · الجديد 0 · المفتوح 2 · المتأخر 2'), 'person line');
ok(text.includes('فاعتُمد يوم آخر تعديل عليها'), 'admits the estimated done dates');
ok(text.includes('ولا يشمل المهام الخاصة'), 'says private tasks are out');
ok(!/\bتم\b|تمت|يتم|بواسطة|الخاص ب|القيام ب/.test(text), 'no «تم / بواسطة / الخاص بـ / القيام بـ»');
// Our own wording only — typed titles/updates may carry Latin punctuation of their own.
ok(!/[,?]/.test(lines.filter(l => !/[A-Za-z]/.test(l)).join('|')), 'no Latin comma or question mark in the Arabic');
ok(!/[٠-٩]/.test(text), 'Latin digits only (app convention)');
eq(arabicSubject(f, 'إدارة تطوير الأعمال'), `التقرير الأسبوعي — إدارة تطوير الأعمال: ${arWeekRange(WEEK)}`, 'e-mail subject');

// List cap
const many = buildWeeklyFacts({ tasks: Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, taskName: `Job ${i}`, status: 'Done', completedAt: ts(1), assignedToId: 'u-mona' })), users: USERS }, WEEK, NOW);
const manyText = writeArabicReport(many, { maxList: 5 });
ok(manyText.includes('  - وغيرها: 3'), 'lists stop at 5 and count the rest');
ok(arabicSummary(many).startsWith('أنجز الفريق خلال الأسبوع 8 مهام'), '8 tasks = plural');

if (process.argv.includes("--print")) console.log(text);
console.log(fails.length ? fails.map(x => `  FAIL ${x}`).join('\n') : '');
console.log(`${pass}/${pass + fails.length} passed${fails.length ? ` — ${fails.length} FAILED` : ''}`);
process.exit(fails.length ? 1 : 0);
