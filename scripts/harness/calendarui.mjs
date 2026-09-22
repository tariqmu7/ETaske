// Click-through harness for the deadline calendar (queue task D3).
//
// deadlinecalendar.mjs proves the logic (src/lib/deadlineCalendar.ts) in node.
// This proves the SCREEN: the real CalendarDashboard reading six collections
// through the real onSnapshot + subscribeVisibleTasks, the "Contracts running
// out" box, the month grid with its chips and "+N more", the day panel, month
// navigation and its #/calendar?m= link, the filters, rows opening their
// records, Arabic + RTL, and the day-by-day list at 390 px. Nothing is written.
//
// Real code under test:  src/CalendarDashboard.tsx, src/lib/deadlineCalendar.ts,
//                        src/lib/taskVisibility.ts, src/lib/deepLink.ts,
//                        src/lib/format.ts, src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts.
//
//   node scripts/harness/calendarui.mjs   (--headed to watch it, --shot to write PNGs)

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-calendarui-'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

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
import CalendarDashboard from './src/CalendarDashboard';
import { consumePending } from './src/lib/deepLink';
import i18n, { applyLanguageToDocument } from './src/i18n';

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Business Development' },
  { id: 'u-mona', displayName: 'Mona Fathy', email: 'm@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
];

// Every date is relative to the real today, so the fixtures never rot.
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const nextMonthDay = iso(new Date(now.getFullYear(), now.getMonth() + 1, 5));
const ts = n => { const d = new Date(now.getTime() + n * 86400000); return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d, toMillis: () => d.getTime() }; };
window.__dates = { today: dayOffset(0), nextMonthDay, c1Day: dayOffset(20) };

__seed('projects', 'p1', { name: 'Zohr tie-in', client: 'Petrobel', status: 'Active', serialNumber: 'PR000001', userId: 'u-mgr', createdAt: ts(-100) });
__seed('projects', 'p2', { name: 'Old job', client: 'AGIBA', status: 'Completed', endDate: dayOffset(0), userId: 'u-mgr', createdAt: ts(-300) });
// ── On the watch ──
__seed('projectContracts', 'c1', { projectId: 'p1', parentId: null, type: 'contract', contractNumber: '4600001234', subject: 'O&M services', endDate: dayOffset(20), inCharge: 'Ahmed', userId: 'u-mgr' });
__seed('projectContracts', 'c2', { projectId: 'p1', parentId: null, type: 'work_authorization', contractNumber: 'WA-7', subject: 'Shutdown support', endDate: dayOffset(-10), userId: 'u-mgr' });
__seed('projectSubcontracts', 's1', { projectId: 'p1', name: 'Al Nasr Scaffolding', typeOfService: 'Scaffolding', soOrContract: 'SO-55', expiryDate: dayOffset(7), userId: 'u-mgr' });
// ── Renewed: on the calendar, not on the watch ──
__seed('projectContracts', 'c3', { projectId: 'p1', parentId: null, type: 'contract', contractNumber: '4600003000', subject: 'Manpower supply', endDate: dayOffset(-15), userId: 'u-mgr' });
__seed('projectContracts', 'c3a', { projectId: 'p1', parentId: 'c3', type: 'amendment', subject: 'Manpower extension', endDate: dayOffset(200), userId: 'u-mgr' });
// ── Nowhere ──
__seed('projectContracts', 'c5', { projectId: 'p1', parentId: null, type: 'contract', subject: 'Closed one', status: 'Closed', endDate: dayOffset(0), userId: 'u-mgr' });
__seed('projectContracts', 'c6', { projectId: 'p2', parentId: null, type: 'contract', subject: 'Under a finished job', endDate: dayOffset(0), userId: 'u-mgr' });
// ── Four dates TODAY, so the cell shows three and "+1 more" ──
__seed('tasks', 't1', { taskName: 'Prepare price schedule', status: 'In Progress', isPrivate: false, assignedToId: 'u-mgr', assignedTo: 'Tariq Salama', assignedById: 'u-mgr',
  dueDate: dayOffset(0), userId: 'u-mgr', teamId: 'T1', serialNumber: 'TK000201', createdAt: ts(-8) });
__seed('tasks', 't2', { taskName: 'Collect subcontractor quotes', status: 'Pending', isPrivate: false, assignedToId: 'u-mona', assignedTo: 'Mona Fathy', assignedById: 'u-mgr',
  dueDate: dayOffset(0), userId: 'u-mgr', teamId: 'T1', serialNumber: 'TK000202', createdAt: ts(-2) });
