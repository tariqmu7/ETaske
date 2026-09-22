// Click-through harness for the one-box capture on Home (queue task C1).
//
// quickcapture.mjs proves the reader (src/lib/quickCapture.ts) in node. This
// proves the SCREEN: the real QuickCapture box, fed bids/projects through the
// real useKnownParties, typing the queue's own example sentence, showing what
// it understood, and "Review and save" opening the REAL CreateTaskPanel, which
// then writes a task with the proposed owner, date and bid link. Also the bid /
// correspondence hand-off (createIntent), a pasted mail, Arabic + RTL, 390 px.
// Section [8] is queue C2: an Arabic voice note through the mic button to a task.
//
// Real code under test:  src/components/QuickCapture.tsx, src/lib/quickCapture.ts,
//                        src/lib/mailSuggest.ts, src/hooks/useKnownParties.ts,
//                        src/components/CreateTaskPanel.tsx, src/lib/createIntent.ts,
//                        src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts, window.fetch (the push proxy),
//                        window.SpeechRecognition (no microphone in a harness —
//                        the fake hands back what Chrome's recogniser would).
//
//   node scripts/harness/quickcaptureui.mjs   (--headed to watch it,
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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-quickcapture-'));

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
import QuickCapture from './src/components/QuickCapture';
import { consumeCreateIntent } from './src/lib/createIntent';
import i18n, { applyLanguageToDocument } from './src/i18n';

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Business Development', userColor: '#3b82f6' },
  { id: 'u-ahmed', displayName: 'Ahmed Samir', email: 'a@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
  { id: 'u-mona', displayName: 'Mona Fathy', email: 'm@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
  // Another team: the Assignee list does not offer him, so the box must not propose him.
  { id: 'u-karim', displayName: 'Karim Nabil', email: 'k@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T9', department: 'Finance' },
];

__seed('tasks', '--stats--', { value: 7 });
__seed('opportunities', '--stats--', { value: 12 });
__seed('opportunities', 'op1', { title: 'Algeria pipeline offer', serialNumber: 'OP000012', client: 'Petrojet', stage: 'Bidding', ownerId: 'u-mgr' });
__seed('projects', 'p1', { name: 'Meleiha Gas Plant O&M', serialNumber: 'PR000001', client: 'AGIBA', status: 'Active', userId: 'u-mgr', teamId: 'T1' });
// The same client written in Arabic, on a second bid, so an Arabic sentence can match.
__seed('opportunities', 'op3', { title: 'Algeria pipeline offer (AR)', serialNumber: 'OP000014', client: 'بتروجت', stage: 'Bidding', ownerId: 'u-mgr' });

// The browser's speech recogniser, faked BEFORE the first render (the mic
// button is only drawn when one exists). __say hands the hook a whole results
// list, the way Chrome does: [[text, isFinal], ...].
class FakeRecognition {
  constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; window.__srs.push(this); }
  start() { this.started = true; window.__sr = this; }
  stop() { this.stopped = true; setTimeout(() => this.onend && this.onend(), 0); }
  abort() { this.aborted = true; setTimeout(() => this.onend && this.onend(), 0); }
}
window.__srs = [];
window.SpeechRecognition = FakeRecognition;
window.webkitSpeechRecognition = FakeRecognition;
window.__say = pieces => {
  const results = pieces.map(([text, isFinal]) => { const r = [{ transcript: text }]; r.isFinal = isFinal; return r; });
  window.__sr.onresult({ resultIndex: 0, results });
};
window.__srFail = code => { window.__sr.onerror({ error: code }); window.__sr.onend(); };

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@eprom.com.eg' };
const appUser = USERS[0];
window.__nav = [];
window.__intent = t => JSON.stringify(consumeCreateIntent(t));

