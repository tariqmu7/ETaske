// Click-through harness for bid privacy (queue M6a).
//
// Proves in a real Edge: the pure rule (lib/bidVisibility.ts) for every role;
// each viewer's Bids board lists ONLY the bids they may see (and the group card
// counts only those); the Managers only / Private badge on the row and the bid
// page; the form's "Who can see this bid" picker saves the choice, is locked for
// an employee outside the bid team, and warns a manager who is about to hide a
// bid from themselves; Arabic + RTL; a 390 px phone with no sideways scroll.
//
// Real code under test:  src/OpportunitiesDashboard.tsx, src/OpportunityDetail.tsx,
//                        src/lib/bidVisibility.ts, src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts, window.fetch.
//
// This is the SCREEN filter only. The server-side lock is queue M6c.
//
//   node scripts/harness/bidprivacyui.mjs   (--headed to watch it, --shot to write PNGs)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-bidprivacyui-'));

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
import * as bv from './src/lib/bidVisibility';
window.__bv = bv;

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
window.__day = dayOffset;
const ts = n => { const d = new Date(now.getTime() + n * 86400000); return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d, toMillis: () => d.getTime() }; };

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@x.com', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1' },
  { id: 'u-adm',  displayName: 'Hala Nabil',   email: 'h@x.com', photoURL: '', status: 'Approved', role: 'Admin',    teamId: 'T1' },
  { id: 'u-mona', displayName: 'Mona Fathy',   email: 'm@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1' },
  { id: 'u-sami', displayName: 'Sami Adel',    email: 's@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1' },
  { id: 'u-omar', displayName: 'Omar Hany',    email: 'o@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1' },
];
__seed('opportunities', '--stats--', { value: 40 });
const bid = (id, n, title, extra) => __seed('opportunities', id, { title, serialNumber: 'OP0000' + n, client: 'NOC', location: 'Oman', stage: 'Identified',
  currency: 'USD', createdAt: ts(-n), updatedAt: ts(-n), ...extra });
// p1: an old bid with NO visibility field — must read as Everyone.
bid('p1', 11, 'Open tender for all', { ownerId: 'u-mona', ownerName: 'Mona Fathy', userId: 'u-mona' });
bid('p2', 12, 'Managers-only agency', { ownerId: 'u-mona', ownerName: 'Mona Fathy', userId: 'u-mona', visibility: 'managers' });
bid('p3', 13, 'Sami private deal', { ownerId: 'u-sami', ownerName: 'Sami Adel', userId: 'u-sami', collaboratorIds: ['u-omar'], visibility: 'private' });
bid('p4', 14, 'Tariq private deal', { ownerId: 'u-mgr', ownerName: 'Tariq Salama', userId: 'u-mgr', visibility: 'private' });
// p5: created by Mona, owned by Omar — the creator keeps sight of it.
bid('p5', 15, 'Handed-over private bid', { ownerId: 'u-omar', ownerName: 'Omar Hany', userId: 'u-mona', visibility: 'private' });

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
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'bidprivacyuiEntry.tsx', loader: 'tsx' },
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
  const p = path.join(ROOT, `scripts/harness/bidprivacyui-${name}.png`);
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


