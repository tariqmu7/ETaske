// Click-through harness for decision memory (queue D6).
//
// decisionmemory.mjs proves the rules in node. This proves the SCREENS in a real
// Edge: the Decisions tab on a bid (record a decision / a price / an objection,
// the form's refusals, edit, remove, who may change what, nothing else on the
// bid touched), the "Earlier with <client>" box (last price, lost / dropped bids
// with reasons and price gap, objections, lessons), a click on an earlier bid
// landing on ITS Decisions tab, the Outcome record shown read-only, the client
// file's "What we learned" section, Arabic + RTL and a 390 px phone.
//
// Real code under test:  src/OpportunitiesDashboard.tsx, src/OpportunityDetail.tsx,
//                        src/components/opportunities/OpportunityDecisionsTab.tsx,
//                        src/components/opportunities/EarlierWithClient.tsx,
//                        src/ClientsDashboard.tsx, src/lib/decisionMemory.ts,
//                        src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store, incl.
//                        runTransaction), src/lib/firebase.ts, window.fetch.
//
//   node scripts/harness/decisionsui.mjs   (--headed to watch it, --shot to write PNGs)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-decisionsui-'));

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
import ClientsDashboard from './src/ClientsDashboard';
import { requestOpen } from './src/lib/deepLink';

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
window.__day = dayOffset;
const ts = n => { const d = new Date(now.getTime() + n * 86400000); return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d, toMillis: () => d.getTime() }; };
const at = n => now.getTime() + n * 86400000;

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@x.com', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Business Development' },
  { id: 'u-mona', displayName: 'Mona Fathy',   email: 'm@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
];
__seed('opportunities', '--stats--', { value: 40 });
// Lost on price — a logged story plus an Outcome record.
__seed('opportunities', 'b1', { title: 'Tank cleaning 2025', serialNumber: 'OP000001', client: 'AGIBA Co.', stage: 'Lost', currency: 'EGP',
  decisionDate: dayOffset(-200), awardedTo: 'Petrojet', userId: 'u-mgr', createdAt: ts(-300), updatedAt: ts(-200),
  decisions: [
    { id: 'e1', kind: 'price', date: dayOffset(-260), text: 'First offer', amount: 1500000, currency: 'EGP', byId: 'u-mona', byName: 'Mona Fathy', at: at(-260) },
    { id: 'e2', kind: 'objection', date: dayOffset(-240), text: 'Price 20% above budget', why: 'We explained the scaffolding cost', byId: 'u-mona', byName: 'Mona Fathy', at: at(-240) },
  ] });
__seed('opportunityFeedback', 'f1', { opportunityId: 'b1', outcome: 'Lost', reasons: ['Technical evaluation', 'Price too high'], primaryReason: 'Price too high',
  competitorName: 'Petrojet', ourPrice: 1300000, winningPrice: 1100000, priceGapPercent: 18.2,
  clientFeedback: 'Wanted a shorter shutdown', lessonsLearned: 'Offer a night shift option', authorId: 'u-mona', authorName: 'Mona Fathy', createdAt: ts(-200), updatedAt: ts(-200) });
// No Bid — the logged decision says why.
__seed('opportunities', 'b2', { title: 'Civil works Meleiha', serialNumber: 'OP000002', client: 'agiba', stage: 'No Bid', userId: 'u-mgr', createdAt: ts(-120), updatedAt: ts(-90),
  decisions: [{ id: 'e3', kind: 'decision', date: dayOffset(-90), text: 'Not bidding', why: 'Scope is 70% civil — not our work', byId: 'u-mona', byName: 'Mona Fathy', at: at(-90) }] });
