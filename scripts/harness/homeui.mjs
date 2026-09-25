// Click-through harness for Home as a briefing page (queue task E1).
//
// homebriefing.mjs proves the sentences (src/lib/homeBriefing.ts) in node. This
// proves the SCREEN: the real HomeDashboard reading the boards through the real
// subscribeVisibleTasks + onSnapshot and the Outlook helper through a faked
// fetch — the sentences, their wording, where each one leads, the manager vs
// employee scope, the "all clear" state, "All sections" one level down,
// Arabic + RTL and 390 px.
//
// Real code under test:  src/HomeDashboard.tsx, src/lib/homeBriefing.ts,
//                        src/lib/dailyBriefing.ts, src/lib/offerApproval.ts,
//                        src/lib/deadlineCalendar.ts, src/lib/mailThreads.ts,
//                        src/lib/taskVisibility.ts, src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts, window.fetch (the Outlook helper).
//
//   node scripts/harness/homeui.mjs   (--headed to watch it, --shot to write PNGs)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-homeui-'));

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
import HomeDashboard from './src/HomeDashboard';
import { subscribeOpen } from './src/lib/deepLink';
import i18n, { applyLanguageToDocument } from './src/i18n';

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Business Development' },
  { id: 'u-ahmed', displayName: 'Ahmed Samir', email: 'a@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
  { id: 'u-mona', displayName: 'Mona Fathy', email: 'm@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
  { id: 'u-new', displayName: 'Sara Adel', email: 's@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
];

// Every date is relative to the real today, so the fixtures never rot.
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));

const T = (id, extra) => __seed('tasks', id, { description: '', status: 'In Progress', isPrivate: false, createdAt: dayOffset(-30), userId: 'u-mgr', teamId: 'T1', ...extra });
T('t1', { taskName: 'Prepare the AGIBA offer', dueDate: dayOffset(-9), assignedToId: 'u-ahmed', assignedTo: 'Ahmed Samir', serialNumber: 'TK000301' });
T('t2', { taskName: 'Site survey report', dueDate: dayOffset(-3), assignedToId: 'u-ahmed', assignedTo: 'Ahmed Samir', serialNumber: 'TK000302' });
T('t3', { taskName: 'Call Petrogas about the invoice', dueDate: dayOffset(0), assignedToId: 'u-mgr', assignedTo: 'Tariq Salama', serialNumber: 'TK000303' });
T('t4', { taskName: 'Finished long ago', dueDate: dayOffset(-20), status: 'Done', assignedToId: 'u-ahmed', assignedTo: 'Ahmed Samir', serialNumber: 'TK000304' });
// Somebody else's PRIVATE late task: the manager's briefing must not count it.
T('t5', { taskName: 'Private Mona note', dueDate: dayOffset(-4), isPrivate: true, userId: 'u-mona', assignedToId: 'u-mona', assignedTo: 'Mona Fathy', serialNumber: 'TK000305' });

const C = (id, extra) => __seed('correspondences', id, { body: '', sentFrom: 'NNPC', dateReceived: dayOffset(-10), userId: 'u-mgr', teamId: 'T1', ...extra });
C('l1', { subject: 'Clarification on scope', deadline: dayOffset(-1), status: 'Assigned', assignedToId: 'u-mona', assignedTo: 'Mona Fathy', serialNumber: 'CR000401' });
C('l2', { subject: 'New enquiry from WEPCO', status: 'Unread', serialNumber: 'CR000402' });
C('l3', { subject: 'Invitation to tender', status: 'Reviewing', serialNumber: 'CR000403' });

__seed('opportunities', 'o1', { title: 'Tank farm maintenance', client: 'NNPC', stage: 'Bid Preparation', submissionDeadline: dayOffset(3), ownerId: 'u-ahmed', ownerName: 'Ahmed Samir', serialNumber: 'OP000011' });
__seed('opportunities', 'o2', { title: 'Terminal upgrade', client: 'Petromint', stage: 'Bid Preparation', submissionDeadline: dayOffset(20), ownerId: 'u-ahmed', ownerName: 'Ahmed Samir', serialNumber: 'OP000012',
  estimatedValue: 5000000, currency: 'EGP',
  approval: { status: 'requested', amount: 5000000, currency: 'EGP', requestedById: 'u-ahmed', requestedByName: 'Ahmed Samir', requestedAt: Date.now() - 2 * 86400e3, log: [] } });
