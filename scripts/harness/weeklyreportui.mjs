// Click-through harness for the weekly Arabic department report (queue task D9).
//
// weeklyreport.mjs proves the rules and the Arabic (src/lib/weeklyReport.ts) in
// node. This proves the PAGE in real Edge: the boards read once through the
// real getDocs + getVisibleTasks (a private task stays out), the Arabic text in
// the box, the tiles, moving between weeks (and the URL following), the
// department name in the heading (remembered across a remount), editing and
// "Undo my edits", Copy and Download, Arabic + RTL, and 390 px.
//
// Real code under test:  src/WeeklyReportDashboard.tsx, src/lib/weeklyReport.ts,
//                        src/lib/deadlineCalendar.ts, src/lib/taskVisibility.ts,
//                        src/i18n.ts + src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts.
//
//   node scripts/harness/weeklyreportui.mjs   (--headed to watch it, --shot to write PNGs)

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-weeklyreportui-'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const NOW = new Date();
const THIS_SUN = isoDay(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - NOW.getDay()));
const LAST_SUN = isoDay(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - NOW.getDay() - 7));

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
      contents: args.path === 'stub-firestore' ? FIRESTORE_STUB
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
import WeeklyReportDashboard from './src/WeeklyReportDashboard';
import i18n, { applyLanguageToDocument } from './src/i18n';

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1' },
  { id: 'u-mona', displayName: 'Mona Fathy',   email: 'm@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1' },
  { id: 'u-sami', displayName: 'Sami Adel',    email: 's@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1' },
];

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const sun = -now.getDay();              // this week's Sunday, as an offset from today
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
// A moment on day n at 09:00 — or now, if that is still ahead (this Sunday is never in the future).
const ts = n => { const d = new Date(Math.min(now.getTime(), new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 9).getTime())); return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d, toMillis: () => d.getTime() }; };

// This week
__seed('tasks', 't1', { taskName: 'Prepare AGIBA offer', status: 'Done', isPrivate: false, assignedToId: 'u-mona', assignedTo: 'Mona Fathy', serialNumber: 'TK000101', createdAt: ts(sun - 10), completedAt: ts(sun), updatedAt: ts(sun) });
__seed('tasks', 't2', { taskName: 'Private note to self', status: 'Done', isPrivate: true, assignedToId: 'u-mona', createdAt: ts(sun), completedAt: ts(sun) });
__seed('tasks', 't4', { taskName: 'Update risk register', status: 'In Progress', isPrivate: false, assignedToId: 'u-sami', assignedTo: 'Sami Adel', serialNumber: 'TK000104', createdAt: ts(sun - 20), dueDate: dayOffset(sun - 2) });
__seed('tasks', '--stats--', { count: 104 });
__seed('correspondences', 'l1', { subject: 'Invoice 45', sentFrom: 'AGIBA', dateReceived: dayOffset(sun), status: 'Unread', serialNumber: 'CR000301', createdAt: ts(sun) });
__seed('opportunities', 'o1', { title: 'Tank cleaning 2026', client: 'AGIBA', stage: 'Submitted', submittedDate: dayOffset(sun), serialNumber: 'OP000021', createdAt: ts(sun - 30) });
__seed('projects', 'p1', { name: 'AGIBA Meleiha', client: 'AGIBA', status: 'Active', serialNumber: 'PR000003', createdAt: ts(-200) });
__seed('projectUpdates', 'u1', { projectId: 'p1', text: 'Crews on site', authorName: 'Mona Fathy', createdAt: ts(sun) });
__seed('meetings', 'm1', { title: 'Weekly coordination', date: dayOffset(sun), attendeeIds: ['u-mgr'], agenda: [], actions: [] });
// Last week
__seed('tasks', 't3', { taskName: 'Last week job', status: 'Done', isPrivate: false, assignedToId: 'u-sami', assignedTo: 'Sami Adel', serialNumber: 'TK000103', createdAt: ts(sun - 12), completedAt: ts(sun - 4) });

const me = USERS[0];
const user = { uid: me.id, displayName: me.displayName, email: me.email };
const root = createRoot(document.getElementById('root'));
let n = 0;
window.__mount = view => {
  n++;
  root.render(React.createElement('div', { className: 'app-main' },
    view === 'blank' ? React.createElement('div', null, 'blank')
      : React.createElement(WeeklyReportDashboard, { key: 'w' + n, user, appUser: me, projectUsers: USERS, onNavigate: () => {} })));
};
window.__mount('wr');

