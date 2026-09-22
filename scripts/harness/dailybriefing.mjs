// Harness for src/lib/dailyBriefing.ts — the once-a-day briefing message.
//
// Bundles the REAL module with esbuild, stubbing only the two things that need
// a browser/network: ./pushNotification (createNotification) and
// firebase/firestore (serverTimestamp). Everything under test — the buckets,
// the wording, the ten-line cap on the manager digest, the once-a-day ledger —
// is the actual shipping code.
//
// Every fixture date is RELATIVE (dayOffset), never a fixed calendar date.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'dailyBriefing.bundle.mjs');

const sent = [];

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
  entryPoints: [path.join(ROOT, 'src/lib/dailyBriefing.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  // src/utils.ts reads import.meta.env (Vite-only) at module load.
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  plugins: [stubPlugin],
  logLevel: 'warning',
});

// Minimal localStorage so the real ledger code runs unmodified.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.__sent = sent;

const {
  runDailyBriefing,
  buildPersonalBriefing,
  buildManagerDigest,
  bucketOf,
  whenLabel,
  isOpenItem,
  localDay,
} = await import(pathToFileURL(OUT).href);

// ── helpers ──────────────────────────────────────────────────────────────────
const iso = offsetDays => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let seq = 0;
const item = (kind, offsetDays, extra = {}) => {
  seq += 1;
  const prefix = kind === 'task' ? 'TK' : kind === 'corresponding' ? 'CR' : 'OP';
  return {
    id: `i${seq}`,
    kind,
    label: `${kind} ${seq}`,
    serial: `${prefix}${String(seq).padStart(6, '0')}`,
    due: offsetDays === null ? undefined : iso(offsetDays),
    status: kind === 'opportunity' ? 'Bid Preparation' : 'In Progress',
    mine: true,
    ...extra,
  };
};

const USERS = [
  { id: 'u1', displayName: 'Tariq', status: 'Approved', role: 'Manager' },
  { id: 'u2', displayName: 'Nevine', status: 'Approved', role: 'Employee' },
  { id: 'u3', displayName: 'Ahmed', status: 'Approved', role: 'Employee' },
];

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const reset = () => { store.clear(); sent.length = 0; seq = 0; };

// ── 1. buckets ───────────────────────────────────────────────────────────────
console.log('\n[1] buckets');
for (const [days, expect] of [
  [-30, 'late'], [-1, 'late'], [0, 'today'], [1, 'week'], [7, 'week'],
  [8, null], [60, null],
]) {
  check(`${days >= 0 ? '+' : ''}${days}d -> ${expect ?? 'nothing'}`,
    bucketOf(item('task', days)) === expect, String(bucketOf(item('task', days))));
}
check('no date -> nothing', bucketOf(item('task', null)) === null);

console.log('\n[2] "when" wording');
check('one day late is singular', whenLabel(item('task', -1)) === '1 day late', whenLabel(item('task', -1)));
check('three days late is plural', whenLabel(item('task', -3)) === '3 days late', whenLabel(item('task', -3)));
check('today', whenLabel(item('task', 0)) === 'due today');
check('tomorrow', whenLabel(item('task', 1)) === 'due tomorrow');
check('later in the week', whenLabel(item('task', 4)) === 'in 4 days');
check('no date says nothing', whenLabel(item('task', null)) === '');

console.log('\n[3] what counts as open');
for (const status of ['Done', 'Closed', 'Archived', 'Cancelled', 'No Bid', 'Won', 'Lost']) {
  check(`${status} is closed`, !isOpenItem(item('task', 0, { status })));
}
check('In Progress is open', isOpenItem(item('task', 0, { status: 'In Progress' })));
check('a missing status is open', isOpenItem(item('task', 0, { status: undefined })));

// ── 4. the personal briefing ─────────────────────────────────────────────────
console.log('\n[4] personal briefing');
reset();
let brief = buildPersonalBriefing([
  item('task', -3), item('task', 0), item('task', 0), item('corresponding', 0), item('opportunity', 2),
]);
check('headline counts today first', /^Good morning — 3 due today, 1 late and 1 bid closing this week\./.test(brief.body),
  brief.body.split('\n')[0]);
