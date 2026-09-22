// Click-through harness for the meeting helper (queue task D5).
//
// meetings.mjs proves the logic (src/lib/meetings.ts) in node. This proves the
// SCREENS in real Edge: the list and its Mine/Everyone scope, creating a
// meeting, agenda suggestions from the boards (carry-over, bid deadline,
// checklist step, late task), adding / reordering / saving the agenda, the
// invitation in EN + AR with a mailto draft, writing minutes, pulling action
// points out of the notes, creating the tasks (the task docs + the meeting
// doc written), the task state following the Tasks board, a cleared field
// really removed, filing the minutes on the project (once, then updated), a
// read-only meeting for someone not attending, Arabic + RTL and 390 px.
//
// Real code under test:  src/MeetingsDashboard.tsx, src/lib/meetings.ts, src/lib/quickCapture.ts,
//                        src/lib/projectDocuments.ts, src/lib/counters.ts, src/lib/recordLinks.ts,
//                        src/components/RecordLinkPicker.tsx, src/i18n.ts + src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store), src/lib/firebase.ts.
//
//   node scripts/harness/meetingsui.mjs   (--headed to watch it, --shot to write PNGs)

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-meetingsui-'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const FIREBASE_STUB = `
export const app = {};
export const db = { __fake: true };
export const auth = { currentUser: { uid: 'u-ahmed' } };
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
import MeetingsDashboard from './src/MeetingsDashboard';
import { consumePending } from './src/lib/deepLink';
import i18n, { applyLanguageToDocument } from './src/i18n';