__seed('opportunities', 'o1', { title: 'Meleiha compressor overhaul', client: 'AGIBA', stage: 'Bid Preparation', serialNumber: 'OP000011',
  submissionDeadline: dayOffset(0), ownerId: 'u-mona', ownerName: 'Mona Fathy', userId: 'u-mgr', createdAt: ts(-5) });
__seed('correspondences', 'l1', { subject: 'AGIBA asks for revised prices', sentFrom: 'AGIBA', status: 'Unread', deadline: dayOffset(0),
  userId: 'u-mgr', teamId: 'T1', serialNumber: 'CR000101', createdAt: ts(-3) });
// ── Elsewhere ──
__seed('opportunities', 'o2', { title: 'Gas plant revamp', client: 'Petrobel', stage: 'Submitted', serialNumber: 'OP000012', submittedDate: dayOffset(-20),
  decisionDate: nextMonthDay, ownerId: 'u-mgr', ownerName: 'Tariq Salama', userId: 'u-mgr', createdAt: ts(-60) });
__seed('opportunities', 'o3', { title: 'Won long ago', client: 'AGIBA', stage: 'Won', submissionDeadline: dayOffset(0), userId: 'u-mgr', createdAt: ts(-200) });
__seed('tasks', 't9', { taskName: 'Done already', status: 'Done', isPrivate: false, assignedToId: 'u-mgr', dueDate: dayOffset(0), userId: 'u-mgr', teamId: 'T1', createdAt: ts(-40) });
// Somebody else's PRIVATE task: never shown.
__seed('tasks', 't3', { taskName: 'Private note of Mona', status: 'Pending', isPrivate: true, assignedToId: 'u-mona', dueDate: dayOffset(0), userId: 'u-mona', teamId: 'T1', createdAt: ts(-30) });

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@eprom.com.eg' };
window.__nav = [];
window.__open = t => consumePending(t);

const root = createRoot(document.getElementById('root'));
root.render(
  React.createElement('div', { className: 'app-main' },
    React.createElement(CalendarDashboard, { user, appUser: USERS[0], onNavigate: v => { window.__nav.push(v); } }),
  ),
);

window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'calendaruiEntry.tsx', loader: 'tsx' },
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

