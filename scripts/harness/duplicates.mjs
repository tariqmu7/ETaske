// Harness for src/lib/duplicates.ts -> duplicate / conflict detection (queue D8).
//
// Bundles the REAL module with esbuild. Nothing touches the network or Firebase.
//
//   node scripts/harness/duplicates.mjs
//
// Every date is an offset from today, so the fixtures do not rot with the calendar.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'duplicates.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/duplicates.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  logLevel: 'warning',
});

const {
  fold, normRef, titleWords, similarity, yearsClash, daysApart, compareBids,
  findDuplicates, findClientClashes, findSimilarBids, duplicateSummary, groupKey,
  BID_DEADLINE_DAYS, BID_CREATED_DAYS,
} = await import(pathToFileURL(OUT).href);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = new Date(); TODAY.setHours(12, 0, 0, 0);
const off = n => iso(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + n));
// A Firestore-Timestamp look-alike.
const ts = n => { const ms = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + n, 10).getTime(); return { toMillis: () => ms }; };
const codes = g => g.reasons.map(r => r.code);
const ids = g => g.records.map(r => r.id);

// ── Text helpers ─────────────────────────────────────────────────────────────
eq(fold('مُناقَصة إصلاح ٢٠٢٦'), 'مناقصه اصلاح 2026', 'fold: harakat, alef, taa marbuta, Arabic digits');
eq(normRef('RFQ-2026/118'), 'RFQ2026118', 'normRef strips punctuation');
eq(normRef('rfq 2026 118'), 'RFQ2026118', 'normRef: spaces + case');
eq(normRef('RFQ-٢٠٢٦/١١٨'), 'RFQ2026118', 'normRef: Arabic digits');
eq(normRef('N/A'), '', 'placeholder N/A = no number');
eq(normRef('TBD'), '', 'placeholder TBD = no number');
eq(normRef('-'), '', 'dash = no number');
eq(normRef('000'), '', 'zeros = no number');
eq(normRef('لا يوجد'), '', 'Arabic "none" = no number');
eq(normRef('12'), '', 'two characters is too short to trust');
eq([...titleWords('EGPC Turnaround Services Tender 2026', ['egpc'])], ['turnaround', '2026'], 'filler + client words dropped');
eq([...titleWords('مناقصة صيانة الخزانات والمواسير')], ['صيانه', 'خزانات', 'مواسير'], 'Arabic filler + clitics');
ok(similarity(titleWords('Tank cleaning Meleiha'), titleWords('Meleiha tank cleaning')) === 1, 'word order does not matter');
ok(similarity(titleWords('Tank cleaning'), titleWords('Pipeline inspection')) === 0, 'different jobs share nothing');
ok(yearsClash(titleWords('Turnaround 2025'), titleWords('Turnaround 2026')), 'different years clash');
ok(!yearsClash(titleWords('Turnaround 2026'), titleWords('Turnaround')), 'one year missing is not a clash');
eq(daysApart(off(0), off(5)), 5, 'daysApart');
eq(daysApart(off(0), ''), null, 'daysApart missing');

// ── Bids ─────────────────────────────────────────────────────────────────────
const MONA = 'u-mona', SAMI = 'u-sami', HANY = 'u-hany';
const bid = (id, o) => ({ id, serialNumber: `OP${id.replace(/\D/g, '').padStart(6, '0')}`, stage: 'Identified', createdAt: ts(-10), ...o });

