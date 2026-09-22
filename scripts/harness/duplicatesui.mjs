// Click-through harness for duplicate / conflict detection (queue task D8).
//
// duplicates.mjs proves the rules (src/lib/duplicates.ts) in node. This proves
// the SCREENS in real Edge:
//   · the Duplicates page reading the four boards through the real onSnapshot +
//     subscribeVisibleTasks: groups, why-lines, the "entered first" chip, the
//     kind filters, "not a duplicate" (remembered across a remount, and undone),
//     rows opening their record, the client-file link, "Let them know" writing
//     one notification per person, a private task staying hidden;
//   · the New bid form warning as the tender number is typed, "Open it"
//     closing the form and opening the existing bid, no warning for a new tender;
//   · Arabic + RTL, and 390 px.
//
// Real code under test:  src/DuplicatesDashboard.tsx, src/lib/duplicates.ts,
//                        src/OpportunitiesDashboard.tsx, src/lib/deepLink.ts,
//                        src/lib/pushNotification.ts, src/i18n.ts + src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts.
//
//   node scripts/harness/duplicatesui.mjs   (--headed to watch it, --shot to write PNGs)

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-duplicatesui-'));

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
import DuplicatesDashboard from './src/DuplicatesDashboard';
import OpportunitiesDashboard from './src/OpportunitiesDashboard';
import { consumePending } from './src/lib/deepLink';
import i18n, { applyLanguageToDocument } from './src/i18n';

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1' },
  { id: 'u-mona', displayName: 'Mona Fathy',   email: 'm@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1' },
  { id: 'u-sami', displayName: 'Sami Adel',    email: 's@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1' },
];

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const ts = n => { const d = new Date(now.getTime() + n * 86400000); return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d, toMillis: () => d.getTime() }; };

// The same AGIBA tender entered twice, by two people, with the number typed two ways.
__seed('opportunities', 'o1', { title: 'AGIBA tank cleaning 2026', client: 'AGIBA', tenderNumber: 'RFQ-2026/118', stage: 'Bid Preparation', serialNumber: 'OP000011',
  submissionDeadline: dayOffset(20), ownerId: 'u-mona', ownerName: 'Mona Fathy', userId: 'u-mona', createdAt: ts(-12), updatedAt: ts(-12) });
__seed('opportunities', 'o2', { title: 'Tank cleaning — Meleiha', client: 'Agiba Co.', tenderNumber: 'rfq 2026 118', stage: 'Identified', serialNumber: 'OP000014',
  submissionDeadline: dayOffset(20), ownerId: 'u-sami', ownerName: 'Sami Adel', userId: 'u-sami', createdAt: ts(-2), updatedAt: ts(-2) });
// A different AGIBA tender Sami also holds — makes the "two people, one client" clash real.
__seed('opportunities', 'o3', { title: 'AGIBA valve overhaul', client: 'AGIBA', stage: 'Identified', serialNumber: 'OP000015',
  submissionDeadline: dayOffset(45), ownerId: 'u-sami', ownerName: 'Sami Adel', userId: 'u-sami', createdAt: ts(-1), updatedAt: ts(-1) });
// A look-alike that is NOT a duplicate (other year).
__seed('opportunities', 'o4', { title: 'EGPC Turnaround 2025', client: 'EGPC', stage: 'Lost', serialNumber: 'OP000004', createdAt: ts(-300), updatedAt: ts(-300) });
__seed('opportunities', 'o5', { title: 'EGPC Turnaround 2026', client: 'EGPC', stage: 'Identified', serialNumber: 'OP000016', ownerId: 'u-mona', ownerName: 'Mona Fathy', createdAt: ts(-3), updatedAt: ts(-3) });
__seed('opportunities', '--stats--', { count: 16 });

// The same letter logged twice.
__seed('correspondences', 'l1', { subject: 'Invoice No. 45 — March', sentFrom: 'AGIBA', dateReceived: dayOffset(-3), status: 'Unread', serialNumber: 'CR000201', userId: 'u-mgr', createdAt: ts(-3) });
__seed('correspondences', 'l2', { subject: 'invoice no 45 march', sentFrom: 'Agiba Co', dateReceived: dayOffset(-3), status: 'Unread', serialNumber: 'CR000202', userId: 'u-mona', createdAt: ts(-3) });

// One letter turned into a task twice.
__seed('tasks', 't1', { taskName: 'Reply to AGIBA invoice', status: 'Pending', isPrivate: false, assignedToId: 'u-mona', assignedTo: 'Mona Fathy', assignedById: 'u-mgr',
  correspondingId: 'l1', correspondingSerialNumber: 'CR000201', serialNumber: 'TK000401', createdAt: ts(-3) });
