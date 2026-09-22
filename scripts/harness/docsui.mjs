// Click-through harness for documents per project (queue task D4).
//
// projectdocs.mjs proves the logic (src/lib/projectDocuments.ts) in node. This
// proves the SCREENS in real Edge: the Documents page gathering filed entries,
// linked letters and task files (private tasks stay hidden), the Arabic-aware
// search with marked words, the three filters, a letter row opening its letter,
// a project link landing on the project's Documents TAB, filing a document
// (a javascript: link refused, a folder path accepted) through to the array
// written on the project, edit + remove, Arabic + RTL and 390 px.
//
// Real code under test:  src/DocumentsDashboard.tsx, src/components/DocumentsPanel.tsx,
//                        src/ProjectsDashboard.tsx + ProjectDetail.tsx, src/lib/projectDocuments.ts,
//                        src/lib/deepLink.ts, src/lib/taskVisibility.ts, src/i18n.ts + src/index.css.
// Faked:                 firebase/firestore (the shared in-memory store), src/lib/firebase.ts.
//
//   node scripts/harness/docsui.mjs   (--headed to watch it, --shot to write PNGs)

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
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-docsui-'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const FIREBASE_STUB = `
export const app = {};
export const db = { __fake: true };
export const auth = { currentUser: { uid: 'u-ahmed' } };
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
import DocumentsDashboard from './src/DocumentsDashboard';
import ProjectsDashboard from './src/ProjectsDashboard';
import { consumePending } from './src/lib/deepLink';
import i18n, { applyLanguageToDocument } from './src/i18n';

const USERS = [
  { id: 'u-ahmed', displayName: 'Ahmed Nabil', email: 'a@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
  { id: 'u-mona',  displayName: 'Mona Fathy',  email: 'm@eprom.com.eg', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Business Development' },
];

// Every date is relative to the real today, so the fixtures never rot.
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
const dayOffset = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const ts = n => { const d = new Date(now.getTime() + n * 86400000); return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d, toMillis: () => d.getTime() }; };
window.__today = dayOffset(0);

__seed('projects', 'p1', { name: 'AGIBA Meleiha O&M', client: 'AGIBA', status: 'Active', serialNumber: 'PR000001', userId: 'u-mona', createdAt: ts(-100), updatedAt: ts(-1),
  documents: [
    { id: 'a', kind: 'minutes', title: 'محضر اجتماع بدء الأعمال', date: dayOffset(-10), direction: 'internal', summary: 'اتُّفق على موعد التعبئة وتسليم خطة السلامة.', addedById: 'u-mona', addedBy: 'Mona Fathy', addedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', kind: 'offer', title: 'Technical offer — Meleiha tank cleaning', date: dayOffset(-40), direction: 'out', refNo: 'EPROM/BD/2026/118', party: 'AGIBA Petroleum',
      summary: 'Scope: cleaning of 4 crude tanks, sludge handling, 45 days.', link: 'https://drive.google.com/file/d/xyz/view', fileName: 'Technical offer.pdf', addedById: 'u-ahmed', addedBy: 'Ahmed Nabil', addedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'c', kind: 'invoice', title: 'المستخلص رقم ٣', date: dayOffset(-1), direction: 'out', refNo: '٣/٢٠٢٦', summary: 'مستخلص جارٍ عن الشهر الماضي', link: '\\\\\\\\eprom-fs01\\\\Commercial\\\\AGIBA\\\\claim3.pdf', addedById: 'u-mona', addedBy: 'Mona Fathy' },
  ] });
__seed('projects', 'p2', { name: 'مشروع صيانة خزانات رأس غارب', client: 'بتروجت', status: 'Active', serialNumber: 'PR000002', userId: 'u-mona', createdAt: ts(-50), updatedAt: ts(-2),
  documents: [
    { id: 'd', kind: 'letter', title: 'خطاب طلب تمديد مدة العقد', date: dayOffset(-5), direction: 'in', party: 'شركة بتروجت', summary: 'تطلب الشركة تمديد مدة التنفيذ ثلاثين يومًا.', addedById: 'u-mona', addedBy: 'Mona Fathy' },
  ] });
__seed('correspondences', 'L1', { subject: 'Request for site access permits', body: 'Please issue the permits for the tank farm.', sentFrom: 'AGIBA', dateReceived: dayOffset(-7),
  serialNumber: 'CR000045', projectId: 'p1', projectName: 'AGIBA Meleiha O&M', status: 'Assigned', attachedFile: 'https://drive.google.com/file/d/permits/view', attachedFileName: 'permits.pdf', userId: 'u-mona', teamId: 'T1', createdAt: ts(-7) });
__seed('correspondences', 'L2', { subject: 'Unlinked letter', sentFrom: 'Someone', dateReceived: dayOffset(-2), status: 'Unread', userId: 'u-mona', teamId: 'T1', createdAt: ts(-2) });
__seed('tasks', 'T1', { taskName: 'Prepare HSE plan', status: 'In Progress', isPrivate: false, assignedToId: 'u-mona', assignedTo: 'Mona Fathy', projectId: 'p1', serialNumber: 'TK000120',
  attachedFile: 'https://drive.google.com/file/d/hse/view', attachedFileName: 'HSE plan v1.docx', userId: 'u-mona', teamId: 'T1', createdAt: ts(-4) });
__seed('tasks', 'T3', { taskName: 'Private costing', status: 'Pending', isPrivate: true, assignedToId: 'u-mona', projectId: 'p1',
  attachedFile: 'https://drive.google.com/file/d/secret/view', attachedFileName: 'my costing.xlsx', userId: 'u-mona', teamId: 'T1', createdAt: ts(-3) });

const user = { uid: 'u-ahmed', displayName: 'Ahmed Nabil', email: 'a@eprom.com.eg' };
window.__nav = [];
window.__open = t => consumePending(t);
window.prompt = () => null;

function Shell() {
  const [view, setView] = React.useState('documents');
  window.__go = setView;
  const nav = v => { window.__nav.push(v); setView(v); };
  if (view === 'documents') return React.createElement(DocumentsDashboard, { user, appUser: USERS[0], onNavigate: nav });
  if (view === 'projects') return React.createElement(ProjectsDashboard, { user, appUser: USERS[0], projectUsers: USERS, onNavigate: nav });
  return React.createElement('div', { 'data-view': view }, view);
}

const root = createRoot(document.getElementById('root'));
root.render(React.createElement('div', { className: 'app-main' }, React.createElement(Shell)));

window.__setLang = l => { applyLanguageToDocument(l); return i18n.changeLanguage(l); };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'docsuiEntry.tsx', loader: 'tsx' },
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

