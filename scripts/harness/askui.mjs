// Click-through harness for the Ask box on Home (queue task D11).
//
// askrecords.mjs proves the reader (src/lib/askRecords.ts) in node. This proves
// the SCREEN: the real AskBox, reading the four boards through the real
// subscribeVisibleTasks + onSnapshot, a question typed for real, the answer's
// rows, "Understood as", a row opening its record, an example chip, Arabic +
// RTL and 390 px.
//
// Real code under test:  src/components/AskBox.tsx, src/lib/askRecords.ts,
//                        src/lib/quickCapture.ts, src/lib/taskVisibility.ts,
//                        src/lib/deepLink.ts, src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts, window.fetch.
//
//   node scripts/harness/askui.mjs   (--headed to watch it, --shot to write PNGs)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-askui-'));

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
import AskBox from './src/components/AskBox';
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
const lastMonth = n => iso(new Date(now.getFullYear(), now.getMonth() - 1, n));
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));

__seed('correspondences', 'c1', { subject: 'Offer for tank cleaning', body: 'Our offer to NNPC', sentFrom: 'EPROM', dateReceived: lastMonth(5), status: 'Closed', userId: 'u-mgr', teamId: 'T1', serialNumber: 'CR000101' });
__seed('correspondences', 'c2', { subject: 'Request for clarification', body: 'Please clarify the scope', sentFrom: 'NNPC', dateReceived: lastMonth(12), status: 'Assigned', assignedToId: 'u-ahmed', assignedTo: 'Ahmed Samir', userId: 'u-mgr', teamId: 'T1', serialNumber: 'CR000102' });
__seed('correspondences', 'c3', { subject: 'عرض أسعار الصيانة', body: 'مرسل إلى بترومنت', sentFrom: 'EPROM', dateReceived: lastMonth(20), status: 'Closed', userId: 'u-mgr', teamId: 'T1', serialNumber: 'CR000103' });
__seed('tasks', 't1', { taskName: 'Send revised prices to NNPC', description: '', status: 'Done', isPrivate: false, createdAt: lastMonth(18), dueDate: lastMonth(25), assignedToId: 'u-mona', assignedTo: 'Mona Fathy', userId: 'u-mgr', teamId: 'T1', serialNumber: 'TK000201' });
__seed('tasks', 't2', { taskName: 'Zohr compressor inspection report', description: '', status: 'In Progress', isPrivate: false, createdAt: dayOffset(-20), dueDate: dayOffset(-3), assignedToId: 'u-mona', assignedTo: 'Mona Fathy', userId: 'u-mgr', teamId: 'T1', serialNumber: 'TK000202' });
// Somebody else's PRIVATE task: the box must never find it.
__seed('tasks', 't3', { taskName: 'Private NNPC note', description: 'NNPC', status: 'Pending', isPrivate: true, createdAt: lastMonth(10), assignedToId: 'u-ahmed', userId: 'u-ahmed', teamId: 'T1', serialNumber: 'TK000203' });
__seed('opportunities', 'o1', { title: 'Tank farm maintenance', client: 'NNPC', stage: 'Bid Preparation', submissionDeadline: dayOffset(4), createdAt: dayOffset(-30), ownerId: 'u-mgr', ownerName: 'Tariq Salama', serialNumber: 'OP000011' });
__seed('opportunities', 'o2', { title: 'Terminal upgrade', client: 'بترومنت', stage: 'Identified', submissionDeadline: dayOffset(60), createdAt: dayOffset(-2), ownerId: 'u-ahmed', serialNumber: 'OP000012' });
__seed('projects', 'p1', { name: 'Meleiha tanks', client: 'AGIBA', status: 'Active', startDate: '2026-01-01', userId: 'u-mgr', serialNumber: 'PR000003' });

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@eprom.com.eg' };
window.__nav = [];
window.__open = t => consumePending(t);

const root = createRoot(document.getElementById('root'));
root.render(
  React.createElement('div', { className: 'app-main', style: { maxWidth: 1100, margin: '0 auto', padding: 24 } },
    React.createElement(AskBox, { user, appUser: USERS[0], projectUsers: USERS, onNavigate: v => { window.__nav.push(v); } }),
  ),
);

window.__type = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e =>
  window.__errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));