const bids = [
  // 1. Same tender number, different spelling of the number and of the client → certain.
  bid('b1', { title: 'AGIBA tank cleaning 2026', client: 'AGIBA', tenderNumber: 'RFQ-2026/118', ownerId: MONA, ownerName: 'Mona Fathy', submissionDeadline: off(20), createdAt: ts(-12) }),
  bid('b2', { title: 'Tank cleaning — Meleiha', client: 'Agiba Co.', tenderNumber: 'rfq 2026 118', ownerId: SAMI, ownerName: 'Sami Adel', submissionDeadline: off(20), createdAt: ts(-2) }),
  // 2. No number, same client, same words, deadlines 3 days apart → likely.
  bid('b3', { title: 'Petrojet Algeria compressor overhaul', client: 'Petrojet', ownerId: HANY, ownerName: 'Hany', submissionDeadline: off(30) }),
  bid('b4', { title: 'Compressor overhaul Algeria', client: 'PETROJET', ownerId: HANY, ownerName: 'Hany', submissionDeadline: off(33) }),
  // Same client + title but a year apart in the title → NOT a duplicate.
  bid('b5', { title: 'EGPC Turnaround 2025', client: 'EGPC', submissionDeadline: off(-300), stage: 'Lost' }),
  bid('b6', { title: 'EGPC Turnaround 2026', client: 'EGPC', submissionDeadline: off(40) }),
  // Same number, different named clients → NOT a duplicate (RFQ-001 is everyone's first RFQ).
  bid('b7', { title: 'Scaffolding', client: 'APC', tenderNumber: 'RFQ-001' }),
  bid('b8', { title: 'Scaffolding supply', client: 'MIDOR', tenderNumber: 'RFQ-001' }),
  // Same client + title but deadlines 60 days apart → two rounds, NOT a duplicate.
  bid('b9', { title: 'Heat exchanger cleaning', client: 'ANOPC', submissionDeadline: off(10) }),
  bid('b10', { title: 'Heat exchanger cleaning', client: 'ANOPC', submissionDeadline: off(70) }),
  // Both closed → not worth flagging.
  bid('b11', { title: 'Old job', client: 'WEPCO', tenderNumber: 'T-555', stage: 'Lost' }),
  bid('b12', { title: 'Old job', client: 'WEPCO', tenderNumber: 'T-555', stage: 'Cancelled' }),
  // One closed, one live, same number → flagged, but only "likely" (may be a re-issue).
  bid('b13', { title: 'Flare repair', client: 'MIDOR', tenderNumber: 'MD-77', stage: 'Cancelled' }),
  bid('b14', { title: 'Flare repair re-tender', client: 'MIDOR', tenderNumber: 'MD 77' }),
  // A three-copy tender (Arabic titles) → ONE group of three.
  bid('b15', { title: 'مناقصة صيانة الخزانات', client: 'شركة أنوبك', submissionDeadline: off(15), createdAt: ts(-20) }),
  bid('b16', { title: 'صيانة خزانات', client: 'انوبك', submissionDeadline: off(16), createdAt: ts(-5) }),
  bid('b17', { title: 'عملية صيانة الخزانات', client: 'أنوبك', submissionDeadline: off(15), createdAt: ts(-1) }),
  // Same client, similar title, no deadlines, entered 200 days apart → NOT flagged.
  bid('b18', { title: 'Valve supply', client: 'GUPCO', createdAt: ts(-200) }),
  bid('b19', { title: 'Valve supply', client: 'GUPCO', createdAt: ts(0) }),
  // No client on one, only title in common → NOT flagged on the page.
  bid('b20', { title: 'Cathodic protection survey' }),
  bid('b21', { title: 'Cathodic protection survey', client: 'SUMED' }),
  { id: '--stats--', count: 99 },
];

// compareBids directly
{
  const p = compareBids(bids[0], bids[1]);
  eq(p?.strength, 'certain', 'b1/b2 same number = certain');
  ok(p?.reasons.some(r => r.code === 'same-tender-number'), 'b1/b2 reason names the number');
  ok(p?.reasons.some(r => r.code === 'same-client'), 'b1/b2 reason: same client (Agiba Co. = AGIBA)');
  eq(compareBids(bids[4], bids[5]), null, 'years clash → not the same');
  eq(compareBids(bids[6], bids[7]), null, 'same number, two clients → not the same');
  eq(compareBids(bids[8], bids[9]), null, `deadlines > ${BID_DEADLINE_DAYS} days apart → not the same`);
  eq(compareBids(bids[17], bids[18]), null, `entered > ${BID_CREATED_DAYS} days apart → not the same`);
  eq(compareBids(bids[19], bids[20]), null, 'a missing client and no number → not claimed');
}

const report = findDuplicates({ opportunities: bids, correspondences: [], tasks: [], projects: [] });
const bidGroups = report.groups.filter(g => g.kind === 'bid');
const groupWith = id => bidGroups.find(g => ids(g).includes(id));

