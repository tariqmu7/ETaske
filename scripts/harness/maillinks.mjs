// Click-through harness for "an email registers itself onto a bid / project"
// (queue task 5).
//
// Task 2 proved src/lib/recordLinks.ts writes the right documents
// (recordlinks.mjs), task 3 the bid's own Tasks tab (bidtask.mjs), task 4 the
// TASK side of the picker (tasklinks.mjs). This proves the CORRESPONDENCE side:
// the picker in the correspondence form, the history echoes on create / link /
// status / close, the link INHERITED by the task the correspondence is assigned
// as (both the modal path and the inline quick-assign), and the ManagerInbox
// conversion opening on the correspondence's own link.
//
// Real code under test:  src/CorrespondingsDashboard.tsx, src/ManagerInbox.tsx,
//                        src/components/RecordLinkPicker.tsx,
//                        src/components/CreateTaskPanel.tsx, src/lib/recordLinks.ts,
//                        src/lib/counters.ts, src/lib/taskVisibility.ts,
//                        src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts, window.fetch (the push proxy).
//
//   node scripts/harness/maillinks.mjs        (--headed to watch it,
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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-maillinks-'));

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
import CorrespondingsDashboard from './src/CorrespondingsDashboard';
import ManagerInbox from './src/ManagerInbox';
import i18n, { applyLanguageToDocument } from './src/i18n';

const T0 = Math.floor(new Date('2026-08-01T08:00:00Z').getTime() / 1000);
const ts = s => ({ seconds: T0 + s, nanoseconds: 0, toDate: () => new Date((T0 + s) * 1000) });
const iso = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
window.__future = iso(21);

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@x.com', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Business Development', userColor: '#3b82f6' },
  { id: 'u-emp1', displayName: 'Nevin Anwar',  email: 'n@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
];

// ⚠ Well ABOVE the seeded serials: the counter hands out CR000061+, so a
// correspondence created during the run can never collide with CR000041–43 and
// send a serial-based finder to the wrong card (it did, and it cost 8 failures).
__seed('correspondences', '--stats--', { value: 60 });
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

// Already linked to op1: the edit form must OPEN on that link, and a save that
// leaves it alone must post nothing.
__seed('correspondences', 'c-linked', {
  subject: 'Clarification request on the Zohr tender',
  body: 'The client asks for the manning table by Sunday.',
  sentFrom: 'EGPC', department: 'Business Development', subCategory: 'None',
  category: 'External', priority: 'High', dateReceived: '2026-08-10', deadline: window.__future,
  serialNumber: 'CR000041', status: 'Unread', filePaths: [],
  opportunityId: 'op1', opportunitySerial: 'OP000012', opportunityTitle: 'Zohr tie-in maintenance contract',
  userId: 'u-mgr', teamId: 'T1', createdAt: ts(1000), updatedAt: ts(1000),
});
// Linked to op2 and unassigned: the inline quick-assign path.
__seed('correspondences', 'c-quick', {
  subject: 'Site visit invitation',
  body: 'Client invites us to the pre-bid site visit.',
  sentFrom: 'ECHEM', department: 'Business Development', subCategory: 'None',
  category: 'External', priority: 'Medium', dateReceived: '2026-08-11',
  serialNumber: 'CR000042', status: 'Unread', filePaths: [],
  opportunityId: 'op2', opportunitySerial: 'OP000013', opportunityTitle: 'Suez tank farm O&M',
  userId: 'u-mgr', teamId: 'T1', createdAt: ts(900), updatedAt: ts(900),
});
// Reserved for the ManagerInbox phase: linked to BOTH sides, unassigned, and
// touched by nothing earlier in the run.
__seed('correspondences', 'c-inbox', {
  subject: 'Bid bond issuance request',
  body: 'Finance needs the bid bond before submission.',
  sentFrom: 'EGPC', department: 'Business Development', subCategory: 'None',
  category: 'External', priority: 'High', dateReceived: '2026-08-12', deadline: window.__future,
  serialNumber: 'CR000044', status: 'Unread', filePaths: [],
  opportunityId: 'op1', opportunitySerial: 'OP000012', opportunityTitle: 'Zohr tie-in maintenance contract',
  projectId: 'p1', projectName: 'Meleiha Gas Plant O&M',
  userId: 'u-mgr', teamId: 'T1', createdAt: ts(850), updatedAt: ts(850),
});
// Linked to nothing: the control for "no link, no history, no invented keys".
__seed('correspondences', 'c-plain', {
  subject: 'Office supplies order',
  body: 'Stationery for the department.',
  sentFrom: 'Admin', department: 'Business Development', subCategory: 'None',
  category: 'Internal', priority: 'Low', dateReceived: '2026-08-12',
  serialNumber: 'CR000043', status: 'Unread', filePaths: [],
  userId: 'u-mgr', teamId: 'T1', createdAt: ts(800), updatedAt: ts(800),
});

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@x.com' };
const appUser = USERS[0];