__seed('tasks', 't2', { taskName: 'Handle invoice 45', status: 'Pending', isPrivate: false, assignedToId: 'u-sami', assignedTo: 'Sami Adel', assignedById: 'u-mgr',
  correspondingId: 'l1', correspondingSerialNumber: 'CR000201', serialNumber: 'TK000402', createdAt: ts(-2) });
// Two PRIVATE copies of someone else's task — the manager may not see them, so they may not be flagged either.
__seed('tasks', 't3', { taskName: 'Private reminder', status: 'Pending', isPrivate: true, assignedToId: 'u-mona', createdAt: ts(-1) });
__seed('tasks', 't4', { taskName: 'Private reminder', status: 'Pending', isPrivate: true, assignedToId: 'u-mona', createdAt: ts(-1) });

// The same project, two contract-number spellings.
__seed('projects', 'p1', { name: 'AGIBA Meleiha', client: 'AGIBA', code: '4600001234', status: 'Active', serialNumber: 'PR000003', userId: 'u-mgr', createdAt: ts(-60) });
__seed('projects', 'p2', { name: 'Meleiha field services', client: 'AGIBA', code: '46000 01234', status: 'Active', serialNumber: 'PR000054', userId: 'u-mgr', createdAt: ts(-5) });

window.__nav = [];
window.__open = t => consumePending(t);

const me = USERS[0];
const user = { uid: me.id, displayName: me.displayName, email: me.email };
const root = createRoot(document.getElementById('root'));
let n = 0;
window.__mount = view => {
  n++;
  root.render(React.createElement('div', { className: 'app-main' },
    view === 'opps'
      ? React.createElement(OpportunitiesDashboard, { key: 'o' + n, user, appUser: me, projectUsers: USERS, onNavigate: v => { window.__nav.push(v); } })
      : view === 'blank' ? React.createElement('div', null, 'blank')
      : React.createElement(DuplicatesDashboard, { key: 'd' + n, user, appUser: me, projectUsers: USERS, onNavigate: v => { window.__nav.push(v); } })));
};
window.__mount('dup');