check('late section is listed', brief.body.includes('Late (1)'));
check('today section is listed', brief.body.includes('Today (3)'));
check('the week section is listed', brief.body.includes('Rest of the week (1)'));
check('bullets carry the serial', brief.body.includes('TK000001'));
check('bullets carry the countdown', brief.body.includes('3 days late'));
check('title is the day', brief.title === '☀️ Your day', brief.title);

reset();
brief = buildPersonalBriefing([item('task', -1)]);
check('one late item only says "1 late"', brief.body.startsWith('Good morning — 1 late.'), brief.body.split('\n')[0]);

reset();
check('nothing in range sends nothing', buildPersonalBriefing([item('task', 30), item('task', null)]) === null);
reset();
check('an empty board sends nothing', buildPersonalBriefing([]) === null);
reset();
check('somebody else\'s work is not my briefing',
  buildPersonalBriefing([item('task', 0, { mine: false })]) === null);
reset();
check('a Done record is not in my day',
  buildPersonalBriefing([item('task', -2, { status: 'Done' })]) === null);

reset();
brief = buildPersonalBriefing(Array.from({ length: 9 }, () => item('task', 0)));
check('at most five bullets per section', (brief.body.match(/^• /gm) || []).length === 5,
  String((brief.body.match(/^• /gm) || []).length));
check('the rest are counted, not listed', brief.body.includes('…and 4 more'), brief.body);

reset();
brief = buildPersonalBriefing([item('task', -1), item('task', -9), item('task', -4)]);
const order = brief.body.split('\n').filter(l => l.startsWith('•'));
check('longest late leads the list', order[0].includes('9 days late'), order[0]);
check('then the next longest', order[1].includes('4 days late'), order[1]);

// ── 5. the manager digest ────────────────────────────────────────────────────
console.log('\n[5] manager digest');
reset();
let digest = buildManagerDigest([
  item('task', -6, { ownerId: 'u2', ownerName: 'Nevine' }),
  item('task', -2, { ownerId: 'u2', ownerName: 'Nevine' }),
  item('task', 0, { ownerId: 'u3', ownerName: 'Ahmed' }),
  item('corresponding', 3, { ownerId: 'u3', ownerName: 'Ahmed' }),
  item('opportunity', 2, { ownerId: 'u3', ownerName: 'Ahmed' }),
  item('opportunity', 40, { ownerId: 'u2', ownerName: 'Nevine' }),
  item('task', 1, {}),
], USERS, 'Mon 21 Sep');
let lines = digest.body.split('\n');
check('line 1 is the date', lines[0] === 'Department briefing — Mon 21 Sep', lines[0]);
check('line 2 is the totals', lines[1] === '7 open · 2 late · 1 due today · 3 later this week', lines[1]);
check('bids get their own line', digest.body.includes('Bids: 2 open, 1 closing this week'), digest.body);
check('the nearest bid is named', /nearest OP000005/.test(digest.body), digest.body);
check('the longest late is listed', digest.body.includes('6 days late'));
check('late lines carry the owner', /\(Nevine\)/.test(digest.body), digest.body);
check('late is split by person', digest.body.includes('Late by person: Nevine 2'), digest.body);
check('the load is split by person', /Biggest load: Ahmed 3 · Nevine 3|Biggest load: Ahmed 3/.test(digest.body), digest.body);
check('unowned records are flagged', /1 open record has nobody on them/.test(digest.body), digest.body);
check('never more than ten lines', lines.length <= 10, String(lines.length));
check('title says department', digest.title === '📋 Department briefing', digest.title);

reset();
digest = buildManagerDigest(Array.from({ length: 40 }, (_, i) =>
  item('task', -(i + 1), { ownerId: 'u2', ownerName: 'Nevine' })), USERS, 'Mon 21 Sep');
check('a huge backlog is still ten lines', digest.body.split('\n').length <= 10,
  String(digest.body.split('\n').length));

reset();
digest = buildManagerDigest([item('opportunity', 40)], USERS, 'Mon 21 Sep');
check('an open pipeline with nothing closing says so',
  digest.body.includes('Bids: 1 open, none closing this week'), digest.body);

reset();
check('a department with nothing open sends nothing',
  buildManagerDigest([item('task', 0, { status: 'Done' })], USERS, 'Mon 21 Sep') === null);
reset();
digest = buildManagerDigest([item('task', 0, { mine: false, ownerId: 'u2' })], USERS, 'Mon 21 Sep');
check('the digest ignores "mine" — it is the whole board', digest !== null);
check('an owner with no denormalised name is read off the user list',
  digest.body.includes('Biggest load: Nevine 1'), digest.body);

