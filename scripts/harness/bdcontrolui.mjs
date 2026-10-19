// Click-through harness for the BD control page (queues E5a + E5b charts 3–6 + E5c charts 7–12 + E6a browse tabs + E6b editing).
//
// Proves src/BdControlDashboard.tsx + src/lib/bdControl.ts + src/hooks/useBdControl.ts
// in real Edge: the pure maths (days, flags, live/EGP rules, millions, edits since
// load), every KPI tile worked out from rows as of today, the data-date strip
// (loaded by, edits since load, stale warning), figures following a change in the
// rows with no reload, charts 3–6 (ceilings, renewal timeline, day-rate vs
// ANOPC/median with grade chips, reprice list), charts 7–12 (supplier cost, amendment growth, AGIBA SOs,
// report-to-report changes, data issues per sheet, awaited data flipping as it arrives), the empty and
// permission-denied states, the role gate and the 6 nav entries, the browse tabs (Contracts + client page,
// Pricing grid, Suppliers, Data quality, and the tiles / chart rows that open them), Arabic + RTL, a 390 px
// phone and dark mode. Editing (E6b): the form per record type, what a save writes (field + appEdits note with the
// Excel value + stamps + one history doc per field, in one batch), the badge, the change log, bad input, a refused
// save, figures following an edit, no Edit button for someone who may not edit, Arabic + phone.
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
const BATCH_NOOP = 'export function writeBatch() { return { set() {}, update() {}, delete() {}, commit: async () => {} }; }';
if (!STUB.includes(BATCH_NOOP)) throw new Error('writeBatch stub not found');
const STUB2 = STUB.replace(BATCH_NOOP, `
const deep = v => (v && v.__serverTimestamp) ? stamp() : (v && typeof v === 'object' && !Array.isArray(v) && typeof v.seconds !== 'number')
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v;
export function writeBatch() {
  const ops = [];
  return {
    set(ref, data) { ops.push(['set', ref, data]); },
    update(ref, data) { ops.push(['update', ref, data]); },
    delete(ref) { ops.push(['delete', ref]); },
    commit: async () => {
      if (globalThis.__batchFail) { const e = new Error('refused'); e.code = globalThis.__batchFail; throw e; }
      globalThis.__batches = (globalThis.__batches || 0) + 1;
      for (const [op, ref, data] of ops) {
        if (op === 'update') await updateDoc(ref, deep(data));
        else if (op === 'set') await setDoc(ref, deep(data));
        else await deleteDoc(ref);
      }
    },
  };
}`);

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
      contents: args.path === 'stub-firestore' ? STUB2
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
import * as edit from './src/lib/bdControlEdit';
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

window.__lib = lib; window.__edit = edit; window.__access = access; window.__iso = iso; window.__ts = ts; window.__ago = ago;
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

