// Click-through harness for the bid page "At a glance" card (queue O2).
//
// Proves in a real Edge: the card sits above the tabs and says where the bid
// stands, what it is waiting for, the next step (red when its date has passed)
// and the last update; a stale last update is flagged on an open bid only; the
// empty states; "Add an update" opens the form prefilled with today's
// waiting-for / next step, and posting writes both onto the follow-up AND
// mirrors them onto the bid; the history lists newest first with those lines;
// Arabic + RTL; a 390 px phone with no sideways scroll.
//
// Real code under test:  src/OpportunitiesDashboard.tsx, src/OpportunityDetail.tsx,
//                        src/components/opportunities/OpportunityGlance.tsx,
//                        src/components/opportunities/OpportunityFollowUpsTab.tsx,
//                        src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts, window.fetch.
//
//   node scripts/harness/glanceui.mjs   (--headed to watch it, --shot to write PNGs)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-glanceui-'));

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
// Open bid with a full picture: last update, waiting for, a next step that is LATE.
__seed('opportunities', 'g1', { title: 'NOC Oman agency', serialNumber: 'OP000011', client: 'NOC Oman', location: 'Oman', stage: 'Bid Preparation', currency: 'USD',
  estimatedValue: 500000, submissionDeadline: dayOffset(10), ownerId: 'u-mgr', ownerName: 'Tariq Salama', userId: 'u-mgr', createdAt: ts(-40), updatedAt: ts(-2),
  lastFollowUpText: 'NOC accepted the agreement wording.', lastFollowUpAt: ts(-2),
  waitingFor: 'EPROM signature on the agency agreement', nextStep: 'Chase legal for the signed copy', nextActionDate: dayOffset(-3) });
__seed('opportunityFollowUps', 'f1', { opportunityId: 'g1', text: 'Sent our company profile.', stage: 'Identified', authorId: 'u-mgr', authorName: 'Tariq Salama', createdAt: ts(-20) });
__seed('opportunityFollowUps', 'f2', { opportunityId: 'g1', text: 'NOC accepted the agreement wording.', stage: 'Bid Preparation', authorId: 'u-mgr', authorName: 'Tariq Salama',
  waitingFor: 'EPROM signature on the agency agreement', nextStep: 'Chase legal for the signed copy', nextActionDate: dayOffset(-3), createdAt: ts(-2) });
// Open bid, last word 45 days old, a next date but no step text, no waiting-for.
__seed('opportunities', 'g2', { title: 'Burgan portal', serialNumber: 'OP000012', client: 'Burgan', location: 'Kuwait', stage: 'Prequalification', currency: 'USD',
  ownerId: 'u-mgr', ownerName: 'Tariq Salama', userId: 'u-mgr', createdAt: ts(-90), updatedAt: ts(-45),
  lastFollowUpText: 'Registration started.', lastFollowUpAt: ts(-45), nextActionDate: dayOffset(5) });
// Open bid, nothing recorded at all.
__seed('opportunities', 'g3', { title: 'Ghana tank farm', serialNumber: 'OP000013', client: 'GNPC', location: 'Ghana', stage: 'Identified', currency: 'USD',
  ownerId: 'u-mgr', ownerName: 'Tariq Salama', userId: 'u-mgr', createdAt: ts(-3), updatedAt: ts(-3) });
// Closed bid — an old update is not "stale", a passed next date is not "late".
__seed('opportunities', 'g4', { title: 'Pump overhaul', serialNumber: 'OP000014', client: 'AGIBA', location: 'Egypt', stage: 'Won', currency: 'USD', decisionDate: dayOffset(-50),
  ownerId: 'u-mgr', ownerName: 'Tariq Salama', userId: 'u-mgr', createdAt: ts(-120), updatedAt: ts(-60),
  lastFollowUpText: 'Award letter received.', lastFollowUpAt: ts(-60), nextActionDate: dayOffset(-40) });

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
window.__mount('opps', 'u-mgr');

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
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'glanceuiEntry.tsx', loader: 'tsx' },
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
  const p = path.join(ROOT, `scripts/harness/glanceui-${name}.png`);
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

