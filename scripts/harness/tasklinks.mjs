// Click-through harness for "a task registers itself onto a bid / project"
// (queue task 4).
//
// Task 2 proved src/lib/recordLinks.ts writes the right documents
// (recordlinks.mjs); task 3 proved the bid's own Tasks tab calls it
// (bidtask.mjs). This proves the TASK side: the link picker in the create panel
// and in the edit form, and the history echoes on link / status / done /
// archive. Real browser, real components, real hit-tested clicks, then the
// documents the fake Firestore recorded are read back and asserted.
//
// Real code under test:  src/TasksDashboard.tsx, src/components/CreateTaskPanel.tsx,
//                        src/components/RecordLinkPicker.tsx, src/lib/recordLinks.ts,
//                        src/lib/taskVisibility.ts, src/lib/counters.ts,
//                        src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts, window.fetch (the push proxy).
//
//   node scripts/harness/tasklinks.mjs        (--headed to watch it,
//                                              --shot to write PNGs)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-tasklinks-'));

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

const ENTRY = /* tsx */ `
import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/i18n';
import TasksDashboard from './src/TasksDashboard';
import i18n, { applyLanguageToDocument } from './src/i18n';

const T0 = Math.floor(new Date('2026-08-01T08:00:00Z').getTime() / 1000);
const ts = s => ({ seconds: T0 + s, nanoseconds: 0, toDate: () => new Date((T0 + s) * 1000) });
const iso = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
window.__future = iso(21);

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@x.com', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Business Development', userColor: '#3b82f6' },
  { id: 'u-emp1', displayName: 'Nevin Anwar',  email: 'n@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
];

__seed('tasks', '--stats--', { value: 7 });
__seed('opportunities', '--stats--', { value: 2 });
__seed('projects', '--stats--', { value: 2 });

__seed('opportunities', 'op1', {
  title: 'Zohr tie-in maintenance contract', serialNumber: 'OP000012', client: 'EGPC',
  sector: 'Upstream', stage: 'Bidding', probability: 40, estimatedValue: 12500000, currency: 'EGP',
  submissionDeadline: window.__future, nextActionDate: '2026-09-01',
  ownerId: 'u-mgr', ownerName: 'Tariq Salama',
  lastFollowUpText: 'Clarification issued to the client.', lastFollowUpAt: ts(100),
  createdAt: ts(10), updatedAt: ts(100),
});
__seed('opportunities', 'op2', {
  title: 'Suez tank farm O&M', serialNumber: 'OP000013', client: 'ECHEM',
  sector: 'Downstream', stage: 'Identified', ownerId: 'u-mgr', ownerName: 'Tariq Salama',
  createdAt: ts(11), updatedAt: ts(11),
});
__seed('projects', 'p1', {
  name: 'Meleiha Gas Plant O&M', serialNumber: 'PR000001', client: 'AGIBA', status: 'Active',
  currentStatus: 'Active', lastUpdateText: 'Mobilization complete.', lastUpdateAt: ts(80),
  userId: 'u-mgr', teamId: 'T1', createdAt: ts(12), updatedAt: ts(80),
});

// Already linked to op1 and to nothing else: the edit form must OPEN with that
// link selected, and a save that leaves it alone must post no history.
__seed('tasks', 't-linked', {
  taskName: 'Prepare technical proposal', description: 'Pricing and manning tables.',
  status: 'Pending', priority: 'High', category: 'Project', subCategory: 'None', department: 'None',
  serialNumber: 'TK000005', assignedTo: 'Tariq Salama', assignedToId: 'u-mgr',
  assignedBy: 'Tariq Salama', assignedById: 'u-mgr',
  isPrivate: false, collaboratorIds: [], collaborators: [], filePaths: [], dueDate: window.__future,
  opportunityId: 'op1', opportunitySerial: 'OP000012', opportunityTitle: 'Zohr tie-in maintenance contract',
  userId: 'u-mgr', teamId: 'T1', createdAt: ts(20), updatedAt: ts(20),
});
// Linked to nothing: the control for "a status move on an unlinked task writes
// no history at all".
__seed('tasks', 't-plain', {
  taskName: 'Update the org chart', description: '',
  status: 'Pending', priority: 'Low', category: 'Administrative', subCategory: 'None', department: 'None',
  serialNumber: 'TK000006', assignedTo: 'Tariq Salama', assignedToId: 'u-mgr',
  assignedBy: 'Tariq Salama', assignedById: 'u-mgr',
  isPrivate: false, collaboratorIds: [], collaborators: [], filePaths: [],
  userId: 'u-mgr', teamId: 'T1', createdAt: ts(21), updatedAt: ts(21),
});

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@x.com' };
const appUser = USERS[0];

const root = createRoot(document.getElementById('root'));
root.render(
  React.createElement('div', { className: 'app-main', style: { padding: 16 } },
    React.createElement(TasksDashboard, {
      user, appUser, projectUsers: USERS,
      // 'mine', not 'all': keeps the seeded rows in scope. Either way the board
      // now opens on the GROUP GRID — see openGroupHolding below.
      initialStatusFilter: 'All', initialView: 'mine',
    }),
  ),
);

// A <select> is driven through React's own tracked value setter rather than a
// synthesised click: an OS dropdown cannot be hit-tested, and this still runs
// the real onChange handler (which is the code under test).
window.__pick = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };

window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e =>
  window.__errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));
window.confirm = () => true;
window.fetch = async () => ({ ok: true, json: async () => ({ status: 'success' }), text: async () => '' });
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'tasklinksEntry.tsx', loader: 'tsx' },
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

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('Microsoft Edge not found.'); process.exit(2); }

const PORT = 9711 + (process.pid % 100);
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
window.__one = (sel, text, root) => { const m = window.__byText(sel, text, root); return m.length ? m[0] : null; };
window.__exact = (sel, text) => [...document.querySelectorAll(sel)]
  .filter(e => window.__vis(e) && window.__txt(e) === text)[0] || null;
window.__box = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; };
window.__panel = () => document.querySelector('input[placeholder="What needs to be done?"]');
window.__fixed = el => { let e = el; while (e && getComputedStyle(e).position !== 'fixed') e = e.parentElement; return e; };
window.__panelRoot = () => window.__fixed(window.__panel());
// The edit slide-over: the only fixed panel carrying the Save button.
window.__editRoot = () => {
  const b = window.__byText('button', 'Save Changes')[0] || window.__byText('button', 'حفظ التغييرات')[0];
  return b ? window.__fixed(b) : null;
};
// The two link <select>s, in DOM order: opportunity, then project.
window.__linkSelects = root => [...(root || document).querySelectorAll('select')]
  .filter(s => [...s.options].some(o => /Not linked to a (bid|project)|غير مرتبطة ب/.test(o.textContent)));
// The task row that carries \`key\` (a serial or a name): the SMALLEST visible
// element containing it that also owns the row's own "···" actions button, so
// a broad container (or the whole list) can never be returned instead.
window.__taskCard = key => [...document.querySelectorAll('div')]
  .filter(d => window.__vis(d) && window.__txt(d).includes(key)
    && [...d.querySelectorAll('button')].some(b => window.__txt(b) === '···'))
  .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0] || null;
`;
await waitFor(`document.getElementById('root') && document.getElementById('root').children.length`, 'app mount');
await evalJS(HELPERS);

