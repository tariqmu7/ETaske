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
// Tidy Tasks T2: a FINISHED task (due yesterday — the old date-only order put it
// first) and a later open one, both the manager's and both newest-created.
T('t5', { taskName: 'Send the signed NDA to Petrojet', dueDate: dayOffset(-1), status: 'Done', assignedToId: 'u-mgr', assignedTo: 'Tariq Salama', serialNumber: 'TK000305', createdAt: ts(-1) });
T('t6', { taskName: 'Book the kick-off meeting room', dueDate: dayOffset(10), status: 'Pending', priority: 'Low', assignedToId: 'u-mgr', assignedTo: 'Tariq Salama', serialNumber: 'TK000306', createdAt: ts(-1) });

const C = (id, extra) => __seed('correspondences', id, { body: 'Please confirm the scope and the schedule.', sentFrom: 'NNPC', dateReceived: dayOffset(-10), createdAt: ts(-10), updatedAt: ts(-1), userId: 'u-mgr', teamId: 'T1', ...extra });
C('l1', { subject: 'Clarification on the scope of the turnaround maintenance works', deadline: dayOffset(-1), status: 'Assigned', assignedToId: 'u-mgr', assignedTo: 'Tariq Salama', serialNumber: 'CR000401' });
C('l2', { subject: 'New enquiry from WEPCO', status: 'Unread', serialNumber: 'CR000402' });
C('l3', { subject: 'دعوة للمشاركة في مناقصة صيانة الخزانات', status: 'Reviewing', serialNumber: 'CR000403', sentFrom: 'بتروجت' });
// Tidy T5a: a closed NNPC letter, folded away under "Show 1 closed".
C('l4', { subject: 'Signed minutes of the handover meeting', deadline: dayOffset(-3), status: 'Closed', assignedToId: 'u-mgr', assignedTo: 'Tariq Salama', serialNumber: 'CR000404' });

__seed('opportunities', 'o1', { title: 'Tank farm maintenance framework agreement', client: 'NNPC', stage: 'Bid Preparation', submissionDeadline: dayOffset(3), ownerId: 'u-ahmed', ownerName: 'Ahmed Samir', serialNumber: 'OP000011', estimatedValue: 12000000, currency: 'EGP', winProbability: 40, createdAt: ts(-20), updatedAt: ts(-1) });
__seed('opportunities', 'o2', { title: 'Terminal upgrade', client: 'Petromint', stage: 'Submitted', submissionDeadline: dayOffset(-5), ownerId: 'u-mgr', ownerName: 'Tariq Salama', serialNumber: 'OP000012', estimatedValue: 5000000, currency: 'EGP', createdAt: ts(-40), updatedAt: ts(-3) });

// Tidy T5b: the manager's bids - o4 late (not yet submitted), o2 submitted
// (its passed deadline is NOT late), o3 lost (folded under "Show 1 closed").
__seed('opportunities', 'o3', { title: 'Jetty inspection services', client: 'NNPC', stage: 'Lost', submissionDeadline: dayOffset(-30), ownerId: 'u-mgr', ownerName: 'Tariq Salama', serialNumber: 'OP000013', estimatedValue: 800000, currency: 'EGP', createdAt: ts(-1), updatedAt: ts(-1) });
__seed('opportunities', 'o4', { title: 'Crude tank cleaning call-off for the western desert fields', client: 'Khalda', stage: 'Identified', submissionDeadline: dayOffset(-2), ownerId: 'u-mgr', ownerName: 'Tariq Salama', serialNumber: 'OP000014', estimatedValue: 2500000, currency: 'EGP', createdAt: ts(-50), updatedAt: ts(-2),
  checklist: [{ id: 's1', title: 'Bid bond', dueDate: dayOffset(-4), done: false }, { id: 's2', title: 'Technical offer', dueDate: dayOffset(-3), done: true }] });

__seed('projects', 'p1', { name: 'Meleiha gas plant operations and maintenance', client: 'AGIBA', status: 'Active', serialNumber: 'PR000003', startDate: dayOffset(-200), endDate: dayOffset(160), userId: 'u-mgr', teamId: 'T1', createdAt: ts(-200), updatedAt: ts(-4) });
// Tidy T5c: the manager's projects - p2 running past its end date (late),
// p1 ending in 160 days, p3 Completed (folded under "Show 1 finished").
__seed('projects', 'p2', { name: 'Ras Gharib tank farm rehabilitation and inspection works', client: 'GPC', status: 'Active', serialNumber: 'PR000004', startDate: dayOffset(-300), endDate: dayOffset(-5), userId: 'u-mgr', teamId: 'T1', createdAt: ts(-300), updatedAt: ts(-6),
  checklist: [{ id: 's1', title: 'Contract signed', dueDate: dayOffset(-290), done: true }, { id: 's2', title: 'First invoice issued', dueDate: dayOffset(-10), done: false }] });
__seed('projects', 'p3', { name: 'Abu Qir jetty repairs', client: 'Abu Qir Petroleum', status: 'Completed', serialNumber: 'PR000002', startDate: dayOffset(-400), endDate: dayOffset(-60), userId: 'u-mgr', teamId: 'T1', createdAt: ts(-1), updatedAt: ts(-1) });
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

