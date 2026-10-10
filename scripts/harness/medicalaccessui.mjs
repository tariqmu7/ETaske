// Click-through harness for the Medical contracts access switch (queue M2).
//
// medicalrules.mjs proves the Firestore rules in the emulator. This proves the
// admin Users screen in real Edge: the "Medical contracts" column shows each
// person's level, Edit offers No access / View only / View and edit, Save
// writes users.medicalContractsAccess, an admin row shows full access with no
// picker (and saving an admin stores 'none'), plus Arabic + RTL and 390 px.
// It also checks src/lib/medicalAccess.ts (who may view / edit) directly.
//
// Real code under test:  src/AdminDashboard.tsx, src/lib/medicalAccess.ts,
//                        src/i18n.ts + src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store),
//                        src/lib/firebase.ts.
//
//   node scripts/harness/medicalaccessui.mjs   (--headed to watch it, --shot to write PNGs)

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-medicalaccessui-'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const FIREBASE_STUB = `
export const app = {};
export const db = { __fake: true };
export const auth = { currentUser: { uid: 'u-admin' } };
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
import AdminDashboard from './src/AdminDashboard';
import { medicalAccessOf, canViewMedical, canEditMedical } from './src/lib/medicalAccess';
import i18n, { applyLanguageToDocument } from './src/i18n';

__seed('users', 'u-admin', { displayName: 'Tariq Salama', email: 't@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Admin' });
__seed('users', 'u-mgr',   { displayName: 'Hany Manager', email: 'h@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Manager' });
__seed('users', 'u-mona',  { displayName: 'Mona Fathy',   email: 'm@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', medicalContractsAccess: 'view' });
__seed('users', 'u-sami',  { displayName: 'Sami Adel',    email: 's@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', medicalContractsAccess: 'edit' });

window.__access = { medicalAccessOf, canViewMedical, canEditMedical };
const root = createRoot(document.getElementById('root'));
let n = 0;
// The app passes the live users listener; here every mount re-reads the store.
window.__mount = view => {
  n++;
  const users = [...__store.get('users').entries()].map(([id, d]) => ({ id, ...d }));
  root.render(React.createElement('div', { className: 'app-main' },
    view === 'blank' ? React.createElement('div', null, 'blank')
      : React.createElement(AdminDashboard, { key: 'a' + n, users })));
};
window.__mount('admin');