// Grouping is a GRID of group cards now (src/components/GroupGrid.tsx): picking
// a dimension shows one card per bucket and the task ROWS only appear once a
// card is opened. Which card holds a given serial depends on its status, so try
// them in turn, backing out to the grid between attempts.
// ⚠ Advancing a task's status MOVES IT between buckets under the default
// `group by status`, so a row that was on screen a moment ago can vanish — call
// this again before every row interaction, not just the first.
async function openGroupHolding(serial) {
  const hasRow = `(() => { ${HELPERS} return !!window.__taskCard('${serial}'); })()`;
  if (await evalJS(hasRow)) return true;
  // Already drilled into the wrong bucket: back out, or there are no cards to try.
  if (await evalJS(`!!${`(() => { ${HELPERS} return window.__one('button', 'All Groups'); })()`}`)) {
    await clickEl(`window.__one('button', 'All Groups')`, 'back to the group grid');
    await sleep(350);
  }
  const n = await evalJS(`document.querySelectorAll('#root button[data-group-card]').length`);
  for (let i = 0; i < n; i++) {
    await clickEl(`document.querySelectorAll('#root button[data-group-card]')[${i}]`, `group card ${i}`);
    await sleep(350);
    if (await evalJS(hasRow)) return true;
    await clickEl(`window.__one('button', 'All Groups')`, 'back to the group grid');
    await sleep(350);
  }
  throw new Error(`no group card holds ${serial}`);
}