// Tidy Tasks T1: the Tasks board's SLIM ROWS. Groups by status, opens the
// "In Progress" card (the manager's two late seeded tasks, one with an Arabic title)
// and measures the rows themselves: short, no sideways scroll, ONE status
// label per row whose menu holds the three states, Arabic title set rtl.
async function slimRows(tag, phone) {
  await evalJS(`location.hash = '/home'`); await sleep(300);
  await evalJS(`location.hash = '/tasks'`); await sleep(700);
  await evalJS(`(async () => {
    const sel = document.querySelector('.groupby-select, .groupby-compact select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'status'); sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const cards = [...document.querySelectorAll('button[data-group-card]')];
    const card = cards.find(c => /In Progress|قيد التنفيذ/.test(c.textContent)) || cards[0];
    card.click();
    await new Promise(r => setTimeout(r, 500));
    window.scrollTo(0, 0);
  })()`);
  const r = JSON.parse(await evalJS(`JSON.stringify((() => {
    const rows = [...document.querySelectorAll('.card[id^="task-"]')].filter(window.__vis);
    const h = rows.map(c => Math.round(c.querySelector('[data-task-row]').getBoundingClientRect().height));
    const labels = rows.map(c => c.querySelectorAll('button[data-status]').length);
    const pills = rows.map(c => [...c.querySelectorAll('button')].filter(b => /^(Pending|In Progress|Done|قيد الانتظار|قيد التنفيذ|منجز)$/.test(b.textContent.trim())).length);
    const ar = [...document.querySelectorAll('.task-row-title')].find(t => /[؀-ۿ]/.test(t.textContent));
    const edges = rows.map(c => { const s = getComputedStyle(c); return [s.borderLeftWidth, s.borderRightWidth]; });
    const rowOver = rows.filter(c => c.scrollWidth > c.clientWidth + 1).length;
    return { n: rows.length, h, labels, pills, arDir: ar ? getComputedStyle(ar).direction : null, edges, rowOver, over: window.__overflow() };
  })())`));
  const why = JSON.stringify(r);
  const maxH = phone ? 110 : 52;  // one line on a desktop, two on a phone
  check(`${tag}: the opened group shows slim task rows`, r.n >= 2, why);
  check(`${tag}: every row is short (≤ ${maxH}px — was a ~150px card)`, r.h.every(x => x <= maxH), why);
  check(`${tag}: ONE status label per row, no three-pill control`, r.labels.every(x => x === 1) && r.pills.every(x => x === 1), why);
  check(`${tag}: an Arabic title is laid out right-to-left`, r.arDir === 'rtl', why);
  check(`${tag}: no sideways scroll on the page or inside a row`, r.over <= 0 && r.rowOver === 0, why);
  // No per-person colour stripe: a side is the 1px hairline or a 3px late edge.
  check(`${tag}: no per-person 4px colour stripe`, r.edges.every(e => e.every(w => w === '1px' || w === '3px')), why);
  // The status menu opens with all three states and closes again.
  const menu = JSON.parse(await evalJS(`(async () => {
    const b = document.querySelector('.card[id^="task-"] button[data-status]');
    b.click(); await new Promise(r => setTimeout(r, 250));
    const opts = [...document.querySelectorAll('[role="menu"] [data-status-option]')].map(o => o.getAttribute('data-status-option'));
    const m = document.querySelector('[role="menu"]'); const mr = m && m.getBoundingClientRect();
    const inView = !!mr && mr.left >= 0 && mr.right <= innerWidth + 1;
    b.click(); await new Promise(r => setTimeout(r, 250));
    return JSON.stringify({ opts, inView, closed: !document.querySelector('[role="menu"] [data-status-option]') });
  })()`));
  check(`${tag}: the status label opens a menu of the three states, on screen`,
    menu.opts.join('|') === 'Pending|In Progress|Done' && menu.inView, JSON.stringify(menu));
  // Opening a row brings back what the slim row leaves out — moved, not deleted.
  const open = JSON.parse(await evalJS(`(async () => {
    const row = document.querySelector('.card[id^="task-"] [data-task-row]');
    const card = row.closest('.card');
    const before = card.innerText.length;
    row.querySelector('h3').click(); await new Promise(r => setTimeout(r, 500));
    const txt = card.innerText;
    const res = { before, after: txt.length, desc: txt.includes('Coordinate with the client'), details: !!card.querySelector('.task-row-details'), ms: !!card.querySelector('.task-expand') };
    row.querySelector('h3').click(); await new Promise(r => setTimeout(r, 500));
    res.closed = !card.querySelector('.task-row-details');
    return JSON.stringify(res);
  })()`));
  check(`${tag}: opening a row shows the description, details and milestones; closing hides them`,
    open.desc && open.details && open.ms && open.after > open.before && open.closed, JSON.stringify(open));
}

// Tidy Tasks T2: urgent first, finished folded. Groups by assignee and opens
// the manager's card: late → due today → later, the finished task hidden behind
// "Show 1 finished"; the choice is remembered, and hiding again works.
async function finishedFold(tag) {
  await evalJS(`(() => { try { localStorage.removeItem('etaske:tasks:showDone'); } catch {} })()`);
  await evalJS(`location.hash = '/home'`); await sleep(300);
  await evalJS(`location.hash = '/tasks'`); await sleep(700);
  const order = async () => JSON.parse(await evalJS(`JSON.stringify([...document.querySelectorAll('.card[id^="task-"]')].filter(window.__vis).map(c => c.id.replace('task-', '')))`));
  await evalJS(`(async () => {
    const sel = document.querySelector('.groupby-select, .groupby-compact select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'user'); sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const card = [...document.querySelectorAll('button[data-group-card]')].find(c => /Tariq Salama/.test(c.textContent));
    card.click();
    await new Promise(r => setTimeout(r, 500));
  })()`);
  const before = await order();
  const btn = JSON.parse(await evalJS(`JSON.stringify((() => { const b = document.querySelector('[data-finished-toggle]'); return b ? { mode: b.getAttribute('data-finished-toggle'), text: b.textContent.trim() } : null; })())`));
  check(`${tag}: open work in urgent order (late → today → later), finished hidden`, before.join('|') === 't2|t3|t6', JSON.stringify(before));
  check(`${tag}: a "Show 1 finished" button sits under the list`, !!btn && btn.mode === 'show' && /1/.test(btn.text), JSON.stringify(btn));
  await evalJS(`document.querySelector('[data-finished-toggle]').click()`); await sleep(400);
  const shown = await order();
  const saved = await evalJS(`(() => { try { return localStorage.getItem('etaske:tasks:showDone'); } catch { return 'x'; } })()`);
  check(`${tag}: "Show" brings the finished task back, LAST`, shown.join('|') === 't2|t3|t6|t5', JSON.stringify(shown));
  check(`${tag}: the choice is remembered`, saved === '1', saved);
  await evalJS(`document.querySelector('[data-finished-toggle="hide"]').click()`); await sleep(400);
  const hidden = await order();
  check(`${tag}: "Hide finished" folds it again`, hidden.join('|') === 't2|t3|t6'
    && (await evalJS(`localStorage.getItem('etaske:tasks:showDone')`)) === '0', JSON.stringify(hidden));
  check(`${tag}: no sideways scroll`, (await evalJS(`window.__overflow()`)) <= 0);
}

