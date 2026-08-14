// Click-through harness for the ManagerInbox -> CreateTaskPanel conversion.
//
// Why this exists: the conversion (commit a8b1f00) had only ever been
// type-checked. It cannot be exercised against the real app without a signed-in
// Firebase session, so this renders the REAL components in a REAL browser and
// drives them with REAL hit-tested mouse clicks.
//
// Real code under test:  src/ManagerInbox.tsx, src/components/CreateTaskPanel.tsx,
//                        src/components/ComboBox.tsx, src/lib/counters.ts,
//                        src/lib/taskVisibility.ts, src/lib/pushNotification.ts,
//                        src/lib/notifyDetails.ts, src/lib/deepLink.ts, src/utils.ts,
//                        src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (in-memory store that records every
//                        write), src/lib/firebase.ts, and window.fetch (the Apps
//                        Script push proxy). Nothing else.
//
// Clicks go through CDP Input.dispatchMouseEvent at element centres, so a
// z-index / overlay mistake fails the run instead of passing silently.
//
//   node scripts/harness/inboxconvert.mjs           (add --headed to watch it)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
// --shot writes a PNG at each step, for eyeballing what the assertions can't see.
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-inbox-'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

// The fake Firestore lives in fakeFirestore.mjs — i18nrtl.mjs mounts the real
// dashboards against the same store, and two copies would drift.
import { FIRESTORE_STUB } from './fakeFirestore.mjs';

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
    // Both './lib/firebase' (dashboards) and './firebase' (everything in src/lib).
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

