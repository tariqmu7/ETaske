// Click-through harness for the Waiting board (queue task D2).
//
// waitingboard.mjs proves the logic (src/lib/waitingBoard.ts) in node. This
// proves the SCREEN: the real WaitingDashboard reading the boards through the
// real onSnapshot + subscribeVisibleTasks, both columns with their ages, the
// Outlook chains from the helper, the filters, marking a task "waiting on them"
// and back (the only write), the follow-up letter, rows opening their records,
// Arabic + RTL and 390 px.
//
// Real code under test:  src/WaitingDashboard.tsx, src/lib/waitingBoard.ts,
//                        src/lib/mailThreads.ts, src/lib/outlookBridge.ts,
//                        src/lib/taskVisibility.ts, src/lib/deepLink.ts,
//                        src/components/FollowUpLetterModal.tsx, src/i18n.ts
//                        + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts, window.fetch (the Outlook helper).
//
//   node scripts/harness/waitingui.mjs   (--headed to watch it, --shot to write PNGs)

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-waitingui-'));

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
import WaitingDashboard from './src/WaitingDashboard';
import { consumePending } from './src/lib/deepLink';
import i18n, { applyLanguageToDocument } from './src/i18n';

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Business Development' },
  { id: 'u-ahmed', displayName: 'Ahmed Samir', email: 'a@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
  { id: 'u-mona', displayName: 'Mona Fathy', email: 'm@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
];

// Every date is relative to the real today, so the fixtures never rot.
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const ts = n => { const d = new Date(now.getTime() + n * 86400000); return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d, toMillis: () => d.getTime() }; };

// ── On us ──
__seed('correspondences', 'l1', { subject: 'AGIBA asks for revised prices', sentFrom: 'AGIBA', status: 'Unread', dateReceived: dayOffset(-12), deadline: dayOffset(-2),
  userId: 'u-mgr', teamId: 'T1', serialNumber: 'CR000101', createdAt: ts(-12) });
__seed('tasks', 't1', { taskName: 'Prepare price schedule', status: 'In Progress', isPrivate: false, assignedToId: 'u-mgr', assignedTo: 'Tariq Salama', assignedById: 'u-mgr',
  dueDate: dayOffset(3), userId: 'u-mgr', teamId: 'T1', serialNumber: 'TK000201', createdAt: ts(-8) });
__seed('tasks', 't2', { taskName: 'Collect subcontractor quotes', status: 'Pending', isPrivate: false, assignedToId: 'u-mona', assignedTo: 'Mona Fathy', assignedById: 'u-mgr',
  userId: 'u-mgr', teamId: 'T1', serialNumber: 'TK000202', createdAt: ts(-2) });
__seed('tasks', 't9', { taskName: 'Done already', status: 'Done', isPrivate: false, assignedToId: 'u-mgr', userId: 'u-mgr', teamId: 'T1', createdAt: ts(-40) });
// Somebody else's PRIVATE task: the board must never show it.
__seed('tasks', 't3', { taskName: 'Private note of Ahmed', status: 'Pending', isPrivate: true, assignedToId: 'u-ahmed', userId: 'u-ahmed', teamId: 'T1', createdAt: ts(-30) });
__seed('opportunities', 'o1', { title: 'Meleiha compressor overhaul', client: 'AGIBA', stage: 'Bid Preparation', serialNumber: 'OP000011',
  submissionDeadline: dayOffset(4), ownerId: 'u-mona', ownerName: 'Mona Fathy', userId: 'u-mgr', createdAt: ts(-5) });
// ── On them ──
__seed('opportunities', 'o2', { title: 'Gas plant revamp', client: 'Petrobel', stage: 'Submitted', serialNumber: 'OP000012', submittedDate: dayOffset(-20),
  ownerId: 'u-ahmed', ownerName: 'Ahmed Samir', userId: 'u-mgr', createdAt: ts(-60), updatedAt: ts(-1) });