const PORT = 9711 + (process.pid % 100);
const edge = spawn(EDGE, [
  HEADED ? '--new-window' : '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(WORK, 'profile')}`,
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000',
  pathToFileURL(path.join(WORK, 'index.html')).href + '#/documents',
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
  const p = path.join(ROOT, `scripts/harness/docsui-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}
const q = sel => `document.querySelector(${JSON.stringify(sel)})`;
const text = sel => evalJS(`window.__txt(${q(sel)})`);
const texts = sel => evalJS(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(sel)})].map(window.__txt))`).then(JSON.parse);
const overflow = () => evalJS(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
const docKeys = (scope = 'document') => evalJS(`JSON.stringify([...${scope}.querySelectorAll('[data-docs="row"]')].map(r => r.dataset.key))`).then(JSON.parse);
const panel = `document.querySelector('[data-testid="documents-panel"]')`;
const pageEl = `document.querySelector('[data-testid="documents-page"]')`;
async function typeInto(finderJS, text, label) {
  await clickEl(finderJS, label);
  await evalJS(`(() => { const el = ${finderJS}; el.select && el.select(); })()`);
  await send('Input.insertText', { text });
  await sleep(200);
}
async function setField(finderJS, value, label) {
  const ok = await evalJS(`(() => {
    const el = ${finderJS};
    if (!el) return false;
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return el.value === ${JSON.stringify(value)};
  })()`);
  if (!ok) throw new Error(`setField ${label}: value not applied`);
  await sleep(200);
}
const search = sel => `document.querySelector('${sel} [data-docs="search"]')`;
const projDocs = () => evalJS(`JSON.stringify(window.__store.get('projects').get('p1').documents || [])`).then(JSON.parse);

// ═══════════════════════════════════════════════════════════════════════════
try {
  console.log('[1] The Documents page gathers every source');
  await waitFor(`${pageEl} && ${pageEl}.querySelectorAll('[data-docs="row"]').length > 0`, 'rows');
  let keys = await docKeys(pageEl);
  check('six documents: 4 filed + 1 linked letter + 1 task file', keys.length === 6, JSON.stringify(keys));
  check('filed entries from BOTH projects', keys.includes('filed:p1:a') && keys.includes('filed:p2:d'));
  check('the linked letter is there', keys.includes('letter:L1'));
  check('the unlinked letter is NOT', !keys.includes('letter:L2'));
  check('a task file is there', keys.includes('task:T1'));
  check('someone else’s PRIVATE task file is NOT', !keys.includes('task:T3'));
  check('newest first', keys[0] === 'filed:p1:c', keys[0]);
  check('the count line', /6 documents across 2 projects/.test(await text('[data-docs="count"]')), await text('[data-docs="count"]'));
  await shot('1-page');

  console.log('[2] Arabic-aware search');
  await typeInto(search('[data-testid="documents-page"]'), 'اجتماع بدء الاعمال', 'page search');
  keys = await docKeys(pageEl);
  check('«الاعمال» without hamza finds «الأعمال»', keys.length === 1 && keys[0] === 'filed:p1:a', JSON.stringify(keys));
  check('the words are marked in the title', await evalJS(`!!document.querySelector('[data-key="filed:p1:a"] [data-docs="title"] mark')`));
  check('"Found: 1"', /Found: 1/.test(await text('[data-docs="count"]')));
  await setField(search('[data-testid="documents-page"]'), 'مستخلص 3', 'search');
  keys = await docKeys(pageEl);
  check('Latin 3 finds «٣»', keys.length === 1 && keys[0] === 'filed:p1:c', JSON.stringify(keys));
  await setField(search('[data-testid="documents-page"]'), 'minutes', 'search');
  check('English "minutes" finds the Arabic محضر', (await docKeys(pageEl)).includes('filed:p1:a'));
  await setField(search('[data-testid="documents-page"]'), 'CR000045', 'search');
  check('a letter serial finds the letter', JSON.stringify(await docKeys(pageEl)) === '["letter:L1"]');
  await setField(search('[data-testid="documents-page"]'), 'zzzz', 'search');
  check('no match → the "no document" line', await evalJS(`window.__vis(${q('[data-docs="none"]')})`));
  await setField(search('[data-testid="documents-page"]'), '', 'search');
  await shot('2-search');

  console.log('[3] Filters');
  await setField(`document.querySelector('[data-docs="kind-filter"]')`, 'offer', 'kind');
  check('kind = offer → the offer only', JSON.stringify(await docKeys(pageEl)) === '["filed:p1:b"]', JSON.stringify(await docKeys(pageEl)));
  await setField(`document.querySelector('[data-docs="kind-filter"]')`, 'all', 'kind');
  await setField(`document.querySelector('[data-docs="project-filter"]')`, 'p2', 'project');
  check('project = p2 → its letter only', JSON.stringify(await docKeys(pageEl)) === '["filed:p2:d"]', JSON.stringify(await docKeys(pageEl)));
  await setField(`document.querySelector('[data-docs="project-filter"]')`, 'all', 'project');
  await setField(`document.querySelector('[data-docs="direction-filter"]')`, 'in', 'direction');
  const inKeys = await docKeys(pageEl);
  check('direction = received → the incoming letters', inKeys.length === 2 && inKeys.includes('letter:L1') && inKeys.includes('filed:p2:d'), JSON.stringify(inKeys));
  await setField(`document.querySelector('[data-docs="direction-filter"]')`, 'all', 'direction');
  check('the page itself offers no edit / remove', !(await evalJS(`!!${pageEl}.querySelector('[data-docs="edit"], [data-docs="remove"]')`)));

  console.log('[4] Letter row opens the letter');
  await clickEl(`document.querySelector('[data-key="letter:L1"] [data-docs="open-record"]')`, 'open letter');
  check('navigated to Correspondences', (await evalJS(`window.__nav[window.__nav.length - 1]`)) === 'correspondences');
  check('…with L1 parked for the board', (await evalJS(`window.__open('corresponding')`)) === 'L1');
  await evalJS(`window.__go('documents')`);
  await waitFor(`${pageEl} && ${pageEl}.querySelectorAll('[data-docs="row"]').length === 6`, 'page back');

  console.log('[5] Project link lands on the project’s Documents tab');
  await clickEl(`document.querySelector('[data-key="filed:p1:a"] [data-docs="project-link"]')`, 'project link');
  await waitFor(panel, 'documents panel');
  check('the Projects board opened project p1', /AGIBA Meleiha O&M/.test(await evalJS(`document.querySelector('h1') ? document.querySelector('h1').textContent : ''`)));
  keys = await docKeys(panel);
  check('the tab lists p1’s five: 3 filed + letter + task file', keys.length === 5, JSON.stringify(keys));
  check('…and nothing of p2', !keys.some(k => k.includes('p2')));
  check('Edit shows on MY entry only', JSON.stringify(await evalJS(`JSON.stringify([...${panel}.querySelectorAll('[data-docs="edit"]')].map(b => b.closest('[data-docs="row"]').dataset.key))`).then(JSON.parse)) === '["filed:p1:b"]');
  check('a web link opens in a new tab, safely', await evalJS(`(() => { const a = document.querySelector('[data-key="filed:p1:b"] [data-docs="open-file"]'); return !!a && a.target === '_blank' && /noopener/.test(a.rel) && a.href.startsWith('https://'); })()`));
  check('a folder path gets a Copy button, not a link', await evalJS(`!!document.querySelector('[data-key="filed:p1:c"] [data-docs="copy-path"]') && !document.querySelector('[data-key="filed:p1:c"] [data-docs="open-file"]')`));
  await shot('3-tab');

  console.log('[6] File a document');
  const writes0 = await evalJS(`window.__writes.length`);
  await clickEl(`document.querySelector('[data-docs="add"]')`, 'add');
  await waitFor(`document.querySelector('[data-docs="form"]')`, 'form');
  await setField(`document.querySelector('[data-docs="kind"]')`, 'minutes', 'kind');
  await typeInto(`document.querySelector('[data-docs="title-input"]')`, 'محضر اجتماع مراجعة خطة السلامة', 'title');
  await typeInto(`document.querySelector('[data-docs="ref"]')`, 'MOM-07', 'ref');
  await typeInto(`document.querySelector('[data-docs="summary"]')`, 'اتفقنا على تركيب السقالات قبل التعبئة بأسبوع.', 'summary');
  await typeInto(`document.querySelector('[data-docs="link"]')`, 'javascript:alert(1)', 'bad link');
  await clickEl(`document.querySelector('[data-docs="save"]')`, 'save (bad link)');
  check('a javascript: link is refused with a message', await evalJS(`window.__vis(${q('[data-docs="problem"]')})`));
  check('…and nothing was written', (await evalJS(`window.__writes.length`)) === writes0);
  await setField(`document.querySelector('[data-docs="link"]')`, '\\\\eprom-fs01\\Commercial\\AGIBA\\MOM-07.pdf', 'path link');
  await clickEl(`document.querySelector('[data-docs="save"]')`, 'save');
  await waitFor(`!document.querySelector('[data-docs="form"]')`, 'form closes');
  let docs = await projDocs();
  const added = docs.find(d => d.refNo === 'MOM-07');
  check('ONE write, to projects/p1', (await evalJS(`window.__writes.length`)) === writes0 + 1 && (await evalJS(`window.__writes[window.__writes.length - 1].path`)) === 'projects/p1');
  check('the list now holds 4, the old three untouched', docs.length === 4 && ['a', 'b', 'c'].every(id => docs.some(d => d.id === id)));
  check('stored: kind, title, path, filer', !!added && added.kind === 'minutes' && added.title === 'محضر اجتماع مراجعة خطة السلامة' && added.link.startsWith('\\\\eprom-fs01') && added.addedById === 'u-ahmed' && added.addedBy === 'Ahmed Nabil');
  check('the date defaulted to today', !!added && added.date === (await evalJS('window.__today')));
  check('no undefined / empty fields stored', !!added && !('party' in added) && !('direction' in added));
  check('the new row shows', (await docKeys(panel)).includes(`filed:p1:${added && added.id}`));
  await setField(search('[data-testid="documents-panel"]'), 'السقالات', 'panel search');
  check('its summary is searchable at once', JSON.stringify(await docKeys(panel)) === JSON.stringify([`filed:p1:${added && added.id}`]), JSON.stringify(await docKeys(panel)));
  await setField(search('[data-testid="documents-panel"]'), '', 'panel search');

  console.log('[7] Edit and remove');
  await clickEl(`document.querySelector('[data-key="filed:p1:b"] [data-docs="edit"]')`, 'edit b');
  await waitFor(`document.querySelector('[data-docs="form"]')`, 'edit form');
  check('the form opens filled in', (await evalJS(`document.querySelector('[data-docs="title-input"]').value`)) === 'Technical offer — Meleiha tank cleaning');
  await setField(`document.querySelector('[data-docs="title-input"]')`, 'Technical offer rev 2 — Meleiha tank cleaning', 'title');
  await clickEl(`document.querySelector('[data-docs="save"]')`, 'save edit');
  await waitFor(`!document.querySelector('[data-docs="form"]')`, 'edit form closes');
  docs = await projDocs();
  const b = docs.find(d => d.id === 'b');
  check('title changed, filer + link kept, editedAt stamped', b.title === 'Technical offer rev 2 — Meleiha tank cleaning' && b.addedById === 'u-ahmed' && b.link === 'https://drive.google.com/file/d/xyz/view' && !!b.editedAt);
  check('the others untouched', docs.find(d => d.id === 'a').title === 'محضر اجتماع بدء الأعمال' && docs.length === 4);
  await evalJS(`window.confirm = () => true`);
  await clickEl(`document.querySelector('[data-key="filed:p1:${added.id}"] [data-docs="remove"]')`, 'remove');
  await waitFor(`!document.querySelector('[data-key="filed:p1:${added.id}"]')`, 'row gone');
  docs = await projDocs();
  check('removed from the list, the rest kept', docs.length === 3 && !docs.some(d => d.id === added.id));

  console.log('[8] Arabic + RTL');
  await evalJS(`window.__setLang('ar')`);
  await sleep(500);
  check('<html dir="rtl">', (await evalJS(`document.documentElement.dir`)) === 'rtl');
  const tabs = await evalJS(`document.body.textContent`);
  check('the tab reads «المستندات»', tabs.includes('المستندات'));
  check('kinds are labelled in Arabic', tabs.includes('محضر اجتماع') && tabs.includes('فاتورة / مستخلص'));
  check('directions in Arabic (صادر / وارد)', tabs.includes('صادر') && tabs.includes('وارد'));
  check('«إضافة مستند» button', /إضافة مستند/.test(await text('[data-docs="add"]')));
  check('no horizontal overflow at 1440 (RTL)', (await overflow()) <= 0, String(await overflow()));
  await shot('4-ar-tab');
  await evalJS(`window.__go('documents')`);
  await waitFor(`${pageEl} && ${pageEl}.querySelectorAll('[data-docs="row"]').length === 6`, 'page (ar)');
  const arBody = await evalJS(`document.body.textContent`);
  await evalJS(`window.scrollTo(0, 0)`);
  check('no horizontal overflow on the page at 1440 (RTL)', (await overflow()) <= 0, String(await overflow()));
  check('page heading and count in Arabic', arBody.includes('المستندات') && arBody.includes('عدد المستندات: 6'));
  check('no «تم» / «بواسطة» in the page', !/(^|\s)(تم|يتم|بواسطة)(\s|$)/.test(arBody));
  check('no Latin comma inside Arabic text', !/[؀-ۿ],/.test(arBody));
  await setField(search('[data-testid="documents-page"]'), 'محضر', 'ar search');
  check('Arabic search while the UI is Arabic', (await docKeys(pageEl)).includes('filed:p1:a'));
  await shot('5-ar-page');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  check('no horizontal overflow at 390px (RTL)', (await overflow()) <= 0, String(await overflow()));
  await shot('6-ar-mobile');
  await evalJS(`window.__setLang('en')`);
  await sleep(400);
  await setField(search('[data-testid="documents-page"]'), '', 'clear');
  check('no horizontal overflow at 390px (LTR)', (await overflow()) <= 0, String(await overflow()));
  await send('Emulation.clearDeviceMetricsOverride');

  check('no uncaught page errors or console.errors during the whole run', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));

} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  try {
    console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
    console.log('  body text   :', (await evalJS(`document.body.innerText.slice(0, 600)`)).replace(/\n+/g, ' | '));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/docsui-failure.png');
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
