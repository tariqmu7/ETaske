// Harness for src/lib/deadlineCalendar.ts -> the deadline calendar (queue D3).
//
// Bundles the REAL module with esbuild. Nothing touches the network or Firebase.
//
//   node scripts/harness/deadlinecalendar.mjs
//
// `today` is injected and every fixture date is an offset from it, so the
// fixtures do not rot with the calendar.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'deadlineCalendar.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/deadlineCalendar.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  logLevel: 'warning',
});

const {
  buildDeadlines, filterEvents, byDay, expiryWatch, monthGrid, monthSummary, parseMonth, monthKey,
  renewalOf, subRenewalOf, stateFor, contractBucket, contractAlertText, dayOf, CONTRACT_WARN_DAYS, ENDED_LOOKBACK_DAYS,
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
const ts = n => { const d = new Date(TODAY.getTime() + n * 86_400_000); return { toMillis: () => d.getTime(), toDate: () => d }; };

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ME = 'u-me', MONA = 'u-mona';

const opportunities = [
  { id: '--stats--', value: 9 },
  { id: 'o1', title: 'Meleiha compressor overhaul', client: 'AGIBA', stage: 'Bid Preparation', serialNumber: 'OP000011', submissionDeadline: off(4), ownerId: MONA, ownerName: 'Mona Fathy' },
  { id: 'o2', title: 'Gas plant revamp', client: 'Petrobel', stage: 'Submitted', serialNumber: 'OP000012', submissionDeadline: off(-20), decisionDate: off(10), ownerId: ME, ownerName: 'Tariq' },
  { id: 'o3', title: 'Won long ago', stage: 'Won', submissionDeadline: off(3), decisionDate: off(5) },
  { id: 'o4', title: 'Missed tender', stage: 'Identified', submissionDeadline: off(-2), ownerId: ME, collaboratorIds: [MONA] },
  { id: 'o5', title: 'No deadline yet', stage: 'Prequalification' },
  { id: 'o6', title: 'Under evaluation, no decision date', stage: 'Under Evaluation', submissionDeadline: off(-5) },
];
const projects = [
  { id: 'p1', name: 'Zohr tie-in', client: 'Petrobel', status: 'Active', endDate: off(45), serialNumber: 'PR000001' },
  { id: 'p2', name: 'Old job', client: 'AGIBA', status: 'Completed', endDate: off(5) },
  { id: 'p3', name: 'Paused job', client: 'GASCO', status: 'On Hold', endDate: off(-3) },
  { id: 'p4', name: 'Open-ended', status: 'Active' },
];
const contracts = [
  // Ends in 20 days, nothing after it → on the watch, ending.
  { id: 'c1', projectId: 'p1', type: 'contract', contractNumber: '4600001234', subject: 'O&M services', endDate: off(20), inCharge: 'Ahmed' },
  // Ended 10 days ago, not renewed, not closed → on the watch, ended.
  { id: 'c2', projectId: 'p1', type: 'work_authorization', contractNumber: 'WA-7', subject: 'Shutdown support', endDate: off(-10) },
  // Ended 15 days ago BUT an amendment under it runs to +200 → renewed, dropped.
  { id: 'c3', projectId: 'p1', type: 'contract', contractNumber: '4600003000', subject: 'Manpower supply', endDate: off(-15) },
  { id: 'c3a', projectId: 'p1', parentId: 'c3', type: 'amendment', amendmentNumber: '1', subject: 'Manpower supply — extension', endDate: off(200) },
  // Ends in 30 days, but another row with the SAME contract number runs later → renewed, not watched, still on the calendar.
  { id: 'c4', projectId: 'p1', type: 'agreement', contractNumber: 'AG-9', subject: 'Frame agreement', endDate: off(30) },
  { id: 'c4b', projectId: 'p1', type: 'agreement', contractNumber: 'ag-9 ', subject: 'Frame agreement 2', endDate: off(395) },
  // Closed status → nowhere.
  { id: 'c5', projectId: 'p1', type: 'contract', subject: 'Closed one', status: 'Closed', endDate: off(10) },
  { id: 'c5ar', projectId: 'p1', type: 'contract', subject: 'منتهي', status: 'منتهي', endDate: off(12) },
  // Project completed → nowhere.
  { id: 'c6', projectId: 'p2', type: 'contract', subject: 'Under completed project', endDate: off(10) },
  // Ended 120 days ago → stale, not watched; ended and unrenewed still shows on the calendar in its month.
  { id: 'c7', projectId: 'p1', type: 'contract', subject: 'Ancient', endDate: off(-120) },
  // Far future → on the calendar, not watched.
  { id: 'c8', projectId: 'p1', type: 'contract', subject: 'Long runner', endDate: off(300) },
  // Status says extended → renewed in place, not watched.
  { id: 'c9', projectId: 'p1', type: 'contract', subject: 'Extended in place', status: 'Extended', endDate: off(15) },
  // Unknown project (not loaded) → kept, and watched.
  { id: 'c10', projectId: 'p-missing', type: 'contract', subject: 'Orphan', endDate: off(0) },
  // No end date → nowhere.
  { id: 'c11', projectId: 'p1', type: 'contract', subject: 'Undated' },
  // Project on hold → still live.
  { id: 'c12', projectId: 'p3', type: 'contract', subject: 'On hold contract', endDate: off(60) },
  // Exactly 61 days → on the calendar, not yet watched.
  { id: 'c13', projectId: 'p1', type: 'contract', subject: 'Just outside', endDate: off(61) },
];
const subcontracts = [
  { id: 's1', projectId: 'p1', name: 'Al Nasr Scaffolding', typeOfService: 'Scaffolding', soOrContract: 'SO-55', expiryDate: off(7) },
  // Same subcontractor, later row → s2 renewed.
  { id: 's2', projectId: 'p1', name: 'Petrojet', expiryDate: off(-5) },
  { id: 's2b', projectId: 'p1', name: ' petrojet', expiryDate: off(360) },
  // Same name on ANOTHER project does not renew it.
  { id: 's3', projectId: 'p1', name: 'Enppi', expiryDate: off(-3) },
  { id: 's3x', projectId: 'p3', name: 'Enppi', expiryDate: off(400) },
  { id: 's4', projectId: 'p1', name: 'Cancelled sub', status: 'Cancelled', expiryDate: off(3) },
];
const tasks = [
  { id: 't1', taskName: 'Prepare price schedule', serialNumber: 'TK000001', status: 'In Progress', assignedTo: 'Tariq', assignedToId: ME, dueDate: off(0), opportunityTitle: 'Meleiha compressor overhaul' },
  { id: 't2', taskName: 'Done task', status: 'Done', assignedToId: ME, dueDate: off(1) },
  { id: 't3', taskName: 'Mona late task', status: 'Pending', assignedTo: 'Mona Fathy', assignedToId: MONA, dueDate: off(-1) },
  { id: 't4', taskName: 'Undated', status: 'Pending', assignedToId: ME },
  { id: 't5', taskName: 'Shared with me', status: 'Pending', assignedToId: MONA, collaboratorIds: [ME], dueDate: off(2) },
];
const correspondences = [
  { id: 'l1', subject: 'AGIBA asks for revised prices', serialNumber: 'CR000001', sentFrom: 'AGIBA', status: 'Unread', deadline: off(1), userId: ME },
  { id: 'l2', subject: 'Closed letter', status: 'Closed', deadline: off(1), userId: ME },
  { id: 'l3', subject: 'Mona’s letter', status: 'Assigned', assignedTo: 'Mona Fathy', assignedToId: MONA, deadline: off(8), userId: 'u-boss' },
];

const all = buildDeadlines({ tasks, correspondences, opportunities, projects, contracts, subcontracts }, TODAY);
const keys = all.map(e => e.key);
const get = k => all.find(e => e.key === k);

console.log('\n[1] what lands on the calendar');
eq(keys.includes('bid:o1:deadline'), true, 'bid in preparation → its submission deadline');
eq(keys.includes('bid:o2:decision'), true, 'submitted bid → its decision date');
eq(keys.includes('bid:o2:deadline'), false, 'submitted bid → NOT its old submission deadline');
eq(keys.some(k => k.startsWith('bid:o3')), false, 'won bid → nothing');
eq(get('bid:o4:deadline')?.state, 'late', 'a bid still open past its deadline is late');
eq(keys.some(k => k.startsWith('bid:o5') || k.startsWith('bid:o6')), false, 'bids with no relevant date → nothing');
eq(keys.includes('project:p1'), true, 'active project end');
eq(keys.includes('project:p2'), false, 'completed project → nothing');
eq(keys.includes('project:p3'), true, 'on-hold project end still shows');
eq(keys.includes('project:p4'), false, 'undated project → nothing');
eq(get('project:p3')?.state, 'late', 'an on-hold project past its end is late');
eq(['contract:c1', 'contract:c2', 'contract:c3a', 'contract:c4', 'contract:c4b', 'contract:c7', 'contract:c8', 'contract:c9', 'contract:c10', 'contract:c12', 'contract:c13'].every(k => keys.includes(k)), true, 'the live contracts are on the calendar');
eq(['contract:c3', 'contract:c5', 'contract:c5ar', 'contract:c6', 'contract:c11'].some(k => keys.includes(k)), false,
  'renewed-and-ended, closed (EN + AR), under a completed project, undated → not on the calendar');
eq(['sub:s1', 'sub:s2b', 'sub:s3', 'sub:s3x'].every(k => keys.includes(k)), true, 'live sub-contracts');
eq(['sub:s2', 'sub:s4'].some(k => keys.includes(k)), false, 'renewed-and-ended sub, cancelled sub → nothing');
eq(['task:t1', 'task:t3', 'task:t5'].every(k => keys.includes(k)), true, 'open dated tasks');
eq(['task:t2', 'task:t4'].some(k => keys.includes(k)), false, 'done / undated tasks → nothing');
eq(keys.includes('letter:l1') && keys.includes('letter:l3') && !keys.includes('letter:l2'), true, 'open letters with a deadline, not the closed one');
eq(keys.some(k => k.includes('--stats--')), false, 'the stats doc is never a date');

console.log('\n[2] each event carries what the screen needs');
const c1 = get('contract:c1');
eq([c1.kind, c1.group, c1.date, c1.daysLeft, c1.state], ['contract-end', 'contract', off(20), 20, 'later'], 'contract c1 kind/group/date/daysLeft/state');
eq([c1.title, c1.serial, c1.context, c1.owner], ['O&M services', '4600001234', 'Zohr tie-in · Petrobel', 'Ahmed'], 'contract c1 title/serial/project·client/in charge');
eq(c1.open, { type: 'project', id: 'p1', serial: 'PR000001', label: 'Zohr tie-in' }, 'a contract opens its project');
eq(c1.shared, true, 'contracts are department-wide');
eq(get('contract:c10').open, undefined, 'a contract whose project is unknown opens nothing');
eq(get('contract:c10').context, undefined, '…and has no project label');
const s1 = get('sub:s1');
eq([s1.kind, s1.title, s1.serial, s1.context], ['subcontract-end', 'Al Nasr Scaffolding', 'SO-55', 'Scaffolding · Zohr tie-in · Petrobel'], 'sub-contract fields');
const o1 = get('bid:o1:deadline');
eq([o1.title, o1.serial, o1.context, o1.owner, o1.ownerIds, o1.shared], ['Meleiha compressor overhaul', 'OP000011', 'AGIBA', 'Mona Fathy', [MONA], false], 'bid fields');
eq(o1.open, { type: 'opportunity', id: 'o1', serial: 'OP000011', label: 'Meleiha compressor overhaul' }, 'a bid opens itself');
eq(get('bid:o4:deadline').ownerIds, [ME, MONA], 'bid owner + collaborators');
eq(get('task:t1').context, 'Meleiha compressor overhaul', 'a task names the bid it belongs to');
eq(get('task:t5').ownerIds, [MONA, ME], 'task owner + collaborators');
eq(get('letter:l1').context, 'AGIBA', 'a letter names its sender');
eq(get('letter:l3').ownerIds, [MONA, 'u-boss'], 'a letter belongs to its assignee and whoever logged it');
eq(get('task:t1').state, 'today', 'due today');
eq(get('letter:l1').state, 'soon', 'due tomorrow is soon');
eq(get('letter:l3').state, 'later', '8 days is later');

console.log('\n[3] renewals');
eq(renewalOf(contracts.find(c => c.id === 'c3'), contracts), off(200), 'an amendment filed under it renews a contract');
eq(renewalOf(contracts.find(c => c.id === 'c4'), contracts), off(395), 'the same contract number (case/space-insensitive) renews it');
eq(renewalOf(contracts.find(c => c.id === 'c1'), contracts), '', 'nothing later → not renewed');
eq(renewalOf(contracts.find(c => c.id === 'c4b'), contracts), '', 'the renewal itself is not renewed by the older row');
eq(renewalOf({ id: 'x', projectId: 'p9', contractNumber: '4600001234', endDate: off(1) }, contracts), '', 'same number on ANOTHER project does not count');
eq(subRenewalOf(subcontracts.find(s => s.id === 's2'), subcontracts), off(360), 'same subcontractor later on the same project renews it');
eq(subRenewalOf(subcontracts.find(s => s.id === 's3'), subcontracts), '', 'same name on another project does not');
eq(get('contract:c4').renewedTo, off(395), 'the calendar row says what it was renewed to');
eq(get('contract:c4').watch, false, 'a renewed contract is not on the watch');
eq(get('contract:c9').watch, false, 'status "Extended" counts as renewed');
eq(get('contract:c9').renewedTo, undefined, '…with no separate date to show');

console.log('\n[4] the "running out" watch');
const w = expiryWatch(all);
eq(w.ending.map(e => e.key), ['contract:c10', 'sub:s1', 'contract:c1', 'contract:c12'], 'ending: nearest first (today, 7, 20, 60) — 61 days is not yet');
eq(w.ended.map(e => e.key), ['sub:s3', 'contract:c2'], 'ended, unrenewed, unclosed: most recent first — the 120-day one is stale');
eq(get('contract:c7').watch, false, `ended more than ${ENDED_LOOKBACK_DAYS} days ago → off the watch`);
eq(get('contract:c13').watch, false, `${CONTRACT_WARN_DAYS + 1} days out → not yet`);
eq(get('contract:c12').watch, true, `exactly ${CONTRACT_WARN_DAYS} days → on the watch`);
eq(get('contract:c8').watch, false, 'far future → no');
eq(w.ending.concat(w.ended).every(e => e.group === 'contract'), true, 'only contracts are ever watched');
const ew = expiryWatch(buildDeadlines({ tasks, correspondences, opportunities }, TODAY));
eq([ew.ending.length, ew.ended.length], [0, 0], 'no contracts loaded → an empty watch, no crash');

console.log('\n[5] filters and grouping');
const mine = filterEvents(all, { uid: ME, mineOnly: true, groups: 'all' });
const mk = mine.map(e => e.key);
eq(mk.includes('task:t1') && mk.includes('task:t5') && mk.includes('bid:o2:decision') && mk.includes('bid:o4:deadline') && mk.includes('letter:l1'), true, 'Mine keeps my own and co-owned records');
eq(mk.includes('task:t3') || mk.includes('bid:o1:deadline') || mk.includes('letter:l3'), false, 'Mine drops Mona’s records');
eq(mk.includes('contract:c1') && mk.includes('project:p1') && mk.includes('sub:s1'), true, 'Mine still shows the shared contract and project dates');
eq(filterEvents(all, { uid: ME, mineOnly: false, groups: ['contract'] }).every(e => e.group === 'contract'), true, 'a type chip keeps only its group');
eq(filterEvents(all, { uid: ME, mineOnly: false, groups: ['contract'] }).some(e => e.kind === 'subcontract-end'), true, 'Contracts include sub-contracts');
eq(filterEvents(all, { uid: ME, mineOnly: false, groups: ['bid'] }).map(e => e.kind).sort(), ['bid-deadline', 'bid-deadline', 'bid-decision'], 'Bids = deadlines + decisions');
eq(filterEvents(all, { uid: ME, mineOnly: false, groups: 'all' }).length, all.length, 'Everyone + All = everything');
const sorted = [...all].every((e, i, a) => i === 0 || a[i - 1].date <= e.date);
eq(sorted, true, 'events come sorted by date');
const same = buildDeadlines({
  opportunities: [{ id: 'z', title: 'Z tender', stage: 'Identified', submissionDeadline: off(3) }],
  tasks: [{ id: 'y', taskName: 'A task', status: 'Pending', dueDate: off(3) }],
  contracts: [{ id: 'x', projectId: 'p?', subject: 'M contract', endDate: off(3) }],
}, TODAY).map(e => e.kind);
eq(same, ['bid-deadline', 'contract-end', 'task-due'], 'within one day: tender, then contract, then task');
const bd = byDay(all);
eq(bd.get(off(0)).map(e => e.key).sort(), ['contract:c10', 'task:t1'], 'byDay groups today’s two');
eq([...bd.values()].reduce((n, l) => n + l.length, 0), all.length, 'byDay loses nothing');

console.log('\n[6] states and buckets');
eq([stateFor(-1), stateFor(0), stateFor(1), stateFor(7), stateFor(8)], ['late', 'today', 'soon', 'soon', 'later'], 'stateFor');
eq([contractBucket(61), contractBucket(60), contractBucket(31), contractBucket(30), contractBucket(15), contractBucket(14), contractBucket(8), contractBucket(7), contractBucket(1), contractBucket(0), contractBucket(-1), contractBucket(-30), contractBucket(-31)],
  [null, 'd60', 'd60', 'd30', 'd30', 'd14', 'd14', 'd7', 'd7', 'd0', 'ended', 'ended', null], 'contract countdown buckets');

console.log('\n[7] the alert text');
const fmtDay = d => `<${d}>`;
let a = contractAlertText(get('contract:c1'), fmtDay);
eq(a.title, '📄 Contract ends in 20 days', 'title 20 days');
ok(a.message.includes('4600001234 "O&M services"') && a.message.includes('(Zohr tie-in · Petrobel)') && a.message.includes(`<${off(20)}>`) && a.message.includes('in 20 days') && a.message.includes('Renew it, extend it with an amendment, or close it.'), `message 20 days — ${a.message}`);
a = contractAlertText(get('sub:s1'), fmtDay);
eq(a.title, '🟠 Sub-contract ends in 7 days', 'sub-contract title 7 days');
ok(a.message.includes('Renew it or close it.') && !a.message.includes('amendment'), `sub-contract action — ${a.message}`);
a = contractAlertText(get('contract:c10'), fmtDay);
eq(a.title, '🔴 Contract ends today', 'title today');
ok(a.message.startsWith('Contract "Orphan" ends today'), `no serial → just the title — ${a.message}`);
a = contractAlertText(get('contract:c2'), fmtDay);
eq(a.title, '🔴 Contract ended — not renewed', 'title ended');
ok(a.message.includes('10 days ago') && a.message.includes('nobody has renewed or closed it'), `message ended — ${a.message}`);
a = contractAlertText({ ...get('contract:c1'), daysLeft: 1 }, fmtDay);
eq(a.title, '🟠 Contract ends in 1 day', 'singular day');
a = contractAlertText({ ...get('contract:c1'), daysLeft: -1 }, fmtDay);
ok(a.message.includes('1 day ago'), `singular ago — ${a.message}`);
a = contractAlertText({ ...get('contract:c1'), serial: 'O&M services' }, fmtDay);
ok(!a.message.includes('"O&M services"'), 'serial equal to the title is not repeated');

console.log('\n[8] the month grid');
const g = monthGrid(2026, 8); // September 2026: the 1st is a Tuesday
eq(g[0][0].date, '2026-08-30', 'Sept 2026 starts on Sunday 30 Aug');
eq(g[0][2], { date: '2026-09-01', inMonth: true }, '1 Sept in the third column');
eq(g.every(w => w.length === 7), true, 'every week has 7 days');
eq(g.length, 5, 'Sept 2026 needs 5 weeks');
eq(g.flat().filter(d => d.inMonth).length, 30, '30 days in month');
eq(g[g.length - 1][6].date, '2026-10-03', 'ends on Saturday 3 Oct');
const f = monthGrid(2026, 1); // February 2026: the 1st is a Sunday, 28 days
eq([f.length, f[0][0].date, f[3][6].date], [4, '2026-02-01', '2026-02-28'], 'Feb 2026 is exactly 4 weeks');
eq(monthGrid(2026, 7).length, 6, 'Aug 2026 (1st on Saturday, 31 days) needs 6 weeks');
eq(monthGrid(2024, 1).flat().filter(d => d.inMonth).length, 29, 'leap February');
const dec = monthGrid(2026, 11);
eq(dec[dec.length - 1].some(d => d.date === '2027-01-02'), true, 'December spills into the next year');
eq(new Set(monthGrid(2026, 2).flat().map(d => d.date)).size, monthGrid(2026, 2).flat().length, 'March (DST month) has no duplicate day');
eq(new Set(monthGrid(2026, 9).flat().map(d => d.date)).size, monthGrid(2026, 9).flat().length, 'October (DST month) has no duplicate day');
eq(parseMonth('2026-10'), { year: 2026, month0: 9 }, 'parseMonth');
eq([parseMonth('2026-13'), parseMonth('garbage'), parseMonth(null)], [null, null, null], 'parseMonth rejects junk');
eq(monthKey(2026, 0), '2026-01', 'monthKey pads');

console.log('\n[9] month summary');
const ms = monthSummary(buildDeadlines({
  opportunities: [{ id: 'a', title: 'A', stage: 'Identified', submissionDeadline: '2026-09-05' }, { id: 'b', title: 'B', stage: 'Identified', submissionDeadline: '2026-10-05' }],
  contracts: [{ id: 'c', projectId: 'p', subject: 'C', endDate: '2026-09-20' }],
  subcontracts: [{ id: 's', projectId: 'p', name: 'S', expiryDate: '2026-09-21' }],
  tasks: [{ id: 't', taskName: 'T', status: 'Pending', dueDate: '2026-09-01' }],
}, new Date(2026, 8, 10, 12)), 2026, 8);
eq(ms, { count: 4, tenders: 1, contracts: 2, late: 2 }, 'September: 4 dates, 1 tender, 2 contract ends, 2 passed');

console.log('\n[10] dates in every shape');
eq(dayOf('2026-09-21'), '2026-09-21', 'yyyy-mm-dd');
eq(dayOf(new Date(2026, 8, 21, 23, 30)), '2026-09-21', 'a late-evening Date stays local');
eq(dayOf(ts(0)), off(0), 'a Timestamp');
eq(dayOf(''), '', 'empty');
eq(dayOf('not a date'), '', 'junk');
eq(buildDeadlines({ contracts: [{ id: 'q', projectId: 'p', subject: 'Q', endDate: '2026-09-21T00:00:00' }] }, new Date(2026, 8, 20, 12))[0]?.daysLeft, 1, 'an ISO date-time counts by its calendar day');
eq(buildDeadlines({}, TODAY), [], 'no input → no events, no crash');

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) {
  console.log('\nFAILED:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
