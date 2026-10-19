// Click-through harness for the BD control page (queues E5a + E5b charts 3–6 + E5c charts 7–12).
//
// Proves src/BdControlDashboard.tsx + src/lib/bdControl.ts + src/hooks/useBdControl.ts
// in real Edge: the pure maths (days, flags, live/EGP rules, millions, edits since
// load), every KPI tile worked out from rows as of today, the data-date strip
// (loaded by, edits since load, stale warning), figures following a change in the
// rows with no reload, charts 3–6 (ceilings, renewal timeline, day-rate vs
// ANOPC/median with grade chips, reprice list), charts 7–12 (supplier cost, amendment growth, AGIBA SOs,
// report-to-report changes, data issues per sheet, awaited data flipping as it arrives), the empty and
// permission-denied states, the role gate and the 6 nav entries, Arabic + RTL, a 390 px phone and dark
// mode. The page writes nothing.
// The rows are MADE UP — the real data must never be in this public repo.
//
//   node scripts/harness/bdcontrolui.mjs   (--headed to watch it, --shot to write PNGs)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { FIRESTORE_STUB } from './fakeFirestore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-bdcontrolui-'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

// The page listens to a DOC (bdControl/meta) as well as collections: the shared
// stub only knows collections, so a doc ref gets a doc snapshot here. A collection
// named in __denied answers with permission-denied, as the rules do for an employee.
const HOOK = 'export function onSnapshot(q, next, _err) {';
const STUB = FIRESTORE_STUB.replace(HOOK, `${HOOK}
  if (globalThis.__denied && globalThis.__denied.has(q.__coll)) { Promise.resolve().then(() => _err({ code: "permission-denied" })); return () => {}; }
  if (q && q.id !== undefined && !q.__cs) {
    const fire = () => { const d = coll(q.__coll).get(q.id); next({ id: q.id, exists: () => d !== undefined, data: () => (d ? { ...d } : undefined) }); };
    const l = { q: { __coll: '__doc__', __cs: [] }, next: () => fire() };
    listeners.push(l);
    Promise.resolve().then(fire);
    return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  }`);
if (STUB === FIRESTORE_STUB) throw new Error('onSnapshot hook not applied');

const FIREBASE_STUB = `
export const app = {};
export const db = { __fake: true };
export const auth = { currentUser: { uid: 'u-mgr' } };
`;

const stubPlugin = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'stub-firestore', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/(auth|app|messaging)$/ }, () => ({ path: 'stub-empty', namespace: 'stub' }));
    b.onResolve({ filter: /\/firebase$/ }, () => ({ path: 'stub-firebase', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-firestore' ? STUB
        : args.path === 'stub-firebase' ? FIREBASE_STUB
        : 'export {};',
      loader: 'js',
      resolveDir: ROOT,
    }));
  },
};

