// Harness for src/lib/taskOrder.ts -> the Tasks board's reading order and the
// "Show N finished" fold (Tidy Tasks T2).
//
// Bundles the REAL module with esbuild. No network, no Firebase.
//
//   node scripts/harness/taskorder.mjs
//
// Dates are built relative to today (never a fixed calendar day).

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'taskorder.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/taskOrder.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  logLevel: 'warning',
});

const O = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const day = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const TODAY = day(0);

// [1] localToday is the LOCAL calendar day
eq(O.localToday(), TODAY, '[1] localToday = local date');
eq(O.localToday(new Date(2026, 0, 31, 23, 59)), '2026-01-31', '[1] late evening stays on its own day');

// [2] ranks
const r = (dueDate, status = 'Pending') => O.urgencyRank({ status, dueDate }, TODAY);
eq(r(day(-1)), 0, '[2] yesterday = late');
eq(r(day(-40)), 0, '[2] long ago = late');
eq(r(day(0)), 1, '[2] today = due soon (not late)');
eq(r(day(3)), 1, '[2] 3 days out = due soon');
eq(r(day(4)), 2, '[2] 4 days out = later');
eq(r(''), 3, '[2] no date = undated');
eq(r(undefined), 3, '[2] missing date = undated');
eq(r('someday'), 3, '[2] junk date = undated');
eq(r(day(-5), 'Done'), 4, '[2] finished, even when late, goes last');
eq(r(day(2), 'In Progress'), 1, '[2] In Progress counts as open');
eq(O.urgencyRank({ status: 'Pending', dueDate: day(6) }, TODAY, 7), 1, '[2] soon window is adjustable');
// month / year roll-over of the soon window
eq(O.urgencyRank({ status: 'Pending', dueDate: '2027-01-02' }, '2026-12-30'), 1, '[2] window crosses the new year');
eq(O.urgencyRank({ status: 'Pending', dueDate: '2027-01-03' }, '2026-12-30'), 2, '[2] …and stops after 3 days');

// [3] full order
const tasks = [
  { id: 'done-late', status: 'Done', dueDate: day(-10) },
  { id: 'undated-new', status: 'Pending', dueDate: '' },
  { id: 'later-20', status: 'Pending', dueDate: day(20) },
  { id: 'soon-2', status: 'In Progress', dueDate: day(2) },
  { id: 'late-1', status: 'Pending', dueDate: day(-1) },
  { id: 'done-new', status: 'Done', dueDate: day(5) },
  { id: 'later-5', status: 'Pending', dueDate: day(5) },
  { id: 'today', status: 'Pending', dueDate: day(0) },
  { id: 'late-9', status: 'In Progress', dueDate: day(-9) },
  { id: 'undated-old', status: 'Pending' },
];
const sorted = [...tasks].sort(O.byTaskUrgency(TODAY)).map(t => t.id);
eq(sorted, ['late-9', 'late-1', 'today', 'soon-2', 'later-5', 'later-20', 'undated-new', 'undated-old', 'done-late', 'done-new'],
  '[3] late (oldest first) → soon → later → undated → finished, incoming order kept for ties');

// [4] priority breaks a tie on the same date; equal priority keeps incoming order
const same = [
  { id: 'a-low', status: 'Pending', dueDate: day(1), priority: 'Low' },
  { id: 'b-med', status: 'Pending', dueDate: day(1), priority: 'Medium' },
  { id: 'c-urgent', status: 'Pending', dueDate: day(1), priority: 'Urgent' },
  { id: 'd-none', status: 'Pending', dueDate: day(1) },
  { id: 'e-high', status: 'Pending', dueDate: day(1), priority: 'High' },
];
eq([...same].sort(O.byTaskUrgency(TODAY)).map(t => t.id), ['c-urgent', 'e-high', 'b-med', 'd-none', 'a-low'],
  '[4] Urgent > High > Medium (and unset) > Low');
const undatedPrio = [
  { id: 'u1', status: 'Pending', priority: 'Low' },
  { id: 'u2', status: 'Pending', priority: 'Urgent' },
];
eq([...undatedPrio].sort(O.byTaskUrgency(TODAY)).map(t => t.id), ['u2', 'u1'], '[4] priority also orders undated work');
const donePrio = [
  { id: 'd1', status: 'Done', priority: 'Low' },
  { id: 'd2', status: 'Done', priority: 'Urgent' },
];
eq([...donePrio].sort(O.byTaskUrgency(TODAY)).map(t => t.id), ['d1', 'd2'], '[4] finished rows keep newest-first, priority ignored');
eq([...same].sort(O.byTaskUrgency(TODAY)).length, 5, '[4] nothing lost');

// [5] fold
const list = [
  { id: 'o1', status: 'Pending' },
  { id: 'd1', status: 'Done' },
  { id: 'o2', status: 'In Progress' },
  { id: 'd2', status: 'Done' },
  { id: 'd3', status: 'Done' },
];
let f = O.foldFinished(list, false);
eq(f.visible.map(t => t.id), ['o1', 'o2'], '[5] finished folded away');
eq(f.hidden, 3, '[5] hidden count');
f = O.foldFinished(list, true);
eq([f.visible.length, f.hidden], [5, 0], '[5] shown when asked for');
f = O.foldFinished(list, false, ['d2', null, undefined]);
eq(f.visible.map(t => t.id), ['o1', 'o2', 'd2'], '[5] the open / linked task stays in place');
eq(f.hidden, 2, '[5] …and is not counted as hidden');
f = O.foldFinished(list.filter(t => t.status === 'Done'), false);
eq([f.visible.length, f.hidden], [3, 0], '[5] an all-finished list (Done group / Done filter) is never folded');
f = O.foldFinished([], false);
eq([f.visible.length, f.hidden], [0, 0], '[5] empty list');
ok(O.foldFinished(list, true).visible !== list, '[5] never hands back the caller\'s array');

console.log(`taskorder: ${pass}/${pass + fails.length} passed`);
if (fails.length) {
  for (const x of fails) console.log('  FAIL ' + x);
  process.exit(1);
}
