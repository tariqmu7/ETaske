// Click-through harness for "create a task FROM an opportunity" (queue task 3).
//
// Why this exists: task 2 proved src/lib/recordLinks.ts writes the right
// documents (recordlinks.mjs). This proves the UI actually CALLS it — a real
// browser, real components, real hit-tested clicks, and then the documents the
// fake Firestore recorded are read back and asserted.
//
// Real code under test:  src/OpportunityDetail.tsx,
//                        src/components/opportunities/OpportunityTasksTab.tsx,
//                        src/components/CreateTaskPanel.tsx, src/lib/recordLinks.ts,
//                        src/lib/taskVisibility.ts, src/lib/counters.ts,
//                        src/lib/deepLink.ts, src/lib/format.ts, src/i18n.ts
//                        + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts, window.fetch (the push proxy).
//
//   node scripts/harness/bidtask.mjs           (add --headed to watch it,
//                                               --shot to write PNGs)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-bidtask-'));

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

// ── The page entry: seed the store, mount the REAL OpportunityDetail ─────────
const ENTRY = /* tsx */ `
import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/i18n';
import OpportunityDetail from './src/OpportunityDetail';
import { consumePending } from './src/lib/deepLink';
import i18n, { applyLanguageToDocument } from './src/i18n';

const T0 = Math.floor(new Date('2026-08-01T08:00:00Z').getTime() / 1000);
const ts = s => ({ seconds: T0 + s, toDate: () => new Date((T0 + s) * 1000) });
// Dates are relative to the run so the "overdue" / "not overdue" assertions
// cannot rot into the past.
const iso = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
window.__future = iso(21);
window.__past = iso(-5);

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@x.com', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Business Development', userColor: '#3b82f6' },
  { id: 'u-emp1', displayName: 'Nevin Anwar',  email: 'n@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
  { id: 'u-out',  displayName: 'Mona Fouad',   email: 'm@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T9', department: 'Finance' },
];

const OPEN_BID = {
  id: 'op1', title: 'Zohr tie-in maintenance contract', serialNumber: 'OP000012',
  client: 'EGPC', sector: 'Upstream', stage: 'Bidding', source: 'Public Tender',
  estimatedValue: 12500000, currency: 'EGP', probability: 40,
  submissionDeadline: window.__future, nextActionDate: '2026-09-01',
  ownerId: 'u-mgr', ownerName: 'Tariq Salama',
  lastFollowUpText: 'Clarification issued to the client.', lastFollowUpAt: ts(100),
  createdAt: ts(10), updatedAt: ts(100),
};
// A bid whose deadline has already passed — prefilling it as a due date would
// create a task that is overdue the moment it is saved.
const LATE_BID = { ...OPEN_BID, id: 'op2', title: 'Suez tank farm O&M', serialNumber: 'OP000013', submissionDeadline: window.__past };

__seed('opportunities', 'op1', { ...OPEN_BID });
__seed('opportunities', 'op2', { ...LATE_BID });
__seed('tasks', '--stats--', { value: 7 });

// Linked, open, and overdue.
__seed('tasks', 't-open', {
  taskName: 'Prepare technical proposal', description: '', status: 'Pending', priority: 'High',
  serialNumber: 'TK000005', assignedTo: 'Nevin Anwar', assignedToId: 'u-emp1',
  isPrivate: false, collaboratorIds: [], dueDate: window.__past,
  opportunityId: 'op1', opportunitySerial: 'OP000012', opportunityTitle: OPEN_BID.title,
  createdAt: ts(20), updatedAt: ts(20),
});
// Linked and finished — must sort below the open one and not count as open.
__seed('tasks', 't-done', {
  taskName: 'Collect the tender documents', description: '', status: 'Done', priority: 'Medium',
  serialNumber: 'TK000006', assignedTo: 'Tariq Salama', assignedToId: 'u-mgr',
  isPrivate: false, collaboratorIds: [], dueDate: window.__past,
  opportunityId: 'op1', opportunitySerial: 'OP000012', opportunityTitle: OPEN_BID.title,
  createdAt: ts(21), updatedAt: ts(21),
});
// Linked to a DIFFERENT bid — must never appear on op1.
__seed('tasks', 't-other', {
  taskName: 'Suez site visit', description: '', status: 'Pending', priority: 'Low',
  serialNumber: 'TK000004', assignedTo: 'Nevin Anwar', assignedToId: 'u-emp1',
  isPrivate: false, collaboratorIds: [], opportunityId: 'op2',
  createdAt: ts(22), updatedAt: ts(22),
});
// Somebody else's PRIVATE task on this bid: the rules would never return it, so
// neither may the tab.
__seed('tasks', 't-private', {
  taskName: 'Confidential pricing strategy', description: '', status: 'Pending', priority: 'High',
  serialNumber: 'TK000003', assignedTo: 'Mona Fouad', assignedToId: 'u-out',
  isPrivate: true, collaboratorIds: [], opportunityId: 'op1',
  createdAt: ts(23), updatedAt: ts(23),
});
// Unlinked work — the tab is not a task list, it is the LINKED task list.
__seed('tasks', 't-unlinked', {
  taskName: 'Update the org chart', description: '', status: 'Pending', priority: 'Low',
  serialNumber: 'TK000002', assignedTo: 'Tariq Salama', assignedToId: 'u-mgr',
  isPrivate: false, collaboratorIds: [], createdAt: ts(24), updatedAt: ts(24),
});

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@x.com' };
const appUser = USERS[0];

const root = createRoot(document.getElementById('root'));
window.__navigated = null;
const mount = opp => root.render(
  React.createElement('div', { style: { maxWidth: 1280, margin: '0 auto' } },
    React.createElement(OpportunityDetail, {
      opportunity: opp, user, appUser, projectUsers: USERS,
      onBack: () => { window.__navigated = 'back'; },
      onEdit: () => { window.__navigated = 'edit'; },
      onNavigate: v => { window.__navigated = v; },
    }),
  ),
);
window.__mountLate = () => mount(LATE_BID);
window.__mountOpen = () => mount(OPEN_BID);
mount(OPEN_BID);

// The deep-link bus is the real module; expose its consumer so the click
// assertion reads what the tasks dashboard would actually receive.
window.__pending = () => consumePending('task');
// The tab has to survive the mirror, and RTL is where a row of chips and a
// serial number in Arabic prose goes wrong.
// Exactly what hooks/useLanguage.setLanguage does: stamp <html dir> AND flip
// i18next. Stamping is the app's job, not i18next's, so a harness that only
// called changeLanguage would render Arabic text in an LTR document.
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };

window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e =>
  window.__errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));

window.__pushes = [];
window.fetch = async (url, init) => {
  window.__pushes.push({ url: String(url), body: JSON.parse(init.body) });
  return { ok: true, json: async () => ({ status: 'success' }) };
};
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'bidtaskEntry.tsx', loader: 'tsx' },
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

const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  .replace(/@import url\([^)]*\);/g, '')
  .replace(/@tailwind [a-z]+;/g, '');
fs.writeFileSync(path.join(WORK, 'app.css'), css);
fs.writeFileSync(path.join(WORK, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0" />
   <link rel="stylesheet" href="app.css"></head>
   <body><div id="root"></div><script src="bundle.js"></script></body></html>`);