const ENTRY = /* tsx */ `
import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/i18n';
import BdControlDashboard from './src/BdControlDashboard';
import * as lib from './src/lib/bdControl';
import * as access from './src/lib/bdControlAccess';
import i18n, { applyLanguageToDocument } from './src/i18n';

const iso = off => { const d = new Date(); d.setDate(d.getDate() + off); return lib.todayISO(d); };
const ago = days => new Date(Date.now() - days * 86400000);
const ts = d => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d });
const R = (t, id, o) => __seed('bdControl/' + t + '/rows', id, o);

window.__seedAll = () => {
  for (const k of [...__store.keys()]) if (k.startsWith('bdControl')) __store.delete(k);
  __seed('bdControl', 'meta', { asof: iso(-3), built: iso(-3) + 'T10:00:00', loadedAt: ago(2).toISOString(), loadedBy: 'loader@example.test', awaited: [] });
  R('clients', 'ALPHA', { code: 'ALPHA', name: 'Alpha Gas Co.', arabicName: 'ألفا للغاز', kind: 'client' });
  R('clients', 'BETA', { code: 'BETA', name: 'Beta Refining', arabicName: 'بيتا للتكرير', kind: 'client' });
  R('clients', 'GAMMA', { code: 'GAMMA', name: 'Gamma Oil', arabicName: 'جاما للبترول', kind: 'client' });
  R('clients', 'SUPX', { code: 'SUPX', name: 'Supplier side', kind: 'supplier-side only' });
  R('clientContracts', 'ALPHA_1_CSA', { client: 'ALPHA', sr: 1, contractType: 'CSA', expiryDate: iso(200), ceilingEgp: 1200000000, status: 'Valid' });
  R('clientContracts', 'BETA_2_CSA', { client: 'BETA', sr: 2, contractType: 'CSA', expiryDate: iso(45), ceilingEgp: 800500000, status: 'Valid', lastEditedAt: ts(new Date()), lastEditedBy: 'u-mgr', appEdits: { expiryDate: { excelValue: iso(40), byName: 'Mona' } } });
  R('clientContracts', 'BETA_3_TSA', { client: 'BETA', sr: 3, contractType: 'TSA', expiryDate: iso(-10), ceilingEgp: null, status: null });
  R('clientContracts', 'GAMMA_4_O-M', { client: 'GAMMA', sr: 4, contractType: 'O&M', expiryDate: iso(120), ceilingEgp: null, monthlyValueEgp: 350000, status: 'Valid' });
  R('clientContracts', 'ALPHA_5_TSA', { client: 'ALPHA', sr: 5, contractType: 'TSA', expiryDate: null, ceilingEgp: 250000000, status: 'Signing' });
  R('supplierContracts', 'S-1', { contractNo: 'S/1', status: 'In Progress', currentEnd: iso(30), currentValueEgp: 1000000, lastEditedAt: ts(ago(10)),
    client: 'ALPHA', costType: 'Client project', contractor: 'Acme', originalValueEgp: 400000 });
  R('supplierContracts', 'S-2', { contractNo: 'S/2', status: 'In Progress', currentEnd: iso(-5), currentValueEgp: 2000000,
    client: 'BETA', costType: 'EPROM overhead', originalValueEgp: 1600000 });
  R('supplierContracts', 'S-3', { contractNo: 'S/3', status: 'Completed', currentEnd: iso(-100), currentValueEgp: 9999999, client: 'BETA', costType: 'Client project', originalValueEgp: 1000 });
  R('supplierContracts', 'S-4', { contractNo: 'S/4', status: null, currentEnd: iso(400), currentValueEgp: 500000, valueCurrencyNote: '20,000 USD', client: 'GAMMA', originalValueEgp: 100 });
  R('supplierContracts', 'S-5', { contractNo: 'S/5', status: 'On Hold', currentEnd: iso(-20), currentValueEgp: 300000,
    client: 'ALPHA', costType: 'Client project', originalValueEgp: 300000 });
  // Amendments (E5c): S/1 three, S/2 one with type N/A; S/3 is completed so its one is not counted.
  const AM = (no, n, type) => R('supplierAmendments', no.replace('/', '-') + '_' + n, { contractNo: no, amendmentNo: n, type });
  AM('S/1', 1, 'Value Increase'); AM('S/1', 2, 'Time Extension'); AM('S/1', 3, 'Value Increase'); AM('S/2', 1, 'N/A'); AM('S/3', 1, 'Value Increase');
  // AGIBA SOs (E5c). SO 5 says In Progress but is CANCELLED in the SO / SR column -> not open.
  const SO = (n, o) => R('agibaSOs', 'SO-' + n + '-2026', { so: 'SO ' + n + '-2026', item: 'Item ' + n, soSr: 'SO', currency: 'EGP', ...o });
  SO(1, { status: 'In Progress', contractor: 'Petro', expiry: iso(20), amount: 100000 });
  SO(2, { status: 'Completed', contractor: 'Petro', expiry: iso(-100), amount: 200000 });
  SO(3, { status: null, contractor: 'Lift', expiry: iso(-15), amount: 50000 });
  SO(4, { status: 'Pending', contractor: 'Lift', expiry: iso(90), amount: 10000, currency: 'USD' });
  SO(5, { status: 'In Progress', contractor: 'Petro', expiry: iso(5), soSr: 'CANCELLED' });
  SO(6, { status: 'In Progress', expiry: iso(60), amount: 30000 });
  R('supplierContracts', 'S-6', { contractNo: 'S/6', status: 'Cancelled', currentEnd: iso(10), currentValueEgp: 700000 });
  R('agibaSiteContracts', 'A-1', { contractNo: 'A/1', currentEnd: iso(60), status: 'ساري' });
  R('agibaSiteContracts', 'A-2', { contractNo: 'A/2', currentEnd: iso(300), status: 'ساري' });
  R('agibaSiteContracts', 'A-3', { contractNo: 'A/3', currentEnd: null, status: 'ساري' });
  for (let i = 1; i <= 4; i++) R('dataIssues', 'Client-Contracts_' + i, { table: 'Client Contracts', record: 'R' + i, issue: 'made-up issue ' + i, whatToDo: 'ask' });
  R('changes', 'BETA_CSA_Expiry-date', { client: 'BETA', type: 'CSA', field: 'Expiry date', march2026: iso(-200), september2026: iso(45) });
  R('changes', 'BETA_CSA_Status', { client: 'BETA', type: 'CSA', field: 'Status', march2026: 'Waiting Approval', september2026: 'Valid' });
  R('changes', 'ALPHA_CSA_Ceiling-EGP', { client: 'ALPHA', type: 'CSA', field: 'Ceiling EGP', march2026: 1000000000, september2026: 1200000000 });
  R('changes', 'ALPHA_CSA_Comments', { client: 'ALPHA', type: 'CSA', field: 'Comments', march2026: 'old note' });
  // Day-rates (E5b). Operator rows first: the grade order must come from level, not row order.
  // DELTA has rates but no client line; Section Head has no rate anywhere (no chip).
  const DR = (c, g, l, v) => R('dayRates', c + '_' + g.replace(/ /g, '-'), { client: c, grade: g, level: l, dayRateEgp: v });
  DR('ANOPC', 'Operator', null, 3000); DR('ALPHA', 'Operator', null, 3300); DR('BETA', 'Operator', null, 2700);
  DR('ANOPC', 'Senior Engineer', 6, 5000); DR('ALPHA', 'Senior Engineer', 6, 5500); DR('BETA', 'Senior Engineer', 6, 4000);
  DR('GAMMA', 'Senior Engineer', 6, 4800); DR('DELTA', 'Senior Engineer', 6, 4500);
  DR('ANOPC', 'General Manager', 10, 10000); DR('ALPHA', 'General Manager', 10, 12000); DR('BETA', 'General Manager', 10, 7000);
  DR('GAMMA', 'General Manager', 10, 9500); DR('DELTA', 'General Manager', 10, 8000);
  DR('ALPHA', 'Section Head', 7, null);
  R('dataIssues', 'Day-Rates_1', { table: 'Day Rates', record: 'BETA', issue: 'lower grade not cheaper than the grade above', whatToDo: 'check' });
  R('dataIssues', 'Day-Rates_2', { table: 'Day Rates', record: 'EPS', issue: 'column has a heading but no rates', whatToDo: 'ask' });
};
window.__seedAll();

window.__lib = lib; window.__access = access; window.__iso = iso; window.__ts = ts; window.__ago = ago;
window.__denied = new Set();
window.__user = { id: 'u-mgr', displayName: 'Mona Manager', role: 'Manager', status: 'Approved' };
const root = createRoot(document.getElementById('root'));
let n = 0;
window.__mount = view => {
  n++;
  root.render(React.createElement('div', { className: 'app-main' },
    view === 'blank' ? React.createElement('div', null, 'blank')
      : React.createElement(BdControlDashboard, { key: 'b' + n, appUser: window.__user, onNavigate: () => {} })));
};
window.__mount('page');
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'bdcontroluiEntry.tsx', loader: 'tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  outfile: path.join(WORK, 'bundle.js'),
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '__VITE_ENV__' },
  banner: { js: `const __VITE_ENV__ = { VITE_GOOGLE_SCRIPT_URL: 'https://script.test/exec', VITE_GOOGLE_SCRIPT_SECRET: 'harness-secret' };` },
  plugins: [stubPlugin],
  logLevel: 'warning',
});

const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  .replace(/@import url\([^)]*\);/g, '')
  .replace(/@tailwind [a-z]+;/g, '');
fs.writeFileSync(path.join(WORK, 'app.css'), css);
fs.writeFileSync(path.join(WORK, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0" />
   <link rel="stylesheet" href="app.css"></head>
   <body style="background: var(--surface-3)"><div id="root"></div><script src="bundle.js"></script></body></html>`);

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('Microsoft Edge not found.'); process.exit(2); }