const root = createRoot(document.getElementById('root'));
// One page, two screens: the correspondence dashboard for the form itself, the
// ManagerInbox for the conversion. Mounting both at once would give every
// text-based finder two candidates, so they are swapped instead.
const mount = which => root.render(
  React.createElement('div', { className: 'app-main', style: { maxWidth: 1200, margin: '0 auto', padding: 24 } },
    which === 'inbox'
      ? React.createElement(ManagerInbox, { user, appUser, projectUsers: USERS, onNavigate: v => { window.__navigated = v; } })
      : React.createElement(CorrespondingsDashboard, {
          user, appUser, projectUsers: USERS,
          onNavigate: v => { window.__navigated = v; },
          initialStatusFilter: 'All',
        }),
  ),
);
mount('corr');
window.__mount = mount;

// A <select> is driven through React's own tracked value setter rather than a
// synthesised click: an OS dropdown cannot be hit-tested, and this still runs
// the real onChange handler (which is the code under test).
window.__pick = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
window.__type = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
// ⚠ Stamping <html dir> is hooks/useLanguage.ts's job, not i18next's:
// changeLanguage alone renders Arabic inside an LTR page.
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };

window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e =>
  window.__errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));
window.confirm = () => true;
window.alert = m => { window.__errors.push('alert: ' + m); };
window.fetch = async () => ({ ok: true, json: async () => ({ status: 'success' }), text: async () => '' });
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'maillinksEntry.tsx', loader: 'tsx' },
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

const PORT = 9811 + (process.pid % 100);
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
// ⚠ textContent, never innerText: innerText returns the TRANSFORMED text, so an
// uppercase heading reads "LINKED RECORDS" and an obvious assertion fails for a
// reason that has nothing to do with the code under test.
window.__txt = e => (e.textContent || '').replace(/\\s+/g, ' ').trim();
window.__byText = (sel, text, root) => [...(root || document).querySelectorAll(sel)]
  .filter(e => window.__vis(e) && window.__txt(e).includes(text));
window.__one = (sel, text, root) => { const m = window.__byText(sel, text, root); return m.length ? m[0] : null; };
window.__box = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; };
window.__fixed = el => { let e = el; while (e && getComputedStyle(e).position !== 'fixed') e = e.parentElement; return e; };
// The correspondence modal: the only visible <form> on the page.
window.__form = () => [...document.querySelectorAll('form')].filter(window.__vis)[0] || null;
// The two link <select>s, in DOM order: opportunity, then project.
window.__linkSelects = root => [...(root || document).querySelectorAll('select')]
  .filter(s => [...s.options].some(o => /Not linked to a (bid|project)|غير مرتبطة ب/.test(o.textContent)));
// Fields are found by their OWN option text, never by position: a
// position-based finder breaks every time the form grows (that is exactly how
// inboxconvert.mjs broke when the link selects landed after the assignee).
// ⚠ ALWAYS pass a root when several cards are on screen: every unassigned card
// carries its own quick-assign select, and the first one is somebody else's.
window.__selectWith = (optionText, root) => [...(root || document).querySelectorAll('select')]
  .filter(s => window.__vis(s) && [...s.options].some(o => window.__txt(o).includes(optionText)))[0] || null;
window.__corrCard = key => [...document.querySelectorAll('div')]
  .filter(d => window.__vis(d) && window.__txt(d).includes(key)
    && [...d.querySelectorAll('button')].some(b => b.title === 'Edit'))
  .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0] || null;
