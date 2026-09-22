// Click-through harness for the Clients page (queue task D1).
//
// clientfile.mjs proves the logic (src/lib/clientFile.ts) in node. This proves
// the SCREEN: the real ClientsDashboard reading the boards through the real
// onSnapshot + subscribeVisibleTasks, the client list, one client's file, rows
// opening their records, the Outlook section (helper running AND not running),
// Arabic + RTL and 390 px.
//
// Real code under test:  src/ClientsDashboard.tsx, src/lib/clientFile.ts,
//                        src/lib/outlookBridge.ts, src/lib/taskVisibility.ts,
//                        src/lib/deepLink.ts, src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts, window.fetch (the Outlook helper).
//
//   node scripts/harness/clientui.mjs   (--headed to watch it, --shot to write PNGs)

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-clientui-'));

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
import ClientsDashboard from './src/ClientsDashboard';
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

__seed('projects', 'p1', { name: 'Meleiha O&M', client: 'AGIBA', status: 'Active', serialNumber: 'PR000003', userId: 'u-mgr',
  lastUpdateText: 'Mobilisation on track', lastUpdateAt: ts(-3), createdAt: ts(-90),
  checklist: [
    { id: 's1', title: 'Performance bond submitted', dueDate: dayOffset(-2), done: false },
    { id: 's2', title: 'Kick-off meeting with the client', dueDate: dayOffset(5), done: false },
  ] });
__seed('projects', 'p2', { name: 'Old tank job', client: 'Agiba Co.', status: 'Completed', serialNumber: 'PR000004', userId: 'u-mgr', createdAt: ts(-400) });
__seed('projects', 'p3', { name: 'Terminal study', client: 'APC', status: 'Active', serialNumber: 'PR000005', userId: 'u-mgr', createdAt: ts(-40) });
__seed('projectContracts', 'k1', { projectId: 'p1', contractNumber: '4600001234', subject: 'O&M services', contractValue: 1000000, currency: 'EGP', endDate: dayOffset(20), status: 'Running', inCharge: 'Mona Fathy' });
__seed('projectContracts', 'k2', { projectId: 'p1', contractNumber: 'WA-1', subject: 'Work authorization 1', contractValue: 40000, currency: 'USD', endDate: dayOffset(-10), status: 'Running' });
__seed('projectContracts', 'k3', { projectId: 'p3', contractNumber: 'APC-1', subject: 'APC contract', endDate: dayOffset(10) });
__seed('projectUpdates', 'u1', { projectId: 'p1', text: 'Mobilisation on track', authorName: 'Ahmed Samir', authorId: 'u-ahmed', createdAt: ts(-3) });
__seed('opportunities', 'o1', { title: 'Meleiha compressor overhaul', client: 'AGIBA', stage: 'Bid Preparation', serialNumber: 'OP000011',
  submissionDeadline: dayOffset(4), ownerId: 'u-mona', ownerName: 'Mona Fathy', userId: 'u-mgr', createdAt: ts(-30),
  checklist: [{ id: 'c1', title: 'Bid bond requested', dueDate: dayOffset(-1), done: false }] });
__seed('opportunities', 'o2', { title: 'Gas plant revamp', client: 'agiba', stage: 'Submitted', serialNumber: 'OP000012', submissionDeadline: dayOffset(-5), ownerName: 'Ahmed Samir', userId: 'u-mgr', createdAt: ts(-60) });
__seed('opportunities', 'o3', { title: 'Pipeline 2025', client: 'AGIBA', stage: 'Won', decisionDate: dayOffset(-100), serialNumber: 'OP000013', userId: 'u-mgr', createdAt: ts(-200) });
__seed('opportunities', 'o4', { title: 'APC jetty', client: 'APC', stage: 'Identified', submissionDeadline: dayOffset(30), serialNumber: 'OP000014', userId: 'u-mgr', createdAt: ts(-2) });
__seed('opportunityFollowUps', 'f1', { opportunityId: 'o1', text: 'Called their planning manager', authorName: 'Mona Fathy', authorId: 'u-mona', createdAt: ts(-1) });
__seed('correspondences', 'l1', { subject: 'Request for clarification', sentFrom: 'AGIBA Petroleum Co.', status: 'Assigned', assignedTo: 'Mona Fathy', assignedToId: 'u-mona',
  dateReceived: dayOffset(-2), deadline: dayOffset(1), userId: 'u-mgr', teamId: 'T1', serialNumber: 'CR000101' });
