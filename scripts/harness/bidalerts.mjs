// Harness for src/lib/dueAlerts.ts -> runBidDeadlineAlerts.
//
// Bundles the REAL module with esbuild, stubbing only the two things that need
// a browser/network: ./pushNotification (createNotification) and
// firebase/firestore (serverTimestamp). Everything under test — the bucket
// thresholds, the ledger dedupe, the daily budget, the headline wording — is
// the actual shipping code.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// esbuild is resolved from the repo, since this file is run with a bare `node`.
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'dueAlerts.bundle.mjs');

const sent = [];

const stubPlugin = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /pushNotification$/ }, () => ({ path: 'stub-push', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'stub-fs', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-push'
        ? `export async function createNotification(data, users) { globalThis.__sent.push({ data, users }); }
           export async function pushTelegram() {}
           export async function checkTelegramLink() { return null; }
           export async function notifyManagers() {}
           export function pushAnnouncement() {}`
        : `export function serverTimestamp() { return '<serverTimestamp>'; }`,
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [path.join(ROOT, 'src/lib/dueAlerts.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  // src/utils.ts reads import.meta.env (Vite-only) at module load.
  define: { 'import.meta.env': '__VITE_ENV__' },
  inject: [],
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

const { runBidDeadlineAlerts } = await import(pathToFileURL(OUT).href);

// ── helpers ──────────────────────────────────────────────────────────────────
const iso = offsetDays => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const bid = (id, offsetDays, extra = {}) => ({
  opportunity: {
    id,
    title: `Bid ${id}`,
    serialNumber: `OP${id.padStart(6, '0')}`,
    stage: 'Bid Preparation',
    client: 'EGPC',
    submissionDeadline: offsetDays === null ? undefined : iso(offsetDays),
    ...extra,
  },
  value: '1,000,000 EGP',
});

const USERS = [{ id: 'u1', displayName: 'Tariq', status: 'Approved', role: 'Manager' }];

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const reset = () => { store.clear(); sent.length = 0; };
const titles = () => sent.map(s => s.data.title);
const msgs = () => sent.map(s => s.data.message);

// ── 1. one bucket per countdown position ─────────────────────────────────────
console.log('\n[1] bucket thresholds');
for (const [days, expect] of [
  [7, '🗓️ Bid deadline in a week'],
  [5, '🗓️ Bid deadline in a week'],
  [4, '🗓️ Bid deadline in a week'],
  [3, '🟠 Bid deadline in 3 days'],
  [2, '🟠 Bid deadline in 3 days'],
  [1, '⏰ Bid deadline tomorrow'],
  [0, '🔴 Bid due today'],
  [-1, '🔴 Bid deadline passed'],
  [-14, '🔴 Bid deadline passed'],
]) {
  reset();
  await runBidDeadlineAlerts('u1', USERS, [bid('1', days)]);
  check(`${days >= 0 ? '+' : ''}${days}d -> ${expect}`, titles()[0] === expect, `got ${titles()[0] ?? 'nothing'}`);
}

console.log('\n[2] out of range = silence');
for (const days of [8, 30, -15, -60]) {
  reset();
  await runBidDeadlineAlerts('u1', USERS, [bid('1', days)]);
  check(`${days}d raises nothing`, sent.length === 0, `sent ${sent.length}`);
}
reset();
await runBidDeadlineAlerts('u1', USERS, [bid('1', null)]);
check('no deadline raises nothing', sent.length === 0);

// ── 3. dedupe ────────────────────────────────────────────────────────────────
console.log('\n[3] dedupe & bucket transitions');
reset();
await runBidDeadlineAlerts('u1', USERS, [bid('1', 3)]);
await runBidDeadlineAlerts('u1', USERS, [bid('1', 3)]);
await runBidDeadlineAlerts('u1', USERS, [bid('1', 3)]);
check('same bucket alerts once per day', sent.length === 1, `sent ${sent.length}`);

reset();
await runBidDeadlineAlerts('u1', USERS, [bid('1', 3)]);
await runBidDeadlineAlerts('u1', USERS, [bid('1', 1)]);   // countdown moved on
await runBidDeadlineAlerts('u1', USERS, [bid('1', 0)]);
check('each new bucket alerts again', sent.length === 3, `sent ${sent.length}`);

reset();
await runBidDeadlineAlerts('u2', USERS, [bid('1', 3)]);
await runBidDeadlineAlerts('u3', USERS, [bid('1', 3)]);
check('ledger is per recipient', sent.length === 2, `sent ${sent.length}`);

// ── 4. budgets ───────────────────────────────────────────────────────────────
console.log('\n[4] budgets');
reset();
const many = Array.from({ length: 30 }, (_, i) => bid(`b${i}`, 2));
await runBidDeadlineAlerts('u1', USERS, many);
check('MAX_BIDS_PER_RUN caps one snapshot at 4', sent.length === 4, `sent ${sent.length}`);
for (let i = 0; i < 20; i++) await runBidDeadlineAlerts('u1', USERS, many);
check('MAX_BIDS_PER_DAY caps the day at 12', sent.length === 12, `sent ${sent.length}`);

// The point of the separate budget: a task backlog must not starve bids.
reset();
const ledgerKey = 'etaske:duealert:u1';
const today = new Date().toISOString().slice(0, 10);
store.set(ledgerKey, JSON.stringify({ __count: `${today}:25` })); // task budget exhausted
await runBidDeadlineAlerts('u1', USERS, [bid('1', 0)]);
check('a spent task budget does not block a bid alert', sent.length === 1, `sent ${sent.length}`);

// ── 5. ledger hygiene ────────────────────────────────────────────────────────
console.log('\n[5] ledger hygiene');
reset();
store.set(ledgerKey, JSON.stringify({ 'old:bid:d0': '2020-01-01', __bidcount: '2020-01-01:12' }));
await runBidDeadlineAlerts('u1', USERS, [bid('1', 0)]);
const ledger = JSON.parse(store.get(ledgerKey));
check('yesterday\'s entries are pruned', !('old:bid:d0' in ledger), JSON.stringify(ledger));
check('stale budget resets (alert still sent)', sent.length === 1, `sent ${sent.length}`);
check('bid key is namespaced', Object.keys(ledger).some(k => k.includes(':bid:')), JSON.stringify(ledger));

// ── 6. payload ───────────────────────────────────────────────────────────────
console.log('\n[6] notification payload');
reset();
await runBidDeadlineAlerts('u1', USERS, [bid('1', 0, { ownerId: 'u1', ownerName: 'Tariq', tenderNumber: 'T-99', scope: 'Turnaround' })]);
const n = sent[0].data;
check('type routes the deep link', n.type === 'opportunity_deadline', n.type);
check('relatedId is the opportunity id', n.relatedId === '1', String(n.relatedId));
check('addressed to the recipient', n.forUserId === 'u1', String(n.forUserId));
check('starts unread', n.read === false);
check('owner reads "Your bid"', n.message.startsWith('Your bid "Bid 1"'), n.message.split('\n')[0]);
check('carries the value', n.message.includes('1,000,000 EGP'));
check('carries the tender number', n.message.includes('T-99'));
check('carries the serial', n.message.includes('OP000001'));

reset();
await runBidDeadlineAlerts('mgr', USERS, [bid('1', 0, { ownerId: 'u1', ownerName: 'Nevin' })]);
check('manager reads the owner\'s name', msgs()[0].startsWith('Nevin\'s bid "Bid 1"'), msgs()[0].split('\n')[0]);

reset();
await runBidDeadlineAlerts('mgr', USERS, [bid('1', 0, {})]);
check('unowned bid is never called "Your bid"', msgs()[0].startsWith('The unassigned bid "Bid 1"'), msgs()[0].split('\n')[0]);

reset();
await runBidDeadlineAlerts('mgr', USERS, [bid('1', 0, { ownerId: 'u1' })]);
check('owned-but-unnamed bid is not called "Your bid"', msgs()[0].startsWith('A team bid "Bid 1"'), msgs()[0].split('\n')[0]);

reset();
await runBidDeadlineAlerts('u1', USERS, [bid('1', -3, { ownerId: 'u1' })]);
check('past-due headline asks for a decision',
  /passed its submission deadline 3 days ago and is still open/.test(msgs()[0]), msgs()[0].split('\n')[0]);

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
fs.rmSync(OUT, { force: true });
process.exit(fail ? 1 : 0);
