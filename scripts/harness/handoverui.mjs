// Click-through harness for the Handover file (queue task D7).
//
// handover.mjs proves the logic (src/lib/handover.ts) in node. This proves the
// SCREEN: the real HandoverDashboard reading the boards through the real
// onSnapshot + subscribeVisibleTasks, a manager opening a colleague's file from
// a `#/handover?person=` link, handing one task over, a letter taking its
// linked task along, a contract row opening its project on the Contracts tab,
// "give everything" with its confirm step, the receiver's notifications, the
// copied handover note, an employee's own file with a locked letter, Arabic +
// RTL and 390 px.
//
// Real code under test:  src/HandoverDashboard.tsx, src/lib/handover.ts,
//                        src/lib/taskVisibility.ts, src/lib/deepLink.ts,
//                        src/lib/pushNotification.ts, src/i18n.ts
//                        + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts, navigator.clipboard.
//
//   node scripts/harness/handoverui.mjs   (--headed to watch it, --shot to write PNGs)

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-handoverui-'));

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
import HandoverDashboard from './src/HandoverDashboard';
import { consumePending, takeConsumedTab } from './src/lib/deepLink';
import i18n, { applyLanguageToDocument } from './src/i18n';

const USERS = [
  { id: 'u-mgr',   displayName: 'Tariq Salama', email: 't@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1' },
  { id: 'u-ahmed', displayName: 'Ahmed Samir',  email: 'a@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1' },
  { id: 'u-mona',  displayName: 'Mona Fathy',   email: 'm@eprom.com.eg', photoURL: '', status: 'Rejected', role: 'Employee', teamId: 'T1' },
  { id: 'u-hany',  displayName: 'Hany Adel',    email: 'h@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1' },
];

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const ts = n => { const d = new Date(now.getTime() + n * 86400000); return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d, toMillis: () => d.getTime() }; };

// ── Mona's work (she has left: status Rejected) ──
__seed('tasks', 't1', { taskName: 'Prepare price schedule', status: 'In Progress', isPrivate: false, assignedToId: 'u-mona', assignedTo: 'Mona Fathy', assignedById: 'u-mgr',
  dueDate: dayOffset(-3), statusUpdate: 'Waiting for the vendor quote', serialNumber: 'TK000301', createdAt: ts(-10) });
__seed('tasks', 't2', { taskName: 'Collect subcontractor quotes', status: 'Pending', isPrivate: false, assignedToId: 'u-mona', assignedTo: 'Mona Fathy', assignedById: 'u-mgr',
  dueDate: dayOffset(6), serialNumber: 'TK000302', createdAt: ts(-4), collaboratorIds: ['u-ahmed'], collaborators: ['Ahmed Samir'] });
__seed('tasks', 't3', { taskName: 'Review Hany draft', status: 'Pending', isPrivate: false, assignedToId: 'u-hany', assignedTo: 'Hany Adel', assignedById: 'u-mgr',
  collaboratorIds: ['u-mona'], collaborators: ['Mona Fathy'], serialNumber: 'TK000303', createdAt: ts(-3) });
__seed('tasks', 't7', { taskName: 'Answer AGIBA prices', status: 'Pending', isPrivate: false, assignedToId: 'u-mona', assignedTo: 'Mona Fathy', assignedById: 'u-mgr',
  serialNumber: 'TK000307', createdAt: ts(-5), correspondingId: 'l1' });
// Mona's PRIVATE task — the manager can never see or move it.
__seed('tasks', 't5', { taskName: 'Private note of Mona', status: 'Pending', isPrivate: true, assignedToId: 'u-mona', createdAt: ts(-2) });
__seed('tasks', 't9', { taskName: 'Finished long ago', status: 'Done', isPrivate: false, assignedToId: 'u-mona', createdAt: ts(-40) });
__seed('correspondences', 'l1', { subject: 'AGIBA asks for revised prices', sentFrom: 'AGIBA', status: 'Assigned', assignedToId: 'u-mona', assignedTo: 'Mona Fathy',
  userId: 'u-mgr', serialNumber: 'CR000101', deadline: dayOffset(2), convertedToTaskId: 't7', actions: 'Call their buyer first' });
__seed('correspondences', 'l2', { subject: 'Closed letter', status: 'Closed', assignedToId: 'u-mona', userId: 'u-mgr' });
__seed('opportunities', 'o1', { title: 'Meleiha compressor overhaul', client: 'AGIBA', stage: 'Bid Preparation', serialNumber: 'OP000011',
  submissionDeadline: dayOffset(4), ownerId: 'u-mona', ownerName: 'Mona Fathy', lastFollowUpText: 'Site visit done', userId: 'u-mgr', createdAt: ts(-5) });