async function clickEl(finderJS, label) {
  // ⚠ Three attempts, not one — the same fix maillinks.mjs carries. A card the
  // list has just re-rendered (a status flip re-sorts the list, and queue task 6
  // added a link chip row that changes every linked card's height) can still be
  // mid-layout when the first hit test runs, and `elementFromPoint` then returns
  // null for a point that is perfectly clickable 250 ms later. Retrying is
  // honest: a genuinely covered element stays covered.
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
      return { x: b.x, y: b.y, covered: !(el === hit || el.contains(hit) || (hit && hit.contains(el))),
               hitTag: hit ? hit.tagName + '.' + hit.className : null,
               view: [innerWidth, innerHeight] };
    })()`);
    if (!info.err && !info.covered) break;
    await sleep(250);
  }
  if (info.err) throw new Error(`click ${label}: ${info.err}`);
  if (info.covered) throw new Error(`click ${label}: something else is on top (${info.hitTag}) at ${info.x},${info.y} in ${JSON.stringify(info.view)}`);
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
async function pick(which, value, root = 'document') {
  const done = await evalJS(`(() => {
    ${HELPERS}
    const sels = window.__linkSelects(${root});
    const el = sels[${which === 'opportunity' ? 0 : 1}];
    if (!el) return false;
    window.__pick(el, ${JSON.stringify(value)});
    return true;
  })()`);
  if (!done) throw new Error(`pick ${which}: select not found`);
  await sleep(220);
}
async function shot(name) {
  if (!SHOT) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(ROOT, `scripts/harness/tasklinks-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const allOf = c => evalJS(`JSON.stringify([...(window.__store.get(${JSON.stringify(c)}) || new Map()).entries()].map(([id,d])=>({id,...d})))`).then(JSON.parse);
const docOf = (c, id) => evalJS(`JSON.stringify(window.__store.get(${JSON.stringify(c)}).get(${JSON.stringify(id)}) || null)`).then(JSON.parse);
const writes = () => evalJS('JSON.stringify(window.__writes)').then(JSON.parse);
const followUps = async id => (await allOf('opportunityFollowUps')).filter(f => f.opportunityId === id);
const projectUpdates = async id => (await allOf('projectUpdates')).filter(u => u.projectId === id);

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] the create panel offers the link picker');
await clickEl(`window.__one('button', 'Add Task')`, 'Add Task');
await waitFor(`window.__panel()`, 'create panel');
await sleep(500);
await shot('1-create-panel');
const picker = await evalJS(`(() => {
  ${HELPERS}
  const root = window.__panelRoot();
  const sels = window.__linkSelects(root);
  return JSON.stringify({
    section: window.__txt(root).includes('Linked Records'),
    count: sels.length,
    opp: [...(sels[0] || {}).options || []].map(o => o.textContent),
    oppValues: [...(sels[0] || {}).options || []].map(o => o.value),
    prj: [...(sels[1] || {}).options || []].map(o => o.textContent),
    selected: [(sels[0] || {}).value, (sels[1] || {}).value],
    hint: window.__txt(root).includes('echoed into the history'),
  });
})()`).then(JSON.parse);
check('the form has a "Linked Records" section', picker.section === true);
check('it offers exactly two link selects (bid, project)', picker.count === 2, String(picker.count));
check('the bid list is loaded from the collection, serial first',
  picker.opp.includes('OP000012 — Zohr tie-in maintenance contract') && picker.opp.includes('OP000013 — Suez tank farm O&M'),
  JSON.stringify(picker.opp));