window.__type = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'duplicatesuiEntry.tsx', loader: 'tsx' },
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
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/duplicates',
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
  const p = path.join(ROOT, `scripts/harness/duplicatesui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const groups = () => evalJS(`JSON.stringify([...document.querySelectorAll('[data-dup="group"]')].map(g => ({ key: g.dataset.key, strength: g.dataset.strength })))`).then(JSON.parse);
const groupSel = key => `document.querySelector('[data-dup="group"][data-key="${key}"]')`;
const writes = () => evalJS(`JSON.stringify(window.__writes)`).then(JSON.parse);
const remount = async view => { await evalJS(`window.__mount('blank')`); await sleep(100); await evalJS(`window.__mount('${view}')`); await sleep(300); };

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] the page finds what was entered twice');
await waitFor(q('[data-dup="group"]'), 'groups');
await shot('1-page');
let gs = await groups();
check('four groups: the tender, the letter, the task, the project',
  JSON.stringify(gs.map(g => g.key).sort()) === JSON.stringify(['bid:o1,o2', 'letter:l1,l2', 'project:p1,p2', 'task:t1,t2']), JSON.stringify(gs));
check('all four are "almost certain"', gs.every(g => g.strength === 'certain'), JSON.stringify(gs));
check('the other-year Turnaround bids are left alone', !gs.some(g => g.key.includes('o4') || g.key.includes('o5')));
check('two private copies of Mona’s task are NOT shown to the manager', !(await evalJS(`document.body.textContent.includes('Private reminder')`)));
const head = await text('[data-dup="headline"]');
check('headline counts', head.includes('4 possible duplicates') && head.includes('4 almost certain') && head.includes('1 client with two bid owners'), head);
check('extra records line', (await text('[data-dup="summary"]')).includes('would remove 4 extra records'));
const bidWhy = await evalJS(`window.__txt(${groupSel('bid:o1,o2')}.querySelector('[data-dup="why"]'))`);
check('the tender says why: the number, as typed, and the client', bidWhy.includes('Same tender number (RFQ-2026/118)') && bidWhy.includes('Same client'), bidWhy);
check('the older copy comes first and is marked', await evalJS(`(() => { const r = ${groupSel('bid:o1,o2')}.querySelectorAll('[data-dup="record"]'); return r[0].dataset.id === 'o1' && !!r[0].querySelector('[data-dup="oldest"]') && !r[1].querySelector('[data-dup="oldest"]'); })()`));
const rowTxt = await evalJS(`window.__txt(${groupSel('bid:o1,o2')}.querySelector('[data-dup="record"]'))`);
check('a bid row shows serial, title, stage, client, owner', rowTxt.includes('OP000011') && rowTxt.includes('AGIBA tank cleaning 2026') && rowTxt.includes('Bid Preparation') && rowTxt.includes('Owner: Mona Fathy'), rowTxt);
check('the task group says it came from the same letter', (await evalJS(`window.__txt(${groupSel('task:t1,t2')}.querySelector('[data-dup="why"]'))`)).includes('Made from the same letter (CR000201)'));
check('the project group names the contract number', (await evalJS(`window.__txt(${groupSel('project:p1,p2')}.querySelector('[data-dup="why"]'))`)).includes('Same contract number (4600001234)'));

console.log('\n[2] two people, one client');
const clash = await text('[data-dup="clash"]');
check('AGIBA: Mona and Sami both hold open bids', clash.includes('AGIBA') && clash.includes('Mona Fathy') && clash.includes('Sami Adel') && clash.includes('AGIBA valve overhaul'), clash);
check('the client-file link points at AGIBA', (await evalJS(`${q('[data-dup="client-file"]')}.getAttribute('href')`)) === '#/clients?c=agiba');
const before = (await writes()).length;
await clickEl(q('[data-dup="tell"]'), 'Let them know');
await waitFor(`window.__txt(${q('[data-dup="message"]')}).length`, 'the confirmation');
const adds = (await writes()).slice(before).filter(w => w.op === 'add' && w.path.startsWith('notifications/'));
check('one notification for each of the two people', adds.map(a => a.data.forUserId).sort().join() === 'u-mona,u-sami', JSON.stringify(adds.map(a => a.data.forUserId)));
const toMona = adds.find(a => a.data.forUserId === 'u-mona')?.data;
check('Mona’s names Sami’s bids and opens one of them', toMona && toMona.type === 'opportunity_client_shared' && toMona.message.includes('Sami Adel') && toMona.message.includes('OP000014') && ['o2', 'o3'].includes(toMona.relatedId), JSON.stringify(toMona));
check('the button now says when they were told', (await text('[data-dup="tell"]')).includes('Told them on'));
check('nothing but notifications was written', (await writes()).slice(before).every(w => w.op === 'add' && w.path.startsWith('notifications/')));

console.log('\n[3] filters');
await clickEl(q('[data-dup="filter-letter"]'), 'Letters filter');
gs = await groups();
check('Letters shows only the letter group, no clash', gs.length === 1 && gs[0].key === 'letter:l1,l2' && !(await evalJS(`!!${q('[data-dup="clash"]')}`)), JSON.stringify(gs));
await clickEl(q('[data-dup="filter-clash"]'), 'clash filter');
check('"Two people, one client" shows only the clash', (await groups()).length === 0 && (await evalJS(`!!${q('[data-dup="clash"]')}`)));
await clickEl(q('[data-dup="filter-all"]'), 'All filter');

console.log('\n[4] "not a duplicate" is remembered, and can be undone');
await clickEl(`${groupSel('project:p1,p2')}.querySelector('[data-dup="dismiss"]')`, 'Not a duplicate');
check('the project group disappears', !(await evalJS(`!!${groupSel('project:p1,p2')}`)));
check('headline drops to 3', (await text('[data-dup="headline"]')).includes('3 possible duplicates'));
check('"1 marked not a duplicate" line', (await text('[data-dup="summary"]')).includes('1 marked “not a duplicate”'));
check('no write for a dismissal', (await writes()).every(w => !w.path.startsWith('projects/')));
await remount('dup');
await waitFor(q('[data-dup="group"]'), 'groups after remount');
check('still hidden after the page is opened again', !(await evalJS(`!!${groupSel('project:p1,p2')}`)));
await clickEl(q('[data-dup="toggle-dismissed"]'), 'Show them again');
check('Show them again brings it back, faded', await evalJS(`!!${groupSel('project:p1,p2')} && getComputedStyle(${groupSel('project:p1,p2')}).opacity < 1`));
await clickEl(`${groupSel('project:p1,p2')}.querySelector('[data-dup="undismiss"]')`, 'Check it again');
check('Check it again = counted again', (await text('[data-dup="headline"]')).includes('4 possible duplicates'));

console.log('\n[5] rows open their record');
await clickEl(`${groupSel('letter:l1,l2')}.querySelector('[data-dup="record"] button')`, 'letter row');
check('letter row → Correspondences, letter queued', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'correspondences' && (await evalJS(`window.__open('corresponding')`)) === 'l1');
await clickEl(`${groupSel('project:p1,p2')}.querySelectorAll('[data-dup="record"] button')[1]`, 'project row');
check('project row → Projects, project queued', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'projects' && (await evalJS(`window.__open('project')`)) === 'p2');
await clickEl(`${groupSel('bid:o1,o2')}.querySelector('[data-dup="record"] button')`, 'bid row');
check('bid row → Opportunities, bid queued', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'opportunities' && (await evalJS(`window.__open('opportunity')`)) === 'o1');

console.log('\n[6] Arabic + RTL, 390 px');
await evalJS(`window.__setLang('ar')`);
await sleep(600);
const ar = await evalJS(`document.body.textContent`);
check('page is RTL', (await evalJS(`document.documentElement.dir`)) === 'rtl');
check('Arabic title, strength and reasons', ar.includes('السجلات المكررة') && ar.includes('التطابق شبه مؤكد') && ar.includes('رقم المناقصة نفسه') && ar.includes('عميل واحد وأكثر من مسؤول'), ar.slice(0, 300));
check('no English UI copy left', !['Possible duplicates', 'Not a duplicate', 'Almost certainly', 'Let them know', 'Entered first', 'Same tender number'].some(s => ar.includes(s)));
check('no Arabic-Indic digits', !/[٠-٩]/.test(ar));
const banned = ar.match(/.{0,30}((^|\s)(تم|يتم|بواسطة)(\s|$)|الخاصة? ب).{0,30}/);
check('no «تم» / «بواسطة» / «الخاص بـ»', !banned, banned ? banned[0] : '');
await shot('2-ar');
check('no horizontal overflow at 1440 (RTL)', (await overflow()) <= 0);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(500);
check('no horizontal overflow at 390 px (RTL)', (await overflow()) <= 0, String(await overflow()));
await shot('3-ar-mobile');
await evalJS(`window.__setLang('en')`);
await sleep(400);
check('no horizontal overflow at 390 px (LTR)', (await overflow()) <= 0, String(await overflow()));
await shot('4-en-mobile');
await send('Emulation.clearDeviceMetricsOverride');
await sleep(300);

console.log('\n[7] the New bid form warns before a second copy is made');
await remount('opps');
await waitFor(`window.__one('button', 'New Opportunity')`, 'bids board');
await clickEl(`window.__one('button', 'New Opportunity')`, 'New Opportunity');
await waitFor(q('.modal'), 'the form');
check('an empty form shows no warning', !(await evalJS(`!!${q('[data-testid="opp-similar"]')}`)));
const tender = `(() => { const lab = [...document.querySelectorAll('.modal *')].find(e => e.children.length === 0 && window.__txt(e) === 'Tender / RFQ number'); let p = lab; for (let i = 0; i < 3 && p; i++, p = p.parentElement) { const c = p.querySelector('input'); if (c) return c; } return null; })()`;
const title = `document.querySelector('.modal input')`;
await evalJS(`window.__type(${title}, 'Some new tender')`);
await sleep(200);
check('a new title alone: no warning', !(await evalJS(`!!${q('[data-testid="opp-similar"]')}`)));
await evalJS(`window.__type(${tender}, 'RFQ 2026-118')`);
await waitFor(q('[data-testid="opp-similar"]'), 'the warning');
const warn = await text('[data-testid="opp-similar"]');
check('the number typed another way finds BOTH copies', (await evalJS(`document.querySelectorAll('[data-testid="opp-similar-row"]').length`)) === 2, warn);
check('it says the tender IS already there, with owner and stage', warn.includes('This tender is already on the board') && warn.includes('Mona Fathy') && warn.includes('Bid Preparation'), warn);
await shot('5-form');
check('Create is still allowed (a warning, not a block)', !(await evalJS(`window.__one('.modal button', 'Create opportunity').disabled`)));
await evalJS(`window.__type(${tender}, 'RFQ-999')`);
await sleep(200);
check('a different number: warning gone', !(await evalJS(`!!${q('[data-testid="opp-similar"]')}`)));
await evalJS(`window.__type(${tender}, 'rfq/2026/118')`);
await waitFor(q('[data-testid="opp-similar"]'), 'the warning again');
const beforeOpen = (await writes()).length;
await clickEl(`document.querySelector('[data-testid="opp-similar-open"]')`, 'Open it');
await waitFor(`!${q('.modal')}`, 'the form to close');
check('"Open it" closes the form and opens the existing bid', await evalJS(`document.body.textContent.includes('Tank cleaning — Meleiha') || document.body.textContent.includes('AGIBA tank cleaning 2026')`));
check('…and saved nothing', (await writes()).length === beforeOpen);

check('no uncaught page errors or console.errors during the whole run', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 800)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/duplicatesui-failure.png');
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