// Tidy Tasks T3: the toolbar on ONE row (desktop) / TWO rows (phone), the
// group tabs that replaced "← All Groups", and the open · late · finished
// counts on the section header. Groups by status and opens "In Progress"
// (the manager's two open tasks, one of them late).
async function toolbarTabs(tag, phone) {
  await evalJS(`location.hash = '/home'`); await sleep(300);
  await evalJS(`location.hash = '/tasks'`); await sleep(700);
  await evalJS(`window.scrollTo(0, 0)`);
  const bar = JSON.parse(await evalJS(`JSON.stringify((() => {
    const tb = document.querySelector('.board-toolbar--compact');
    if (!tb) return null;
    const parts = {
      scope: tb.querySelector('.board-toolbar-scope'),
      search: tb.querySelector('input[type=text]'),
      group: tb.querySelector('.groupby-compact select'),
      filters: tb.querySelector('.board-toolbar-actions > .btn'),
    };
    const box = {};
    for (const [k, el] of Object.entries(parts)) {
      const r = el && window.__vis(el) ? el.getBoundingClientRect() : null;
      box[k] = r ? { top: Math.round(r.top), mid: Math.round(r.top + r.height / 2), h: Math.round(r.height), w: Math.round(r.width) } : null;
    }
    const mids = Object.values(box).filter(Boolean).map(b => b.mid).sort((a, b) => a - b);
    let rows = mids.length ? 1 : 0;
    for (let i = 1; i < mids.length; i++) if (mids[i] - mids[i - 1] > 12) rows++;
    const f = parts.filters;
    return { box, rows, h: Math.round(tb.getBoundingClientRect().height), fname: f && (f.getAttribute('aria-label') || f.textContent.trim()),
      cut: [...tb.querySelectorAll('button, select')].filter(window.__vis).filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent.trim().slice(0, 15)) };
  })())`));
  const why = JSON.stringify(bar);
  check(`${tag}: the Tasks toolbar is the compact one`, !!bar, why);
  if (!bar) return;
  check(`${tag}: scope, search, Group by and Filters are all shown`, Object.values(bar.box).every(Boolean), why);
  if (phone) {
    check(`${tag}: toolbar is TWO rows on a phone (search, then scope · group · Filters)`, bar.rows === 2
      && bar.box.search.top < bar.box.scope.top && Math.abs(bar.box.scope.mid - bar.box.group.mid) <= 6 && Math.abs(bar.box.group.mid - bar.box.filters.mid) <= 6, why);
    check(`${tag}: Group by and Filters are 40 px targets; Filters keeps a spoken name`, bar.box.group.h >= 40 && bar.box.filters.h >= 40 && bar.box.filters.w >= 40 && !!bar.fname, why);
  } else {
    check(`${tag}: toolbar is ONE row on a desktop`, bar.rows === 1 && bar.h <= 60, why);
  }
  check(`${tag}: no toolbar control is cut`, bar.cut.length === 0, why);

  // Open "In Progress" from the grid → the tab strip replaces the back box.
  await evalJS(`(async () => {
    const sel = document.querySelector('.groupby-compact select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'status'); sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const cards = [...document.querySelectorAll('button[data-group-card]')];
    (cards.find(c => /In Progress|قيد التنفيذ/.test(c.textContent)) || cards[0]).click();
    await new Promise(r => setTimeout(r, 500));
    window.scrollTo(0, 0);
  })()`);
  const tabs = JSON.parse(await evalJS(`JSON.stringify((() => {
    const nav = document.querySelector('[data-group-tabs]');
    const all = [...document.querySelectorAll('[data-group-tab]')];
    const cur = document.querySelector('[data-group-tab][aria-current="true"]');
    const back = [...document.querySelectorAll('button')].filter(window.__vis).filter(b => !b.closest('[data-group-tabs]') && /^(All Groups|كل المجموعات)$/.test(b.textContent.trim())).length;
    const counts = document.querySelector('[data-group-counts]');
    const late = counts && counts.querySelector('.group-head-chip--late');
    return { nav: !!nav && window.__vis(nav), n: all.length, first: all[0] && all[0].getAttribute('data-group-tab'),
      cur: cur && cur.getAttribute('data-group-tab'), curText: cur && cur.textContent.trim(), curLate: !!cur && !!cur.querySelector('.group-tab-late'),
      back, counts: counts && counts.innerText.replace(/\\s+/g, ' ').trim(), late: late && late.textContent.trim(),
      navH: nav && Math.round(nav.getBoundingClientRect().height), over: window.__overflow() };
  })())`));
  const w2 = JSON.stringify(tabs);
  check(`${tag}: an opened group shows the tab strip, not a lone back box`, tabs.nav && tabs.back === 0, w2);
  check(`${tag}: first tab = all groups, then one tab per group`, tabs.first === '' && tabs.n >= 3, w2);
  check(`${tag}: the open group's tab is marked, with its size and a red late count`, tabs.cur === 'In Progress' && /2/.test(tabs.curText) && tabs.curLate, w2);
  check(`${tag}: the section header counts open · late`, !!tabs.counts && /2/.test(tabs.counts) && !!tabs.late && /1/.test(tabs.late), w2);
  check(`${tag}: the tab strip is one slim row, no sideways page scroll`, tabs.navH <= 48 && tabs.over <= 0, w2);
  await shot(`${phone ? (/ar /.test(tag) ? 'ar' : 'en') : 'desktop'}-task-toolbar`, false);

  // Another tab switches group straight away; the first tab goes back to the grid.
  const hop = JSON.parse(await evalJS(`(async () => {
    const other = [...document.querySelectorAll('[data-group-tab]')].find(b => b.getAttribute('data-group-tab') && b.getAttribute('aria-current') !== 'true');
    const key = other.getAttribute('data-group-tab');
    other.click(); await new Promise(r => setTimeout(r, 400));
    const cur = document.querySelector('[data-group-tab][aria-current="true"]');
    const switched = !!cur && cur.getAttribute('data-group-tab') === key;
    document.querySelector('[data-group-tab=""]').click(); await new Promise(r => setTimeout(r, 400));
    return JSON.stringify({ key, switched, grid: document.querySelectorAll('button[data-group-card]').length, tabsGone: !document.querySelector('[data-group-tabs]') });
  })()`));
  check(`${tag}: another tab opens that group; "All groups" returns to the grid`, hop.switched && hop.grid >= 2 && hop.tabsGone, JSON.stringify(hop));
}