check('★ the counter doc is not offered as a bid', !picker.oppValues.includes('--stats--'), JSON.stringify(picker.oppValues));
check('★ every option carries the record ID as its value, never the label',
  picker.oppValues.filter(Boolean).every(v => /^(op1|op2)$/.test(v)), JSON.stringify(picker.oppValues));
check('the project list is loaded too', picker.prj.includes('Meleiha Gas Plant O&M'), JSON.stringify(picker.prj));
check('a new task starts linked to nothing', picker.selected[0] === '' && picker.selected[1] === '');
check('the form says what a link does', picker.hint === true);

console.log('\n[2] a task created WITH links is born linked, and both histories hear about it');
await typeInto(`window.__panel()`, 'Draft the commercial offer', 'task name');
await pick('opportunity', 'op1', 'window.__panelRoot()');
await pick('project', 'p1', 'window.__panelRoot()');
// Scroll the picker into view before the screenshot — the section sits below
// the fold of the slide-over, and a PNG of the part above it proves nothing.
await evalJS(`(() => { ${HELPERS}
  const s = window.__linkSelects(window.__panelRoot())[0];
  s.scrollIntoView({ block: 'center' });
})()`);
await sleep(300);
await shot('2-picked');
const before = (await writes()).length;
await clickEl(`window.__byText('button', 'Create Task', window.__panelRoot())[0]`, 'Create Task');
await waitFor(`window.__writes.length > ${before} && !window.__panel()`, 'task written + panel closed', 8000);
await sleep(700);

const created = (await allOf('tasks')).find(t => t.taskName === 'Draft the commercial offer');
check('the task was created', !!created);
check('★ it carries the bid id and its denormalized labels',
  (created || {}).opportunityId === 'op1' && (created || {}).opportunitySerial === 'OP000012'
  && (created || {}).opportunityTitle === 'Zohr tie-in maintenance contract',
  JSON.stringify([(created || {}).opportunityId, (created || {}).opportunitySerial]));
check('★ and the project id and its name',
  (created || {}).projectId === 'p1' && (created || {}).projectName === 'Meleiha Gas Plant O&M',
  JSON.stringify([(created || {}).projectId, (created || {}).projectName]));
check('the serial came from the real counter (7 -> TK000008)', (created || {}).serialNumber === 'TK000008', (created || {}).serialNumber);

const fu1 = await followUps('op1');
check('exactly one follow-up landed on the bid', fu1.length === 1, String(fu1.length));
check('it names the task and its serial',
  (fu1[0] || {}).text?.includes('TK000008') && fu1[0].text.includes('Draft the commercial offer'), (fu1[0] || {}).text);
check('it reads as a creation', (fu1[0] || {}).text?.includes('created'), (fu1[0] || {}).text);
check('★ authorId is the signed-in user (firestore.rules requires it)', (fu1[0] || {}).authorId === 'u-mgr');
const pu1 = await projectUpdates('p1');
check('exactly one update landed on the project', pu1.length === 1, String(pu1.length));
check('the project entry is the same sentence', (pu1[0] || {}).text === (fu1[0] || {}).text);
check('★ the history text is ENGLISH regardless of the UI language',
  !/[\u0600-\u06FF]/.test((fu1[0] || {}).text || ''), (fu1[0] || {}).text);

const oppWrite = (await writes()).filter(w => w.path === 'opportunities/op1').pop() || { data: {} };
const prjWrite = (await writes()).filter(w => w.path === 'projects/p1').pop() || { data: {} };
check('★ the bid mirror does NOT move the pipeline (no stage / nextActionDate)',
  !('stage' in oppWrite.data) && !('nextActionDate' in oppWrite.data), JSON.stringify(Object.keys(oppWrite.data)));
check("★ the project mirror does NOT touch the project's status",
  !('status' in prjWrite.data) && !('currentStatus' in prjWrite.data), JSON.stringify(Object.keys(prjWrite.data)));
check('the bid summary line was refreshed', (await docOf('opportunities', 'op1')).lastFollowUpText.includes('TK000008'));
check('the project summary line was refreshed', (await docOf('projects', 'p1')).lastUpdateText.includes('TK000008'));
check('nothing was written to the OTHER bid', (await followUps('op2')).length === 0);