__seed('opportunities', 'o3', { title: 'Won already', client: 'AGIBA', stage: 'Won', ownerId: 'u-mona', userId: 'u-mgr', createdAt: ts(-90) });
__seed('projects', 'p1', { name: 'AGIBA maintenance', client: 'AGIBA', status: 'Active', userId: 'u-mgr', serialNumber: 'PR000003' });
__seed('projectContracts', 'c1', { projectId: 'p1', parentId: null, type: 'contract', subject: 'Main maintenance contract', contractNumber: '4600001234',
  inCharge: 'Eng. Mona Fathy', endDate: dayOffset(40), companyName: 'AGIBA', userId: 'u-mgr' });
__seed('projectContracts', 'c2', { projectId: 'p1', parentId: null, type: 'contract', subject: 'Closed contract', inCharge: 'Mona Fathy', status: 'Closed', userId: 'u-mgr' });
// ── Hany's own work, for the employee view ──
__seed('tasks', 't8', { taskName: 'Hany own task', status: 'Pending', isPrivate: false, assignedToId: 'u-hany', assignedTo: 'Hany Adel', assignedById: 'u-hany', serialNumber: 'TK000308', createdAt: ts(-1) });
__seed('correspondences', 'l5', { subject: 'Letter the manager gave Hany', sentFrom: 'Petrobel', status: 'Assigned', assignedToId: 'u-hany', assignedTo: 'Hany Adel', userId: 'u-mgr', serialNumber: 'CR000105' });

window.__nav = [];
window.__open = t => consumePending(t);
window.__tab = () => takeConsumedTab();
window.__clip = [];
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async s => { window.__clip.push(s); } } });

const root = createRoot(document.getElementById('root'));
window.__mountAs = uid => {
  const me = USERS.find(u => u.id === uid);
  root.render(
    React.createElement('div', { className: 'app-main' },
      React.createElement(HandoverDashboard, { key: uid, user: { uid, displayName: me.displayName, email: me.email }, appUser: me, projectUsers: USERS, onNavigate: v => { window.__nav.push(v); } }),
    ),
  );
};
window.__mountAs('u-mgr');

window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'handoveruiEntry.tsx', loader: 'tsx' },
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