__seed('correspondences', 'l2', { subject: 'خطاب بخصوص المستخلص', sentFrom: 'شركة AGIBA للبترول', status: 'Closed', dateReceived: dayOffset(-8), userId: 'u-mgr', teamId: 'T1', serialNumber: 'CR000102' });
__seed('correspondences', 'l3', { subject: 'CAPCO offer', sentFrom: 'CAPCO', status: 'Unread', dateReceived: dayOffset(-1), userId: 'u-mgr', teamId: 'T1', serialNumber: 'CR000103' });
__seed('tasks', 't1', { taskName: 'Prepare pricing', status: 'In Progress', isPrivate: false, opportunityId: 'o1', opportunityTitle: 'Meleiha compressor overhaul',
  assignedToId: 'u-ahmed', assignedTo: 'Ahmed Samir', dueDate: dayOffset(3), userId: 'u-mgr', teamId: 'T1', serialNumber: 'TK000201', createdAt: ts(-5) });
__seed('tasks', 't2', { taskName: 'Answer clarification', status: 'Pending', isPrivate: false, correspondingId: 'l1',
  assignedToId: 'u-mona', assignedTo: 'Mona Fathy', dueDate: dayOffset(-1), userId: 'u-mgr', teamId: 'T1', serialNumber: 'TK000202', createdAt: ts(-2) });
// Somebody else's PRIVATE task on the same bid: the page must never show it.
__seed('tasks', 't3', { taskName: 'Private AGIBA note', status: 'Pending', isPrivate: true, opportunityId: 'o1',
  assignedToId: 'u-ahmed', userId: 'u-ahmed', teamId: 'T1', serialNumber: 'TK000203', createdAt: ts(-1) });

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@eprom.com.eg' };
window.__nav = [];
window.__open = t => consumePending(t);

// The Outlook helper on localhost: running unless the test turns it off.
window.__bridgeOn = true;
window.__bridgeCalls = [];
const MAIL = [
  { id: 'm1', subject: 'RE: compressor overhaul', sender: 'Hassan (AGIBA)', to: '', direction: 'received', folder: 'Inbox', received_at: new Date(now.getTime() - 2 * 3600e3).toISOString() },
  { id: 'm2', subject: 'Offer clarification', sender: 'Tariq', to: 'AGIBA Tenders', direction: 'sent', folder: 'Sent Items', received_at: new Date(now.getTime() - 26 * 3600e3).toISOString() },
  { id: 'm3', subject: 'Lunch', sender: 'Friend', to: 'Tariq', direction: 'received', folder: 'Inbox', received_at: new Date(now.getTime() - 1 * 3600e3).toISOString() },
];
window.fetch = async (url) => {
  const u = new URL(String(url));
  window.__bridgeCalls.push(u.pathname + u.search);
  if (!window.__bridgeOn) throw new TypeError('Failed to fetch');
  if (u.pathname === '/status') return { ok: true, json: async () => ({ running: true, outlook_connected: true }) };
  if (u.pathname === '/emails') {
    const folder = u.searchParams.get('folder');
    const q = (u.searchParams.get('search') || '').toLowerCase();
    const rows = MAIL.filter(m => m.folder === folder && (!q || [m.subject, m.sender, m.to].some(f => f.toLowerCase().includes(q))));
    return { ok: true, json: async () => rows };
  }
  return { ok: false, json: async () => ({}) };
};

const root = createRoot(document.getElementById('root'));
root.render(
  React.createElement('div', { className: 'app-main' },
    React.createElement(ClientsDashboard, { user, appUser: USERS[0], projectUsers: USERS, onNavigate: v => { window.__nav.push(v); } }),
  ),
);