// Tidy T5a: the Letters board gets the Tasks tidy-up — slim one-line rows,
// late first with closed letters folded, the compact toolbar, group tabs and
// open · late · closed counts. Shows ALL letters (Total), groups by sender and
// opens NNPC: l1 (late, assigned), l2 (unread, unassigned), l4 (closed).
async function letterRows(tag, phone) {
  await evalJS(`(() => { try { localStorage.removeItem('etaske:letters:showClosed'); } catch {} })()`);
  await evalJS(`location.hash = '/home'`); await sleep(300);
  await evalJS(`location.hash = '/correspondences'`); await sleep(700);
  const compact = await evalJS(`!!document.querySelector('.board-toolbar--compact .groupby-compact select')`);
  check(`${tag}: the Letters toolbar is the compact one (Group by dropdown)`, compact);
  await evalJS(`(async () => {
    document.querySelectorAll('.board-kpi')[1].click();
    await new Promise(r => setTimeout(r, 300));
    const sel = document.querySelector('.groupby-compact select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'sender'); sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const card = [...document.querySelectorAll('button[data-group-card]')].find(c => /NNPC/.test(c.textContent));
    card.click();
    await new Promise(r => setTimeout(r, 500));
    window.scrollTo(0, 0);
  })()`);
  const order = async () => JSON.parse(await evalJS(`JSON.stringify([...document.querySelectorAll('[data-corr-row]')].filter(window.__vis).map(r => r.getAttribute('data-corr-row')))`));
  const r = JSON.parse(await evalJS(`JSON.stringify((() => {
    const rows = [...document.querySelectorAll('[data-corr-row]')].filter(window.__vis);
    const h = rows.map(x => Math.round(x.getBoundingClientRect().height));
    const cards = rows.map(x => x.closest('.card'));
    const edges = cards.map(c => { const s = getComputedStyle(c); return [s.borderLeftWidth, s.borderRightWidth]; });
    const rowOver = cards.filter(c => c.scrollWidth > c.clientWidth + 1).length;
    const tog = document.querySelector('[data-closed-toggle]');
    const cur = document.querySelector('[data-group-tab][aria-current="true"]');
    const counts = document.querySelector('[data-group-counts]');
    return { h, edges, rowOver, over: window.__overflow(),
      body: rows.some(x => x.closest('.card').innerText.includes('Please confirm the scope')),
      from: rows.filter(x => x.querySelector('.task-row-from')).length,
      tog: tog && { mode: tog.getAttribute('data-closed-toggle'), text: tog.textContent.trim() },
      tabs: !!document.querySelector('[data-group-tabs]'), cur: cur && cur.getAttribute('data-group-tab'), curLate: !!cur && !!cur.querySelector('.group-tab-late'),
      counts: counts && counts.innerText.replace(/\\s+/g, ' ').trim(),
      late: !!(counts && counts.querySelector('.group-head-chip--late')), closedChip: !!(counts && counts.querySelector('.group-head-chip--done')) };
  })())`));
  const why = JSON.stringify(r);
  // Desktop: two lines beside the manager's workload panel (was a ~150-300px card).
  const maxH = phone ? 110 : 90;
  const first = await order();
  check(`${tag}: late letter first, closed letter folded away`, first.join('|') === 'l1|l2', JSON.stringify(first));
  check(`${tag}: every letter row is short (≤ ${maxH}px)`, r.h.length === 2 && r.h.every(x => x <= maxH), why);
  check(`${tag}: the letter body is not on the row any more`, !r.body, why);
  check(`${tag}: grouped by sender, the rows do not repeat the sender`, r.from === 0, why);
  check(`${tag}: a late row gets a 3px edge, no per-person stripe`, r.edges.every(e => e.every(w => w === '1px' || w === '3px')) && r.edges[0].includes('3px'), why);
  check(`${tag}: no sideways scroll on the page or inside a row`, r.over <= 0 && r.rowOver === 0, why);
  check(`${tag}: group tabs shown, NNPC marked with a red late count`, r.tabs && r.cur === 'NNPC' && r.curLate, why);
  check(`${tag}: the section header counts open · late · closed`, !!r.counts && r.late && r.closedChip, why);
  check(`${tag}: a "Show 1 closed" button sits under the list`, !!r.tog && r.tog.mode === 'show' && /1/.test(r.tog.text), why);

  // Quick assign opens under its row on demand, and closes again.
  const qa = JSON.parse(await evalJS(`(async () => {
    const b = document.querySelector('[data-quick-assign="l2"]');
    if (!b) return JSON.stringify({ btn: false });
    const bw = Math.round(b.getBoundingClientRect().height);
    const before = !!document.querySelector('[data-quick-assign-panel]');
    b.click(); await new Promise(r => setTimeout(r, 300));
    const p = document.querySelector('[data-quick-assign-panel="l2"]');
    const open = !!p && window.__vis(p) && !!p.querySelector('select');
    const over = window.__overflow();
    const modal = !!document.querySelector('[data-corr-details]');
    b.click(); await new Promise(r => setTimeout(r, 300));
    return JSON.stringify({ btn: true, bw, before, open, over, modal, closed: !document.querySelector('[data-quick-assign-panel]'),
      onAssigned: !!document.querySelector('[data-quick-assign="l1"]') });
  })()`));
  check(`${tag}: "Assign" on an unassigned row opens quick assign under it (not the detail window) and closes again`,
    qa.btn && !qa.before && qa.open && !qa.modal && qa.closed && qa.over <= 0 && !qa.onAssigned, JSON.stringify(qa));

  // Clicking a row opens the detail window, which still holds the body.
  const det = JSON.parse(await evalJS(`(async () => {
    document.querySelector('[data-corr-row="l1"] h3').click(); await new Promise(r => setTimeout(r, 500));
    const m = document.querySelector('[data-corr-details]');
    const txt = m ? m.innerText : '';
    if (m) { m.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 500)); }
    return JSON.stringify({ open: !!m, body: txt.includes('Please confirm the scope'), serial: txt.includes('CR000401'), closed: !document.querySelector('[data-corr-details]') });
  })()`));
  check(`${tag}: clicking a row opens the letter with its body; it closes again`, det.open && det.body && det.serial && det.closed, JSON.stringify(det));

  await shot(`${phone ? (/ar /.test(tag) ? 'ar' : 'en') : 'desktop'}-letter-rows`, false);
  await evalJS(`document.querySelector('[data-closed-toggle]').click()`); await sleep(400);
  const shown = await order();
  const saved = await evalJS(`(() => { try { return localStorage.getItem('etaske:letters:showClosed'); } catch { return 'x'; } })()`);
  check(`${tag}: "Show" brings the closed letter back, LAST, and is remembered`, shown.join('|') === 'l1|l2|l4' && saved === '1', JSON.stringify({ shown, saved }));
  await evalJS(`document.querySelector('[data-closed-toggle="hide"]').click()`); await sleep(400);
  const hidden = await order();
  check(`${tag}: "Hide closed" folds it again`, hidden.join('|') === 'l1|l2'
    && (await evalJS(`localStorage.getItem('etaske:letters:showClosed')`)) === '0', JSON.stringify(hidden));

  // Put the board back the way the rest of the run expects it.
  await evalJS(`(async () => {
    document.querySelector('[data-group-tab=""]').click();
    await new Promise(r => setTimeout(r, 300));
    const sel = document.querySelector('.groupby-compact select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'status'); sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    document.querySelectorAll('.board-kpi')[0].click();
    await new Promise(r => setTimeout(r, 300));
    try { localStorage.removeItem('etaske:letters:showClosed'); } catch {}
  })()`);
}

