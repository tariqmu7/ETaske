// Harness for src/lib/waitingBoard.ts -> the Waiting board (queue D2).
//
// Bundles the REAL module with esbuild. Nothing touches the network or Firebase.
//
//   node scripts/harness/waitingboard.mjs
//
// `today` is injected and every fixture date is an offset from it, so the
// fixtures do not rot with the calendar.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'waitingBoard.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/waitingBoard.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  logLevel: 'warning',
});

const {
  buildWaitingBoard, isMarkedThem, waitingPatch, canMoveLetter, canMoveTask,
  filterItems, sideSummary, isMine, ageBand, dayOf, AGE_WARN_DAYS, AGE_ALERT_DAYS,
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
// A Firestore-ish Timestamp n days from today.
const ts = n => { const d = new Date(TODAY.getTime() + n * 86_400_000); return { toMillis: () => d.getTime(), toDate: () => d }; };

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ME = 'u-me', MONA = 'u-mona', BOSS = 'u-boss';
const userNames = { [ME]: 'Tariq', [MONA]: 'Mona Fathy', [BOSS]: 'Boss' };

const correspondences = [
  { id: '--stats--', value: 9 },
  { id: 'l1', subject: 'AGIBA asks for revised prices', serialNumber: 'CR000001', sentFrom: 'AGIBA', status: 'Unread', dateReceived: off(-10), deadline: off(-2), userId: ME, createdAt: ts(-10) },
  { id: 'l2', subject: 'Closed letter', status: 'Closed', dateReceived: off(-40), userId: ME },
  { id: 'l3', subject: 'Waiting for their signed copy', status: 'Assigned', assignedTo: 'Mona Fathy', assignedToId: MONA, sentFrom: 'Petrojet', dateReceived: off(-30), userId: BOSS,
    waitingOn: 'them', waitingSince: off(-3), waitingFor: 'Petrojet legal' },
  { id: 'l4', subject: 'No date at all', status: 'Reviewing', userId: BOSS },
  { id: 'l5', subject: 'Marked once, then back to us', status: 'Reviewing', dateReceived: off(-5), userId: ME, waitingOn: 'us', statusUpdate: 'Waiting on Third Party' },
];
const tasks = [
  { id: 't1', taskName: 'Prepare price schedule', serialNumber: 'TK000001', status: 'In Progress', assignedTo: 'Tariq', assignedToId: ME, createdAt: ts(-20), dueDate: off(3) },
  { id: 't2', taskName: 'Done task', status: 'Done', assignedToId: ME, createdAt: ts(-50) },
  { id: 't3', taskName: 'Archived task', status: 'Archived', assignedToId: ME, createdAt: ts(-50) },
  { id: 't4', taskName: 'Waiting on finance approval', status: 'Pending', assignedTo: 'Mona Fathy', assignedToId: MONA, collaboratorIds: [ME],
    createdAt: ts(-60), updatedAt: ts(-8), waitingOn: 'them', waitingSince: off(-15), waitingFor: 'Finance' },
  { id: 't5', taskName: 'Old third-party task', status: 'Pending', assignedTo: 'Mona Fathy', assignedToId: MONA, createdAt: ts(-30), updatedAt: ts(-9), statusUpdate: 'Waiting on Third Party' },
  { id: 't6', taskName: 'Fresh task', status: 'Pending', assignedTo: 'Mona Fathy', assignedToId: MONA, createdAt: ts(0) },
];
const opportunities = [
  { id: 'o1', title: 'Meleiha tie-in', serialNumber: 'OP000001', client: 'AGIBA', stage: 'Bid Preparation', ownerId: ME, ownerName: 'Tariq', createdAt: ts(-12), submissionDeadline: off(4) },
  { id: 'o2', title: 'Zohr maintenance', serialNumber: 'OP000002', client: 'Petrobel', stage: 'Submitted', ownerId: MONA, ownerName: 'Mona Fathy', submittedDate: off(-25), updatedAt: ts(-2) },
  { id: 'o3', title: 'Under evaluation, no date', client: 'GASCO', stage: 'Under Evaluation', ownerId: MONA, ownerName: 'Mona Fathy', updatedAt: ts(-6) },
  { id: 'o4', title: 'Won bid', stage: 'Won', ownerId: ME },
  { id: 'o5', title: 'Lost bid', stage: 'Lost', ownerId: ME },
  { id: 'o6', title: 'No stage typed', ownerId: ME, createdAt: ts(-1) },
  { id: 'o7', title: 'Announced earlier than entered', stage: 'Identified', ownerId: ME, announcedDate: off(-9), createdAt: ts(-2) },
];
const recv = n => ({ received_at: new Date(TODAY.getTime() + n * 86_400_000).toISOString() });
const threads = [
  { key: 'k1', title: 'Site visit dates', counterparty: 'Ahmed (ENPPI)', awaitingReply: true, overdue: true, lastIncoming: recv(-6), last: recv(-6) },
  { key: 'k2', title: 'Clarification 3', counterparty: 'NOC Oman', awaitingTheirReply: true, theirOverdue: true, lastOutgoing: recv(-9), last: recv(-9) },
  { key: 'k3', title: 'This morning', counterparty: 'X', awaitingReply: true, overdue: false, lastIncoming: recv(0), last: recv(0) },
  { key: 'k4', title: 'Answered', counterparty: 'Y', awaitingReply: false, awaitingTheirReply: false },
  { key: 'k5', title: 'We wrote yesterday', counterparty: 'Z', awaitingTheirReply: true, theirOverdue: false, lastOutgoing: recv(-1) },
];

const board = buildWaitingBoard({ tasks, correspondences, opportunities, threads, userNames }, TODAY);
const find = (side, key) => board[side].find(i => i.key === key);
const keys = side => board[side].map(i => i.key);

// ── [1] Who lands on which side ──────────────────────────────────────────────
ok(find('us', 'letter:l1'), '[1] an unread letter is on us');
ok(!keys('us').includes('letter:l2') && !keys('them').includes('letter:l2'), '[1] a closed letter is nowhere');
ok(find('them', 'letter:l3'), '[1] a letter marked waitingOn=them is on them');
ok(find('us', 'letter:l4'), '[1] a letter with no dates is still on us');
ok(find('us', 'letter:l5'), '[1] waitingOn=us beats an old "Waiting on Third Party" note');
ok(find('us', 'task:t1'), '[1] an open task is on us');
ok(!keys('us').concat(keys('them')).some(k => k === 'task:t2' || k === 'task:t3'), '[1] done / archived tasks are nowhere');
ok(find('them', 'task:t4'), '[1] a task marked waitingOn=them is on them');
ok(find('them', 'task:t5'), '[1] an older task whose status note says "Waiting on Third Party" is on them');
ok(find('us', 'task:t6'), '[1] a task created today is on us');
ok(find('us', 'bid:o1'), '[1] a bid in preparation is on us');
ok(find('them', 'bid:o2'), '[1] a submitted bid is on them');
ok(find('them', 'bid:o3'), '[1] a bid under evaluation is on them');
ok(!keys('us').concat(keys('them')).some(k => k === 'bid:o4' || k === 'bid:o5'), '[1] won / lost bids are nowhere');
ok(find('us', 'bid:o6'), '[1] a bid with no stage counts as Identified — on us');
ok(find('us', 'mail:k1'), '[1] an overdue unanswered mail chain is on us');
ok(find('them', 'mail:k2'), '[1] a chain we wrote last, overdue, is on them');
ok(!keys('us').includes('mail:k3'), '[1] a mail from this morning is not waiting yet');
ok(!keys('us').concat(keys('them')).includes('mail:k4'), '[1] an answered chain is nowhere');
ok(!keys('them').includes('mail:k5'), '[1] a mail we sent yesterday is not chased yet');
eq([board.us.length, board.them.length], [9, 6], '[1] totals: 9 on us, 6 on them');

// ── [2] Age in days ──────────────────────────────────────────────────────────
eq(find('us', 'letter:l1').days, 10, '[2] a letter ages from the day it arrived');
eq(find('us', 'letter:l1').since, off(-10), '[2] …and says so');
eq(find('them', 'letter:l3').days, 3, '[2] a marked letter ages from the day it was marked, not when it arrived');
eq(find('us', 'letter:l4').days, null, '[2] no dates at all = unknown age, not 0');
eq(find('us', 'task:t1').days, 20, '[2] a task ages from createdAt');
eq(find('them', 'task:t4').days, 15, '[2] a marked task ages from waitingSince');
eq(find('them', 'task:t5').days, 9, '[2] an old third-party task with no waitingSince falls back to updatedAt');
eq(find('us', 'task:t6').days, 0, '[2] created today = 0 days');
eq(find('us', 'bid:o1').days, 12, '[2] a bid in preparation ages from createdAt');
eq(find('us', 'bid:o7').days, 9, '[2] …or from announcedDate when that is known');
eq(find('them', 'bid:o2').days, 25, '[2] a submitted bid ages from submittedDate, not its last edit');
eq(find('them', 'bid:o3').days, 6, '[2] no submittedDate → last update');
eq(find('us', 'mail:k1').days, 6, '[2] an unanswered chain ages from THEIR last message');
eq(find('them', 'mail:k2').days, 9, '[2] a silent chain ages from OUR last message');
const future = buildWaitingBoard({ tasks: [{ id: 'f', taskName: 'clock skew', status: 'Pending', createdAt: ts(2) }], correspondences: [], opportunities: [] }, TODAY);
eq(future.us[0].days, 0, '[2] a date in the future never gives a negative age');

// ── [3] Bands ────────────────────────────────────────────────────────────────
eq([ageBand(null), ageBand(0), ageBand(AGE_WARN_DAYS - 1), ageBand(AGE_WARN_DAYS), ageBand(AGE_ALERT_DAYS - 1), ageBand(AGE_ALERT_DAYS), ageBand(90)],
  ['fresh', 'fresh', 'fresh', 'warn', 'warn', 'alert', 'alert'], '[3] band edges 7 / 14');
eq(find('us', 'task:t1').band, 'alert', '[3] 20 days = alert');
eq(find('us', 'letter:l1').band, 'warn', '[3] 10 days = warn');
eq(find('them', 'letter:l3').band, 'fresh', '[3] 3 days = fresh');

// ── [4] Due dates / late ─────────────────────────────────────────────────────
eq([find('us', 'letter:l1').due, find('us', 'letter:l1').late], [off(-2), true], '[4] letter past its deadline is late');
eq([find('us', 'task:t1').due, find('us', 'task:t1').late], [off(3), false], '[4] task due in 3 days is not late');
eq(find('us', 'bid:o1').due, off(4), '[4] a bid on us shows its submission deadline');
eq(find('them', 'bid:o2').due, undefined, '[4] a submitted bid with no decision date shows none');
eq(find('us', 'letter:l4').late, false, '[4] no date is never late');

// ── [5] Order: longest wait first ────────────────────────────────────────────
const ages = list => list.map(i => i.days ?? -1);
ok(ages(board.us).every((d, i, a) => i === 0 || a[i - 1] >= d), '[5] "on us" is longest-waiting first');
ok(ages(board.them).every((d, i, a) => i === 0 || a[i - 1] >= d), '[5] "on them" is longest-waiting first');
eq(board.us[board.us.length - 1].key, 'letter:l4', '[5] an unknown age sorts last');
eq(board.them[0].key, 'bid:o2', '[5] the 25-day submitted bid tops "on them"');

// ── [6] Details carried to the row ───────────────────────────────────────────
const l3 = find('them', 'letter:l3');
eq([l3.party, l3.owner, l3.reason, l3.movable], ['Petrojet legal', 'Mona Fathy', 'marked', true], '[6] marked letter: who we wait on, owner, reason, movable');
eq(find('us', 'letter:l1').party, 'AGIBA', '[6] a letter on us names its sender');
eq(find('us', 'letter:l4').owner, 'Boss', '[6] an unassigned letter is held by whoever logged it');
eq(find('them', 'task:t4').party, 'Finance', '[6] marked task: who we wait on');
eq(find('them', 'task:t5').party, undefined, '[6] old third-party task: nobody named');
eq([find('them', 'bid:o2').party, find('them', 'bid:o2').reason, find('them', 'bid:o2').movable], ['Petrobel', 'bid-decision', false], '[6] submitted bid waits on the client, cannot be moved by hand');
eq(find('us', 'bid:o1').reason, 'bid-prepare', '[6] bid reason on us');
eq([find('us', 'mail:k1').party, find('us', 'mail:k1').open, find('us', 'mail:k1').movable], ['Ahmed (ENPPI)', undefined, false], '[6] mail: counterparty, nothing to open, not movable');
eq(find('us', 'task:t1').open, { type: 'task', id: 't1', serial: 'TK000001', label: 'Prepare price schedule' }, '[6] a task row opens its task');
eq(find('us', 'letter:l1').open.type, 'corresponding', '[6] a letter row opens the letter');
eq(find('them', 'bid:o2').open.type, 'opportunity', '[6] a bid row opens the bid');
ok(!JSON.stringify(board).includes('--stats--'), '[6] the counter docs never show up');

// ── [7] isMarkedThem / waitingPatch ──────────────────────────────────────────
eq([isMarkedThem({ waitingOn: 'them' }), isMarkedThem({ waitingOn: 'us', statusUpdate: 'Waiting on Third Party' }),
  isMarkedThem({ statusUpdate: 'Waiting on Third Party' }), isMarkedThem({ statusUpdate: 'On Track' }), isMarkedThem({}), isMarkedThem(null)],
  [true, false, true, false, false, false], '[7] isMarkedThem truth table');
eq(waitingPatch('them', '  AGIBA  ', TODAY), { waitingOn: 'them', waitingSince: iso(TODAY), waitingFor: 'AGIBA' }, '[7] to them: stamps today + trims the name');
eq(waitingPatch('them', undefined, TODAY).waitingFor, '', '[7] to them with nobody named');
eq(waitingPatch('us', 'x', TODAY), { waitingOn: 'us', waitingSince: '', waitingFor: '' }, '[7] back to us clears both');
ok(!('updatedAt' in waitingPatch('them')), '[7] the patch leaves updatedAt to the caller');
// Round trip: the patch applied to a record puts it on the other side.
const moved = buildWaitingBoard({ tasks: [{ ...tasks[0], ...waitingPatch('them', 'AGIBA', TODAY) }], correspondences: [], opportunities: [] }, TODAY);
eq([moved.us.length, moved.them.length, moved.them[0].days, moved.them[0].party], [0, 1, 0, 'AGIBA'], '[7] after the write the task sits on them, 0 days, waiting on AGIBA');
const back = buildWaitingBoard({ tasks: [{ ...tasks[3], ...waitingPatch('us') }], correspondences: [], opportunities: [] }, TODAY);
eq([back.us.length, back.us[0].days], [1, 60], '[7] moved back: on us again, aged from createdAt');

// ── [8] Who may move what (mirrors firestore.rules) ──────────────────────────
eq([canMoveLetter(correspondences[1], ME, false), canMoveLetter(correspondences[3], MONA, false), canMoveLetter(correspondences[3], MONA, true)],
  [true, false, true], '[8] letters: the person who logged it, or a manager — not the assignee');
eq([canMoveTask(tasks[0], ME, false), canMoveTask(tasks[3], ME, false), canMoveTask(tasks[5], ME, false), canMoveTask(tasks[5], BOSS, true)],
  [true, true, false, true], '[8] tasks: owner, collaborator, manager on a public task');
eq(canMoveTask({ ...tasks[5], isPrivate: true }, BOSS, true), false, '[8] a manager cannot touch a private task');
eq(canMoveTask({ ...tasks[5], assignedById: ME }, ME, false), true, '[8] the assigner may move a public task');

// ── [9] Filters and summary ──────────────────────────────────────────────────
const mineUs = filterItems(board.us, { uid: ME, mineOnly: true, kind: 'all' }).map(i => i.key);
ok(mineUs.includes('task:t1') && mineUs.includes('bid:o1') && mineUs.includes('letter:l1'), '[9] Mine: my task, my bid, the letter I logged');
ok(mineUs.includes('mail:k1'), '[9] Mine: my own Outlook always counts');
ok(!mineUs.includes('task:t6'), '[9] Mine: Mona\'s task is not mine');
ok(filterItems(board.them, { uid: ME, mineOnly: true, kind: 'all' }).some(i => i.key === 'task:t4'), '[9] Mine: a task I collaborate on is mine');
eq(filterItems(board.us, { uid: ME, mineOnly: false, kind: 'bid' }).map(i => i.kind), ['bid', 'bid', 'bid'], '[9] kind filter: bids only');
eq(filterItems(board.them, { uid: ME, mineOnly: false, kind: 'all', person: 'Mona Fathy' }).length, 5, '[9] person filter: Mona holds l3, t4, t5, o2, o3');
eq(sideSummary(board.them), { count: 6, aged: 4, oldest: 25 }, '[9] summary: count, how many ≥7 days, the oldest');
eq(sideSummary([]), { count: 0, aged: 0, oldest: 0 }, '[9] empty summary');
ok(isMine({ ownerIds: ['__me__'] }, 'anyone'), '[9] isMine on Outlook mail');

// ── [10] Robustness ──────────────────────────────────────────────────────────
const empty = buildWaitingBoard({ tasks: [], correspondences: [], opportunities: [] }, TODAY);
eq([empty.us.length, empty.them.length], [0, 0], '[10] empty input');
const junk = buildWaitingBoard({ tasks: [null, {}], correspondences: [undefined], opportunities: [{}], threads: [null, {}] }, TODAY);
eq([junk.us.length, junk.them.length], [2, 0], '[10] junk rows: an empty task and an empty bid still land on us, the rest is skipped');
eq(junk.us.every(i => i.title === '—'), true, '[10] …with a dash for a title');
eq(dayOf('2026-03-05'), '2026-03-05', '[10] dayOf keeps a plain day');
eq(dayOf(ts(0)), iso(TODAY), '[10] dayOf a Timestamp');
eq(dayOf(''), '', '[10] dayOf empty');

console.log(`waitingboard: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  ✗', f);
process.exit(fails.length ? 1 : 0);
