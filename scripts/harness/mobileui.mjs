// Phone pass harness for queue task E2 (mobile-first + calmer visuals).
//
// Every other UI harness mounts ONE screen. This one mounts the WHOLE app —
// the real App.tsx with its top bar, bottom bar, More sheet and hash routing —
// signed in through a stubbed firebase/auth, reading the shared fake Firestore,
// in real Edge at 390 x 844 (a phone), in English and Arabic.
//
// What it proves, per screen: no sideways scroll, nothing stranded off-screen,
// the fixed bottom bar never covers the last thing on the page, the More sheet
// fits the screen and scrolls, tap targets in the shell are at least 40 px,
// and card titles are allowed to wrap instead of being cut to a few letters.
//
// CSS: the newest dist/assets/*.css when there is one (it carries the Tailwind
// utilities the source index.css only @imports) — run `npx vite build` first
// for a faithful render; otherwise src/index.css without Tailwind.
//
//   node scripts/harness/mobileui.mjs   (--headed to watch it, --shot to write PNGs)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-mobileui-'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

import { FIRESTORE_STUB } from './fakeFirestore.mjs';

const FIREBASE_STUB = `
export const app = {};
export const db = { __fake: true };
export const auth = { currentUser: { uid: 'u-mgr' } };
`;
// Signed in as the manager the moment App subscribes.
const AUTH_STUB = `
export function onAuthStateChanged(_a, cb) {
  setTimeout(() => cb({ uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@eprom.com.eg', photoURL: '' }), 0);
  return () => {};
}
export async function signOut() {}
export function getAuth() { return {}; }
export class GoogleAuthProvider {}
export async function signInWithPopup() {}
export async function signInWithEmailAndPassword() {}
export async function createUserWithEmailAndPassword() {}
`;
// App.tsx listens to ONE doc (its own user profile); the shared stub's
// onSnapshot only speaks collections, so doc refs are answered here.
const NETWORK_STUB = `
export function onSnapshot(q, next, err) {
  if (q && q.id !== undefined && !q.__cs) {
    const fire = () => { const d = globalThis.__store.get(q.__coll)?.get(q.id);
      next({ id: q.id, exists: () => d !== undefined, data: () => (d ? { ...d } : undefined) }); };
    Promise.resolve().then(fire);
    return () => {};
  }
  return __collOnSnapshot(q, next, err);
}
export async function disableNetwork() {}
export async function enableNetwork() {}
`;
const MESSAGING_STUB = `
export function getMessaging() { return {}; }
export async function getToken() { return ''; }
export function onMessage() { return () => {}; }
export async function isSupported() { return false; }
`;