// ── 2. The page entry: seeds the store, then mounts the real ManagerInbox ────
const ENTRY = /* tsx */ `
import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/i18n';
import ManagerInbox from './src/ManagerInbox';

// Ordering only matters relative to itself; base it on a real date so the
// rendered "Since dd/mm/yyyy" line isn't 1970 in a failure screenshot.
const T0 = Math.floor(new Date('2026-08-01T08:00:00Z').getTime() / 1000);
const ts = s => ({ seconds: T0 + s, toDate: () => new Date((T0 + s) * 1000) });

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@x.com', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Maintenance Planning' },
  { id: 'u-emp1', displayName: 'Nevin Anwar',  email: 'n@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Maintenance Planning', fcmToken: 'FCM-NEVIN' },
  { id: 'u-emp2', displayName: 'Ahmed Salem',  email: 'a@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Maintenance Planning', telegramChatId: '5551' },
  { id: 'u-out',  displayName: 'Mona Fouad',   email: 'm@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T9', department: 'Finance' },
  { id: 'u-adm',  displayName: 'Admin One',    email: 'd@x.com', photoURL: '', status: 'Approved', role: 'Admin',    teamId: 'T1', department: 'Maintenance Planning' },
];

// A plain unassigned correspondence — the main conversion path.
__seed('correspondences', 'c1', {
  subject: 'Pump P-101 vibration report',
  body: 'Vendor reports high vibration on P-101.\\nPlease investigate before the turnaround.',
  sentFrom: 'EGPC', department: 'Maintenance Planning', subCategory: 'Refinery Upgrade',
  category: 'Project', priority: 'High', dateReceived: '2026-08-10', deadline: '2026-09-30',
  serialNumber: 'CR000041', filePaths: ['\\\\\\\\srv\\\\shared\\\\P-101'],
  attachedFile: 'https://drive.example/f1', attachedFileName: 'vibration.pdf',
  status: 'Unread', userId: 'u-mgr', teamId: 'T1', createdAt: ts(1000), updatedAt: ts(1000),
});
// Pre-assigned to somebody OUTSIDE the manager's department: the panel's own
// select cannot render them, so the prefill must NOT seed that id.
__seed('correspondences', 'c2', {
  subject: 'Annual insurance renewal',
  body: 'Finance needs the asset list.',
  sentFrom: 'Finance', department: 'Finance', subCategory: 'None',
  category: 'Administrative', priority: 'Low', dateReceived: '2026-08-11',
  serialNumber: 'CR000042', status: 'Unread', assignedToId: 'u-out', assignedTo: 'Mona Fouad',
  userId: 'u-mgr', teamId: 'T1', createdAt: ts(900), updatedAt: ts(900),
});
// Already converted -> the cut-down reassign form, never the panel.
__seed('correspondences', 'c3', {
  subject: 'Spare parts shortage',
  body: 'Bearings out of stock.',
  sentFrom: 'Stores', department: 'Maintenance Planning', subCategory: 'None',
  category: 'Project', priority: 'Medium', dateReceived: '2026-08-09', deadline: '2026-08-25',
  serialNumber: 'CR000043', status: 'Assigned', assignedToId: 'u-emp1', assignedTo: 'Nevin Anwar',
  convertedToTaskId: 'task-existing', userId: 'u-mgr', teamId: 'T1', createdAt: ts(800), updatedAt: ts(800),
});
// The serial counter doc that counters.ts maintains in the same collection.
__seed('correspondences', '--stats--', { value: 43 });
__seed('tasks', '--stats--', { value: 7 });
__seed('tasks', 'task-existing', {
  taskName: 'Spare parts shortage', description: 'Bearings out of stock.', status: 'Pending',
  priority: 'Medium', serialNumber: 'TK000007', assignedTo: 'Nevin Anwar', assignedToId: 'u-emp1',
  isPrivate: false, collaboratorIds: [], correspondingId: 'c3', createdAt: ts(800), updatedAt: ts(800),
});

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@x.com' };
const appUser = USERS[0];

const root = createRoot(document.getElementById('root'));
const mount = role => root.render(
  React.createElement('div', { style: { maxWidth: 1200, margin: '0 auto', padding: 24 } },
    React.createElement(ManagerInbox, {
      user, appUser: { ...appUser, role }, projectUsers: USERS,
      onNavigate: v => { window.__navigated = v; },
    }),
  ),
);
mount('Manager');
// An Admin sees every correspondence, not just their department's — that is the
// only view where an unfiltered listener could surface the counter doc.
window.__renderAs = mount;

window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e =>
  window.__errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));

// Record the Apps Script push calls instead of making them.
window.__pushes = [];
window.fetch = async (url, init) => {
  window.__pushes.push({ url: String(url), body: JSON.parse(init.body) });
  return { ok: true, json: async () => ({ status: 'success', url: 'https://drive.example/uploaded' }) };
};
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'inboxEntry.tsx', loader: 'tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  outfile: path.join(WORK, 'bundle.js'),
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '__VITE_ENV__',
  },
  banner: { js: `const __VITE_ENV__ = { VITE_GOOGLE_SCRIPT_URL: 'https://script.test/exec', VITE_GOOGLE_SCRIPT_SECRET: 'harness-secret' };` },
  plugins: [stubPlugin],
  logLevel: 'warning',
});

// The real stylesheet, minus the two things a bundler normally handles (the
// webfont fetch would just hang in headless).
const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  .replace(/@import url\([^)]*\);/g, '')
  .replace(/@tailwind [a-z]+;/g, '');
fs.writeFileSync(path.join(WORK, 'app.css'), css);
fs.writeFileSync(path.join(WORK, 'index.html'),
  // The viewport meta is the one from the real index.html — without it Edge
  // lays the page out wide and scales it down, and the narrow-width check
  // would pass while proving nothing.
  `<!doctype html><html><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0" />
   <link rel="stylesheet" href="app.css"></head>
   <body><div id="root"></div><script src="bundle.js"></script></body></html>`);

// ── 3. Headless Edge over CDP ────────────────────────────────────────────────
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('Microsoft Edge not found.'); process.exit(2); }

const PORT = 9411 + (process.pid % 100);
const profile = path.join(WORK, 'profile');
const edge = spawn(EDGE, [
  HEADED ? '--new-window' : '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000',
  pathToFileURL(path.join(WORK, 'index.html')).href,
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function targets() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('Edge did not expose a page target');
}
const page = await targets();

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
// window.onerror on a file:// page reports a useless "Script error."; CDP
// carries the real stack, so collect it here instead.
const pageErrors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    pageErrors.push(d.exception?.description || d.text);
  }
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

// In-page helpers: find by visible text, and report a real hit test.
const HELPERS = `
window.__vis = el => !!(el && el.offsetParent !== null && el.getClientRects().length);
window.__byText = (sel, text, root) => [...(root || document).querySelectorAll(sel)]
  .filter(e => window.__vis(e) && (e.textContent || '').replace(/\\s+/g, ' ').trim().includes(text));