// ── Headless Edge over CDP ───────────────────────────────────────────────────
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('Microsoft Edge not found.'); process.exit(2); }

const PORT = 9611 + (process.pid % 100);
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

const HELPERS = `
window.__vis = el => !!(el && el.offsetParent !== null && el.getClientRects().length);
window.__txt = e => (e.textContent || '').replace(/\\s+/g, ' ').trim();
window.__byText = (sel, text, root) => [...(root || document).querySelectorAll(sel)]
  .filter(e => window.__vis(e) && window.__txt(e).includes(text));
window.__one = (sel, text) => { const m = window.__byText(sel, text); return m.length ? m[0] : null; };
// Exact match: the "Tasks" TAB and the "New task for this bid" button both
// contain the word, so a substring match would click the wrong one.
window.__exact = (sel, text) => [...document.querySelectorAll(sel)]
  .filter(e => window.__vis(e) && window.__txt(e) === text)[0] || null;
window.__box = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; };
window.__panel = () => document.querySelector('input[placeholder="What needs to be done?"]');
window.__panelRoot = () => {
  let e = window.__panel();
  while (e && getComputedStyle(e).position !== 'fixed') e = e.parentElement;
  return e;
};
// The linked-task rows are buttons carrying a serial number.
window.__rows = () => [...document.querySelectorAll('button.card')].filter(window.__vis);
`;
await waitFor(`document.getElementById('root') && document.getElementById('root').children.length`, 'app mount');
await evalJS(HELPERS);

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
async function shot(name) {
  if (!SHOT) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(ROOT, `scripts/harness/bidtask-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const writes = () => evalJS('JSON.stringify(window.__writes)').then(JSON.parse);
const docOf = (c, id) => evalJS(`JSON.stringify(window.__store.get(${JSON.stringify(c)}).get(${JSON.stringify(id)}) || null)`).then(JSON.parse);
const allOf = c => evalJS(`JSON.stringify([...(window.__store.get(${JSON.stringify(c)}) || new Map()).entries()].map(([id,d])=>({id,...d})))`).then(JSON.parse);

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] the Tasks tab exists on the bid');
await waitFor(`window.__one('h1', 'Zohr tie-in')`, 'detail header');
check('the detail page renders the bid', await evalJS(`!!window.__one('h1', 'Zohr tie-in maintenance contract')`));
check('a "Tasks" tab sits in the tab bar', await evalJS(`!!window.__exact('button', 'Tasks')`));
check('the existing tabs are untouched',
  await evalJS(`['Overview','Follow-ups','Milestones','Outcome'].every(l => !!window.__exact('button', l))`));
check('Follow-ups is still the tab that opens first',
  await evalJS(`document.body.textContent.includes('Latest follow-up')`));

console.log('\n[2] it lists exactly the tasks linked to THIS bid');
await clickEl(`window.__exact('button', 'Tasks')`, 'Tasks tab');
await waitFor(`window.__rows().length`, 'linked task rows');
await shot('1-tab');
const rowText = await evalJS(`JSON.stringify(window.__rows().map(window.__txt))`).then(JSON.parse);
check('both linked tasks are listed', rowText.length === 2, JSON.stringify(rowText));
check('a task linked to ANOTHER bid is not listed',
  !rowText.join(' ').includes('Suez site visit'), JSON.stringify(rowText));
check('an UNLINKED task is not listed',
  !rowText.join(' ').includes('Update the org chart'));
check("★ another user's PRIVATE task on this bid is not listed (rules parity)",
  !rowText.join(' ').includes('Confidential pricing strategy'));
check('open work sorts above finished work',
  rowText[0].includes('Prepare technical proposal') && rowText[1].includes('Collect the tender documents'),
  JSON.stringify(rowText));
check('rows carry the task serial', rowText[0].includes('TK000005'));
check('rows carry the status', rowText[1].includes('Done'));
check('an overdue open task is flagged', rowText[0].includes('OVERDUE'));
check('a finished task is NOT flagged overdue', !rowText[1].includes('OVERDUE'));
check('the header counts open vs linked',
  await evalJS(`document.body.textContent.includes('1 open · 2 linked in total')`),
  await evalJS(`(window.__one('.card', 'Work on this bid') || {}).textContent`));
check('the header counts the overdue one',
  await evalJS(`document.body.textContent.includes('1 overdue')`));

console.log('\n[3] clicking a linked task hands it to the tasks dashboard');
await clickEl(`window.__rows()[0]`, 'first linked task');
check('the app was navigated to the tasks view',
  (await evalJS(`window.__navigated`)) === 'tasks', String(await evalJS(`window.__navigated`)));
check('★ the deep-link bus carries the task id the dashboard will open',
  (await evalJS(`window.__pending()`)) === 't-open');

console.log('\n[4] creating a task FROM the bid');
await clickEl(`window.__one('button', 'New task for this bid')`, 'New task for this bid');
await waitFor(`window.__panel()`, 'create-task panel');
await sleep(500); // spring settle
await shot('2-panel');
const seeded = await evalJS(`(() => {
  ${HELPERS}
  const root = window.__panelRoot();
  return {
    name: window.__panel().value,
    due: root.querySelector('input[type="date"]').value,
    strip: window.__txt(root).includes('Linked opportunity') && window.__txt(root).includes('Zohr tie-in maintenance contract'),
    header: window.__txt(root).includes('Linked to OP000012'),
  };
})()`);
const future = await evalJS('window.__future');
check('the task name is left EMPTY — nothing about the bid is copied into it',
  seeded.name === '', seeded.name);
check('the due date is seeded from the submission deadline', seeded.due === future, `${seeded.due} vs ${future}`);
check('the panel names the linked opportunity', seeded.strip === true);
check('the panel header carries the bid serial', seeded.header === true);

await typeInto(`window.__panel()`, 'Draft the commercial offer', 'task name');
const before = (await writes()).length;
await clickEl(`window.__byText('button', 'Create Task', window.__panelRoot())[0]`, 'Create Task');
await waitFor(`window.__writes.length > ${before} && !window.__panel()`, 'task written + panel closed', 8000);
await sleep(600);
await shot('3-created');

const created = (await allOf('tasks')).find(t => t.taskName === 'Draft the commercial offer');
check('the task was created', !!created);
check('serial came from the real counter (7 -> TK000008)', (created || {}).serialNumber === 'TK000008', (created || {}).serialNumber);
check('★ it is born LINKED: opportunityId', (created || {}).opportunityId === 'op1', String((created || {}).opportunityId));
check('★ the denormalized labels ride along', (created || {}).opportunitySerial === 'OP000012' && (created || {}).opportunityTitle === 'Zohr tie-in maintenance contract',
  JSON.stringify([(created || {}).opportunitySerial, (created || {}).opportunityTitle]));
check('no project link is invented when none was picked',
  !('projectId' in (created || {})) && !('projectName' in (created || {})),
  JSON.stringify(Object.keys(created || {}).filter(k => k.startsWith('project'))));
check('the due date prefill was actually saved', (created || {}).dueDate === future);

console.log('\n[5] the bid history hears about it');
const followUps = (await allOf('opportunityFollowUps')).filter(f => f.opportunityId === 'op1');
check('exactly one follow-up was mirrored', followUps.length === 1, String(followUps.length));
const fu = followUps[0] || {};
check('★ authorId is the SIGNED-IN user (firestore.rules requires it)', fu.authorId === 'u-mgr', String(fu.authorId));
check('the entry names the task and its serial',
  (fu.text || '').includes('TK000008') && (fu.text || '').includes('Draft the commercial offer'), fu.text);
check('the entry reads as a creation, and says who it is for',
  (fu.text || '').includes('created') && (fu.text || '').includes('Tariq Salama'), fu.text);
check('the stored history text is ENGLISH regardless of the UI language',
  !/[\u0600-\u06FF]/.test(fu.text || ''), fu.text);
check('the entry carries the author name for the timeline', fu.authorName === 'Tariq Salama');

const opp = await docOf('opportunities', 'op1');
check('the bid summary line is refreshed', (opp.lastFollowUpText || '').includes('TK000008'), opp.lastFollowUpText);
// The design rule from task 2: a task event must never move the pipeline.
const oppWrite = (await writes()).filter(w => w.path === 'opportunities/op1').pop() || { data: {} };
check('★ the mirror does NOT touch stage or nextActionDate',
  !('stage' in oppWrite.data) && !('nextActionDate' in oppWrite.data),
  JSON.stringify(Object.keys(oppWrite.data)));
check('the bid still stands at the stage it was in', opp.stage === 'Bidding' && opp.nextActionDate === '2026-09-01',
  JSON.stringify([opp.stage, opp.nextActionDate]));
check('nothing was written to projectUpdates (no project is linked)',
  (await allOf('projectUpdates')).length === 0);
check('the follow-up entry did NOT go to the other bid',
  (await allOf('opportunityFollowUps')).every(f => f.opportunityId === 'op1'));

console.log('\n[6] the new task shows up in the tab immediately');
await waitFor(`window.__rows().length === 3`, 'the list picks up the new task', 4000);
const after = await evalJS(`JSON.stringify(window.__rows().map(window.__txt))`).then(JSON.parse);
check('the created task is listed without a reload',
  after.some(r => r.includes('Draft the commercial offer')), JSON.stringify(after));
check('the counters followed', await evalJS(`document.body.textContent.includes('2 open · 3 linked in total')`));
check('the brand-new task is not flagged overdue',
  !(after.find(r => r.includes('Draft the commercial offer')) || '').includes('OVERDUE'));

console.log('\n[7] a bid whose deadline has passed seeds no due date');
await evalJS(`window.__mountLate()`);
await sleep(400);
await clickEl(`window.__exact('button', 'Tasks')`, 'Tasks tab (late bid)');
await sleep(300);
check('the late bid shows its own linked task only',
  (await evalJS(`JSON.stringify(window.__rows().map(window.__txt))`).then(JSON.parse)).join(' ').includes('Suez site visit'));
await clickEl(`window.__one('button', 'New task for this bid')`, 'New task (late bid)');
await waitFor(`window.__panel()`, 'panel for the late bid');
await sleep(500);
const lateDue = await evalJS(`window.__panelRoot().querySelector('input[type="date"]').value`);
check('★ a PAST submission deadline is not prefilled as a due date', lateDue === '', String(lateDue));
await clickEl(`window.__byText('button', 'Cancel', window.__panelRoot())[0]`, 'cancel panel');
await sleep(400);
check('cancelling writes nothing', (await allOf('opportunityFollowUps')).length === 1);

console.log('\n[8] the empty state, layout and errors');
const emptyCheck = await evalJS(`(() => {
  ${HELPERS}
  return document.body.textContent.includes('Nothing is being worked on for this bid');
})()`);
check('a bid WITH linked work does not show the empty state', emptyCheck === false);

const overflow = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('no horizontal overflow at 1440px', overflow <= 0, String(overflow));
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
await sleep(400);
await shot('4-mobile');
const narrow = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('no horizontal overflow at 390px', narrow <= 0, String(narrow));
await send('Emulation.clearDeviceMetricsOverride');
await sleep(200);

console.log('\n[9] the same tab in Arabic / RTL');
await evalJS(`window.__mountOpen()`);
await sleep(300);
await evalJS(`window.__setLang('ar')`);
await sleep(500);
await clickEl(`window.__exact('button', 'المهام')`, 'Tasks tab (ar)');
await sleep(400);
await shot('5-ar');
const ar = await evalJS(`(() => {
  ${HELPERS}
  const btns = [...document.querySelectorAll('#root button')].map(window.__txt);
  return JSON.stringify({ btns, body: document.getElementById('root').innerText || '',
                          dir: document.documentElement.dir,
                          serialDir: getComputedStyle(window.__rows()[0].querySelector('.ltr-data')).direction });
})()`).then(JSON.parse);
check('the page is in RTL', ar.dir === 'rtl', ar.dir);
check('the tab is Arabic (العمل على هذا العطاء / مهمة جديدة لهذا العطاء)',
  ar.body.includes('العمل على هذا العطاء') && ar.btns.includes('مهمة جديدة لهذا العطاء'),
  ar.body.slice(0, 160));
check('the counts line is Arabic', ar.body.includes('مفتوحة') && ar.body.includes('مرتبطة'), ar.body.slice(0, 200));
check('★ the task serial stays left-to-right inside Arabic prose', ar.serialDir === 'ltr', ar.serialDir);
const arLatin = ar.btns.filter(b => /^(Tasks|New task for this bid|Work on this bid)$/.test(b));
check('★ nothing in the tab is still English', arLatin.length === 0, arLatin.join(' | '));
const arOverflow = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('no horizontal overflow in RTL', arOverflow <= 0, String(arOverflow));

await evalJS(`window.__setLang('en')`);
await sleep(400);
// textContent, not innerText: the heading is `text-transform: uppercase`, and
// innerText reports the TRANSFORMED text — "WORK ON THIS BID" — so the obvious
// spelling of this assertion fails for a reason that has nothing to do with
// language. (Arabic has no case, which is why the ar half passed.)
check('non-vacuous: the same tab reads English again under en',
  await evalJS(`document.getElementById('root').textContent.includes('Work on this bid')`));

check('no uncaught page errors or console.errors during the whole run',
  pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    const diag = await evalJS(`JSON.stringify({
      errors: window.__errors || [],
      text: document.body.innerText.slice(0, 500),
    })`).then(JSON.parse);
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600) || JSON.stringify(diag.errors));
    console.log('  body text   :', diag.text.replace(/\n+/g, ' | ').slice(0, 400));
  } catch { /* best effort */ }
  try {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/bidtask-failure.png');
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