window.fetch = async () => ({ ok: true, json: async () => ({ status: 'success' }), text: async () => '' });
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'askuiEntry.tsx', loader: 'tsx' },
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
  const p = path.join(ROOT, `scripts/harness/askui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const BOX = `document.getElementById('ask-box')`;
const CARD = `document.querySelector('[data-ask="box"]')`;
const card = () => evalJS(`(() => { const c = ${CARD}; return c ? c.textContent.replace(/\\s+/g, ' ') : ''; })()`);
const rowTitles = () => evalJS(`JSON.stringify([...document.querySelectorAll('[data-ask="row"]')].map(b => b.textContent.replace(/\\s+/g, ' ').trim()))`).then(JSON.parse);
const SUBMIT = `document.querySelector('[data-ask="box"] button[type="submit"]')`;
async function ask(text) {
  await evalJS(`window.__type(${BOX}, ${JSON.stringify(text)})`);
  await sleep(150);
  await clickEl(SUBMIT, 'Ask');
  await waitFor(`document.querySelector('[data-ask="answer"], [data-ask="unread"]')`, 'an answer');
  await sleep(250);
}

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] quiet until used');
await waitFor(BOX, 'the ask box');
check('the box is on screen', await evalJS(`window.__vis(${BOX})`));
check('example questions offered', (await evalJS(`document.querySelectorAll('[data-ask="example"]').length`)) === 4);
check('no answer before asking', !(await evalJS(`!!document.querySelector('[data-ask="answer"]')`)));
check('the boards are not read before the box is used', (await evalJS(`document.querySelectorAll('[data-ask="row"]').length`)) === 0);
await shot('0-empty');

console.log('\n[2] "what did we send NNPC last month" — typed for real, answered from the boards');
await typeInto(BOX, 'What did we send NNPC last month?', 'the box');
await clickEl(SUBMIT, 'Ask');
await waitFor(`document.querySelector('[data-ask="answer"]')`, 'the answer');
await sleep(300);
let txt = await card();
let rows = await rowTitles();
await shot('1-answer');
check('two rows: our letter + the task that sent prices', rows.length === 2, JSON.stringify(rows));
check('our letter found', rows.some(r => r.includes('Offer for tank cleaning')));
check('the send-prices task found', rows.some(r => r.includes('Send revised prices to NNPC')));
check('THEIR letter to us is not "sent"', !rows.some(r => r.includes('Request for clarification')));
check("somebody else's private task never shows", !txt.includes('Private NNPC note'));
check('count shown', txt.includes('Found: 2'), txt.slice(0, 200));
check('"Understood as" names the client', txt.includes('Client: NNPC'));
check('"Understood as" names the period', txt.includes('Last month'));
check('"Understood as" says sent by us', txt.includes('Sent by us'));
check('honest note about Outlook mail', txt.includes('mail sent straight from Outlook is not here'));

console.log('\n[3] a row opens its record');
await clickEl(`[...document.querySelectorAll('[data-ask="row"]')].find(b => b.textContent.includes('Offer for tank cleaning'))`, 'the letter row');
check('navigated to correspondences', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'correspondences');
check('the letter is queued to open', (await evalJS(`window.__open('corresponding')`)) === 'c1');

console.log('\n[4] other questions');
await ask("Mona's late tasks");
rows = await rowTitles();
check("Mona's late: only the overdue open task", rows.length === 1 && rows[0].includes('Zohr compressor'), JSON.stringify(rows));
await ask('open bids closing in the next 30 days');
await ask('open bids');
rows = await rowTitles();
check('open bids: both, soonest-closing first is not required — just both', rows.length === 2, JSON.stringify(rows));
await ask('bids closing this month');
txt = await card();
check('"Due:" shown for a closing question', txt.includes('Due:'), txt.slice(0, 300));
await ask('Zebra unicorn');
check('nothing-found message', await evalJS(`!!document.querySelector('[data-ask="empty"]')`));
await ask('what is the');
check('unreadable question explained', await evalJS(`!!document.querySelector('[data-ask="unread"]')`));

console.log('\n[5] an example chip asks by itself');
await evalJS(`window.__type(${BOX}, '')`);
await sleep(150);
// The chips only show while nothing has been asked — "Clear" brings them back.
await ask('Zebra unicorn');
await clickEl(`[...document.querySelectorAll('[data-ask="box"] button')].find(b => b.textContent.trim() === 'Clear')`, 'Clear');
await waitFor(`document.querySelector('[data-ask="example"]')`, 'examples back after Clear');
await clickEl(`[...document.querySelectorAll('[data-ask="example"]')].find(b => b.textContent.includes('overdue'))`, 'the overdue example');
await waitFor(`document.querySelector('[data-ask="answer"]')`, 'the example answer');
txt = await card();
check('example filled the box', (await evalJS(`${BOX}.value`)) === 'My overdue tasks');
check('example answered (my = the manager, who entered Mona’s overdue task)', (await rowTitles()).some(r => r.includes('Zohr compressor')), txt.slice(0, 300));

console.log('\n[6] Arabic + RTL');
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await ask('إيه اللي بعتناه لبترومنت الشهر اللي فات؟');
txt = await card();
rows = await rowTitles();
await shot('2-ar');
check('Arabic question finds the Arabic letter', rows.length === 1 && rows[0].includes('عرض أسعار الصيانة'), JSON.stringify(rows));
check('Arabic count label', txt.includes('النتائج: 1'), txt.slice(0, 200));
check('Arabic understood-as label', txt.includes('فهمتُ السؤال هكذا'));
check('page is RTL', (await evalJS(`document.documentElement.dir`)) === 'rtl');
check('no Arabic-Indic digits in the answer', !/[٠-٩]/.test(txt), txt.slice(0, 300));

console.log('\n[7] 390 px phone');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
await shot('3-ar-mobile');
check('no horizontal overflow at 390px (RTL)', (await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
await evalJS(`window.__setLang('en')`);
await sleep(300);
check('no horizontal overflow at 390px (LTR)', (await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
await send('Emulation.clearDeviceMetricsOverride');

check('nothing was written to Firestore', (await evalJS(`window.__store.get('tasks').size`)) === 3);
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
    const p = path.join(ROOT, 'scripts/harness/askui-failure.png');
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