// Tidy T5b: the Bids board gets the same tidy-up. Groups by owner and opens
// Tariq: o4 (late, not submitted), o2 (submitted — never "late"), o3 (lost).
async function bidRows(tag, phone) {
  await evalJS(`(() => { try { localStorage.removeItem('etaske:bids:showClosed'); } catch {} })()`);
  await evalJS(`location.hash = '/home'`); await sleep(300);
  await evalJS(`location.hash = '/opportunities'`); await sleep(700);
  const compact = await evalJS(`!!document.querySelector('.board-toolbar--compact .groupby-compact select')`);
  check(`${tag}: the Bids toolbar is the compact one (Group by dropdown)`, compact);
  await evalJS(`(async () => {
    const sel = document.querySelector('.groupby-compact select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'owner'); sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const card = [...document.querySelectorAll('button[data-group-card]')].find(c => /Tariq/.test(c.textContent));
    card.click();
    await new Promise(r => setTimeout(r, 500));
    window.scrollTo(0, 0);
  })()`);
  const order = async () => JSON.parse(await evalJS(`JSON.stringify([...document.querySelectorAll('[data-opp-row]')].filter(window.__vis).map(r => r.getAttribute('data-opp-row')))`));
  const r = JSON.parse(await evalJS(`JSON.stringify((() => {
    const rows = [...document.querySelectorAll('[data-opp-row]')].filter(window.__vis);
    const h = rows.map(x => Math.round(x.getBoundingClientRect().height));
    const cards = rows.map(x => x.closest('.card'));
    const edges = cards.map(c => { const s = getComputedStyle(c); return [s.borderLeftWidth, s.borderRightWidth]; });
    const rowOver = cards.filter(c => c.scrollWidth > c.clientWidth + 1).length;
    const tog = document.querySelector('[data-closed-toggle]');
    const cur = document.querySelector('[data-group-tab][aria-current="true"]');
    const counts = document.querySelector('[data-group-counts]');
    const due = id => { const d = document.querySelector('[data-opp-row="' + id + '"] [data-opp-due]'); return d ? getComputedStyle(d).color : null; };
    const steps = document.querySelector('[data-opp-row="o4"] [data-testid=opp-card-checklist]');
    return { h, edges, rowOver, over: window.__overflow(),
      owner: rows.filter(x => x.querySelector('.task-row-owner')).length,
      client: rows.map(x => (x.querySelector('.task-row-from') || {}).textContent || '').join('|'),
      dueLate: due('o4'), dueSubmitted: due('o2'), steps: steps && steps.textContent.trim(),
      tog: tog && { mode: tog.getAttribute('data-closed-toggle'), text: tog.textContent.trim() },
      tabs: !!document.querySelector('[data-group-tabs]'), curLate: !!cur && !!cur.querySelector('.group-tab-late'),
      counts: counts && counts.innerText.replace(/\\s+/g, ' ').trim(),
      late: !!(counts && counts.querySelector('.group-head-chip--late')), closedChip: !!(counts && counts.querySelector('.group-head-chip--done')) };
  })())`));
  const why = JSON.stringify(r);
  // Desktop: two lines (~82px) — the ~1,000px page is too narrow for every
  // bid column AND a readable title on one line (was a ~190px card).
  const maxH = phone ? 110 : 90;
  const first = await order();
  check(`${tag}: late bid first, submitted next, lost bid folded away`, first.join('|') === 'o4|o2', JSON.stringify(first));
  check(`${tag}: every bid row is short (≤ ${maxH}px)`, r.h.length === 2 && r.h.every(x => x <= maxH), why);
  check(`${tag}: grouped by owner, the rows do not repeat the owner; the client is on the row`, r.owner === 0 && /Khalda/.test(r.client) && /Petromint/.test(r.client), why);
  check(`${tag}: the late deadline is red; a submitted bid's passed deadline is not`, /239, 68, 68/.test(r.dueLate || '') && !/239, 68, 68/.test(r.dueSubmitted || ''), why);
  check(`${tag}: the checklist count stays on the row`, !!r.steps && /1\/2/.test(r.steps), why);
  check(`${tag}: a late row gets a 3px edge, no stage stripe`, r.edges.every(e => e.every(w => w === '1px' || w === '3px')) && r.edges[0].includes('3px') && !r.edges[1].includes('3px'), why);
  check(`${tag}: no sideways scroll on the page or inside a row`, r.over <= 0 && r.rowOver === 0, why);
  check(`${tag}: group tabs shown, Tariq's tab carries a red late count`, r.tabs && r.curLate, why);
  check(`${tag}: the section header counts open · late · closed`, !!r.counts && r.late && r.closedChip, why);
  check(`${tag}: a "Show 1 closed bids" button sits under the list`, !!r.tog && r.tog.mode === 'show' && /1/.test(r.tog.text), why);

  await shot(`${phone ? (/ar /.test(tag) ? 'ar' : 'en') : 'desktop'}-bid-rows`, false);
  await evalJS(`document.querySelector('[data-closed-toggle]').click()`); await sleep(400);
  const shown = await order();
  const saved = await evalJS(`(() => { try { return localStorage.getItem('etaske:bids:showClosed'); } catch { return 'x'; } })()`);
  check(`${tag}: "Show" brings the lost bid back, LAST, and is remembered`, shown.join('|') === 'o4|o2|o3' && saved === '1', JSON.stringify({ shown, saved }));
  await evalJS(`document.querySelector('[data-closed-toggle="hide"]').click()`); await sleep(400);
  const hidden = await order();
  check(`${tag}: "Hide closed bids" folds it again`, hidden.join('|') === 'o4|o2'
    && (await evalJS(`localStorage.getItem('etaske:bids:showClosed')`)) === '0', JSON.stringify(hidden));

  // Clicking a row opens the bid page.
  const det = JSON.parse(await evalJS(`(async () => {
    document.querySelector('[data-opp-row="o4"] h3').click(); await new Promise(r => setTimeout(r, 600));
    const page = !document.querySelector('[data-opp-row]') && document.body.innerText.includes('OP000014');
    return JSON.stringify({ page });
  })()`));
  check(`${tag}: clicking a row opens that bid's page`, det.page, JSON.stringify(det));

  // Put the board back the way the rest of the run expects it (leaving the
  // view unmounts the bid page).
  await evalJS(`location.hash = '/home'`); await sleep(300);
  await evalJS(`location.hash = '/opportunities'`); await sleep(600);
  await evalJS(`(async () => {
    const tab = document.querySelector('[data-group-tab=""]');
    if (tab) { tab.click(); await new Promise(r => setTimeout(r, 300)); }
    const sel = document.querySelector('.groupby-compact select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'stage'); sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    try { localStorage.removeItem('etaske:bids:showClosed'); } catch {}
  })()`);
}