// Won — the price lives only on the Outcome record.
__seed('opportunities', 'b3', { title: 'Pump overhaul', serialNumber: 'OP000003', client: 'AGIBA', stage: 'Won', currency: 'USD', decisionDate: dayOffset(-30), userId: 'u-mgr', createdAt: ts(-60), updatedAt: ts(-30) });
__seed('opportunityFeedback', 'f3', { opportunityId: 'b3', outcome: 'Won', reasons: ['Client relationship'], ourPrice: 250000, authorId: 'u-mgr', authorName: 'Tariq Salama', createdAt: ts(-30), updatedAt: ts(-30) });
// The bid being worked on now — nothing recorded yet.
__seed('opportunities', 'b4', { title: 'Tank cleaning 2026', serialNumber: 'OP000004', client: 'Agiba', stage: 'Bid Preparation', currency: 'EGP',
  submissionDeadline: dayOffset(12), ownerId: 'u-mona', ownerName: 'Mona Fathy', userId: 'u-mgr', createdAt: ts(-5), updatedAt: ts(-5) });
// Another client and a bid with no client at all.
__seed('opportunities', 'b5', { title: 'APC jetty', serialNumber: 'OP000005', client: 'APC', stage: 'Lost', userId: 'u-mgr', createdAt: ts(-50), updatedAt: ts(-40),
  decisions: [{ id: 'e5', kind: 'objection', date: dayOffset(-45), text: 'APC-only objection', byId: 'u-mgr', byName: 'Tariq Salama', at: at(-45) }] });
__seed('opportunities', 'b6', { title: 'Loose enquiry', serialNumber: 'OP000006', stage: 'Identified', userId: 'u-mgr', createdAt: ts(-2), updatedAt: ts(-2) });

const root = createRoot(document.getElementById('root'));
window.__nav = [];
window.__mount = (view, who = 'u-mgr') => {
  const appUser = USERS.find(u => u.id === who);
  const user = { uid: appUser.id, displayName: appUser.displayName, email: appUser.email };
  const onNavigate = v => window.__nav.push(v);
  root.render(React.createElement('div', { className: 'app-main' },
    view === 'clients'
      ? React.createElement(ClientsDashboard, { key: 'c' + who, user, appUser, projectUsers: USERS, onNavigate })
      : view === 'blank' ? React.createElement('div', null, 'blank')
      : React.createElement(OpportunitiesDashboard, { key: 'o' + who, user, appUser, projectUsers: USERS, onNavigate })));
};
window.__open = (id, tab) => requestOpen({ type: 'opportunity', id, tab });
window.__mount('opps');

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
// The Outlook helper is not running on this "PC".
window.fetch = async () => { throw new TypeError('Failed to fetch'); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'decisionsuiEntry.tsx', loader: 'tsx' },
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
  const p = path.join(ROOT, `scripts/harness/decisionsui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}

const docOf = id => evalJS(`JSON.stringify(window.__store.get('opportunities').get(${JSON.stringify(id)}))`).then(JSON.parse);
const day = n => evalJS(`window.__day(${n})`);
const txt = sel => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? window.__txt(e) : null; })()`);
const count = sel => evalJS(`window.__q(${JSON.stringify(sel)}).length`);
const earlier = `document.querySelector('[data-decisions=earlier]')`;

async function openBid(id, tab = 'decisions') {
  await evalJS(`window.__open(${JSON.stringify(id)}, ${JSON.stringify(tab)})`);
  await waitFor(`window.__one('button', 'All opportunities') || window.__one('button', 'كل الفرص')`, `bid ${id} page`);
}