__seed('tasks', 't4', { taskName: 'Get finance approval', status: 'Pending', isPrivate: false, assignedToId: 'u-mona', assignedTo: 'Mona Fathy', assignedById: 'u-mgr',
  userId: 'u-mgr', teamId: 'T1', serialNumber: 'TK000204', createdAt: ts(-30), waitingOn: 'them', waitingSince: dayOffset(-4), waitingFor: 'Finance' });
// ── Nowhere ──
__seed('opportunities', 'o3', { title: 'Pipeline 2025', client: 'AGIBA', stage: 'Won', serialNumber: 'OP000013', userId: 'u-mgr', createdAt: ts(-200) });
__seed('correspondences', 'l2', { subject: 'Closed letter', status: 'Closed', dateReceived: dayOffset(-50), userId: 'u-mgr', teamId: 'T1' });

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@eprom.com.eg' };
window.__nav = [];
window.__open = t => consumePending(t);

// The Outlook helper on localhost.
window.__bridgeOn = true;
window.__bridgeCalls = [];
const at = days => new Date(now.getTime() - days * 86400e3).toISOString();
const MAIL = [
  // They wrote 6 days ago, nothing went back: on us.
  { id: 'm1', subject: 'Site visit dates', sender: 'Ahmed Kamal', sender_email: 'ahmed@enppi.com', to: 'Tariq', recipients: ['Tariq'], direction: 'received', folder: 'Inbox', received_at: at(6) },
  // They asked 12 days ago, we answered 9 days ago, nothing came back since: on them.
  // (A mail we sent into the blue, with nothing from them in the chain, is
  // deliberately NOT chased — mailThreads.ts, queue B4.)
  { id: 'm2a', subject: 'Clarification 3', sender: 'NOC Oman Tenders', sender_email: 'tenders@noc.om', to: 'Tariq', recipients: ['Tariq'], direction: 'received', folder: 'Inbox', received_at: at(12) },
  { id: 'm2', subject: 'RE: Clarification 3', sender: 'Tariq', to: 'NOC Oman Tenders', recipients: ['NOC Oman Tenders'], direction: 'sent', folder: 'Sent Items', received_at: at(9) },
  // Sent into the blue — no answer expected.
  { id: 'm4', subject: 'Company profile', sender: 'Tariq', to: 'New Prospect', recipients: ['New Prospect'], direction: 'sent', folder: 'Sent Items', received_at: at(10) },
  // This morning: not waiting yet.
  { id: 'm3', subject: 'Lunch', sender: 'Friend', sender_email: 'f@x.com', to: 'Tariq', recipients: ['Tariq'], direction: 'received', folder: 'Inbox', received_at: at(0.05) },
];
window.fetch = async (url) => {
  const u = new URL(String(url));
  window.__bridgeCalls.push(u.pathname + u.search);
  if (!window.__bridgeOn) throw new TypeError('Failed to fetch');
  if (u.pathname === '/status') return { ok: true, json: async () => ({ running: true, outlook_connected: true }) };
  if (u.pathname === '/emails') {
    const folder = u.searchParams.get('folder');
    return { ok: true, json: async () => MAIL.filter(m => m.folder === folder) };
  }
  return { ok: false, json: async () => ({}) };
};

const root = createRoot(document.getElementById('root'));
root.render(
  React.createElement('div', { className: 'app-main' },
    React.createElement(WaitingDashboard, { user, appUser: USERS[0], projectUsers: USERS, onNavigate: v => { window.__nav.push(v); } }),
  ),
);

window.__type = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'waitinguiEntry.tsx', loader: 'tsx' },
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
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/waiting',
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
  const p = path.join(ROOT, `scripts/harness/waitingui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const texts = sel => evalJS(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(sel)})].map(window.__txt))`).then(JSON.parse);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const keysOf = side => evalJS(`JSON.stringify([...document.querySelectorAll('[data-waiting="side-${side}"] [data-waiting="row"]')].map(r => r.dataset.key))`).then(JSON.parse);