console.log('\n[3] a task created with NO link writes no history at all');
const fuBefore = (await allOf('opportunityFollowUps')).length;
const puBefore = (await allOf('projectUpdates')).length;
await clickEl(`window.__one('button', 'Add Task')`, 'Add Task (unlinked)');
await waitFor(`window.__panel()`, 'create panel again');
await sleep(500);
const stale = await evalJS(`(() => { ${HELPERS} const s = window.__linkSelects(window.__panelRoot()); return JSON.stringify([s[0].value, s[1].value]); })()`).then(JSON.parse);
check('★ the picker does not remember the last task\u2019s links', stale[0] === '' && stale[1] === '', JSON.stringify(stale));
await typeInto(`window.__panel()`, 'Book the meeting room', 'task name (unlinked)');
await clickEl(`window.__byText('button', 'Create Task', window.__panelRoot())[0]`, 'Create Task (unlinked)');
await waitFor(`!window.__panel()`, 'panel closed', 8000);
await sleep(600);
const plain = (await allOf('tasks')).find(t => t.taskName === 'Book the meeting room');
check('the unlinked task was created', !!plain);
check('★ no empty link keys are invented on it',
  !Object.keys(plain || {}).some(k => k.startsWith('opportunity') || k.startsWith('project')),
  JSON.stringify(Object.keys(plain || {}).filter(k => /opportunity|project/.test(k))));
check('no follow-up was written', (await allOf('opportunityFollowUps')).length === fuBefore);
check('no project update was written', (await allOf('projectUpdates')).length === puBefore);

console.log('\n[4] the edit form opens on the links the task already has');
await openGroupHolding('TK000005');
await clickEl(`window.__one('button', '···', window.__taskCard('TK000005'))`, 'row actions (TK000005)');
await clickEl(`window.__one('button', 'Edit Task')`, 'Edit Task');
await waitFor(`window.__editRoot()`, 'edit panel');
await sleep(500);
await shot('3-edit');
const seeded = await evalJS(`(() => {
  ${HELPERS}
  const s = window.__linkSelects(window.__editRoot());
  return JSON.stringify({ n: s.length, opp: s[0].value, prj: s[1].value });
})()`).then(JSON.parse);
check('the edit form carries the same picker', seeded.n === 2, String(seeded.n));
check('★ the stored bid link is pre-selected — a save cannot silently drop it', seeded.opp === 'op1', seeded.opp);
check('the project side is empty, as stored', seeded.prj === '');

console.log('\n[5] saving with the links untouched posts NOTHING');
const fuBeforeSave = (await followUps('op1')).length;
await clickEl(`window.__byText('button', 'Save Changes', window.__editRoot())[0]`, 'Save Changes (unchanged)');
await sleep(700);
check('★ re-saving a form is not an event — no second entry',
  (await followUps('op1')).length === fuBeforeSave, String((await followUps('op1')).length));
check('the link survived the save', (await docOf('tasks', 't-linked')).opportunityId === 'op1');

console.log('\n[6] attaching a project from the edit form');
await clickEl(`window.__one('button', '···', window.__taskCard('TK000005'))`, 'row actions again');
await clickEl(`window.__one('button', 'Edit Task')`, 'Edit Task again');
await waitFor(`window.__editRoot()`, 'edit panel again');
await sleep(400);
const puBeforeLink = (await projectUpdates('p1')).length;
const fuBeforeLink = (await followUps('op1')).length;
await pick('project', 'p1', 'window.__editRoot()');
await clickEl(`window.__byText('button', 'Save Changes', window.__editRoot())[0]`, 'Save Changes (project added)');
await sleep(800);
const relinked = await docOf('tasks', 't-linked');
check('the project link was written onto the task',
  relinked.projectId === 'p1' && relinked.projectName === 'Meleiha Gas Plant O&M',
  JSON.stringify([relinked.projectId, relinked.projectName]));