window.__type = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'clientuiEntry.tsx', loader: 'tsx' },
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
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/clients',
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
  const p = path.join(ROOT, `scripts/harness/clientui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const texts = sel => evalJS(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(sel)})].map(window.__txt))`).then(JSON.parse);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const openClient = async name => {
  await clickEl(`[...document.querySelectorAll('[data-clients="card"]')].find(b => window.__txt(b).startsWith(${JSON.stringify(name)}))`, `the ${name} card`);
  await waitFor(q('[data-clients="file"]'), 'the client file');
  await sleep(400);
};

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] the client list');
await waitFor(q('[data-clients="card"]'), 'client cards');
let cards = await texts('[data-clients="card"]');
await shot('1-list');
check('two clients — AGIBA and APC; CAPCO (a letter sender only) is not a client', cards.length === 2, JSON.stringify(cards));
check('AGIBA first (newest activity)', cards[0].startsWith('AGIBA'), cards[0]);
check('AGIBA card counts its open bids (both spellings merged)', cards[0].includes('Open bids: 2'), cards[0]);
check('AGIBA card counts both letters (English + Arabic sender)', cards[0].includes('Letters: 2'), cards[0]);
check('APC card: its bid, not CAPCO’s letter', cards[1].includes('Open bids: 1') && !cards[1].includes('Letters'), cards[1]);
check('the Outlook helper is not called for the list', (await evalJS(`window.__bridgeCalls.length`)) === 0);
await evalJS(`window.__type(${q('input[type="search"]')}, 'apc')`);
await sleep(200);
cards = await texts('[data-clients="card"]');
check('search narrows the list', cards.length === 1 && cards[0].startsWith('APC'), JSON.stringify(cards));
await evalJS(`window.__type(${q('input[type="search"]')}, '')`);
await sleep(200);

console.log('\n[2] one client’s file');
await openClient('AGIBA');
check('the address carries the client', (await evalJS(`location.hash`)) === '#/clients?c=agiba', await evalJS(`location.hash`));
const header = await text('[data-clients="file"] .card');
check('header names the client', header.includes('AGIBA'));
check('the other spellings are shown', header.includes('Also written as') && header.includes('Agiba Co.'), header.slice(0, 200));
const owed = await texts('[data-clients="owed"]');
check('owed: the open letter from them', owed.some(r => r.includes('Request for clarification')), JSON.stringify(owed));
check('owed: the task made from their letter', owed.some(r => r.includes('Answer clarification')));
check('owed: the task on their bid', owed.some(r => r.includes('Prepare pricing')));
check('owed: the bid still to submit', owed.some(r => r.includes('Meleiha compressor overhaul') && r.includes('Bid to submit')));
check('owed: the late bid step', owed.some(r => r.includes('Bid bond requested')));
check('owed: the late project step', owed.some(r => r.includes('Performance bond submitted')));
check('owed: NOT the submitted bid', !owed.some(r => r.includes('Gas plant revamp')));
check('owed: NOT the closed Arabic letter', !owed.some(r => r.includes('المستخلص')));
check('somebody else’s private task never shows', !(await evalJS(`document.body.textContent.includes('Private AGIBA note')`)));
check('late items lead, "2 days late" first', owed[0].includes('2 days late'), owed[0]);
check('a late count shows in the header', header.includes('Overdue: 3'), header);

console.log('\n[3] who spoke to them');
await waitFor(`window.__txt(${q('[data-clients="section-mails"]')}).includes('RE: compressor')`, 'the Outlook mails', 8000);
const last = await text('[data-clients="last-contact"]');
check('last contact = the e-mail 2 hours ago, from their person', last.includes('Hassan (AGIBA)') && last.includes('2h ago'), last);
const contacts = await texts('[data-clients="contact"]');
check('the bid follow-up is in the timeline, with its author', contacts.some(r => r.includes('Called their planning manager') && r.includes('Mona Fathy')), JSON.stringify(contacts));
check('our sent mail is in the timeline', contacts.some(r => r.includes('Offer clarification') && r.includes('You')));
const people = await texts('[data-clients="person"]');
check('Mona leads "our people"', people[0]?.startsWith('Mona Fathy'), JSON.stringify(people));
const mails = await texts('[data-clients="mail"]');
check('Outlook: both mails naming AGIBA, not the lunch one', mails.length === 2 && !mails.some(m => m.includes('Lunch')), JSON.stringify(mails));
check('the helper was searched by the client name', (await evalJS(`window.__bridgeCalls.filter(c => c.includes('search=AGIBA')).length`)) === 2);

console.log('\n[4] bids, projects, contracts, letters');
const bids = await texts('[data-clients="bid"]');
check('open bids: both, the submitted one first (earlier deadline)', bids.length === 2 && bids[0].includes('Gas plant revamp'), JSON.stringify(bids));
check('our record line', (await text('[data-clients="record"]')).includes('Won 1'));
const contracts = await texts('[data-clients="contract"]');
check('contracts: both AGIBA ones, not APC’s', contracts.length === 2 && !contracts.some(c => c.includes('APC-1')), JSON.stringify(contracts));
check('the running-out contract leads with "Ends in 20 days"', contracts[0].includes('4600001234') && contracts[0].includes('Ends 20 days from now'), contracts[0]);
check('the ended contract says so', contracts[1].includes('Ended'), contracts[1]);
check('contract value in its currency', contracts[0].includes('1,000,000 EGP'), contracts[0]);
const letters = await texts('[data-clients="letter"]');
check('letters: both AGIBA letters, newest first', letters.length === 2 && letters[0].includes('Request for clarification'), JSON.stringify(letters));
await shot('2-file');

