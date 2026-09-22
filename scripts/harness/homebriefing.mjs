// Harness for src/lib/homeBriefing.ts — the sentences at the top of Home (queue E1).
//
// Bundles the REAL module (and the real dailyBriefing / offerApproval /
// deadlineCalendar it builds on) with esbuild, stubbing only what needs a
// browser: ./pushNotification and firebase/firestore. Every fixture date is
// RELATIVE (dayOffset), never a fixed calendar date.
//
//   node scripts/harness/homebriefing.mjs

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'homeBriefing.bundle.mjs');

const stubPlugin = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /pushNotification$/ }, () => ({ path: 'stub-push', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'stub-fs', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-push'
        ? `export async function createNotification() {}`
        : `export function serverTimestamp() { return '<ts>'; }`,
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [path.join(ROOT, 'src/lib/homeBriefing.ts')],
  bundle: true, format: 'esm', platform: 'neutral', outfile: OUT,
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  plugins: [stubPlugin],
  logLevel: 'warning',
});

const { buildHomeBriefing } = await import(pathToFileURL(OUT).href + `?v=${Date.now()}`);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const dayOffset = n => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ME = 'u-me', AHMED = 'u-ahmed', MONA = 'u-mona';
const task = (id, due, extra = {}) => ({ id, taskName: `Task ${id}`, serialNumber: `TK${id}`, dueDate: due, status: 'In Progress', assignedToId: ME, assignedTo: 'Me', ...extra });
const letter = (id, due, extra = {}) => ({ id, subject: `Letter ${id}`, serialNumber: `CR${id}`, deadline: due, status: 'Assigned', assignedToId: ME, assignedTo: 'Me', ...extra });
const bid = (id, due, extra = {}) => ({ id, title: `Bid ${id}`, serialNumber: `OP${id}`, submissionDeadline: due, stage: 'Bid Preparation', ownerId: ME, ...extra });

const base = { uid: ME, isManager: false, tasks: [], correspondences: [], opportunities: [] };
const keys = lines => lines.map(l => l.key).join(',');
const line = (lines, k) => lines.find(l => l.key === k);

console.log('\n[1] nothing to say → no lines');
check('empty boards give an empty briefing', buildHomeBriefing(base).length === 0);
check('far-off and undated work says nothing',
  buildHomeBriefing({ ...base, tasks: [task('1', dayOffset(20)), task('2', undefined)], opportunities: [bid('1', dayOffset(30))] }).length === 0);
check('--stats-- docs are ignored',
  buildHomeBriefing({ ...base, tasks: [{ id: '--stats--', dueDate: dayOffset(-5), status: 'In Progress', assignedToId: ME }] }).length === 0);

console.log('\n[2] late and today — tasks and letters together');
let L = buildHomeBriefing({
  ...base,
  tasks: [task('1', dayOffset(-2)), task('2', dayOffset(-9)), task('3', dayOffset(0)), task('4', dayOffset(-4), { status: 'Done' })],
  correspondences: [letter('1', dayOffset(-1)), letter('2', dayOffset(0), { status: 'Closed' })],
});
check('late counts open tasks + letters (3), not the Done one', line(L, 'late')?.count === 3, JSON.stringify(line(L, 'late')));
check('★ late names the LONGEST late first', line(L, 'late')?.lead?.serial === 'TK2' && line(L, 'late')?.lead?.days === -9, JSON.stringify(line(L, 'late')?.lead));
check('today counts 1 (closed letter left out)', line(L, 'today')?.count === 1);
check('late is an alert, today a warning', line(L, 'late')?.tone === 'alert' && line(L, 'today')?.tone === 'warn');
check('both open "Needs you today"', line(L, 'late')?.view === 'due-soon' && line(L, 'today')?.view === 'due-soon');
check('order: late before today', keys(L) === 'late,today', keys(L));