window.__one = (sel, text) => { const m = window.__byText(sel, text); return m.length ? m[0] : null; };
window.__box = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; };
window.__panel = () => document.querySelector('input[placeholder="What needs to be done?"]');
// The slide-over itself, so panel fields are never confused with the inbox's.
window.__panelRoot = () => {
  let e = window.__panel();
  while (e && getComputedStyle(e).position !== 'fixed') e = e.parentElement;
  return e;
};
// A ComboBox renders its value as the <span> inside a button.input.
window.__labelled = (root, name) => {
  const l = [...root.querySelectorAll('.input-label')].find(x => x.textContent.trim().startsWith(name));
  if (!l) return null;
  const holder = l.parentElement;
  const combo = holder.querySelector('button.input span');
  if (combo) return combo.textContent.trim();
  const f = holder.querySelector('input, select, textarea');
  return f ? f.value : null;
};
`;
await waitFor(`document.getElementById('root') && document.getElementById('root').children.length`, 'app mount');
await evalJS(HELPERS);

// A real, hit-tested click: fails loudly if something else is on top.
async function clickEl(finderJS, label) {
  const info = await evalJS(`(() => {
    ${HELPERS}
    const el = ${finderJS};
    if (!el) return { err: 'not found' };
    el.scrollIntoView({ block: 'center' });
    const b = window.__box(el);
    if (b.w === 0 || b.h === 0) return { err: 'zero-size' };
    const hit = document.elementFromPoint(b.x, b.y);
    return { x: b.x, y: b.y, covered: !(el === hit || el.contains(hit) || (hit && hit.contains(el))),
             hitTag: hit ? hit.tagName + '.' + hit.className : null };
  })()`);
  if (info.err) throw new Error(`click ${label}: ${info.err}`);
  if (info.covered) throw new Error(`click ${label}: something else is on top (${info.hitTag})`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: info.x, y: info.y, button: 'left', clickCount: 1, buttons: 1 });
  }
  await sleep(160);
  return info;
}
async function typeInto(finderJS, text, label) {
  await clickEl(finderJS, label);
  await send('Input.insertText', { text });
  await sleep(120);
}
// A <select> cannot be opened headlessly; drive it the way React reads it.
async function setSelect(finderJS, value, label) {
  const ok = await evalJS(`(() => {
    ${HELPERS}
    const el = ${finderJS};
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value === ${JSON.stringify(value)};
  })()`);
  if (!ok) throw new Error(`setSelect ${label}: value not applied`);
  await sleep(160);
}
async function shot(name) {
  if (!SHOT) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(ROOT, `scripts/harness/inboxconvert-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const writes = () => evalJS('JSON.stringify(window.__writes)').then(JSON.parse);
const docOf = (c, id) => evalJS(`JSON.stringify(window.__store.get(${JSON.stringify(c)}).get(${JSON.stringify(id)}) || null)`).then(JSON.parse);
const allOf = c => evalJS(`JSON.stringify([...window.__store.get(${JSON.stringify(c)}).entries()].map(([id,d])=>({id,...d})))`).then(JSON.parse);

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] the inbox renders');
await waitFor(`window.__byText('h3', 'Pump P-101 vibration report').length`, 'card list');
check('unread correspondences are listed',
  (await evalJS(`window.__byText('.card h3', 'Pump P-101').length`)) === 1);
check('an already-assigned one is hidden by the default Unread filter',
  (await evalJS(`window.__byText('.card h3', 'Spare parts shortage').length`)) === 0);
check('the Unread stat counts 2',
  (await evalJS(`window.__byText('.card', 'Unread').map(c => c.textContent.trim())[0]`) || '').startsWith('2'));