// Tidy T5c: the Projects board gets the same tidy-up. Groups by owner and
// opens Tariq: p2 (running past its end date), p1 (ends in 160 days), p3
// (Completed - folded away).
async function projectRows(tag, phone) {
  await evalJS(`(() => { try { localStorage.removeItem('etaske:projects:showFinished'); } catch {} })()`);
  await evalJS(`location.hash = '/home'`); await sleep(300);
  await evalJS(`location.hash = '/projects'`); await sleep(700);
  const compact = await evalJS(`!!document.querySelector('.board-toolbar--compact .groupby-compact select')`);
  check(`${tag}: the Projects toolbar is the compact one (Group by dropdown)`, compact);
  await evalJS(`(async () => {
    const sel = document.querySelector('.groupby-compact select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'owner'); sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const card = [...document.querySelectorAll('button[data-group-card]')].find(c => /Tariq/.test(c.textContent));
    card.click();
    await new Promise(r => setTimeout(r, 500));
    window.scrollTo(0, 0);
  })()`);
  const order = async () => JSON.parse(await evalJS(`JSON.stringify([...document.querySelectorAll('[data-proj-row]')].filter(window.__vis).map(r => r.getAttribute('data-proj-row')))`));
  const r = JSON.parse(await evalJS(`JSON.stringify((() => {
    const rows = [...document.querySelectorAll('[data-proj-row]')].filter(window.__vis);
    const h = rows.map(x => Math.round(x.getBoundingClientRect().height));
    const cards = rows.map(x => x.closest('.card'));
    const edges = cards.map(c => { const s = getComputedStyle(c); return [s.borderLeftWidth, s.borderRightWidth]; });
    const rowOver = cards.filter(c => c.scrollWidth > c.clientWidth + 1).length;
    const tog = document.querySelector('[data-finished-toggle]');
    const cur = document.querySelector('[data-group-tab][aria-current="true"]');
    const counts = document.querySelector('[data-group-counts]');
    const end = id => { const d = document.querySelector('[data-proj-row="' + id + '"] [data-proj-end]'); return d ? getComputedStyle(d).color : null; };
    const steps = document.querySelector('[data-proj-row="p2"] [data-testid=proj-card-checklist]');
    return { h, edges, rowOver, over: window.__overflow(),
      owner: rows.filter(x => x.querySelector('.task-row-owner')).length,
      client: rows.map(x => (x.querySelector('.task-row-from') || {}).textContent || '').join('|'),
      endLate: end('p2'), endLater: end('p1'), steps: steps && steps.textContent.trim(),
      tog: tog && { mode: tog.getAttribute('data-finished-toggle'), text: tog.textContent.trim() },
      tabs: !!document.querySelector('[data-group-tabs]'), curLate: !!cur && !!cur.querySelector('.group-tab-late'),
      counts: counts && counts.innerText.replace(/\\s+/g, ' ').trim(),
      late: !!(counts && counts.querySelector('.group-head-chip--late')), endedChip: !!(counts && counts.querySelector('.group-head-chip--done')) };
  })())`));
  const why = JSON.stringify(r);
  const maxH = phone ? 110 : 90;
  const first = await order();
  check(`${tag}: late project first, the running one next, the completed one folded away`, first.join('|') === 'p2|p1', JSON.stringify(first));
  check(`${tag}: every project row is short (≤ ${maxH}px)`, r.h.length === 2 && r.h.every(x => x <= maxH), why);
  check(`${tag}: grouped by owner, the rows do not repeat the owner; the client is on the row`, r.owner === 0 && /GPC/.test(r.client) && /AGIBA/.test(r.client), why);
  check(`${tag}: a passed end date on a running project is red; a later one is not`, /239, 68, 68/.test(r.endLate || '') && !/239, 68, 68/.test(r.endLater || ''), why);
  check(`${tag}: the checklist count stays on the row`, !!r.steps && /1\/2/.test(r.steps), why);
  check(`${tag}: a late row gets a 3px edge, no status stripe`, r.edges.every(e => e.every(w => w === '1px' || w === '3px')) && r.edges[0].includes('3px') && !r.edges[1].includes('3px'), why);
  check(`${tag}: no sideways scroll on the page or inside a row`, r.over <= 0 && r.rowOver === 0, why);
  check(`${tag}: group tabs shown, Tariq's tab carries a red late count`, r.tabs && r.curLate, why);
  check(`${tag}: the section header counts open · late · ended`, !!r.counts && r.late && r.endedChip, why);
  check(`${tag}: a "Show 1 finished projects" button sits under the list`, !!r.tog && r.tog.mode === 'show' && /1/.test(r.tog.text), why);

  await shot(`${phone ? (/ar /.test(tag) ? 'ar' : 'en') : 'desktop'}-project-rows`, false);
  await evalJS(`document.querySelector('[data-finished-toggle]').click()`); await sleep(400);
  const shown = await order();
  const saved = await evalJS(`(() => { try { return localStorage.getItem('etaske:projects:showFinished'); } catch { return 'x'; } })()`);
  check(`${tag}: "Show" brings the completed project back, LAST, and is remembered`, shown.join('|') === 'p2|p1|p3' && saved === '1', JSON.stringify({ shown, saved }));
  await evalJS(`document.querySelector('[data-finished-toggle="hide"]').click()`); await sleep(400);
  const hidden = await order();
  check(`${tag}: "Hide finished projects" folds it again`, hidden.join('|') === 'p2|p1'
    && (await evalJS(`localStorage.getItem('etaske:projects:showFinished')`)) === '0', JSON.stringify(hidden));

  // Clicking a row opens the project page.
  const det = JSON.parse(await evalJS(`(async () => {
    document.querySelector('[data-proj-row="p2"] h3').click(); await new Promise(r => setTimeout(r, 600));
    const page = !document.querySelector('[data-proj-row]') && document.body.innerText.includes('Ras Gharib tank farm');
    return JSON.stringify({ page });
  })()`));
  check(`${tag}: clicking a row opens that project's page`, det.page, JSON.stringify(det));

  // Put the board back the way the rest of the run expects it.
  await evalJS(`location.hash = '/home'`); await sleep(300);
  await evalJS(`location.hash = '/projects'`); await sleep(600);
  await evalJS(`(async () => {
    const tab = document.querySelector('[data-group-tab=""]');
    if (tab) { tab.click(); await new Promise(r => setTimeout(r, 300)); }
    const sel = document.querySelector('.groupby-compact select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'status'); sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    try { localStorage.removeItem('etaske:projects:showFinished'); } catch {}
  })()`);
}

