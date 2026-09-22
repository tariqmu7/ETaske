// Click-through harness for offer sign-off (queue D10).
//
// offerapproval.mjs proves the rules in node. This proves the SCREENS in a real
// Edge: the sign-off card on a bid (ask with a note, the managers' notification,
// take back, send back with a reason, ask again, approve, the price changing
// after approval, "Mark as sent"), the edit form refusing to move an unsigned
// offer to Submitted (and a manager's save signing it instead), the managers'
// "waiting for your sign-off" list and card badge, an old sent bid showing
// nothing, the history list, Arabic + RTL and a 390 px phone.
//
// Real code under test:  src/OpportunitiesDashboard.tsx, src/OpportunityDetail.tsx,
//                        src/components/opportunities/OfferApprovalCard.tsx,
//                        src/lib/offerApproval.ts, src/lib/pushNotification.ts,
//                        src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store, incl.
//                        runTransaction), src/lib/firebase.ts, window.fetch.
//
//   node scripts/harness/approvalui.mjs   (--headed to watch it, --shot to write PNGs)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-approvalui-'));

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
import i18n, { applyLanguageToDocument } from './src/i18n';
import OpportunitiesDashboard from './src/OpportunitiesDashboard';
import { requestOpen, consumePending } from './src/lib/deepLink';

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
window.__day = dayOffset;
const ts = n => { const d = new Date(now.getTime() + n * 86400000); return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d, toMillis: () => d.getTime() }; };

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@x.com', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1' },
  { id: 'u-mgr2', displayName: 'Hala Nabil',   email: 'h@x.com', photoURL: '', status: 'Approved', role: 'Admin',    teamId: 'T1' },
  { id: 'u-old',  displayName: 'Old Manager',  email: 'o@x.com', photoURL: '', status: 'Rejected', role: 'Manager',  teamId: 'T1' },
  { id: 'u-mona', displayName: 'Mona Fathy',   email: 'm@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1' },
];
__seed('opportunities', '--stats--', { value: 40 });
// The offer being prepared — nobody asked yet.
__seed('opportunities', 'b4', { title: 'Tank cleaning 2026', serialNumber: 'OP000004', client: 'Agiba', stage: 'Bid Preparation', currency: 'EGP',
  estimatedValue: 1200000, submissionDeadline: dayOffset(12), ownerId: 'u-mona', ownerName: 'Mona Fathy', userId: 'u-mona', createdAt: ts(-5), updatedAt: ts(-5) });
// Sent last year, before sign-off existed.
__seed('opportunities', 'b3', { title: 'Pump overhaul', serialNumber: 'OP000003', client: 'AGIBA', stage: 'Submitted', currency: 'USD', estimatedValue: 250000,
  submittedDate: dayOffset(-30), ownerId: 'u-mona', ownerName: 'Mona Fathy', userId: 'u-mgr', createdAt: ts(-60), updatedAt: ts(-30) });
// A manager's own enquiry.
__seed('opportunities', 'b6', { title: 'APC jetty', serialNumber: 'OP000006', client: 'APC', stage: 'Identified', currency: 'USD', estimatedValue: 90000,
  ownerId: 'u-mgr', ownerName: 'Tariq Salama', userId: 'u-mgr', createdAt: ts(-2), updatedAt: ts(-2) });

const root = createRoot(document.getElementById('root'));
window.__nav = [];
window.__mount = (view, who = 'u-mgr') => {
  const appUser = USERS.find(u => u.id === who);
  const user = { uid: appUser.id, displayName: appUser.displayName, email: appUser.email };
  const onNavigate = v => window.__nav.push(v);
  root.render(React.createElement('div', { className: 'app-main' },
    view === 'blank' ? React.createElement('div', null, 'blank')
      : React.createElement(OpportunitiesDashboard, { key: 'o' + who, user, appUser, projectUsers: USERS, onNavigate })));
};
window.__open = (id, tab) => requestOpen({ type: 'opportunity', id, tab });
// A mounted board handles the open live but leaves it parked; drop it before a remount.
window.__clearPending = () => consumePending('opportunity');
window.__mount('opps', 'u-mona');

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
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };

