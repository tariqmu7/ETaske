// Click-through harness for the Medical contracts board (queue M4a).
//
// Proves src/MedicalContractsDashboard.tsx + src/lib/medicalContracts.ts in real
// Edge: status worked out from the end date as of today (with the sheet's
// Not signed / Renewing winning), KPI strip as one-click filters, governorate
// cards -> area cards -> contract rows (worst first), the unnamed area last,
// Arabic-aware search, type/status filters, the contract window, the
// permission-denied message, Arabic + RTL and a 390 px phone.
// M4b: the edit form for 'edit' access (name a new area, pick one, contract
// state, dates), "Mark as checked", what a save writes, and refusals.
// M5: the Statistics tab — whole-book figures, rankings, the two lists, click-through.
// The contracts are MADE UP — the real data must never be in this public repo.
//
//   node scripts/harness/medicalboardui.mjs   (--headed to watch it, --shot to write PNGs)

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-medicalboardui-'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

// A collection named in __denied answers its listener with permission-denied,
// the way the live rules do for someone the admin has not switched on.
const STUB = FIRESTORE_STUB.replace('export function onSnapshot(q, next, _err) {',
  'export function onSnapshot(q, next, _err) {\n  if (globalThis.__denied && globalThis.__denied.has(q.__coll)) { Promise.resolve().then(() => _err({ code: "permission-denied" })); return () => {}; }');
if (STUB === FIRESTORE_STUB) throw new Error('onSnapshot hook not applied');
const STUB2 = STUB.replace('export async function updateDoc(ref, data) {',
  'export async function updateDoc(ref, data) {\n  if (globalThis.__failWrites) throw Object.assign(new Error("offline"), { code: "unavailable" });');
if (STUB2 === STUB) throw new Error('updateDoc hook not applied');

const FIREBASE_STUB = `
export const app = {};
export const db = { __fake: true };
export const auth = { currentUser: { uid: 'u-admin' } };
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
import MedicalContractsDashboard from './src/MedicalContractsDashboard';
import * as lib from './src/lib/medicalContracts';
import i18n, { applyLanguageToDocument } from './src/i18n';

const iso = off => { const d = new Date(); d.setDate(d.getDate() + off); return lib.todayISO(d); };
const C = (id, o) => __seed('medicalContracts', id, { contractNo: id.toUpperCase(), sheetStatus: 'Active', sheetStatusAr: 'سارى', startDate: iso(-700), autoRenew: false, ...o });
C('c-1', { provider: 'مستشفى النور', type: 'مستشفى', governorate: 'الإسكندرية', area: 'سموحة', endDate: iso(200), address: 'شارع فوزي معاذ' });
C('c-2', { provider: 'صيدلية الأمل', type: 'صيدلية', governorate: 'الإسكندرية', area: 'سموحة', endDate: iso(20) });
C('c-3', { provider: 'معمل الشفاء', type: 'معمل تحاليل', governorate: 'الإسكندرية', area: 'سموحة', endDate: iso(-30), needsCheck: true, importNotes: ['الكشف يقول سارى والتاريخ انتهى'] });
C('c-4', { provider: 'مركز الرحمة للأشعة', type: 'مركز أشعة', governorate: 'الإسكندرية', area: 'سيدي جابر', endDate: '', autoRenew: true });
C('c-5', { provider: 'مستشفى السلام', type: 'مستشفى', governorate: 'الإسكندرية', area: '', endDate: iso(400) });
C('c-6', { provider: 'صيدلية الحياة', type: 'صيدلية', governorate: 'القاهرة', area: 'مدينة نصر', endDate: iso(300), sheetStatus: 'Not signed', sheetStatusAr: 'لم يوقع' });
C('c-7', { provider: 'Al Huda Hospital', type: 'مستشفى', governorate: 'القاهرة', area: 'مدينة نصر', endDate: iso(-5), lat: 30.05, lng: 31.33 });
C('c-8', { provider: 'معمل المختبر', type: 'معمل تحاليل', governorate: 'الجيزة', area: 'الدقي', endDate: iso(-10), sheetStatus: 'Renewing', sheetStatusAr: 'جارى التجديد' });

window.__lib = lib; window.__iso = iso;
window.__denied = new Set();
window.__user = { id: 'u1', displayName: 'Viewer', role: 'Employee', status: 'Approved', medicalContractsAccess: 'view' };
const root = createRoot(document.getElementById('root'));
let n = 0;
window.__mount = view => {
  n++;
  root.render(React.createElement('div', { className: 'app-main' },
    view === 'blank' ? React.createElement('div', null, 'blank')
      : React.createElement(MedicalContractsDashboard, { key: 'm' + n, appUser: window.__user, onNavigate: () => {} })));
};
window.__mount('board');

window.__choose = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
window.__type = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'medicalboarduiEntry.tsx', loader: 'tsx' },
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

const PORT = 9911 + (process.pid % 80);
const edge = spawn(EDGE, [
  HEADED ? '--new-window' : '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(WORK, 'profile')}`,
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000',
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/medical-contracts',
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
window.__vis = el => !!(el && el.offsetParent !== null && el.getClientRects().length);
window.__txt = e => (e ? e.textContent || '' : '').replace(/\\s+/g, ' ').trim();
window.__box = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; };
window.__one = (sel, text) => [...document.querySelectorAll(sel)].filter(window.__vis).find(e => window.__txt(e).includes(text)) || null;
`;
await waitFor(`document.getElementById('root') && document.getElementById('root').children.length`, 'app mount');
await evalJS(HELPERS);

async function clickEl(finderJS, label) {
  let info;
  for (let attempt = 0; attempt < 3; attempt++) {
    info = await evalJS(`(() => {
      ${HELPERS}
      const el = ${finderJS};
      if (!el) return { err: 'not found' };
      el.scrollIntoView({ block: 'center' });
      const b = window.__box(el);
      if (b.w === 0 || b.h === 0) return { err: 'zero-size' };
      const hit = document.elementFromPoint(b.x, b.y);
      return { x: b.x, y: b.y, covered: !(el === hit || el.contains(hit) || (hit && hit.contains(el))), hitTag: hit ? hit.tagName : null };
    })()`);
    if (!info.err && !info.covered) break;
    await sleep(250);
  }
  if (info.err) throw new Error(`click ${label}: ${info.err}`);
  if (info.covered) throw new Error(`click ${label}: something else is on top (${info.hitTag})`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: info.x, y: info.y, button: 'left', clickCount: 1, buttons: 1 });
  }
  await sleep(200);
}
async function shot(name) {
  if (!SHOT) return;
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const p = path.join(ROOT, `scripts/harness/medicalboardui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const remount = async () => { await evalJS(`window.__mount('blank')`); await sleep(100); await evalJS(`window.__mount('board')`); await sleep(300); };
const cards = () => evalJS(`JSON.stringify([...document.querySelectorAll('[data-group-card]')].map(c => [c.dataset.groupCard, window.__txt(c.querySelector('.group-card-num'))]))`).then(JSON.parse);
const rowIds = () => evalJS(`JSON.stringify([...document.querySelectorAll('[data-medical-row]')].map(r => r.dataset.medicalRow))`).then(JSON.parse);
const kpi = k => text(`[data-medical-kpi="${k}"] div`);
const writes = () => evalJS(`window.__writes.length`);
const val = sel => evalJS(`${q(sel)}.value`);
const has = sel => evalJS(`!!${q(sel)}`);
const J = x => JSON.stringify(x);
const chips = sel => evalJS(`[...document.querySelectorAll(${JSON.stringify(sel + ' .group-card-chip')})].map(e => window.__txt(e)).join(' | ')`);
const crumbs = () => evalJS(`[...document.querySelector('[data-medical="crumbs"]').children].map(e => window.__txt(e)).filter(Boolean).join(' > ')`);

