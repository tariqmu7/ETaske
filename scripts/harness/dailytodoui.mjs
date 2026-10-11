// Click-through harness for the daily to-do sheet (second tab of the Weekly report page).
//
// Proves in real Edge: the tab opens from the link, the right records are on
// the list (late / today / soon / urgent / unread letter / bid sign-off, and
// NOT the private, finished, closed or far-off ones), late first, editing,
// removing and adding rows, edits kept for the day across a remount, "Start
// again", the print sheet (print media: only the sheet shows), Excel, Arabic, 390 px.
//
//   node scripts/harness/dailytodoui.mjs   (--headed to watch it, --shot to write PNGs + a PDF)

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-dailytodoui-'));

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

const today = dayOffset(0);
__seed('tasks', 'late',   { taskName: 'Update risk register', status: 'In Progress', isPrivate: false, priority: 'Medium', assignedToId: 'u-sami', assignedTo: 'Sami Adel', serialNumber: 'TK000104', createdAt: ts(-20), dueDate: dayOffset(-4) });
__seed('tasks', 'today',  { taskName: 'Send HSE plan', status: 'Pending', isPrivate: false, priority: 'High', assignedToId: 'u-mona', assignedTo: 'Mona Fathy', serialNumber: 'TK000105', createdAt: ts(-3), dueDate: today, notes: [{ id: 'n1', text: 'Get the signed copy from the site', isCompleted: false }] });
__seed('tasks', 'soon',   { taskName: 'Book the inspection', status: 'Pending', isPrivate: false, priority: 'Low', assignedToId: 'u-mona', assignedTo: 'Mona Fathy', serialNumber: 'TK000106', createdAt: ts(-3), dueDate: dayOffset(2) });
__seed('tasks', 'far',    { taskName: 'Far away job', status: 'Pending', isPrivate: false, priority: 'Low', assignedToId: 'u-mona', serialNumber: 'TK000107', createdAt: ts(-3), dueDate: dayOffset(30) });
__seed('tasks', 'urgent', { taskName: 'Urgent no date', status: 'Pending', isPrivate: false, priority: 'Urgent', assignedToId: 'u-sami', assignedTo: 'Sami Adel', serialNumber: 'TK000108', createdAt: ts(-1) });
__seed('tasks', 'done',   { taskName: 'Finished job', status: 'Done', isPrivate: false, assignedToId: 'u-sami', serialNumber: 'TK000109', createdAt: ts(-9), dueDate: dayOffset(-2), completedAt: ts(-1) });
__seed('tasks', 'priv',   { taskName: 'Private note to self', status: 'Pending', isPrivate: true, assignedToId: 'u-mgr', serialNumber: 'TK000110', createdAt: ts(-1), dueDate: today });
__seed('tasks', '--stats--', { count: 110 });
__seed('correspondences', 'l1', { subject: 'Invoice 45', sentFrom: 'AGIBA', dateReceived: dayOffset(-1), status: 'Unread', serialNumber: 'CR000301', createdAt: ts(-1) });
__seed('correspondences', 'l2', { subject: 'Request for site access', sentFrom: 'Khalda', dateReceived: dayOffset(-5), status: 'Assigned', assignedTo: 'Mona Fathy', deadline: dayOffset(-1), actions: 'Reply with the crew list', serialNumber: 'CR000302', createdAt: ts(-5) });
__seed('correspondences', 'l3', { subject: 'Closed letter', status: 'Closed', deadline: dayOffset(-1), serialNumber: 'CR000303', createdAt: ts(-5) });
__seed('opportunities', 'o1', { title: 'Tank cleaning 2026', client: 'AGIBA', stage: 'Bid Preparation', ownerName: 'Tariq Salama', submissionDeadline: dayOffset(1), serialNumber: 'OP000021', createdAt: ts(-30), visibility: 'all', approval: { status: 'requested', amount: 100, currency: 'USD', requestedById: 'u-mona', requestedByName: 'Mona Fathy', requestedAt: 1, log: [] } });
__seed('opportunities', 'o2', { title: 'Pipeline survey', client: 'Khalda', stage: 'Submitted', ownerName: 'Mona Fathy', nextActionDate: today, nextStep: 'Call the client about the technical clarification', serialNumber: 'OP000022', createdAt: ts(-30), visibility: 'all' });
__seed('opportunities', 'o3', { title: 'Lost one', stage: 'Lost', submissionDeadline: dayOffset(-1), serialNumber: 'OP000023', createdAt: ts(-30), visibility: 'all' });

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
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'dailytodouiEntry.tsx', loader: 'tsx' },
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
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/weekly-report?tab=daily',
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
  const p = path.join(ROOT, `scripts/harness/dailytodoui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const remount = async () => { await evalJS(`window.__mount('blank')`); await sleep(100); await evalJS(`window.__mount('wr')`); await sleep(300); };
const rowTexts = () => evalJS(`[...document.querySelectorAll('[data-dt="row"]')].map(r => r.querySelector('[data-dt="title"]').value + ' | ' + r.querySelector('[data-dt="action"]').value + ' | ' + window.__txt(r))`);
const ready = () => waitFor(`document.querySelectorAll('[data-dt="row"]').length > 0`, 'the to-do rows');

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] the daily tab opens from the link and lists the right things');
await ready();
await shot('1-list');
check('the daily tab is selected', await evalJS(`${q('[data-wr="tab-daily"]')}.getAttribute('aria-selected') === 'true'`));
check('heading says Daily to-do list', (await text('h1')).includes('Daily to-do list'));
let rows = await rowTexts();
const has = s => rows.some(r => r.includes(s));
check('late task is on the list', has('Update risk register'));
check('task due today is on, with its open note as the action', rows.some(r => r.includes('Send HSE plan | Get the signed copy from the site')), rows.join(' // '));
check('task due in 2 days is on (3-day window)', has('Book the inspection'));
check('urgent task with no date is on', has('Urgent no date'));
check('task 30 days away is NOT on', !has('Far away job'));
check('finished task is NOT on', !has('Finished job'));
check('private task is NOT on', !has('Private note to self'));
check('unread letter is on, for the manager to route', rows.some(r => r.includes('Invoice 45 | مراجعة الخطاب وتوجيهه للمسؤول') && r.includes('للمديرة')), rows.join(' // '));
check('overdue letter is on with its own requested action', rows.some(r => r.includes('Request for site access | Reply with the crew list')));
check('closed letter is NOT on', !has('Closed letter'));
check('bid waiting for price sign-off is on', rows.some(r => r.includes('Tank cleaning 2026 | اعتماد سعر العرض قبل إرساله')), rows.join(' // '));
check('bid next step due today is on, with the step as the action', rows.some(r => r.includes('Pipeline survey | Call the client')));
check('closed bid is NOT on', !has('Lost one'));
check('late rows come first', rows[0].includes('Update risk register'), rows[0]);
check('8 rows in all', rows.length === 8, String(rows.length));
check('tile: 8 items', (await text('[data-dt="tile-total"]')).startsWith('8'), await text('[data-dt="tile-total"]'));
check('tile: 2 late (task + letter)', (await text('[data-dt="tile-late"]')).startsWith('2'), await text('[data-dt="tile-late"]'));
check('tile: 2 need the manager', (await text('[data-dt="tile-manager"]')).startsWith('2'));

console.log('\n[2] "Due today and late" narrows the list');
await evalJS(`(() => { const s = ${q('[data-dt="ahead"]')}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '0'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await sleep(200);
rows = await rowTexts();
check('the task due in 2 days drops off', !rows.some(r => r.includes('Book the inspection')), rows.join(' // '));
check('the bid closing tomorrow stays (it waits for sign-off)', rows.some(r => r.includes('Tank cleaning 2026')));

console.log('\n[3] edit, remove and add rows');
await evalJS(`window.__type(document.querySelectorAll('[data-dt="row"]')[0].querySelector('[data-dt="action"]'), 'Finish it before noon')`);
await sleep(80);
await evalJS(`window.__type(document.querySelectorAll('[data-dt="row"]')[0].querySelector('[data-dt="note"]'), 'Call Sami')`);
await sleep(100);
const before = (await rowTexts()).length;
await clickEl(`[...document.querySelectorAll('[data-dt="row"]')].find(r => r.querySelector('[data-dt="title"]').value === 'Urgent no date').querySelector('[data-dt="remove"]')`, 'remove a row');
check('a row was removed', (await rowTexts()).length === before - 1);
await clickEl(q('[data-dt="add"]'), 'Add a row');
await evalJS(`(() => { const r = [...document.querySelectorAll('[data-dt="row"]')].pop(); window.__type(r.querySelector('[data-dt="title"]'), 'زيارة موقع العميل'); })()`);
await sleep(80);
await evalJS(`(() => { const r = [...document.querySelectorAll('[data-dt="row"]')].pop(); window.__type(r.querySelector('[data-dt="action"]'), 'تأكيد الموعد مع العميل'); })()`);
await sleep(80);
await evalJS(`window.__type(${q('[data-dt="extra"]')}, 'اجتماع الإدارة الساعة 11')`);
await sleep(150);
rows = await rowTexts();
check('the added row is there', rows.some(r => r.includes('زيارة موقع العميل | تأكيد الموعد مع العميل')), rows.join(' // '));
check('the edit stayed', rows[0].includes('Finish it before noon'), rows[0]);
check('"Start again" appears', await evalJS(`!!${q('[data-dt="reset"]')}`));
await remount();
await ready();
rows = await rowTexts();
check('edits are kept for the day after opening the page again', rows[0].includes('Finish it before noon') && rows.some(r => r.includes('زيارة موقع العميل')));

console.log('\n[4] the printed sheet');
await send('Emulation.setEmulatedMedia', { media: 'print' });
await sleep(200);
check('in print only the sheet shows (the app is hidden)', await evalJS(`!window.__vis(${q('[data-dt="page"]')}) && window.__vis(${q('[data-dt="print-sheet"]')})`));
const sheet = await text('[data-dt="print-sheet"]');
check('sheet has the Arabic title and the columns', sheet.includes('قائمة المتابعة اليومية') && sheet.includes('الإجراء المطلوب') && sheet.includes('لم يتم') && sheet.includes('ملاحظات المدير'), sheet.slice(0, 200));
check('sheet carries the edits, the added row and the extra notes', sheet.includes('Finish it before noon') && sheet.includes('Call Sami') && sheet.includes('زيارة موقع العميل') && sheet.includes('اجتماع الإدارة الساعة 11'));
check('sheet does not carry the removed row', !sheet.includes('Urgent no date'));
check('sheet has a sign-off line', sheet.includes('اطّلعت عليه المديرة'));
await shot('2-print');
if (SHOT) {
  const pdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
  const p = path.join(ROOT, 'scripts/harness/dailytodoui-print.pdf');
  fs.writeFileSync(p, Buffer.from(pdf.data, 'base64'));
  console.log(`       pdf  -> ${p}`);
}
await send('Emulation.setEmulatedMedia', { media: '' });
await sleep(150);
check('on screen the print sheet is hidden', !(await evalJS(`window.__vis(${q('[data-dt="print-sheet"]')})`)));

console.log('\n[5] Excel download and Start again');
await clickEl(q('[data-dt="excel"]'), 'Download Excel');
await waitFor(q('[data-dt="message"]'), 'excel message', 8000);
check('Excel download confirms', (await text('[data-dt="message"]')).includes('Excel'), await text('[data-dt="message"]'));
await clickEl(q('[data-dt="reset"]'), 'Start again');
await sleep(200);
rows = await rowTexts();
check('Start again drops the edits', !rows.some(r => r.includes('زيارة موقع العميل')) && !rows[0].includes('Finish it before noon'));
check('nothing was written to the database', await evalJS(`!window.__writes || window.__writes.length === 0`));

console.log('\n[6] Arabic + 390 px, and back to the weekly tab');
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await shot('3-ar');
check('tab label in Arabic', (await text('[data-wr="tab-daily"]')).includes('قائمة المتابعة اليومية'));
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(300);
await shot('4-ar-mobile');
check('no sideways page scroll at 390 px', (await overflow()) <= 1, String(await overflow()));
await clickEl(q('[data-wr="tab-weekly"]'), 'weekly tab');
await waitFor(`${q('[data-wr="text"]')} && ${q('[data-wr="text"]')}.value.length > 50`, 'weekly text');
check('the weekly report still works', (await evalJS(`${q('[data-wr="text"]')}.value`)).startsWith('التقرير الأسبوعي'));

check('no uncaught page errors or console.errors during the whole run', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 800)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/dailytodoui-failure.png');
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

