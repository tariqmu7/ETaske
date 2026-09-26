// Harness for src/lib/taskBoard.ts -> the Tasks page's Board view columns
// (Tidy Tasks T4).
//
// Bundles the REAL module with esbuild. No network, no Firebase.
//
//   node scripts/harness/taskboard.mjs

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'taskboard.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/taskBoard.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  logLevel: 'warning',
});

const B = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const ts = ms => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000), nanoseconds: 0 });
const ids = xs => xs.map(x => x.id);

// [1] stampMs reads every shape a date arrives in
eq(B.stampMs(ts(5000)), 5000, '[1] Firestore Timestamp');
eq(B.stampMs({ seconds: 3, nanoseconds: 500e6 }), 3500, '[1] plain {seconds, nanoseconds} (cache copy)');
eq(B.stampMs(new Date(7000)), 7000, '[1] Date');
eq(B.stampMs(9000), 9000, '[1] number');
eq(B.stampMs('2026-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'), '[1] ISO string');
eq(B.stampMs('junk'), 0, '[1] junk string = 0');
eq(B.stampMs(null), 0, '[1] null = 0');
eq(B.stampMs(undefined), 0, '[1] missing = 0');
eq(B.stampMs({ toMillis: () => { throw new Error('x'); } }), 0, '[1] a throwing toMillis = 0');
eq(B.stampMs(NaN), 0, '[1] NaN = 0');

// [2] finishedAt: completedAt, then archivedAt, then updatedAt, then createdAt
eq(B.finishedAt({ id: 'a', status: 'Done', completedAt: ts(4), updatedAt: ts(9) }), 4, '[2] completedAt wins');
eq(B.finishedAt({ id: 'a', status: 'Done', archivedAt: ts(5), updatedAt: ts(9) }), 5, '[2] then archivedAt');
eq(B.finishedAt({ id: 'a', status: 'Done', updatedAt: ts(9), createdAt: ts(1) }), 9, '[2] then updatedAt');
eq(B.finishedAt({ id: 'a', status: 'Done', createdAt: ts(1) }), 1, '[2] then createdAt');
eq(B.finishedAt({ id: 'a', status: 'Done' }), 0, '[2] nothing = 0');

// [3] columnOf
eq(B.columnOf('Pending'), 'Pending', '[3] Pending');
eq(B.columnOf('In Progress'), 'In Progress', '[3] In Progress');
eq(B.columnOf('Done'), 'Done', '[3] Done');
eq(B.columnOf('To Do'), 'Pending', '[3] an old value lands in Pending');
eq(B.columnOf(''), 'Pending', '[3] empty lands in Pending');

// [4] boardColumns
const tasks = [
  { id: 'p1', status: 'Pending' },
  { id: 'i1', status: 'In Progress' },
  { id: 'd1', status: 'Done', completedAt: ts(100) },
  { id: 'p2', status: 'To Do' },
  { id: 'd2', status: 'Done', updatedAt: ts(300) },
  { id: 'i2', status: 'In Progress' },
  { id: 'd3', status: 'Done', completedAt: ts(200) },
  { id: 'd4', status: 'Done', completedAt: ts(50) },
  { id: 'd5', status: 'Done', completedAt: ts(400) },
  { id: 'd6', status: 'Done', completedAt: ts(10) },
  { id: 'd7', status: 'Done' },
];
const c = B.boardColumns(tasks);
eq(ids(c.pending), ['p1', 'p2'], '[4] Pending keeps the incoming (urgency) order, old values included');
eq(ids(c.inProgress), ['i1', 'i2'], '[4] In Progress keeps the incoming order');
eq(ids(c.done), ['d5', 'd2', 'd3', 'd1', 'd4'], '[4] Done = latest finished first, 5 of them');
eq(c.doneTotal, 7, '[4] Done total counts all');
eq(c.doneHidden, 2, '[4] …and says how many are hidden');
const all = B.boardColumns(tasks, { showAllDone: true });
eq(ids(all.done), ['d5', 'd2', 'd3', 'd1', 'd4', 'd6', 'd7'], '[4] Show all = every finished task, undated last');
eq(all.doneHidden, 0, '[4] Show all hides nothing');
eq(ids(B.boardColumns(tasks, { doneLimit: 2 }).done), ['d5', 'd2'], '[4] limit is adjustable');
eq(B.boardColumns(tasks, { doneLimit: -1 }).done.length, 0, '[4] a negative limit shows none, never throws');
const none = B.boardColumns([]);
eq([none.pending.length, none.inProgress.length, none.done.length, none.doneTotal, none.doneHidden], [0, 0, 0, 0, 0], '[4] empty board');
const input = tasks.map(t => t.id).join();
B.boardColumns(tasks);
eq(tasks.map(t => t.id).join(), input, '[4] the input list is not reordered');
eq(B.boardColumns(tasks).pending.length + B.boardColumns(tasks).inProgress.length + B.boardColumns(tasks, { showAllDone: true }).done.length, tasks.length, '[4] no task lost or doubled');

// [5] dropStatus
eq(B.dropStatus('Pending', 'In Progress'), 'In Progress', '[5] Pending → In Progress');
eq(B.dropStatus('In Progress', 'Done'), 'Done', '[5] In Progress → Done');
eq(B.dropStatus('Done', 'Pending'), 'Pending', '[5] Done → Pending (reopen)');
eq(B.dropStatus('Pending', 'Pending'), null, '[5] dropped back on its own column = no write');
eq(B.dropStatus('To Do', 'Pending'), null, '[5] an old value shown in Pending, dropped on Pending = no write');
eq(B.dropStatus('To Do', 'In Progress'), 'In Progress', '[5] an old value can be moved on');
eq(B.dropStatus('Pending', 'Archived'), null, '[5] unknown column = no write');
eq(B.dropStatus('Pending', ''), null, '[5] empty column = no write');

console.log(`\n${pass}/${pass + fails.length} passed`);
for (const f of fails) console.log('  FAIL', f);
if (fails.length) process.exit(1);