__seed('opportunities', 'o3', { title: 'Already sent', client: 'GUPCO', stage: 'Submitted', submissionDeadline: dayOffset(2), ownerId: 'u-ahmed', serialNumber: 'OP000013' });

__seed('projects', 'p1', { name: 'Meleiha tanks', client: 'AGIBA', status: 'Active', serialNumber: 'PR000003' });
__seed('projectContracts', 'k1', { projectId: 'p1', subject: 'Tank cleaning', contractNumber: 'C-2201', endDate: dayOffset(12), status: 'Active' });

// The Outlook helper on localhost.
window.__bridgeOn = true;
const at = days => new Date(now.getTime() - days * 86400e3).toISOString();
const MAIL = [
  { id: 'm1', subject: 'Site visit dates', sender: 'Ahmed Kamal', sender_email: 'ahmed@enppi.com', to: 'Tariq', recipients: ['Tariq'], direction: 'received', folder: 'Inbox', received_at: at(6) },
  { id: 'm2a', subject: 'Clarification 3', sender: 'NOC Oman Tenders', sender_email: 'tenders@noc.om', to: 'Tariq', recipients: ['Tariq'], direction: 'received', folder: 'Inbox', received_at: at(12) },
  { id: 'm2', subject: 'RE: Clarification 3', sender: 'Tariq', to: 'NOC Oman Tenders', recipients: ['NOC Oman Tenders'], direction: 'sent', folder: 'Sent Items', received_at: at(9) },
];
window.fetch = async (url) => {
  let u; try { u = new URL(String(url)); } catch { return { ok: true, json: async () => ({}), text: async () => '' }; }
  if (u.port === '5111') {
    if (!window.__bridgeOn) throw new TypeError('Failed to fetch');
    if (u.pathname === '/status') return { ok: true, json: async () => ({ running: true, outlook_connected: true }) };
    if (u.pathname === '/emails') { const folder = u.searchParams.get('folder'); return { ok: true, json: async () => MAIL.filter(m => m.folder === folder) }; }
  }
  return { ok: true, json: async () => ({ status: 'success' }), text: async () => '' };
};

window.__nav = [];
window.__opened = [];
subscribeOpen(r => { window.__opened.push({ type: r.type, id: r.id }); });
const root = createRoot(document.getElementById('root'));
let seq = 0;
// A fresh key per mount: HomeDashboard keeps its state across re-renders, so a
// role switch without a remount would assert against the previous reader.
window.__mount = (uid, bridge = true) => {
  window.__bridgeOn = bridge;
  const appUser = USERS.find(u => u.id === uid);
  const user = { uid, displayName: appUser.displayName, email: appUser.email };
  root.render(
    React.createElement('div', { className: 'app-main', style: { maxWidth: 1100, margin: '0 auto', padding: 16 } },
      React.createElement(HomeDashboard, {
        key: uid + ':' + (++seq), user, appUser, projectUsers: USERS,
        dueSoonCount: 3, announcementCount: 1, unreadNotifications: 0,
        navCounts: { corrNeedsReview: 2, corrUnread: 1, myActiveTasks: 2, openBids: 3, bidsDueSoon: 1 },
        onNavigate: v => { window.__nav.push(v); },
      }),
    ),
  );
};
window.__mount('u-mgr');