window.__subject = () => { const f = window.__form(); return f ? f.querySelector('input.input') : null; };
// The create-task slide-over (ManagerInbox conversion).
window.__panel = () => document.querySelector('input[placeholder="What needs to be done?"]');
window.__panelRoot = () => window.__fixed(window.__panel());
`;
await waitFor(`document.getElementById('root') && document.getElementById('root').children.length`, 'app mount');
await evalJS(HELPERS);

async function clickEl(finderJS, label) {
  // ⚠ Two attempts, not one. A card the list has just re-rendered (a save, a
  // status flip) can still be mid-layout when the first hit test runs, and
  // `elementFromPoint` then returns null for a point that is perfectly clickable
  // 200 ms later. Retrying is honest — a genuinely covered element stays covered.
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
async function pickIn(optionText, value, root = 'document') {
  const done = await evalJS(`(() => {
    ${HELPERS}
    const el = window.__selectWith(${JSON.stringify(optionText)}, ${root});
    if (!el) return false;
    window.__pick(el, ${JSON.stringify(value)});
    return true;
  })()`);
  if (!done) throw new Error(`pick "${optionText}": select not found`);
  await sleep(220);
}
async function shot(name) {
  if (!SHOT) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(ROOT, `scripts/harness/maillinks-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const allOf = c => evalJS(`JSON.stringify([...(window.__store.get(${JSON.stringify(c)}) || new Map()).entries()].map(([id,d])=>({id,...d})))`).then(JSON.parse);