window.__choose = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'medicalaccessuiEntry.tsx', loader: 'tsx' },
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
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/admin',
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
  const p = path.join(ROOT, `scripts/harness/medicalaccessui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);

const writes = () => evalJS(`JSON.stringify(window.__writes)`).then(JSON.parse);
const remount = async () => { await evalJS(`window.__mount('blank')`); await sleep(100); await evalJS(`window.__mount('admin')`); await sleep(300); };
const level = id => evalJS(`(${q(`[data-medical-cell="${id}"] [data-medical-level]`)} || {}).dataset?.medicalLevel || null`);
const cellText = id => text(`[data-medical-cell="${id}"]`);
const pickerSel = id => `[data-medical-cell="${id}"] [data-medical-select]`;
const rowBtn = (id, label) => `[...document.querySelector('[data-medical-cell="${id}"]').closest('tr').querySelectorAll('button')].find(b => window.__txt(b) === '${label}')`;

try {

console.log('\n[1] who may view / edit (lib/medicalAccess.ts)');
const acc = await evalJS(`(() => { const a = window.__access; const u = (role, status, m) => ({ role, status, medicalContractsAccess: m });
  return JSON.stringify([
    a.medicalAccessOf(u('Admin', 'Approved')), a.medicalAccessOf(u('Manager', 'Approved')), a.medicalAccessOf(u('Employee', 'Approved', 'view')),
    a.medicalAccessOf(u('Employee', 'Approved', 'edit')), a.medicalAccessOf(u('Employee', 'Pending', 'edit')), a.medicalAccessOf(u('Employee', 'Approved', 'bogus')),
    a.medicalAccessOf(null), a.canViewMedical(u('Employee', 'Approved', 'view')), a.canEditMedical(u('Employee', 'Approved', 'view')),
    a.canEditMedical(u('Employee', 'Approved', 'edit')), a.canViewMedical(u('Manager', 'Approved')), a.medicalAccessOf(u('Admin', 'Rejected')) ]); })()`);
check('admin = edit, manager = none, view/edit as stored, pending/rejected/unknown/no user = none',
  acc === JSON.stringify(['edit', 'none', 'view', 'edit', 'none', 'none', 'none', true, false, true, false, 'none']), acc);

console.log('\n[2] the column shows each person\'s level');
await waitFor(q('[data-medical-cell="u-mona"]'), 'the Medical contracts column');
check('header "Medical contracts"', await evalJS(`[...document.querySelectorAll('th')].some(th => window.__txt(th) === 'Medical contracts')`));
check('admin row: full access, no picker', (await level('u-admin')) === 'admin' && (await cellText('u-admin')) === 'Full access (admin)');
check('manager with nothing stored: No access', (await level('u-mgr')) === 'none' && (await cellText('u-mgr')) === 'No access');
check('Mona: View only', (await level('u-mona')) === 'view' && (await cellText('u-mona')) === 'View only');
check('Sami: View and edit', (await level('u-sami')) === 'edit' && (await cellText('u-sami')) === 'View and edit');
await shot('1-list');

console.log('\n[3] an admin switches people on and off');
await clickEl(rowBtn('u-mgr', 'Edit'), 'Edit manager');
await waitFor(q(pickerSel('u-mgr')), 'the picker');
const opts = await evalJS(`JSON.stringify([...${q(pickerSel('u-mgr'))}.options].map(o => [o.value, o.textContent]))`);
check('three choices: No access / View only / View and edit', opts === JSON.stringify([['none', 'No access'], ['view', 'View only'], ['edit', 'View and edit']]), opts);
check('picker starts on the stored level (none)', (await evalJS(`${q(pickerSel('u-mgr'))}.value`)) === 'none');
await evalJS(`window.__choose(${q(pickerSel('u-mgr'))}, 'view')`);
await shot('2-edit');
let w0 = (await writes()).length;
await clickEl(rowBtn('u-mgr', 'Save'), 'Save manager');
let w = (await writes()).slice(w0);
check('Save writes medicalContractsAccess = view on the manager', w.length === 1 && w[0].path === 'users/u-mgr' && w[0].data.medicalContractsAccess === 'view', JSON.stringify(w));
check('…and keeps the role', w[0]?.data.role === 'Manager');
await remount();
check('after reload the manager shows View only', (await level('u-mgr')) === 'view');

await clickEl(rowBtn('u-sami', 'Edit'), 'Edit Sami');
check('Sami\'s picker starts on edit', (await evalJS(`${q(pickerSel('u-sami'))}.value`)) === 'edit');
await evalJS(`window.__choose(${q(pickerSel('u-sami'))}, 'none')`);
w0 = (await writes()).length;
await clickEl(rowBtn('u-sami', 'Save'), 'Save Sami');
w = (await writes()).slice(w0);
check('switching Sami off writes none', w.length === 1 && w[0].data.medicalContractsAccess === 'none', JSON.stringify(w));
await remount();
check('Sami now shows No access', (await level('u-sami')) === 'none');

console.log('\n[4] admins need no switch');
await clickEl(rowBtn('u-mona', 'Edit'), 'Edit Mona');
await evalJS(`window.__choose(document.querySelector('[data-medical-cell="u-mona"]').closest('tr').querySelector('select:not([data-medical-select])'), 'Admin')`);
await sleep(150);
check('promoting to Admin hides the picker and says full access', !(await evalJS(`!!${q(pickerSel('u-mona'))}`)) && (await level('u-mona')) === 'admin');
w0 = (await writes()).length;
await clickEl(rowBtn('u-mona', 'Save'), 'Save Mona');
w = (await writes()).slice(w0);
check('saving an admin stores none (full access comes from the role)', w.length === 1 && w[0].data.role === 'Admin' && w[0].data.medicalContractsAccess === 'none', JSON.stringify(w));
await clickEl(rowBtn('u-admin', 'Edit'), 'Edit admin');
check('an admin row in edit mode has no picker', !(await evalJS(`!!${q(pickerSel('u-admin'))}`)));
await evalJS(`__seed('users', 'u-mona', { ...__store.get('users').get('u-mona'), role: 'Employee', medicalContractsAccess: 'view' })`);
await remount();

console.log('\n[5] Arabic + RTL, and a phone');
await evalJS(`window.__setLang('ar')`);
await sleep(300);
check('Arabic: header «العقود الطبية»', await evalJS(`[...document.querySelectorAll('th')].some(th => window.__txt(th) === 'العقود الطبية')`));
check('Arabic: Mona and the manager «اطّلاع فقط», Sami «لا يطّلع عليها»',
  (await cellText('u-mona')) === 'اطّلاع فقط' && (await cellText('u-mgr')) === 'اطّلاع فقط' && (await cellText('u-sami')) === 'لا يطّلع عليها');
check('Arabic: admin «صلاحية كاملة (مدير النظام)»', (await cellText('u-admin')) === 'صلاحية كاملة (مدير النظام)');
check('page is right-to-left', (await evalJS(`document.documentElement.dir`)) === 'rtl');
await shot('3-ar');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await remount();
const ov = await overflow();
check('390 px: the page itself does not scroll sideways (the table card does)', ov <= 1, String(ov));
await shot('4-ar-mobile');
await send('Emulation.clearDeviceMetricsOverride');
await evalJS(`window.__setLang('en')`);
check('no page errors', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 800)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/medicalaccessui-failure.png');
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