try {

console.log('\n[1] status is worked out from the end date (lib/medicalContracts.ts)');
const s = JSON.parse(await evalJS(`(() => { const L = window.__lib, T = L.todayISO(), i = window.__iso;
  return JSON.stringify([
    L.statusOf({ endDate: i(61) }, T), L.statusOf({ endDate: i(60) }, T), L.statusOf({ endDate: i(0) }, T), L.statusOf({ endDate: i(-1) }, T),
    L.statusOf({ endDate: '', autoRenew: true }, T), L.statusOf({ endDate: '' }, T), L.statusOf({ endDate: '3/31/2027' }, T),
    L.statusOf({ endDate: i(-9), sheetStatus: 'Renewing' }, T), L.statusOf({ endDate: i(90), sheetStatus: 'Not signed' }, T),
    L.daysLeft({ endDate: i(20) }, T), L.daysLeft({ endDate: i(-3) }, T),
    L.matchesQuery({ provider: 'مستشفى السلام', contractNo: 'C-5' }, 'مستشفي  السلام'), L.matchesQuery({ provider: 'X', contractNo: 'C-8-2004' }, 'c-8'),
    L.matchesQuery({ provider: 'مستشفى السلام', contractNo: 'C-5' }, 'السلام النور'),
    L.mapLink({ lat: 30.05, lng: 31.33 }), L.mapLink({}) ]); })()`));
check('61 days = Active, 60 = Ending soon, today = Ending soon, yesterday = Expired', J(s.slice(0, 4)) === J(['Active', 'Ending soon', 'Ending soon', 'Expired']), J(s));
check('auto-renew, no end date, an unreadable date', s[4] === 'Auto-renew' && s[5] === 'No end date' && s[6] === 'No end date', J(s));
check("the sheet's Renewing / Not signed win over the dates", s[7] === 'Renewing' && s[8] === 'Not signed', J(s));
check('days left 20 / -3', s[9] === 20 && s[10] === -3, J(s));
check('search folds ى/ي and spaces, matches a contract number in any case, needs every word', s[11] === true && s[12] === true && s[13] === false, J(s));
check('map link only with coordinates', s[14] === 'https://www.google.com/maps/search/?api=1&query=30.05,31.33' && s[15] === null, J(s));

console.log('\n[2] the strip and the governorate cards');
await waitFor(q('[data-group-card]'), 'governorate cards');
check('heading "Medical contracts"', (await text('h1')) === 'Medical contracts');
const k = [await kpi('all'), await kpi('Active'), await kpi('Ending soon'), await kpi('Expired'), await kpi('check')];
check('All 8 · In force 3 (incl. auto-renew) · Ending soon 1 · Expired 2 · Needs check 1', J(k) === J(['8', '3', '1', '2', '1']), J(k));
check('governorates biggest first: Alexandria 5, Cairo 2, Giza 1', J(await cards()) === J([['الإسكندرية', '5'], ['القاهرة', '2'], ['الجيزة', '1']]), J(await cards()));
const alexChips = await chips('[data-group-card="الإسكندرية"]');
check('Alexandria card: 1 expired, 1 ending soon, 1 to check', alexChips === '1 expired | 1 ending soon | 1 to check', alexChips);
check('Alexandria card: "Areas: 3" (the unnamed one counts)', (await text('[data-group-card="الإسكندرية"] .group-card-sub')) === 'Areas: 3');
check('Giza card shows no zero chips', !(await has('[data-group-card="الجيزة"] .group-card-stats')));
await shot('1-governorates');

console.log('\n[3] governorate -> area -> contracts');
await clickEl(q('[data-group-card="الإسكندرية"]'), 'Alexandria');
await waitFor(q('[data-group-card="سموحة"]'), 'area cards');
check('areas: Smouha 3, Sidi Gaber 1, unnamed last', J(await cards()) === J([['سموحة', '3'], ['سيدي جابر', '1'], ['__ungrouped__', '1']]), J(await cards()));
check('the unnamed area reads "Area not named yet"', (await text('[data-group-card="__ungrouped__"] .group-card-title')) === 'Area not named yet');
check('governorate filter follows the card', (await val('[data-medical="gov-filter"]')) === 'الإسكندرية');
check('crumbs: All governorates › الإسكندرية', (await crumbs()) === 'All governorates > الإسكندرية', await crumbs());
await clickEl(q('[data-group-card="سموحة"]'), 'Smouha');
await waitFor(q('[data-medical-row]'), 'rows');
check('rows worst first: expired, ending soon, in force', J(await rowIds()) === J(['c-3', 'c-2', 'c-1']), J(await rowIds()));
check('expired row: Expired badge + "Ended …" + Needs check',
  (await evalJS(`${q('[data-medical-row="c-3"] [data-medical-status]')}.dataset.medicalStatus`)) === 'Expired'
  && (await text('[data-medical-row="c-3"] [data-medical-end]')).startsWith('Ended ') && (await has('[data-medical-row="c-3"] [data-medical-check]')));
check('ending-soon row says how many days are left', (await text('[data-medical-row="c-2"] [data-medical-end]')).endsWith('days remaining: 20'), await text('[data-medical-row="c-2"] [data-medical-end]'));
check('in-force row has no Needs check badge', !(await has('[data-medical-row="c-1"] [data-medical-check]')));
await shot('2-area');
await clickEl(q('[data-medical-crumb="gov"]'), 'back to the governorate');
await waitFor(q('[data-group-card="__ungrouped__"]'), 'area cards again');
await clickEl(q('[data-group-card="__ungrouped__"]'), 'unnamed area');
check('unnamed area opens its contract', J(await rowIds()) === J(['c-5']), J(await rowIds()));
await clickEl(q('[data-medical-crumb="all"]'), 'back to all');
await waitFor(q('[data-group-card="الجيزة"]'), 'governorate cards again');
check('back on the governorates, filter reset to all', (await val('[data-medical="gov-filter"]')) === 'all');

console.log('\n[4] filters, the strip and search');
await evalJS(`window.__choose(${q('[data-medical="type-filter"]')}, 'مستشفى')`);
await sleep(150);
check('type Hospital: Alexandria 2, Cairo 1, Giza gone', J(await cards()) === J([['الإسكندرية', '2'], ['القاهرة', '1']]), J(await cards()));
await evalJS(`window.__choose(${q('[data-medical="type-filter"]')}, 'all')`);
await sleep(100);
await clickEl(q('[data-medical-kpi="Expired"]'), 'Expired KPI');
check('Expired KPI: Alexandria 1, Cairo 1', J(await cards()) === J([['الإسكندرية', '1'], ['القاهرة', '1']]), J(await cards()));
check('…and the status filter shows it', (await val('[data-medical="status-filter"]')) === 'Expired');
await clickEl(q('[data-medical-kpi="check"]'), 'Needs check KPI');
check('Needs check KPI: only Alexandria 1, status back to all', J(await cards()) === J([['الإسكندرية', '1']]) && (await val('[data-medical="status-filter"]')) === 'all', J(await cards()));
await clickEl(q('[data-medical-kpi="all"]'), 'All KPI');
check('All KPI clears every filter', (await cards()).length === 3);
await evalJS(`window.__type(${q('[data-medical="search"]')}, 'مستشفي السلام')`);
await sleep(150);
check('search is a flat list across governorates (ى/ي folded)', J(await rowIds()) === J(['c-5']) && (await text('[data-medical="count"]')) === 'Found: 1', J(await rowIds()));
check('a search row says where it is', (await text('[data-medical-row="c-5"]')).includes('الإسكندرية'));
await evalJS(`window.__type(${q('[data-medical="search"]')}, 'zzz')`);
await sleep(150);
check('no match: a plain message', await has('[data-medical="none"]'));
await evalJS(`window.__type(${q('[data-medical="search"]')}, 'C-7')`);
await sleep(150);

console.log('\n[5] the contract window');
await clickEl(q('[data-medical-row="c-7"]'), 'row c-7');
await waitFor(q('[data-medical-detail="c-7"]'), 'the window');
check('window: provider, status Expired, governorate, area', (await text('[data-medical-detail="c-7"] h2')) === 'Al Huda Hospital'
  && (await evalJS(`${q('[data-medical-field="status"] [data-medical-status]')}.dataset.medicalStatus`)) === 'Expired'
  && (await text('[data-medical-field="governorate"]')).endsWith('القاهرة') && (await text('[data-medical-field="area"]')).endsWith('مدينة نصر'));
check('map link opens Google Maps in a new tab', (await evalJS(`${q('[data-medical="map"]')}.href`)).includes('query=30.05,31.33') && (await evalJS(`${q('[data-medical="map"]')}.target`)) === '_blank');
check('no Needs check note on a clean contract', !(await has('[data-medical="check-note"]')));
await shot('3-window');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(150);
check('Escape closes it', !(await has('[data-medical-detail]')));
await evalJS(`window.__type(${q('[data-medical="search"]')}, 'الشفاء')`);
await sleep(150);
await clickEl(q('[data-medical-row="c-3"]'), 'row c-3');
check('Needs check note lists the import note', (await text('[data-medical="check-note"]')).includes('الكشف يقول سارى والتاريخ انتهى'));
await clickEl(q('[data-medical="close"]'), 'close');
check('nothing was written', (await writes()) === 0);

console.log('\n[6] Arabic + RTL, and a phone');
await remount();
await evalJS(`window.__setLang('ar')`);
await sleep(300);
check('Arabic heading «العقود الطبية» and right-to-left', (await text('h1')) === 'العقود الطبية' && (await evalJS(`document.documentElement.dir`)) === 'rtl');
check('Arabic KPI labels', (await text('[data-medical-kpi="Active"] div:last-child')) === 'ساري' && (await text('[data-medical-kpi="check"] div:last-child')) === 'يحتاج مراجعة');
const arChips = await chips('[data-group-card="الإسكندرية"]');
check('Arabic card unit and chips', (await text('[data-group-card="الإسكندرية"] .group-card-unit')) === 'عقود' && arChips === '1 منتهية | 1 تنتهي قريبًا | 1 للمراجعة', arChips);
check('Giza: «عقد» for one', (await text('[data-group-card="الجيزة"] .group-card-unit')) === 'عقد');
await shot('4-ar');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await remount();
await clickEl(q('[data-group-card="الإسكندرية"]'), 'Alexandria (phone)');
await clickEl(q('[data-group-card="سموحة"]'), 'Smouha (phone)');
check('390 px: no sideways scroll', (await overflow()) <= 1, String(await overflow()));
await shot('5-ar-mobile');
await send('Emulation.clearDeviceMetricsOverride');
await evalJS(`window.__setLang('en')`);

console.log('\n[6b] statistics (queue M5)');
const st = JSON.parse(await evalJS(`(() => { const L = window.__lib, T = L.todayISO(), i = window.__iso;
  const S = L.medicalStats([
    { id: 'a', provider: 'A', type: 'x', governorate: 'G1', area: 'A1', endDate: i(10) },
    { id: 'b', provider: 'B', type: 'x', governorate: 'G1', area: 'A1', endDate: i(-2) },
    { id: 'c', provider: 'C', type: 'y', governorate: 'G2', area: 'A1', endDate: i(-40) },
    { id: 'd', provider: 'D', type: 'y', governorate: 'G2', area: '', endDate: i(-1), sheetStatus: 'Renewing' },
    { id: 'e', provider: 'E', type: 'y', governorate: 'G2', area: 'A2', endDate: '', autoRenew: true },
  ], T);
  const E = L.medicalStats([], T);
  return JSON.stringify({ b: S.buckets, g: S.byGovernorate.map(r => [r.key, r.total]),
    a: S.areas.map(r => [r.governorate, r.key, r.total]), soon: S.endingSoon.map(d => [d.c.id, d.days]),
    exp: S.expired.map(d => d.c.id), empty: [E.total, E.areas.length, E.endingSoon.length] }); })()`));
check('lib: four buckets (renewing counts as other, not expired)', J(st.b) === J({ inForce: 1, endingSoon: 1, expired: 2, other: 1 }), J(st.b));
check('lib: same area name in two governorates = two rows; unnamed last', J(st.a) === J([['G1', 'A1', 2], ['G2', 'A1', 1], ['G2', 'A2', 1], ['G2', '', 1]]), J(st.a));
check('lib: ending soon with days left; expired most recent first', J(st.soon) === J([['a', 10]]) && J(st.exp) === J(['b', 'c']), J([st.soon, st.exp]));
check('lib: no contracts = all zero', J(st.empty) === J([0, 0, 0]));
await remount();
await evalJS(`window.__choose(${q('[data-medical="type-filter"]')}, 'صيدلية')`);
await sleep(100);
await clickEl(q('[data-medical-tab="stats"]'), 'Statistics tab');
await waitFor(q('[data-medical="stats"]'), 'the statistics');
check('the board strip and filters are gone on Statistics', !(await has('[data-medical-kpi]')) && !(await has('[data-medical="type-filter"]')));
const tiles = await evalJS(`JSON.stringify([...document.querySelectorAll('[data-ms-tile]')].map(e => [e.dataset.msTile, window.__txt(e.firstElementChild)]))`).then(JSON.parse);
check('tiles count the WHOLE book (the board type filter does not apply)', J(tiles) === J([['total', '8'], ['inForce', '3'], ['endingSoon', '1'], ['expired', '2'], ['check', '1']]), J(tiles));
check('legend: In force 3 (38%)', (await text('[data-ms-legend="inForce"]')) === 'In force: 3 (38%)', await text('[data-ms-legend="inForce"]'));
const statuses = await evalJS(`JSON.stringify([...document.querySelectorAll('[data-ms-status]')].map(e => e.dataset.msStatus + ' ' + window.__txt(e.querySelector('b'))))`).then(JSON.parse);
check('status split: every status that has contracts, worst first', J(statuses) === J(['Expired 2', 'Ending soon 1', 'Renewing 1', 'Not signed 1', 'Active 2', 'Auto-renew 1']), J(statuses));
const rowsOf = attr => evalJS(`JSON.stringify([...document.querySelectorAll('[data-ms-row="${attr}"]')].map(e => [e.dataset.msKey, window.__txt(e.querySelector('[data-ms-total]'))]))`).then(JSON.parse);
check('governorates biggest first', J(await rowsOf('governorate')) === J([['الإسكندرية', '5'], ['القاهرة', '2'], ['الجيزة', '1']]), J(await rowsOf('governorate')));
check('Alexandria row is labelled with its numbers', (await text('[data-ms-row="governorate"][data-ms-key="الإسكندرية"] .ms-row-sub')) === 'In force: 3 · Ending soon: 1 · Expired: 1', await text('[data-ms-row="governorate"][data-ms-key="الإسكندرية"] .ms-row-sub'));
const barW = await evalJS(`JSON.stringify([...document.querySelectorAll('[data-ms-row="governorate"] .ms-bar')].map(b => Math.round(b.getBoundingClientRect().width / b.parentElement.getBoundingClientRect().width * 100)))`).then(JSON.parse);
check('bars scale to the biggest (100 / 40 / 20 %)', J(barW) === J([100, 40, 20]), J(barW));
check('areas ranked, unnamed last', J(await rowsOf('area')) === J([['سموحة', '3'], ['مدينة نصر', '2'], ['الدقي', '1'], ['سيدي جابر', '1'], ['', '1']]), J(await rowsOf('area')));
check('types biggest first', J(await rowsOf('type')) === J([['مستشفى', '3'], ['صيدلية', '2'], ['معمل تحاليل', '2'], ['مركز أشعة', '1']]), J(await rowsOf('type')));
const listed = attr => evalJS(`JSON.stringify([...document.querySelectorAll('[data-ms-contract="${attr}"]')].map(e => e.dataset.msId))`).then(JSON.parse);
check('ending in 60 days: c-2 with its days', J(await listed('ending')) === J(['c-2']) && (await text('[data-ms-id="c-2"] .ms-row-when')).includes('days remaining: 20'), await text('[data-ms-id="c-2"] .ms-row-when'));
check('expired, not renewed: c-7 then c-3 (Renewing c-8 left out)', J(await listed('expired')) === J(['c-7', 'c-3']), J(await listed('expired')));
await shot('8-stats');
await clickEl(q('[data-ms-id="c-3"]'), 'expired c-3');
await waitFor(q('[data-medical-detail="c-3"]'), 'the c-3 window');
check('a contract row opens its window', true);
await clickEl(q('[data-medical="close"]'), 'close');
await clickEl(q('[data-ms-row="area"][data-ms-key="سموحة"]'), 'Smouha row');
await waitFor(q('[data-medical-row]'), 'board rows');
check('an area row opens that area on the board, filters cleared', (await crumbs()) === 'All governorates > الإسكندرية > سموحة' && J(await rowIds()) === J(['c-3', 'c-2', 'c-1']) && (await val('[data-medical="type-filter"]')) === 'all', (await crumbs()) + J(await rowIds()));
await clickEl(q('[data-medical-tab="stats"]'), 'Statistics again');
await clickEl(q('[data-ms-row="type"][data-ms-key="صيدلية"]'), 'Pharmacy row');
check('a type row opens the board filtered to that type', (await val('[data-medical="type-filter"]')) === 'صيدلية' && J(await cards()) === J([['الإسكندرية', '1'], ['القاهرة', '1']]), J(await cards()));
await evalJS(`window.__setLang('ar')`);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await remount();
await clickEl(q('[data-medical-tab="stats"]'), 'Statistics (Arabic phone)');
check('Arabic: «الإحصاءات», «حالة العقود», «سارية: 3»', (await text('[data-medical-tab="stats"]')) === 'الإحصاءات'
  && (await text('[data-ms-section="status"] h2')) === 'حالة العقود'
  && (await text('[data-ms-row="governorate"][data-ms-key="الإسكندرية"] .ms-row-sub')).startsWith('سارية: 3'));
check('390 px statistics: no sideways scroll', (await overflow()) <= 1, String(await overflow()));
await shot('9-ar-mobile-stats');
await send('Emulation.clearDeviceMetricsOverride');
await evalJS(`window.__setLang('en')`);

console.log('\n[7] editing (queue M4b) — the rules of a save (lib/medicalContracts.ts)');
const e = JSON.parse(await evalJS(`(() => { const L = window.__lib;
  const c = { id: 'x', contractNo: 'X', provider: 'مستشفى', type: 'مستشفى', governorate: 'القاهرة', area: '', startDate: '2025-01-01', endDate: '2026-01-01', autoRenew: false, sheetStatus: 'Expired', needsCheck: true };
  const d = L.draftOf(c);
  return JSON.stringify([
    L.contractPatch(c, d),
    L.contractPatch(c, { ...d, area: '  مدينة   نصر ', provider: 'مستشفى ' }),
    L.contractPatch(c, { ...d, autoRenew: true }),
    L.contractPatch(c, { ...d, state: 'Renewing', needsCheck: false }),
    L.contractPatch({ ...c, sheetStatus: 'Renewing' }, { ...d, state: 'Signed' }),
    L.draftProblems({ ...d, provider: ' ', governorate: '' }),
    L.draftProblems({ ...d, endDate: '2024-12-31' }),
    L.draftProblems({ ...d, endDate: '2024-12-31', autoRenew: true }),
    L.areasIn([{ governorate: 'القاهرة', area: 'أ' }, { governorate: 'القاهرة ', area: 'ب ' }, { governorate: 'القاهرة', area: 'ب' }, { governorate: 'الجيزة', area: 'ج' }, { governorate: 'القاهرة', area: '' }], 'القاهرة'),
  ]); })()`));
check('no change = nothing to write', J(e[0]) === '{}', J(e[0]));
check('only the changed field is written, spaces tidied (provider unchanged after trim)', J(e[1]) === J({ area: 'مدينة نصر' }), J(e[1]));
check('ticking "renews automatically" also empties the end date', J(e[2]) === J({ endDate: '', autoRenew: true }), J(e[2]));
check('state Being renewed -> sheetStatus Renewing; clearing Needs check writes false', J(e[3]) === J({ needsCheck: false, sheetStatus: 'Renewing' }), J(e[3]));
check('back to Signed -> sheetStatus Active (the dates decide again)', J(e[4]) === J({ sheetStatus: 'Active' }), J(e[4]));
check('a blank provider and governorate are refused', J(e[5]) === J(['Write the provider name.', 'Choose or type the governorate.']), J(e[5]));
check('an end date before the start is refused, unless it renews by itself', J(e[6]) === J(['The end date comes before the start date.']) && e[7].length === 0, J(e.slice(6, 8)));
check('area list per governorate: used names only, biggest first, spaces tidied', J(e[8]) === J(['ب', 'أ']), J(e[8]));

console.log('\n[8] view-only people see no Edit');
await remount();
await evalJS(`window.__type(${q('[data-medical="search"]')}, 'الشفاء')`);
await sleep(150);
await clickEl(q('[data-medical-row="c-3"]'), 'row c-3 (viewer)');
check('no Edit button, no "Mark as checked"', !(await has('[data-medical="edit"]')) && !(await has('[data-medical="mark-checked"]')) && (await has('[data-medical="check-note"]')));
await clickEl(q('[data-medical="close"]'), 'close');

console.log('\n[9] an editor names the unnamed area');
await evalJS(`window.__user = { id: 'u-ed', displayName: 'Sara Editor', role: 'Employee', status: 'Approved', medicalContractsAccess: 'edit' }`);
await remount();
const pickCombo = async (field, typed) => {
  await clickEl(q(`[data-edit="${field}"] button.input`), field + ' picker');
  await waitFor(`[...document.querySelectorAll('input')].find(i => i.placeholder === 'Search or type a new value…')`, 'picker search box');
  await evalJS(`window.__type([...document.querySelectorAll('input')].find(i => i.placeholder === 'Search or type a new value…'), ${J(typed)})`);
  await sleep(150);
};
const ungroupedBefore = (await writes());
await clickEl(q('[data-group-card="الإسكندرية"]'), 'Alexandria');
await clickEl(q('[data-group-card="__ungrouped__"]'), 'unnamed area');
await clickEl(q('[data-medical-row="c-5"]'), 'row c-5');
check('an editor sees Edit', await has('[data-medical="edit"]'));
await clickEl(q('[data-medical="edit"]'), 'Edit');
await waitFor(q('[data-medical="form"]'), 'the form');
check('the form is filled from the contract', (await val('[data-edit="provider"]')) === 'مستشفى السلام' && (await text('[data-edit="governorate"] button.input')).includes('الإسكندرية'));
check('while editing there is no close button (Cancel or Save)', !(await has('[data-medical="close"]')));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(150);
check('Escape does not throw the form away', await has('[data-medical="form"]'));
await pickCombo('area', 'سموحة');
check('the area list offers the names already used in Alexandria', await evalJS(`!!window.__one('[data-row]', 'سموحة')`));
await evalJS(`window.__type([...document.querySelectorAll('input')].find(i => i.placeholder === 'Search or type a new value…'), 'ميامي')`);
await sleep(150);
await clickEl(`window.__one('[data-row]', 'ميامي')`, 'Add "ميامي"');
check('the new name sits in the box', (await text('[data-edit="area"] button.input')).includes('ميامي'));
await shot('6-edit-form');
await clickEl(q('[data-medical="save"]'), 'Save');
await waitFor(`!${q('[data-medical="form"]')}`, 'form closed');
const w1 = JSON.parse(await evalJS(`JSON.stringify(window.__writes[window.__writes.length - 1])`));
check('one update to medicalContracts/c-5', (await writes()) === ungroupedBefore + 1 && w1.op === 'update' && w1.path === 'medicalContracts/c-5', J(w1));
check('it writes the area + who saved it, nothing else', J(Object.keys(w1.data).sort()) === J(['area', 'updatedAt', 'updatedBy', 'updatedByName']) && w1.data.area === 'ميامي' && w1.data.updatedByName === 'Sara Editor', J(w1.data));
check('the window shows the new area and "Last edited by"', (await text('[data-medical-field="area"]')).endsWith('ميامي') && (await text('[data-medical="history"]')) === 'Last edited by Sara Editor');
await clickEl(q('[data-medical="close"]'), 'close');
await clickEl(q('[data-medical-crumb="gov"]'), 'back to Alexandria');
await waitFor(q('[data-group-card="ميامي"]'), 'the new area card');
check('the new area joins the grouping; "not named yet" is gone', J(await cards()) === J([['سموحة', '3'], ['سيدي جابر', '1'], ['ميامي', '1']]), J(await cards()));

console.log('\n[10] pick an existing area, change the state, refusals');
await clickEl(q('[data-group-card="سيدي جابر"]'), 'Sidi Gaber');
await clickEl(q('[data-medical-row="c-4"]'), 'row c-4');
await clickEl(q('[data-medical="edit"]'), 'Edit c-4');
await pickCombo('area', 'سمو');
await clickEl(`window.__one('[data-row]', 'سموحة')`, 'pick سموحة');
await evalJS(`window.__choose(${q('[data-edit="state"]')}, 'Not signed')`);
await clickEl(q('[data-medical="save"]'), 'Save c-4');
await waitFor(`!${q('[data-medical="form"]')}`, 'form closed');
const w2 = JSON.parse(await evalJS(`JSON.stringify(window.__writes[window.__writes.length - 1].data)`));
check('picked area + state Not signed written', w2.area === 'سموحة' && w2.sheetStatus === 'Not signed' && !('provider' in w2), J(w2));
check('status badge follows the new state', (await evalJS(`${q('[data-medical-field="status"] [data-medical-status]')}.dataset.medicalStatus`)) === 'Not signed');
const n0 = await writes();
await clickEl(q('[data-medical="edit"]'), 'Edit c-4 again');
await evalJS(`window.__type(${q('[data-edit="provider"]')}, '  ')`);
await clickEl(q('[data-medical="save"]'), 'Save with no name');
check('a blank name is refused with a plain message, nothing written', (await text('[data-medical="problems"]')) === 'Write the provider name.' && (await writes()) === n0);
await clickEl(q('[data-medical="cancel"]'), 'Cancel');
check('Cancel puts the window back unchanged', !(await has('[data-medical="form"]')) && (await text('[data-medical-detail="c-4"] h2')) === 'مركز الرحمة للأشعة');
await clickEl(q('[data-medical="edit"]'), 'Edit c-4 (dates)');
await clickEl(q('[data-edit="autoRenew"]'), 'untick renews automatically');
check('unticking "renews automatically" opens the end date', !(await evalJS(`${q('[data-edit="endDate"]')}.disabled`)));
await evalJS(`window.__type(${q('[data-edit="endDate"]')}, window.__iso(-800))`);
await clickEl(q('[data-medical="save"]'), 'Save end before start');
check('end before start is refused', (await text('[data-medical="problems"]')) === 'The end date comes before the start date.' && (await writes()) === n0);
await evalJS(`window.__type(${q('[data-edit="endDate"]')}, window.__iso(30))`);
await evalJS(`window.__failWrites = true`);
await clickEl(q('[data-medical="save"]'), 'Save while offline');
await waitFor(q('[data-medical="problems"]'), 'save error');
check('a failed save says so and keeps the form', (await text('[data-medical="problems"]')).startsWith('Could not save the change') && (await has('[data-medical="form"]')));
await evalJS(`window.__failWrites = false`);
await clickEl(q('[data-medical="save"]'), 'Save again');
await waitFor(`!${q('[data-medical="form"]')}`, 'form closed');
const w3 = JSON.parse(await evalJS(`JSON.stringify(window.__writes[window.__writes.length - 1].data)`));
check('dates saved: autoRenew false + the new end date', w3.autoRenew === false && w3.endDate === (await evalJS(`window.__iso(30)`)), J(w3));
await clickEl(q('[data-medical="close"]'), 'close');

console.log('\n[11] Mark as checked');
await remount();
check('Needs check KPI starts at 1', (await kpi('check')) === '1');
await evalJS(`window.__type(${q('[data-medical="search"]')}, 'الشفاء')`);
await sleep(150);
await clickEl(q('[data-medical-row="c-3"]'), 'row c-3 (editor)');
await clickEl(q('[data-medical="mark-checked"]'), 'Mark as checked');
await waitFor(`!${q('[data-medical="check-note"]')}`, 'note gone');
const w4 = JSON.parse(await evalJS(`JSON.stringify(window.__writes[window.__writes.length - 1].data)`));
check('writes needsCheck false + who checked it', w4.needsCheck === false && w4.checkedByName === 'Sara Editor' && 'checkedAt' in w4, J(w4));
check('"Checked by Sara Editor" in the window', (await text('[data-medical="history"]')).includes('Checked by Sara Editor'));
await clickEl(q('[data-medical="close"]'), 'close');
check('Needs check KPI now 0, row badge gone', (await kpi('check')) === '0' && !(await has('[data-medical-row="c-3"] [data-medical-check]')));

console.log('\n[12] the form in Arabic on a phone');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await evalJS(`window.__setLang('ar')`);
await remount();
await evalJS(`window.__type(${q('[data-medical="search"]')}, 'النور')`);
await sleep(150);
await clickEl(q('[data-medical-row="c-1"]'), 'row c-1 (phone)');
await clickEl(q('[data-medical="edit"]'), 'Edit (phone)');
check('Arabic labels: «الجهة», «حالة التعاقد», «موقَّع، وتحكم التواريخ حالته»',
  (await text('[data-medical-field="provider"] div')) === 'الجهة' && (await text('[data-medical-field="state"] div')) === 'حالة التعاقد'
  && (await evalJS(`${q('[data-edit="state"]')}.selectedOptions[0].textContent`)) === 'موقَّع، وتحكم التواريخ حالته');
check('390 px form: no sideways scroll, Save on screen', (await overflow()) <= 1 && (await evalJS(`(() => { const r = ${q('[data-medical="save"]')}.getBoundingClientRect(); return r.right <= 390 && r.left >= 0; })()`)), String(await overflow()));
await shot('7-ar-mobile-form');
await clickEl(q('[data-medical="cancel"]'), 'Cancel (phone)');
await send('Emulation.clearDeviceMetricsOverride');
await evalJS(`window.__setLang('en')`);

console.log('\n[13] someone the rules refuse');
await evalJS(`window.__denied.add('medicalContracts')`);
await remount();
await waitFor(q('[data-medical="error"]'), 'the error card');
check('permission-denied: a plain explanation, no cards', (await text('[data-medical="error"]')).startsWith('The contracts could not be opened') && !(await has('[data-group-card]')));
check('no page errors', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 800)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/medicalboardui-failure.png');
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