window.__type = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'weeklyreportuiEntry.tsx', loader: 'tsx' },
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
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/weekly-report?w=' + THIS_SUN,
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
  const p = path.join(ROOT, `scripts/harness/weeklyreportui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const box = () => evalJS(`${q('[data-wr="text"]')}.value`);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const remount = async () => { await evalJS(`window.__mount('blank')`); await sleep(100); await evalJS(`window.__mount('wr')`); await sleep(300); };
const ready = () => waitFor(`${q('[data-wr="text"]')} && ${q('[data-wr="text"]')}.value.length > 50`, 'the report text');

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] this week, written in Arabic');
await ready();
await shot('1-this-week');
let t = await box();
const [y, m, d] = THIS_SUN.split('-').map(Number);
check('opens on the week in the link (starts this Sunday)', t.split('\n')[1].startsWith(`الأسبوع من الأحد ${d} `), t.split('\n')[1]);
check('heading line without a department', t.split('\n')[0] === 'التقرير الأسبوعي للإدارة', t.split('\n')[0]);
check('the summary is Arabic prose', t.includes('الخلاصة') && t.includes('أنجز الفريق حتى الآن هذا الأسبوع مهمة واحدة'), t.slice(0, 400));
check('the finished task is listed', t.includes('TK000101 Prepare AGIBA offer (Mona Fathy)'));
check('the private task is NOT in the report', !t.includes('Private note to self'));
check('last week’s work is not in this week', !t.includes('Last week job'));
check('the late task is listed with its days', t.includes('TK000104 Update risk register (Sami Adel) — متأخرة'));
check('letters, bids, projects and meetings sections', t.includes(': المراسلات') && t.includes(': العطاءات') && t.includes('AGIBA Meleiha: Crews on site') && t.includes('Weekly coordination'));
check('closing note: automatic, private tasks left out', t.includes('أعدّ ETaske هذا التقرير آليًا') && t.includes('ولا يشمل المهام الخاصة'));
check('tile: 1 task finished', (await text('[data-wr="tile-done"]')).startsWith('1'), await text('[data-wr="tile-done"]'));
check('tile: 1 letter received', (await text('[data-wr="tile-letters"]')).startsWith('1'));
check('tile: 1 offer submitted', (await text('[data-wr="tile-submitted"]')).startsWith('1'));
const lateTile = await text('[data-wr="tile-late"]');
check('tile: late today counts the late task', lateTile.startsWith('1') && lateTile.includes('Late today'), lateTile);
check('"Next week" is off on the current week', await evalJS(`${q('[data-wr="next"]')}.disabled`));
check('no "This week" button while on this week', !(await evalJS(`!!${q('[data-wr="this-week"]')}`)));

console.log('\n[2] moving between weeks');
await clickEl(q('[data-wr="prev"]'), 'Previous week');
await waitFor(`${q('[data-wr="text"]')}.value.includes('Last week job')`, 'last week');
t = await box();
check('last week shows its own finished task', t.includes('TK000103 Last week job (Sami Adel)'));
check('…and not this week’s', !t.includes('Prepare AGIBA offer'));
check('a past week says "خلال الأسبوع", not "so far"', t.includes('أنجز الفريق خلال الأسبوع مهمة واحدة'), t.slice(0, 300));
check('the URL follows the week', (await evalJS('window.location.hash')) === '#/weekly-report?w=' + LAST_SUN, await evalJS('window.location.hash'));
check('tile says "at week end" for a past week', (await text('[data-wr="tile-late"]')).includes('Late at week end'));
check('"This week" button appears', await evalJS(`!!${q('[data-wr="this-week"]')}`));
await clickEl(q('[data-wr="this-week"]'), 'This week');
await waitFor(`${q('[data-wr="text"]')}.value.includes('Prepare AGIBA offer')`, 'back to this week');
check('back on this week', (await evalJS('window.location.hash')) === '#/weekly-report?w=' + THIS_SUN);

console.log('\n[3] the department name in the heading');
await evalJS(`window.__type(${q('[data-wr="dept"]')}, 'إدارة تطوير الأعمال')`);
await sleep(150);
check('heading carries the department', (await box()).split('\n')[0] === 'التقرير الأسبوعي — إدارة تطوير الأعمال', (await box()).split('\n')[0]);
await remount();
await ready();
check('remembered after the page is opened again', (await box()).split('\n')[0] === 'التقرير الأسبوعي — إدارة تطوير الأعمال');

console.log('\n[4] editing, and undoing the edits');
check('no Undo before editing', !(await evalJS(`!!${q('[data-wr="reset"]')}`)));
const original = await box();
await evalJS(`window.__type(${q('[data-wr="text"]')}, ${q('[data-wr="text"]')}.value + ' — ملاحظة المدير: أحسنتم.')`);
await sleep(150);
check('the edit stays in the box', (await box()).endsWith('ملاحظة المدير: أحسنتم.'));
check('Undo appears', await evalJS(`!!${q('[data-wr="reset"]')}`));
await clickEl(q('[data-wr="reset"]'), 'Undo my edits');
check('Undo gives back the text from the records', (await box()) === original);

console.log('\n[5] copy and download');
await clickEl(q('[data-wr="copy"]'), 'Copy');
await waitFor(q('[data-wr="message"]'), 'copy message');
const cm = await text('[data-wr="message"]');
check('Copy says what happened (copied, or selected for Ctrl+C)', cm.includes('Copied') || cm.includes('Ctrl+C'), cm);
await clickEl(q('[data-wr="download"]'), 'Download');
await sleep(200);
check('Download confirms', (await text('[data-wr="message"]')).includes('Saved as a text file'));
check('nothing was written to the database', await evalJS(`!window.__writes || window.__writes.length === 0`));

console.log('\n[6] Arabic + RTL');
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await shot('2-ar');
check('page is right-to-left', (await evalJS('document.documentElement.dir')) === 'rtl');
check('title in Arabic', (await text('h1')).includes('التقرير الأسبوعي'));
check('tiles in Arabic', (await text('[data-wr="tile-done"]')).includes('مهام منجزة'));
check('the report box is RTL', (await evalJS(`${q('[data-wr="text"]')}.dir`)) === 'rtl');
check('the report text does not change with the screen language', (await box()) === original);

console.log('\n[7] 390 px');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(300);
await shot('3-ar-mobile');
check('no sideways scroll at 390 px (Arabic)', (await overflow()) <= 1, String(await overflow()));
await evalJS(`window.__setLang('en')`);
await sleep(300);
await shot('4-en-mobile');
check('no sideways scroll at 390 px (English)', (await overflow()) <= 1, String(await overflow()));

check('no uncaught page errors or console.errors during the whole run', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 800)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/weeklyreportui-failure.png');
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