check('the team workload panel lists the department, not the whole company',
  (await evalJS(`window.__byText('.card', 'Team Workload')[0].textContent.includes('Mona Fouad')`)) === false);

console.log('\n[2] opening a correspondence');
await clickEl(`window.__one('.card', 'Pump P-101 vibration report')`, 'c1 card');
await waitFor(`window.__one('h2', 'Pump P-101 vibration report')`, 'detail modal');
await shot('1-modal');
check('the modal shows the correspondence body',
  await evalJS(`document.body.textContent.includes('Vendor reports high vibration')`));
check('an unconverted one offers "Assign as Task", not "Reassign"',
  (await evalJS(`!!window.__one('button', 'Assign as Task…') && !window.__one('button', 'Reassign Task')`)));
check('it explains that the full form follows',
  await evalJS(`document.body.textContent.includes('Continue to the full task form')`));
check('the cut-down reassign fields are NOT offered',
  (await evalJS(`!window.__byText('label', 'Assign to Employee').length`)));

console.log('\n[3] the manager note, then the panel');
await typeInto(`document.querySelector('textarea')`, 'Check the alignment first.', 'manager note');
await clickEl(`window.__one('button', 'Assign as Task…')`, 'Assign as Task');
await waitFor(`window.__panel()`, 'create-task panel');
await sleep(500); // spring settle

await shot('2-panel');
const panelTop = await evalJS(`(() => {
  ${HELPERS}
  const btn = window.__one('button', 'Create Task');
  const b = window.__box(btn);
  const hit = document.elementFromPoint(b.x, b.y);
  return btn.contains(hit) || hit === btn;
})()`);
check('the panel sits ABOVE the correspondence modal (real hit test)', panelTop === true);

// Everything is read from INSIDE the slide-over, never from the inbox behind it.
const draft = () => evalJS(`(() => {
  ${HELPERS}
  const root = window.__panelRoot();
  const sel = root.querySelector('select[class="input"], select');
  const assignee = [...root.querySelectorAll('select')].pop();
  return {
    taskName: window.__panel().value,
    description: root.querySelector('textarea').value,
    priority: sel.value,
    dueDate: root.querySelector('input[type="date"]').value,
    assignee: assignee.value,
    assigneeLabel: assignee.options[assignee.selectedIndex].text,
    assigneeOptions: [...assignee.options].map(o => o.text).join(' | '),
    source: root.textContent.includes('Source correspondence'),
    category: window.__labelled(root, 'Category'),
    department: window.__labelled(root, 'Department'),
    sub: window.__labelled(root, 'Sub-Category'),
  };
})()`);
const d = await draft();
check('task name is prefilled from the subject', d.taskName === 'Pump P-101 vibration report', d.taskName);
check('description carries the correspondence body', d.description.includes('Vendor reports high vibration'));
check('description carries the manager note', d.description.includes('Manager note: Check the alignment first.'), d.description);
check('priority is inherited', d.priority === 'High', d.priority);
check('due date is inherited from the deadline', d.dueDate === '2026-09-30', d.dueDate);
check('the header names the source', d.source === true);
check('assignee defaults to the manager when the correspondence has none',
  d.assigneeLabel.startsWith('Tariq Salama'), d.assigneeLabel);
check('the assignee select only offers the manager\'s own department',
  !d.assigneeOptions.includes('Mona Fouad'), d.assigneeOptions);

check('classification: category prefilled', d.category === 'Project', String(d.category));
check('classification: department prefilled', d.department === 'Maintenance Planning', String(d.department));
check('classification: sub-category prefilled', d.sub === 'Refinery Upgrade', String(d.sub));
check('the attachment carried over',
  await evalJS(`document.body.textContent.includes('vibration.pdf')`));

console.log('\n[4] choosing an assignee and collaborators, then creating');
await setSelect(`[...document.querySelectorAll('select')].pop()`, 'u-emp1', 'assignee');
await clickEl(`window.__one('button', 'Ahmed Salem')`, 'collaborator chip');
check('the collaborator count is shown',
  await evalJS(`document.body.textContent.includes('1 collaborator')`));