console.log('\n[3] scope — an employee sees only their own; a manager the department');
const dept = {
  tasks: [task('1', dayOffset(-3)), task('2', dayOffset(-5), { assignedToId: AHMED, assignedTo: 'Ahmed' }),
    task('3', dayOffset(-6), { assignedToId: AHMED, assignedTo: 'Ahmed' }), task('4', dayOffset(-1), { assignedToId: MONA, assignedTo: 'Mona', collaboratorIds: [ME] })],
  correspondences: [letter('1', dayOffset(-2), { assignedToId: MONA, assignedTo: 'Mona' })],
  opportunities: [bid('1', dayOffset(3), { ownerId: AHMED }), bid('2', dayOffset(5))],
};
L = buildHomeBriefing({ ...base, ...dept });
check('employee: own + collaborator tasks only (2)', line(L, 'late')?.count === 2, JSON.stringify(line(L, 'late')));
check('employee: no "most with" person', !line(L, 'late')?.topPerson);
check('employee: only their own bid closes this week', line(L, 'bids')?.count === 1 && line(L, 'bids')?.lead?.serial === 'OP2');
check('employee: no manager lines', !line(L, 'review') && !line(L, 'signoff') && !line(L, 'contracts'));
const M = buildHomeBriefing({ ...base, ...dept, isManager: true });
check('manager: every late item in the department (5)', line(M, 'late')?.count === 5, JSON.stringify(line(M, 'late')));
check('★ manager: most of it sits with Ahmed (2)', line(M, 'late')?.topPerson?.name === 'Ahmed' && line(M, 'late')?.topPerson?.count === 2, JSON.stringify(line(M, 'late')?.topPerson));
check('manager: both bids, nearest first', line(M, 'bids')?.count === 2 && line(M, 'bids')?.lead?.serial === 'OP1' && line(M, 'bids')?.lead?.days === 3);
check('one person with one item is not a "load"',
  !line(buildHomeBriefing({ ...base, isManager: true, tasks: [task('1', dayOffset(-1), { assignedToId: AHMED, assignedTo: 'Ahmed' }), task('2', dayOffset(-1), { assignedToId: MONA, assignedTo: 'Mona' })] }), 'late')?.topPerson);
check('an owner known only by id is named from userNames',
  line(buildHomeBriefing({ ...base, isManager: true, userNames: { [AHMED]: 'Ahmed Samir' }, tasks: [task('1', dayOffset(-1), { assignedToId: AHMED, assignedTo: '' }), task('2', dayOffset(-2), { assignedToId: AHMED, assignedTo: '' })] }), 'late')?.topPerson?.name === 'Ahmed Samir');

console.log('\n[4] tenders');
L = buildHomeBriefing({ ...base, opportunities: [bid('1', dayOffset(0)), bid('2', dayOffset(7)), bid('3', dayOffset(8)), bid('4', dayOffset(-2)), bid('5', dayOffset(2), { stage: 'Submitted' }), bid('6', dayOffset(1), { stage: 'Lost' })] });
check('★ today..7 days, still-to-send bids only (2) — Submitted and Lost left out', line(L, 'bids')?.count === 2, JSON.stringify(line(L, 'bids')));
check('a passed deadline is not "closing this week"', line(L, 'bids')?.lead?.serial === 'OP1');
check('tenders open the Opportunities board', line(L, 'bids')?.view === 'opportunities');

console.log('\n[5] offer sign-off (managers only)');
const now = Date.now();
const asked = (id, daysAgo, extra = {}) => bid(id, dayOffset(20), { approval: { status: 'requested', amount: 100, currency: 'EGP', requestedByName: `Asker ${id}`, requestedAt: now - daysAgo * 86400000 }, estimatedValue: 100, currency: 'EGP', ...extra });
const sign = { opportunities: [asked('1', 1), asked('2', 4), asked('3', 2, { stage: 'Submitted' })] };
L = buildHomeBriefing({ ...base, ...sign, isManager: true });
check('two pre-send offers wait (the submitted one does not)', line(L, 'signoff')?.count === 2, JSON.stringify(line(L, 'signoff')));
check('★ the OLDEST request leads, with who asked', line(L, 'signoff')?.lead?.serial === 'OP2' && line(L, 'signoff')?.lead?.owner === 'Asker 2');
check('employees never get the sign-off line', !line(buildHomeBriefing({ ...base, ...sign }), 'signoff'));