console.log('\n[5] rows open their records');
await clickEl(`[...document.querySelectorAll('[data-clients="owed"] button')].find(b => window.__txt(b).includes('Answer clarification'))`, 'the task row');
check('task row → Tasks board', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'tasks');
check('…with the task queued to open', (await evalJS(`window.__open('task')`)) === 't2');
await clickEl(`[...document.querySelectorAll('[data-clients="project"] button')].find(b => window.__txt(b).includes('Meleiha O&M'))`, 'the project row');
check('project row → Projects board', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'projects');
check('…with the project queued to open', (await evalJS(`window.__open('project')`)) === 'p1');
await clickEl(`[...document.querySelectorAll('[data-clients="letter"] button')].find(b => window.__txt(b).includes('Request for clarification'))`, 'the letter row');
check('letter row → the letter', (await evalJS(`window.__open('corresponding')`)) === 'l1');

console.log('\n[6] back to the list, then a client with the helper switched off');
await clickEl(`[...document.querySelectorAll('button')].find(b => window.__txt(b) === 'All clients')`, 'All clients');
await waitFor(q('[data-clients="list"]'), 'the list again');
check('the address is back to the list', (await evalJS(`location.hash`)) === '#/clients');
await evalJS(`window.__bridgeOn = false`);
await openClient('APC');
await waitFor(`window.__txt(${q('[data-clients="section-mails"]')}).includes('not running')`, 'the helper-off message', 6000);
check('helper off: a plain message, no error', (await text('[data-clients="section-mails"]')).includes('only letters logged in ETaske'));
check('APC: its bid still to submit is owed', (await texts('[data-clients="owed"]')).some(r => r.includes('APC jetty')));
check('APC: its contract flagged, AGIBA’s not here', (await texts('[data-clients="contract"]')).length === 1);

console.log('\n[7] a link straight to a client (the Client file link on a project page)');
await evalJS(`location.hash = '#/clients?c=' + encodeURIComponent('Agiba Co.')`);
await waitFor(`window.__txt(${q('[data-clients="file"] h1')}) === 'AGIBA'`, 'AGIBA opened by its other spelling');
check('"Agiba Co." opens the AGIBA file', true);
await evalJS(`location.hash = '#/clients?c=nobody'`);
await waitFor(q('[data-clients="list"]'), 'unknown client falls back to the list');
check('an unknown client shows the list with a note', (await evalJS(`document.body.textContent.includes('No project or bid names that client')`)));

console.log('\n[8] Arabic + RTL, and 390 px');
await evalJS(`window.__bridgeOn = true`);
await evalJS(`location.hash = '#/clients?c=agiba'`);
await waitFor(q('[data-clients="file"]'), 'AGIBA again');
await evalJS(`window.__setLang('ar')`);
await sleep(700);
const arBody = await evalJS(`document.body.textContent`);
check('page is RTL', (await evalJS(`document.documentElement.dir`)) === 'rtl');
check('Arabic section title', arBody.includes('المطلوب منا للعميل'));
check('Arabic late wording with agreement ("متأخر يومين")', arBody.includes('متأخر يومين'));
check('no Arabic-Indic digits', !/[٠-٩]/.test(arBody));
check('no English section titles left', !arBody.includes('What we owe them') && !arBody.includes('Last contact'));
await shot('3-ar');
check('no horizontal overflow at 1440 (RTL)', (await overflow()) <= 0);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(500);
check('no horizontal overflow at 390px (RTL)', (await overflow()) <= 0, String(await overflow()));
await shot('4-ar-mobile');
await evalJS(`window.__setLang('en')`);
await sleep(400);
check('no horizontal overflow at 390px (LTR)', (await overflow()) <= 0);
await shot('5-en-mobile');
await send('Emulation.clearDeviceMetricsOverride');

check('nothing was written to Firestore', (await evalJS(`window.__writes.length`)) === 0);
check('no uncaught page errors or console.errors during the whole run', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 600)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/clientui-failure.png');
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