// Tidy Tasks T4: the List / Board switch and the Board view. "My Tasks" holds
// the manager's t6 (Pending), t2 + t3 (In Progress, t2 late) and t5 (Done).
// Moves a card by the "Move to" menu AND by a real drag-and-drop, opens a
// card (→ the list with that task open), and puts everything back.
async function boardView(tag, phone) {
  await evalJS(`(() => { try { localStorage.removeItem('etaske:tasks:layout'); } catch {} })()`);
  await evalJS(`location.hash = '/home'`); await sleep(300);
  await evalJS(`location.hash = '/tasks'`); await sleep(700);
  await evalJS(`window.scrollTo(0, 0)`);
  const cols = () => evalJS(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('[data-board-col]')].map(c => [c.getAttribute('data-board-col'), [...c.querySelectorAll('[data-board-card]')].map(k => k.getAttribute('data-board-card'))])))`).then(JSON.parse);

  const sw = JSON.parse(await evalJS(`JSON.stringify((() => {
    const s = document.querySelector('.board-toolbar--compact .task-layout-switch');
    const b = s && [...s.querySelectorAll('button[data-layout]')];
    // Phone: the switch rides on the search row; desktop: the one toolbar row.
    const scope = ${phone} ? document.querySelector('.board-toolbar--compact input[type=text]') : document.querySelector('.board-toolbar-scope');
    const r = s && s.getBoundingClientRect(), rs = scope && scope.getBoundingClientRect();
    return s && { vis: window.__vis(s), keys: b.map(x => x.getAttribute('data-layout')), pressed: b.filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.getAttribute('data-layout')),
      named: b.every(x => (x.textContent.trim() || x.title).length > 0), h: Math.round(Math.min(...b.map(x => x.getBoundingClientRect().height))),
      sameRow: !!rs && Math.abs((r.top + r.height / 2) - (rs.top + rs.height / 2)) <= 8 };
  })())`));
  const w0 = JSON.stringify(sw);
  check(`${tag}: a List / Board switch sits in the toolbar, List by default`, !!sw && sw.vis && sw.keys.join() === 'list,board' && sw.pressed.join() === 'list' && sw.named, w0);
  check(`${tag}: the switch shares the ${phone ? 'search' : 'toolbar'} row and is a ${phone ? 36 : 30} px target`, !!sw && sw.sameRow && sw.h >= (phone ? 36 : 30), w0);

  await evalJS(`document.querySelector('[data-layout="board"]').click()`); await sleep(500);
  const b1 = JSON.parse(await evalJS(`JSON.stringify((() => {
    const board = document.querySelector('[data-task-board]');
    const cols = [...document.querySelectorAll('[data-board-col]')];
    const inProg = document.querySelector('[data-board-col="In Progress"]');
    return { board: !!board && window.__vis(board), cols: cols.map(c => c.getAttribute('data-board-col')),
      group: !!document.querySelector('.groupby-compact select'), rows: document.querySelectorAll('[data-task-row]').length,
      saved: localStorage.getItem('etaske:tasks:layout'),
      counts: cols.map(c => c.querySelector('[data-col-count]').textContent.trim()),
      late: !!inProg.querySelector('.group-head-chip--late'), lateCard: !!document.querySelector('[data-board-card="t2"][data-late="1"]'),
      over: window.__overflow(),
      arTitle: (() => { const e = document.querySelector('[data-board-card="t3"] .task-card-title'); return e && getComputedStyle(e).direction; })() };
  })())`));
  const w1 = JSON.stringify(b1);
  check(`${tag}: Board shows three columns Pending · In Progress · Done, no list rows`, b1.board && b1.cols.join('|') === 'Pending|In Progress|Done' && b1.rows === 0, w1);
  check(`${tag}: Group by is hidden on the board and the choice is saved`, !b1.group && b1.saved === 'board', w1);
  const c1 = await cols();
  check(`${tag}: each task sits in its status column, late first`, JSON.stringify(c1) === JSON.stringify({ Pending: ['t6'], 'In Progress': ['t2', 't3'], Done: ['t5'] }), JSON.stringify(c1));
  check(`${tag}: column counts, a red late chip and a late edge on the late card`, b1.counts.join() === '1,2,1' && b1.late && b1.lateCard, w1);
  check(`${tag}: the Arabic title runs right-to-left`, b1.arTitle === 'rtl', w1);
  check(`${tag}: no sideways page scroll with the board open`, b1.over <= 0, w1);
  if (phone) {
    const strip = JSON.parse(await evalJS(`JSON.stringify((() => { const b = document.querySelector('[data-task-board]'); const c = b.querySelector('[data-board-col]');
      return { scrolls: b.scrollWidth > b.clientWidth, colW: Math.round(c.getBoundingClientRect().width), vw: window.innerWidth }; })())`));
    check(`${tag}: on a phone the columns scroll sideways inside the board, one near-screen-wide column at a time`, strip.scrolls && strip.colW >= strip.vw * 0.7, JSON.stringify(strip));
  }
  await shot(`${phone ? (/^ar /.test(tag) ? 'ar' : 'en') : 'desktop'}-task-board`, false);

  // Move by the menu (keyboard / phone path).
  await evalJS(`(async () => {
    document.querySelector('[data-move-for="t6"]').click(); await new Promise(r => setTimeout(r, 200));
    document.querySelector('[data-move-option="In Progress"]').click(); await new Promise(r => setTimeout(r, 500));
  })()`);
  const c2 = await cols();
  check(`${tag}: "Move to → In Progress" moves the card`, c2['In Progress'].includes('t6') && !c2.Pending.includes('t6'), JSON.stringify(c2));

  // Move by a real drag and drop.
  await evalJS(`(async () => {
    const card = document.querySelector('[data-board-card="t6"]');
    const col = document.querySelector('[data-board-col="Done"]');
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 60));
    col.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 60));
    window.__overSeen = col.classList.contains('is-over');
    col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 500));
  })()`);
  const c3 = await cols();
  check(`${tag}: dragging a card onto Done moves it there (the column lights up while over it)`, c3.Done[0] === 't6' && !c3['In Progress'].includes('t6') && (await evalJS(`window.__overSeen`)), JSON.stringify(c3));
  // Put it back.
  await evalJS(`(async () => {
    document.querySelector('[data-move-for="t6"]').click(); await new Promise(r => setTimeout(r, 200));
    document.querySelector('[data-move-option="Pending"]').click(); await new Promise(r => setTimeout(r, 500));
  })()`);
  const c4 = await cols();
  check(`${tag}: …and back to Pending`, JSON.stringify(c4) === JSON.stringify(c1), JSON.stringify(c4));

  // Opening a card → the list, that task open; the saved choice stays Board.
  await evalJS(`document.querySelector('[data-board-card="t3"] .task-card-open').click()`); await sleep(700);
  const op = JSON.parse(await evalJS(`JSON.stringify({ board: !!document.querySelector('[data-task-board]'),
    open: !!document.querySelector('#task-t3 .task-row-details'), pressed: document.querySelector('[data-layout][aria-pressed="true"]').getAttribute('data-layout'),
    saved: localStorage.getItem('etaske:tasks:layout') })`));
  check(`${tag}: opening a card shows that task open in the list; Board stays the saved choice`, !op.board && op.open && op.pressed === 'list' && op.saved === 'board', JSON.stringify(op));

  await evalJS(`document.querySelector('[data-layout="list"]').click()`); await sleep(300);
  check(`${tag}: List switches back and is saved`, (await evalJS(`localStorage.getItem('etaske:tasks:layout')`)) === 'list'
    && !(await evalJS(`!!document.querySelector('[data-task-board]')`)));
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
        const strip = document.querySelector('.groupby-strip'), sel = document.querySelector('.groupby-select, .groupby-compact select');
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
        const sel = document.querySelector('.groupby-select, .groupby-compact select');
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

    console.log(`