const PORT = 9711 + (process.pid % 100);
const edge = spawn(EDGE, [
  HEADED ? '--new-window' : '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(WORK, 'profile')}`,
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000',
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/calendar',
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
  const p = path.join(ROOT, `scripts/harness/calendarui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const texts = sel => evalJS(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(sel)})].map(window.__txt))`).then(JSON.parse);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const cell = d => `document.querySelector('[data-cal="day"][data-date="${d}"]')`;
const chipsIn = d => evalJS(`JSON.stringify([...${cell(d)}.querySelectorAll('[data-cal="chip"]')].map(c => c.dataset.key))`).then(JSON.parse);
const allChips = () => evalJS(`JSON.stringify([...document.querySelectorAll('[data-cal="chip"]')].map(c => c.dataset.key))`).then(JSON.parse);
const rowKeys = sel => evalJS(`JSON.stringify([...document.querySelectorAll('${sel} [data-cal="row"]')].map(r => r.dataset.key))`).then(JSON.parse);

// ═══════════════════════════════════════════════════════════════════════════
try {

const { today, nextMonthDay, c1Day } = await evalJS(`window.__dates`);
const monthOf = d => d.slice(0, 7);

console.log('\n[1] the "Contracts running out" box');
await waitFor(q('[data-cal="watch"]'), 'the watch box');
const ended = await rowKeys('[data-cal="watch-ended"]');
const ending = await rowKeys('[data-cal="watch-ending"]');
check('ended, not renewed: the work authorisation only', JSON.stringify(ended) === JSON.stringify(['contract:c2']), JSON.stringify(ended));
check('ending within 60 days: the sub-contract (7) then the contract (20)', JSON.stringify(ending) === JSON.stringify(['sub:s1', 'contract:c1']), JSON.stringify(ending));
const c2 = await evalJS(`window.__txt(document.querySelector('[data-cal="watch"] [data-key="contract:c2"]'))`);
check('the ended one reads "10 days ago" with its number and project', c2.includes('10 days ago') && c2.includes('WA-7') && c2.includes('Zohr tie-in'), c2);
check('…and is painted late', (await evalJS(`document.querySelector('[data-cal="watch"] [data-key="contract:c2"]').dataset.state`)) === 'late');
const c1 = await evalJS(`window.__txt(document.querySelector('[data-cal="watch"] [data-key="contract:c1"]'))`);
check('the contract row: 11+ wording "20 days to go", in charge Ahmed', c1.includes('20 days to go') && c1.includes('Ahmed'), c1);
check('the box counts', (await text('[data-cal="watch-ended"] h3')).endsWith('1') && (await text('[data-cal="watch-ending"] h3')).endsWith('2'));
check('the renewed contract, the closed one and the finished project’s are not in the box',
  !(await evalJS(`['contract:c3', 'contract:c3a', 'contract:c5', 'contract:c6'].some(k => document.querySelector('[data-cal="watch"] [data-key="' + k + '"]'))`)));
await shot('1-month');

console.log('\n[2] the month grid');
const title = await text('[data-cal="month"]');
check('the month title is this month', title.length > 4 && /\d{4}/.test(title), title);
check('today’s cell exists', await evalJS(`!!${cell(today)}`));
const todayChips = await chipsIn(today);
check('today: three chips, tender first, then the letter, then a task', todayChips.length === 3 && todayChips[0] === 'bid:o1:deadline' && todayChips[1] === 'letter:l1' && todayChips[2].startsWith('task:'), JSON.stringify(todayChips));
check('…and "+1 more"', (await evalJS(`window.__txt(${cell(today)}.querySelector('[data-cal="more"]'))`)) === '+1 more');
check('today’s cell says 4 dates', (await evalJS(`${cell(today)}.dataset.count`)) === '4');
const chips = await allChips();
check('the closed contract, the finished project’s contract, the won bid, the done and private tasks are nowhere',
  !['contract:c5', 'contract:c6', 'bid:o3:deadline', 'task:t9', 'task:t3'].some(k => chips.includes(k)), JSON.stringify(chips));
check('the private task’s title is not on the page', !(await evalJS(`document.body.textContent.includes('Private note of Mona')`)));
const summary = await text('[data-cal="summary"]');
check('the summary counts the month', summary.includes('this month') && summary.includes('Tender deadlines: 1'), summary);

console.log('\n[3] the day panel');
check('today is selected at first, with all four', (await rowKeys('[data-cal="day-panel"]')).length === 4);
const sameMonth = monthOf(c1Day) === monthOf(today);
if (!sameMonth) await clickEl(q('[data-cal="next"]'), 'next month (for the contract day)');
await waitFor(`${cell(c1Day)}`, 'the grid holding the contract day');
await clickEl(`${cell(c1Day)}.querySelector('[data-cal="daynum"]')`, 'the day the contract ends');
const panel = await rowKeys('[data-cal="day-panel"]');
check('clicking a day lists its dates: the contract end', JSON.stringify(panel) === JSON.stringify(['contract:c1']), JSON.stringify(panel));
check('…and marks the day as pressed', (await evalJS(`${cell(c1Day)}.querySelector('[data-cal="daynum"]').getAttribute('aria-pressed')`)) === 'true');
if (!sameMonth) await clickEl(q('[data-cal="today"]'), 'Today');
const emptyDay = await evalJS(`(() => { const c = [...document.querySelectorAll('[data-cal="day"]')].find(x => x.dataset.count === '0'); return c ? c.dataset.date : null; })()`);
await clickEl(`${cell(emptyDay)}.querySelector('[data-cal="daynum"]')`, 'an empty day');
check('an empty day says nothing falls due', (await text('[data-cal="day-panel"]')).includes('Nothing falls due on this day.'));

console.log('\n[4] month navigation');
await clickEl(q('[data-cal="next"]'), 'next month');
await waitFor(`location.hash.includes('m=${monthOf(nextMonthDay)}')`, 'the link carries the month');
check('the link carries the month', (await evalJS('location.hash')) === `#/calendar?m=${monthOf(nextMonthDay)}`, await evalJS('location.hash'));
check('the title changed', (await text('[data-cal="month"]')) !== title);
check('next month shows the bid decision', (await chipsIn(nextMonthDay)).includes('bid:o2:decision'));
await clickEl(q('[data-cal="prev"]'), 'previous month');
check('Previous comes back', (await text('[data-cal="month"]')) === title);
await clickEl(q('[data-cal="next"]'), 'next month');
await clickEl(q('[data-cal="today"]'), 'Today');
check('Today comes back and selects today', (await text('[data-cal="month"]')) === title && (await rowKeys('[data-cal="day-panel"]')).length === 4);

console.log('\n[5] filters');
await clickEl(q('[data-cal="group-contract"]'), 'Contracts');
let ch = await allChips();
check('Contracts: only contract chips', ch.length > 0 && ch.every(k => k.startsWith('contract:') || k.startsWith('sub:')), JSON.stringify(ch));
check('…today’s cell is empty now', (await chipsIn(today)).length === 0);
check('…the watch box is still there', await evalJS(`!!${q('[data-cal="watch"]')}`));
await clickEl(q('[data-cal="group-all"]'), 'All');
await clickEl(q('[data-cal="scope-mine"]'), 'Mine');
ch = await chipsIn(today);
check('Mine: my task and the letter I logged stay; Mona’s task and bid go', ch.includes('task:t1') && ch.includes('letter:l1') && !ch.includes('task:t2') && !ch.includes('bid:o1:deadline'), JSON.stringify(ch));
await clickEl(q('[data-cal="group-contract"]'), 'Contracts (Mine)');
check('Mine: contracts still show', (await allChips()).length > 0);
await clickEl(q('[data-cal="group-all"]'), 'All');
await clickEl(q('[data-cal="scope-all"]'), 'Everyone');

console.log('\n[6] rows open their records');
await clickEl(`${cell(today)}.querySelector('[data-cal="chip"][data-key="bid:o1:deadline"]')`, 'the tender chip');
check('tender chip → Opportunities', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'opportunities');
check('…with the bid queued to open', (await evalJS(`window.__open('opportunity')`)) === 'o1');
await clickEl(`document.querySelector('[data-cal="watch"] [data-key="contract:c2"] button')`, 'the ended contract');
check('contract row → Projects', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'projects');
check('…with its project queued to open', (await evalJS(`window.__open('project')`)) === 'p1');
await clickEl(`${cell(today)}.querySelector('[data-cal="chip"][data-key="letter:l1"]')`, 'the letter chip');
check('letter chip → Correspondences with the letter', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'correspondences' && (await evalJS(`window.__open('corresponding')`)) === 'l1');
check('clicking a chip does not move the day selection', (await rowKeys('[data-cal="day-panel"]')).length === 4);

console.log('\n[7] Arabic + RTL, and 390 px');
await evalJS(`window.__setLang('ar')`);
await sleep(700);
const arBody = await evalJS(`document.body.textContent`);
check('page is RTL', (await evalJS(`document.documentElement.dir`)) === 'rtl');
check('Arabic headings', arBody.includes('التقويم') && arBody.includes('عقود يوشك أجلها أن ينقضي') && arBody.includes('انقضى أجلها دون تجديد أو إغلاق'));
check('Arabic countdowns with agreement ("منذ 10 أيام", "بعد 20 يومًا", "بعد 7 أيام")', arBody.includes('منذ 10 أيام') && arBody.includes('بعد 20 يومًا') && arBody.includes('بعد 7 أيام'));
check('no Arabic-Indic digits', !/[٠-٩]/.test(arBody));
check('no English headings left', !arBody.includes('Contracts running out') && !arBody.includes('Nothing falls due'));
check('no «تم» / «بواسطة» in the page', !/(^|\s)(تم|يتم|بواسطة)(\s|$)/.test(arBody));
check('no Latin comma inside Arabic text', !/[؀-ۿ],/.test(arBody));
await shot('2-ar');
check('no horizontal overflow at 1440 (RTL)', (await overflow()) <= 0);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(500);
check('390px: the grid is hidden', !(await evalJS(`window.__vis(${q('[data-cal="grid"]')})`)));
check('390px: the day-by-day list shows', await evalJS(`window.__vis(${q('[data-cal="agenda"]')})`));
const agendaToday = await evalJS(`JSON.stringify([...document.querySelectorAll('[data-cal="agenda-day"][data-date="${today}"] [data-cal="row"]')].map(r => r.dataset.key))`).then(JSON.parse);
check('390px: today’s four dates are listed', agendaToday.length === 4, JSON.stringify(agendaToday));
check('no horizontal overflow at 390px (RTL)', (await overflow()) <= 0, String(await overflow()));
await shot('3-ar-mobile');
await evalJS(`window.__setLang('en')`);
await sleep(400);
check('no horizontal overflow at 390px (LTR)', (await overflow()) <= 0);
await shot('4-en-mobile');
await send('Emulation.clearDeviceMetricsOverride');

check('nothing was written in the whole run', (await evalJS(`window.__writes.length`)) === 0);
check('no uncaught page errors or console.errors during the whole run', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 600)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/calendarui-failure.png');
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