const USERS = [
  { id: 'u-ahmed', displayName: 'Ahmed Nabil', email: 'a@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
  { id: 'u-mona',  displayName: 'Mona Fathy',  email: 'm@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
  { id: 'u-sara',  displayName: 'سارة عبد الله', email: 's@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
];

// Every date is relative to the real today, so the fixtures never rot.
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const ts = n => { const d = new Date(now.getTime() + n * 86400000); return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d, toMillis: () => d.getTime() }; };
window.__day = dayOffset;

__seed('tasks', '--stats--', { value: 500 });
__seed('opportunities', 'op1', { title: 'Algeria pipeline', client: 'Petrojet', stage: 'Bid Preparation', submissionDeadline: dayOffset(10), serialNumber: 'OP000012', userId: 'u-mona', createdAt: ts(-30),
  checklist: [ { id: 's1', title: 'Site visit', dueDate: dayOffset(2), done: false } ] });
__seed('projects', 'p1', { name: 'AGIBA Meleiha O&M', client: 'AGIBA', status: 'Active', serialNumber: 'PR000001', userId: 'u-mona', createdAt: ts(-100), updatedAt: ts(-1),
  documents: [ { id: 'old', kind: 'offer', title: 'Old offer', date: dayOffset(-40), addedById: 'u-mona', addedBy: 'Mona Fathy' } ] });
__seed('tasks', 'tp1', { taskName: 'Send the revised offer', status: 'In Progress', isPrivate: false, assignedToId: 'u-mona', assignedTo: 'Mona Fathy', dueDate: dayOffset(-1), serialNumber: 'TK000101', teamId: 'T1', createdAt: ts(-8) });
__seed('tasks', 'tlate', { taskName: 'Chase the bid bond', status: 'Pending', isPrivate: false, assignedToId: 'u-mona', assignedTo: 'Mona Fathy', dueDate: dayOffset(-6), serialNumber: 'TK000102', teamId: 'T1', createdAt: ts(-10) });

// Previous meeting of the series (with an unfinished action), the meeting under
// test (tomorrow, linked to the bid), one past without minutes, one done, one
// that is not mine, and a project meeting.
__seed('meetings', 'm0', { title: 'Weekly BD meeting 1', date: dayOffset(-6), time: '10:00', attendeeIds: ['u-ahmed', 'u-mona'], createdById: 'u-ahmed', createdBy: 'Ahmed Nabil',
  agenda: [ { id: 'a0', text: 'Pipeline' } ], notes: 'Short one.',
  actions: [ { id: 'pa1', text: 'Send the revised offer', ownerId: 'u-mona', ownerName: 'Mona Fathy', due: dayOffset(-1), priority: 'High', taskId: 'tp1', taskSerial: 'TK000101' } ] });
__seed('meetings', 'm1', { title: 'Weekly BD meeting 2', date: dayOffset(1), time: '10:00', place: 'Board room', attendeeIds: ['u-ahmed', 'u-mona'], createdById: 'u-ahmed', createdBy: 'Ahmed Nabil',
  opportunityId: 'op1', opportunitySerial: 'OP000012', opportunityTitle: 'Algeria pipeline', agenda: [], actions: [] });
__seed('meetings', 'm2', { title: 'Supplier call', date: dayOffset(-3), attendeeIds: ['u-ahmed'], createdById: 'u-ahmed', agenda: [ { id: 'x', text: 'Prices' } ], actions: [] });
__seed('meetings', 'm3', { title: 'Mona only — HR review', date: dayOffset(2), attendeeIds: ['u-mona'], createdById: 'u-mona', createdBy: 'Mona Fathy', agenda: [ { id: 'y', text: 'Leave plan' } ], actions: [] });
__seed('meetings', 'm4', { title: 'Meleiha kick-off', date: dayOffset(-1), attendeeIds: ['u-ahmed', 'u-sara'], createdById: 'u-ahmed', createdBy: 'Ahmed Nabil',
  projectId: 'p1', projectName: 'AGIBA Meleiha O&M', agenda: [ { id: 'k1', text: 'Mobilisation', notes: 'Crew arrives next week.', decision: 'Start on the 1st.' } ], actions: [] });

const user = { uid: 'u-ahmed', displayName: 'Ahmed Nabil', email: 'a@eprom.com.eg' };
window.__nav = [];
window.__open = t => consumePending(t);

function Shell() {
  const [view, setView] = React.useState('meetings');
  window.__go = setView;
  const nav = v => { window.__nav.push(v); setView(v); };
  if (view === 'meetings') return React.createElement(MeetingsDashboard, { user, appUser: USERS[0], projectUsers: USERS, onNavigate: nav });
  return React.createElement('div', { 'data-view': view }, view);
}

const root = createRoot(document.getElementById('root'));
root.render(React.createElement('div', { className: 'app-main' }, React.createElement(Shell)));

window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'meetingsuiEntry.tsx', loader: 'tsx' },
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
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/meetings',
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
  const p = path.join(ROOT, `scripts/harness/meetingsui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
async function typeInto(finderJS, value, label) {
  await clickEl(finderJS, label);
  await evalJS(`(() => { const el = ${finderJS}; el.select && el.select(); })()`);
  await send('Input.insertText', { text: value });
  await sleep(200);
}
async function setField(finderJS, value, label) {
  const ok = await evalJS(`(() => {
    const el = ${finderJS};
    if (!el) return false;
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return el.value === ${JSON.stringify(value)};
  })()`);
  if (!ok) throw new Error(`setField ${label}: value not applied`);
  await sleep(200);
}
const M = sel => `document.querySelector('[data-meet="${sel}"]')`;
const all = sel => `[...document.querySelectorAll('[data-meet="${sel}"]')]`;
const meetingDoc = id => evalJS(`JSON.stringify(window.__store.get('meetings').get(${JSON.stringify(id)}) || null)`).then(JSON.parse);
const rowIds = sec => evalJS(`JSON.stringify([...document.querySelectorAll('[data-meet="section-${sec}"] [data-meet="row"]')].map(r => r.dataset.id))`).then(JSON.parse);
const openMeeting = async id => {
  await evalJS(`window.location.hash = '#/meetings?id=${id}'`);
  await waitFor(`document.querySelector('[data-meet="editor"][data-id="${id}"]')`, `editor ${id}`);
};
const backToList = async () => {
  await evalJS(`window.location.hash = '#/meetings'`);
  await waitFor(`document.querySelector('[data-meet="section-upcoming"]')`, 'list');
};

// ═══════════════════════════════════════════════════════════════════════════
try {
  console.log('[1] The list and its scope');
  await waitFor(M('section-upcoming'), 'list');
  check('upcoming: mine only by default (the meeting I am not in is hidden)', JSON.stringify(await rowIds('upcoming')) === '["m1"]', JSON.stringify(await rowIds('upcoming')));
  check('minutes still to write: the past one with nothing written', JSON.stringify(await rowIds('needsMinutes')) === '["m2"]', JSON.stringify(await rowIds('needsMinutes')));
  check('earlier: the written-up ones, newest first', JSON.stringify(await rowIds('done')) === '["m4","m0"]', JSON.stringify(await rowIds('done')));
  check('a done meeting shows how many actions are done', /0\/1 actions done/.test(await evalJS(`window.__txt(document.querySelector('[data-id="m0"] [data-meet="row-actions"]'))`)));
  await clickEl(M('scope-all'), 'Everyone');
  check('Everyone shows the meeting I am not in', (await rowIds('upcoming')).includes('m3'));
  await clickEl(M('scope-mine'), 'Mine');
  await shot('1-list');

  console.log('[2] New meeting');
  await clickEl(M('new'), 'new');
  await waitFor(M('new-form'), 'form');
  const w0 = await evalJS('window.__writes.length');
  await clickEl(M('create'), 'create (no title)');
  check('no title → a message, nothing written', /Give the meeting a title/.test(await text('[data-meet="problem"]')) && (await evalJS('window.__writes.length')) === w0);
  await typeInto(M('new-title'), 'Pricing review', 'title');
  await setField(M('new-time'), '14:30', 'time');
  await clickEl(M('create'), 'create');
  await waitFor(`document.querySelector('[data-meet="editor"]')`, 'editor opens');
  const newId = await evalJS(`document.querySelector('[data-meet="editor"]').dataset.id`);
  const created = await meetingDoc(newId);
  check('written to meetings/ with me as creator and attendee', !!created && created.createdById === 'u-ahmed' && JSON.stringify(created.attendeeIds) === '["u-ahmed"]' && created.title === 'Pricing review' && created.time === '14:30');
  check('the address is #/meetings?id=<new>', (await evalJS('location.hash')) === `#/meetings?id=${newId}`);
  check('a new meeting opens on the agenda step', await evalJS(`document.querySelector('[data-meet="tab-agenda"]').getAttribute('aria-selected') === 'true'`));

  console.log('[3] Agenda suggestions from the boards');
  await openMeeting('m1');
  await waitFor(`document.querySelectorAll('[data-meet="suggestion"]').length >= 3`, 'suggestions');
  const sugg = await evalJS(`JSON.stringify(${all('suggestion')}.map(li => ({ key: li.dataset.key, source: li.dataset.source, text: window.__txt(li) })))`).then(JSON.parse);
  const sk = sugg.map(s => s.key);
  check('last meeting’s unfinished action is suggested first', sugg[0] && sugg[0].key === 'carry:m0:pa1' && /From the last meeting: Send the revised offer/.test(sugg[0].text), JSON.stringify(sugg[0]));
  check('the linked bid’s deadline', sk.includes('bid:op1') && /Bid “Algeria pipeline”: submission on/.test(sugg.find(s => s.key === 'bid:op1').text));
  check('the bid’s checklist step due in 2 days', sk.includes('step:op1:s1') && /Step “Site visit” on Algeria pipeline/.test(sugg.find(s => s.key === 'step:op1:s1').text));
  check('an attendee’s late task', sk.includes('task:tlate') && /Late task: Chase the bid bond — Mona Fathy — Was due/.test(sugg.find(s => s.key === 'task:tlate').text));
  const wBefore = await evalJS('window.__writes.length');
  await clickEl(`document.querySelector('[data-meet="suggestion"][data-key="bid:op1"] [data-meet="suggest-add"]')`, 'add bid');
  check('adding a suggestion puts it on the agenda…', (await evalJS(`${all('agenda-item')}.map(li => li.dataset.key).join()`)) === 'bid:op1');
  check('…and takes it off the suggestions', !(await evalJS(`!!document.querySelector('[data-meet="suggestion"][data-key="bid:op1"]')`)));
  await clickEl(`document.querySelector('[data-meet="suggestion"][data-key="carry:m0:pa1"] [data-meet="suggest-add"]')`, 'add carry');
  await typeInto(M('agenda-new'), 'Any other business', 'new item');
  await clickEl(M('agenda-add'), 'add item');
  let items = await evalJS(`JSON.stringify(${all('agenda-item')}.map(li => li.querySelector('input').value))`).then(JSON.parse);
  check('three agenda items in order', items.length === 3 && items[2] === 'Any other business', JSON.stringify(items));
  await clickEl(`${all('agenda-item')}[1].querySelector('[aria-label="Move up"]')`, 'move up');
  items = await evalJS(`JSON.stringify(${all('agenda-item')}.map(li => li.querySelector('input').value))`).then(JSON.parse);
  check('move up reorders', /^From the last meeting/.test(items[0]), JSON.stringify(items));
  check('nothing written until Save', (await evalJS('window.__writes.length')) === wBefore);
  check('the save bar says unsaved', /Unsaved changes/.test(await text('[data-meet="dirty"]')));
  await clickEl(M('save'), 'save');
  await waitFor(`/All changes saved/.test(window.__txt(${M('dirty')}))`, 'saved');
  let m1 = await meetingDoc('m1');
  check('ONE update to meetings/m1 with the 3 items, keys kept', (await evalJS('window.__writes.length')) === wBefore + 1 && m1.agenda.length === 3 && m1.agenda[1].key === 'bid:op1' && m1.agenda[0].ref.type === 'task');
  await shot('2-agenda');

  console.log('[4] The invitation');
  const invEn = await evalJS(`${M('invite-text')}.value`);
  check('EN invitation lists the agenda', /Agenda:\n1\. From the last meeting/.test(invEn) && /3\. Any other business/.test(invEn), invEn.slice(0, 200));
  check('…and names the linked bid', invEn.includes('Bid: OP000012 — Algeria pipeline'));
  const href = await evalJS(`${M('invite-mail')}.getAttribute('href')`);
  check('Open in email: a mailto draft to the other attendees, not me', href.startsWith('mailto:m%40eprom.com.eg?subject=') && !href.includes('a%40eprom'), href.slice(0, 80));
  await clickEl(M('lang-ar'), 'AR');
  const invAr = await evalJS(`${M('invite-text')}.value`);
  check('switching to عربي writes it in Arabic', invAr.startsWith('الزملاء الأعزاء،') && invAr.includes('جدول الأعمال:'));
  check('the Arabic text box is right-to-left', (await evalJS(`${M('invite-text')}.dir`)) === 'rtl');
  await clickEl(M('lang-en'), 'EN');

  console.log('[5] Minutes and action points out of the notes');
  await clickEl(M('tab-minutes'), 'minutes tab');
  await waitFor(`${all('minutes-item')}.length === 3`, 'minutes items');
  await typeInto(`${all('item-notes')}[1]`, 'Price still high.\nMona to send the revised offer by Thursday', 'notes');
  await typeInto(`${all('item-decision')}[1]`, 'Go ahead with 12% margin.', 'decision');
  await typeInto(M('notes'), 'Action: book the site visit', 'other notes');
  await clickEl(M('find-actions'), 'find actions');
  await waitFor(`document.querySelector('[data-meet="tab-actions"]').getAttribute('aria-selected') === 'true'`, 'actions tab');
  check('the notice says two were found', /Found 2 action points/.test(await text('[data-meet="notice"]')), await text('[data-meet="notice"]'));
  let acts = await evalJS(`JSON.stringify(${all('action')}.map(li => ({ text: li.querySelector('[data-meet="action-text"]').value, owner: li.querySelector('[data-meet="action-owner"]').value, due: li.querySelector('[data-meet="action-due"]').value, state: li.dataset.state })))`).then(JSON.parse);
  check('two draft action points', acts.length === 2 && acts.every(a => a.state === 'draft'), JSON.stringify(acts));
  check('"Mona to send …" → owner Mona, a date', acts[0].owner === 'u-mona' && /^\d{4}-\d{2}-\d{2}$/.test(acts[0].due), JSON.stringify(acts[0]));
  check('"Action: book the site visit" → no owner yet', acts[1].text === 'Book the site visit' && acts[1].owner === '');
  check('"Price still high." is not an action', !acts.some(a => /Price still high/.test(a.text)));
  await clickEl(M('tab-minutes'), 'back to minutes');
  await clickEl(M('find-actions'), 'find again');
  await waitFor(`/No new action points/.test(window.__txt(${M('notice')}))`, 'no-new notice').catch(() => {});
  check('pressing it again adds nothing', /No new action points/.test(await text('[data-meet="notice"]')), await text('[data-meet="notice"]'));
  await clickEl(M('tab-actions'), 'actions tab');
  check('…still two action points', (await evalJS(`${all('action')}.length`)) === 2);
  await setField(`${all('action')}[1].querySelector('[data-meet="action-owner"]')`, 'u-sara', 'owner Sara');
  check('the button offers two tasks', /Create 2 tasks/.test(await text('[data-meet="create-tasks"]')));
  await shot('3-actions');

  console.log('[6] Create the tasks');
  const w1 = await evalJS('window.__writes.length');
  await clickEl(M('create-tasks'), 'create tasks');
  await waitFor(`/2 tasks created/.test(window.__txt(${M('notice')}))`, 'tasks created', 8000);
  const writes = await evalJS(`JSON.stringify(window.__writes.slice(${w1}))`).then(JSON.parse);
  const taskAdds = writes.filter(w => w.op === 'add' && w.path.startsWith('tasks/'));
  check('two task docs written', taskAdds.length === 2, JSON.stringify(writes.map(w => w.op + ' ' + w.path)));
  const tMona = taskAdds.find(w => w.data.assignedToId === 'u-mona');
  const tSara = taskAdds.find(w => w.data.assignedToId === 'u-sara');
  check('Mona’s task: assigned by me, public, Pending, with its date', !!tMona && tMona.data.assignedById === 'u-ahmed' && tMona.data.isPrivate === false && tMona.data.status === 'Pending' && /^\d{4}-/.test(tMona.data.dueDate));
  check('serials from the counter: TK000501 / TK000502', !!tMona && tMona.data.serialNumber === 'TK000501' && !!tSara && tSara.data.serialNumber === 'TK000502');
  check('each task carries the meeting and the bid link', taskAdds.every(w => w.data.meetingId === 'm1' && w.data.opportunityId === 'op1' && w.data.opportunitySerial === 'OP000012'));
  check('the description names the meeting', /From the meeting "Weekly BD meeting 2" on \d{2}\/\d{2}\/\d{4}\./.test(tMona.data.description));
  check('no undefined values in a task doc', taskAdds.every(w => !Object.values(w.data).some(v => v === undefined)));
  check('both owners notified (not me)', writes.filter(w => w.op === 'add' && w.path.startsWith('notifications/')).map(w => w.data.forUserId).sort().join() === 'u-mona,u-sara');
  check('the bid heard about each task (history echo)', writes.filter(w => w.op === 'add' && w.path.startsWith('opportunityFollowUps/')).length === 2);
  m1 = await meetingDoc('m1');
  check('the meeting doc keeps each task id + serial', m1.actions.length === 2 && m1.actions.every(a => a.taskId && /^TK00050[12]$/.test(a.taskSerial)));
  check('minutes saved with the actions (notes, decision)', m1.agenda[1].notes.includes('Mona to send') && m1.agenda[1].decision === 'Go ahead with 12% margin.' && m1.notes === 'Action: book the site visit');
  await waitFor(`${all('action')}.every(li => li.dataset.state === 'open')`, 'states open');
  check('each action now shows its serial and “Still open”', /TK000501\s*Still open/.test(await evalJS(`window.__txt(${all('action')}[0].querySelector('[data-meet="action-state"]'))`)));
  check('a task-made action is locked (text read-only)', await evalJS(`${all('action')}[0].querySelector('[data-meet="action-text"]').readOnly === true`));
  check('nothing left to create', await evalJS(`${M('create-tasks')}.disabled === true`));
  const w2 = await evalJS('window.__writes.length');
  await evalJS(`${M('create-tasks')}.click()`);
  await sleep(300);
  check('a second press creates nothing', (await evalJS('window.__writes.length')) === w2);

  console.log('[7] The state follows the Tasks board');
  await evalJS(`(() => { const id = window.__store.get('meetings').get('m1').actions[0].taskId; const t = window.__store.get('tasks').get(id); window.__store.get('tasks').set(id, { ...t, status: 'Done' }); window.__emit(); })()`);
  await waitFor(`${all('action')}[0].dataset.state === 'done'`, 'done state');
  check('marked Done on the board → “Done” here', /Done/.test(await evalJS(`window.__txt(${all('action')}[0].querySelector('[data-meet="action-state"]'))`)));
  check('the summary counts it', /2 of 2 are tasks · 1 done · 0 late/.test(await text('[data-meet="actions-summary"]')), await text('[data-meet="actions-summary"]'));
  await clickEl(`${all('action')}[0].querySelector('[data-meet="open-task"]')`, 'open task');
  check('clicking the serial opens the task on the Tasks board', (await evalJS('window.__nav[window.__nav.length - 1]')) === 'tasks' && (await evalJS(`window.__open('task')`)) === (await meetingDoc('m1')).actions[0].taskId);
  await evalJS(`window.__go('meetings')`);
  await openMeeting('m1');

  console.log('[8] A cleared field is really removed');
  await setField(M('place'), '', 'clear place');
  await clickEl(M('save'), 'save');
  await waitFor(`/All changes saved/.test(window.__txt(${M('dirty')}))`, 'saved');
  m1 = await meetingDoc('m1');
  check('place is gone from the doc (not left behind by the merge)', !('place' in m1), JSON.stringify(m1.place));
  check('the rest is intact', m1.agenda.length === 3 && m1.actions.length === 2 && m1.createdById === 'u-ahmed');

  console.log('[9] Minutes filed on the project — once, then updated');
  await openMeeting('m4');
  check('a past meeting opens on the minutes step', await evalJS(`document.querySelector('[data-meet="tab-minutes"]').getAttribute('aria-selected') === 'true'`));
  const minEn = await evalJS(`${M('minutes-text')}.value`);
  check('draft minutes: attendees, item, notes, decision', /Attendees: Ahmed Nabil, سارة عبد الله/.test(minEn) && /Discussed: Crew arrives next week\./.test(minEn) && /Decision: Start on the 1st\./.test(minEn), minEn.slice(0, 300));
  await clickEl(M('file-minutes'), 'file');
  await waitFor(`/filed on the project/.test(window.__txt(${M('notice')}))`, 'filed');
  let docs = await evalJS(`JSON.stringify(window.__store.get('projects').get('p1').documents)`).then(JSON.parse);
  const filed = docs.find(d => d.kind === 'minutes');
  check('a minutes document on the project, the old one kept', docs.length === 2 && !!filed && filed.direction === 'internal' && /^Minutes of meeting: Meleiha kick-off/.test(filed.title) && filed.summary.includes('Start on the 1st.'));
  check('the meeting remembers it', (await meetingDoc('m4')).minutesDocId === filed.id);
  check('the button now says “Update the copy”', /Update the copy on the project/.test(await text('[data-meet="file-minutes"]')));
  await typeInto(`${all('item-decision')}[0]`, 'Start on the 3rd.', 'new decision');
  await clickEl(M('file-minutes'), 'file again');
  await waitFor(`/filed on the project/.test(window.__txt(${M('notice')}))`, 'filed again');
  docs = await evalJS(`JSON.stringify(window.__store.get('projects').get('p1').documents)`).then(JSON.parse);
  check('filing again UPDATES the same entry, no duplicate', docs.length === 2 && docs.filter(d => d.kind === 'minutes').length === 1 && docs.find(d => d.kind === 'minutes').summary.includes('Start on the 3rd.'));

  console.log('[10] Someone else’s meeting is read-only');
  await openMeeting('m3');
  check('no save bar', !(await evalJS(`!!${M('save-bar')}`)));
  check('title read-only', await evalJS(`${M('title')}.readOnly === true`));
  check('no suggestions box, no Add', !(await evalJS(`!!${M('suggestions')} || !!${M('agenda-add')}`)));
  check('the reason is said', /Only the people attending/.test(await evalJS('document.body.textContent')));

  console.log('[11] Arabic + RTL');
  await openMeeting('m1');
  await evalJS(`window.__setLang('ar')`);
  await sleep(500);
  check('<html dir="rtl">', (await evalJS('document.documentElement.dir')) === 'rtl');
  const arBody = await evalJS('document.body.textContent');
  check('steps in Arabic', arBody.includes('1. جدول الأعمال (قبل)') && arBody.includes('2. المحضر (بعد)') && arBody.includes('المهام المطلوبة'));
  check('no «تم» / «يتم» / «بواسطة» on the page', !/(^|\s)(تم|يتم|بواسطة)(\s|$)/.test(arBody));
  check('no Latin comma inside Arabic text', !/[؀-ۿ],/.test(arBody));
  check('no horizontal overflow at 1440 (RTL)', (await overflow()) <= 0, String(await overflow()));
  await clickEl(M('tab-actions'), 'actions (ar)');
  check('action states in Arabic («منجز»)', /TK000501\s*منجز/.test(await evalJS(`window.__txt(${all('action')}[0].querySelector('[data-meet="action-state"]'))`)), await evalJS(`window.__txt(${all('action')}[0].querySelector('[data-meet="action-state"]'))`));
  await shot('4-ar');
  await backToList();
  check('list headings in Arabic', (await evalJS('document.body.textContent')).includes('اليوم والقادم'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  check('no horizontal overflow at 390px — list (RTL)', (await overflow()) <= 0, String(await overflow()));
  await openMeeting('m1');
  await sleep(300);
  check('no horizontal overflow at 390px — meeting (RTL)', (await overflow()) <= 0, String(await overflow()));
  await clickEl(M('tab-actions'), 'actions mobile');
  check('no horizontal overflow at 390px — action points (RTL)', (await overflow()) <= 0, String(await overflow()));
  await shot('5-ar-mobile');
  await evalJS(`window.__setLang('en')`);
  await sleep(400);
  await clickEl(M('tab-agenda'), 'agenda mobile en');
  check('no horizontal overflow at 390px — agenda (LTR)', (await overflow()) <= 0, String(await overflow()));
  await shot('6-en-mobile');
  await send('Emulation.clearDeviceMetricsOverride');

  console.log('[12] Delete');
  await openMeeting(newId);
  await evalJS(`window.confirm = () => true`);
  await clickEl(M('delete'), 'delete');
  await waitFor(M('section-upcoming'), 'back on the list');
  check('the meeting doc is gone', (await meetingDoc(newId)) === null);

  check('no uncaught page errors or console.errors during the whole run', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 600)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/meetingsui-failure.png');
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