await shot('3-filled');
const before = (await writes()).length;
await clickEl(`window.__one('button', 'Create Task')`, 'Create Task');
await waitFor(`window.__writes.length > ${before} && !window.__panel()`, 'task written + panel closed', 8000);
await sleep(400);

const tasks = (await allOf('tasks')).filter(t => t.id !== '--stats--' && t.id !== 'task-existing');
check('exactly one task was created', tasks.length === 1, String(tasks.length));
const task = tasks[0] || {};
check('serial came from the real counter (7 -> TK000008)', task.serialNumber === 'TK000008', task.serialNumber);
check('task name is the subject', task.taskName === 'Pump P-101 vibration report');
check('assignee is the one picked IN THE PANEL', task.assignedToId === 'u-emp1' && task.assignedTo === 'Nevin Anwar', JSON.stringify([task.assignedToId, task.assignedTo]));
check('collaborators are written (the whole point of the change)',
  JSON.stringify(task.collaboratorIds) === '["u-emp2"]' && JSON.stringify(task.collaborators) === '["Ahmed Salem"]',
  JSON.stringify([task.collaboratorIds, task.collaborators]));
check('privacy toggle default is public', task.isPrivate === false);
check('classification is written', task.category === 'Project' && task.department === 'Maintenance Planning' && task.subCategory === 'Refinery Upgrade');
check('file paths carried over', Array.isArray(task.filePaths) && task.filePaths.length === 1, JSON.stringify(task.filePaths));
check('attachment carried over', task.attachedFileName === 'vibration.pdf');
check('traceability link back to the correspondence', task.correspondingId === 'c1' && task.correspondingSerialNumber === 'CR000041');
check('extraFields set statusUpdate + notes', task.statusUpdate === 'Not Started' && JSON.stringify(task.notes) === '[]');
check('userId is set (extraFields fills the panel\'s own gap)', task.userId === 'u-mgr', String(task.userId));
check('assignedBy is the manager', task.assignedById === 'u-mgr');
check('teamId is written', task.teamId === 'T1', String(task.teamId));
check('due date is written', task.dueDate === '2026-09-30');

const c1 = await docOf('correspondences', 'c1');
check('correspondence is marked Assigned', c1.status === 'Assigned', c1.status);
check('correspondence links to the new task', c1.convertedToTaskId === task.id, String(c1.convertedToTaskId));
check('correspondence mirrors the assignee CHOSEN IN THE PANEL, not the prefill',
  c1.assignedToId === 'u-emp1' && c1.assignedTo === 'Nevin Anwar', JSON.stringify([c1.assignedToId, c1.assignedTo]));
check('the manager note is saved on the correspondence', c1.notes === 'Check the alignment first.', String(c1.notes));
// Read the sentinel off the write itself — by the time it lands in a doc,
// Firestore (and this fake) has already resolved it to a Timestamp.
const c1Write = (await writes()).filter(w => w.path === 'correspondences/c1').pop() || { data: {} };
check('assignedAt is written as serverTimestamp()', !!(c1Write.data.assignedAt || {}).__serverTimestamp);
check('updatedAt is bumped too', !!(c1Write.data.updatedAt || {}).__serverTimestamp);

const notes = await allOf('notifications');
const byUser = id => notes.filter(n => n.forUserId === id);
check('the assignee is notified once', byUser('u-emp1').length === 1, String(byUser('u-emp1').length));
check('the collaborator is notified once', byUser('u-emp2').length === 1, String(byUser('u-emp2').length));
check('the collaborator notification says so', (byUser('u-emp2')[0] || {}).title === 'Added as Collaborator');
check('managers are notified, the actor is not',
  byUser('u-adm').length === 1 && byUser('u-mgr').length === 0,
  JSON.stringify([byUser('u-adm').length, byUser('u-mgr').length]));
check('notifications carry the task detail block',
  (byUser('u-emp1')[0] || {}).message.includes('TK000008'), (byUser('u-emp1')[0] || {}).message);
