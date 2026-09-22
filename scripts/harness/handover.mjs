// Harness for src/lib/handover.ts -> the Handover file (queue D7).
//
// Bundles the REAL module with esbuild. Nothing touches the network or Firebase.
//
//   node scripts/harness/handover.mjs
//
// `today` is injected and every fixture date is an offset from it, so the
// fixtures do not rot with the calendar.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'handover.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/handover.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  logLevel: 'warning',
});

const {
  buildHandover, handoverSummary, canHandOver, handoverWrites, handoverNote, sameName, normName,
  NOTIFY_TYPE, ENDED_GRACE_DAYS, dayOf,
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

// ── Names ────────────────────────────────────────────────────────────────────
ok(sameName('Mona Fathy', 'mona  fathy'), 'case + spaces');
ok(sameName('Eng. Mona Fathy', 'Mona Fathy'), 'English title dropped');
ok(sameName('م. منى فتحي', 'منى فتحى'), 'Arabic title + ى/ي');
ok(sameName('المهندس أحمد علي حسن', 'احمد علي'), 'two-word name inside a longer Arabic name');
ok(sameName('Ahmed Ali Hassan', 'Ahmed Ali'), 'two-word name inside a longer name');
ok(!sameName('Ahmed', 'Ahmed Ali'), 'one word never matches a longer name');
ok(sameName('Ahmed', 'ahmed'), 'one word matches itself');
ok(!sameName('Ali Hassan', 'Ahmed Ali Hassanein'), 'word boundaries respected');
ok(!sameName('', 'Mona'), 'empty never matches');
ok(!sameName('Mona Fathy', 'Mona Farid'), 'different person');
ok(sameName('فاطمة الزهراء', 'فاطمه الزهراء'), 'ة/ه folded');
ok(sameName('مُنى فَتحي', 'منى فتحي'), 'harakat ignored');
eq(normName('Dr.  Sara—Nabil'), 'sara nabil', 'normName strips title and punctuation');

// ── Fixtures ─────────────────────────────────────────────────────────────────
const MONA = 'u-mona', SAMI = 'u-sami', BOSS = 'u-boss', EMP = 'u-emp';
const names = { [MONA]: 'Mona Fathy', [SAMI]: 'Sami Adel', [BOSS]: 'Boss', [EMP]: 'Hany' };
const mona = { id: MONA, name: 'Mona Fathy' };
const sami = { id: SAMI, name: 'Sami Adel' };

const tasks = [
  { id: '--stats--' },
  { id: 't1', taskName: 'Price schedule', serialNumber: 'TK1', status: 'In Progress', assignedToId: MONA, assignedTo: 'Mona Fathy', assignedById: BOSS, dueDate: off(-3), statusUpdate: 'Waiting for vendor quote', collaboratorIds: [SAMI, EMP], collaborators: ['Sami Adel', 'Hany'] },
  { id: 't2', taskName: 'Done one', status: 'Done', assignedToId: MONA },
  { id: 't3', taskName: 'Archived one', status: 'Archived', assignedToId: MONA },
  { id: 't4', taskName: 'Helping Sami', status: 'Pending', assignedToId: SAMI, assignedById: BOSS, collaboratorIds: [MONA, EMP], collaborators: ['Mona Fathy', 'Hany'], dueDate: off(5), notes: [{ text: 'first' }, { text: 'draft sent to Sami' }] },
  { id: 't5', taskName: 'Private of Mona', status: 'Pending', assignedToId: MONA, isPrivate: true },
  { id: 't6', taskName: 'Someone else', status: 'Pending', assignedToId: SAMI },
  { id: 't7', taskName: 'From letter', status: 'Pending', assignedToId: MONA, assignedById: BOSS },
];
const correspondences = [
  { id: 'l1', subject: 'AGIBA revised prices', serialNumber: 'CR1', status: 'Assigned', assignedToId: MONA, assignedTo: 'Mona Fathy', userId: BOSS, sentFrom: 'AGIBA', deadline: off(2), actions: 'Call their buyer', convertedToTaskId: 't7' },
  { id: 'l2', subject: 'Closed', status: 'Closed', assignedToId: MONA, userId: BOSS },
  { id: 'l3', subject: 'Logged by Mona, given to Sami', status: 'Assigned', assignedToId: SAMI, userId: MONA },
];
const opportunities = [
  { id: 'o1', title: 'Burgan tender', serialNumber: 'OP1', stage: 'Bid Preparation', ownerId: MONA, ownerName: 'Mona Fathy', client: 'Burgan', submissionDeadline: off(4), collaboratorIds: [SAMI], lastFollowUpText: 'Site visit done' },
  { id: 'o2', title: 'Submitted one', stage: 'Submitted', ownerId: SAMI, collaboratorIds: [MONA], decisionDate: off(-1) },
  { id: 'o3', title: 'Won one', stage: 'Won', ownerId: MONA },
  { id: 'o4', title: 'No stage yet', ownerId: MONA },
];
const projects = [
  { id: 'p1', name: 'AGIBA maintenance', client: 'AGIBA', status: 'Active' },
  { id: 'p2', name: 'Old job', client: 'X', status: 'Completed' },
];
const contracts = [
  { id: 'c1', projectId: 'p1', subject: 'Main contract', contractNumber: '4600001', inCharge: 'Eng. Mona Fathy', endDate: off(30), companyName: 'AGIBA', remarks: 'Renewal letter drafted' },
  { id: 'c2', projectId: 'p1', subject: 'Closed contract', inCharge: 'Mona Fathy', status: 'Closed' },
  { id: 'c3', projectId: 'p2', subject: 'Under finished project', inCharge: 'Mona Fathy' },
  { id: 'c4', projectId: 'p1', subject: 'Ended long ago', inCharge: 'Mona Fathy', endDate: off(-(ENDED_GRACE_DAYS + 5)) },
  { id: 'c5', projectId: 'p1', subject: 'Ended recently', inCharge: 'Mona Fathy', endDate: off(-10) },
  { id: 'c6', projectId: 'p1', subject: 'Other person', inCharge: 'Sami Adel' },
  { id: 'c7', projectId: 'missing', subject: 'Orphan', inCharge: 'Mona Fathy' },
  { id: 'c8', projectId: 'p1', subject: 'Just "Mona"', inCharge: 'Mona' },
];
const input = { tasks, correspondences, opportunities, contracts, projects };

// ── Building ────────────────────────────────────────────────────────────────
const items = buildHandover(input, mona, TODAY);
const keys = items.map(i => i.key);
eq(keys, ['task:t1', 'task:t4', 'task:t7', 'task:t5', 'letter:l1', 'bid:o2', 'bid:o1', 'bid:o4', 'contract:c5', 'contract:c1'],
  'file lists exactly the open items, grouped by kind, late first then by date');
const byKey = Object.fromEntries(items.map(i => [i.key, i]));
eq(byKey['task:t1'].role, 'owner', 't1 owner');
eq(byKey['task:t4'].role, 'collaborator', 't4 co-owner');
eq(byKey['task:t1'].late, true, 't1 late');
eq(byKey['task:t1'].lastNote, 'Waiting for vendor quote', 'status update is the note');
eq(byKey['task:t4'].lastNote, 'draft sent to Sami', 'last note when no status update');
eq(byKey['letter:l1'].party, 'AGIBA', 'letter party = sender');
eq(byKey['letter:l1'].lastNote, 'Call their buyer', 'letter note = actions');
eq(byKey['bid:o1'].due, off(4), 'bid before submit → submission deadline');
eq(byKey['bid:o2'].due, off(-1), 'submitted bid → decision date');
eq(byKey['bid:o2'].role, 'collaborator', 'o2 co-owner');
eq(byKey['bid:o4'].status, 'Identified', 'no stage = Identified');
eq(byKey['contract:c1'].project, 'AGIBA maintenance', 'contract carries its project');
eq(byKey['contract:c1'].role, 'in-charge', 'contract role');
eq(byKey['contract:c5'].late, true, 'recently ended contract is late');
ok(!keys.includes('contract:c8'), 'a bare first name does not claim a contract');

const s = handoverSummary(items);
eq(s, { total: 10, byKind: { task: 4, letter: 1, bid: 3, contract: 2 }, late: 3, shared: 2 }, 'summary');

// Another person's file; an unknown person has nothing.
eq(buildHandover(input, sami, TODAY).map(i => i.key),
  ['task:t1', 'task:t4', 'task:t6', 'letter:l3', 'bid:o2', 'bid:o1', 'contract:c6'], 'Sami file');
eq(buildHandover(input, { id: 'nobody', name: 'Nobody Here' }, TODAY), [], 'empty file');

// ── Permissions (mirror firestore.rules) ─────────────────────────────────────
const rec = id => [...tasks, ...correspondences, ...opportunities, ...contracts].find(r => r.id === id);
const item = k => byKey[k];
ok(canHandOver(item('task:t1'), rec('t1'), BOSS, true), 'manager moves public task');
ok(canHandOver(item('task:t1'), rec('t1'), MONA, false), 'owner moves own task');
ok(canHandOver(item('task:t1'), rec('t1'), EMP, false), 'collaborator moves task');
ok(!canHandOver(item('task:t1'), rec('t1'), 'u-stranger', false), 'stranger cannot');
ok(!canHandOver(item('task:t5'), rec('t5'), BOSS, true), 'manager cannot move a private task');
ok(canHandOver(item('task:t5'), rec('t5'), MONA, false), 'owner moves own private task');
ok(canHandOver({ kind: 'task' }, { assignedToId: SAMI, assignedById: EMP }, EMP, false), 'assigner moves public task');
ok(canHandOver(item('letter:l1'), rec('l1'), BOSS, true), 'manager moves letter');
ok(!canHandOver(item('letter:l1'), rec('l1'), MONA, false), 'assignee cannot move a letter someone else logged');
ok(canHandOver({ kind: 'letter' }, rec('l3'), MONA, false), 'the logger moves a letter');
ok(canHandOver(item('bid:o1'), rec('o1'), EMP, false), 'bids: any approved member');
ok(canHandOver(item('contract:c1'), rec('c1'), EMP, false), 'contracts: any approved member');
ok(!canHandOver(item('bid:o1'), null, BOSS, true), 'no record → no');

// ── Writes ──────────────────────────────────────────────────────────────────
const w = (k, to = sami, linked) => handoverWrites(item(k), rec(k.split(':')[1]), mona, to, names, linked);

eq(w('task:t1'), [{ collection: 'tasks', id: 't1', data: { assignedToId: SAMI, assignedTo: 'Sami Adel', collaboratorIds: [EMP], collaborators: ['Hany'] } }],
  'task owner move — new owner leaves the co-owner list');
eq(w('task:t4', { id: EMP, name: 'Hany' }), [{ collection: 'tasks', id: 't4', data: { collaboratorIds: [EMP], collaborators: ['Hany'] } }],
  'co-owner swap into someone already co-owning → no duplicate');
eq(w('task:t4', { id: BOSS, name: 'Boss' }), [{ collection: 'tasks', id: 't4', data: { collaboratorIds: [BOSS, EMP], collaborators: ['Boss', 'Hany'] } }],
  'co-owner swap keeps the position');
eq(w('task:t4', sami), [{ collection: 'tasks', id: 't4', data: { collaboratorIds: [EMP], collaborators: ['Hany'] } }],
  'co-owner handed to the owner → simply dropped');
eq(w('letter:l1', sami, rec('t7')), [
  { collection: 'correspondences', id: 'l1', data: { assignedToId: SAMI, assignedTo: 'Sami Adel' } },
  { collection: 'tasks', id: 't7', data: { assignedToId: SAMI, assignedTo: 'Sami Adel', collaboratorIds: [], collaborators: [] } },
], 'letter move takes its linked task along');
eq(w('letter:l1', sami, { ...rec('t7'), assignedToId: EMP }).length, 1, 'linked task with someone else stays');
eq(w('letter:l1', sami, { ...rec('t7'), status: 'Done' }).length, 1, 'finished linked task stays');
eq(w('letter:l1', sami, undefined).length, 1, 'no visible linked task → letter only');
eq(w('bid:o1'), [{ collection: 'opportunities', id: 'o1', data: { ownerId: SAMI, ownerName: 'Sami Adel', collaboratorIds: [] } }],
  'bid owner move');
eq(w('bid:o2', { id: EMP, name: 'Hany' }), [{ collection: 'opportunities', id: 'o2', data: { collaboratorIds: [EMP] } }], 'bid co-owner swap');
eq(w('contract:c1'), [{ collection: 'projectContracts', id: 'c1', data: { inCharge: 'Sami Adel' } }], 'contract in-charge rename');
eq(handoverWrites(item('task:t1'), rec('t1'), mona, mona, names), [], 'to yourself → nothing');
eq(handoverWrites(item('task:t1'), rec('t1'), mona, { id: '', name: '' }, names), [], 'no receiver → nothing');
eq(NOTIFY_TYPE, { task: 'task_assigned', letter: 'corresponding_assigned', bid: 'opportunity_assigned', contract: 'handover_received' }, 'notification types');
// Every handed-over item leaves the old file and appears in the new one.
{
  const after = JSON.parse(JSON.stringify(input));
  for (const it of items) {
    for (const wr of handoverWrites(it, [...after.tasks, ...after.correspondences, ...after.opportunities, ...after.contracts].find(r => r.id === it.id), mona, sami, names,
      after.tasks.find(t => t.id === 't7'))) {
      const list = { tasks: after.tasks, correspondences: after.correspondences, opportunities: after.opportunities, projectContracts: after.contracts }[wr.collection];
      Object.assign(list.find(r => r.id === wr.id), wr.data);
    }
  }
  eq(buildHandover(after, mona, TODAY).map(i => i.key), [], 'after "give everything" Mona has nothing left');
  const samiAfter = buildHandover(after, sami, TODAY).map(i => i.key);
  ok(['task:t1', 'task:t5', 'task:t7', 'letter:l1', 'bid:o1', 'bid:o4', 'contract:c1', 'contract:c5'].every(k => samiAfter.includes(k)), 'Sami now holds them');
  const t4 = after.tasks.find(t => t.id === 't4');
  eq(t4.collaboratorIds, [EMP], 'Sami did not become a co-owner of his own task');
}

// ── Note ────────────────────────────────────────────────────────────────────
const tx = (k, o = {}) => k.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n]));
const note = handoverNote(items, mona, tx, d => d, TODAY);
const lines = note.split('\n');
eq(lines[0], 'Handover file — Mona Fathy', 'note heading');
eq(lines[1], `As of ${off(0)}`, 'note date');
eq(lines[2], 'Open items: 10 · 3 late', 'note totals');
ok(lines.includes('Tasks (4)') && lines.includes('Letters (1)') && lines.includes('Bids (3)') && lines.includes('Contracts (2)'), 'note sections');
ok(lines.includes('1. TK1 — Price schedule'), 'numbered item with serial');
ok(note.includes(`Was due ${off(-3)}`), 'late date wording');
ok(note.includes('Co-owner'), 'co-owner marked');
ok(note.includes('Project: AGIBA maintenance'), 'contract project');
ok(note.includes('Where it stands: Renewal letter drafted'), 'where it stands');
eq(handoverNote([], mona, tx, d => d, TODAY).split('\n').length, 3, 'empty note is just the heading');
eq(dayOf('2026-01-05'), '2026-01-05', 'dayOf passthrough');

console.log(`handover: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