const stubPlugin = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'stub-firestore', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/auth$/ }, () => ({ path: 'stub-auth', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/messaging$/ }, () => ({ path: 'stub-messaging', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/(app|storage)$/ }, () => ({ path: 'stub-empty', namespace: 'stub' }));
    b.onResolve({ filter: /\/firebase$/ }, () => ({ path: 'stub-firebase', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-firestore' ? FIRESTORE_STUB.replace('export function onSnapshot(', 'function __collOnSnapshot(') + NETWORK_STUB
        : args.path === 'stub-firebase' ? FIREBASE_STUB
        : args.path === 'stub-auth' ? AUTH_STUB
        : args.path === 'stub-messaging' ? MESSAGING_STUB
        : 'export {};',
      loader: 'js',
      resolveDir: ROOT,
    }));
  },
};

const ENTRY = /* tsx */ `
import React from 'react';
import { createRoot } from 'react-dom/client';
import i18n, { applyLanguageToDocument } from './src/i18n';
import App from './src/App';

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Business Development', userColor: '#2563eb' },
  { id: 'u-ahmed', displayName: 'Ahmed Samir', email: 'a@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development', userColor: '#16a34a' },
  { id: 'u-mona', displayName: 'Mona Fathy', email: 'm@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development', userColor: '#a855f7' },
];
USERS.forEach(u => { const { id, ...d } = u; __seed('users', id, d); });

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
// Firestore Timestamp look-alike for createdAt/updatedAt (the boards call .toDate()).
const ts = n => { const d = new Date(now.getTime() + n * 86400e3); return { toDate: () => d, toMillis: () => d.getTime(), seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 }; };

const T = (id, extra) => __seed('tasks', id, { description: 'Coordinate with the client and the site team before the next review meeting.', status: 'In Progress', priority: 'High', isPrivate: false, createdAt: ts(-30), updatedAt: ts(-2), userId: 'u-mgr', teamId: 'T1', ...extra });
T('t1', { taskName: 'Prepare the AGIBA tank-cleaning commercial offer and price schedule', dueDate: dayOffset(-9), assignedToId: 'u-ahmed', assignedTo: 'Ahmed Samir', serialNumber: 'TK000301' });
T('t2', { taskName: 'Site survey report for Meleiha', dueDate: dayOffset(-3), assignedToId: 'u-mgr', assignedTo: 'Tariq Salama', serialNumber: 'TK000302' });
T('t3', { taskName: 'إعداد تقرير الزيارة الميدانية لمحطة المعالجة', dueDate: dayOffset(0), assignedToId: 'u-mgr', assignedTo: 'Tariq Salama', serialNumber: 'TK000303' });
T('t4', { taskName: 'Collect subcontractor quotations', dueDate: dayOffset(5), status: 'To Do', assignedToId: 'u-mona', assignedTo: 'Mona Fathy', serialNumber: 'TK000304' });

const C = (id, extra) => __seed('correspondences', id, { body: 'Please confirm the scope and the schedule.', sentFrom: 'NNPC', dateReceived: dayOffset(-10), createdAt: ts(-10), updatedAt: ts(-1), userId: 'u-mgr', teamId: 'T1', ...extra });
C('l1', { subject: 'Clarification on the scope of the turnaround maintenance works', deadline: dayOffset(-1), status: 'Assigned', assignedToId: 'u-mgr', assignedTo: 'Tariq Salama', serialNumber: 'CR000401' });
C('l2', { subject: 'New enquiry from WEPCO', status: 'Unread', serialNumber: 'CR000402' });
C('l3', { subject: 'دعوة للمشاركة في مناقصة صيانة الخزانات', status: 'Reviewing', serialNumber: 'CR000403', sentFrom: 'بتروجت' });

__seed('opportunities', 'o1', { title: 'Tank farm maintenance framework agreement', client: 'NNPC', stage: 'Bid Preparation', submissionDeadline: dayOffset(3), ownerId: 'u-ahmed', ownerName: 'Ahmed Samir', serialNumber: 'OP000011', estimatedValue: 12000000, currency: 'EGP', winProbability: 40, createdAt: ts(-20), updatedAt: ts(-1) });
__seed('opportunities', 'o2', { title: 'Terminal upgrade', client: 'Petromint', stage: 'Submitted', submissionDeadline: dayOffset(-5), ownerId: 'u-mgr', ownerName: 'Tariq Salama', serialNumber: 'OP000012', estimatedValue: 5000000, currency: 'EGP', createdAt: ts(-40), updatedAt: ts(-3) });

__seed('projects', 'p1', { name: 'Meleiha gas plant operations and maintenance', client: 'AGIBA', status: 'Active', serialNumber: 'PR000003', startDate: dayOffset(-200), endDate: dayOffset(160), userId: 'u-mgr', teamId: 'T1', createdAt: ts(-200), updatedAt: ts(-4) });
__seed('projectContracts', 'k1', { projectId: 'p1', subject: 'Tank cleaning', contractNumber: 'C-2201', endDate: dayOffset(12), status: 'Active' });

// First-run strip and "All sections" state are per browser — start clean.
try { localStorage.clear(); } catch {}
window.fetch = async () => { throw new TypeError('Failed to fetch'); };   // no Outlook helper
window.Notification = Object.assign(function Notification() {}, { permission: "denied", requestPermission: async () => "denied" });

const root = createRoot(document.getElementById('root'));
root.render(React.createElement(App));
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e =>
  window.__errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'mobileuiEntry.tsx', loader: 'tsx' },
  bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  outfile: path.join(WORK, 'bundle.js'),
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '__VITE_ENV__' },
  banner: { js: `const __VITE_ENV__ = { VITE_GOOGLE_SCRIPT_URL: 'https://script.test/exec', VITE_GOOGLE_SCRIPT_SECRET: 'harness-secret', BASE_URL: './' };` },
  loader: { '.png': 'dataurl', '.svg': 'dataurl' },
  plugins: [stubPlugin],
  logLevel: 'error',
});

const distDir = path.join(ROOT, 'dist/assets');
const distCss = fs.existsSync(distDir)
  ? fs.readdirSync(distDir).filter(f => f.endsWith('.css')).map(f => path.join(distDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  : null;
const srcCss = path.join(ROOT, 'src/index.css');
const useDist = distCss && fs.statSync(distCss).mtimeMs >= fs.statSync(srcCss).mtimeMs;
if (!useDist) console.log('  note: dist CSS missing or older than src/index.css — using src/index.css without Tailwind. Run `npx vite build` for a faithful render.');
const css = useDist ? fs.readFileSync(distCss, 'utf8')
  : fs.readFileSync(srcCss, 'utf8').replace(/@import url\([^)]*\);/g, '').replace(/@tailwind [a-z]+;/g, '');
fs.writeFileSync(path.join(WORK, 'app.css'), css.replace(/@import url\([^)]*\);/g, ''));
fs.writeFileSync(path.join(WORK, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
   <link rel="stylesheet" href="app.css"></head>
   <body><div id="root"></div><script src="bundle.js"></script></body></html>`);

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('Microsoft Edge not found.'); process.exit(2); }

