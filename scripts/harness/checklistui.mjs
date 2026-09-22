// Click-through harness for the starting checklists (queue C3).
//
// checklists.mjs proves the rules in node. This proves the SCREENS: the real
// OpportunitiesDashboard and ProjectsDashboard (create form -> picker -> the
// checklist written on the new doc), the bid card's "0/11 steps" line, the real
// ChecklistPanel on the Checklist tab (tick / untick / add / remove / top-up /
// re-date after the deadline moves), an old bid with no checklist, Arabic + RTL
// and a 390 px phone.
//
// Real code under test:  src/OpportunitiesDashboard.tsx, src/OpportunityDetail.tsx,
//                        src/ProjectsDashboard.tsx, src/ProjectDetail.tsx,
//                        src/components/ChecklistPanel.tsx, src/lib/checklists.ts,
//                        src/i18n.ts + the real src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store, incl.
//                        runTransaction), src/lib/firebase.ts, window.fetch.
//
//   node scripts/harness/checklistui.mjs   (--headed to watch it, --shot to write PNGs)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-checklistui-'));

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
import ProjectsDashboard from './src/ProjectsDashboard';

const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
window.__day = dayOffset;
const T0 = Math.floor(Date.now() / 1000) - 86400;
const ts = s => ({ seconds: T0 + s, nanoseconds: 0, toDate: () => new Date((T0 + s) * 1000) });

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@x.com', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Business Development', userColor: '#2563eb' },
  { id: 'u-mona', displayName: 'Mona Fathy',   email: 'm@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
];
__seed('opportunities', '--stats--', { value: 40 });
__seed('projects', '--stats--', { value: 60 });
// An OLD bid (made before C3) — no checklist field at all.
__seed('opportunities', 'op-old', { title: 'Legacy compressor overhaul', serialNumber: 'OP000031', client: 'GUPCO', stage: 'Identified', source: 'Public Tender', submissionDeadline: dayOffset(10), ownerId: 'u-mgr', ownerName: 'Tariq Salama', userId: 'u-mgr', createdAt: ts(0), updatedAt: ts(0) });

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@x.com' };
const appUser = USERS[0];
const root = createRoot(document.getElementById('root'));
window.__mount = view => {
  root.render(React.createElement('div', { className: 'app-main' },
    view === 'projects'
      ? React.createElement(ProjectsDashboard, { key: 'p', user, appUser, projectUsers: USERS, onNavigate: () => {} })
      : view === 'blank' ? React.createElement('div', null, 'blank')
      : React.createElement(OpportunitiesDashboard, { key: 'o', user, appUser, projectUsers: USERS, onNavigate: () => {} })));
};
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
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'checklistuiEntry.tsx', loader: 'tsx' },
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
  const p = path.join(ROOT, `scripts/harness/checklistui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}

const allOf = c => evalJS(`JSON.stringify([...(window.__store.get(${JSON.stringify(c)}) || new Map()).entries()].map(([id,d])=>({id,...d})))`).then(JSON.parse);
const day = n => evalJS(`window.__day(${n})`);
const modal = `document.querySelector('.modal')`;
// A modal field, found by its label text (Field renders <label><span>label</span>control</label>
// or a div wrapper — so walk up from the label span to the first control after it).
const fieldIn = label => `(() => {
  const m = ${modal}; if (!m) return null;
  const lab = [...m.querySelectorAll('label, span, div')].find(e => window.__txt(e) === ${JSON.stringify(label)} && e.children.length === 0);
  if (!lab) return null;
  let p = lab.parentElement;
  for (let i = 0; i < 3 && p; i++, p = p.parentElement) { const c = p.querySelector('input, select, textarea'); if (c) return c; }
  return null;
})()`;
const setField = async (label, value) => {
  const okSet = await evalJS(`(() => { const el = ${fieldIn(label)}; if (!el) return false;
    if (el.tagName === 'SELECT') window.__pick(el, ${JSON.stringify(value)}); else window.__type(el, ${JSON.stringify(value)});
    return true; })()`);
  if (!okSet) throw new Error(`field "${label}" not found`);
  await sleep(150);
};
const valOf = label => evalJS(`(() => { const el = ${fieldIn(label)}; return el ? el.value : null; })()`);
const rows = () => evalJS(`[...document.querySelectorAll('[data-testid=checklist-row]')].filter(window.__vis).map(r => window.__txt(r))`);
// Reach a card on the board: the grid may be showing group cards first.
async function openBid(title) {
  const direct = await evalJS(`!!window.__one('.card-interactive', ${JSON.stringify(title)})`);
  if (!direct) {
    // drill into whichever group card is showing (every seeded/created bid is 'Identified')
    await clickEl(`window.__one('button, .card, [role=button]', 'Identified')`, 'Identified group');
    await waitFor(`window.__one('.card-interactive', ${JSON.stringify(title)})`, `card ${title}`);
  }
  await clickEl(`window.__one('.card-interactive h3', ${JSON.stringify(title)})`, `card ${title}`);
  await waitFor(`window.__one('button', 'All opportunities')`, 'bid detail');
}
async function tab(label) {
  await clickEl(`[...document.querySelectorAll('button')].filter(window.__vis).find(b => window.__txt(b) === ${JSON.stringify(label)})`, `tab ${label}`);
  await sleep(200);
}

try {
  await waitFor(`window.__one('button', 'New Opportunity')`, 'bids board');

  // ── [1] New bid: the picker follows the source until the user chooses ─────
  console.log('\n[1] new-bid form');
  await clickEl(`window.__one('button', 'New Opportunity')`, 'New Opportunity');
  await waitFor(modal, 'modal');
  check('picker is shown on a NEW bid', await evalJS(`!!document.querySelector('[data-testid=opp-checklist-template]')`));
  check('Public Tender → Full tender by default', await evalJS(`document.querySelector('[data-testid=opp-checklist-template]').value`) === 'tender');
  await setField('Source', 'Direct Order');
  check('Direct Order → Quick quotation', await evalJS(`document.querySelector('[data-testid=opp-checklist-template]').value`) === 'quotation');
  const optText = await evalJS(`[...document.querySelector('[data-testid=opp-checklist-template]').options].map(o => o.textContent)`);
  check('options name the step count', optText.includes('Full tender — 11 steps') && optText.includes('Quick quotation — 4 steps') && optText.includes('No checklist'), JSON.stringify(optText));
  check('hint asks for the deadline while it is blank', await evalJS(`!!window.__one('.modal span', 'Add the submission deadline')`));
  await evalJS(`window.__pick(document.querySelector('[data-testid=opp-checklist-template]'), 'tender')`); await sleep(150);
  await setField('Source', 'Referral');
  check('a hand-picked list is NOT overridden by a later source change', await evalJS(`document.querySelector('[data-testid=opp-checklist-template]').value`) === 'tender');
  await setField('Title *', 'Suez refinery shutdown tender');
  const DL = await day(30);
  await setField('Submission deadline', DL);
  check('hint switches once the deadline is set', await evalJS(`!!window.__one('.modal span', 'dated back from the submission deadline')`));
  await shot('1-form');
  await clickEl(`window.__one('.modal button', 'Create opportunity')`, 'Create');
  await waitFor(`!${modal}`, 'modal closed');

  let opps = await allOf('opportunities');
  const bid = opps.find(o => o.title === 'Suez refinery shutdown tender');
  check('bid written', !!bid);
  check('…with the 11-step tender checklist', bid && Array.isArray(bid.checklist) && bid.checklist.length === 11, bid && JSON.stringify(bid.checklist?.length));
  check('…submission step dated ON the deadline', bid && bid.checklist.find(i => i.title === 'Offer submitted')?.dueDate === DL);
  check('…bid bond requested 10 days before', bid && bid.checklist.find(i => i.title === 'Bid bond requested from the bank')?.dueDate === await day(20));
  check('…titles stored in English, nothing done', bid && bid.checklist.every(i => /^[\x20-\x7E]+$/.test(i.title) && i.done === false));

  // ── [2] "No checklist" really means none ─────────────────────────────────
  console.log('\n[2] no checklist');
  await clickEl(`window.__one('button', 'New Opportunity')`, 'New Opportunity');
  await waitFor(modal, 'modal');
  await setField('Title *', 'Framework call-off, no list');
  await evalJS(`window.__pick(document.querySelector('[data-testid=opp-checklist-template]'), 'none')`); await sleep(150);
  await clickEl(`window.__one('.modal button', 'Create opportunity')`, 'Create');
  await waitFor(`!${modal}`, 'modal closed');
  opps = await allOf('opportunities');
  const bare = opps.find(o => o.title === 'Framework call-off, no list');
  check('"No checklist" bid has an empty list', bare && Array.isArray(bare.checklist) && bare.checklist.length === 0);

  // ── [3] Card line ─────────────────────────────────────────────────────────
  console.log('\n[3] board card');
  const gridFirst = !(await evalJS(`!!window.__one('.card-interactive', 'Suez refinery')`));
  if (gridFirst) {
    await clickEl(`window.__one('button, .card, [role=button]', 'Identified')`, 'Identified group');
    await waitFor(`window.__one('.card-interactive', 'Suez refinery')`, 'card');
  }
  const cardLine = await evalJS(`(() => { const c = window.__one('.card-interactive', 'Suez refinery'); const l = c && c.querySelector('[data-testid=opp-card-checklist]'); return l ? window.__txt(l) : null; })()`);
  check('card shows "0/11 steps"', cardLine === '0/11 steps', cardLine);
  const noLine = await evalJS(`(() => { const c = window.__one('.card-interactive', 'Legacy compressor'); return c ? !c.querySelector('[data-testid=opp-card-checklist]') : null; })()`);
  check('an old bid without a checklist shows no line (quiet card)', noLine === true);
  await shot('2-board');

  // ── [4] The Checklist tab ─────────────────────────────────────────────────
  console.log('\n[4] checklist tab');
  await openBid('Suez refinery shutdown tender');
  await tab('Checklist');
  await waitFor(`document.querySelector('[data-testid=checklist-panel]')`, 'panel');
  let r = await rows();
  check('11 rows', r.length === 11, String(r.length));
  check('first row is the earliest step', r[0] && r[0].includes('Tender documents received'), r[0]);
  check('last row is the submission', r[10] && r[10].includes('Offer submitted'), r[10]);
  check('no top-up button when the list is complete', !(await evalJS(`!!window.__one('button', 'missing step')`)));
  check('no re-date button while dates match the deadline', !(await evalJS(`!!window.__one('button', 'Re-date')`)));

  await clickEl(`document.querySelector('[data-testid=checklist-row] button[aria-pressed]')`, 'tick first');
  await waitFor(`window.__txt(document.querySelector('[data-testid=checklist-panel]')).includes('1/11')`, 'progress 1/11');
  opps = await allOf('opportunities');
  let first = opps.find(o => o.title === 'Suez refinery shutdown tender').checklist.find(i => i.title === 'Tender documents received');
  check('tick written with who + when', first.done === true && first.doneByName === 'Tariq Salama' && first.doneAt === await day(0), JSON.stringify(first));
  check('row says who did it', (await rows())[0].includes('by Tariq Salama'));
  check('the tick went through a transaction update of the bid', await evalJS(`window.__writes.some(w => w.op === 'update' && w.path.startsWith('opportunities/') && Array.isArray(w.data.checklist))`));

  // untick
  await clickEl(`document.querySelector('[data-testid=checklist-row] button[aria-pressed=true]')`, 'untick');
  await waitFor(`window.__txt(document.querySelector('[data-testid=checklist-panel]')).includes('0/11')`, 'progress 0/11');
  opps = await allOf('opportunities');
  first = opps.find(o => o.title === 'Suez refinery shutdown tender').checklist.find(i => i.title === 'Tender documents received');
  check('untick clears who + when', first.done === false && !('doneAt' in first) && !('doneByName' in first), JSON.stringify(first));

  // add + remove a custom step
  await typeInto(`window.__one('[data-testid=checklist-panel] label', 'New step').querySelector('input')`, 'Get the ISO certificate copy', 'new step');
  await clickEl(`window.__one('[data-testid=checklist-panel] button', 'Add step')`, 'Add step');
  await waitFor(`document.querySelectorAll('[data-testid=checklist-row]').length === 12`, '12 rows');
  r = await rows();
  check('typed step is added (undated → last)', r[11].includes('Get the ISO certificate copy'), r[11]);
  await clickEl(`[...document.querySelectorAll('[data-testid=checklist-row]')][11].querySelector('button[aria-label="Remove step"]')`, 'remove');
  await waitFor(`document.querySelectorAll('[data-testid=checklist-row]').length === 11`, 'back to 11');
  check('remove works', true);

  // remove a template step → the top-up button offers it back
  await clickEl(`window.__one('[data-testid=checklist-row]', 'Bid bond received').querySelector('button[aria-label="Remove step"]')`, 'remove bond');
  await waitFor(`window.__one('button', 'Add 1 missing step from “Full tender”')`, 'top-up button');
  check('only the list in use is offered (no "Quick quotation" button)', !(await evalJS(`!!window.__one('button', 'Quick quotation')`)));
  await clickEl(`window.__one('button', 'Add 1 missing step')`, 'top up');
  await waitFor(`document.querySelectorAll('[data-testid=checklist-row]').length === 11`, 'restored');
  check('top-up restores the step', (await rows()).some(x => x.includes('Bid bond received')));

  // overdue: move a step into the past by hand
  // (No extra 'change' event: one input event is what a real date pick sends,
  // and it is what exposed the stale e.target.value read inside the transaction.)
  await evalJS(`window.__type(window.__one('[data-testid=checklist-row]', 'Go / no-go decision').querySelector('input[type=date]'), window.__day(-2))`);
  await waitFor(`window.__one('[data-testid=checklist-panel]', '1 step overdue')`, 'overdue');
  check('a past-dated step is flagged "Past due"', (await rows()).some(x => x.includes('Go / no-go decision') && x.includes('Past due')));
  await shot('3-tab');

  // ── [5] An OLD bid (no checklist field) ──────────────────────────────────
  console.log('\n[5] old bid');
  await clickEl(`window.__one('button', 'All opportunities')`, 'back');
  await openBid('Legacy compressor overhaul');
  await tab('Checklist');
  check('empty state explains what to do', await evalJS(`!!window.__one('[data-testid=checklist-panel] p', 'No checklist yet')`));
  check('both lists offered', await evalJS(`!!window.__one('button', 'Use the “Full tender” list') && !!window.__one('button', 'Use the “Quick quotation” list')`));
  await clickEl(`window.__one('button', 'Use the “Quick quotation” list')`, 'use quotation');
  await waitFor(`document.querySelectorAll('[data-testid=checklist-row]').length === 4`, '4 rows');
  opps = await allOf('opportunities');
  const old = opps.find(o => o.id === 'op-old');
  check('old bid now carries 4 dated steps', old.checklist.length === 4 && old.checklist[3].dueDate === await day(10), JSON.stringify(old.checklist.map(i => i.dueDate)));
  check('the rest of the old bid is untouched', old.serialNumber === 'OP000031' && old.client === 'GUPCO');

  // edit form: no picker, checklist untouched
  await clickEl(`window.__one('button', 'Edit opportunity')`, 'edit');
  await waitFor(modal, 'edit modal');
  check('edit form has NO checklist picker', !(await evalJS(`!!document.querySelector('[data-testid=opp-checklist-template]')`)));
  await setField('Submission deadline', await day(17));
  await clickEl(`window.__one('.modal button', 'Save changes')`, 'save');
  await waitFor(`!${modal}`, 'closed');
  opps = await allOf('opportunities');
  check('saving the edit form keeps the checklist', opps.find(o => o.id === 'op-old').checklist.length === 4);
  await tab('Checklist');
  check('moved deadline → "Re-date 4 steps" offered', await evalJS(`!!window.__one('button', 'Re-date 4 steps from the submission deadline')`));
  await clickEl(`window.__one('button', 'Re-date 4 steps')`, 're-date');
  await waitFor(`!window.__one('button', 'Re-date')`, 're-dated');
  opps = await allOf('opportunities');
  check('re-date moves the submission step to the new deadline', opps.find(o => o.id === 'op-old').checklist.find(i => i.title === 'Quotation sent').dueDate === await day(17));

  // ── [6] Arabic + RTL, desktop and phone ──────────────────────────────────
  console.log('\n[6] Arabic');
  await clickEl(`window.__one('button', 'All opportunities')`, 'back');
  await evalJS(`window.__setLang('ar')`); await sleep(300);
  if (!(await evalJS(`!!window.__one('.card-interactive', 'Suez refinery')`))) {
    await clickEl(`window.__one('button, .card, [role=button]', 'مُحدَّد')`, 'group (ar)');
  }
  await clickEl(`window.__one('.card-interactive h3', 'Suez refinery shutdown tender')`, 'card (ar)');
  await waitFor(`window.__one('button', 'كل الفرص')`, 'bid detail (ar)');
  await tab('قائمة الخطوات');
  await waitFor(`document.querySelector('[data-testid=checklist-panel]')`, 'panel ar');
  check('page is RTL', await evalJS(`document.documentElement.dir`) === 'rtl');
  r = await rows();
  check('step titles painted in Arabic', r.some(x => x.includes('استلام كراسة الشروط')) && r.some(x => x.includes('طلب خطاب الضمان الابتدائي من البنك')) && r.some(x => x.includes('تقديم العرض')), r[0]);
  check('no English step title left on screen', !r.some(x => /Tender documents|Bid bond|Offer submitted/.test(x)));
  check('overdue summary in Arabic', await evalJS(`!!window.__one('[data-testid=checklist-panel]', 'خطوة واحدة متأخرة')`));
  await shot('4-ar');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  const overflow = await evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check('390 px: no sideways scroll', overflow <= 1, `overflow ${overflow}px`);
  const rowOverflow = await evalJS(`[...document.querySelectorAll('[data-testid=checklist-row]')].filter(r => r.scrollWidth > r.clientWidth + 1).length`);
  check('390 px: no row spills out of its card', rowOverflow === 0, `${rowOverflow} rows`);
  await shot('5-ar-mobile');
  await send('Emulation.clearDeviceMetricsOverride');
  await evalJS(`window.__setLang('en')`); await sleep(300);

  // ── [7] Projects ─────────────────────────────────────────────────────────
  console.log('\n[7] projects');
  await evalJS(`window.__mount('blank')`); await sleep(100);
  await evalJS(`window.__mount('projects')`);
  await waitFor(`window.__one('button', 'New Project')`, 'projects board');
  await clickEl(`window.__one('button', 'New Project')`, 'New Project');
  await waitFor(modal, 'project modal');
  check('project picker defaults to New contract', await evalJS(`document.querySelector('[data-testid=proj-checklist-template]').value`) === 'contract');
  await setField('Project name *', 'Ras Gharib tank farm O&M');
  const SD = await day(5);
  await setField('Start date', SD);
  await clickEl(`window.__one('.modal button', 'Create project')`, 'Create project');
  await waitFor(`!${modal}`, 'closed');
  const projs = await allOf('projects');
  const pr = projs.find(p => p.name === 'Ras Gharib tank farm O&M');
  check('project written with the 8-step contract checklist', pr && pr.checklist?.length === 8, pr && String(pr.checklist?.length));
  check('…contract signed on the start date, first invoice +30', pr && pr.checklist.find(i => i.title === 'Contract signed').dueDate === SD && pr.checklist.find(i => i.title === 'First invoice issued').dueDate === await day(35));
  check('…the picker value did not leak into the project doc', pr && !('checklistKey' in pr));
  const drilled = await evalJS(`!!window.__one('h3, .card, button', 'Ras Gharib tank farm')`);
  if (!(await evalJS(`!!window.__one('.card-interactive', 'Ras Gharib')`))) {
    // the group grid's card (class "card" inside .card-grid-sm), not the stat tile
    await clickEl(`window.__one('.card-grid-sm .card', 'Active')`, 'Active group');
    await waitFor(`window.__one('.card-interactive', 'Ras Gharib')`, 'project card');
  }
  await clickEl(`window.__one('.card-interactive', 'Ras Gharib tank farm')`, 'project card');
  await waitFor(`window.__one('button', 'All projects')`, 'project detail');
  await tab('Checklist');
  await waitFor(`document.querySelectorAll('[data-testid=checklist-row]').length === 8`, '8 rows');
  check('project Checklist tab lists 8 steps', true);
  check('re-date label speaks of the start date (hidden while in step)', !(await evalJS(`!!window.__one('button', 'Re-date')`)));
  await shot('6-project');

  check('no page errors', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));
  void drilled;

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
    const p = path.join(ROOT, 'scripts/harness/checklistui-failure.png');
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