const docOf = (c, id) => evalJS(`JSON.stringify(window.__store.get(${JSON.stringify(c)}).get(${JSON.stringify(id)}) || null)`).then(JSON.parse);
const writes = () => evalJS('JSON.stringify(window.__writes)').then(JSON.parse);
const followUps = async id => (await allOf('opportunityFollowUps')).filter(f => f.opportunityId === id);
const projectUpdates = async id => (await allOf('projectUpdates')).filter(u => u.projectId === id);
const openEdit = async key => {
  // ⚠ Back to the top FIRST. Clicks are dispatched at VIEWPORT coordinates, and
  // after a few modals the list is left scrolled far enough down that
  // `elementFromPoint` on the centred card returns null ("something else is on
  // top (null)") — scrollIntoView inside the finder is not enough on its own.
  await evalJS(`window.scrollTo(0, 0)`);
  await sleep(300);
  await clickEl(`window.__one('button[title="Edit"]', '', window.__corrCard(${JSON.stringify(key)}))`, `edit ${key}`);
  await waitFor(`window.__form()`, `form for ${key}`);
  await sleep(500);
};
const save = async (labelText, what) => {
  await clickEl(`window.__byText('button', ${JSON.stringify(labelText)}, window.__form())[0]`, what);
  await sleep(900);
};

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] the correspondence form offers the link picker');
await clickEl(`window.__one('button', 'New Correspondence')`, 'New Correspondence');
await waitFor(`window.__form()`, 'correspondence form');
await sleep(500);
await shot('1-form');
const picker = await evalJS(`(() => {
  ${HELPERS}
  const f = window.__form();
  const sels = window.__linkSelects(f);
  return JSON.stringify({
    section: window.__txt(f).includes('Linked Records'),
    count: sels.length,
    opp: [...(sels[0] || {}).options || []].map(o => o.textContent),
    oppValues: [...(sels[0] || {}).options || []].map(o => o.value),
    prj: [...(sels[1] || {}).options || []].map(o => o.textContent),
    selected: [(sels[0] || {}).value, (sels[1] || {}).value],
    hint: window.__txt(f).includes('This correspondence'),
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
check('a new correspondence starts linked to nothing', picker.selected[0] === '' && picker.selected[1] === '');
check('★ the hint speaks about the CORRESPONDENCE, not about a task', picker.hint === true);

console.log('\n[2] a correspondence created WITH links is born linked, and both histories hear about it');
await typeInto(`window.__subject()`, 'Prequalification pack request', 'subject');
await pick('opportunity', 'op1', 'window.__form()');
await pick('project', 'p1', 'window.__form()');
await evalJS(`(() => { ${HELPERS} window.__linkSelects(window.__form())[0].scrollIntoView({ block: 'center' }); })()`);
await sleep(300);
await shot('2-picked');
const before = (await writes()).length;
await save('Create Corresponding', 'Create Corresponding');
await waitFor(`window.__writes.length > ${before} && !window.__form()`, 'correspondence written + modal closed', 8000);
await sleep(500);

const created = (await allOf('correspondences')).find(c => c.subject === 'Prequalification pack request');
check('the correspondence was created', !!created);
check('★ it carries the bid id and its denormalized labels',
  (created || {}).opportunityId === 'op1' && (created || {}).opportunitySerial === 'OP000012'
  && (created || {}).opportunityTitle === 'Zohr tie-in maintenance contract',
  JSON.stringify([(created || {}).opportunityId, (created || {}).opportunitySerial]));
check('★ and the project id and its name',
  (created || {}).projectId === 'p1' && (created || {}).projectName === 'Meleiha Gas Plant O&M',
  JSON.stringify([(created || {}).projectId, (created || {}).projectName]));
check('the serial came from the real counter (60 -> CR000061)',
  (created || {}).serialNumber === 'CR000061', (created || {}).serialNumber);

const fu1 = await followUps('op1');
check('exactly one follow-up landed on the bid', fu1.length === 1, String(fu1.length));
check('★ it reads as a CORRESPONDENCE, not as a task',
  (fu1[0] || {}).text?.startsWith('Correspondence '), (fu1[0] || {}).text);
check('it names the subject and the serial',
  (fu1[0] || {}).text?.includes('Prequalification pack request')
  && (fu1[0] || {}).text?.includes((created || {}).serialNumber), (fu1[0] || {}).text);
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
check('the bid summary line was refreshed', (await docOf('opportunities', 'op1')).lastFollowUpText.includes('Prequalification'));
check('nothing was written to the OTHER bid', (await followUps('op2')).length === 0);

console.log('\n[3] a correspondence created with NO link writes no history at all');
const fuBefore = (await allOf('opportunityFollowUps')).length;
const puBefore = (await allOf('projectUpdates')).length;
await clickEl(`window.__one('button', 'New Correspondence')`, 'New Correspondence (unlinked)');
await waitFor(`window.__form()`, 'form again');
await sleep(400);
const stale = await evalJS(`(() => { ${HELPERS} const s = window.__linkSelects(window.__form()); return JSON.stringify([s[0].value, s[1].value]); })()`).then(JSON.parse);
check('★ the picker does not remember the last correspondence\u2019s links',
  stale[0] === '' && stale[1] === '', JSON.stringify(stale));
await typeInto(`window.__subject()`, 'Canteen menu update', 'subject (unlinked)');
await save('Create Corresponding', 'Create Corresponding (unlinked)');
const plain = (await allOf('correspondences')).find(c => c.subject === 'Canteen menu update');
check('the unlinked correspondence was created', !!plain);
check('★ no empty link keys are invented on it',
  !Object.keys(plain || {}).some(k => k.startsWith('opportunity') || k.startsWith('project')),
  JSON.stringify(Object.keys(plain || {}).filter(k => /opportunity|project/.test(k))));
check('no follow-up was written', (await allOf('opportunityFollowUps')).length === fuBefore);
check('no project update was written', (await allOf('projectUpdates')).length === puBefore);

console.log('\n[4] the edit form opens on the links the correspondence already has');
await openEdit('CR000041');
await shot('3-edit');
const seeded = await evalJS(`(() => {
  ${HELPERS}
  const s = window.__linkSelects(window.__form());
  return JSON.stringify({ n: s.length, opp: s[0].value, prj: s[1].value });
})()`).then(JSON.parse);
check('the edit form carries the same picker', seeded.n === 2, String(seeded.n));
check('★ the stored bid link is pre-selected — a save cannot silently drop it', seeded.opp === 'op1', seeded.opp);
check('the project side is empty, as stored', seeded.prj === '');

console.log('\n[5] saving with the links untouched posts NOTHING');
const fuBeforeSave = (await followUps('op1')).length;
await save('Save Changes', 'Save Changes (unchanged)');
check('★ re-saving a form is not an event — no second entry',
  (await followUps('op1')).length === fuBeforeSave, String((await followUps('op1')).length));
check('the link survived the save', (await docOf('correspondences', 'c-linked')).opportunityId === 'op1');

console.log('\n[6] attaching a project from the edit form');
await openEdit('CR000041');
const puBeforeLink = (await projectUpdates('p1')).length;
const fuBeforeLink = (await followUps('op1')).length;
await pick('project', 'p1', 'window.__form()');
await save('Save Changes', 'Save Changes (project added)');
const relinked = await docOf('correspondences', 'c-linked');
check('the project link was written onto the correspondence',
  relinked.projectId === 'p1' && relinked.projectName === 'Meleiha Gas Plant O&M',
  JSON.stringify([relinked.projectId, relinked.projectName]));
check('the bid link is untouched', relinked.opportunityId === 'op1');
const puNew = await projectUpdates('p1');
check('exactly one entry landed on the newly linked project', puNew.length === puBeforeLink + 1, String(puNew.length));
check('it reads as an attachment, not a creation',
  (puNew[puNew.length - 1].text || '').includes('linked to this record'), puNew[puNew.length - 1].text);
check('★ the bid, which was ALREADY linked, hears nothing',
  (await followUps('op1')).length === fuBeforeLink, String((await followUps('op1')).length));

console.log('\n[7] closing a linked correspondence is echoed as completion');
await openEdit('CR000041');
const fuBeforeClose = (await followUps('op1')).length;
await clickEl(`window.__byText('button', 'Closed', window.__form())[0]`, 'status Closed');
await save('Save Changes', 'Save Changes (closed)');
check('the correspondence really closed', (await docOf('correspondences', 'c-linked')).status === 'Closed');
const fuClose = await followUps('op1');
check('the status move posted one entry', fuClose.length === fuBeforeClose + 1, String(fuClose.length));
check('★ "completed" reads differently from a plain status change',
  (fuClose[fuClose.length - 1].text || '').includes('completed')
  && !(fuClose[fuClose.length - 1].text || '').includes('is now'), fuClose[fuClose.length - 1].text);

console.log('\n[8] detaching clears the fields instead of leaving them stale');
await openEdit('CR000041');
const fuBeforeDetach = (await followUps('op1')).length;
await pick('opportunity', '', 'window.__form()');
await save('Save Changes', 'Save Changes (detached)');
const detached = await docOf('correspondences', 'c-linked');
check('★ every field of the dropped link is gone, labels included',
  !('opportunityId' in detached) && !('opportunitySerial' in detached) && !('opportunityTitle' in detached),
  JSON.stringify(Object.keys(detached).filter(k => k.startsWith('opportunity'))));
check('the project link it kept is still there', detached.projectId === 'p1');
check('detaching posts no history entry — nothing was linked',
  (await followUps('op1')).length === fuBeforeDetach);

console.log('\n[9] ★ the task the correspondence is assigned as INHERITS its links');
await openEdit('CR000043');   // c-plain, unlinked so far
const fuBeforeAssign = (await followUps('op2')).length;
await pick('opportunity', 'op2', 'window.__form()');
await pickIn('— Unassigned —', 'u-emp1', 'window.__form()');
await save('Save Changes', 'Save Changes (assigned + linked)');
const assignedCorr = await docOf('correspondences', 'c-plain');
check('the correspondence was linked and assigned',
  assignedCorr.opportunityId === 'op2' && assignedCorr.assignedToId === 'u-emp1',
  JSON.stringify([assignedCorr.opportunityId, assignedCorr.assignedToId]));
const bornTask = (await allOf('tasks')).find(t => t.correspondingId === 'c-plain');
check('a task was created from the assignment', !!bornTask, JSON.stringify((await allOf('tasks')).map(t => t.taskName)));
check('★ the task carries the bid link the email had',
  (bornTask || {}).opportunityId === 'op2' && (bornTask || {}).opportunitySerial === 'OP000013',
  JSON.stringify([(bornTask || {}).opportunityId, (bornTask || {}).opportunitySerial]));
const fuAssign = await followUps('op2');
check('the bid heard about BOTH records — the email and the task it produced',
  fuAssign.length === fuBeforeAssign + 2, String(fuAssign.length));
check('one entry is the correspondence',
  fuAssign.some(f => (f.text || '').startsWith('Correspondence ') && f.text.includes('linked to this record')),
  JSON.stringify(fuAssign.map(f => f.text)));
check('★ the other names the TASK and its serial',
  fuAssign.some(f => (f.text || '').startsWith('Task ') && /TK\d{6}/.test(f.text) && f.text.includes('created')),
  JSON.stringify(fuAssign.map(f => f.text)));

console.log('\n[10] the inline quick-assign inherits the link too');
const fuBeforeQuick = (await followUps('op2')).length;
await pickIn('Select employee', 'u-emp1', `window.__corrCard('CR000042')`);
await clickEl(`window.__one('button', 'Assign', window.__corrCard('CR000042'))`, 'Assign (quick)');
await sleep(1000);
const quickTask = (await allOf('tasks')).find(t => t.correspondingId === 'c-quick');
check('the quick-assign created its task', !!quickTask);
check('★ it inherited the bid link stored on the correspondence',
  (quickTask || {}).opportunityId === 'op2' && (quickTask || {}).opportunityTitle === 'Suez tank farm O&M',
  JSON.stringify([(quickTask || {}).opportunityId, (quickTask || {}).opportunityTitle]));
const fuQuick = await followUps('op2');
check('exactly one entry was posted for it', fuQuick.length === fuBeforeQuick + 1, String(fuQuick.length));
check('it names the new task', /Task TK\d{6}/.test(fuQuick[fuQuick.length - 1].text || ''), fuQuick[fuQuick.length - 1].text);

console.log('\n[11] the ManagerInbox conversion opens on the correspondence’s own link');
await evalJS(`window.__mount('inbox')`);
await sleep(900);
await evalJS(`window.scrollTo(0, 0)`);
// c-inbox is the one record no earlier step touched: linked to op1 AND p1, and
// still unassigned, so the inbox offers the conversion rather than a reassign.
await clickEl(`window.__one('.card', 'Bid bond issuance request')`, 'open correspondence in the inbox');
await sleep(600);
await clickEl(`window.__one('button', 'Assign as Task…')`, 'Assign as Task…');
await waitFor(`window.__panel()`, 'create-task panel');
await sleep(700);
await shot('4-conversion');
const inherited = await evalJS(`(() => {
  ${HELPERS}
  const s = window.__linkSelects(window.__panelRoot());
  return JSON.stringify({ n: s.length, opp: s[0].value, prj: s[1].value, locked: s[0].disabled });
})()`).then(JSON.parse);
check('the conversion form carries the picker', inherited.n === 2, String(inherited.n));
check('★ it OPENS on the bid the correspondence is linked to', inherited.opp === 'op1', inherited.opp);
check('★ and on its project', inherited.prj === 'p1', inherited.prj);
check('the inherited link stays editable — the manager may know better', inherited.locked === false);

const fuBeforeConv = (await followUps('op1')).length;
await evalJS(`(() => { ${HELPERS} window.__type(window.__panel(), 'Prepare the bid bond request'); })()`);
await sleep(200);
await clickEl(`window.__byText('button', 'Create Task', window.__panelRoot())[0]`, 'Create Task (conversion)');
await sleep(1200);
const convTask = (await allOf('tasks')).find(t => t.taskName === 'Prepare the bid bond request');
check('the conversion wrote the task', !!convTask);
check('★ the converted task carries both inherited links',
  (convTask || {}).opportunityId === 'op1' && (convTask || {}).projectId === 'p1',
  JSON.stringify([(convTask || {}).opportunityId, (convTask || {}).projectId]));
check('it still points back at its correspondence',
  !!(convTask || {}).correspondingId, (convTask || {}).correspondingId);
const fuConv = await followUps('op1');
check('★ exactly ONE entry was posted — the panel announces, the inbox does not',
  fuConv.length === fuBeforeConv + 1, String(fuConv.length));
check('and it names the task', (fuConv[fuConv.length - 1].text || '').startsWith('Task '), fuConv[fuConv.length - 1].text);

console.log('\n[12] the correspondence picker in Arabic / RTL');
await evalJS(`window.__mount('corr')`);
await sleep(800);
await evalJS(`window.__setLang('ar')`);
await sleep(700);
await evalJS(`window.scrollTo(0, 0)`);
await sleep(300);
await clickEl(`window.__one('button', 'مراسلة جديدة')`, 'New Correspondence (ar)');
await waitFor(`window.__form()`, 'form (ar)');
await sleep(600);
await evalJS(`(() => { ${HELPERS} const s = window.__linkSelects(window.__form())[0]; if (s) s.scrollIntoView({ block: 'center' }); })()`);
await sleep(300);
await shot('5-ar');
const ar = await evalJS(`(() => {
  ${HELPERS}
  const f = window.__form();
  const link = window.__linkSelects(f);
  return JSON.stringify({
    dir: document.documentElement.dir,
    section: (f.textContent || '').includes('السجلات المرتبطة'),
    labels: link.map(s => [...s.options][0].textContent),
    values: link.flatMap(s => [...s.options].map(o => o.value)),
    english: /Linked Records|Not linked to a bid|This correspondence/.test(f.textContent || ''),
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
await shot('6-ar-mobile');
const narrow = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check('no horizontal overflow at 390px', narrow <= 0, String(narrow));
await send('Emulation.clearDeviceMetricsOverride');
await sleep(200);
await evalJS(`window.__setLang('en')`);
await sleep(600);
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
    const p = path.join(ROOT, 'scripts/harness/maillinks-failure.png');
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