check('the bid link is untouched', relinked.opportunityId === 'op1');
const puNew = await projectUpdates('p1');
check('exactly one entry landed on the newly linked project', puNew.length === puBeforeLink + 1, String(puNew.length));
check('it reads as an attachment, not a creation',
  (puNew[puNew.length - 1].text || '').includes('linked to this record'), puNew[puNew.length - 1].text);
check('★ the bid, which was ALREADY linked, hears nothing',
  (await followUps('op1')).length === fuBeforeLink, String((await followUps('op1')).length));

console.log('\n[6b] queue task 6: the card SHOWS what it is linked to');
// The forward view. It reads the stored labels, so this also proves the link
// write and the surface agree — a chip that painted from the live opportunity
// document would pass here and fail on a renamed bid.
const cardLinks = await evalJS(`(() => {
  ${HELPERS}
  const card = window.__taskCard('TK000005');
  if (!card) return JSON.stringify({ err: 'no card' });
  const ltr = [...card.querySelectorAll('.ltr-data')].map(x => (x.textContent || '').trim());
  return JSON.stringify({ text: card.textContent || '', ltr });
})()`).then(JSON.parse);
check('★ the linked task card paints the bid serial and title',
  cardLinks.text.includes('OP000012') && cardLinks.text.includes('Zohr tie-in maintenance contract'),
  (cardLinks.text || cardLinks.err || '').slice(0, 200));
check('★ it paints the project label too, from the same block',
  cardLinks.text.includes('Meleiha Gas Plant O&M'), (cardLinks.text || '').slice(0, 200));
check('★ the bid serial is marked as LTR data, not left to bidi',
  (cardLinks.ltr || []).includes('OP000012'), (cardLinks.ltr || []).join(' | '));
const unlinkedCard = await evalJS(`(() => {
  ${HELPERS}
  const card = window.__taskCard('TK000006');
  return JSON.stringify({ text: card ? (card.textContent || '') : '' });
})()`).then(JSON.parse);
check('★ an UNLINKED task card shows no link block at all',
  !/OP0000|Meleiha/.test(unlinkedCard.text), unlinkedCard.text.slice(0, 160));

console.log('\n[7] detaching clears the field instead of leaving it stale');
await clickEl(`window.__one('button', '···', window.__taskCard('TK000005'))`, 'row actions (detach)');
await clickEl(`window.__one('button', 'Edit Task')`, 'Edit Task (detach)');
await waitFor(`window.__editRoot()`, 'edit panel (detach)');
await sleep(400);
const fuBeforeDetach = (await followUps('op1')).length;
await pick('opportunity', '', 'window.__editRoot()');
await clickEl(`window.__byText('button', 'Save Changes', window.__editRoot())[0]`, 'Save Changes (detached)');
await sleep(800);
const detached = await docOf('tasks', 't-linked');
check('★ every field of the dropped link is gone, labels included',
  !('opportunityId' in detached) && !('opportunitySerial' in detached) && !('opportunityTitle' in detached),
  JSON.stringify(Object.keys(detached).filter(k => k.startsWith('opportunity'))));
check('the project link it kept is still there', detached.projectId === 'p1');
check('detaching posts no history entry — nothing was linked', (await followUps('op1')).length === fuBeforeDetach);

console.log('\n[8] a status move is echoed, and "done" reads as done');
// The task now carries only the project link, so the project is where its
// progress lands.
const puBeforeStatus = (await projectUpdates('p1')).length;
await openGroupHolding('TK000005');
await clickEl(`window.__one('button', 'In Progress', window.__taskCard('TK000005'))`, 'In Progress');
await sleep(700);
const puStatus = await projectUpdates('p1');
check('the status move posted one entry', puStatus.length === puBeforeStatus + 1, String(puStatus.length));
check('it names the new status', (puStatus[puStatus.length - 1].text || '').includes('is now In Progress'), puStatus[puStatus.length - 1].text);
check('the task really moved', (await docOf('tasks', 't-linked')).status === 'In Progress');

await openGroupHolding('TK000005');
await clickEl(`window.__one('button', 'Done', window.__taskCard('TK000005'))`, 'Done');
await sleep(700);
const puDone = await projectUpdates('p1');
check('finishing posted its own entry', puDone.length === puStatus.length + 1, String(puDone.length));
check('★ "completed" reads differently from a plain status change',
  (puDone[puDone.length - 1].text || '').includes('completed')
  && !(puDone[puDone.length - 1].text || '').includes('is now'), puDone[puDone.length - 1].text);