const root = createRoot(document.getElementById('root'));
root.render(
  React.createElement('div', { className: 'app-main', style: { maxWidth: 1100, margin: '0 auto', padding: 24 } },
    React.createElement(QuickCapture, { user, appUser, projectUsers: USERS, onNavigate: v => { window.__nav.push(v); } }),
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
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'quickcaptureEntry.tsx', loader: 'tsx' },
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
  const p = path.join(ROOT, `scripts/harness/quickcaptureui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const allOf = c => evalJS(`JSON.stringify([...(window.__store.get(${JSON.stringify(c)}) || new Map()).entries()].map(([id,d])=>({id,...d})))`).then(JSON.parse);
const BOX = `document.getElementById('quick-capture')`;
const setBox = async text => {
  await evalJS(`window.__type(${BOX}, ${JSON.stringify(text)})`);
  await sleep(250);
};
// The card's text WITHOUT the textarea: its own text node carries what was typed.
const card = () => evalJS(`(() => { const c = ${BOX}.closest('.card'); if (!c) return ''; const k = c.cloneNode(true); k.querySelectorAll('textarea').forEach(t => t.remove()); return k.textContent.replace(/\\s+/g, ' '); })()`);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nextDow = dow => { const t = new Date(); const d = new Date(t.getFullYear(), t.getMonth(), t.getDate()); d.setDate(d.getDate() + (((dow - d.getDay() + 7) % 7) || 7)); return iso(d); };
const radio = label => `window.__byText('button[role="radio"]', ${JSON.stringify(label)})[0]`;
const checked = label => evalJS(`(() => { const b = ${radio(label)}; return !!b && b.getAttribute('aria-checked') === 'true'; })()`);
const PANEL_NAME = `document.querySelector('input[placeholder="What needs to be done?"]')`;

// ═══════════════════════════════════════════════════════════════════════════
try {

console.log('\n[1] the box is there and quiet until something is typed');
await waitFor(BOX, 'the capture box');
check('the box is on screen', await evalJS(`window.__vis(${BOX})`));
check('no proposal before typing', !(await card()).includes('Review and save'));
await shot('0-empty');

console.log('\n[2] the queue example becomes a proposal');
// Typed for real (Input.insertText), not set: the onChange path is under test.
await typeInto(BOX, 'meeting with Petrojet Tuesday about the Algeria offer, Ahmed to send prices', 'the box');
await sleep(400);
let txt = await card();
await shot('1-proposal');
check('proposal shown', txt.includes('Review and save'), txt.slice(0, 200));
check('title shown', txt.includes('Meeting with Petrojet Tuesday'));
check('owner = Ahmed Samir', txt.includes('Ahmed Samir'));
check('linked to the Petrojet bid', txt.includes('OP000012 · Algeria pipeline offer'));
check('Task is the selected type', await checked('Task'));
check('the why-line quotes the date words', /date from “tuesday”/i.test(txt), txt.slice(-300));
check('says nothing is saved yet', txt.includes('Nothing is saved until you press Save'));
check('nothing written to Firestore yet', (await allOf('tasks')).filter(t => t.id !== '--stats--').length === 0);

console.log('\n[3] Review and save -> the real form, filled in -> a real task');
await clickEl(`window.__one('button', 'Review and save')`, 'Review and save');
await waitFor(PANEL_NAME, 'create-task panel');
await sleep(600);
await shot('2-panel');
const panel = await evalJS(`(() => {
  const name = ${PANEL_NAME};
  const root = window.__fixed(name);
  const due = root.querySelector('input[type="date"]');
  const opp = window.__linkSelects(root)[0];
  return JSON.stringify({ name: name.value, due: due ? due.value : null, opp: opp ? opp.value : null, head: root.textContent.includes('Check and save') });
})()`).then(JSON.parse);
check('panel title = the proposed title', panel.name.startsWith('Meeting with Petrojet'), panel.name);
check('panel due date = next Tuesday', panel.due === nextDow(2), `${panel.due} vs ${nextDow(2)}`);
check('panel opens linked to the bid', panel.opp === 'op1', String(panel.opp));
check('panel header says "Check and save"', panel.head);
await clickEl(`window.__byText('button', 'Create Task', window.__fixed(${PANEL_NAME})).slice(-1)[0]`, 'Create Task');
await sleep(1400);
const tasks = (await allOf('tasks')).filter(t => t.id !== '--stats--');
const t0 = tasks[0] || {};
check('exactly one task written', tasks.length === 1, String(tasks.length));
check('task owner = Ahmed', t0.assignedToId === 'u-ahmed' && t0.assignedTo === 'Ahmed Samir', `${t0.assignedToId}/${t0.assignedTo}`);
check('task assigned BY me (what the create rule requires)', t0.assignedById === 'u-mgr', String(t0.assignedById));
check('task due date', t0.dueDate === nextDow(2), String(t0.dueDate));
check('task linked to the bid', t0.opportunityId === 'op1' && t0.opportunitySerial === 'OP000012', `${t0.opportunityId}/${t0.opportunitySerial}`);
check('task description keeps the sentence', (t0.description || '').includes('Ahmed to send prices'));
txt = await card();
check('box cleared + "Saved" note', (await evalJS(`${BOX}.value`)) === '' && txt.includes('Saved. Add the next one.'), txt.slice(0, 200));
await shot('3-saved');

console.log('\n[4] owners the form cannot offer are never proposed');
await setBox('Karim to send the invoice tomorrow');
txt = await card();
check('another team’s colleague is not the owner (falls back to me)', txt.includes('OwnerYou') && !txt.includes('Karim Nabil'), txt.slice(0, 300));

console.log('\n[5] a bid and a correspondence go to their own boards, prefilled');
await setBox('New tender from Petrojet, RFQ-2026-118, closing 12/10/2026');
check('proposed as a Bid', await checked('Bid'));
await clickEl(`window.__one('button', 'Review and save')`, 'Review and save (bid)');
const bid = JSON.parse(await evalJS(`window.__intent('opportunity')`) || 'null');
check('navigated to Opportunities', (await evalJS('window.__nav.slice(-1)[0]')) === 'opportunities');
check('bid prefill: client/number/deadline', !!bid && bid.client === 'Petrojet' && bid.tenderNumber === '2026-118' && bid.submissionDeadline === '2026-10-12', JSON.stringify(bid));

await setBox('We received a letter from AGIBA about the delay penalty');
check('proposed as a Correspondence', await checked('Correspondence'));
// The user can overrule the guess: switch to Task and back.
await clickEl(radio('Task'), 'switch to Task');
check('type switch works', await checked('Task'));
await clickEl(radio('Correspondence'), 'switch back');
await clickEl(`window.__one('button', 'Review and save')`, 'Review and save (corr)');
const corr = JSON.parse(await evalJS(`window.__intent('corresponding')`) || 'null');
check('navigated to Correspondences', (await evalJS('window.__nav.slice(-1)[0]')) === 'correspondences');
check('correspondence prefill: subject + body + category', !!corr && corr.subject.startsWith('We received a letter') && corr.body.includes('delay penalty') && corr.category === 'Project', JSON.stringify(corr));

console.log('\n[6] a pasted e-mail');
await setBox('From: Hany Adel <h.adel@agiba.com.eg>\nSent: Monday\nTo: Tariq Salama\nSubject: RE: Meleiha - revised schedule\n\nPlease send the revised schedule within 5 days. Mona to confirm the manpower.');
txt = await card();
check('read as an e-mail from Hany Adel', txt.includes('read as an e-mail from Hany Adel'), txt.slice(-300));
check('mail title cleaned', txt.includes('Meleiha - revised schedule') && !txt.includes('RE: Meleiha'));
check('mail linked to the project', txt.includes('PR000001 · Meleiha Gas Plant O&M'));
check('mail owner from the body = Mona', txt.includes('Mona Fathy'));

console.log('\n[7] Arabic + RTL, and a phone');
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await setBox('على منى إرسال الأسعار لبتروجت يوم الخميس');
await sleep(300);
await shot('4-ar');
const ar = await evalJS(`(() => {
  const c = ${BOX}.closest('.card').cloneNode(true);
  c.querySelectorAll('textarea').forEach(t => t.remove());
  return JSON.stringify({ dir: document.documentElement.dir, text: c.textContent, ph: ${BOX}.placeholder });
})()`).then(JSON.parse);
check('page is RTL', ar.dir === 'rtl');
check('Arabic labels', ar.text.includes('راجِع واحفظ') && ar.text.includes('أضِف ما لديك') && ar.ph.startsWith('الصق رسالة'));
check('owner read from Arabic = Mona', ar.text.includes('Mona Fathy'), ar.text.slice(0, 300));
check('Arabic client name matched its bid', ar.text.includes('OP000014'));
check('no English left in the box chrome', !/Review and save|Add anything|Owner|Linked to|Why:/.test(ar.text), ar.text.slice(0, 300));
check('no horizontal overflow (RTL)', (await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
await sleep(500);
await shot('5-ar-mobile');
check('no horizontal overflow at 390px', (await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
await send('Emulation.clearDeviceMetricsOverride');
await evalJS(`window.__setLang('en')`);

console.log('\n[8] queue C2 — an Arabic voice note becomes a task');
const MIC = `document.querySelector('[data-voice="mic"]')`;
const voiceRadio = label => `[...document.querySelectorAll('[role="radiogroup"] button[role="radio"]')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
await setBox('');
check('mic button is on screen', await evalJS(`window.__vis(${MIC})`));
check('voice language defaults to Arabic', await evalJS(`${voiceRadio('عربي')}.getAttribute('aria-checked') === 'true'`));
await clickEl(MIC, 'mic');
let sr = JSON.parse(await evalJS(`JSON.stringify({ n: window.__srs.length, lang: window.__sr.lang, cont: window.__sr.continuous, interim: window.__sr.interimResults, started: !!window.__sr.started })`));
check('recogniser started in Egyptian Arabic, continuous, with interim results', sr.started && sr.lang === 'ar-EG' && sr.cont && sr.interim, JSON.stringify(sr));
txt = await card();
check('button now says Stop + "Listening…"', txt.includes('Stop') && txt.includes('Listening… tap Stop when you finish.'), txt.slice(0, 200));
check('mic button is pressed', (await evalJS(`${MIC}.getAttribute('aria-pressed')`)) === 'true');
// Still being heard: shown grey, NOT written into the box.
await evalJS(`window.__say([['خلي أحمد', false]])`);
await sleep(200);
check('interim words shown under the box', (await evalJS(`(document.querySelector('[data-voice="interim"]') || {}).textContent || ''`)) === 'خلي أحمد');
check('interim words not in the box yet', (await evalJS(`${BOX}.value`)) === '');
// Two pauses = two final pieces, as desktop Chrome sends them.
await evalJS(`window.__say([['خلي أحمد يبعت الأسعار', true], ['لبتروجت يوم الحد', true]])`);
await sleep(300);
check('box = the whole note', (await evalJS(`${BOX}.value`)) === 'خلي أحمد يبعت الأسعار لبتروجت يوم الحد', await evalJS(`${BOX}.value`));
txt = await card();
check('owner read from the voice note = Ahmed', txt.includes('Ahmed Samir'), txt.slice(0, 300));
check('linked to the Arabic-named bid', txt.includes('OP000014'));
check('date proposed (next Sunday)', /date from “يوم الحد”/.test(txt), txt.slice(-300));
await clickEl(MIC, 'stop');
await sleep(250);
check('Stop ends listening', (await evalJS(`window.__sr.stopped === true && ${MIC}.getAttribute('aria-pressed') === 'false'`)) && !(await card()).includes('Listening…'));
check('box keeps the note after Stop', (await evalJS(`${BOX}.value`)) === 'خلي أحمد يبعت الأسعار لبتروجت يوم الحد');

await clickEl(`window.__one('button', 'Review and save')`, 'Review and save (voice)');
await waitFor(PANEL_NAME, 'create-task panel (voice)');
await sleep(600);
const vp = await evalJS(`(() => { const root = window.__fixed(${PANEL_NAME}); const due = root.querySelector('input[type="date"]'); return JSON.stringify({ name: ${PANEL_NAME}.value, due: due ? due.value : null }); })()`).then(JSON.parse);
check('panel title = the note', vp.name.startsWith('خلي أحمد يبعت'), vp.name);
check('panel due = next Sunday', vp.due === nextDow(0), `${vp.due} vs ${nextDow(0)}`);
await clickEl(`window.__byText('button', 'Create Task', window.__fixed(${PANEL_NAME})).slice(-1)[0]`, 'Create Task (voice)');
await sleep(1400);
const vt = (await allOf('tasks')).filter(t => t.id !== '--stats--' && (t.description || '').includes('يوم الحد'))[0] || {};
check('task written from the voice note', !!vt.id);
check('voice task owner = Ahmed, due Sunday, linked to the bid', vt.assignedToId === 'u-ahmed' && vt.dueDate === nextDow(0) && vt.opportunityId === 'op3', `${vt.assignedToId}/${vt.dueDate}/${vt.opportunityId}`);

console.log('\n[8b] the mic adds to what is typed, and Android’s repeats');
await setBox('Petrojet offer');
await clickEl(MIC, 'mic (after typing)');
// Chrome on Android sends the whole transcript so far as every piece.
await evalJS(`window.__say([['بكرة', true], ['بكرة الصبح', true]])`);
await sleep(250);
check('spoken words added after the typed ones, not repeated', (await evalJS(`${BOX}.value`)) === 'Petrojet offer بكرة الصبح', await evalJS(`${BOX}.value`));
// Typing takes over from the mic.
await typeInto(BOX, ' x', 'type while listening');
check('typing stops the mic', (await evalJS(`window.__sr.stopped === true`)));
await sleep(200);
check('typed character kept', (await evalJS(`${BOX}.value`)).endsWith('x'));

console.log('\n[8c] errors, the language switch, no recogniser');
await setBox('');
await clickEl(MIC, 'mic (to fail)');
await evalJS(`window.__srFail('not-allowed')`);
await sleep(250);
txt = await card();
check('blocked microphone explained', txt.includes('The microphone is blocked. Allow it for this site'), txt.slice(0, 300));
await clickEl(voiceRadio('EN'), 'EN');
check('EN picked', await evalJS(`${voiceRadio('EN')}.getAttribute('aria-checked') === 'true'`));
check('choice remembered', (await evalJS(`localStorage.getItem('etaske.voiceLang')`)) === 'en-US');
await clickEl(MIC, 'mic (EN)');
check('recogniser started in English', (await evalJS(`window.__sr.lang`)) === 'en-US');
check('the old error is gone once listening again', !(await card()).includes('microphone is blocked'));
await evalJS(`window.__say([['Ahmed to send the prices tomorrow', true]])`);
await sleep(250);
check('English note read too', (await card()).includes('Ahmed Samir'));
await clickEl(MIC, 'stop (EN)');
await clickEl(voiceRadio('عربي'), 'back to Arabic');

await evalJS(`window.__setLang('ar')`);
await sleep(300);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
await sleep(400);
await shot('6-voice-ar-mobile');
const arMic = await evalJS(`(() => { const m = ${MIC}; const r = m.getBoundingClientRect(); return JSON.stringify({ text: m.textContent.trim(), h: r.height, label: m.getAttribute('aria-label') }); })()`).then(JSON.parse);
check('Arabic mic label', arMic.text === 'تحدّث' && arMic.label === 'تحدّث بدل الكتابة', JSON.stringify(arMic));
check('mic button is a real touch target (≥36px)', arMic.h >= 36, String(arMic.h));
check('no horizontal overflow at 390px with the mic row (RTL)', (await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
await send('Emulation.clearDeviceMetricsOverride');
await evalJS(`window.__setLang('en')`);

// Firefox has no recogniser: the button must simply not be there.
await evalJS(`window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;`);
await setBox('no mic here');
check('no recogniser = no mic button', !(await evalJS(`!!${MIC}`)));

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
    const p = path.join(ROOT, 'scripts/harness/quickcaptureui-failure.png');
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
