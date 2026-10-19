// Click-through harness for the BD control page (queue E5a).
//
// Proves src/BdControlDashboard.tsx + src/lib/bdControl.ts + src/hooks/useBdControl.ts
// in real Edge: the pure maths (days, flags, live/EGP rules, millions, edits since
// load), every KPI tile worked out from rows as of today, the data-date strip
// (loaded by, edits since load, stale warning), figures following a change in the
// rows with no reload, the empty and permission-denied states, the role gate and
// the 6 nav entries, Arabic + RTL and a 390 px phone. The page writes nothing.
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
  R('supplierContracts', 'S-1', { contractNo: 'S/1', status: 'In Progress', currentEnd: iso(30), currentValueEgp: 1000000, lastEditedAt: ts(ago(10)) });
  R('supplierContracts', 'S-2', { contractNo: 'S/2', status: 'In Progress', currentEnd: iso(-5), currentValueEgp: 2000000 });
  R('supplierContracts', 'S-3', { contractNo: 'S/3', status: 'Completed', currentEnd: iso(-100), currentValueEgp: 9999999 });
  R('supplierContracts', 'S-4', { contractNo: 'S/4', status: null, currentEnd: iso(400), currentValueEgp: 500000, valueCurrencyNote: '20,000 USD' });
  R('supplierContracts', 'S-5', { contractNo: 'S/5', status: 'On Hold', currentEnd: iso(-20), currentValueEgp: 300000 });
  R('supplierContracts', 'S-6', { contractNo: 'S/6', status: 'Cancelled', currentEnd: iso(10), currentValueEgp: 700000 });
  R('agibaSiteContracts', 'A-1', { contractNo: 'A/1', currentEnd: iso(60), status: 'ساري' });
  R('agibaSiteContracts', 'A-2', { contractNo: 'A/2', currentEnd: iso(300), status: 'ساري' });
  R('agibaSiteContracts', 'A-3', { contractNo: 'A/3', currentEnd: null, status: 'ساري' });
  for (let i = 1; i <= 4; i++) R('dataIssues', 'Client-Contracts_' + i, { table: 'Client Contracts', record: 'R' + i, issue: 'made-up issue ' + i, whatToDo: 'ask' });
  R('changes', 'BETA_CSA_Expiry-date', { client: 'BETA', type: 'CSA', field: 'Expiry date', march2026: iso(-200), september2026: iso(45) });
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
check('data issues 4', (await tile('issues')) === '4');

console.log('\n[4] the data-date strip');
check('as-of date shown', (await text('[data-bd="asof"]')).startsWith('Excel data as of '), await text('[data-bd="asof"]'));
check('loaded … by loader@example.test', /^Loaded .+ by loader@example\.test$/.test(await text('[data-bd="loaded"]')), await text('[data-bd="loaded"]'));
check('1 row edited since the load (the one edited before it not counted)', (await text('[data-bd="edits"]')) === 'Records edited in eTaske since the last load: 1');
check('3-day-old data: no stale warning', !(await has('[data-bd="stale"]')));
check('nothing written by the page', (await evalJS(`window.__writes.length`)) === 0);
await shot('1-tiles');

console.log('\n[5] figures follow the rows, no reload (nothing hard-coded)');
await evalJS(`(() => {
  __seed('bdControl/dataIssues/rows', 'Client-Contracts_5', { table: 'Client Contracts', record: 'R5', issue: 'another' });
  const m = __store.get('bdControl/clientContracts/rows');
  m.set('BETA_3_TSA', { ...m.get('BETA_3_TSA'), expiryDate: window.__iso(10) });
  m.set('ALPHA_1_CSA', { ...m.get('ALPHA_1_CSA'), ceilingEgp: 1300000000 });
  __emit();
})()`);
await sleep(200);
check('issues 4 -> 5', (await tile('issues')) === '5');
check('renewed-on-paper line moves: renewals 3 -> 4, overdue 2 -> 1, lines "None expired on paper"',
  (await tile('renewals')) === '4' && (await text('[data-bd="overdue"]')) === 'Already past their date: 1' && (await sub('lines')) === 'None expired on paper');
check('ceiling edit flows in: 2,350.5', (await tile('ceiling')) === '2,350.5', await tile('ceiling'));
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
await send('Emulation.clearDeviceMetricsOverride');

console.log('\n[8] nothing loaded yet');
await evalJS(`(() => { for (const k of [...__store.keys()]) if (k.startsWith('bdControl')) __store.delete(k); })()`);
await remount();
await waitFor(q('[data-bd="empty"]'), 'empty card');
check('empty: plain sentence, no tiles, no strip', (await text('[data-bd="empty"]')) === 'No BD control data has been loaded yet.'
  && !(await has('[data-bd="tiles"]')) && !(await has('[data-bd="date-strip"]')));

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