window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e =>
  window.__errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));
window.confirm = () => true;
window.alert = m => { window.__errors.push('alert: ' + m); };
window.fetch = async () => { throw new TypeError('Failed to fetch'); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'approvaluiEntry.tsx', loader: 'tsx' },
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
// ⚠ textContent, never innerText (innerText returns the uppercase-TRANSFORMED text).
window.__txt = e => (e.textContent || '').replace(/\\s+/g, ' ').trim();
window.__byText = (sel, text, root) => [...(root || document).querySelectorAll(sel)]
  .filter(e => window.__vis(e) && window.__txt(e).includes(text));
window.__one = (sel, text, root) => { const m = window.__byText(sel, text, root); return m.length ? m[0] : null; };
window.__box = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; };
window.__q = sel => [...document.querySelectorAll(sel)].filter(window.__vis);
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
      return { x: b.x, y: b.y, covered: !(el === hit || el.contains(hit) || (hit && hit.contains(el))),
               hitTag: hit ? hit.tagName + '.' + hit.className : null };
    })()`);
    if (!info.err && !info.covered) break;
    await sleep(250);
  }
  if (info.err) throw new Error(`click ${label}: ${info.err}`);
  if (info.covered) throw new Error(`click ${label}: something else is on top (${info.hitTag})`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: info.x, y: info.y, button: 'left', clickCount: 1, buttons: 1 });
  }
  await sleep(160);
  return info;
}
/** Sets a form control through React's tracked setter (typing via CDP into a date input is unreliable). */
async function setVal(sel, value) {
  const done = await evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    if (el.tagName === 'SELECT') window.__pick(el, ${JSON.stringify(value)}); else window.__type(el, ${JSON.stringify(value)});
    return true;
  })()`);
  if (!done) throw new Error(`setVal ${sel}: not found`);
  await sleep(120);
}
async function shot(name) {
  if (!SHOT) return;
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const p = path.join(ROOT, `scripts/harness/approvalui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}

const docOf = id => evalJS(`JSON.stringify(window.__store.get('opportunities').get(${JSON.stringify(id)}))`).then(JSON.parse);
const day = n => evalJS(`window.__day(${n})`);
// Money and dates are wrapped in bidi isolates inside sentences — strip them to compare.
const plain = s => (s || '').replace(/[⁦-⁩]/g, '');
const txt = sel => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? window.__txt(e) : null; })()`).then(v => v === null ? null : plain(v));
const count = sel => evalJS(`window.__q(${JSON.stringify(sel)}).length`);
const state = () => evalJS(`(() => { const c = document.querySelector('[data-approval=card]'); return c ? c.getAttribute('data-state') : null; })()`);
const notes = () => evalJS(`JSON.stringify(window.__writes.filter(w => w.op === 'add' && w.path.startsWith('notifications/')).map(w => w.data))`).then(JSON.parse);

async function openBid(id) {
  await evalJS(`window.__open(${JSON.stringify(id)})`);
  await waitFor(`window.__one('button', 'All opportunities') || window.__one('button', 'كل الفرص')`, `bid ${id} page`);
  await sleep(150);
}
async function mountAs(who) {
  // A deep link leaves "?open=<id>" in the hash; a fresh board would re-open it.
  await evalJS(`window.location.hash = ''`);
  await evalJS(`window.__clearPending()`);
  await evalJS(`window.__mount('blank')`); await sleep(100);
  await evalJS(`window.__mount('opps', ${JSON.stringify(who)})`); await sleep(300);
}
async function typeNote(text) { await setVal('[data-approval=note]', text); }
/** Opens the edit form from the bid page and sets stage / value. */
async function editBid({ stage, value }) {
  await clickEl(`window.__one('button', 'Edit opportunity')`, 'edit button');
  await waitFor(`document.querySelector('.modal')`, 'edit modal');
  if (stage) {
    const done = await evalJS(`(() => { const s = [...document.querySelectorAll('.modal select')].find(x => [...x.options].some(o => o.value === 'Submitted')); if (!s) return false; window.__pick(s, ${JSON.stringify(stage)}); return true; })()`);
    if (!done) throw new Error('stage select not found');
    await sleep(120);
  }
  if (value !== undefined) {
    await evalJS(`window.__type(document.querySelector('.modal input[type=number]'), ${JSON.stringify(String(value))})`);
    await sleep(120);
  }
}
async function editBidValueOnly(value) {
  await evalJS(`window.__type(document.querySelector('.modal input[type=number]'), ${JSON.stringify(String(value))})`);
  await sleep(120);
}
const saveEdit = () => clickEl(`window.__one('.modal button', 'Save changes')`, 'save changes');

try {
  // ── [1] Employee: nothing asked yet ──────────────────────────────────────
  console.log('\n[1] employee asks for sign-off');
  await sleep(300);
  await openBid('b4');
  await waitFor(`document.querySelector('[data-approval=card]')`, 'sign-off card');
  check('card says sign-off is needed', (await state()) === 'none' && (await txt('[data-approval=heading]')) === 'Manager sign-off needed before sending');
  const st = await txt('[data-approval=status]');
  check('card names the price it covers (1,200,000 EGP)', st.includes('1,200,000 EGP'), st);
  check('employee sees "Ask for sign-off", not "Approve"', (await count('[data-approval=ask]')) === 1 && (await count('[data-approval=approve]')) === 0);
  check('no "Mark as sent" before approval', (await count('[data-approval=mark-sent]')) === 0);
  check('card sits above the tab bar', await evalJS(`(() => { const c = document.querySelector('[data-approval=card]').getBoundingClientRect(); const t = window.__one('button', 'Follow-ups').getBoundingClientRect(); return c.bottom <= t.top; })()`));
  await shot('1-ask');
  await typeNote('Discount 5% against last year — please check');
  await clickEl(`document.querySelector('[data-approval=ask]')`, 'ask');
  await waitFor(`document.querySelector('[data-approval=card][data-state=requested]')`, 'requested');
  let d = await docOf('b4');
  check('bid now carries a request by Mona at the price', d.approval?.status === 'requested' && d.approval.requestedById === 'u-mona' && d.approval.amount === 1200000 && d.approval.currency === 'EGP');
  check('request note stored', d.approval.requestNote === 'Discount 5% against last year — please check');
  check('stage untouched, updatedAt untouched', d.stage === 'Bid Preparation' && d.updatedAt.seconds === (await evalJS(`window.__store.get('opportunities').get('b4').createdAt.seconds`)));
  let n = await notes();
  check('both active managers notified (not the rejected one, not Mona)', JSON.stringify(n.map(x => x.forUserId).sort()) === JSON.stringify(['u-mgr', 'u-mgr2']), JSON.stringify(n.map(x => x.forUserId)));
  check('notification type + link to the bid', n.every(x => x.type === 'opportunity_approval_requested' && x.relatedId === 'b4'));
  check('notification names the price and the note', n[0].message.includes('1,200,000 EGP') && n[0].message.includes('Discount 5%'), n[0].message);
  check('confirmation shown', ((await txt('[data-approval=done]')) || '').includes('Every manager has a notification'));
  check('waiting text shown to the employee', ((await txt('[data-approval=status]')) || '').includes('Every manager has been notified'));
  check('employee can take it back', (await count('[data-approval=withdraw]')) === 1);

  // ── [2] Employee cannot mark it sent ─────────────────────────────────────
  console.log('\n[2] edit form refuses an unsigned offer');
  await editBid({ stage: 'Submitted' });
  check('stage note warns under the Stage field', ((await txt('[data-approval=stage-note]')) || '') === 'Needs a manager’s sign-off first.');
  await saveEdit();
  await sleep(200);
  const err = await evalJS(`(() => { const m = document.querySelector('.modal'); return m ? window.__txt(m) : ''; })()`);
  check('save refused with the "still waiting" message', err.includes('still waiting for a manager’s sign-off'), err.slice(-200));
  check('bid still in Bid Preparation', (await docOf('b4')).stage === 'Bid Preparation');
  await clickEl(`window.__one('.modal button', 'Cancel')`, 'cancel');
  await sleep(150);
  // the Follow-ups tab has its own "Stage now" box — same gate
  await evalJS(`(() => { const s = [...document.querySelectorAll('select')].find(x => !x.closest('.modal') && [...x.options].some(o => o.value === 'Submitted')); window.__pick(s, 'Submitted'); })()`);
  await sleep(100);
  await evalJS(`window.__type(document.querySelector('textarea:not([data-approval])'), 'Sent by courier')`);
  await sleep(100);
  const fuBefore = await evalJS(`window.__writes.filter(w => w.path.startsWith('opportunityFollowUps/')).length`);
  await clickEl(`window.__one('button', 'Post follow-up')`, 'post follow-up');
  await sleep(200);
  check('follow-up that moves the stage to Submitted is refused', await evalJS(`document.body.textContent.includes('needs a manager’s sign-off before it can be marked as sent')`));
  check('... nothing written (no follow-up, stage unchanged)', (await evalJS(`window.__writes.filter(w => w.path.startsWith('opportunityFollowUps/')).length`)) === fuBefore && (await docOf('b4')).stage === 'Bid Preparation');
  await evalJS(`(() => { const s = [...document.querySelectorAll('select')].find(x => !x.closest('.modal') && [...x.options].some(o => o.value === 'Submitted')); window.__pick(s, 'Bid Preparation'); window.__type(document.querySelector('textarea:not([data-approval])'), ''); })()`);
  await sleep(100);

  // ── [3] Take back, ask again ─────────────────────────────────────────────
  console.log('\n[3] take back + ask again');
  await clickEl(`document.querySelector('[data-approval=withdraw]')`, 'withdraw');
  await waitFor(`document.querySelector('[data-approval=card][data-state=withdrawn]')`, 'withdrawn');
  check('withdrawn state, ask again offered', ((await txt('[data-approval=ask]')) || '') === 'Ask for sign-off again');
  await clickEl(`document.querySelector('[data-approval=ask]')`, 'ask again');
  await waitFor(`document.querySelector('[data-approval=card][data-state=requested]')`, 'requested again');
  d = await docOf('b4');
  check('history: requested, withdrawn, requested', JSON.stringify(d.approval.log.map(e => e.kind)) === '["requested","withdrawn","requested"]');

  // ── [4] Manager: the waiting list + send back ────────────────────────────
  console.log('\n[4] manager sees the queue, sends back');
  await mountAs('u-mgr');
  await waitFor(`document.querySelector('[data-approval=waiting]')`, 'waiting list');
  const wl = await txt('[data-approval=waiting]');
  check('"1 offer waiting for your sign-off"', wl.startsWith('1 offer waiting for your sign-off'), wl);
  check('row: serial, title, price, asker, age', /OP000004.*Tank cleaning 2026.*1\.2M EGP.*Mona Fathy.*asked today/.test(wl), wl);
  await shot('2-waiting');
  await mountAs('u-mona');
  check('an employee does not get the waiting list', (await count('[data-approval=waiting]')) === 0);
  await mountAs('u-mgr');
  await clickEl(`window.__one('.card', 'Bid Preparation')`, 'stage group');
  await waitFor(`document.querySelector('[data-approval=card-badge]')`, 'badge');
  check('bid card shows "Awaiting sign-off"', (await txt('[data-approval=card-badge]')) === 'Awaiting sign-off');
  await clickEl(`window.__one('button', 'All Groups')`, 'back to groups');
  await clickEl(`document.querySelector('[data-approval=waiting-row]')`, 'waiting row');
  await waitFor(`document.querySelector('[data-approval=card][data-state=requested]')`, 'manager on the bid');
  check('manager sees Approve + Send back', (await count('[data-approval=approve]')) === 1 && (await count('[data-approval=return]')) === 1);
  await clickEl(`document.querySelector('[data-approval=return]')`, 'send back, no reason');
  check('send back without a reason is refused', ((await txt('[data-approval=error]')) || '').includes('Write why it is sent back'));
  check('... and nothing was written', (await docOf('b4')).approval.status === 'requested');
  const before = (await notes()).length;
  await typeNote('Scaffolding is missing from the price');
  await clickEl(`document.querySelector('[data-approval=return]')`, 'send back');
  await waitFor(`document.querySelector('[data-approval=card][data-state=returned]')`, 'returned');
  d = await docOf('b4');
  check('returned by Tariq with the reason', d.approval.status === 'returned' && d.approval.decidedById === 'u-mgr' && d.approval.decisionNote === 'Scaffolding is missing from the price');
  n = (await notes()).slice(before);
  check('Mona notified that it was sent back', n.length === 1 && n[0].forUserId === 'u-mona' && n[0].type === 'opportunity_approval_decided' && n[0].message.includes('Scaffolding'), JSON.stringify(n));
  check('the reason shows on the card', ((await txt('[data-approval=decision-note]')) || '').includes('Scaffolding is missing'));

  // ── [5] Mona fixes the price, asks again; manager approves ───────────────
  console.log('\n[5] ask again at a new price, approve');
  await mountAs('u-mona');
  await openBid('b4');
  await waitFor(`document.querySelector('[data-approval=card][data-state=returned]')`, 'returned for Mona');
  check('Mona sees "Sent back by a manager" and the reason', (await txt('[data-approval=heading]')) === 'Sent back by a manager' && ((await txt('[data-approval=decision-note]')) || '').includes('Scaffolding'));
  await editBid({ value: 1350000 });
  await saveEdit();
  await waitFor(`!document.querySelector('.modal')`, 'modal closed');
  check('price edit on its own is allowed', (await docOf('b4')).estimatedValue === 1350000);
  await clickEl(`document.querySelector('[data-approval=ask]')`, 'ask again');
  await waitFor(`document.querySelector('[data-approval=card][data-state=requested]')`, 'requested at new price');
  check('new request covers 1,350,000', (await docOf('b4')).approval.amount === 1350000);
  await mountAs('u-mgr');
  await openBid('b4');
  await waitFor(`document.querySelector('[data-approval=card][data-state=requested]')`, 'manager view');
  await typeNote('OK at this price');
  await clickEl(`document.querySelector('[data-approval=approve]')`, 'approve');
  await waitFor(`document.querySelector('[data-approval=card][data-state=approved]')`, 'approved');
  d = await docOf('b4');
  check('approved by Tariq at 1,350,000 EGP', d.approval.status === 'approved' && d.approval.decidedByName === 'Tariq Salama' && d.approval.amount === 1350000);
  check('who/when recorded', typeof d.approval.decidedAt === 'number' && Math.abs(d.approval.decidedAt - Date.now()) < 60000);
  check('Mona notified of the approval', (await notes()).some(x => x.forUserId === 'u-mona' && x.title.startsWith('Offer approved')));
  check('approved card says who and the price', /Tariq Salama approved it on .* at 1,350,000 EGP\./.test((await txt('[data-approval=status]')) || ''), await txt('[data-approval=status]'));

  // ── [6] Price changes after approval → stale ─────────────────────────────
  console.log('\n[6] price moves after approval');
  await mountAs('u-mona');
  await openBid('b4');
  await waitFor(`document.querySelector('[data-approval=card][data-state=approved]')`, 'approved for Mona');
  check('Mona sees "Mark as sent"', (await count('[data-approval=mark-sent]')) === 1);
  await editBid({ stage: 'Submitted', value: 1400000 });
  check('stage note: price differs → needs sign-off', ((await txt('[data-approval=stage-note]')) || '') === 'Needs a manager’s sign-off first.');
  await saveEdit(); await sleep(200);
  check('save refused: price changed after approval', (await evalJS(`window.__txt(document.querySelector('.modal'))`)).includes('The price changed after the manager approved it'));
  await editBidValueOnly(1350000);
  check('back at the approved price → note turns green', ((await txt('[data-approval=stage-note]')) || '').startsWith('Signed off by Tariq Salama'));
  await clickEl(`window.__one('.modal button', 'Cancel')`, 'cancel');
  await sleep(150);
  await editBid({ value: 1400000 });
  await saveEdit();
  await waitFor(`document.querySelector('[data-approval=card][data-state=stale]')`, 'stale');
  check('card: "The price changed after it was approved"', (await txt('[data-approval=heading]')) === 'The price changed after it was approved');
  check('card names the new price', ((await txt('[data-approval=stale]')) || '').includes('1,400,000 EGP'));
  check('no "Mark as sent" on a stale approval', (await count('[data-approval=mark-sent]')) === 0);
  await editBid({ value: 1350000 });
  await saveEdit();
  await waitFor(`document.querySelector('[data-approval=card][data-state=approved]')`, 'approved again');
  check('price back → approval valid again', true);

  // ── [7] Mark as sent ─────────────────────────────────────────────────────
  console.log('\n[7] mark as sent');
  await clickEl(`document.querySelector('[data-approval=mark-sent]')`, 'mark sent');
  await waitFor(`document.querySelector('[data-approval=record]')`, 'record line');
  d = await docOf('b4');
  check('stage Submitted, submitted today', d.stage === 'Submitted' && d.submittedDate === (await day(0)));
  check('approval kept as it was', d.approval.status === 'approved' && d.approval.decidedById === 'u-mgr');
  const rec = await txt('[data-approval=record]');
  check('record line: approved by Tariq at the price', /Offer approved by Tariq Salama on .* at 1,350,000 EGP\./.test(rec), rec);
  await clickEl(`document.querySelector('[data-approval=history-toggle]')`, 'history');
  const rows = await evalJS(`window.__q('[data-approval=history-row]').map(window.__txt)`);
  check('history lists every step, newest first', rows.length === 6 && plain(rows[0]).includes('Tariq Salama approved') && plain(rows[5]).includes('Mona Fathy asked for sign-off'), JSON.stringify(rows.map(plain)));
  await shot('3-sent');

  // ── [8] Old sent bid, manager's own save ─────────────────────────────────
  console.log('\n[8] old bids + manager saves');
  await openBid('b3');
  check('a bid sent before sign-off existed shows no card', (await count('[data-approval=card]')) === 0 && (await count('[data-approval=record]')) === 0);
  await mountAs('u-mgr');
  await openBid('b6');
  await waitFor(`document.querySelector('[data-approval=card][data-state=none]')`, 'b6 card');
  check('manager sees "Approve this offer" (no ask)', (await count('[data-approval=approve]')) === 1 && (await count('[data-approval=ask]')) === 0);
  await editBid({ stage: 'Submitted' });
  check('stage note: saving records you as the approver', ((await txt('[data-approval=stage-note]')) || '').startsWith('No sign-off on it yet'));
  await saveEdit();
  await waitFor(`!document.querySelector('.modal')`, 'modal closed');
  d = await docOf('b6');
  check('manager save goes through and signs it', d.stage === 'Submitted' && d.approval?.status === 'approved' && d.approval.decidedById === 'u-mgr' && d.approval.amount === 90000);
  check('marked as signed when sending', d.approval.log.at(-1).onSend === true);
  await waitFor(`document.querySelector('[data-approval=record]')`, 'b6 record');
  await clickEl(`document.querySelector('[data-approval=history-toggle]')`, 'b6 history');
  check('history says "approved it when marking it as sent"', ((await txt('[data-approval=history]')) || '').includes('approved it when marking it as sent'));

  // ── [9] Arabic + RTL ─────────────────────────────────────────────────────
  console.log('\n[9] Arabic');
  await evalJS(`window.__seed('opportunities', 'b7', { title: 'صيانة خزانات', serialNumber: 'OP000007', client: 'Agiba', stage: 'Bid Preparation', currency: 'EGP', estimatedValue: 2500000, ownerId: 'u-mona', ownerName: 'Mona Fathy', userId: 'u-mona', createdAt: { seconds: 1, toDate: () => new Date() }, updatedAt: { seconds: 1, toDate: () => new Date() } })`);
  await mountAs('u-mona');
  await evalJS(`window.__setLang('ar')`); await sleep(300);
  await openBid('b7');
  await waitFor(`document.querySelector('[data-approval=card]')`, 'ar card');
  check('page is RTL', (await evalJS(`document.documentElement.dir`)) === 'rtl');
  check('heading in Arabic', (await txt('[data-approval=heading]')) === 'يحتاج العرض إلى اعتماد المدير قبل إرساله');
  check('button «اطلب الاعتماد»', (await txt('[data-approval=ask]')) === 'اطلب الاعتماد');
  const arStatus = await evalJS(`window.__txt(document.querySelector('[data-approval=status]'))`);
  check('price isolated inside the Arabic sentence', arStatus.includes('⁦2,500,000 EGP⁩'), arStatus);
  const order = await evalJS(`(() => {
    const p = document.querySelector('[data-approval=status] p');
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode(); const t = node.textContent;
    const r = document.createRange();
    const at = s => { const i = t.indexOf(s); r.setStart(node, i); r.setEnd(node, i + s.length); return r.getBoundingClientRect().left; };
    return at('EGP') > at('2,500,000');
  })()`);
  check('"2,500,000 EGP" reads left-to-right on screen (EGP to the right)', order);
  await clickEl(`document.querySelector('[data-approval=ask]')`, 'ar ask');
  await waitFor(`document.querySelector('[data-approval=card][data-state=requested]')`, 'ar requested');
  check('Arabic waiting heading', (await txt('[data-approval=heading]')) === 'بانتظار اعتماد المدير');
  const dateOrder = await evalJS(`(() => {
    const p = document.querySelector('[data-approval=status] p');
    const node = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode(); const t = node.textContent;
    const i = t.indexOf('\u2068'); const j = t.indexOf('\u2069', i);
    const inner = t.slice(i + 1, j);
    const day = inner.match(/^\\d+/)[0];
    const month = inner.replace(/^\\d+\\s*/, '').split(/[\\s،,]/)[0];
    const r = document.createRange();
    const pos = s => { const k = t.indexOf(s, i); r.setStart(node, k); r.setEnd(node, k + s.length); return r.getBoundingClientRect().left; };
    return pos(day) > pos(month);   // RTL: the day is read first, so it sits to the right
  })()`);
  check('Arabic date reads in order (day to the right of the month)', dateOrder);
  check('no English left on the card', !(await evalJS(`/[A-Za-z]{4,}/.test(window.__txt(document.querySelector('[data-approval=card]')).replace(/Mona|Fathy|EGP|Sep|[A-Z][a-z]{2}/g, ''))`)), await evalJS(`window.__txt(document.querySelector('[data-approval=card]'))`));
  await shot('4-ar');

  // ── [10] Phone ───────────────────────────────────────────────────────────
  console.log('\n[10] 390 px');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  const over = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check('no horizontal page scroll at 390 px (ar)', over <= 1, `overflow ${over}px`);
  await shot('5-ar-mobile');
  await evalJS(`window.__setLang('en')`); await sleep(200);
  await mountAs('u-mgr');
  await waitFor(`document.querySelector('[data-approval=waiting]')`, 'waiting on phone');
  const over2 = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check('no horizontal page scroll at 390 px (en, waiting list)', over2 <= 1, `overflow ${over2}px`);
  await shot('6-en-mobile');
  await send('Emulation.clearDeviceMetricsOverride');

  check('no page errors', pageErrors.length === 0 && (await evalJS(`window.__errors.length`)) === 0,
    (pageErrors.join(' || ') + ' ' + (await evalJS(`window.__errors.join(' | ')`))).slice(0, 400));
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
    const p = path.join(ROOT, 'scripts/harness/approvalui-failure.png');
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