check('notifications deep-link to the task', (byUser('u-emp1')[0] || {}).relatedId === task.id);

const pushes = await evalJS('JSON.stringify(window.__pushes)').then(JSON.parse);
check('the assignee\'s FCM token was pushed to',
  pushes.some(p => p.body.action === 'fcm' && p.body.token === 'FCM-NEVIN'), JSON.stringify(pushes.map(p => p.body.action)));
check('the collaborator\'s Telegram chat was pushed to',
  pushes.some(p => p.body.action === 'telegram' && p.body.chatId === '5551'));
check('pushes carry a deep link',
  pushes.every(p => typeof p.body.url === 'string' && p.body.url.includes('#/tasks?open=')), JSON.stringify(pushes.map(p => p.body.url)));

check('the correspondence modal closed after conversion',
  (await evalJS(`!window.__one('h2', 'Pump P-101 vibration report')`)));
check('the converted item left the Unread list',
  (await evalJS(`window.__byText('.card h3', 'Pump P-101').length`)) === 0);

console.log('\n[5] the prefill must not seed an assignee the panel cannot show');
await clickEl(`window.__one('.card', 'Annual insurance renewal')`, 'c2 card');
await waitFor(`window.__one('h2', 'Annual insurance renewal')`, 'c2 modal');
await clickEl(`window.__one('button', 'Assign as Task…')`, 'Assign as Task (c2)');
await waitFor(`window.__panel()`, 'panel for c2');
await sleep(400);
const d2 = await draft();
check('an out-of-department assignee is not prefilled', d2.assignee !== 'u-out', d2.assignee);
check('the select shows the name it would actually save',
  d2.assigneeLabel.startsWith('Tariq Salama'), d2.assigneeLabel);
check('a correspondence with no deadline leaves the due date empty', d2.dueDate === '', String(d2.dueDate));
check('no manager note means no "Manager note:" in the description',
  !d2.description.includes('Manager note:'), d2.description);
// Scoped to the slide-over: the modal underneath has a Cancel button too, and
// the hit test correctly refuses to click through the panel's backdrop.
await clickEl(`window.__byText('button', 'Cancel', window.__panelRoot())[0]`, 'cancel panel');
await sleep(400);
check('cancelling the panel closes it', (await evalJS(`!window.__panel()`)));
check('cancelling the panel leaves the correspondence untouched',
  (await docOf('correspondences', 'c2')).status === 'Unread');
check('the correspondence modal is still open behind it',
  (await evalJS(`!!window.__one('h2', 'Annual insurance renewal')`)));
await clickEl(`window.__one('button', 'Cancel')`, 'close modal');
await sleep(300);
check('closing the modal clears the manager note for the next item',
  (await evalJS(`!window.__one('h2', 'Annual insurance renewal')`)));

console.log('\n[6] an already-converted correspondence reassigns in place');
await setSelect(`document.querySelector('select.input')`, 'Assigned', 'status filter');
await waitFor(`window.__byText('.card h3', 'Spare parts shortage').length`, 'assigned list');
await clickEl(`window.__one('.card', 'Spare parts shortage')`, 'c3 card');
await waitFor(`window.__one('h2', 'Spare parts shortage')`, 'c3 modal');
await shot('4-reassign');
check('it offers "Reassign Task", not the full form',
  (await evalJS(`!!window.__one('button', 'Reassign Task') && !window.__one('button', 'Assign as Task…')`)));
check('the create-task panel is NOT mounted for a converted correspondence',
  (await evalJS(`!window.__panel()`)));
check('the cut-down assignee + due-date fields are back',
  (await evalJS(`window.__byText('label', 'Assign to Employee').length === 1 && !!document.querySelector('input[type="date"]')`)));

const beforeReassign = (await writes()).length;
await setSelect(`window.__one('label', 'Assign to Employee').parentElement.querySelector('select')`, 'u-emp2', 'reassign to');
await clickEl(`window.__one('button', 'Reassign Task')`, 'Reassign Task');
await waitFor(`window.__writes.length >= ${beforeReassign + 2}`, 'reassign writes', 8000);
await sleep(400);