try {
  // ── [1] Open a bid on its Decisions tab ──────────────────────────────────
  console.log('\n[1] Decisions tab + earlier with the client');
  await sleep(300);
  await openBid('b4');
  await waitFor(`document.querySelector('[data-decisions=tab]')`, 'decisions tab');
  check('deep link with tab lands on Decisions', true);
  check('the tab bar has a Decisions tab, marked active', await evalJS(`(() => { const b = window.__one('button', 'Decisions'); return !!b && getComputedStyle(b).borderBottomColor !== 'rgba(0, 0, 0, 0)'; })()`));
  check('empty bid says nothing recorded yet', !!(await txt('[data-decisions=empty]')));
  await waitFor(`${earlier} && ${earlier}.querySelector('[data-memory=last-price]')`, 'earlier box');
  const head = await evalJS(`window.__txt(${earlier}.querySelector('h3'))`);
  check('heading names the client', head.includes('Earlier with Agiba'), head);
  const lp = await txt('[data-memory=last-price]');
  check('last price = 250,000 USD from the Won bid', lp.includes('250,000 USD') && lp.includes('Pump overhaul'), lp);
  check('...labelled as the final price from the Outcome tab', lp.includes('final price, from the Outcome tab'), lp);
  const dropped = await evalJS(`window.__q('[data-memory=dropped]').map(window.__txt)`);
  check('two lost / dropped bids, newest first (No Bid, then Lost)', dropped.length === 2 && dropped[0].includes('Civil works Meleiha') && dropped[1].includes('Tank cleaning 2025'), JSON.stringify(dropped));
  check('No Bid shows the logged decision and why', dropped[0].includes('Not bidding — Scope is 70% civil'), dropped[0]);
  check('Lost shows reasons (primary first), winner and price gap', /Price too high.*Technical evaluation/.test(dropped[1]) && dropped[1].includes('Won by: Petrojet') && dropped[1].includes('Our price was 18.2% higher'), dropped[1]);
  const objections = await evalJS(`window.__q('[data-memory=block-objections] [data-memory=row]').map(window.__txt)`);
  check('objections from the log AND the Outcome record, newest first', objections.length === 2 && objections[0].includes('Wanted a shorter shutdown') && objections[1].includes('Price 20% above budget'), JSON.stringify(objections));
  check('our answer is shown under the objection', objections[1].includes('Our answer: We explained the scaffolding cost'), objections[1]);
  check('lesson learned shown', (await txt('[data-memory=block-lessons]') || '').includes('Offer a night shift option'));
  check('another client\'s objection is not here', !(await evalJS(`window.__txt(${earlier})`)).includes('APC-only'));
  check('prices list has one line per earlier bid (2)', (await count('[data-memory=price]')) === 2);
  await shot('1-tab');

  // ── [2] The form refuses what it should ─────────────────────────────────
  console.log('\n[2] record a decision');
  const before = await docOf('b4');
  await clickEl(`document.querySelector('[data-decisions=add-decision]')`, 'Record a decision');
  await waitFor(`document.querySelector('[data-decisions=form][data-kind=decision]')`, 'decision form');
  check('date defaults to today', (await evalJS(`document.querySelector('[data-decisions=date]').value`)) === await day(0));
  await clickEl(`document.querySelector('[data-decisions=save]')`, 'Save (empty)');
  check('empty decision refused with a message', ((await txt('[data-decisions=problem]')) || '').includes('Write what was decided.'));
  check('...and nothing written', !(await docOf('b4')).decisions);
  await setVal('[data-decisions=text-input]', 'Bid at 5% below last year');
  await setVal('[data-decisions=why-input]', 'Lost the 2025 job on price by 18%');
  await clickEl(`document.querySelector('[data-decisions=save]')`, 'Save decision');
  await waitFor(`!document.querySelector('[data-decisions=form]')`, 'form closed');
  let b4 = await docOf('b4');
  const d0 = (b4.decisions || [])[0];
  check('decision written on the bid doc', d0 && d0.kind === 'decision' && d0.text === 'Bid at 5% below last year' && d0.why === 'Lost the 2025 job on price by 18%', JSON.stringify(d0));
  check('...with author + date', d0 && d0.byId === 'u-mgr' && d0.byName === 'Tariq Salama' && d0.date === await day(0));
  check('...and updatedAt NOT bumped (a note is not activity)', JSON.stringify(b4.updatedAt) === JSON.stringify(before.updatedAt));
  check('...other fields untouched', b4.title === before.title && b4.stage === before.stage && b4.ownerId === before.ownerId);
  await waitFor(`document.querySelector('[data-decisions=row][data-kind=decision]')`, 'decision row');
  check('row shows "Why:" and the reason', ((await txt('[data-decisions=row][data-kind=decision] [data-decisions=why]')) || '').includes('Why: Lost the 2025 job'));

  // ── [3] A price ────────────────────────────────────────────────────────
  console.log('\n[3] record a price');
  await clickEl(`document.querySelector('[data-decisions=add-price]')`, 'Record a price');
  await waitFor(`document.querySelector('[data-decisions=form][data-kind=price]')`, 'price form');
  check('currency defaults to the bid currency (EGP)', (await evalJS(`document.querySelector('[data-decisions=currency]').value`)) === 'EGP');
  await setVal('[data-decisions=amount-input]', '12k');
  await clickEl(`document.querySelector('[data-decisions=save]')`, 'Save (bad amount)');
  check('"12k" refused', ((await txt('[data-decisions=problem]')) || '').includes('Enter the price as a number'));
  await setVal('[data-decisions=amount-input]', '1,180,000');
  await setVal('[data-decisions=text-input]', 'First offer');
  await setVal('[data-decisions=date]', await day(-1));
  await clickEl(`document.querySelector('[data-decisions=save]')`, 'Save price');
  await waitFor(`!document.querySelector('[data-decisions=form]')`, 'form closed');
  b4 = await docOf('b4');
  const p0 = b4.decisions.find(x => x.kind === 'price');
  check('price stored as a number with currency', p0 && p0.amount === 1180000 && p0.currency === 'EGP' && p0.date === await day(-1), JSON.stringify(p0));
  check('price row paints "1,180,000 EGP"', ((await txt('[data-decisions=row][data-kind=price] [data-decisions=amount]')) || '') === '1,180,000 EGP');
  const order = await evalJS(`window.__q('[data-decisions=row]').map(r => r.dataset.kind)`);
  check('timeline newest first (today\'s decision above yesterday\'s price)', order.join() === 'decision,price', order.join());

  // ── [4] An objection, edited, then removed ──────────────────────────────
  console.log('\n[4] objection, edit, remove');
  await clickEl(`document.querySelector('[data-decisions=add-objection]')`, 'Record an objection');
  await waitFor(`document.querySelector('[data-decisions=form][data-kind=objection]')`, 'objection form');
  await setVal('[data-decisions=text-input]', 'Want HSE plan before award');
  await setVal('[data-decisions=why-input]', 'Sent our HSE plan the same day');
  await clickEl(`document.querySelector('[data-decisions=save]')`, 'Save objection');
  await waitFor(`document.querySelector('[data-decisions=row][data-kind=objection]')`, 'objection row');
  check('objection row shows "Our answer:"', ((await txt('[data-decisions=row][data-kind=objection] [data-decisions=why]')) || '').includes('Our answer: Sent our HSE plan'));
  // Edit the decision
  await clickEl(`document.querySelector('[data-decisions=row][data-kind=decision] [data-decisions=edit]')`, 'Edit decision');
  await waitFor(`document.querySelector('[data-decisions=form][data-kind=decision]')`, 'edit form');
  check('edit form is filled with the entry', (await evalJS(`document.querySelector('[data-decisions=text-input]').value`)) === 'Bid at 5% below last year');
  await setVal('[data-decisions=why-input]', 'Lost 2025 on price by 18% — Petrojet won');
  await clickEl(`document.querySelector('[data-decisions=save]')`, 'Save edit');
  await waitFor(`!document.querySelector('[data-decisions=form]')`, 'form closed');
  b4 = await docOf('b4');
  const d1 = b4.decisions.find(x => x.kind === 'decision');
  check('edit saved, same id, author kept, editedAt stamped', d1.id === d0.id && d1.why.includes('Petrojet won') && d1.byId === 'u-mgr' && d1.at === d0.at && typeof d1.editedAt === 'number');
  check('row says "edited"', ((await txt('[data-decisions=row][data-kind=decision]')) || '').includes('edited'));
  check('three entries on the bid', b4.decisions.length === 3);
  // Remove the objection — two steps
  await clickEl(`document.querySelector('[data-decisions=row][data-kind=objection] [data-decisions=remove]')`, 'Remove');
  check('remove asks first', !!(await evalJS(`!!window.__one('span', 'Remove this entry?')`)) && (await docOf('b4')).decisions.length === 3);
  await clickEl(`document.querySelector('[data-decisions=confirm-remove]')`, 'Confirm remove');
  await waitFor(`!document.querySelector('[data-decisions=row][data-kind=objection]')`, 'objection gone');
  check('objection removed from the doc', (await docOf('b4')).decisions.map(x => x.kind).join() === 'decision,price');
  await shot('2-logged');

  // ── [5] An earlier bid opens on ITS Decisions tab; outcome rows read-only ─
  console.log('\n[5] earlier bid link');
  await clickEl(`[...document.querySelectorAll('[data-memory=dropped] [data-memory=bid-link]')].find(b => window.__txt(b).includes('Tank cleaning 2025'))`, 'earlier bid link');
  await waitFor(`window.__one('h1', 'Tank cleaning 2025')`, 'b1 page');
  await waitFor(`document.querySelector('[data-decisions=row][data-source=outcome]')`, 'b1 decisions tab');
  check('landed on the earlier bid, Decisions tab', true);
  const b1rows = await evalJS(`window.__q('[data-decisions=row]').map(r => r.dataset.source + ':' + r.dataset.kind)`);
  check('outcome facts on top, then the log', b1rows.join() === 'outcome:outcome,outcome:price,outcome:objection,outcome:lesson,log:objection,log:price', b1rows.join());
  check('outcome rows have no Edit/Remove', (await count('[data-decisions=row][data-source=outcome] [data-decisions=edit]')) === 0);
  check('outcome row shows winner + winning price', ((await txt('[data-decisions=row][data-kind=outcome]')) || '').includes('Won by: Petrojet · Winning price: 1,100,000 EGP'));
  check('the log rows by someone else are still editable by a manager', (await count('[data-decisions=row][data-source=log] [data-decisions=edit]')) === 2);
  const e1 = await evalJS(`window.__txt(${earlier})`);
  check('b1\'s own "earlier" box now includes the NEW price on b4', e1.includes('1,180,000 EGP') && e1.includes('Tank cleaning 2026'), e1.slice(0, 200));

  // ── [6] An employee cannot change someone else's entries ─────────────────
  console.log('\n[6] employee rights');
  await evalJS(`window.__mount('blank')`); await sleep(100);
  await evalJS(`window.__mount('opps', 'u-mona')`); await sleep(300);
  await openBid('b4');
  await waitFor(`document.querySelector('[data-decisions=row]')`, 'b4 rows as Mona');
  check('Mona sees Tariq\'s entries but cannot edit them', (await count('[data-decisions=row]')) === 2 && (await count('[data-decisions=edit]')) === 0);
  await openBid('b2');
  await waitFor(`window.__one('h1', 'Civil works Meleiha')`, 'b2 as Mona');
  await waitFor(`document.querySelector('[data-decisions=row] [data-decisions=edit]')`, 'own entry editable');
  check('...but can edit her own', (await count('[data-decisions=edit]')) === 1);
  // A bid with no client explains itself.
  await openBid('b6');
  await waitFor(`document.querySelector('[data-memory=no-client]')`, 'no-client note');
  check('bid with no client: "add one" note, no memory box', !(await evalJS(`!!document.querySelector('[data-memory=box]')`)));

  // ── [7] Client file ──────────────────────────────────────────────────────
  console.log('\n[7] client file');
  await evalJS(`window.__mount('blank')`); await sleep(100);
  await evalJS(`window.location.hash = '/clients?c=agiba'`);
  await evalJS(`window.__mount('clients')`);
  await waitFor(`document.querySelector('[data-clients=section-memory] [data-memory=last-price]')`, 'client memory section');
  const cm = await txt('[data-clients=section-memory]');
  check('section title "What we learned from their bids"', cm.startsWith('What we learned from their bids'), cm.slice(0, 60));
  check('last price is the newest across ALL their bids (b4, yesterday)', ((await txt('[data-clients=section-memory] [data-memory=last-price]')) || '').includes('1,180,000 EGP'));
  check('client file lists the lost / dropped bids too', (await count('[data-clients=section-memory] [data-memory=dropped]')) === 2);
  check('decisions block has the new decision + the No Bid one', ((await txt('[data-clients=section-memory] [data-memory=block-decisions]')) || '').includes('Bid at 5% below last year'));
  await clickEl(`[...document.querySelectorAll('[data-clients=section-memory] [data-memory=bid-link]')].find(b => window.__txt(b).includes('Civil works'))`, 'bid link on client file');
  check('a bid link on the client file navigates to Opportunities', (await evalJS(`window.__nav.slice(-1)[0]`)) === 'opportunities');
  await shot('3-client');

  // ── [8] Arabic + RTL ─────────────────────────────────────────────────────
  console.log('\n[8] Arabic');
  await evalJS(`window.location.hash = ''`);
  await evalJS(`window.__mount('blank')`); await sleep(100);
  await evalJS(`window.__mount('opps')`); await sleep(300);
  await evalJS(`window.__setLang('ar')`); await sleep(300);
  await openBid('b4');
  await waitFor(`document.querySelector('[data-decisions=tab]')`, 'ar tab');
  check('page is RTL', (await evalJS(`document.documentElement.dir`)) === 'rtl');
  check('tab label «القرارات»', !!(await evalJS(`!!window.__one('button', 'القرارات')`)));
  check('box heading «تجاربنا السابقة مع Agiba»', ((await evalJS(`window.__txt(${earlier}.querySelector('h3'))`)) || '').includes('تجاربنا السابقة مع Agiba'));
  check('buttons in Arabic', !!(await evalJS(`!!window.__one('[data-decisions=add-price]', 'سجّل سعرًا قدّمناه')`)));
  check('amount stays LTR and in Latin digits', ((await txt('[data-decisions=amount]')) || '') === '1,180,000 EGP'
    && (await evalJS(`getComputedStyle(document.querySelector('[data-decisions=amount]')).direction`)) === 'ltr');
  check('reason chips display-labelled («السعر مرتفع»)', ((await txt('[data-memory=dropped] [data-memory=reasons]')) || '').includes('السعر مرتفع'));
  check('no English left in the box headings', !(await evalJS(`[...document.querySelectorAll('[data-decisions=earlier] h4')].some(h => /[A-Za-z]{4,}/.test(h.textContent.replace(/Agiba|AGIBA|OP\\d+/g, '')))`)));
  await shot('4-ar');

  // ── [9] Phone ────────────────────────────────────────────────────────────
  console.log('\n[9] 390 px');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  const over = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check('no horizontal page scroll at 390 px (ar)', over <= 1, `overflow ${over}px`);
  const cols = await evalJS(`(() => { const a = document.querySelector('[data-decisions=this-bid]').getBoundingClientRect(); const b = document.querySelector('[data-decisions=earlier]').getBoundingClientRect(); return b.top >= a.bottom - 1; })()`);
  check('the two cards stack on a phone', cols);
  await shot('5-ar-mobile');
  await evalJS(`window.__setLang('en')`); await sleep(300);
  const over2 = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check('no horizontal page scroll at 390 px (en)', over2 <= 1, `overflow ${over2}px`);
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
    const p = path.join(ROOT, 'scripts/harness/decisionsui-failure.png');
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