const colorOf = sel => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? getComputedStyle(e).color : null; })()`);
const adds = () => evalJS(`JSON.stringify(window.__writes.filter(w => w.op === 'add' && w.path.startsWith('opportunities/')).map(w => w.data))`).then(JSON.parse);
const updates = () => evalJS(`JSON.stringify(window.__writes.filter(w => w.op !== 'add' && w.path.startsWith('opportunities/')).map(w => ({ path: w.path, data: w.data })))`).then(JSON.parse);
/** Drill into the one country card and list the visible bid rows. */
async function rowsFor(who) {
  await mountAs(who);
  await waitFor(`document.querySelector('button[data-group-card]')`, 'group card');
  const num = await evalJS(`(() => { const n = document.querySelector('button[data-group-card] .group-card-num'); return n ? n.textContent.trim() : null; })()`);
  await clickEl(`document.querySelector('button[data-group-card]')`, 'country card');
  await waitFor(`document.querySelector('[data-opp-row]')`, 'rows');
  const ids = await evalJS(`JSON.stringify([...document.querySelectorAll('[data-opp-row]')].map(r => r.getAttribute('data-opp-row')).sort())`).then(JSON.parse);
  return { ids, num };
}
async function openForm() {
  await clickEl(`document.querySelector('button[aria-label="New Opportunity"], button[aria-label="فرصة جديدة"]')`, 'new bid');
  await waitFor(`document.querySelector('[data-bid-visibility-select]')`, 'form');
}
async function editFromPage(id) {
  await openBid(id);
  await clickEl(`window.__one('button', 'Edit opportunity')`, 'edit');
  await waitFor(`document.querySelector('[data-bid-visibility-select]')`, 'edit form');
}
const sel = () => evalJS(`(() => { const s = document.querySelector('[data-bid-visibility-select]'); return { v: s.value, off: s.disabled, opts: [...s.options].map(o => o.value + '=' + o.textContent) }; })()`);
const hint = () => evalJS(`(() => { const h = document.querySelector('[data-bid-visibility-hint]'); return { kind: h.getAttribute('data-bid-visibility-hint'), text: window.__txt(h) }; })()`);
const cancel = () => clickEl(`window.__one('button', 'Cancel') || window.__one('button', 'إلغاء')`, 'cancel');

try {
  // ── [1] the rule itself ────────────────────────────────────────────────
  console.log('\n[1] lib/bidVisibility.ts');
  const r = await evalJS(`(() => {
    const { canSeeBid: s, canSetBidVisibility: c, visibilityOf: v } = window.__bv;
    const mgr = { id: 'm', role: 'Manager' }, adm = { id: 'a', role: 'Admin' }, emp = { id: 'e', role: 'Employee' };
    const other = { ownerId: 'x', userId: 'x' };
    return {
      missing: v({}), junk: v({ visibility: 'secret' }),
      allEmp: s({ ...other }, emp),
      mgrMgr: s({ ...other, visibility: 'managers' }, mgr), mgrEmp: s({ ...other, visibility: 'managers' }, emp),
      privMgr: s({ ...other, visibility: 'private' }, mgr), privAdm: s({ ...other, visibility: 'private' }, adm),
      privOwner: s({ ownerId: 'e', userId: 'x', visibility: 'private' }, emp),
      privCreator: s({ ownerId: 'x', userId: 'e', visibility: 'private' }, emp),
      privCollab: s({ ...other, collaboratorIds: ['e'], visibility: 'private' }, emp),
      privNoId: s({ ownerId: '', userId: '', visibility: 'private' }, { id: '', role: 'Employee' }),
      setNew: c(null, emp), setOther: c(other, emp), setTeam: c({ ownerId: 'e' }, emp), setMgr: c(other, mgr),
    };
  })()`);
  check('a bid with no setting reads as Everyone', r.missing === 'all' && r.junk === 'all');
  check('Everyone: an employee sees it', r.allEmp);
  check('Managers only: a manager sees it, an outside employee does not', r.mgrMgr && !r.mgrEmp);
  check('Private: a manager outside the team does NOT see it, an admin does', !r.privMgr && r.privAdm);
  check('Private: owner, creator and co-owner see it', r.privOwner && r.privCreator && r.privCollab);
  check('Private: a blank owner does not match a blank viewer id', !r.privNoId);
  check('who may change it: anyone on a new bid, the team, managers — not an outside employee', r.setNew && !r.setOther && r.setTeam && r.setMgr);

  // ── [2] each viewer's board ────────────────────────────────────────────
  console.log('\n[2] each person sees only their bids');
  const expect = {
    'u-mona': ['p1', 'p2', 'p5'],          // owner of p2, creator of p5
    'u-omar': ['p1', 'p3', 'p5'],          // co-owner of p3, owner of p5
    'u-sami': ['p1', 'p3'],
    'u-mgr':  ['p1', 'p2', 'p4'],          // manager: Managers-only yes, others' private no
    'u-adm':  ['p1', 'p2', 'p3', 'p4', 'p5'],
  };
  for (const [who, want] of Object.entries(expect)) {
    const got = await rowsFor(who);
    check(`${who} sees ${want.join(', ')}`, JSON.stringify(got.ids) === JSON.stringify(want), JSON.stringify(got.ids));
    check(`${who}: the country card counts ${want.length}`, got.num === String(want.length), `card says ${got.num}`);
  }

  // ── [3] badges ─────────────────────────────────────────────────────────
  console.log('\n[3] badges');
  await rowsFor('u-adm');
  const badge = id => evalJS(`(() => { const b = document.querySelector('[data-opp-row="${id}"] [data-bid-visibility]'); return b ? b.getAttribute('data-bid-visibility') + '|' + window.__txt(b) : null; })()`);
  check('an Everyone bid carries no badge', (await badge('p1')) === null);
  check('Managers only badge on p2', (await badge('p2')) === 'managers|Managers only', await badge('p2'));
  check('Private badge on p3', (await badge('p3')) === 'private|Private', await badge('p3'));
  await shot('1-admin-board');
  await mountAs('u-sami');
  await openBid('p3');
  check('the bid page header says Private', (await txt('h1 ~ [data-bid-visibility]')) === 'Private', await txt('h1 ~ [data-bid-visibility]'));
  await evalJS(`window.__clearPending()`);
  await mountAs('u-mona');
  await openBid('p1');
  check('no badge on an Everyone bid page', (await count('[data-bid-visibility]')) === 0);

  // ── [4] new bid saved as Private ───────────────────────────────────────
  console.log('\n[4] the form saves the choice');
  await mountAs('u-mona');
  await openForm();
  let s = await sel();
  check('a new bid starts at Everyone, and the picker is open to its creator', s.v === 'all' && !s.off, JSON.stringify(s));
  check('three choices in order', s.opts.join(',') === 'all=Everyone,managers=Managers only,private=Private', s.opts.join(','));
  check('the hint explains Everyone', (await hint()).text === 'Everyone in the department can see it.');
  await setVal('input[placeholder^="e.g. EGPC"]', 'Secret Kuwait lead');
  await setVal('[data-bid-visibility-select]', 'private');
  let h = await hint();
  check('the hint explains Private', h.kind === 'info' && h.text.startsWith('Only the bid team'), JSON.stringify(h));
  const before = (await adds()).length;
  await clickEl(`window.__one('button', 'Create opportunity')`, 'create');
  await waitFor(`!document.querySelector('[data-bid-visibility-select]')`, 'form closed');
  const made = (await adds()).slice(before).find(d => d.title === 'Secret Kuwait lead');
  check('the new bid is written with visibility private', made && made.visibility === 'private', JSON.stringify(made && made.visibility));
  const saved = await evalJS(`[...window.__store.get('opportunities').entries()].find(([, d]) => d.title === 'Secret Kuwait lead')`);
  const newId = saved && saved[0];
  await rowsFor('u-sami');
  check('another employee does not see it', !(await count(`[data-opp-row="${newId}"]`)));

  // ── [5] a manager about to hide a bid from themselves ──────────────────
  console.log('\n[5] warnings and locks');
  await mountAs('u-mgr');
  await editFromPage('p2');
  s = await sel();
  check('an existing Managers-only bid opens at Managers only, editable for a manager', s.v === 'managers' && !s.off, JSON.stringify(s));
  await setVal('[data-bid-visibility-select]', 'private');
  h = await hint();
  check('making it Private warns the manager they will lose it', h.kind === 'lose-sight' && h.text === 'You will no longer see this bid after saving.', JSON.stringify(h));
  check('the warning is amber', (await colorOf('[data-bid-visibility-hint]')) === 'rgb(180, 83, 9)');
  await cancel();

  // an employee outside the team may not change it
  await evalJS(`window.__clearPending()`);
  await mountAs('u-omar');
  await editFromPage('p1');
  s = await sel();
  check('outside employee: the picker is locked', s.off && s.v === 'all', JSON.stringify(s));
  check('outside employee: the hint says who can change it', (await hint()).text === 'Only the bid team or a manager can change this.');
  await cancel();

  // saving an old bid (no field) writes 'all' and nothing else changes for anyone
  await evalJS(`window.__clearPending()`);
  await mountAs('u-mona');
  await editFromPage('p1');
  const u0 = (await updates()).length;
  await clickEl(`window.__one('button', 'Save changes')`, 'save');
  await waitFor(`!document.querySelector('[data-bid-visibility-select]')`, 'form closed');
  const up = (await updates()).slice(u0).find(w => w.path === 'opportunities/p1');
  check('editing an old bid stamps visibility all', up && up.data.visibility === 'all', JSON.stringify(up && up.data.visibility));

  // ── [6] Arabic ─────────────────────────────────────────────────────────
  console.log('\n[6] Arabic + RTL');
  await evalJS(`window.__setLang('ar')`);
  await evalJS(`window.__clearPending()`);
  await rowsFor('u-adm');
  check('page is rtl', (await evalJS(`document.documentElement.dir`)) === 'rtl');
  check('row badge reads خاصة', (await badge('p3')) === 'private|خاصة', await badge('p3'));
  check('row badge reads المديرون فقط', (await badge('p2')) === 'managers|المديرون فقط', await badge('p2'));
  await openForm();
  s = await sel();
  check('form label is Arabic', !!(await evalJS(`!!window.__one('label, span, div', 'مَن يطّلع على العطاء')`)));
  check('choices are Arabic', s.opts.join(',') === 'all=الجميع,managers=المديرون فقط,private=خاصة', s.opts.join(','));
  check('hint is Arabic', (await hint()).text === 'يطّلع عليه جميع أفراد القسم.');
  await shot('2-ar-form');
  await cancel();

  // ── [7] phone ──────────────────────────────────────────────────────────
  console.log('\n[7] 390 px phone');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  for (const lang of ['ar', 'en']) {
    await evalJS(`window.__setLang('${lang}')`);
    await rowsFor('u-adm');
    const over = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    check(`no horizontal page scroll at 390 px (${lang})`, over <= 1, `overflow ${over}px`);
    check(`phone: the badge keeps its icon, drops its word (${lang})`, await evalJS(`(() => {
      const b = document.querySelector('[data-opp-row="p3"] [data-bid-visibility]');
      return !!b && window.__vis(b.querySelector('svg')) && !window.__vis(b.querySelector('.opp-row-private-label'));
    })()`));
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
    const p = path.join(ROOT, 'scripts/harness/bidprivacyui-failure.png');
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