console.log('\n[6c] browse tabs (queue E6a): Contracts + client page, Pricing, Suppliers, Data quality');
const typeIn = (sel, v) => evalJS(`(() => { const e = ${q(sel)}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`).then(() => sleep(150));
const count = sel => evalJS(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const pressed = sel => evalJS(`${q(sel)}?.getAttribute('aria-pressed')`);
const L3 = JSON.parse(await evalJS(`(() => { const L = window.__lib;
  const codes = new Set(['ALPHA', 'BETA']);
  return JSON.stringify({
    m: [L.matches('', 'x'), L.matches('alp gas', 'ALPHA', 'Alpha Gas Co.'), L.matches('alp oil', 'ALPHA', 'Alpha Gas Co.'), L.matches('ألفا', null, 'ألفا للغاز')],
    tg: [L.issueTarget({ table: 'Client Contracts', record: 'BETA O&M' }, codes), L.issueTarget({ table: 'Day Rates', record: 'ALPHA' }, codes),
         L.issueTarget({ table: 'Day Rates', record: 'EPS' }, codes), L.issueTarget({ table: 'Supplier Contracts', record: '398/2018' }, codes),
         L.issueTarget({ table: 'AGIBA SOs', record: 'SO 70-2024' }, codes), L.issueTarget({ table: 'AGIBA Site Contracts', record: '549/2023 B' }, codes),
         L.issueTarget({ table: 'Supplier Amendments', record: '9 rows' }, codes), L.issueTarget({ table: 'Client Contracts', record: '' }, codes)],
  }); })()`));
check('matches: empty = all, every word must appear, Arabic too', J(L3.m) === J([true, true, false, true]), J(L3.m));
check('issueTarget: client line / day-rate column -> client page, supplier / SO / site -> search, a whole-sheet note -> nowhere',
  J(L3.tg) === J([{ kind: 'client', code: 'BETA' }, { kind: 'client', code: 'ALPHA' }, null, { kind: 'supplier', query: '398/2018' },
    { kind: 'agibaSO', query: 'SO 70-2024' }, { kind: 'agibaSite', query: '549/2023' }, null, null]), J(L3.tg));

await evalJS(`window.__seedAll()`);
await remount();
await waitFor(q('[data-bd="tiles"]'), 'tiles');
check('tab bar: Overview · Contracts · Pricing · Suppliers · Data quality, Overview selected',
  (await texts('[data-bd-tab]')) === 'Overview|Contracts|Pricing|Suppliers|Data quality'
  && (await evalJS(`${q('[data-bd-tab="overview"]')}.getAttribute('aria-selected')`)) === 'true');

// Contracts
await click('[data-bd-tab="contracts"]');
check('Contracts: tiles and charts give way to the list', !(await has('[data-bd="tiles"]')) && !(await has('[data-bd="charts"]')) && (await has('[data-bdc-tab="contracts"]'))
  && (await has('[data-bd="date-strip"]')));
check('every line, soonest expiry first, no date last', (await keys('contract')) === 'BETA_3_TSA,BETA_2_CSA,GAMMA_4_O-M,ALPHA_1_CSA,ALPHA_5_TSA', await keys('contract'));
check('chip counts: all 5 · expired 1 · ≤90 d 1 · ≤6 months 2 · no date 1',
  (await texts('[data-bdc-chip^="contracts:"] .bdc-chip-n')) === '5|1|1|2|1', await texts('[data-bdc-chip^="contracts:"] .bdc-chip-n'));
check('line shows status, value and flag: BETA TSA blank status, expired, no ceiling',
  (await text('[data-bdc-row="contract"][data-bdc-key="BETA_3_TSA"] .bdc-sub')).includes('Status blank')
  && (await text('[data-bdc-row="contract"][data-bdc-key="BETA_3_TSA"] [data-bdc-flag]')) === 'Expired on paper'
  && (await text('[data-bdc-row="contract"][data-bdc-key="GAMMA_4_O-M"] .bdc-sub')).includes('350,000 EGP a month'),
  await text('[data-bdc-row="contract"][data-bdc-key="GAMMA_4_O-M"] .bdc-sub'));
await click('[data-bdc-chip="contracts:expired"]');
check('chip "Expired on paper" -> the one line', (await keys('contract')) === 'BETA_3_TSA' && (await text('[data-bdc-count="contracts"]')) === 'Showing 1 of 5');
await click('[data-bdc-chip="contracts:all"]');
await typeIn('[data-bdc-search="contracts"]', 'ألفا');
check('search by the Arabic name finds ALPHA\'s two lines', (await keys('contract')) === 'ALPHA_1_CSA,ALPHA_5_TSA', await keys('contract'));
await typeIn('[data-bdc-search="contracts"]', 'zzz');
check('no match -> a sentence', (await text('[data-bdc-empty="contracts"]')) === 'No contract line matches.');
await typeIn('[data-bdc-search="contracts"]', '');

// Client page
await click('[data-bdc-row="contract"][data-bdc-key="BETA_2_CSA"]');
await waitFor(q('[data-bdc-tab="client"]'), 'client page');
check('a line opens its client page: BETA, both lines, 800.5 m EGP ceiling', (await evalJS(`${q('[data-bdc-tab="client"]')}.dataset.bdcCode`)) === 'BETA'
  && (await text('[data-bdc-fig="lines"]')) === '2' && (await text('[data-bdc-fig="ceiling"]')) === '800.5 m EGP'
  && (await keys('clientline')) === 'BETA_3_TSA,BETA_2_CSA', `${await text('[data-bdc-fig="ceiling"]')} ${await keys('clientline')}`);
check('client day-rates in grade order with the gap to ANOPC; average −20.0%',
  (await keys('clientrate')) === 'General Manager,Senior Engineer,Operator'
  && (await text('[data-bdc-row="clientrate"][data-bdc-key="General Manager"] [data-bdc-gap]')) === '−30.0%'
  && (await text('[data-bdc-fig="gap"]')) === '−20.0%', `${await keys('clientrate')} ${await text('[data-bdc-fig="gap"]')}`);
check('its supplier contracts (live first, completed shows Ended), its changes and its data issue',
  (await keys('clientsupplier')) === 'S/2,S/3' && (await text('[data-bdc-row="clientsupplier"][data-bdc-key="S/3"] [data-bdc-flag]')) === 'Ended'
  && (await count('[data-bdc-row="clientchange"]')) === 2 && (await count('[data-bdc-row="clientissue"]')) === 1 && (await text('[data-bdc-fig="issues"]')) === '1',
  `${await keys('clientsupplier')} ${await count('[data-bdc-row="clientchange"]')} ${await count('[data-bdc-row="clientissue"]')}`);
check('Contracts tab stays selected on the client page', (await evalJS(`${q('[data-bd-tab="contracts"]')}.getAttribute('aria-selected')`)) === 'true');
await click('[data-bdc-row="clientsupplier"][data-bdc-key="S/2"]');
await waitFor(q('[data-bdc-tab="suppliers"]'), 'suppliers tab');
check('a supplier row opens Suppliers searched to that contract, opened, with its amendment',
  (await evalJS(`${q('[data-bdc-search="suppliers"]')}.value`)) === 'S/2' && (await keys('supplier')) === 'S/2'
  && (await evalJS(`${q('[data-bdc-row="supplier"]')}.open`)) === true && (await count('[data-bdc-row="amendment"]')) === 1
  && (await pressed('[data-bdc-chip="supfilter:all"]')) === 'true', await keys('supplier'));
check('supplier details: client link, cost type, growth since signing +25.0%',
  (await text('[data-bdc-fields="supplier"]')).includes('EPROM overhead') && (await text('[data-bdc-fields="supplier"]')).includes('+25.0%'),
  await text('[data-bdc-fields="supplier"]'));
await click('[data-bdc-fields="supplier"] .bdc-link');
check('the client link goes back to the BETA page', (await evalJS(`${q('[data-bdc-tab="client"]')}?.dataset.bdcCode`)) === 'BETA');
await click('[data-bdc="back"]');
check('back -> the list, search kept clear', (await has('[data-bdc-tab="contracts"]')) && (await count('[data-bdc-row="contract"]')) === 5);

// Pricing
await click('[data-bd-tab="pricing"]');
check('Pricing grid: columns = graded rates only (no Section Head), rows furthest below ANOPC first',
  (await evalJS(`[...document.querySelectorAll('[data-bdc-grade-col]')].map(e => e.dataset.bdcGradeCol).join(',')`)) === 'General Manager,Senior Engineer,Operator'
  && (await keys('price')) === 'BETA,DELTA,GAMMA,ANOPC,ALPHA', await keys('price'));
check('cells coloured by gap: BETA GM red (−30%), DELTA GM amber (−20%), ALPHA GM green (+20%), DELTA has no Operator rate',
  (await evalJS(`${q('[data-bdc-row="price"][data-bdc-key="BETA"] [data-bdc-cell="General Manager"]')}.className`)).includes('bdc-cell-lo')
  && (await evalJS(`${q('[data-bdc-row="price"][data-bdc-key="DELTA"] [data-bdc-cell="General Manager"]')}.className`)).includes('bdc-cell-mid')
  && (await evalJS(`${q('[data-bdc-row="price"][data-bdc-key="ALPHA"] [data-bdc-cell="General Manager"]')}.className`)).includes('bdc-cell-hi')
  && (await text('[data-bdc-row="price"][data-bdc-key="DELTA"] [data-bdc-cell="Operator"]')) === '—');
check('average gap column + benchmark row + ⚠ on BETA', (await text('[data-bdc-row="price"][data-bdc-key="BETA"] [data-bdc-avg]')) === '−20.0%'
  && (await text('[data-bdc-row="benchrow"]')).startsWith('ANOPC10,0005,0003,000') && (await has('[data-bdc-row="price"][data-bdc-key="BETA"] [data-bdc-warn]')),
  await text('[data-bdc-row="benchrow"]'));
await click('[data-bdc-chip="bench:median"]');
check('median benchmark: row says "Median client", GM median 9,500', (await text('[data-bdc-row="benchrow"]')).startsWith('Median client9,500'), await text('[data-bdc-row="benchrow"]'));
await click('[data-bdc-chip="bench:anopc"]');
await click('[data-bdc-open="DELTA"]');
check('a name opens the client page — DELTA has rates but no client line', (await evalJS(`${q('[data-bdc-tab="client"]')}?.dataset.bdcCode`)) === 'DELTA'
  && (await count('[data-bdc-row="clientrate"]')) === 2 && (await text('[data-bdc-client="lines"] .bdc-empty')) === 'No client line on file');

// Suppliers
await click('[data-bd-tab="suppliers"]');
await typeIn('[data-bdc-search="suppliers"]', '');
check('Suppliers chip counts: running 4 · ≤90 d 1 · past date 1 · ended/on hold 3 · all 6',
  (await texts('[data-bdc-chip^="supfilter:"] .bdc-chip-n')) === '4|1|1|3|6', await texts('[data-bdc-chip^="supfilter:"] .bdc-chip-n'));
await click('[data-bdc-chip="supfilter:ended"]');
check('ended: the On Hold one first (still listed live), then completed / cancelled', (await keys('supplier')) === 'S/5,S/3,S/6', await keys('supplier'));
await click('[data-bdc-chip="supfilter:live"]');
check('running: soonest end first, the USD one shows its note not an EGP value', (await keys('supplier')) === 'S/5,S/2,S/1,S/4'
  && (await text('[data-bdc-row="supplier"][data-bdc-key="S/4"] .bdc-sub')).includes('20,000 USD'), await keys('supplier'));
await click('[data-bdc-chip="supview:agibaSite"]');
check('AGIBA site contracts, soonest end first, no date last', (await keys('site')) === 'A/1,A/2,A/3', await keys('site'));
await click('[data-bdc-chip="supview:agibaSO"]');
await click('[data-bdc-chip="soopen:open"]');
check('open AGIBA SOs (cancelled + completed left out), past-date one first and red',
  (await keys('so')) === 'SO 3-2026,SO 1-2026,SO 6-2026,SO 4-2026'
  && (await evalJS(`${q('[data-bdc-row="so"][data-bdc-key="SO 3-2026"] [data-bdc-so]')}.className`)).includes('bdc-pill-lo'), await keys('so'));
await click('[data-bdc-chip="soopen:all"]');
check('all SOs: 6, open ones first', (await count('[data-bdc-row="so"]')) === 6 && (await keys('so')).endsWith('SO 2-2026,SO 5-2026'), await keys('so'));

// Data quality
await click('[data-bd-tab="quality"]');
check('Data quality: every issue, chips per sheet', (await count('[data-bdc-row="dq"]')) === 6
  && (await texts('[data-bdc-chip^="sheet:"]')) === 'All sheets6|Client Contracts4|Day Rates2', await texts('[data-bdc-chip^="sheet:"]'));
await click('[data-bdc-chip="sheet:Day Rates"]');
check('Day Rates: BETA opens (button), EPS has no client so it is plain text',
  (await keys('dq')) === 'Day-Rates_1,Day-Rates_2'
  && (await evalJS(`${q('[data-bdc-row="dq"][data-bdc-key="Day-Rates_1"]')}.tagName`)) === 'BUTTON'
  && (await evalJS(`${q('[data-bdc-row="dq"][data-bdc-key="Day-Rates_2"]')}.tagName`)) === 'DIV', await keys('dq'));
await typeIn('[data-bdc-search="quality"]', 'lower grade');
check('search within the sheet', (await keys('dq')) === 'Day-Rates_1');
await click('[data-bdc-row="dq"][data-bdc-key="Day-Rates_1"]');
check('an issue opens its record: BETA client page', (await evalJS(`${q('[data-bdc-tab="client"]')}?.dataset.bdcCode`)) === 'BETA');

// Tiles and overview rows lead into the tabs
await click('[data-bd-tab="overview"]');
await click('[data-bd-kpi="renewals"]');
check('Renewals tile -> Contracts, "within 90 days" chip on', (await has('[data-bdc-tab="contracts"]')) && (await pressed('[data-bdc-chip="contracts:d90"]')) === 'true'
  && (await keys('contract')) === 'BETA_2_CSA');
await click('[data-bd-tab="overview"]');
await click('[data-bd-kpi="suppliers"]');
check('Live suppliers tile -> Suppliers, running', (await has('[data-bdc-tab="suppliers"]')) && (await pressed('[data-bdc-chip="supfilter:live"]')) === 'true'
  && (await pressed('[data-bdc-chip="supview:supplier"]')) === 'true');
await click('[data-bd-tab="overview"]');
await click('[data-bd-kpi="issues"]');
check('Data issues tile -> Data quality, all sheets', (await has('[data-bdc-tab="quality"]')) && (await pressed('[data-bdc-chip="sheet:"]')) === 'true');
await click('[data-bd-tab="overview"]');
await click('[data-bdc-row="ceiling"][data-bdc-key="ALPHA"]');
check('ceiling chart row -> ALPHA client page', (await evalJS(`${q('[data-bdc-tab="client"]')}?.dataset.bdcCode`)) === 'ALPHA');
await click('[data-bd-tab="overview"]');
await click('[data-bdc-row="reprice"][data-bdc-key="BETA"]');
check('reprice row -> BETA client page', (await evalJS(`${q('[data-bdc-tab="client"]')}?.dataset.bdcCode`)) === 'BETA');
await click('[data-bd-tab="overview"]');
await click('[data-bdc-row="next"][data-bdc-key="BETA"]');
check('a client in "next to come up" -> its page; supplier items are not clickable', (await evalJS(`${q('[data-bdc-tab="client"]')}?.dataset.bdcCode`)) === 'BETA');
await click('[data-bd-tab="overview"]');
check('… and a supplier item there has no button role', (await evalJS(`${q('[data-bdc-row="next"][data-bdc-key="S/1"]')}.getAttribute('role')`)) === null);
await shot('7-tabs-en');

// Phone width on the browse tabs
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(250);
for (const tb of ['contracts', 'pricing', 'suppliers', 'quality']) {
  await click(`[data-bd-tab="${tb}"]`);
  if (tb === 'suppliers') await click('[data-bdc-chip="supview:supplier"]');
  check(`390 px ${tb}: no sideways scroll (the grid scrolls inside its box)`, (await overflow()) <= 1, String(await overflow()));
}
await click('[data-bd-tab="contracts"]');
await click('[data-bdc-row="contract"][data-bdc-key="BETA_2_CSA"]');
check('390 px client page: no sideways scroll', (await overflow()) <= 1, String(await overflow()));
await shot('8-client-mobile');
await send('Emulation.clearDeviceMetricsOverride');

// Arabic labels on the tabs
await evalJS(`window.__setLang('ar')`);
await sleep(200);
check('Arabic tab names', (await texts('[data-bd-tab]')) === 'نظرة عامة|العقود|التسعير|الموردون|جودة البيانات', await texts('[data-bd-tab]'));
check('Arabic client page: Arabic name as title, flag in Arabic', (await text('.bdc-title')) === 'بيتا للتكرير'
  && (await text('[data-bdc-row="clientline"][data-bdc-key="BETA_3_TSA"] [data-bdc-flag]')) === 'انتهى على الورق');
await evalJS(`window.__setLang('en')`);
await sleep(150);

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

console.log('\n[10] editing (E6b)');
await evalJS(`window.__seedAll(); window.__writes.length = 0; window.__batches = 0; window.__batchFail = null`);
await remount();
await waitFor(q('[data-bd="tiles"]'), 'tiles (edit)');
const E = JSON.parse(await evalJS(`(() => { const E = window.__edit, i = window.__iso;
  const beta = window.__store.get('bdControl/clientContracts/rows').get('BETA_2_CSA');
  const row = { id: 'BETA_2_CSA', ...beta };
  const d0 = E.diffForm('clientContracts', row, { expiryDate: i(45), ceilingEgp: '800,500,000', status: 'Valid' });
  const d1 = E.diffForm('clientContracts', row, { expiryDate: i(50), ceilingEgp: '900000000', status: 'Valid' });
  const d2 = E.diffForm('clientContracts', row, { ceilingEgp: 'abc', expiryDate: '31/12/2026' });
  const pl = E.planEdit(row, d1.changes, { uid: 'u-x', name: 'Sam' }, 'STAMP');
  return JSON.stringify({
    n: ['1,250,000', '١٢٣', '-4.5', 'abc', '', '  '].map(x => E.fromInput(x, 'number')),
    d: [E.fromInput('2027-01-31', 'date'), E.fromInput('31/01/2027', 'date')],
    ti: [E.toInput('2027-01-31T00:00:00', 'date'), E.toInput(null, 'text'), E.toInput(12.5, 'number')],
    d0: d0.changes.length, d1: d1.changes.map(c => c.field + ':' + c.to), bad: d2.bad,
    ae: pl.update.appEdits, by: pl.update.lastEditedBy, at: pl.update.lastEditedAt, h: pl.history,
    tables: E.EDIT_TABLES, sug: E.suggestions([{ s: 'A' }, { s: 'B' }, { s: 'A' }, { s: null }, { s: ' ' }], 's'),
  }); })()`));
check('number input: commas and Arabic digits read, words refused, blank = null',
  J(E.n) === J([{ ok: true, value: 1250000 }, { ok: true, value: 123 }, { ok: true, value: -4.5 }, { ok: false }, { ok: true, value: null }, { ok: true, value: null }]), J(E.n));
check('date input: ISO only; stored ISO-with-time shows as the date', J(E.d) === J([{ ok: true, value: '2027-01-31' }, { ok: false }]) && J(E.ti) === J(['2027-01-31', '', '12.5']), J(E.ti));
check('an untouched form (or the same number typed with commas) changes nothing', E.d0 === 0, String(E.d0));
check('changed fields found, bad number + bad date reported', J(E.d1) === J(['expiryDate:' + await evalJS(`window.__iso(50)`), 'ceilingEgp:900000000']) && J(E.bad) === J(['expiryDate', 'ceilingEgp']), J(E.d1) + J(E.bad));
check('plan: earlier note kept with its FIRST Excel value; new field remembers what Excel had; stamps = uid + server time',
  E.ae.expiryDate.excelValue === await evalJS(`window.__iso(40)`) && E.ae.expiryDate.byName === 'Sam' && E.ae.ceilingEgp.excelValue === 800500000
  && E.ae.ceilingEgp.at === 'STAMP' && E.by === 'u-x' && E.at === 'STAMP', J(E.ae));
check('plan: one history doc per field {field, from, to, byUid, byName, at} (the rules\' key list)',
  E.h.length === 2 && J(Object.keys(E.h[0]).sort()) === J(['at', 'byName', 'byUid', 'field', 'from', 'to']) && E.h[1].from === 800500000 && E.h[1].to === 900000000, J(E.h));
check('editable tables: client lines, day-rates, supplier contracts, AGIBA site contracts, AGIBA SOs', J(E.tables) === J(['clientContracts', 'dayRates', 'supplierContracts', 'agibaSiteContracts', 'agibaSOs']), J(E.tables));
check('suggestions: distinct values, most used first, blanks dropped', J(E.sug) === J(['A', 'B']), J(E.sug));
const ruleKeys = src('firestore.rules');
const fieldsOk = await evalJS(`JSON.stringify(Object.entries(window.__edit.EDIT_FIELDS).flatMap(([t, fs]) => fs.map(f => t + '.' + f.key)))`);
const missing = JSON.parse(fieldsOk).filter(tk => { const [t, k] = tk.split('.'); const m = ruleKeys.match(new RegExp(`'${t}': \\[([^\\]]*)\\]`)); return !m || !m[1].includes(`'${k}'`); });
check('every field the form offers is on the rules\' edit list for its table', missing.length === 0, missing.join(', '));

const setVal = (sel, v) => evalJS(`(() => { const e = ${q(sel)}; const P = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(P.prototype, 'value').set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`).then(() => sleep(120));
const dlg = '[data-bdc-dialog]';
const row = (t, id) => evalJS(`JSON.stringify(window.__store.get('bdControl/${t}/rows').get(${JSON.stringify(id)}))`).then(JSON.parse);
const hist = (t, id) => evalJS(`JSON.stringify([...(window.__store.get('bdControl/${t}/rows/${id}/history') || new Map()).values()])`).then(JSON.parse);

const ceil0 = await tile('ceiling');
const edits0 = await text('[data-bd="edits"]');
await click('[data-bd-tab="contracts"]');
check('Contracts list: "Edited in eTaske" badge on the edited line only', (await keys('contract')).includes('BETA_2_CSA')
  && (await has('[data-bdc-row="contract"][data-bdc-key="BETA_2_CSA"] [data-bdc-edited]')) && !(await has('[data-bdc-row="contract"][data-bdc-key="ALPHA_1_CSA"] [data-bdc-edited]')));
check('… and no Edit button inside the clickable list rows', !(await has('[data-bdc-row="contract"] [data-bdc-edit]')));
await click('[data-bdc-row="contract"][data-bdc-key="ALPHA_1_CSA"]');
check('client page: an Edit button on each contract line and each day-rate', (await count('[data-bdc-row="clientline"] [data-bdc-edit]')) === 2
  && (await count('[data-bdc-row="clientrate"] [data-bdc-edit]')) === 3, `${await count('[data-bdc-row="clientline"] [data-bdc-edit]')} ${await count('[data-bdc-row="clientrate"] [data-bdc-edit]')}`);
await click('[data-bdc-edit="clientContracts:ALPHA_1_CSA"]');
await waitFor(q(dlg), 'edit dialog');
check('form: title names the line, fields filled from the row, nothing changed yet, Save off',
  (await text('#bdc-edit-title')) === 'Edit ALPHA · CSA' && (await evalJS(`${q('[data-bdc-field="ceilingEgp"]')}.value`)) === '1200000000'
  && (await evalJS(`${q('[data-bdc-field="expiryDate"]')}.value`)) === await evalJS(`window.__iso(200)`)
  && (await text('[data-bdc="change-count"]')) === 'Nothing changed yet' && (await evalJS(`${q('[data-bdc="save"]')}.disabled`)) === true, await text('#bdc-edit-title'));
check('form: the status field suggests the words already used', (await evalJS(`[...document.querySelectorAll('#bdc-l-status option')].map(o => o.value).join(',')`)) === 'Valid,Signing');
check('change log: empty sentence for a never-edited line', (await text('[data-bdc-empty="log"]')) === 'No changes made in eTaske yet.');
await setVal('[data-bdc-field="ceilingEgp"]', '1,3OO');
check('a number with letters: field marked, message, Save off', (await has('[data-bdc-bad="ceilingEgp"]')) && (await evalJS(`${q('[data-bdc="save"]')}.disabled`)) === true);
await setVal('[data-bdc-field="ceilingEgp"]', '1,300,000,000');
await setVal('[data-bdc-field="comments"]', 'Renewal letter sent');
check('two fields changed, Save on', (await text('[data-bdc="change-count"]')) === 'Fields changed: 2' && (await evalJS(`${q('[data-bdc="save"]')}.disabled`)) === false);
await click('[data-bdc="save"]');
await waitFor(`!${q(dlg)}`, 'dialog closes after save');
const a1 = await row('clientContracts', 'ALPHA_1_CSA');
check('saved: new values on the row', a1.ceilingEgp === 1300000000 && a1.comments === 'Renewal letter sent' && a1.status === 'Valid', J(a1));
check('saved: a note per field with the Excel value + editor name, stamps = uid + server time',
  a1.appEdits.ceilingEgp.excelValue === 1200000000 && a1.appEdits.comments.excelValue === null && a1.appEdits.ceilingEgp.byName === 'Mona Manager'
  && typeof a1.appEdits.ceilingEgp.at?.seconds === 'number' && a1.lastEditedBy === 'u-mgr' && typeof a1.lastEditedAt?.seconds === 'number'
  && J(Object.keys(a1.appEdits).sort()) === J(['ceilingEgp', 'comments']), J(a1.appEdits));
const h1 = await hist('clientContracts', 'ALPHA_1_CSA');
check('saved: two history docs (field, from, to, who) in ONE batch', h1.length === 2 && (await evalJS(`window.__batches`)) === 1
  && h1.some(h => h.field === 'ceilingEgp' && h.from === 1200000000 && h.to === 1300000000 && h.byUid === 'u-mgr' && h.byName === 'Mona Manager'), J(h1));
check('the line now shows the badge on the client page', await has('[data-bdc-row="clientline"][data-bdc-key="ALPHA_1_CSA"] [data-bdc-edited]'));
await click('[data-bdc-edit="clientContracts:ALPHA_1_CSA"]');
await waitFor(q(dlg), 'edit dialog again');
check('re-open: each edited field shows the Excel value and who changed it', (await text('[data-bdc-note="ceilingEgp"]')).startsWith('Excel file: 1,200,000,000 · changed by Mona Manager'),
  await text('[data-bdc-note="ceilingEgp"]'));
check('re-open: the change log lists both changes', (await count('[data-bdc-row="log"]')) === 2 && (await texts('[data-bdc-row="log"]')).includes('1,200,000,000 → 1,300,000,000'), await texts('[data-bdc-row="log"]'));
await click('[data-bdc-revert="ceilingEgp"]');
check('"Use the Excel value" puts the Excel figure back in the box', (await evalJS(`${q('[data-bdc-field="ceilingEgp"]')}.value`)) === '1200000000'
  && (await text('[data-bdc="change-count"]')) === 'Fields changed: 1');
await evalJS(`window.__batchFail = 'permission-denied'`);
await click('[data-bdc="save"]');
await waitFor(q('[data-bdc="save-error"]'), 'save error');
check('a refused save: managers-only message, form stays open, nothing written', (await text('[data-bdc="save-error"]')).startsWith('Not saved: only managers')
  && (await has(dlg)) && (await row('clientContracts', 'ALPHA_1_CSA')).ceilingEgp === 1300000000);
await evalJS(`window.__batchFail = null`);
await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
await sleep(150);
check('Escape closes the form', !(await has(dlg)));
await click('[data-bd-tab="overview"]');
check('figures follow the edit: total ceiling 2,250.5 -> 2,350.5 m, edits line counts it', ceil0 === '2,250.5' && (await tile('ceiling')) === '2,350.5'
  && (await text('[data-bd="edits"]')) !== edits0, `${ceil0} -> ${await tile('ceiling')} | ${await text('[data-bd="edits"]')}`);

// A day-rate
await click('[data-bdc-row="ceiling"][data-bdc-key="BETA"]');
await click('[data-bdc-edit="dayRates:BETA_General-Manager"]');
await waitFor(q(dlg), 'day-rate dialog');
check('day-rate form: one field, title names client and grade', (await count('[data-bdc-field]')) === 1 && (await text('#bdc-edit-title')) === 'Edit BETA day rate · GM', await text('#bdc-edit-title'));
await setVal('[data-bdc-field="dayRateEgp"]', '7500');
await click('[data-bdc="save"]');
await waitFor(`!${q(dlg)}`, 'day-rate saved');
check('day-rate saved, badge on the rate row', (await row('dayRates', 'BETA_General-Manager')).dayRateEgp === 7500
  && (await has('[data-bdc-row="clientrate"][data-bdc-key="General Manager"] [data-bdc-edited]')));
await click('[data-bd-tab="pricing"]');
check('Pricing grid: the edited cell shows 7,500 with a ✎ mark and the legend explains it',
  (await text('[data-bdc-row="price"][data-bdc-key="BETA"] [data-bdc-cell="General Manager"]')).startsWith('7,500✎')
  && (await has('[data-bdc-editmark="BETA|General Manager"]')) && (await texts('.bdc-legend li')).includes('✎ = changed in eTaske'), await text('[data-bdc-row="price"][data-bdc-key="BETA"] [data-bdc-cell="General Manager"]'));

// A supplier contract: closing it moves it out of "running"
await click('[data-bd-tab="suppliers"]');
await click('[data-bdc-chip="supview:supplier"]');
await click('[data-bdc-chip="supfilter:live"]');
check('S/1 already carries the badge (edited before the load)', await has('[data-bdc-row="supplier"][data-bdc-key="S/1"] summary [data-bdc-edited]'));
await evalJS(`${q('[data-bdc-row="supplier"][data-bdc-key="S/2"]')}.open = true`);
await click('[data-bdc-edit="supplierContracts:S-2"]');
await waitFor(q(dlg), 'supplier dialog');
check('supplier form: title, client box suggests client codes, cost type suggests the words used',
  (await text('#bdc-edit-title')) === 'Edit supplier contract S/2'
  && (await evalJS(`[...document.querySelectorAll('#bdc-l-client option')].map(o => o.value).join(',')`)) === 'ALPHA,BETA,GAMMA,SUPX'
  && (await evalJS(`[...document.querySelectorAll('#bdc-l-costType option')].map(o => o.value)[0]`)) === 'Client project');
await setVal('[data-bdc-field="status"]', 'Completed');
await click('[data-bdc="save"]');
await waitFor(`!${q(dlg)}`, 'supplier saved');
check('closed in eTaske -> no longer running', !(await keys('supplier')).split(',').includes('S/2') && (await row('supplierContracts', 'S-2')).appEdits.status.excelValue === 'In Progress', await keys('supplier'));

// An AGIBA SO and a site contract
await click('[data-bdc-chip="supview:agibaSO"]');
await click('[data-bdc-chip="soopen:all"]');
await evalJS(`${q('[data-bdc-row="so"][data-bdc-key="SO 1-2026"]')}.open = true`);
await click('[data-bdc-edit="agibaSOs:SO-1-2026"]');
await waitFor(q(dlg), 'SO dialog');
await setVal('[data-bdc-field="expiry"]', await evalJS(`window.__iso(120)`));
await setVal('[data-bdc-field="remarks"]', 'Extended by site');
await click('[data-bdc="save"]');
await waitFor(`!${q(dlg)}`, 'SO saved');
const so1 = await row('agibaSOs', 'SO-1-2026');
check('SO saved (date + long text), badge on the SO row', so1.expiry === await evalJS(`window.__iso(120)`) && so1.remarks === 'Extended by site'
  && (await has('[data-bdc-row="so"][data-bdc-key="SO 1-2026"] [data-bdc-edited]')));
await click('[data-bdc-chip="supview:agibaSite"]');
await evalJS(`${q('[data-bdc-row="site"][data-bdc-key="A/3"]')}.open = true`);
await click('[data-bdc-edit="agibaSiteContracts:A-3"]');
await waitFor(q(dlg), 'site dialog');
await setVal('[data-bdc-field="currentEnd"]', await evalJS(`window.__iso(20)`));
await click('[data-bdc="save"]');
await waitFor(`!${q(dlg)}`, 'site saved');
check('site contract given an end date -> now first, ending within 90 days', (await keys('site')).startsWith('A/3')
  && (await text('[data-bdc-row="site"][data-bdc-key="A/3"] [data-bdc-flag]')) === 'Ends within 90 days', await keys('site'));

// Arabic + phone
await evalJS(`window.__setLang('ar')`);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(250);
await click('[data-bdc-edit="agibaSiteContracts:A-3"]');
await waitFor(q(dlg), 'site dialog (ar)');
check('Arabic form: title, labels, Excel note, log in Arabic', (await text('#bdc-edit-title')) === 'تعديل عقد موقع عجيبة A/3'
  && (await text('label[for="bdc-f-currentEnd"]')) === 'تاريخ الانتهاء الحالي' && (await text('[data-bdc-note="currentEnd"]')).startsWith('في ملف الإكسل: فارغ')
  && (await text('h3.bdc-h3')) === 'سجل التعديلات', `${await text('#bdc-edit-title')} | ${await text('[data-bdc-note="currentEnd"]')}`);
check('390 px: the form fits (no sideways scroll, inside the screen)', (await overflow()) <= 1
  && (await evalJS(`${q(dlg)}.getBoundingClientRect().width <= 390`)), String(await overflow()));
await shot('9-edit-ar-mobile');
await click('[data-bdc-dialog] .bdc-modal-head button');
await send('Emulation.clearDeviceMetricsOverride');
await evalJS(`window.__setLang('en')`);
await sleep(150);

// Someone who may not edit sees no Edit button (the page itself is gated for them anyway)
check('canEditBdControl: managers + admin, Approved only', J(await evalJS(`[{ role: 'Manager', status: 'Approved' }, { role: 'Admin', status: 'Approved' },
  { role: 'Employee', status: 'Approved' }, { role: 'Manager', status: 'Pending' }].map(window.__access.canEditBdControl)`)) === J([true, true, false, false]));
await evalJS(`window.__user = { ...window.__user, role: 'Employee' }`);
await remount();
await waitFor(q('[data-bd="tiles"]'), 'tiles (employee)');
await click('[data-bdc-row="ceiling"][data-bdc-key="ALPHA"]');
check('no Edit button without edit rights; badges still shown', (await count('[data-bdc-edit]')) === 0 && (await has('[data-bdc-edited]')));
await evalJS(`window.__user = { ...window.__user, role: 'Manager' }`);
await shot('10-edit-en');
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