const rowSel = key => `document.querySelector('[data-waiting="row"][data-key="${key}"]')`;

// ═══════════════════════════════════════════════════════════════════════════
try {

const todayIso = await evalJS(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`);
const pick = async value => {
  await evalJS(`(() => { const s = ${q('[data-waiting="person"]')}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(200);
};

console.log('\n[1] both columns, a manager on Everyone');
await waitFor(q('[data-waiting="side-us"] [data-waiting="row"]'), 'rows on us');
await waitFor(`document.querySelector('[data-waiting="row"][data-key^="mail:"]')`, 'the Outlook chains', 8000);
let us = await keysOf('us'), them = await keysOf('them');
await shot('1-board');
check('on us: the letter, both open tasks, the bid to submit, the unanswered mail',
  ['letter:l1', 'task:t1', 'task:t2', 'bid:o1'].every(k => us.includes(k)) && us.some(k => k.startsWith('mail:')), JSON.stringify(us));
check('on them: the submitted bid, the marked task, the silent mail chain',
  ['bid:o2', 'task:t4'].every(k => them.includes(k)) && them.some(k => k.startsWith('mail:')), JSON.stringify(them));
check('exactly 5 on us and 3 on them', us.length === 5 && them.length === 3, `${us.length} / ${them.length}`);
check('the done task, the won bid and the closed letter are nowhere', !us.concat(them).some(k => ['task:t9', 'bid:o3', 'letter:l2'].includes(k)));
check('somebody else’s private task never shows', !(await evalJS(`document.body.textContent.includes('Private note of Ahmed')`)));
check('the mail from this morning is not waiting yet', !(await evalJS(`document.body.textContent.includes('Lunch')`)));
check('a mail we sent into the blue is not chased', !(await evalJS(`document.body.textContent.includes('Company profile')`)));
check('longest wait first on us: the 12-day letter', us[0] === 'letter:l1', us[0]);
check('longest wait first on them: the 20-day submitted bid', them[0] === 'bid:o2', them[0]);
const letterRow = await evalJS(`window.__txt(${rowSel('letter:l1')})`);
check('age with 11+ wording: "12 days waiting"', letterRow.includes('12 days waiting'), letterRow);
check('the letter shows its missed deadline', letterRow.includes('Was due'), letterRow);
check('the letter says who it is from', letterRow.includes('From: AGIBA'), letterRow);
check('12 days is painted amber', (await evalJS(`${rowSel('letter:l1')}.dataset.band`)) === 'warn');
check('20 days is painted red', (await evalJS(`${rowSel('bid:o2')}.dataset.band`)) === 'alert');
const t4 = await evalJS(`window.__txt(${rowSel('task:t4')})`);
check('the marked task ages from the day it was marked: "Waiting 4 days", on Finance', t4.includes('Waiting 4 days') && t4.includes('On: Finance'), t4);
const bidRow = await evalJS(`window.__txt(${rowSel('bid:o2')})`);
check('the submitted bid: awaiting their decision, 20 days, its owner', bidRow.includes('awaiting their decision') && bidRow.includes('Ahmed Samir') && bidRow.includes('20 days waiting'), bidRow);
const mailUs = await evalJS(`window.__txt(document.querySelector('[data-waiting="side-us"] [data-key^="mail:"]'))`);
check('the unanswered mail: 6 days, no reply from us', mailUs.includes('Waiting 6 days') && mailUs.includes('no reply from us'), mailUs);
const mailThem = await evalJS(`window.__txt(document.querySelector('[data-waiting="side-them"] [data-key^="mail:"]'))`);
check('the silent chain: 9 days, we wrote last', mailThem.includes('Waiting 9 days') && mailThem.includes('We wrote last'), mailThem);
check('the column counts', (await text('[data-waiting="side-us"] [data-waiting="count"]')) === '5' && (await text('[data-waiting="side-them"] [data-waiting="count"]')) === '3');
check('"waiting a week or more" is counted', (await text('[data-waiting="side-us"] [data-waiting="summary"]')).includes('2 waiting a week or more'),
  await text('[data-waiting="side-us"] [data-waiting="summary"]'));
check('the helper was asked for the whole Inbox + Sent Items', (await evalJS(`window.__bridgeCalls.filter(c => c.startsWith('/emails')).length`)) === 2);

console.log('\n[2] filters');
await clickEl(q('[data-waiting="scope-mine"]'), 'Mine');
us = await keysOf('us'); them = await keysOf('them');
check('Mine: my task + the letter I logged + my own Outlook, not Mona’s task or bid', us.includes('task:t1') && us.includes('letter:l1') && !us.includes('task:t2') && !us.includes('bid:o1'), JSON.stringify(us));
check('Mine: the person picker is gone', !(await evalJS(`!!${q('[data-waiting="person"]')}`)));
await clickEl(q('[data-waiting="scope-all"]'), 'Everyone');
await pick('Mona Fathy');
us = await keysOf('us'); them = await keysOf('them');
check('person = Mona: her task and bid on us, her marked task on them', JSON.stringify([...us].sort()) === JSON.stringify(['bid:o1', 'task:t2']) && JSON.stringify(them) === JSON.stringify(['task:t4']), JSON.stringify([us, them]));
await pick('');
await clickEl(q('[data-waiting="kind-bid"]'), 'Bids');
us = await keysOf('us'); them = await keysOf('them');
check('Bids only', us.join() === 'bid:o1' && them.join() === 'bid:o2', JSON.stringify([us, them]));
check('the E-mails filter is offered because the helper runs', await evalJS(`!!${q('[data-waiting="kind-mail"]')}`));
await clickEl(q('[data-waiting="kind-all"]'), 'All');

console.log('\n[3] mark a task "waiting on them", then bring it back');
check('a submitted bid cannot be moved by hand', !(await evalJS(`!!${rowSel('bid:o2')}.querySelector('[data-waiting="back"]')`)));
check('Outlook mail cannot be moved by hand', !(await evalJS(`!!document.querySelector('[data-key^="mail:"] [data-waiting="mark"]')`)));
await clickEl(`${rowSel('task:t1')}.querySelector('[data-waiting="mark"]')`, 'Waiting on them (t1)');
await waitFor(`${rowSel('task:t1')}.querySelector('[data-waiting="mark-form"]')`, 'the mark form');
await evalJS(`window.__type(${rowSel('task:t1')}.querySelector('[data-waiting="mark-form"] input'), 'AGIBA tenders')`);
await sleep(150);
await shot('2-mark');
await clickEl(`${rowSel('task:t1')}.querySelector('[data-waiting="mark-form"] button[type="submit"]')`, 'Save');
await waitFor(`document.querySelector('[data-waiting="side-them"] [data-key="task:t1"]')`, 't1 on them');
let w = await evalJS(`JSON.stringify(window.__writes)`).then(JSON.parse);
check('exactly one write', w.length === 1, JSON.stringify(w));
check('…to the task', w[0]?.op === 'update' && w[0]?.path === 'tasks/t1');
check('…waitingOn them, stamped today, waiting on "AGIBA tenders", updatedAt set',
  w[0]?.data.waitingOn === 'them' && w[0]?.data.waitingSince === todayIso && w[0]?.data.waitingFor === 'AGIBA tenders' && !!w[0]?.data.updatedAt, JSON.stringify(w[0]));
const moved = await evalJS(`window.__txt(document.querySelector('[data-waiting="side-them"] [data-key="task:t1"]'))`);
check('it now reads "Since today · On: AGIBA tenders"', moved.includes('Since today') && moved.includes('On: AGIBA tenders'), moved);
check('…and is gone from on us', !(await keysOf('us')).includes('task:t1'));
await clickEl(`document.querySelector('[data-waiting="side-them"] [data-key="task:t1"] [data-waiting="back"]')`, 'Back to us');
await waitFor(`document.querySelector('[data-waiting="side-us"] [data-key="task:t1"]')`, 't1 back on us');
w = await evalJS(`JSON.stringify(window.__writes)`).then(JSON.parse);
check('back to us: second write clears the mark', w.length === 2 && w[1].data.waitingOn === 'us' && w[1].data.waitingFor === '' && w[1].data.waitingSince === '', JSON.stringify(w[1]));
check('…and it ages from its creation again ("Waiting 8 days")', (await evalJS(`window.__txt(${rowSel('task:t1')})`)).includes('Waiting 8 days'));
await clickEl(`${rowSel('task:t2')}.querySelector('[data-waiting="mark"]')`, 'Waiting on them (t2)');
await clickEl(`[...${rowSel('task:t2')}.querySelectorAll('button')].find(b => window.__txt(b) === 'Cancel')`, 'Cancel');
check('Cancel writes nothing', (await evalJS(`window.__writes.length`)) === 2);

console.log('\n[4] the follow-up letter');
await clickEl(`${rowSel('bid:o2')}.querySelector('[data-waiting="letter"]')`, 'Write a follow-up');
await waitFor(`document.body.textContent.includes('Open in email')`, 'the letter dialog');
const dlg = await evalJS(`document.querySelector('textarea') ? document.querySelector('textarea').value : ''`);
check('the letter is about the bid and names the client', dlg.includes('Gas plant revamp') && dlg.includes('Petrobel'), dlg.slice(0, 300));
await shot('3-letter');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(250);
check('Escape closes it', !(await evalJS(`document.body.textContent.includes('Open in email')`)));
check('"on us" rows offer no letter', !(await evalJS(`!!document.querySelector('[data-waiting="side-us"] [data-waiting="letter"]')`)));

console.log('\n[5] rows open their records');
await clickEl(`${rowSel('letter:l1')}.querySelector('button')`, 'the letter row');
check('letter row → Correspondences', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'correspondences');
check('…with the letter queued to open', (await evalJS(`window.__open('corresponding')`)) === 'l1');
await clickEl(`${rowSel('bid:o2')}.querySelector('button')`, 'the bid row');
check('bid row → the bid', (await evalJS(`window.__open('opportunity')`)) === 'o2');
await clickEl(`document.querySelector('[data-waiting="side-us"] [data-key^="mail:"] button')`, 'the mail row');
check('mail row → the Outlook page', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'outlook-feed');

console.log('\n[6] Arabic + RTL, and 390 px');
await evalJS(`window.__setLang('ar')`);
await sleep(700);
const arBody = await evalJS(`document.body.textContent`);
check('page is RTL', (await evalJS(`document.documentElement.dir`)) === 'rtl');
check('Arabic column titles', arBody.includes('ينتظرنا') && arBody.includes('ننتظرهم'));
check('Arabic age with agreement ("منذ 12 يومًا", "منذ 4 أيام")', arBody.includes('منذ 12 يومًا') && arBody.includes('منذ 4 أيام'));
check('no Arabic-Indic digits', !/[٠-٩]/.test(arBody));
check('no English column titles left', !arBody.includes('Waiting on us') && !arBody.includes('Waiting on them'));
check('no «تم» / «بواسطة» in the page', !/(^|\s)(تم|يتم|بواسطة)(\s|$)/.test(arBody));
await shot('4-ar');
check('no horizontal overflow at 1440 (RTL)', (await overflow()) <= 0);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(500);
check('no horizontal overflow at 390px (RTL)', (await overflow()) <= 0, String(await overflow()));
await shot('5-ar-mobile');
await evalJS(`window.__setLang('en')`);
await sleep(400);
check('no horizontal overflow at 390px (LTR)', (await overflow()) <= 0);
await shot('6-en-mobile');
await send('Emulation.clearDeviceMetricsOverride');

check('only the two mark writes happened in the whole run', (await evalJS(`window.__writes.length`)) === 2);
check('no uncaught page errors or console.errors during the whole run', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 600)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/waitingui-failure.png');
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