[${lang.toUpperCase()}] Tasks slim rows`);
    await slimRows(`${lang} Tasks rows`, true);
    await shot(`${lang}-task-rows`, false);
    await finishedFold(`${lang} Tasks finished`);
    await toolbarTabs(`${lang} Tasks toolbar`, true);
    await boardView(`${lang} Tasks board`, true);
    await letterRows(`${lang} Letters rows`, true);
    await bidRows(`${lang} Bids rows`, true);
    await projectRows(`${lang} Projects rows`, true);

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
        select: window.__vis(document.querySelector('.groupby-select, .groupby-compact select')),
        actions: getComputedStyle(document.querySelector('.board-toolbar-actions')).display,
      };
    })())`));
    check(`desktop ${label}: header keeps its words${d.desc !== null ? ' and description' : ''}${d.icon !== null ? ' and icon' : ''}`,
      d.label && d.desc !== false && d.icon !== false, JSON.stringify(d));
    if (view === 'tasks' || view === 'correspondences' || view === 'opportunities' || view === 'projects') {
      // T3 / T5a-c: all four boards carry the compact dropdown so the toolbar holds ONE row.
      check(`desktop ${label}: Group by is one dropdown, toolbar row unchanged`, !d.strip && d.select && d.actions === 'contents', JSON.stringify(d));
    } else {
      check(`desktop ${label}: Group by stays the button strip, toolbar row unchanged`, d.strip && !d.select && d.actions === 'contents', JSON.stringify(d));
    }
  }
  await shot('desktop-projects', false);
  await slimRows('desktop Tasks rows', false);
  await shot('desktop-task-rows', false);
  await finishedFold('desktop Tasks finished');
  await toolbarTabs('desktop Tasks toolbar', false);
  await boardView('desktop Tasks board', false);
  await letterRows('desktop Letters rows', false);
  await bidRows('desktop Bids rows', false);
  await projectRows('desktop Projects rows', false);
  await shot('desktop-task-finished', false);

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