console.log('\n[6] mail from the Outlook helper');
check('no helper → no mail line', !line(buildHomeBriefing({ ...base, mail: null }), 'mail'));
check('helper with nothing waiting → no mail line', !line(buildHomeBriefing({ ...base, mail: { awaitingUs: 0, awaitingThem: 0 } }), 'mail'));
L = buildHomeBriefing({ ...base, mail: { awaitingUs: 5, awaitingThem: 2 } });
check('5 waiting on us, 2 on them', line(L, 'mail')?.count === 5 && line(L, 'mail')?.second === 2 && line(L, 'mail')?.view === 'waiting');
L = buildHomeBriefing({ ...base, mail: { awaitingUs: 0, awaitingThem: 3 } });
check('only "no answer yet" mail → an info line with count 0', line(L, 'mail')?.count === 0 && line(L, 'mail')?.second === 3 && line(L, 'mail')?.tone === 'info');

console.log('\n[7] letters to review + contracts running out (managers)');
const mgrOnly = {
  correspondences: [letter('1', undefined, { status: 'Unread', assignedToId: '' }), letter('2', undefined, { status: 'Reviewing', assignedToId: '' }), letter('3', undefined, { status: 'Assigned' })],
  projects: [{ id: 'p1', name: 'Meleiha', client: 'AGIBA', status: 'Active' }, { id: 'p2', name: 'Old job', status: 'Completed' }],
  contracts: [
    { id: 'c1', projectId: 'p1', subject: 'Tank cleaning', contractNumber: 'C-11', endDate: dayOffset(40), status: 'Active' },
    { id: 'c2', projectId: 'p1', subject: 'Inspection', contractNumber: 'C-12', endDate: dayOffset(12), status: 'Active' },
    { id: 'c3', projectId: 'p1', subject: 'Far off', contractNumber: 'C-13', endDate: dayOffset(200), status: 'Active' },
    { id: 'c4', projectId: 'p1', subject: 'Closed one', contractNumber: 'C-14', endDate: dayOffset(5), status: 'Closed' },
  ],
  subcontracts: [],
};
L = buildHomeBriefing({ ...base, ...mgrOnly, isManager: true });
check('2 letters wait for review (Unread + Reviewing)', line(L, 'review')?.count === 2 && line(L, 'review')?.view === 'correspondences');
check('2 contracts run out within 60 days (closed + far-off left out)', line(L, 'contracts')?.count === 2, JSON.stringify(line(L, 'contracts')));
check('★ the nearest contract leads, with its project', line(L, 'contracts')?.lead?.days === 12 && /Inspection/.test(line(L, 'contracts')?.lead?.label || ''), JSON.stringify(line(L, 'contracts')?.lead));
check('contracts open the Calendar', line(L, 'contracts')?.view === 'calendar');
check('no contract data passed → no contract line', !line(buildHomeBriefing({ ...base, correspondences: mgrOnly.correspondences, isManager: true }), 'contracts'));
check('employees get no review / contract lines', !line(buildHomeBriefing({ ...base, ...mgrOnly }), 'review') && !line(buildHomeBriefing({ ...base, ...mgrOnly }), 'contracts'));

console.log('\n[8] the whole order, most urgent first');
L = buildHomeBriefing({
  ...base, isManager: true, mail: { awaitingUs: 1, awaitingThem: 0 },
  tasks: [task('1', dayOffset(-1)), task('2', dayOffset(0))],
  correspondences: mgrOnly.correspondences,
  opportunities: [bid('9', dayOffset(3)), asked('1', 2)],
  projects: mgrOnly.projects, contracts: mgrOnly.contracts, subcontracts: [],
});
check('late, today, signoff, bids, mail, review, contracts', keys(L) === 'late,today,signoff,bids,mail,review,contracts', keys(L));

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