// ── 6. once a day ────────────────────────────────────────────────────────────
console.log('\n[6] once a day');
const board = () => [
  item('task', -1, { mine: true, ownerId: 'u1', ownerName: 'Tariq' }),
  item('task', 0, { mine: false, ownerId: 'u2', ownerName: 'Nevine' }),
];

reset();
await runDailyBriefing({ uid: 'u1', isManager: false, users: USERS, items: board() });
check('an employee gets one message', sent.length === 1, String(sent.length));
check('and it is the personal one', sent[0].data.title === '☀️ Your day', sent[0].data.title);
await runDailyBriefing({ uid: 'u1', isManager: false, users: USERS, items: board() });
await runDailyBriefing({ uid: 'u1', isManager: false, users: USERS, items: board() });
check('repeat snapshots send nothing more', sent.length === 1, String(sent.length));

reset();
await runDailyBriefing({ uid: 'u1', isManager: true, users: USERS, items: board() });
check('a manager gets both messages', sent.length === 2, String(sent.length));
check('personal first', sent[0].data.title === '☀️ Your day', sent[0].data.title);
check('digest second', sent[1].data.title === '📋 Department briefing', sent[1].data.title);
await runDailyBriefing({ uid: 'u1', isManager: true, users: USERS, items: board() });
check('and only once a day', sent.length === 2, String(sent.length));

reset();
await runDailyBriefing({ uid: 'u1', isManager: false, users: USERS, items: board() });
await runDailyBriefing({ uid: 'u2', isManager: false, users: USERS, items: board() });
check('the ledger is per person', sent.length === 2, String(sent.length));

reset();
store.set('etaske:briefing:u1', JSON.stringify({ personal: '2020-01-01', manager: '2020-01-01' }));
await runDailyBriefing({ uid: 'u1', isManager: true, users: USERS, items: board() });
check('yesterday\'s stamp does not block today', sent.length === 2, String(sent.length));
const ledger = JSON.parse(store.get('etaske:briefing:u1'));
check('the ledger is stamped with today', ledger.personal === localDay(), JSON.stringify(ledger));
check('both halves are stamped', ledger.manager === localDay(), JSON.stringify(ledger));

reset();
await runDailyBriefing({ uid: 'u1', isManager: false, users: USERS, items: [] });
check('an empty day sends nothing', sent.length === 0, String(sent.length));
check('but the day is still stamped, so it stops re-checking',
  JSON.parse(store.get('etaske:briefing:u1') || '{}').personal === localDay(),
  store.get('etaske:briefing:u1'));

reset();
store.set('etaske:briefing:u1', 'not json');
await runDailyBriefing({ uid: 'u1', isManager: false, users: USERS, items: board() });
check('a corrupt ledger does not stop the briefing', sent.length === 1, String(sent.length));

// ── 7. the notification payload ──────────────────────────────────────────────
console.log('\n[7] payload');
reset();
await runDailyBriefing({ uid: 'u1', isManager: false, users: USERS, items: board() });
const n = sent[0].data;
check('type is the briefing type', n.type === 'daily_briefing', n.type);
check('it carries no relatedId', n.relatedId === undefined, String(n.relatedId));
check('addressed to the recipient', n.forUserId === 'u1', String(n.forUserId));
check('starts unread', n.read === false);
check('the user list is passed through for Telegram/FCM', sent[0].users === USERS);
check('no window means no link', sent[0].url === undefined, String(sent[0].url));

reset();
globalThis.window = { location: { origin: 'https://tariqmu7.github.io', pathname: '/ETaske/' } };
await runDailyBriefing({ uid: 'u1', isManager: false, users: USERS, items: board() });
check('the link opens "Needs you today"',
  sent[0].url === 'https://tariqmu7.github.io/ETaske/#/due-soon', String(sent[0].url));
delete globalThis.window;

console.log('\n[8] local day, not UTC');
check('localDay is the local calendar date',
  localDay(new Date(2026, 8, 21, 1, 30)) === '2026-09-21', localDay(new Date(2026, 8, 21, 1, 30)));
check('and pads single digits', localDay(new Date(2026, 0, 5, 23, 0)) === '2026-01-05',
  localDay(new Date(2026, 0, 5, 23, 0)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