const PORT = 9711 + (process.pid % 100);
const edge = spawn(EDGE, [
  HEADED ? '--new-window' : '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(WORK, 'profile')}`,
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=500,1000',
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
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
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    pageErrors.push(d.exception?.description || d.text);
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
async function waitFor(expression, label, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalJS(`!!(${expression})`)) return true;
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${label || expression}`);
}
async function shot(name, full = true) {
  if (!SHOT) return;
  let clip;
  if (full) {
    const h = await evalJS(`Math.min(document.documentElement.scrollHeight, 6000)`);
    clip = { x: 0, y: 0, width: 390, height: h, scale: 1 };
  }
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(ROOT, `scripts/harness/mobileui-${name}.png`), Buffer.from(s.data, 'base64'));
}

// Measures, run inside the page.
const HELPERS = `
document.documentElement.style.scrollBehavior = 'auto';   // index.css animates scrolls
window.__vis = el => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
window.__overflow = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
// Visible elements whose box pokes outside the viewport sideways — and are not
// inside something that scrolls sideways on purpose (tab strips, tables).
window.__stranded = () => {
  const W = innerWidth, out = [];
  const scrollsX = el => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
    const s = getComputedStyle(e); if ((s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') && e.scrollWidth > e.clientWidth + 1) return true; } return false; };
  for (const el of document.querySelectorAll('#root *')) {
    if (!window.__vis(el)) continue;
    // The chat bubble slides aside while the page scrolls (E2b) — skip it while
    // it is away or still sliding back; the settled bubble is still measured.
    const fab = el.closest('.chat-fab-wrap');
    if (fab && (fab.classList.contains('chat-fab-away') || getComputedStyle(fab).transform !== 'none')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > W + 1 || r.left < -1) && !scrollsX(el)) {
      out.push((el.className && String(el.className).slice(0, 40)) || el.tagName);
      if (out.length > 5) break;
    }
  }
  return out;
};
// The last visible thing in <main> must sit above the fixed bottom bar once
// the page is scrolled to the very end.
window.__bottomClear = () => {
  const nav = document.querySelector('.bottom-nav');
  if (!nav || !window.__vis(nav)) return { ok: false, why: 'no bottom nav' };
  window.scrollTo(0, document.documentElement.scrollHeight);
  const top = nav.getBoundingClientRect().top;
  const main = document.querySelector('.main-content');
  let lowest = 0, who = '';
  for (const el of main.querySelectorAll('*')) {
    if (!window.__vis(el) || el.children.length) continue;
    const r = el.getBoundingClientRect();
    if (r.height && r.bottom > lowest) { lowest = r.bottom; who = (el.textContent || el.tagName).trim().slice(0, 30); }
  }
  return { ok: lowest <= top + 1, lowest: Math.round(lowest), navTop: Math.round(top), who };
};
window.__small = sel => [...document.querySelectorAll(sel)].filter(window.__vis)
  .map(el => { const r = el.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), t: (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().slice(0, 20) }; })
  .filter(b => b.h < 40 || b.w < 40);
`;

const VIEWS = [
  ['home', 'Home'], ['tasks', 'Tasks'], ['correspondences', 'Correspondences'],
  ['opportunities', 'Opportunities'], ['projects', 'Projects'], ['due-soon', 'Needs you today'],
  ['waiting', 'Waiting'], ['calendar', 'Calendar'], ['clients', 'Clients'], ['overview', 'Overview'],
];

const BOARDS = [['tasks', 'Tasks'], ['correspondences', 'Letters'], ['opportunities', 'Bids'], ['projects', 'Projects']];

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', { url: pathToFileURL(path.join(WORK, 'index.html')).href + '#/home' });
  await sleep(500);
  await waitFor(`document.querySelector('.bottom-nav')`, 'the signed-in app shell');
  await evalJS(HELPERS);

  for (const lang of ['en', 'ar']) {
    console.log(`\n[${lang.toUpperCase()}] 390 x 844`);
    await evalJS(`window.__setLang('${lang}')`);
    await sleep(300);
    check(`${lang}: page direction`, (await evalJS(`document.documentElement.dir`)) === (lang === 'ar' ? 'rtl' : 'ltr'));

    for (const [view, label] of VIEWS) {
      await evalJS(`location.hash = '/${view}'`);
      await sleep(700);
      await evalJS(`window.scrollTo(0, 0)`);
      const over = await evalJS(`window.__overflow()`);
      check(`${lang} ${label}: no sideways scroll`, over <= 0, `${over}px`);
      const str = await evalJS(`JSON.stringify(window.__stranded())`);
      check(`${lang} ${label}: nothing stranded off-screen`, str === '[]', str);
      const bc = await evalJS(`JSON.stringify(window.__bottomClear())`);
      check(`${lang} ${label}: bottom bar never covers the end of the page`, JSON.parse(bc).ok, bc);
      await evalJS(`window.scrollTo(0, 0)`);
      await shot(`${lang}-${view}`);
    }

    // ── E2b: each of the four boards on a phone ──
    console.log(`\n[${lang.toUpperCase()}] boards`);
    for (const [view, label] of BOARDS) {
      await evalJS(`location.hash = '/home'`);   // remount, so state is fresh
      await sleep(300);
      await evalJS(`location.hash = '/${view}'`);
      await sleep(700);
      await evalJS(`window.scrollTo(0, 0)`);
      const b = JSON.parse(await evalJS(`JSON.stringify((() => {
        const head = document.querySelector('.board-head');
        const title = document.querySelector('.board-head-title');
        const act = document.querySelector('.board-head-action');
        const desc = document.querySelector('.board-head-desc');
        const hr = head.getBoundingClientRect(), ar = act.getBoundingClientRect(), tr = title.getBoundingClientRect();
        const tiles = [...document.querySelectorAll('.board-kpi')].filter(window.__vis);
        const tileCut = tiles.filter(t => [...t.querySelectorAll('div')].some(d => d.scrollWidth > d.clientWidth + 1)).map(t => t.textContent.trim().slice(0, 20));
        const labelPx = Math.min(99, ...tiles.map(t => { const l = t.querySelector('.board-kpi-label') || t.children[1]; return parseFloat(getComputedStyle(l).fontSize); }));
        const rows = new Set(tiles.map(t => Math.round(t.getBoundingClientRect().top)));
        const lone = tiles.length % 2 === 1 && tiles.length > 1 && !document.querySelector('.board-kpis--three')
          ? Math.round(tiles[tiles.length - 1].getBoundingClientRect().width) : null;
        const acts = [...document.querySelectorAll('.board-toolbar-actions > .btn')].filter(window.__vis);
        const actTops = new Set(acts.map(a => Math.round(a.getBoundingClientRect().top)));
        const actCut = acts.filter(a => a.scrollWidth > a.clientWidth + 1).map(a => a.textContent.trim());
        const strip = document.querySelector('.groupby-strip'), sel = document.querySelector('.groupby-select');
        const first = document.querySelector('.card-grid-sm > .card');
        return {
          headH: Math.round(hr.height), oneLine: Math.abs(ar.top - tr.top) < 30 || (ar.top < tr.bottom && ar.bottom > tr.top),
          titleCut: title.scrollWidth > title.clientWidth + 1, descShown: !!desc && window.__vis(desc),
          act: { w: Math.round(ar.width), h: Math.round(ar.height), name: act.getAttribute('aria-label') },
          tiles: tiles.length, tileCut, labelPx, tileRows: rows.size, lone,
          acts: acts.length, actRows: actTops.size, actCut,
          stripShown: window.__vis(strip), sel: sel && window.__vis(sel) ? { h: Math.round(sel.getBoundingClientRect().height), n: sel.options.length, v: sel.value } : null,
          firstTop: first ? Math.round(first.getBoundingClientRect().top) : null,
        };
      })())`));
      const why = JSON.stringify(b);
      check(`${lang} ${label}: header is one line (title + "+" button)`, b.oneLine && b.headH <= 64, why);
      check(`${lang} ${label}: title is not cut`, !b.titleCut, why);
      check(`${lang} ${label}: long description hidden on a phone`, !b.descShown, why);
      check(`${lang} ${label}: "+" button is a 40 px target with a spoken name`, b.act.w >= 40 && b.act.h >= 40 && !!b.act.name, why);
      if (b.tiles) {
        check(`${lang} ${label}: number tiles show their words in full`, b.tileCut.length === 0, why);
        check(`${lang} ${label}: tile labels are at least 12 px`, b.labelPx >= 12, why);
        check(`${lang} ${label}: tiles take at most 3 rows`, b.tileRows <= 3, why);
        if (b.lone !== null) check(`${lang} ${label}: an odd last tile fills its row`, b.lone > 300, why);
      }
      check(`${lang} ${label}: toolbar buttons sit on one row, none cut`, b.acts >= 1 && b.actRows === 1 && b.actCut.length === 0, why);
      check(`${lang} ${label}: Group by is a select on a phone (strip hidden)`, !b.stripShown && b.sel && b.sel.h >= 40 && b.sel.n >= 3, why);
      check(`${lang} ${label}: the first group card starts on the first screen`, b.firstTop !== null && b.firstTop < 844 - 64, why);

      // Choosing another grouping in the select really regroups the board.
      const regroup = await evalJS(`(async () => {
        const sel = document.querySelector('.groupby-select');
        const before = [...document.querySelectorAll('.card-grid-sm > .card')].map(c => c.textContent.trim().slice(0, 25)).join('|');
        const next = [...sel.options].find(o => o.value !== sel.value).value;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, next); sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        const pressed = document.querySelector('.groupby-strip [aria-pressed="true"]');
        const after = [...document.querySelectorAll('.card-grid-sm > .card')].map(c => c.textContent.trim().slice(0, 25)).join('|');
        return { ok: sel.value === next && before !== after, next, before: before.slice(0, 60), after: after.slice(0, 60) };
      })()`);
      check(`${lang} ${label}: picking a grouping in the select regroups the board`, regroup.ok, JSON.stringify(regroup));
      await evalJS(`window.scrollTo(0, 0)`);
      await shot(`${lang}-board-${view}`, false);
    }

    // The chat bubble steps aside while the page scrolls, and comes back.
    await evalJS(`location.hash = '/correspondences'`);
    await sleep(600);
    await evalJS(`window.scrollTo(0, 0)`);
    await sleep(900);
    const fab0 = await evalJS(`document.querySelector('.chat-fab-wrap').className`);
    await evalJS(`window.scrollTo(0, 300)`);
    await sleep(120);
    const fab1 = await evalJS(`(() => { const w = document.querySelector('.chat-fab-wrap'); return { c: w.className, op: getComputedStyle(w).opacity }; })()`);
    check(`${lang}: chat bubble steps aside while scrolling`, !fab0.includes('chat-fab-away') && fab1.c.includes('chat-fab-away'), JSON.stringify({ fab0, fab1 }));
    await sleep(1100);
    const fab2 = await evalJS(`(() => { const w = document.querySelector('.chat-fab-wrap'); const b = w.querySelector('.chat-fab').getBoundingClientRect(); return { c: w.className, op: getComputedStyle(w).opacity, w: Math.round(b.width), in: b.left >= 0 && b.right <= innerWidth }; })()`);
    check(`${lang}: chat bubble comes back when scrolling stops (48 px, on screen)`, !fab2.c.includes('chat-fab-away') && fab2.op === '1' && fab2.w === 48 && fab2.in, JSON.stringify(fab2));
    await evalJS(`window.scrollTo(0, 0)`);

    console.log(`\n[${lang.toUpperCase()}] shell`);
    await evalJS(`location.hash = '/home'`);
    await sleep(500);
    const smallTop = await evalJS(`JSON.stringify(window.__small('.topnav button'))`);
    check(`${lang}: top bar buttons are at least 40 px`, smallTop === '[]', smallTop);
    const smallBottom = await evalJS(`JSON.stringify(window.__small('.bottom-tab'))`);
    check(`${lang}: bottom bar tabs are at least 40 px`, smallBottom === '[]', smallBottom);

    // Every tab carries a readable word — not only the active one — and no
    // word is cut short with an ellipsis.
    const labels = await evalJS(`JSON.stringify([...document.querySelectorAll('.bottom-tab span')].map(s => ({
      t: s.textContent.trim(), w: Math.round(s.getBoundingClientRect().width), cut: s.scrollWidth > s.clientWidth + 1,
      op: getComputedStyle(s).opacity })))`);
    const L = JSON.parse(labels);
    check(`${lang}: all five bottom tabs show their label`, L.length === 5 && L.every(l => l.t && l.w > 10 && l.op === '1'), labels);
    check(`${lang}: no bottom-tab label is cut short`, L.every(l => !l.cut), labels);
    check(`${lang}: the bottom bar does not scroll sideways`,
      await evalJS(`(() => { const n = document.querySelector('.bottom-nav'); return n.scrollWidth <= n.clientWidth + 1; })()`));
    const expectTabs = lang === 'ar' ? ['الرئيسية', 'المهام', 'المراسلات', 'الفرص', 'المزيد'] : ['Home', 'Tasks', 'Letters', 'Bids', 'More'];
    check(`${lang}: bottom-tab words`, JSON.stringify(L.map(l => l.t)) === JSON.stringify(expectTabs), L.map(l => l.t).join(' | '));

    // The top bar: logo, search, bell, avatar — nothing else on a phone.
    const topBtns = await evalJS(`[...document.querySelectorAll('.topnav button, .topnav .topnav-avatar, .topnav .topnav-avatar-placeholder, .topnav a')].filter(window.__vis).length`);
    check(`${lang}: the phone top bar holds at most 4 controls`, topBtns <= 4, String(topBtns));
    const av = await evalJS(`(() => { const a = document.querySelector('.topnav-avatar, .topnav-avatar-placeholder'); const r = a.getBoundingClientRect(); return r.width >= 40 && r.height >= 40; })()`);
    check(`${lang}: the avatar is a 40 px target`, av);

    // Theme moved into the avatar menu.
    await evalJS(`document.querySelector('.topnav-avatar, .topnav-avatar-placeholder').click()`);
    await sleep(250);
    const themeRow = await evalJS(`(() => { const b = document.querySelector('[data-menu="theme"]'); return b && window.__vis(b) ? b.textContent.trim() : null; })()`);
    check(`${lang}: the avatar menu offers the theme switch`, !!themeRow, String(themeRow));
    const um = await evalJS(`(() => { const m = document.querySelector('.user-menu'); const r = m.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) }; })()`);
    check(`${lang}: the avatar menu stays inside the screen`, um.l >= 0 && um.r <= 390, JSON.stringify(um));
    await shot(`${lang}-avatar-menu`, false);
    const before = await evalJS(`document.documentElement.getAttribute('data-theme')`);
    await evalJS(`document.querySelector('[data-menu="theme"]').click()`);
    await sleep(250);
    const after = await evalJS(`document.documentElement.getAttribute('data-theme')`);
    check(`${lang}: the theme row switches the theme`, before !== after && !!after, `${before} -> ${after}`);
    await evalJS(`document.querySelector('.topnav-avatar, .topnav-avatar-placeholder').click()`);
    await sleep(200);
    await evalJS(`document.querySelector('[data-menu="theme"]').click()`);   // back to light
    await sleep(250);
    check(`${lang}: and back`, (await evalJS(`document.documentElement.getAttribute('data-theme')`)) === before);

    // The More sheet: 15 destinations for a manager. It must fit the phone and
    // scroll inside itself rather than run off the top of the screen.
    await evalJS(`[...document.querySelectorAll('.bottom-tab')].pop().click()`);
    await sleep(300);
    const sheet = await evalJS(`(() => { const s = document.querySelector('[data-more-sheet]'); if (!s) return null;
      const r = s.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), scrolls: s.scrollHeight > s.clientHeight, oy: getComputedStyle(s).overflowY }; })()`);
    check(`${lang}: the More sheet is marked`, !!sheet);
    check(`${lang}: the More sheet starts on screen (top >= 48 px)`, sheet && sheet.top >= 48, JSON.stringify(sheet));
    check(`${lang}: the More sheet can scroll inside itself`, sheet && (sheet.oy === 'auto' || sheet.oy === 'scroll'), JSON.stringify(sheet));
    const lastReach = await evalJS(`(() => { const s = document.querySelector('[data-more-sheet]'); s.scrollTop = s.scrollHeight;
      const b = [...s.querySelectorAll('button')].pop(); const r = b.getBoundingClientRect();
      const nav = document.querySelector('.bottom-nav').getBoundingClientRect(); return r.bottom <= nav.top + 1 && r.top >= 0; })()`);
    check(`${lang}: the last More item can be reached`, lastReach);
    check(`${lang}: the chat bubble steps aside while More is open`,
      await evalJS(`(() => { const f = document.querySelector('.chat-fab-wrap'); return !f || !window.__vis(f); })()`));
    const needs = await evalJS(`[...document.querySelectorAll('[data-more-sheet] button')].map(b => b.textContent.trim()).join(' | ')`);
    check(`${lang}: More offers "Needs you today" (the top-bar alert is hidden on a phone)`,
      needs.includes(lang === 'ar' ? 'يحتاج انتباهك اليوم' : 'Needs you today'), needs.slice(0, 200));
    await shot(`${lang}-more`, false);
    await evalJS(`[...document.querySelectorAll('.bottom-tab')].pop().click()`);
    await sleep(200);
  }

  // Desktop is untouched by the phone rules.
  console.log('\n[EN] desktop 1280 x 900');
  await evalJS(`window.__setLang('en')`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const [view, label] of BOARDS) {
    await evalJS(`location.hash = '/home'`); await sleep(300);
    await evalJS(`location.hash = '/${view}'`); await sleep(700);
    const d = JSON.parse(await evalJS(`JSON.stringify((() => {
      const desc = document.querySelector('.board-head-desc');
      return {
        label: window.__vis(document.querySelector('.board-head-label')),
        desc: desc ? window.__vis(desc) : null,
        icon: document.querySelector('.board-head-icon') ? window.__vis(document.querySelector('.board-head-icon')) : null,
        strip: window.__vis(document.querySelector('.groupby-strip')),
        select: window.__vis(document.querySelector('.groupby-select')),
        actions: getComputedStyle(document.querySelector('.board-toolbar-actions')).display,
      };
    })())`));
    check(`desktop ${label}: header keeps its words${d.desc !== null ? ' and description' : ''}${d.icon !== null ? ' and icon' : ''}`,
      d.label && d.desc !== false && d.icon !== false, JSON.stringify(d));
    check(`desktop ${label}: Group by stays the button strip, toolbar row unchanged`, d.strip && !d.select && d.actions === 'contents', JSON.stringify(d));
  }
  await shot('desktop-projects', false);

  check('no uncaught page errors', pageErrors.length === 0 && (await evalJS(`window.__errors.length`)) === 0,
    (pageErrors.join(' || ') + ' ' + (await evalJS(`window.__errors.join(' || ')`))).slice(0, 500));
} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 400)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'scripts/harness/mobileui-failure.png'), Buffer.from(s.data, 'base64'));
  } catch { /* best effort */ }
}

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
try { ws.close(); } catch {}
edge.kill();
await sleep(300);
try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