eq(bidGroups.length, 4, 'four bid groups: b1/b2, b3/b4, b13/b14, b15-17');
eq(ids(groupWith('b1')), ['b1', 'b2'], 'b1/b2 grouped, oldest first');
eq(groupWith('b1').strength, 'certain', 'b1/b2 certain');
eq(groupWith('b3').strength, 'likely', 'b3/b4 likely');
ok(codes(groupWith('b3')).includes('deadlines-close'), 'b3/b4 says the deadlines are close');
eq(groupWith('b3').reasons.find(r => r.code === 'deadlines-close')?.value, 3, 'b3/b4 3 days apart');
eq(groupWith('b13').strength, 'likely', 'one closed + one live = likely only');
ok(codes(groupWith('b13')).includes('one-closed'), 'b13/b14 says one is closed');
eq(ids(groupWith('b15')), ['b15', 'b16', 'b17'], 'three Arabic copies = one group, oldest first');
ok(codes(groupWith('b15')).includes('same-title'), 'Arabic copies: same title after filler/clitics');
ok(!groupWith('b5') && !groupWith('b7') && !groupWith('b9') && !groupWith('b11') && !groupWith('b18') && !groupWith('b20'), 'none of the look-alikes flagged');
ok(!report.groups.some(g => ids(g).includes('--stats--')), 'stats doc ignored');
eq(report.groups[0].strength, 'certain', 'certain groups sort first');
eq(groupWith('b1').key, groupKey('bid', ['b2', 'b1']), 'group key is order-free');
eq(groupWith('b1').key, 'bid:b1,b2', 'group key shape');

// ── The New bid form ─────────────────────────────────────────────────────────
{
  const hit = findSimilarBids({ title: 'Something else entirely', client: '', tenderNumber: 'RFQ 2026-118' }, bids);
  eq(hit.map(h => h.record.id).sort(), ['b1', 'b2'], 'draft number finds both copies, even with no client typed');
  eq(hit[0].strength, 'certain', 'draft number match = certain');
  eq(findSimilarBids({ title: 'Algeria compressor overhaul', client: 'Petrojet', submissionDeadline: off(31) }, bids).map(h => h.record.id).sort(), ['b3', 'b4'], 'draft title + client finds the live bids');
  eq(findSimilarBids({ title: 'Algeria compressor overhaul', client: 'Petrojet', submissionDeadline: off(90) }, bids), [], 'a far-off deadline = a new round, no warning');
  eq(findSimilarBids({ title: 'Algeria compressor overhaul', client: 'Petrojet' }, bids).length, 2, 'no deadline typed yet: still warns (they are being entered now)');
  eq(findSimilarBids({ title: 'Old job', client: 'WEPCO', tenderNumber: 'T 555' }, bids).map(h => h.record.id).sort(), ['b11', 'b12'], 'closed bids DO count on a shared number ("you recorded this as Lost")');
  eq(findSimilarBids({ title: 'EGPC Turnaround 2025', client: 'EGPC' }, bids), [], 'closed bids do NOT count on a title alone');
  eq(findSimilarBids({ title: 'Flare repair', client: 'MIDOR', tenderNumber: 'MD-77' }, bids, 'b14').map(h => h.record.id), ['b13'], 'editing excludes itself');
  eq(findSimilarBids({ title: '', tenderNumber: '' }, bids), [], 'empty draft = no warning');
  eq(findSimilarBids({ title: 'x', tenderNumber: 'RFQ-2026-118' }, bids, undefined, 1).length, 1, 'limit respected');
}

// ── Letters ──────────────────────────────────────────────────────────────────
const letter = (id, o) => ({ id, serialNumber: `CR${id.replace(/\D/g, '').padStart(6, '0')}`, status: 'Unread', createdAt: ts(-3), ...o });
const letters = [
  letter('l1', { subject: 'Invoice No. 45 — March', sentFrom: 'AGIBA', dateReceived: off(-3) }),
  letter('l2', { subject: 'invoice no 45 march', sentFrom: 'Agiba Co', dateReceived: off(-3) }),
  letter('l3', { subject: 'طلب عرض أسعار لصيانة المضخات', sentFrom: 'بتروجت', dateReceived: off(-2) }),
  letter('l4', { subject: 'عرض أسعار صيانة المضخات', sentFrom: 'بتروجت', dateReceived: off(-1) }),
  // Same subject, a month apart → the monthly report, NOT a duplicate.
  letter('l5', { subject: 'Monthly progress report', sentFrom: 'MIDOR', dateReceived: off(-40) }),
  letter('l6', { subject: 'Monthly progress report', sentFrom: 'MIDOR', dateReceived: off(-10) }),
  // Same subject, same day, different senders → NOT a duplicate.
  letter('l7', { subject: 'Monthly progress report', sentFrom: 'APC', dateReceived: off(-10) }),
  // Both closed → ignored.
  letter('l8', { subject: 'Old thing', sentFrom: 'X', dateReceived: off(-100), status: 'Closed' }),
  letter('l9', { subject: 'Old thing', sentFrom: 'X', dateReceived: off(-100), status: 'Closed' }),
];
{
  const r = findDuplicates({ opportunities: [], correspondences: letters, tasks: [], projects: [] });
  const g1 = r.groups.find(g => ids(g).includes('l1'));
  eq(g1 && ids(g1), ['l1', 'l2'], 'letters l1/l2 grouped');
  eq(g1?.strength, 'certain', 'same sender + same subject + same day = certain');
  const g3 = r.groups.find(g => ids(g).includes('l3'));
  eq(g3 && ids(g3), ['l3', 'l4'], 'Arabic near-identical subjects a day apart grouped');
  eq(g3?.strength, 'likely', 'a day apart = likely');
  ok(!r.groups.some(g => ids(g).includes('l5') || ids(g).includes('l7')), 'monthly report / other sender not flagged');
  ok(!r.groups.some(g => ids(g).includes('l8')), 'two closed letters ignored');
}