const PORT = 9811 + (process.pid % 100);
const edge = spawn(EDGE, [
  HEADED ? '--new-window' : '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(WORK, 'profile')}`,
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000',
  // A manager arriving from a pasted link to Mona's file.
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/handover?person=u-mona',
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
window.__pick = (el, value) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })); };
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
      return { x: b.x, y: b.y, disabled: !!el.disabled, covered: !(el === hit || el.contains(hit) || (hit && hit.contains(el))), hitTag: hit ? hit.tagName : null };
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
  const p = path.join(ROOT, `scripts/harness/handoverui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const rowKeys = () => evalJS(`JSON.stringify([...document.querySelectorAll('[data-handover="row"]')].map(r => r.dataset.key))`).then(JSON.parse);
const rowSel = key => `document.querySelector('[data-handover="row"][data-key="${key}"]')`;
const writes = () => evalJS(`JSON.stringify(window.__writes)`).then(JSON.parse);
const pickIn = (sel, value) => evalJS(`window.__pick(${sel}, ${JSON.stringify(value)})`).then(() => sleep(150));

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] a manager opens Mona’s file from a link');
await waitFor(q('[data-handover="row"]'), 'rows');
let keys = await rowKeys();
await shot('1-file');
check('the link picked Mona', (await evalJS(`${q('[data-handover="person"]')}.value`)) === 'u-mona');
check('Mona is offered even though she is no longer approved — marked as such', (await evalJS(`window.__txt([...${q('[data-handover="person"]')}.options].find(o => o.value === 'u-mona'))`)).includes('Rejected'));
check('her open tasks (owned + co-owned), the letter, the live bid and the contract',
  JSON.stringify(keys) === JSON.stringify(['task:t1', 'task:t2', 'task:t7', 'task:t3', 'letter:l1', 'bid:o1', 'contract:c1']), JSON.stringify(keys));
check('her private task is not shown to the manager', !(await evalJS(`document.body.textContent.includes('Private note of Mona')`)));
check('closed / done / won records are not shown', !(await evalJS(`['Finished long ago', 'Closed letter', 'Won already', 'Closed contract'].some(s => document.body.textContent.includes(s))`)));
const summary = await text('[data-handover="summary"]');
check('summary: 7 items, 1 late, per kind, co-owner on 1', summary.includes('7 items') && summary.includes('1 late') && summary.includes('Tasks 4') && summary.includes('Co-owner on 1'), summary);
const t1 = await evalJS(`window.__txt(${rowSel('task:t1')})`);
check('a row shows status, where it stands and the missed date', t1.includes('In Progress') && t1.includes('Waiting for the vendor quote') && t1.includes('Was due'), t1);
check('a co-owned task says Co-owner', (await evalJS(`window.__txt(${rowSel('task:t3')})`)).includes('Co-owner'));
const c1 = await evalJS(`window.__txt(${rowSel('contract:c1')})`);
check('the contract matched "Eng. Mona Fathy" and names its project', c1.includes('Main maintenance contract') && c1.includes('Project: AGIBA maintenance'), c1);
check('Mona is not offered as a receiver, nor anyone not approved', (await evalJS(`JSON.stringify([...${q('[data-handover="all-to"]')}.options].map(o => o.value))`)) === JSON.stringify(['', 'u-ahmed', 'u-hany', 'u-mgr']));

console.log('\n[2] hand one task over');
check('Hand over is disabled until someone is picked', await evalJS(`${rowSel('task:t2')}.querySelector('[data-handover="give"]').disabled`));
await pickIn(`${rowSel('task:t2')}.querySelector('[data-handover="give-to"]')`, 'u-ahmed');
await clickEl(`${rowSel('task:t2')}.querySelector('[data-handover="give"]')`, 'Hand over t2');
await waitFor(`!${rowSel('task:t2')}`, 't2 leaves the file');
let w = await writes();
const tw = w.find(x => x.path === 'tasks/t2');
check('the task write: Ahmed owns it and leaves the co-owner list', tw && tw.data.assignedToId === 'u-ahmed' && tw.data.assignedTo === 'Ahmed Samir' && JSON.stringify(tw.data.collaboratorIds) === '[]' && !!tw.data.updatedAt, JSON.stringify(tw));
const n1 = w.find(x => x.op === 'add' && x.path.startsWith('notifications/'));
check('Ahmed is notified, deep-linked to the task', n1 && n1.data.forUserId === 'u-ahmed' && n1.data.type === 'task_assigned' && n1.data.relatedId === 't2' && n1.data.message.includes('from Mona Fathy'), JSON.stringify(n1?.data));
check('a confirmation line names the task and Ahmed', (await text('[data-handover="message"]')).includes('Collect subcontractor quotes') && (await text('[data-handover="message"]')).includes('Ahmed Samir'));
check('exactly 2 writes so far (task + notification)', w.length === 2, String(w.length));

console.log('\n[3] a letter takes its linked task along');
await pickIn(`${rowSel('letter:l1')}.querySelector('[data-handover="give-to"]')`, 'u-hany');
await clickEl(`${rowSel('letter:l1')}.querySelector('[data-handover="give"]')`, 'Hand over l1');
await waitFor(`!${rowSel('letter:l1')} && !${rowSel('task:t7')}`, 'l1 and t7 leave the file');
w = await writes();
check('letter reassigned to Hany', w.some(x => x.path === 'correspondences/l1' && x.data.assignedToId === 'u-hany' && x.data.assignedTo === 'Hany Adel'));
check('…and its linked task too', w.some(x => x.path === 'tasks/t7' && x.data.assignedToId === 'u-hany'));
check('Hany is notified about the letter', w.some(x => x.op === 'add' && x.data.forUserId === 'u-hany' && x.data.type === 'corresponding_assigned' && x.data.relatedId === 'l1'));

console.log('\n[4] rows open their records');
await clickEl(`${rowSel('contract:c1')}.querySelector('button')`, 'the contract row');
check('contract row → Projects', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'projects');
check('…the project queued to open', (await evalJS(`window.__open('project')`)) === 'p1');
check('…on its Contracts tab', (await evalJS(`window.__tab()`)) === 'contracts');
await clickEl(`${rowSel('bid:o1')}.querySelector('button')`, 'the bid row');
check('bid row → the bid', (await evalJS(`window.__open('opportunity')`)) === 'o1' && (await evalJS(`window.__nav.slice(-1)[0]`)) === 'opportunities');

console.log('\n[5] the handover note');
await clickEl(q('[data-handover="copy"]'), 'Copy handover note');
const clip = await evalJS(`window.__clip.slice(-1)[0] || ''`);
check('note heading and totals', clip.startsWith('Handover file — Mona Fathy') && clip.includes('Open items: 4'), clip.slice(0, 200));
check('note lists the bid with where it stands', clip.includes('OP000011 — Meleiha compressor overhaul') && clip.includes('Where it stands: Site visit done'), clip);
check('note lists the contract with its project', clip.includes('Project: AGIBA maintenance'));
check('the button says Copied', (await text('[data-handover="copy"]')).includes('Copied'));

console.log('\n[6] give everything to one person');
const before = (await writes()).length;
await pickIn(q('[data-handover="all-to"]'), 'u-ahmed');
await clickEl(q('[data-handover="all-go"]'), 'Hand over all');
await waitFor(q('[data-handover="confirm"]'), 'the confirm step');
const conf = await text('[data-handover="confirm"]');
check('confirm names the count and both people', conf.includes('Move 4 open items from Mona Fathy to Ahmed Samir?'), conf);
check('nothing written before confirming', (await writes()).length === before);
await shot('2-confirm');
await clickEl(q('[data-handover="confirm-yes"]'), 'Yes, hand over');
await waitFor(q('[data-handover="empty"]'), 'the empty file');
w = (await writes()).slice(before);
check('four record writes', w.filter(x => x.op === 'update').map(x => x.path).sort().join() === 'opportunities/o1,projectContracts/c1,tasks/t1,tasks/t3', w.map(x => x.path).join());
check('the co-owned task swapped Mona for Ahmed', w.some(x => x.path === 'tasks/t3' && JSON.stringify(x.data.collaboratorIds) === '["u-ahmed"]' && JSON.stringify(x.data.collaborators) === '["Ahmed Samir"]'));
check('the bid now belongs to Ahmed', w.some(x => x.path === 'opportunities/o1' && x.data.ownerId === 'u-ahmed' && x.data.ownerName === 'Ahmed Samir'));
check('the contract now names Ahmed in charge', w.some(x => x.path === 'projectContracts/c1' && x.data.inCharge === 'Ahmed Samir'));
const adds = w.filter(x => x.op === 'add');
check('ONE summary notification, not four', adds.length === 1 && adds[0].data.type === 'handover_received' && adds[0].data.link === '#handover' && adds[0].data.message.includes('4 open item(s)'), JSON.stringify(adds.map(a => a.data)));
check('result line', (await text('[data-handover="message"]')).includes('Moved 4 to Ahmed Samir'), await text('[data-handover="message"]'));
check('Mona’s file says it is empty', (await text('[data-handover="empty"]')).includes('Nothing open is in Mona Fathy’s name'));
await shot('3-empty');

console.log('\n[7] switch to Ahmed’s file');
await pickIn(q('[data-handover="person"]'), 'u-ahmed');
await waitFor(q('[data-handover="row"]'), 'Ahmed rows');
keys = await rowKeys();
check('Ahmed now holds everything handed to him', ['task:t1', 'task:t2', 'task:t3', 'bid:o1', 'contract:c1'].every(k => keys.includes(k)), JSON.stringify(keys));
check('the URL follows the picker', (await evalJS(`location.hash`)) === '#/handover?person=u-ahmed');

console.log('\n[8] an employee sees only their own file');
await evalJS(`window.__mountAs('u-hany')`);
await waitFor(q('[data-handover="row"]'), 'Hany rows');
check('no person picker, "Your handover file"', !(await evalJS(`!!${q('[data-handover="person"]')}`)) && (await evalJS(`document.body.textContent.includes('Your handover file')`)));
keys = await rowKeys();
check('Hany’s own task, the letters given to him, the task linked to one', ['task:t8', 'task:t7', 'letter:l1', 'letter:l5'].every(k => keys.includes(k)), JSON.stringify(keys));
check('a letter a manager logged is locked for him', await evalJS(`!!${rowSel('letter:l5')}.querySelector('[data-handover="locked"]') && !${rowSel('letter:l5')}.querySelector('[data-handover="give"]')`));
check('his own task can be handed over', await evalJS(`!!${rowSel('task:t8')}.querySelector('[data-handover="give"]')`));
check('"only a manager" count under give-everything', (await text('[data-handover="not-movable"]')).includes('2 of these'), await text('[data-handover="not-movable"]'));

console.log('\n[9] Arabic + RTL, and 390 px');
await evalJS(`window.__mountAs('u-mgr')`);
await waitFor(q('[data-handover="row"]'), 'manager rows again');
await evalJS(`window.__setLang('ar')`);
await sleep(700);
const arBody = await evalJS(`document.body.textContent`);
check('page is RTL', (await evalJS(`document.documentElement.dir`)) === 'rtl');
check('Arabic title and actions', arBody.includes('التسليم والتسلّم') && arBody.includes('سلِّم الكل إلى') && arBody.includes('انسخ مذكرة التسليم'));
check('Arabic item count with agreement', /بنود|بندًا|بندان|بند واحد/.test(await text('[data-handover="total"]')), await text('[data-handover="total"]'));
check('no Arabic-Indic digits', !/[٠-٩]/.test(arBody));
check('no English UI copy left', !['Give everything to', 'Copy handover note', 'Whose file', 'Hand over'].some(s => arBody.includes(s)));
// «الخاصة» alone is fine («المهام الخاصة» = private tasks); «الخاص بـ» is the banned calque.
const banned = arBody.match(/.{0,30}((^|\s)(تم|يتم|بواسطة)(\s|$)|الخاصة? ب).{0,30}/);
check('no «تم» / «بواسطة» / «الخاص بـ» in the page', !banned, banned ? banned[0] : '');
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

check('no uncaught page errors or console.errors during the whole run', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 800)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/handoverui-failure.png');
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