const t2 = await docOf('tasks', 'task-existing');
const c3 = await docOf('correspondences', 'c3');
check('the existing task is repointed', t2.assignedToId === 'u-emp2' && t2.assignedTo === 'Ahmed Salem', JSON.stringify([t2.assignedToId, t2.assignedTo]));
check('no second task was created',
  (await allOf('tasks')).filter(t => t.id !== '--stats--').length === 2);
check('the correspondence follows the reassignment', c3.assignedToId === 'u-emp2', String(c3.assignedToId));
check('it keeps its original task link', c3.convertedToTaskId === 'task-existing');
const reassignNotes = (await allOf('notifications')).filter(n => n.title === 'Task Reassigned');
check('the new assignee and the managers are told', reassignNotes.length === 2, String(reassignNotes.length));
check('the new assignee gets the direct one',
  reassignNotes.some(n => n.forUserId === 'u-emp2' && n.message.includes('reassigned to you')));

console.log('\n[7] layout sanity at the real width');
const overflow = await evalJS(`(() => {
  ${HELPERS}
  return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`);
check('no horizontal overflow at 1440px', overflow.doc <= 0, String(overflow.doc));
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
await sleep(400);
await shot('5-mobile');
const narrow = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('no horizontal overflow at 390px', narrow <= 0, String(narrow));

// `.card { word-break: break-word }` will happily split "EGPC" into "EGP / C"
// once the meta row is squeezed. A wrapped text node reports more than one
// client rect, which is the only way to see this without looking at a picture.
const split = await evalJS(`(() => {
  const bad = [];
  for (const card of document.querySelectorAll('.card')) {
    const walk = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      const t = n.textContent.trim();
      if (!t || t.includes(' ')) continue;          // single words only
      const r = document.createRange(); r.selectNodeContents(n);
      if (r.getClientRects().length > 1) bad.push(t);
    }
  }
  return bad;
})()`);
check('no single word is broken across lines on a phone', split.length === 0, split.join(', '));
await send('Emulation.clearDeviceMetricsOverride');
await sleep(200);

console.log('\n[8] the serial-counter doc must not leak into the list');
// Every other correspondences listener in the app filters the `--stats--` doc
// that counters.ts keeps in the same collection. An Admin under "All" is the
// one view where a missing filter shows up.
await setSelect(`document.querySelector('select.input')`, 'All', 'status filter -> All');
await sleep(400);
const blanks = () => evalJS(`[...document.querySelectorAll('.card h3')].filter(h => !h.textContent.trim()).length`);
check('manager view is clean under the All filter', (await blanks()) === 0);

await evalJS(`window.__renderAs('Admin')`);
await sleep(500);
await setSelect(`document.querySelector('select.input')`, 'All', 'status filter -> All (admin)');
await sleep(400);
const adminBlanks = await blanks();
check('the "--stats--" counter doc does not render as an empty card for an Admin',
  adminBlanks === 0, `${adminBlanks} blank card(s)`);
check('the Admin sees the three real correspondences and nothing else',
  (await evalJS(`document.querySelectorAll('.card h3').length`)) === 3,
  String(await evalJS(`document.querySelectorAll('.card h3').length`)));

check('no uncaught page errors or console.errors during the whole run',
  pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    const diag = await evalJS(`JSON.stringify({
      errors: window.__errors || [],
      scrollY: window.scrollY,
      cards: [...document.querySelectorAll('.card h3')].map(h => h.textContent),
      text: document.body.innerText.slice(0, 400),
    })`).then(JSON.parse);
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600) || JSON.stringify(diag.errors));
    console.log('  scrollY     :', diag.scrollY);
    console.log('  cards       :', JSON.stringify(diag.cards));
    console.log('  body text   :', diag.text.replace(/\n+/g, ' | ').slice(0, 300));
  } catch { /* best effort */ }
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/inboxconvert-failure.png');
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
    console.log(`  screenshot: ${p}`);
  } catch { /* best effort */ }
}

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
try { ws.close(); } catch {}
edge.kill();
await sleep(300);
try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