const red = 'rgb(220, 38, 38)';
const colorOf = sel => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? getComputedStyle(e).color : null; })()`);
const fuAdds = () => evalJS(`JSON.stringify(window.__writes.filter(w => w.op === 'add' && w.path.startsWith('opportunityFollowUps/')).map(w => w.data))`).then(JSON.parse);

try {
  // ── [1] the full picture ─────────────────────────────────────────────────
  console.log('\n[1] an open bid with everything recorded');
  await mountAs('u-mgr');
  await openBid('g1');
  await waitFor(`document.querySelector('[data-glance]')`, 'glance card');
  check('the glance card sits ABOVE the tab bar', await evalJS(`(() => {
    const g = document.querySelector('[data-glance]'); const tab = window.__one('button', 'Follow-ups');
    return !!(g && tab && (g.compareDocumentPosition(tab) & Node.DOCUMENT_POSITION_FOLLOWING));
  })()`));
  const status = await txt('[data-glance-status]');
  check('status line names the stage and the deadline', status.includes('Bid Preparation') && status.includes('10d to deadline'), status);
  check('last update text', (await txt('[data-glance-last]')).includes('NOC accepted the agreement wording.'));
  check('no stale flag on a 2-day-old update', (await count('[data-glance-stale]')) === 0);
  check('waiting for', (await txt('[data-glance-waiting]')).includes('EPROM signature on the agency agreement'));
  const next = await txt('[data-glance-next]');
  check('next step text', next.includes('Chase legal for the signed copy'), next);
  check('next step date says 3d overdue', next.includes('3d overdue'), next);
  check('... and is painted red', (await colorOf('[data-glance-next-date]')) === red, await colorOf('[data-glance-next-date]'));
  check('the old "Latest follow-up" box is gone (no duplicate)', !(await evalJS(`document.body.textContent.includes('Latest follow-up')`)));
  check('the header no longer repeats "Next action"', !(await evalJS(`[...document.querySelectorAll('.card')][0].textContent.includes('Next action')`)));
  check('the update form is closed until asked for', (await count('[data-followup-form]')) === 0 && (await count('[data-followup-open]')) === 1);
  const hist = await evalJS(`JSON.stringify([...document.querySelectorAll('p')].map(p => p.textContent).filter(t => t === 'Sent our company profile.' || t === 'NOC accepted the agreement wording.'))`).then(JSON.parse);
  // the glance card shows the newest text once, then the history lists newest first
  check('history is newest first', JSON.stringify(hist) === JSON.stringify(['NOC accepted the agreement wording.', 'NOC accepted the agreement wording.', 'Sent our company profile.']), JSON.stringify(hist));
  check('a history entry shows its waiting-for and next step', (await count('[data-history-waiting]')) === 1 && (await count('[data-history-next]')) === 1);
  await shot('1-en-desktop');

  // ── [2] add an update from the glance card ──────────────────────────────
  console.log('\n[2] "Add an update" → post → the card follows');
  await clickEl(`document.querySelector('[data-glance-add]')`, 'add an update');
  await waitFor(`document.querySelector('[data-followup-form]')`, 'update form');
  check('form starts from the current waiting-for', (await evalJS(`document.querySelector('[data-followup-waiting]').value`)) === 'EPROM signature on the agency agreement');
  check('form starts from the current next step', (await evalJS(`document.querySelector('[data-followup-next]').value`)) === 'Chase legal for the signed copy');
  await setVal('[data-followup-waiting]', 'Client reply on the price');
  await setVal('[data-followup-next]', 'Call the client');
  await setVal('[data-followup-form] input[type=date]', await day(4));
  await evalJS(`window.__type(document.querySelector('[data-followup-form] textarea'), 'Signed copy sent; revised offer out.')`);
  await sleep(100);
  await clickEl(`window.__one('[data-followup-form] button', 'Post follow-up')`, 'post');
  await waitFor(`!document.querySelector('[data-followup-form]')`, 'form closes after posting');
  const adds = await fuAdds();
  const last = adds[adds.length - 1] || {};
  check('the follow-up carries waitingFor + nextStep', last.waitingFor === 'Client reply on the price' && last.nextStep === 'Call the client', JSON.stringify(last));
  const d1 = await docOf('g1');
  check('both are mirrored onto the bid', d1.waitingFor === 'Client reply on the price' && d1.nextStep === 'Call the client' && d1.lastFollowUpText === 'Signed copy sent; revised offer out.', JSON.stringify(d1).slice(0, 300));
  await waitFor(`(document.querySelector('[data-glance-waiting]').textContent || '').includes('Client reply on the price')`, 'glance follows the post');
  const next2 = await txt('[data-glance-next]');
  check('glance next step updated and no longer red', next2.includes('Call the client') && next2.includes('in 4d') && (await colorOf('[data-glance-next-date]')) !== red, next2);

  // ── [3] stale + date-only next step ──────────────────────────────────────
  console.log('\n[3] a bid nobody has updated for 45 days');
  await mountAs('u-mgr');
  await openBid('g2');
  await waitFor(`document.querySelector('[data-glance]')`, 'glance g2');
  check('stale flag: "No update for 45 days"', ((await txt('[data-glance-stale]')) || '').includes('No update for 45 days'), await txt('[data-glance-last]'));
  check('waiting for says Nothing recorded', (await txt('[data-glance-waiting]')).includes('Nothing recorded'));
  const n3 = await txt('[data-glance-next]');
  check('next step with a date but no text shows the date, not "Nothing recorded"', !n3.includes('Nothing recorded') && n3.includes('in 5d'), n3);

  // ── [4] empty bid ───────────────────────────────────────────────────────
  console.log('\n[4] a bid with nothing recorded');
  await mountAs('u-mgr');
  await openBid('g3');
  await waitFor(`document.querySelector('[data-glance]')`, 'glance g3');
  check('last update says No update yet.', (await txt('[data-glance-last]')).includes('No update yet.'));
  check('waiting + next both say Nothing recorded', (await txt('[data-glance-waiting]')).includes('Nothing recorded') && (await txt('[data-glance-next]')).includes('Nothing recorded'));

  // ── [5] closed bid ──────────────────────────────────────────────────────
  console.log('\n[5] a won bid');
  await mountAs('u-mgr');
  await openBid('g4');
  await waitFor(`document.querySelector('[data-glance]')`, 'glance g4');
  check('status says Won, no deadline countdown', (await txt('[data-glance-status]')) === 'Won', await txt('[data-glance-status]'));
  check('no stale flag on a closed bid', (await count('[data-glance-stale]')) === 0);
  check('a passed next date on a closed bid is not red', (await colorOf('[data-glance-next-date]')) !== red);

  // ── [6] Arabic + RTL ────────────────────────────────────────────────────
  console.log('\n[6] Arabic');
  await evalJS(`window.__setLang('ar')`);
  await mountAs('u-mgr');
  await openBid('g1');
  await waitFor(`document.querySelector('[data-glance]')`, 'glance ar');
  check('page is rtl', (await evalJS(`document.documentElement.dir`)) === 'rtl');
  const gAr = await txt('[data-glance]');
  check('labels are Arabic', ['الموقف باختصار', 'آخر تحديث', 'بانتظار', 'الخطوة التالية', 'أضف تحديثًا'].every(w => gAr.includes(w)), gAr.slice(0, 200));
  check('no English label left', !['At a glance', 'Last update', 'Waiting for', 'Next step', 'Add an update'].some(w => gAr.includes(w)), gAr.slice(0, 200));
  check('the next-step date uses Latin digits', !/[٠-٩]/.test(await txt('[data-glance-next-date]')));
  check('the last-update box keeps its accent edge on the RIGHT in RTL', await evalJS(`(() => { const s = getComputedStyle(document.querySelector('[data-glance-last]')); return parseFloat(s.borderRightWidth) === 3 && parseFloat(s.borderLeftWidth) === 1; })()`));
  await shot('2-ar-desktop');

  // ── [7] phone ──────────────────────────────────────────────────────────
  console.log('\n[7] 390 px phone');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  for (const lang of ['ar', 'en']) {
    await evalJS(`window.__setLang('${lang}')`);
    await mountAs('u-mgr');
    await openBid('g1');
    await waitFor(`document.querySelector('[data-glance]')`, 'glance phone');
    const over = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    check(`no horizontal page scroll at 390 px (${lang})`, over <= 1, `overflow ${over}px`);
    const stacked = await evalJS(`(() => { const a = document.querySelector('[data-glance-waiting]').getBoundingClientRect(), b = document.querySelector('[data-glance-next]').getBoundingClientRect(); return b.top >= a.bottom - 1; })()`);
    check(`waiting-for and next step stack on a phone (${lang})`, stacked);
    await shot(`3-${lang}-mobile`);
  }
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
    const p = path.join(ROOT, 'scripts/harness/glanceui-failure.png');
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