// ── Tasks ────────────────────────────────────────────────────────────────────
const task = (id, o) => ({ id, serialNumber: `TK${id.replace(/\D/g, '').padStart(6, '0')}`, status: 'Pending', createdAt: ts(-2), ...o });
const tasks = [
  // One letter turned into a task twice → certain, whatever the titles.
  task('t1', { taskName: 'Reply to AGIBA invoice', correspondingId: 'l1', correspondingSerialNumber: 'CR000001', assignedToId: MONA }),
  task('t2', { taskName: 'Handle invoice 45', correspondingId: 'l1', correspondingSerialNumber: 'CR000001', assignedToId: SAMI }),
  // Same title, same person, 1 day apart → likely.
  task('t3', { taskName: 'Send prices to Petrojet', assignedToId: HANY, assignedTo: 'Hany', createdAt: ts(-3) }),
  task('t4', { taskName: 'send prices to petrojet', assignedToId: HANY, assignedTo: 'Hany', createdAt: ts(-2) }),
  // Same title, same bid, two people → likely (same link).
  task('t5', { taskName: 'Prepare technical offer', assignedToId: MONA, opportunityId: 'b3', opportunityTitle: 'Compressor overhaul' }),
  task('t6', { taskName: 'Prepare the technical offer', assignedToId: SAMI, opportunityId: 'b3', opportunityTitle: 'Compressor overhaul' }),
  // Same title, same person, 3 weeks apart → the weekly chore, NOT a duplicate.
  task('t7', { taskName: 'Weekly report', assignedToId: MONA, createdAt: ts(-21) }),
  task('t8', { taskName: 'Weekly report', assignedToId: MONA, createdAt: ts(0) }),
  // Same title, two people, nothing linked → NOT a duplicate.
  task('t9', { taskName: 'Update CV', assignedToId: MONA }),
  task('t10', { taskName: 'Update CV', assignedToId: SAMI }),
  // A done copy does not count.
  task('t11', { taskName: 'Call ANOPC', assignedToId: HANY, status: 'Done' }),
  task('t12', { taskName: 'Call ANOPC', assignedToId: HANY }),
];
{
  const r = findDuplicates({ opportunities: [], correspondences: [], tasks, projects: [] });
  const g = id => r.groups.find(x => ids(x).includes(id));
  eq(g('t1') && ids(g('t1')).sort(), ['t1', 't2'], 'one letter, two tasks');
  eq(g('t1')?.strength, 'certain', 'one letter, two tasks = certain');
  ok(codes(g('t1')).includes('same-letter'), 'reason: same letter');
  eq(g('t3') && ids(g('t3')), ['t3', 't4'], 'same title same person');
  ok(codes(g('t3')).includes('same-owner'), 'reason: same owner');
  eq(g('t5') && ids(g('t5')).sort(), ['t5', 't6'], 'same bid, near-same title');
  ok(codes(g('t5')).includes('same-link'), 'reason: same bid');
  ok(!g('t7') && !g('t9') && !g('t11') && !g('t12'), 'weekly chore / two people / done copy not flagged');
}

// ── Projects ─────────────────────────────────────────────────────────────────
const project = (id, o) => ({ id, serialNumber: `PR${id.replace(/\D/g, '').padStart(6, '0')}`, status: 'Active', createdAt: ts(-30), ...o });
const projects = [
  project('p1', { name: 'AGIBA Meleiha', client: 'AGIBA', code: '4600001234' }),
  project('p2', { name: 'Meleiha field services', client: 'AGIBA', code: '46000 01234' }),
  project('p3', { name: 'APC', client: 'APC' }),
  project('p4', { name: 'APC', client: 'APC' }),
  // Same client, different contract numbers → two contracts.
  project('p5', { name: 'PETROGAS', client: 'PETROGAS', code: 'C-1' + '00' }),
  project('p6', { name: 'PETROGAS', client: 'PETROGAS', code: 'C-200' }),
  // Both finished → ignored.
  project('p7', { name: 'Old', client: 'Q', status: 'Completed' }),
  project('p8', { name: 'Old', client: 'Q', status: 'Cancelled' }),
];
{
  const r = findDuplicates({ opportunities: [], correspondences: [], tasks: [], projects });
  const g = id => r.groups.find(x => ids(x).includes(id));
  eq(g('p1')?.strength, 'certain', 'same contract number (spaces ignored) = certain');
  ok(codes(g('p1')).includes('same-contract-number'), 'reason: same contract number');
  eq(g('p3') && ids(g('p3')), ['p3', 'p4'], 'same client, name is only the client = same project');
  ok(!g('p5') && !g('p7'), 'two contract numbers / two finished projects not flagged');
}