const PORT = 9631 + (process.pid % 80);
const edge = spawn(EDGE, [
  HEADED ? '--new-window' : '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(WORK, 'profile')}`,
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000',
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/bd-control',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('Edge did not expose a page target');
}
const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pageErrors.push('console.error: ' + m.params.args.map(a => a.description || a.value).join(' '));
  }
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
await send('Page.enable');

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
}
async function waitFor(expression, label, timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalJS(`!!(${expression})`)) return true;
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${label || expression}`);
}
const HELPERS = `
window.__txt = e => (e ? e.textContent || '' : '').replace(/\\s+/g, ' ').trim();
`;
await waitFor(`document.getElementById('root') && document.getElementById('root').children.length`, 'app mount');
await evalJS(HELPERS);

async function shot(name) {
  if (!SHOT) return;
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const p = path.join(ROOT, `scripts/harness/bdcontrolui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const has = sel => evalJS(`!!${q(sel)}`);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const remount = async () => { await evalJS(`window.__mount('blank')`); await sleep(100); await evalJS(`window.__mount('page')`); await sleep(300); };
const tile = k => text(`[data-bd-kpi="${k}"] [data-bd-value]`);
const sub = k => text(`[data-bd-kpi="${k}"] [data-bd-sub]`);
const tileKeys = () => evalJS(`[...document.querySelectorAll('[data-bd-kpi]')].map(e => e.dataset.bdKpi).join(',')`);
const J = x => JSON.stringify(x);
const keys = row => evalJS(`[...document.querySelectorAll('[data-bdc-row="${row}"]')].map(e => e.dataset.bdcKey).join(',')`);
const texts = sel => evalJS(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(window.__txt).join('|')`);
const bucket = b => text(`[data-bdc-row="bucket"][data-bdc-key="${b}"] [data-bdc-value]`);
const click = sel => evalJS(`${q(sel)}.click()`).then(() => sleep(150));

try {

console.log('\n[1] the maths (lib/bdControl.ts)');
const L = JSON.parse(await evalJS(`(() => { const L = window.__lib, T = L.todayISO(), i = window.__iso;
  return JSON.stringify({
    d: [L.daysUntil(i(20), T), L.daysUntil(i(-3), T), L.daysUntil('', T), L.daysUntil(null, T), L.daysUntil('31/03/2027', T), L.daysUntil(i(5) + 'T00:00:00', T)],
    f: [-1, 0, 90, 91, 180, 181, null].map(L.expiryFlag),
    s: [L.supplierFlag({ status: 'In Progress', currentEnd: i(-1) }, T), L.supplierFlag({ status: null, currentEnd: i(-1) }, T),
        L.supplierFlag({ status: 'On Hold', currentEnd: i(-1) }, T), L.supplierFlag({ status: 'Completed', currentEnd: i(-1) }, T),
        L.supplierFlag({ status: 'On Hold', currentEnd: i(10) }, T)],
    live: [L.isLiveSupplier({ status: 'Completed' }), L.isLiveSupplier({ status: 'Cancelled' }), L.isLiveSupplier({ status: 'On Hold' }), L.isLiveSupplier({ status: null })],
    egp: [L.isEgpSupplier({ valueCurrencyNote: '10 USD' }), L.isEgpSupplier({ valueCurrencyNote: null }), L.isEgpSupplier({ valueCurrencyNote: '  ' })],
    m: [L.millions(3277355000), L.millions(462000), L.millions(12345678901), L.millions(0)],
    t: [L.timeOf('2026-01-01T00:00:00Z'), L.timeOf({ seconds: 5 }), L.timeOf(new Date(7000)), L.timeOf(null), L.timeOf('nonsense')],
    e: [L.editsSinceLoad({ ...L.emptyBdData(), meta: null, clientContracts: [{ id: 'a', lastEditedAt: { seconds: 1 } }, { id: 'b' }] }),
        L.editsSinceLoad({ ...L.emptyBdData(), meta: { loadedAt: '2026-01-02T00:00:00Z' }, dataIssues: [{ id: 'x', lastEditedAt: { seconds: 9e9 } }],
          supplierContracts: [{ id: 's', lastEditedAt: { seconds: 1767312000 + 1 } }, { id: 'o', lastEditedAt: { seconds: 1767312000 - 1 } }] })],
    h: [L.hasData(L.emptyBdData()), L.hasData({ ...L.emptyBdData(), meta: { asof: T } }), L.hasData({ ...L.emptyBdData(), dataIssues: [{ id: 'x' }] })],
    dd: [L.dataDate({ ...L.emptyBdData(), meta: { asof: i(-31) } }, T).stale, L.dataDate({ ...L.emptyBdData(), meta: { asof: i(-32) } }, T).stale,
         L.dataDate({ ...L.emptyBdData(), meta: { asof: i(-32) } }, T).ageDays, L.dataDate(L.emptyBdData(), T).stale],
  }); })()`));
check('daysUntil: +20, -3, blank/null/non-ISO = null, ISO with a time still read', J(L.d) === J([20, -3, null, null, null, 5]), J(L.d));
check('expiryFlag cut-offs 0 / 90 / 91 / 180 / 181 like build_control_data.py',
  J(L.f) === J(['Expired on paper', 'Within 90 days', 'Within 90 days', 'Within 180 days', 'Within 180 days', 'OK', 'No date']), J(L.f));
check('supplier past its end: overdue only while In Progress / blank, else Ended', J(L.s) === J(['Expired on paper', 'Expired on paper', 'Ended', 'Ended', 'Within 90 days']), J(L.s));
check('live = not Completed / Cancelled', J(L.live) === J([false, false, true, true]));
check('a currency note keeps a line out of EGP totals (blank note = EGP)', J(L.egp) === J([false, true, true]));
check('millions: 3,277,355,000 -> 3277.4 · 462,000 -> 0.5 · 12,345.7 m -> 12346 · 0', J(L.m) === J([3277.4, 0.5, 12346, 0]), J(L.m));
check('timeOf reads ISO / Timestamp / Date, null for nonsense', J(L.t) === J([1767225600, 5, 7, null, null]), J(L.t));
check('edits since load: no meta = every edited row; with meta only rows edited after loadedAt; dataIssues (loader-only) never counted', J(L.e) === J([1, 1]), J(L.e));
check('hasData: empty false, meta alone true, a row alone true', J(L.h) === J([false, true, true]));
check('stale only past 31 days (31 = fresh, 32 = stale), no meta = not stale', J(L.dd) === J([false, true, 32, false]), J(L.dd));
const L2 = JSON.parse(await evalJS(`(() => { const L = window.__lib;
  const g = L.rateGrid([{ client: 'B', grade: 'Op', level: null, dayRateEgp: 1 }, { client: 'A', grade: 'GM', level: 10, dayRateEgp: 3 },
    { client: 'A', grade: 'Op', level: null, dayRateEgp: 2 }, { client: 'A', grade: 'Eng', level: 6, dayRateEgp: 2.5 }, { client: 'C', grade: 'Empty', level: 7, dayRateEgp: null }]);
  return JSON.stringify({
    b: [-1, 0, 30, 31, 90, 91, 180, 181, 365, 366, null].map(L.renewalBucket),
    w: [-1, 0, 180, 181, 365, 366, null].map(L.repriceWindow),
    md: [L.median([3, 1, 2]), L.median([4, 1, 3, 2]), L.median([])],
    g: [g.grades, g.clients, g.rate('A', 'Op'), g.rate('B', 'GM')],
  }); })()`));
check('renewal buckets: past / ≤30 / 31–90 / 91–180 / 181–365 / later / no date',
  J(L2.b) === J(['overdue', 'd30', 'd30', 'd90', 'd90', 'd180', 'd180', 'd365', 'd365', 'later', 'noDate']), J(L2.b));
check('reprice window: past / ≤180 / ≤365 / later / no date', J(L2.w) === J(['overdue', 'within180', 'within180', 'within365', 'within365', 'later', 'noDate']), J(L2.w));
check('median odd / even / empty', J(L2.md) === J([2, 2.5, null]), J(L2.md));
check('rate grid: grades by level (no level last, no-rate grade dropped), clients A–Z, missing cell = null',
  J(L2.g) === J([['GM', 'Eng', 'Op'], ['A', 'B'], 2, null]), J(L2.g));

console.log('\n[2] who may see it (lib/bdControlAccess.ts) + the 6 nav entries');
const A = JSON.parse(await evalJS(`JSON.stringify([
  { role: 'Manager', status: 'Approved' }, { role: 'Admin', status: 'Approved' }, { role: 'Employee', status: 'Approved' },
  { role: 'Manager', status: 'Pending' }, null].map(window.__access.canViewBdControl))`));
check('Approved Manager + Admin yes; Employee, pending Manager, nobody no', J(A) === J([true, true, false, false, false]), J(A));
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const gate = (f, re) => check(`${f}: bd-control entry gated by canViewBdControl(appUser)`, re.test(src(f)));
gate('src/App.tsx', /activeView === 'bd-control' && canViewBdControl\(appUser\)/);
gate('src/App.tsx', /id: 'bd-control',\s+label: 'BD control',[^\n]*show: canViewBdControl\(appUser\)/);
gate('src/components/Sidebar.tsx', /id: 'bd-control'[^\n]*show: canViewBdControl\(appUser\)/);
gate('src/HomeDashboard.tsx', /id: 'bd-control'[^\n]*show: canViewBdControl\(appUser\)/);
gate('src/components/CommandPalette.tsx', /canViewBdControl\(appUser\) \? \[\{ kind: 'nav', id: 'bd-control'/);
check('useHashRoute knows #/bd-control', /'bd-control'/.test(src('src/hooks/useHashRoute.ts')));
check('Sidebar lists it under Portfolio, after Medical contracts',
  /portfolioItems[\s\S]*'medical-contracts'[\s\S]*'bd-control'[\s\S]*'opportunities'/.test(src('src/components/Sidebar.tsx')));

console.log('\n[3] the tiles, from the made-up rows');
await waitFor(q('[data-bd="tiles"]'), 'tiles');
check('tiles in order', (await tileKeys()) === 'clients,lines,ceiling,monthly,renewals,suppliers,issues', await tileKeys());
check('clients = 3 (supplier-side code not counted)', (await tile('clients')) === '3');
check('client lines = 5, "Expired on paper: 1"', (await tile('lines')) === '5' && (await sub('lines')) === 'Expired on paper: 1', await sub('lines'));
check('total ceiling 2,250.5 m EGP; "3 of 5"', (await tile('ceiling')) === '2,250.5' && (await text('[data-bd-kpi="ceiling"]')).includes('m EGP')
  && (await sub('ceiling')) === 'Lines with a ceiling: 3 of 5', `${await tile('ceiling')} | ${await sub('ceiling')}`);
check('paid monthly 350,000 EGP / month, "GAMMA O&M — not added…"', (await tile('monthly')) === '350,000'
  && (await sub('monthly')) === 'GAMMA O&M — not added to the ceiling total', `${await tile('monthly')} | ${await sub('monthly')}`);
check('renewals ≤ 90 days = 3: client 1 · supplier 1 · AGIBA site 1 (cancelled one ignored)', (await tile('renewals')) === '3'
  && (await sub('renewals')).startsWith('Client 1 · supplier 1 · AGIBA site 1'), await sub('renewals'));
check('already past their date: 2 (client + In-Progress supplier; On Hold one = ended)', (await text('[data-bd="overdue"]')) === 'Already past their date: 2');
check('live suppliers 4, 3.3 m EGP, 1 in another currency left out', (await tile('suppliers')) === '4'
  && (await sub('suppliers')) === '3.3 m EGPIn another currency, left out: 1', await sub('suppliers'));
check('data issues 6', (await tile('issues')) === '6');

console.log('\n[4] the data-date strip');
check('as-of date shown', (await text('[data-bd="asof"]')).startsWith('Excel data as of '), await text('[data-bd="asof"]'));
check('loaded … by loader@example.test', /^Loaded .+ by loader@example\.test$/.test(await text('[data-bd="loaded"]')), await text('[data-bd="loaded"]'));
check('1 row edited since the load (the one edited before it not counted)', (await text('[data-bd="edits"]')) === 'Records edited in eTaske since the last load: 1');
check('3-day-old data: no stale warning', !(await has('[data-bd="stale"]')));
check('nothing written by the page', (await evalJS(`window.__writes.length`)) === 0);
await shot('1-tiles');

console.log('\n[4b] chart 3 — contract ceiling by client');
check('biggest first: ALPHA then BETA (GAMMA has only a monthly value)', (await keys('ceiling')) === 'ALPHA,BETA', await keys('ceiling'));
check('ALPHA = 1,450 m EGP over 2 lines (CSA, TSA); BETA 800.5 (the no-ceiling TSA left out)',
  (await text('[data-bdc-row="ceiling"][data-bdc-key="ALPHA"]')) === 'ALPHACSA, TSA · lines: 21,450 m EGP'
  && (await text('[data-bdc-row="ceiling"][data-bdc-key="BETA"] [data-bdc-value]')) === '800.5 m EGP', await text('[data-bdc-row="ceiling"][data-bdc-key="ALPHA"]'));
check('longest bar = biggest ceiling, the other in proportion', (await evalJS(`(() => {
  const a =document.querySelector('[data-bdc-row="ceiling"][data-bdc-key="ALPHA"] .bdc-fill').getBoundingClientRect().width;
  const b = document.querySelector('[data-bdc-row="ceiling"][data-bdc-key="BETA"] .bdc-fill').getBoundingClientRect().width;
  return a > b && Math.abs(b / a - 800.5 / 1450) < 0.02; })()`)));
check('monthly-only client named under the chart, no "no value" line', (await text('[data-bdc-foot="monthly"]')) === 'Paid by the month, not in this chart: GAMMA'
  && !(await has('[data-bdc-foot="novalue"]')));
check('2 clients: no "show all" button', !(await has('[data-bdc-more="ceiling"]')));

console.log('\n[4c] chart 4 — renewal timeline');
const B4 = await evalJS(`[...document.querySelectorAll('[data-bdc-row="bucket"]')].map(e => e.dataset.bdcKey + '=' + window.__txt(e.querySelector('[data-bdc-value]'))).join(',')`);
check('buckets: past 2 · ≤30 1 · 31–90 2 · 91–180 1 · 181–365 2 · later 1 · no date 2 (ended / completed / cancelled suppliers out)',
  B4 === 'overdue=2,d30=1,d90=2,d180=1,d365=2,later=1,noDate=2', B4);
check('past-their-date row: client 1 · supplier 1 · AGIBA site 0, client + supplier segments only',
  (await text('[data-bdc-key="overdue"] .bdc-sub')) === 'Client 1 · supplier 1 · AGIBA site 0'
  && (await evalJS(`[...document.querySelectorAll('[data-bdc-key="overdue"] [data-bdc-seg]')].map(e => e.dataset.bdcSeg).join(',')`)) === 'client,supplier');
check('within 90 days on the chart (≤30 + 31–90 = 3) matches the renewals tile', (await tile('renewals')) === '3');
check('next to come up: soonest first, nothing past or ended', (await keys('next')) === 'S/1,BETA,A/1,GAMMA,ALPHA,A/2,S/4', await keys('next'));
check('next row reads kind · type · status and the days left',
  (await text('[data-bdc-row="next"][data-bdc-key="BETA"] .bdc-sub')) === 'Client contract · CSA · Valid'
  && /^Ends .+ · days remaining: 45$/.test(await text('[data-bdc-row="next"][data-bdc-key="BETA"] .bdc-when')),
  await text('[data-bdc-row="next"][data-bdc-key="BETA"]'));
check('a supplier row reads kind · contractor · client', (await text('[data-bdc-row="next"][data-bdc-key="S/1"] .bdc-sub')) === 'Supplier contract · Acme · ALPHA', await text('[data-bdc-row="next"][data-bdc-key="S/1"] .bdc-sub'));

console.log('\n[4d] chart 5 — day-rate vs benchmark');
check('grade chips by level, the empty grade left out: GM · Sr Eng · Operator', (await texts('[data-bdc-grade]')) === 'GM|Sr Eng|Operator', await texts('[data-bdc-grade]'));
check('GM picked first, ANOPC the benchmark', (await evalJS(`${q('[data-bdc-grade="General Manager"]')}.getAttribute('aria-pressed')`)) === 'true'
  && (await text('[data-bdc="base"]')) === 'ANOPC: 10,000 EGP per man-day', await text('[data-bdc="base"]'));
check('bars highest first', (await keys('rate')) === 'ALPHA,ANOPC,GAMMA,DELTA,BETA', await keys('rate'));
check('gaps: +20.0% · benchmark · −5.0% · −20.0% · −30.0%', (await texts('[data-bdc-row="rate"] [data-bdc-gap]')) === '+20.0%|benchmark|−5.0%|−20.0%|−30.0%', await texts('[data-bdc-row="rate"] [data-bdc-gap]'));
check('30% below = red bar, 20% below = amber', (await has('[data-bdc-key="BETA"] .bdc-fill-lo')) && (await has('[data-bdc-key="DELTA"] .bdc-fill-mid')) && (await has('[data-bdc-key="GAMMA"] .bdc-fill-base')));
check('benchmark tick sits at 10,000 on the scale', (await evalJS(`(() => { const r = document.querySelector('[data-bdc-key="ANOPC"]');
  const f = r.querySelector('.bdc-fill').getBoundingClientRect(), m = r.querySelector('.bdc-mark').getBoundingClientRect();
  return Math.abs((m.left + 1) - f.right) <= 2; })()`)));
check('⚠ on BETA only (the "no rates" issue is not an odd value)', (await texts('[data-bdc-row="rate"] [data-bdc-warn]')) === '⚠'
  && (await has('[data-bdc-row="rate"][data-bdc-key="BETA"] [data-bdc-warn]')));
await click('[data-bdc-grade="Operator"]');
check('Operator: only the 3 clients with that rate, ANOPC 3,000', (await keys('rate')) === 'ALPHA,ANOPC,BETA' && (await text('[data-bdc="base"]')) === 'ANOPC: 3,000 EGP per man-day');
await click('[data-bdc-bench="median"]');
check('median of 3,300 / 3,000 / 2,700 = 3,000; ANOPC now gets a gap (0.0%)', (await text('[data-bdc="base"]')) === 'Median client: 3,000 EGP per man-day'
  && (await texts('[data-bdc-row="rate"] [data-bdc-gap]')) === '+10.0%|0.0%|−10.0%', await texts('[data-bdc-row="rate"] [data-bdc-gap]'));
await click('[data-bdc-grade="General Manager"]');
check('GM vs median 9,500: BETA −26.3%', (await text('[data-bdc="base"]')) === 'Median client: 9,500 EGP per man-day'
  && (await text('[data-bdc-row="rate"][data-bdc-key="BETA"] [data-bdc-gap]')) === '−26.3%');
await click('[data-bdc-bench="anopc"]');

console.log('\n[4e] chart 6 — reprice at renewal');
check('10%+ below ANOPC on average: BETA (−20%) then DELTA (no date, last); GAMMA (−4.5%) and ALPHA not listed', (await keys('reprice')) === 'BETA,DELTA', await keys('reprice'));
check('BETA: −20.0%, 1,433 EGP below per man-day, expired-on-paper window (its TSA ended 10 days ago)',
  (await text('[data-bdc-row="reprice"][data-bdc-key="BETA"] [data-bdc-gap]')) === '−20.0%'
  && (await text('[data-bdc-key="BETA"] [data-bdc-perday]')) === '1,433 EGP below per man-day'
  && (await evalJS(`${q('[data-bdc-row="reprice"][data-bdc-key="BETA"] [data-bdc-window]')}.dataset.bdcWindow`)) === 'overdue'
  && (await text('[data-bdc-row="reprice"][data-bdc-key="BETA"] .bdc-name .bdc-sub')) === 'TSA'
  && /^Ended .+ · 10 days ago$/.test(await text('[data-bdc-row="reprice"][data-bdc-key="BETA"] .bdc-reprice-when .bdc-sub')),
  await text('[data-bdc-row="reprice"][data-bdc-key="BETA"]'));
check('DELTA: no client line → "No client line on file" + raise-at-next-review window',
  (await text('[data-bdc-row="reprice"][data-bdc-key="DELTA"] .bdc-name .bdc-sub')) === 'No client line on file'
  && (await text('[data-bdc-row="reprice"][data-bdc-key="DELTA"] [data-bdc-window]')) === 'No expiry on file — raise at the next price review');
check('nothing written by the charts either', (await evalJS(`window.__writes.length`)) === 0);
await shot('1b-charts');

console.log('\n[4f] chart 7 — what supplier contracts cost');
check('figures: 3.3 m today (= the tile), 2.3 m when signed, +43% growth', (await text('[data-bdc-fig="current"]')) === '3.3 m EGP'
  && (await text('[data-bdc-fig="original"]')) === '2.3 m EGP' && (await text('[data-bdc-fig="growth"]')) === '+43%',
  `${await text('[data-bdc-fig="current"]')} | ${await text('[data-bdc-fig="original"]')} | ${await text('[data-bdc-fig="growth"]')}`);
check('by cost type: EPROM overhead 2 m (1), Client project 1.3 m (2)', (await keys('costtype')) === 'EPROM overhead,Client project'
  && (await text('[data-bdc-row="costtype"][data-bdc-key="Client project"]')) === 'Client projectContracts: 21.3 m EGP', await text('[data-bdc-row="costtype"][data-bdc-key="Client project"]'));
check('by client: BETA 2 m then ALPHA 1.3 m (completed + USD lines out)', (await keys('supclient')) === 'BETA,ALPHA'
  && (await text('[data-bdc-row="supclient"][data-bdc-key="ALPHA"] [data-bdc-value]')) === '1.3 m EGP');
check('foot: growth over 3 contracts, 1 in another currency', (await text('[data-bdc-foot="suppliers"]')) === 'Growth counts only the 3 contracts with both values on file. In another currency, left out: 1', await text('[data-bdc-foot="suppliers"]'));

console.log('\n[4g] chart 8 — growth through amendments');
check('biggest growth first: S/1 +150% · S/2 +25% · S/5 0%', (await keys('growth')) === 'S/1,S/2,S/5'
  && (await texts('[data-bdc-row="growth"] [data-bdc-value]')) === '+150%|+25%|0%', await texts('[data-bdc-row="growth"] [data-bdc-value]'));
check('S/1 reads contractor, 0.4 → 1 m, 3 amendments, client', (await text('[data-bdc-row="growth"][data-bdc-key="S/1"] .bdc-name')) === 'S/1 · Acme0.4 m EGP → 1 m EGP · amendments: 3 · ALPHA',
  await text('[data-bdc-row="growth"][data-bdc-key="S/1"] .bdc-name'));
check('doubled = red, 25% = amber, flat = grey', (await has('[data-bdc-key="S/1"] .bdc-fill-lo')) && (await has('[data-bdc-key="S/2"] .bdc-fill-mid')) && (await has('[data-bdc-key="S/5"] .bdc-fill-base')));
check('amendment kinds on live contracts only (S/3 completed): 4 — value increase 2, time extension 1, type not given 1',
  (await text('[data-bdc-foot="types"]')) === 'Amendments on live contracts: 4 — Value Increase 2, Time Extension 1, Type not given 1', await text('[data-bdc-foot="types"]'));

console.log('\n[4h] chart 9 — AGIBA service orders');
check('6 SOs · 4 open · 1 open past its date', (await text('[data-bdc-fig="sototal"]')) === '6' && (await text('[data-bdc-fig="soopen"]')) === '4' && (await text('[data-bdc-fig="sopast"]')) === '1');
check('by status, open ones first, blank named: In Progress 3 · Pending 1 · blank 1 · Completed 1',
  (await evalJS(`[...document.querySelectorAll('[data-bdc-row="sostatus"]')].map(e => window.__txt(e)).join('|')`)) === 'In Progress3|Pending1|Status blank1|Completed1',
  await evalJS(`[...document.querySelectorAll('[data-bdc-row="sostatus"]')].map(e => window.__txt(e)).join('|')`));
check('by contractor: Petro 3 (open 1, 0.3 m), Lift 2 (USD left out of EGP), no name 1', (await keys('socontractor')) === 'Petro,Lift,'
  && (await text('[data-bdc-row="socontractor"][data-bdc-key="Petro"] .bdc-sub')) === 'Open: 1 · 0.3 m EGP'
  && (await text('[data-bdc-row="socontractor"][data-bdc-key="Lift"] .bdc-sub')) === 'Open: 2 · 0.1 m EGP'
  && (await text('[data-bdc-row="socontractor"][data-bdc-key=""] .bdc-name > span')) === 'No contractor named');
check('ending within 60 days: SO 1 (20 d) then SO 6 (60 d); cancelled SO 5 and the 90-day one not listed', (await keys('sosoon')) === 'SO 1-2026,SO 6-2026', await keys('sosoon'));
check('open past their date: SO 3, 15 days ago, in red', (await keys('sopast')) === 'SO 3-2026'
  && /^Ended .+ · 15 days ago$/.test(await text('[data-bdc-row="sopast"] .bdc-when')) && (await has('[data-bdc-row="sopast"] .bdc-when.bdc-red')));
check('the USD SO is counted in the foot', (await text('[data-bdc-foot="socur"]')) === 'Amounts in another currency are left out of the EGP figures: 1');

console.log('\n[4i] chart 10 — changes between two CSA reports');
check('periods read from the rows: "March 2026 → September 2026"', (await text('[data-bdc="changes"] .bdc-cap')).startsWith('March 2026 → September 2026'), await text('[data-bdc="changes"] .bdc-cap'));
check('per client: ALPHA 2, BETA 2 (tie -> A–Z), fields named', (await keys('change')) === 'ALPHA,BETA'
  && (await text('[data-bdc-key="BETA"] summary .bdc-sub')) === 'Expiry date, Status', await keys('change'));
check('rows closed until opened', !(await evalJS(`${q('[data-bdc-row="change"][data-bdc-key="ALPHA"]')}.open`)));
await click('[data-bdc-row="change"][data-bdc-key="ALPHA"] summary');
check('opened ALPHA: ceiling 1,000,000,000 → 1,200,000,000 · comments "old note" → blank',
  (await text('[data-bdc-key="ALPHA"] [data-bdc-change="Ceiling EGP"]')) === 'CSA · Ceiling EGP1,000,000,000 → 1,200,000,000'
  && (await text('[data-bdc-key="ALPHA"] [data-bdc-change="Comments"]')) === 'CSA · Commentsold note → blank',
  `${await text('[data-bdc-key="ALPHA"] [data-bdc-change="Ceiling EGP"]')} | ${await text('[data-bdc-key="ALPHA"] [data-bdc-change="Comments"]')}`);
await click('[data-bdc-row="change"][data-bdc-key="BETA"] summary');
check('dates shown as dates: BETA expiry moved', /^CSA · Expiry date.+ → .+\d{4}$/.test(await text('[data-bdc-key="BETA"] [data-bdc-change="Expiry date"]')), await text('[data-bdc-key="BETA"] [data-bdc-change="Expiry date"]'));

console.log('\n[4j] chart 11 — data issues by sheet, chart 12 — awaiting data');
check('issues: Client Contracts 4 (4 records), Day Rates 2', (await keys('issue')) === 'Client Contracts,Day Rates'
  && (await text('[data-bdc-row="issue"][data-bdc-key="Client Contracts"]')) === 'Client ContractsRecords affected: 44', await text('[data-bdc-row="issue"][data-bdc-key="Client Contracts"]'));
check('awaited = [] -> "every measure has arrived"', (await text('[data-bdc-empty="awaited"]')) === 'Nothing is awaited: every measure has arrived.');
await evalJS(`(() => { const m = __store.get('bdControl').get('meta'); __seed('bdControl', 'meta', { ...m, awaited: [
  { measure: 'Revenue invoiced, per contract per month', form: '01 Finance - Cost Accounting', received: false },
  { measure: 'Fully-loaded cost per head, per grade', form: '04 HR - Personnel & Payroll', received: true },
  { measure: 'A measure the app has no words for', received: false }] }); __emit(); })()`);
await sleep(200);
check('3 measures listed, received 1 of 3, the rest "Not received"', (await evalJS(`document.querySelectorAll('[data-bdc-row="awaited"]').length`)) === 3
  && (await text('[data-bdc="awaited"] .bdc-cap')).endsWith('received: 1 of 3')
  && (await texts('[data-bdc-row="awaited"] .bdc-pill')) === 'Not received|Received|Not received', await texts('[data-bdc-row="awaited"] .bdc-pill'));
check('an unknown measure shows as written; the margin note is there while any is missing', (await text('[data-bdc-key="A measure the app has no words for"] .bdc-name')) === 'A measure the app has no words for'
  && (await text('[data-bdc="awaited"] .bdc-foot')).startsWith('Margin, cash and profit'));
await evalJS(`(() => { const m = __store.get('bdControl').get('meta'); __seed('bdControl', 'meta', { ...m, awaited: m.awaited.map(a => ({ ...a, received: true })) }); __emit(); })()`);
await sleep(200);
check('flips on its own when the meta says received: 3 of 3, note gone', (await text('[data-bdc="awaited"] .bdc-cap')).endsWith('received: 3 of 3')
  && !(await has('[data-bdc="awaited"] .bdc-foot')) && (await evalJS(`document.querySelectorAll('[data-bdc-received="yes"]').length`)) === 3);
check('lib: periodDate, the latest two periods, isOpenSO, awaitedData with no list', await evalJS(`(() => { const L = window.__lib;
  const c = L.changesByClient([{ id: 'a', client: 'X', field: 'F', june2026: 1, march2026: 0, january2027: 2 }]);
  return L.periodDate('september2026') === '2026-09-01' && L.periodDate('notes') === null && c.from === 'june2026' && c.to === 'january2027'
    && c.clients[0].changes[0].from === 1 && c.clients[0].changes[0].to === 2
    && L.isOpenSO({ status: null }) && !L.isOpenSO({ status: 'Completed' }) && !L.isOpenSO({ status: 'In Progress', soSr: 'Cancelled' })
    && L.awaitedData(null).listed === false && L.awaitedData({ awaited: [] }).listed === true; })()`));
check('nothing written by charts 7–12', (await evalJS(`window.__writes.length`)) === 0);
await shot('1c-charts-7-12');

console.log('\n[5] figures follow the rows, no reload (nothing hard-coded)');
await evalJS(`(() => {
  __seed('bdControl/dataIssues/rows', 'Client-Contracts_5', { table: 'Client Contracts', record: 'R5', issue: 'another' });
  const m = __store.get('bdControl/clientContracts/rows');
  m.set('BETA_3_TSA', { ...m.get('BETA_3_TSA'), expiryDate: window.__iso(10) });
  m.set('ALPHA_1_CSA', { ...m.get('ALPHA_1_CSA'), ceilingEgp: 1300000000 });
  __emit();
})()`);
await sleep(200);
check('issues 6 -> 7', (await tile('issues')) === '7');
check('renewed-on-paper line moves: renewals 3 -> 4, overdue 2 -> 1, lines "None expired on paper"',
  (await tile('renewals')) === '4' && (await text('[data-bd="overdue"]')) === 'Already past their date: 1' && (await sub('lines')) === 'None expired on paper');
check('ceiling edit flows in: 2,350.5', (await tile('ceiling')) === '2,350.5', await tile('ceiling'));
check('… and into chart 3: ALPHA 1,550 m EGP', (await text('[data-bdc-row="ceiling"][data-bdc-key="ALPHA"] [data-bdc-value]')) === '1,550 m EGP');
check('… and chart 4: past-their-date bucket 2 -> 1, within 30 days 1 -> 2', (await bucket('overdue')) === '1' && (await bucket('d30')) === '2');
check('… and chart 11: Client Contracts 4 -> 5', (await text('[data-bdc-row="issue"][data-bdc-key="Client Contracts"] [data-bdc-value]')) === '5');
check('… and chart 6: BETA now renews within 6 months',(await evalJS(`${q('[data-bdc-row="reprice"][data-bdc-key="BETA"] [data-bdc-window]')}.dataset.bdcWindow`)) === 'within180');
await evalJS(`(() => { const m = __store.get('bdControl/clientContracts/rows'); m.delete('GAMMA_4_O-M'); __emit(); })()`);
await sleep(200);
check('no monthly-value line left -> that tile goes away', !(await has('[data-bd-kpi="monthly"]')) && (await tile('lines')) === '4');

console.log('\n[6] stale data');
await evalJS(`(() => { __seed('bdControl', 'meta', { asof: window.__iso(-40), loadedAt: window.__ago(39).toISOString() }); __emit(); })()`);
await sleep(200);
check('40-day-old data: warning with the age', (await text('[data-bd="stale"]')) === 'The Excel data is 40 days old. Ask BD to refresh it.', await text('[data-bd="stale"]'));
check('no loadedBy -> "Loaded <when>" alone', /^Loaded .+/.test(await text('[data-bd="loaded"]')) && !(await text('[data-bd="loaded"]')).includes(' by '));
check('both stamped rows are after a 39-day-old load -> 2 edits', (await text('[data-bd="edits"]')) === 'Records edited in eTaske since the last load: 2', await text('[data-bd="edits"]'));
await shot('2-stale');

console.log('\n[6b] chart 3 with many clients: top 10, then show all');
await evalJS(`(() => { for (let i = 1; i <= 11; i++) __seed('bdControl/clientContracts/rows', 'X' + i + '_CSA', { client: 'X' + String(i).padStart(2, '0'), contractType: 'CSA', ceilingEgp: i * 1e6, expiryDate: window.__iso(500) }); __emit(); })()`);
await sleep(200);
check('10 bars + "Show all 13"', (await evalJS(`document.querySelectorAll('[data-bdc-row="ceiling"]').length`)) === 10
  && (await text('[data-bdc-more="ceiling"]')) === 'Show all 13', await text('[data-bdc-more="ceiling"]'));
await click('[data-bdc-more="ceiling"]');
check('show all -> 13, smallest last; again -> 10', (await evalJS(`document.querySelectorAll('[data-bdc-row="ceiling"]').length`)) === 13
  && (await keys('ceiling')).endsWith(',X01') && (await click('[data-bdc-more="ceiling"]'), (await evalJS(`document.querySelectorAll('[data-bdc-row="ceiling"]').length`)) === 10));

console.log('\n[7] Arabic + RTL, then a 390 px phone');
await evalJS(`window.__seedAll()`);
await evalJS(`window.__setLang('ar')`);
await remount();
await waitFor(q('[data-bd="tiles"]'), 'tiles (ar)');
check('page is RTL', (await evalJS(`document.documentElement.dir`)) === 'rtl');
check('title «لوحة متابعة تطوير الأعمال»', (await text('h1')) === 'لوحة متابعة تطوير الأعمال');
check('tile labels in Arabic', (await text('[data-bd-kpi="ceiling"] div')) === 'إجمالي الحدود القصوى'
  && (await text('[data-bd-kpi="renewals"] div')) === 'تجديدات خلال تسعين يومًا' && (await text('[data-bd-kpi="suppliers"] div')) === 'عقود الموردين السارية');
check('Western digits in Arabic too, like the rest of the app (ar-EG-u-nu-latn): 3 clients, 2,250.5 ceiling', (await tile('clients')) === '3' && (await tile('ceiling')) === '2,250.5', `${await tile('clients')} ${await tile('ceiling')}`);
check('unit «مليون جنيه», edits line in Arabic', (await text('[data-bd-kpi="ceiling"]')).includes('مليون جنيه')
  && (await text('[data-bd="edits"]')).startsWith('السجلات المعدَّلة في eTaske منذ آخر تحميل'));
check('chart titles in Arabic', (await texts('[data-bdc] .bdc-h')) === 'الحد الأقصى للعقود لكل عميل|مواعيد تجديد العقود|الفئة اليومية لكل عميل|إعادة التسعير عند التجديد'
  + '|تكلفة عقود الموردين|أكبر زيادة في القيمة عبر الملاحق|أوامر الخدمة في عجيبة|ما تغيّر بين تقريري عقود الخدمات|ملاحظات البيانات حسب الجدول|بيانات منتظَرة', await texts('[data-bdc] .bdc-h'));
check('charts 7–12 in Arabic: cost type, SO status, sheet name, change period translated; contractor as written',
  (await text('[data-bdc-row="costtype"][data-bdc-key="EPROM overhead"] .bdc-name > span')) === 'مصروفات إيبروم العامة'
  && (await text('[data-bdc-row="sostatus"][data-bdc-key="In Progress"] .bdc-name')) === 'قيد التنفيذ'
  && (await text('[data-bdc-row="issue"][data-bdc-key="Day Rates"] .bdc-name > span')) === 'الفئات اليومية'
  && (await text('[data-bdc="changes"] .bdc-cap')).startsWith('من مارس 2026 إلى سبتمبر 2026')
  && (await text('[data-bdc-row="socontractor"][data-bdc-key="Petro"] .bdc-name > span')) === 'Petro',
  `${await text('[data-bdc-row="costtype"][data-bdc-key="EPROM overhead"] .bdc-name > span')} | ${await text('[data-bdc="changes"] .bdc-cap')}`);
check('RTL: the "from → to" arrow is flipped to point left', (await evalJS(`getComputedStyle(${q('.bdc-arrow')}).transform`)) !== 'none');
check('client names in Arabic on the charts (ANOPC has no Arabic name here -> its code)',
  (await text('[data-bdc-row="ceiling"][data-bdc-key="ALPHA"] .bdc-name > span')) === 'ألفا للغاز'
  && (await text('[data-bdc-bench="anopc"]')) === 'ANOPC' && (await text('[data-bdc-grade="General Manager"]')) === 'مدير عام');
check('Arabic list comma, signed gap −30.0%', (await text('[data-bdc-row="ceiling"][data-bdc-key="ALPHA"] .bdc-sub')).startsWith('CSA، TSA')
  && (await text('[data-bdc-row="rate"][data-bdc-key="BETA"] [data-bdc-gap]')) === '−30.0%');
check('RTL: bars grow from the right, benchmark tick still on ANOPC\'s bar end', await evalJS(`(() => {
  const r = document.querySelector('[data-bdc-row="rate"][data-bdc-key="ANOPC"]'), t = r.querySelector('.bdc-track').getBoundingClientRect();
  const f = r.querySelector('.bdc-fill').getBoundingClientRect(), m = r.querySelector('.bdc-mark').getBoundingClientRect();
  return Math.abs(f.right - t.right) <= 1 && Math.abs((m.right - 1) - f.left) <= 2; })()`));
await shot('3-ar');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(250);
check('390 px Arabic: no sideways scroll', (await overflow()) <= 1, String(await overflow()));
const cols = await evalJS(`new Set([...document.querySelectorAll('[data-bd-kpi]')].map(e => Math.round(e.getBoundingClientRect().left))).size`);
check('390 px: tiles stack two per row at most', cols <= 2, String(cols));
await shot('4-ar-mobile');
await evalJS(`window.__setLang('en')`);
await sleep(200);
check('390 px English: no sideways scroll', (await overflow()) <= 1, String(await overflow()));
await shot('5-en-mobile');
await evalJS(`document.documentElement.setAttribute('data-theme', 'dark')`);
await sleep(150);
check('dark: chart colours switch to the light-on-dark tokens', (await evalJS(`getComputedStyle(${q('.bdc')}).getPropertyValue('--bdc-supplier').trim()`)) === '#2dd4bf');
check('390 px dark: no sideways scroll', (await overflow()) <= 1, String(await overflow()));
await shot('6-en-mobile-dark');
await evalJS(`document.documentElement.removeAttribute('data-theme')`);
await send('Emulation.clearDeviceMetricsOverride');

console.log('\n[8] nothing loaded yet');
await evalJS(`(() => { for (const k of [...__store.keys()]) if (k.startsWith('bdControl')) __store.delete(k); })()`);
await remount();
await waitFor(q('[data-bd="empty"]'), 'empty card');
check('empty: plain sentence, no tiles, no strip', (await text('[data-bd="empty"]')) === 'No BD control data has been loaded yet.'
  && !(await has('[data-bd="tiles"]')) && !(await has('[data-bd="date-strip"]')) && !(await has('[data-bd="charts"]')));
await evalJS(`(() => { __seed('bdControl', 'meta', { asof: window.__iso(-1) }); __emit(); })()`);
await waitFor(q('[data-bd="charts"]'), 'charts with meta only');
check('meta but no rows: each chart says so in a sentence', (await text('[data-bdc-empty="ceiling"]')) === 'No client line has a ceiling on file.'
  && (await text('[data-bdc-empty="next"]')) === 'Nothing is due from today on.'
  && (await text('[data-bdc-empty="rates"]')) === 'No day-rate sheet has been loaded.'
  && (await text('[data-bdc-empty="reprice"]')) === 'No client pays 10% or more below ANOPC.');
check('… and charts 7–12 too (no awaited list on the meta = "no list on file")', (await text('[data-bdc-empty="suppliers"]')) === 'No live supplier contract on file.'
  && (await text('[data-bdc-empty="growth"]')) === 'No live supplier contract has both an original and a current value.'
  && (await text('[data-bdc-empty="agiba"]')) === 'No AGIBA service order on file.'
  && (await text('[data-bdc-empty="changes"]')) === 'No changes between reports on file.'
  && (await text('[data-bdc-empty="issues"]')) === 'No data issues — the files are clean.'
  && (await text('[data-bdc-empty="awaited"]')) === 'No list of awaited data on file.');

console.log('\n[9] someone the rules refuse');
await evalJS(`window.__seedAll(); ['bdControl', ...window.__lib.BD_TABLES.map(t => 'bdControl/' + t + '/rows')].forEach(c => window.__denied.add(c))`);
await remount();
await waitFor(q('[data-bd="error"]'), 'the error card');
check('permission-denied: managers-only explanation, no tiles', (await text('[data-bd="error"]')).startsWith('The BD control data could not be opened')
  && !(await has('[data-bd="tiles"]')));
await evalJS(`window.__denied = new Set(['bdControl/dataIssues/rows'])`);
await remount();
await waitFor(q('[data-bd="error"]'), 'error card (one table)');
check('one table refused is enough to show the error (no half totals)', !(await has('[data-bd="tiles"]')));
await evalJS(`window.__denied = new Set()`);
check('no page errors', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 800)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/bdcontrolui-failure.png');
    fs.writeFileSync(p, Buffer.from(s.data, 'base64'));
    console.log(`  screenshot: ${p}`);
  } catch { /* best effort */ }
}

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
try { ws.close(); } catch {}
edge.kill();
await sleep(300);
try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