check('the project summary line followed', (await docOf('projects', 'p1')).lastUpdateText.includes('completed'));

console.log('\n[9] an UNLINKED task moving status writes nothing');
const allBefore = (await allOf('projectUpdates')).length + (await allOf('opportunityFollowUps')).length;
await openGroupHolding('TK000006');
await clickEl(`window.__one('button', 'In Progress', window.__taskCard('TK000006'))`, 'In Progress (unlinked task)');
await sleep(600);
check('the unlinked task moved', (await docOf('tasks', 't-plain')).status === 'In Progress');
check('★ and no history was written anywhere',
  (await allOf('projectUpdates')).length + (await allOf('opportunityFollowUps')).length === allBefore);

console.log('\n[10] the picker in Arabic / RTL');
await evalJS(`window.__setLang('ar')`);
await sleep(600);
// ⚠ The clicks above left the page scrolled down the task list. A click is
// dispatched at VIEWPORT coordinates, so without scrolling back first
// `elementFromPoint` returns null and the click reports "something else is on
// top (null)" — scrollIntoView inside the finder is not enough on its own.
await evalJS(`window.scrollTo(0, 0)`);
await sleep(400);
await clickEl(`window.__one('button', 'إضافة مهمة')`, 'Add Task (ar)');
await waitFor(`window.__panel() || document.querySelector('input.input')`, 'create panel (ar)');
await sleep(600);
await evalJS(`(() => { ${HELPERS}
  const s = window.__linkSelects(document).filter(window.__vis)[0];
  if (s) s.scrollIntoView({ block: 'center' });
})()`);
await sleep(300);
await shot('4-ar');
const ar = await evalJS(`(() => {
  ${HELPERS}
  // ⚠ The panel is found through the LINK SELECTS themselves, not through the
  // task-name placeholder or a date input — both are Arabic (or duplicated by
  // the page's own filters) once the language flips.
  const link = window.__linkSelects(document).filter(window.__vis);
  const root = window.__fixed(link[0]);
  return JSON.stringify({
    dir: document.documentElement.dir,
    section: (root.textContent || '').includes('السجلات المرتبطة'),
    labels: link.map(s => [...s.options][0].textContent),
    values: link.flatMap(s => [...s.options].map(o => o.value)),
    english: /Linked Records|Not linked to a bid/.test(root.textContent || ''),
  });
})()`).then(JSON.parse);
check('the page is RTL', ar.dir === 'rtl', ar.dir);
check('the section heading is Arabic', ar.section === true);
check('both empty options are Arabic', ar.labels.length === 2 && ar.labels.every(l => /غير مرتبطة/.test(l)), JSON.stringify(ar.labels));
check('★ no <option> VALUE is Arabic — a label can never reach Firestore',
  ar.values.every(v => !/[\u0600-\u06FF]/.test(v)), JSON.stringify(ar.values));
check('nothing in the section is still English', ar.english === false);
const arOverflow = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('no horizontal overflow in RTL', arOverflow <= 0, String(arOverflow));
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
await sleep(500);
await shot('5-ar-mobile');
const narrow = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('no horizontal overflow at 390px', narrow <= 0, String(narrow));
await send('Emulation.clearDeviceMetricsOverride');
await sleep(200);
await evalJS(`window.__setLang('en')`);
await sleep(500);
check('non-vacuous: the same section reads English again under en',
  await evalJS(`document.body.textContent.includes('Linked Records')`));

check('no uncaught page errors or console.errors during the whole run',
  pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    const diag = await evalJS(`JSON.stringify({ errors: window.__errors || [], text: document.body.innerText.slice(0, 500) })`).then(JSON.parse);
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600) || JSON.stringify(diag.errors));
    console.log('  body text   :', diag.text.replace(/\n+/g, ' | ').slice(0, 400));
  } catch { /* best effort */ }
  try {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/tasklinks-failure.png');
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