// ── Two people on one client ─────────────────────────────────────────────────
{
  const list = [
    bid('c1', { title: 'Tank cleaning', client: 'AGIBA', ownerId: MONA, ownerName: 'Mona Fathy' }),
    bid('c2', { title: 'Valve overhaul', client: 'Agiba Co.', ownerId: SAMI, ownerName: 'Sami Adel' }),
    bid('c3', { title: 'Scaffolding', client: 'AGIBA', ownerId: MONA, ownerName: 'Mona Fathy' }),
    // Won bid does not count (not open).
    bid('c4', { title: 'Old', client: 'AGIBA', ownerId: HANY, ownerName: 'Hany', stage: 'Won' }),
    // One owner only → no clash.
    bid('c5', { title: 'A', client: 'MIDOR', ownerId: HANY, ownerName: 'Hany' }),
    bid('c6', { title: 'B', client: 'MIDOR', ownerId: HANY, ownerName: 'Hany' }),
    // Two owners who co-own each other's bids → a team, no clash.
    bid('c7', { title: 'A', client: 'ANOPC', ownerId: MONA, ownerName: 'Mona Fathy', collaboratorIds: [SAMI] }),
    bid('c8', { title: 'B', client: 'ANOPC', ownerId: SAMI, ownerName: 'Sami Adel', collaboratorIds: [MONA] }),
    // Unowned bid never makes a clash.
    bid('c9', { title: 'A', client: 'GUPCO', ownerId: MONA, ownerName: 'Mona Fathy' }),
    bid('c10', { title: 'B', client: 'GUPCO' }),
  ];
  const clashes = findClientClashes(list);
  eq(clashes.length, 1, 'only AGIBA is a clash');
  eq(clashes[0].client, 'AGIBA', 'client shown as most bids spell it');
  eq(clashes[0].people.map(p => p.name), ['Mona Fathy', 'Sami Adel'], 'people, most bids first');
  eq(clashes[0].people[0].bids.map(b => b.id), ['c1', 'c3'], 'Mona holds c1 + c3');
  eq(clashes[0].key, groupKey('clash', ['agiba', MONA, SAMI]), 'clash key = client + owners');
  // A third person joining changes the key, so a dismissed clash comes back.
  const more = findClientClashes([...list, bid('c11', { title: 'X', client: 'AGIBA', ownerId: HANY, ownerName: 'Hany' })]);
  ok(more[0].key !== clashes[0].key, 'a third owner = a new key (dismissal does not hide it)');
  eq(more[0].people.length, 3, 'three people listed');
}

// ── Summary ──────────────────────────────────────────────────────────────────
{
  const all = findDuplicates({ opportunities: bids, correspondences: letters, tasks, projects });
  const s = duplicateSummary(all);
  eq(s.byKind, { bid: 4, letter: 2, task: 3, project: 2 }, 'summary per kind');
  eq(s.groups, 11, 'eleven groups in all');
  eq(s.extraCopies, 12, 'extra copies = records beyond the first in each group');
  ok(s.certain >= 4, 'certain counted');
  eq(s.clashes, 1, 'one clash in the bid fixtures (AGIBA: Mona vs Sami)');
}

// ── Size: a big board stays fast ─────────────────────────────────────────────
{
  const many = [];
  for (let i = 0; i < 3000; i++) many.push(task(`x${i}`, { taskName: `Job number ${i} for client ${i % 50}`, assignedToId: `u${i % 15}`, createdAt: ts(-(i % 60)) }));
  const t0 = Date.now();
  findDuplicates({ opportunities: [], correspondences: [], tasks: many, projects: [] });
  const ms = Date.now() - t0;
  ok(ms < 3000, `3,000 tasks checked in ${ms} ms (limit 3,000)`);
}

console.log(`duplicates: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL', f);
process.exit(fails.length ? 1 : 0);