window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e =>
  window.__errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'homeuiEntry.tsx', loader: 'tsx' },
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
  const p = path.join(ROOT, `scripts/harness/homeui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}

const lineKeys = () => evalJS(`JSON.stringify([...document.querySelectorAll('[data-line]')].map(b => b.dataset.line))`).then(JSON.parse);
const headlineOf = k => evalJS(`window.__txt(document.querySelector('[data-line="${k}"] [data-headline]'))`);
const detailOf = k => evalJS(`(() => { const d = document.querySelector('[data-line="${k}"] [data-detail]'); return d ? window.__txt(d) : ''; })()`);
const heading = () => evalJS(`window.__txt(document.getElementById('home-briefing-h'))`);
const LINE = k => `document.querySelector('[data-line="${k}"] [data-line-go]')`;
const LEAD = k => `document.querySelector('[data-line="${k}"] [data-lead]')`;
const sectionIds = () => evalJS(`JSON.stringify([...document.querySelectorAll('[data-section]')].map(b => b.dataset.section))`).then(JSON.parse);
async function mount(uid, bridge = true) {
  await evalJS(`window.__mount(${JSON.stringify(uid)}, ${bridge})`);
  await waitFor(`document.querySelector('[data-line], [data-briefing-state="clear"]')`, 'the briefing');
  // The Outlook helper answers after the boards — give the mail line its turn.
  if (bridge) await waitFor(`document.querySelector('[data-line="mail"]')`, 'the mail line', 4000).catch(() => {});
  await sleep(250);
}

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] a manager opens Home — sentences, not a menu');
await mount('u-mgr');
let keys = await lineKeys();
await shot('1-manager');
check('heading: "The department today"', (await heading()) === 'The department today', await heading());
check('★ seven sentences, most urgent first', keys.join(',') === 'late,today,signoff,bids,mail,review,contracts', keys.join(','));
check('★ late: 3 across the department (Ahmed ×2 + Mona’s letter; Done and PRIVATE tasks left out)',
  (await headlineOf('late')) === '3 items are late across the department', await headlineOf('late'));
let d = await detailOf('late');
check('late names the longest late, with its serial and age', d.includes('Longest late: TK000301 Prepare the AGIBA offer') && d.includes('9 days late'), d);
check('★ late says whose desk it sits on', d.includes('most with Ahmed Samir (2)'), d);
check('today: 1 across the department', (await headlineOf('today')) === '1 item is due today across the department', await headlineOf('today'));
check('today names the record, not a redundant "due today"', (await detailOf('today')) === 'Among them: TK000303 Call Petrogas about the invoice', await detailOf('today'));
check('sign-off: the existing wording, oldest request, who asked',
  (await headlineOf('signoff')) === '1 offer waiting for your sign-off' && (await detailOf('signoff')).includes('Oldest request: OP000012 Terminal upgrade · from Ahmed Samir'), await detailOf('signoff'));
check('★ tenders: 1 closes this week (the Submitted one is not counted)', (await headlineOf('bids')) === '1 tender closes this week', await headlineOf('bids'));
check('tenders name the nearest and when', (await detailOf('bids')).includes('Nearest: OP000011 Tank farm maintenance · in 3 days'), await detailOf('bids'));
check('★ mail: 1 waiting on us + 1 of ours unanswered, from this PC', (await headlineOf('mail')) === '1 e-mail is waiting for a reply from us'
  && (await detailOf('mail')).includes('1 e-mail we sent has had no answer yet') && (await detailOf('mail')).includes('From the Outlook on this PC.'), await detailOf('mail'));
check('review: 2 letters (Unread + Reviewing)', (await headlineOf('review')) === '2 letters are waiting for your review', await headlineOf('review'));
check('contracts: 1 runs out within 60 days, nearest named', (await headlineOf('contracts')) === '1 contract runs out within 60 days'
  && (await detailOf('contracts')).includes('Tank cleaning') && (await detailOf('contracts')).includes('12 days from now'), await detailOf('contracts'));
check('the Private task never appears', !(await evalJS(`document.body.textContent.includes('Private Mona note')`)));

console.log('\n[2] each sentence opens the page that handles it');
for (const [k, view] of [['late', 'due-soon'], ['today', 'due-soon'], ['signoff', 'opportunities'], ['bids', 'opportunities'], ['mail', 'waiting'], ['review', 'correspondences'], ['contracts', 'calendar']]) {
  await clickEl(LINE(k), `the ${k} line`);
  const last = await evalJS(`window.__nav.slice(-1)[0]`);
  check(`${k} → ${view}`, last === view, last);
}
check('clicking a line itself opens no single record', (await evalJS(`window.__opened.length`)) === 0);

console.log('\n[2b] the record a sentence names opens that very record');
for (const [k, type, id, view] of [
  ['late', 'task', 't1', 'tasks'], ['today', 'task', 't3', 'tasks'], ['signoff', 'opportunity', 'o2', 'opportunities'],
  ['bids', 'opportunity', 'o1', 'opportunities'], ['contracts', 'project', 'p1', 'projects'],
]) {
  await clickEl(LEAD(k), `the record in the ${k} line`);
  const opened = await evalJS(`JSON.stringify(window.__opened.slice(-1)[0] || null)`).then(JSON.parse);
  const last = await evalJS(`window.__nav.slice(-1)[0]`);
  check(`★ ${k}: opens ${type} ${id} on ${view}`, opened && opened.type === type && opened.id === id && last === view, JSON.stringify(opened) + ' ' + last);
}
check('one click = one navigation (the row underneath does not fire too)', await evalJS(`(() => { const n = window.__nav.length; document.querySelector('[data-line="late"] [data-lead]').click(); return window.__nav.length === n + 1 && window.__nav[n] === 'tasks'; })()`));
check('mail and review lines name no record, so offer no record link', !(await evalJS(`!!document.querySelector('[data-line="mail"] [data-lead], [data-line="review"] [data-lead]')`)));
check('the record link is a real button (keyboard reachable)', await evalJS(`document.querySelector('[data-line="late"] [data-lead]').tagName === 'BUTTON'`));

console.log('\n[3] All sections first and always open; the two boxes float on the side');
let sections = await sectionIds();
check('★ All sections is open on first sight (no toggle)', sections.length > 0 && !(await evalJS(`!!document.querySelector('[data-sections] button[aria-expanded]')`)));
check('★ All sections sits ABOVE the briefing', await evalJS(`(() => {
  const s = document.querySelector('[data-sections]'); const b = document.querySelector('[data-briefing]');
  return !!(s && b && (s.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
})()`));
check('it lists every section a manager can reach', ['due-soon', 'tasks', 'waiting', 'calendar', 'opportunities', 'clients', 'overview', 'weekly-report', 'archive'].every(s => sections.includes(s)), sections.join(','));
check('a manager (not Admin) does not see Users', !sections.includes('admin'));
check('★ neither box is in the page before its button is used', !(await evalJS(`!!document.getElementById('ask-box') || !!document.getElementById('quick-capture')`)));
check('two floating buttons, fixed to the side', await evalJS(`(() => {
  const r = document.querySelector('[data-home-tools]'); if (!r) return false;
  const bs = r.querySelectorAll('[data-home-tool-btn]'); const box = r.getBoundingClientRect();
  return getComputedStyle(r).position === 'fixed' && bs.length === 2 && Math.abs(box.right - document.documentElement.clientWidth) < 2;
})()`));
await clickEl(`document.querySelector('[data-home-tool-btn="ask"]')`, 'the Ask button');
await sleep(250);
check('★ the Ask button opens the Ask box in a panel', await evalJS(`window.__vis(document.getElementById('ask-box'))`));
check('the cursor is put in the box', await evalJS(`!!document.activeElement && document.activeElement.id === 'ask-box'`));
await shot('2-ask-panel');
await clickEl(`document.querySelector('[data-home-tool-btn="capture"]')`, 'the Add button');
await sleep(250);
check('the Add button swaps to the Add anything box', await evalJS(`window.__vis(document.getElementById('quick-capture')) && !window.__vis(document.getElementById('ask-box'))`));
await evalJS(`(() => { const el = document.getElementById('quick-capture'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, 'Call Petrojet tomorrow'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(150);
await clickEl(`document.querySelector('.home-tool-backdrop')`, 'outside the panel');
await sleep(150);
check('a click outside closes the panel', !(await evalJS(`window.__vis(document.getElementById('quick-capture'))`)));
await clickEl(`document.querySelector('[data-home-tool-btn="capture"]')`, 'the Add button again');
await sleep(250);
check('★ what was typed is still there after closing and reopening', (await evalJS(`document.getElementById('quick-capture').value`)) === 'Call Petrojet tomorrow');
await evalJS(`document.getElementById('quick-capture').blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(150);
check('Escape closes the panel', !(await evalJS(`window.__vis(document.getElementById('quick-capture'))`)));
await shot('3-sections');
await clickEl(`document.querySelector('[data-section="clients"]')`, 'Clients');
check('a section opens its page', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'clients');

console.log('\n[4] an employee sees only their own work');
await mount('u-ahmed');
keys = await lineKeys();
await shot('3-employee');
check('heading: "Your day"', (await heading()) === 'Your day', await heading());
check('★ late, tenders, mail — no manager lines', keys.join(',') === 'late,bids,mail', keys.join(','));
check('★ "2 of your items are late" (Mona’s letter is not his)', (await headlineOf('late')) === '2 of your items are late', await headlineOf('late'));
check('no "most with" for an employee', !(await detailOf('late')).includes('most with'));
check('"1 of your tenders closes this week"', (await headlineOf('bids')) === '1 of your tenders closes this week', await headlineOf('bids'));
sections = await sectionIds();
check('All sections is open for an employee too', sections.length > 0);
check('an employee gets no Insights sections', !sections.some(s => ['overview', 'bid-analytics', 'weekly-report', 'duplicates'].includes(s)), sections.join(','));

console.log('\n[5] nothing to say → one calm sentence');
await mount('u-new', false);
check('★ all clear', (await evalJS(`window.__txt(document.querySelector('[data-briefing-state="clear"]'))`)) === 'Nothing is late and nothing is due today.');
check('no sentence rows when all is clear', (await lineKeys()).length === 0);
check('no mail line when the Outlook helper is not running', !(await evalJS(`!!document.querySelector('[data-line="mail"]')`)));

console.log('\n[6] Arabic + RTL');
await evalJS(`window.__setLang('ar')`);
await mount('u-mgr');
await shot('4-ar');
check('page is RTL', (await evalJS(`document.documentElement.dir`)) === 'rtl');
check('Arabic heading', (await heading()) === 'القسم اليوم', await heading());
check('★ late reads Arabic', (await headlineOf('late')) === 'تأخّر في القسم 3 من الأعمال', await headlineOf('late'));
check('today reads Arabic', (await headlineOf('today')) === 'يحلّ اليوم موعد عمل واحد في القسم', await headlineOf('today'));
check('tenders read Arabic', (await headlineOf('bids')) === 'ينتهي هذا الأسبوع موعد تقديم عطاء واحد', await headlineOf('bids'));
check('contracts read Arabic (60 يومًا)', (await headlineOf('contracts')) === 'ينتهي عقد واحد خلال 60 يومًا', await headlineOf('contracts'));
d = await detailOf('late');
check('late detail reads Arabic', d.includes('الأطول تأخرًا') && d.includes('أكثرها لدى Ahmed Samir (2)'), d);
const briefTxt = await evalJS(`window.__txt(document.querySelector('[data-briefing]'))`);
const DATA = /Ahmed Samir|Prepare the AGIBA offer|Call Petrogas about the invoice|Terminal upgrade|Tank farm maintenance|Meleiha tanks|Tank cleaning|Outlook/g;
check('★ no English key text leaked into the Arabic briefing',
  !/\b(late|due|tenders?|letters?|e-mails?|contracts?|Longest|Nearest|Among|Oldest|from)\b/i.test(briefTxt.replace(DATA, '')), briefTxt.slice(0, 400));
check('no Arabic-Indic digits', !/[٠-٩]/.test(briefTxt), briefTxt.slice(0, 300));
check('the serial keeps LTR (.ltr-data)', await evalJS(`!!document.querySelector('[data-line="late"] .ltr-data')`));

console.log('\n[7] 390 px phone');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
await shot('5-ar-mobile');
check('no horizontal overflow at 390px (RTL)', (await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
check('every sentence row fits the screen', await evalJS(`[...document.querySelectorAll('[data-line]')].every(b => { const r = b.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; })`));
await evalJS(`window.__setLang('en')`);
await sleep(300);
await shot('6-en-mobile');
check('no horizontal overflow at 390px (LTR)', (await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
check('the section buttons are thumb-sized (44px+) and two to a row', await evalJS(`(() => {
  const bs = [...document.querySelectorAll('[data-group="work"] [data-section]')];
  return bs.length > 2 && bs.every(b => b.getBoundingClientRect().height >= 44) && bs[0].getBoundingClientRect().top === bs[1].getBoundingClientRect().top
    && Math.abs(bs[0].getBoundingClientRect().width - bs[1].getBoundingClientRect().width) < 2;
})()`));
await evalJS(`window.scrollTo(0, 0)`);
await clickEl(`document.querySelector('[data-home-tool-btn="ask"]')`, 'the Ask button (phone)');
await sleep(300);
check('★ on a phone the box opens as a full-width bottom sheet', await evalJS(`(() => {
  const p = document.querySelector('[data-home-tool="ask"]'); const r = p.getBoundingClientRect();
  return !p.hidden && r.left <= 1 && r.right >= document.documentElement.clientWidth - 1 && r.bottom >= innerHeight - 2 && r.top > 0;
})()`));
await shot('7-en-mobile-panel');
await clickEl(`document.querySelector('[data-home-tool="ask"] .home-tool-close')`, 'Close (phone)');
await sleep(150);
check('the X closes it', await evalJS(`document.querySelector('[data-home-tool="ask"]').hidden`));
await send('Emulation.clearDeviceMetricsOverride');

check('nothing was written to Firestore', (await evalJS(`window.__store.get('tasks').size`)) === 5
  && (await evalJS(`window.__store.get('opportunities').size`)) === 3);
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
    const p = path.join(ROOT, 'scripts/harness/homeui-failure.png');
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
