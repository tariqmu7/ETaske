// Harness for the Arabic locale + RTL foundation.
//
// Two halves, because the two risks are different:
//   [A] node — the locale tables and i18next config. The risk here is SILENT:
//       a missing key, or a key i18next never resolves, both fall back to the
//       English key text, so an untranslated Arabic UI looks like "we just
//       haven't translated that yet" instead of a bug.
//   [B] headless Edge — the REAL TopNav with the REAL src/index.css, switched
//       to Arabic by a REAL hit-tested click. The risk here is layout: a
//       physical `right: 0` that pins a dropdown off-screen in RTL is
//       invisible to tsc and to any assertion that only reads source.
//
// Real code under test: src/i18n.ts, src/locales/{en,ar}.ts,
//                       src/hooks/useLanguage.ts, src/components/Sidebar.tsx
//                       (TopNav), and the real src/index.css.
// Faked:                firebase/{app,auth,firestore}, src/lib/firebase.ts.
//
//   node scripts/harness/i18nrtl.mjs           (add --headed to watch it)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
// Section [C] mounts the real dashboards, which need a Firestore that answers.
// Shared with inboxconvert.mjs so the two harnesses can't drift apart.
import { FIRESTORE_STUB } from './fakeFirestore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-i18n-'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const AR_RANGE = /[\u0600-\u06FF]/;

// ═══ [A] The locale tables, in node ══════════════════════════════════════════
console.log('\n[A] locale tables + i18next config');

const OUT_A = path.join(WORK, 'i18n.bundle.mjs');
// platform:'node', NOT 'neutral' — under 'neutral' esbuild refuses to read a
// package's `main` field, and react-i18next pulls in CJS-only deps
// (html-parse-stringify). Same trap bidexport.mjs hit with `xlsx`.
await build({
  entryPoints: [path.join(ROOT, 'src/i18n.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT_A, logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});

// i18n.ts stamps <html> at module load, so it needs both of these to exist.
const storeA = new Map();
globalThis.localStorage = {
  getItem: k => (storeA.has(k) ? storeA.get(k) : null),
  setItem: (k, v) => storeA.set(k, String(v)),
  removeItem: k => storeA.delete(k), clear: () => storeA.clear(),
};
const htmlAttrs = {};
globalThis.document = { documentElement: { setAttribute: (k, v) => { htmlAttrs[k] = v; } } };

const i18nMod = await import(pathToFileURL(OUT_A).href);
const i18n = i18nMod.default;
const en = (await import(pathToFileURL(await bundleOne('src/locales/en.ts', 'en')).href)).default;
const ar = (await import(pathToFileURL(await bundleOne('src/locales/ar.ts', 'ar')).href)).default;

async function bundleOne(rel, name) {
  const out = path.join(WORK, `${name}.bundle.mjs`);
  await build({ entryPoints: [path.join(ROOT, rel)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'warning' });
  return out;
}

const enKeys = Object.keys(en);
const arKeys = Object.keys(ar);
check(`en has ${enKeys.length} keys`, enKeys.length > 60, String(enKeys.length));
check('ar has exactly the same key set', enKeys.length === arKeys.length && enKeys.every(k => k in ar),
  `missing: ${enKeys.filter(k => !(k in ar)).join(', ')} | extra: ${arKeys.filter(k => !(k in en)).join(', ')}`);

// A value left as the English source is the failure mode this whole file exists
// to catch. "English" is the one legitimate Latin value (a language switcher
// must name each language in its own script).
const LATIN_OK = new Set(['English']);
const untranslated = enKeys.filter(k => !LATIN_OK.has(k) && !AR_RANGE.test(ar[k]));
check('every ar value is actually in Arabic script', untranslated.length === 0, untranslated.join(' | '));

const identical = enKeys.filter(k => !LATIN_OK.has(k) && ar[k] === en[k]);
check('no ar value is a copy of its en value', identical.length === 0, identical.join(' | '));

const emptyish = enKeys.filter(k => !ar[k] || !ar[k].trim());
check('no ar value is blank', emptyish.length === 0, emptyish.join(' | '));

// Trailing/leading spaces are load-bearing: those strings sit next to a sibling
// node (a required-field asterisk, a name). Dropping one glues words together.
const spaceMismatch = enKeys.filter(k =>
  /\s$/.test(en[k]) !== /\s$/.test(ar[k]) || /^\s/.test(en[k]) !== /^\s/.test(ar[k]));
check('trailing/leading space matches en', spaceMismatch.length === 0, spaceMismatch.map(k => JSON.stringify([en[k], ar[k]])).join(' | '));

// ★ The regression this guards. i18next's defaults read '.' as a nested path
// and ':' as a namespace. The keys ARE English sentences, so several contain
// both — those lookups missed entirely and only "looked right" because a miss
// echoes the key back, which was already English. Under ar, a miss is visible.
console.log('\n[A2] keys containing "." and ":" resolve (keySeparator/nsSeparator)');
await i18n.changeLanguage('ar');
const punctuated = enKeys.filter(k => k.includes('.') || k.includes(':'));
check(`${punctuated.length} punctuated keys exist to test`, punctuated.length >= 5, punctuated.join(' | '));
for (const k of punctuated) {
  check(`t(${JSON.stringify(k)}) resolves to Arabic`, i18n.t(k) === ar[k], `got ${JSON.stringify(i18n.t(k))}`);
}
check('a plain key still resolves', i18n.t('Tasks') === ar['Tasks'], i18n.t('Tasks'));
check('an unknown key falls back to itself', i18n.t('Not A Key') === 'Not A Key', i18n.t('Not A Key'));

await i18n.changeLanguage('en');
check('en still resolves after switching back', i18n.t('Tasks') === 'Tasks', i18n.t('Tasks'));
check('en resolves a punctuated key too', i18n.t('From:') === 'From: ', JSON.stringify(i18n.t('From:')));

console.log('\n[A3] language persistence + <html> stamp');
check('dirFor', i18nMod.dirFor('ar') === 'rtl' && i18nMod.dirFor('en') === 'ltr');
check('cold load with nothing stored -> en', htmlAttrs.lang === 'en' && htmlAttrs.dir === 'ltr', JSON.stringify(htmlAttrs));
i18nMod.applyLanguageToDocument('ar');
check('applyLanguageToDocument("ar") stamps lang+dir', htmlAttrs.lang === 'ar' && htmlAttrs.dir === 'rtl', JSON.stringify(htmlAttrs));
storeA.set(i18nMod.LANG_STORAGE_KEY, 'ar');
check('getStoredLanguage reads ar back', i18nMod.getStoredLanguage() === 'ar');
storeA.set(i18nMod.LANG_STORAGE_KEY, 'klingon');
check('a junk stored value falls back to en', i18nMod.getStoredLanguage() === 'en');
check('LANGUAGES lists both, each labelled in its own script',
  i18nMod.LANGUAGES.length === 2 && AR_RANGE.test(i18nMod.LANGUAGES.find(l => l.code === 'ar').label),
  JSON.stringify(i18nMod.LANGUAGES));

// ═══ [A4] No physical inline styles left in src/**.tsx ═══════════════════════
// The browser half below can only measure what it mounts. This half is the
// cheap, total one: a `marginLeft` added to a component nobody renders here
// still fails the run. It is also the only guard tasks 3–6 will have while they
// touch every remaining file.
console.log('\n[A4] inline styles are logical, not physical');

const PHYSICAL = /\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)\s*:|textAlign:\s*'(left|right)'|text-align:\s*(left|right)\b/g;
// `left:`/`right:` are NOT mechanical. These are the survivors, and each one is
// a deliberate decision, not an oversight:
//   a left:0 + right:0 PAIR (a full-bleed overlay/backdrop) is already
//   symmetric; `left: '50%'` under a translateX(-50%) is centred; ComboBox
//   positions its portal from a getBoundingClientRect(), which is a viewport
//   coordinate and must NOT be mirrored; LoginScreen's two blobs are decoration.
const INSET = /(^|[^A-Za-z.])(left|right)\s*:\s/g;
const INSET_ALLOW = {
  'src/App.tsx': 2,                                // bottom nav, left:0 + right:0
  'src/ArchiveDashboard.tsx': 2,                   // full-bleed row backdrop
  'src/components/Announcements.tsx': 1,           // left:0 with width:100%
  'src/components/ChatBox.tsx': 2,                 // left:0 + right:0 pair
  'src/components/ComboBox.tsx': 4,                // viewport coords from getBoundingClientRect
  'src/components/IdleResyncBanner.tsx': 1,        // left:50% + translateX(-50%)
  'src/CorrespondingsDashboard.tsx': 4,            // backdrop pair + modal scrim
  'src/LoginScreen.tsx': 2,                        // decorative blobs
  'src/OverviewDashboard.tsx': 4,                  // two modal scrims
  'src/TasksDashboard.tsx': 2,                     // full-bleed row backdrop
};

function walkTsx(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTsx(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}
const tsxFiles = walkTsx(path.join(ROOT, 'src'));
check(`${tsxFiles.length} .tsx files scanned`, tsxFiles.length > 30, String(tsxFiles.length));

const physicalHits = [];
const insetCounts = {};
for (const f of tsxFiles) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(PHYSICAL)) {
    physicalHits.push(`${rel}:${text.slice(0, m.index).split('\n').length} ${m[0].trim()}`);
  }
  const n = [...text.matchAll(INSET)].length;
  if (n) insetCounts[rel] = n;
}
check('★ no physical margin/padding/border/text-align left in any inline style',
  physicalHits.length === 0, physicalHits.slice(0, 8).join(' | '));

const insetDrift = Object.keys({ ...insetCounts, ...INSET_ALLOW })
  .filter(k => (insetCounts[k] || 0) !== (INSET_ALLOW[k] || 0))
  .map(k => `${k}: ${insetCounts[k] || 0} (allowed ${INSET_ALLOW[k] || 0})`);
check('the surviving physical left:/right: are exactly the documented ones',
  insetDrift.length === 0, insetDrift.join(' | '));

// ═══ [A5] The shell/nav/auth files are actually wired to t() ═════════════════
// Task 3 translated these twelve files. The browser half below only mounts the
// header, so this is the cheap total guard: a file reverted to hard-coded
// English (or a new screen added without a translator) fails here. The counts
// are floors, not exact numbers — adding strings is fine, losing them is not.
console.log('\n[A5] shell / nav / auth files use the translator');

// Floors only count t('literal') — the table-driven screens (nav items,
// breadcrumb trail, shortcut rows) call t(variable) and score lower than they
// look. src/i18n.ts's LANGUAGES table is the switcher and is covered by [A3].
const SHELL_FILES = {
  'src/App.tsx': 3,
  'src/components/Sidebar.tsx': 25,
  'src/components/Breadcrumbs.tsx': 3,
  'src/HomeDashboard.tsx': 35,
  'src/components/CommandPalette.tsx': 38,
  'src/components/KeyboardHelp.tsx': 1,
  'src/components/DueSoonBanner.tsx': 4,
  'src/components/Announcements.tsx': 22,
  'src/LoginScreen.tsx': 12,
  'src/PendingScreen.tsx': 3,
  'src/RejectedScreen.tsx': 3,
  'src/UsernameSetupScreen.tsx': 7,
};
// Task 4 added the tasks flow. Same contract, same floors — listed separately
// only so a failure names which pass regressed.
const TASK_FILES = {
  'src/TasksDashboard.tsx': 100,
  'src/components/CreateTaskPanel.tsx': 40,
  'src/components/ComboBox.tsx': 6,
  'src/DueSoonDashboard.tsx': 7,
};
const T_FILES = { ...SHELL_FILES, ...TASK_FILES };

for (const [rel, min] of Object.entries(T_FILES)) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const calls = [...src.matchAll(/\bt\(\s*['"`]/g)].length;
  check(`${rel}: useTranslation + ≥${min} t() calls`,
    /useTranslation/.test(src) && calls >= min, `${calls} t() calls`);
}

// Every literal passed to t() in those files must exist in en.ts, or it renders
// the key text in English under ar and looks merely "not translated yet".
// Both quote styles: a key containing an apostrophe ("You're all caught up.")
// is written with double quotes, and the single-quote-only regex missed it.
const missingKeys = [];
for (const rel of Object.keys(T_FILES)) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
    const key = m[1].replace(/\\'/g, "'");
    if (!(key in en)) missingKeys.push(`${rel}: ${key}`);
  }
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    const key = m[1].replace(/\\"/g, '"');
    if (!(key in en)) missingKeys.push(`${rel}: ${key}`);
  }
}
check('★ every t(\'…\') literal in the translated files is a real key in en.ts',
  missingKeys.length === 0, missingKeys.slice(0, 8).join(' | '));

// ── [A6] the tasks flow keeps no hard-coded English left in its JSX ──────────
// A floor can be met while a whole panel is still English. These are the exact
// strings task 4 replaced; any one of them reappearing as a bare JSX literal
// (not inside a t(...) call) is a revert.
console.log('\n[A6] no reverted literals in the tasks flow');
const REVERT_CANARIES = [
  ['src/TasksDashboard.tsx', [
    /\/>\s*Add Task\s*<\/button>/,
    /placeholder="Search tasks/,
    /\? 'My Tasks' : 'All Tasks'/,
    /^\s*Milestones\s*$/m,
    /\/>\s*Add Path\s*$/m,
    /^\s*Save Changes\s*$/m,
  ]],
  ['src/components/CreateTaskPanel.tsx', [
    /\/>\s*Create Task\s*$/m,
    /placeholder="What needs to be done/,
    /^\s*Advanced\s*$/m,
    /label: 'Public'/,
  ]],
  ['src/DueSoonDashboard.tsx', [
    />Due Soon & Overdue</,
    />Nothing due soon</,
    /^\s*Due: \{fmt/m,
  ]],
];
for (const [rel, patterns] of REVERT_CANARIES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const hit = patterns.filter(p => p.test(src)).map(String);
  check(`${rel}: no bare English literal came back`, hit.length === 0, hit.join(' | '));
}

// ═══ [B] The real TopNav in a real browser ═══════════════════════════════════
console.log('\n[B] real TopNav, real index.css, real clicks');

const FIREBASE_STUB = `export const db = {}; export const auth = {}; export const app = {}; export default {};`;
const stubPlugin = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /^firebase\/(firestore|auth|app|messaging)$/ }, () => ({ path: 'stub-empty', namespace: 'stub' }));
    b.onResolve({ filter: /\/firebase$/ }, () => ({ path: 'stub-firebase', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-firebase' ? FIREBASE_STUB
        : `export const doc = () => ({}); export const updateDoc = async () => {}; export const getDoc = async () => ({ exists: () => false });
           export const onSnapshot = () => () => {}; export const collection = () => ({}); export const query = () => ({});
           export const where = () => ({}); export const orderBy = () => ({}); export const limit = () => ({});
           export const addDoc = async () => ({ id: 'stub' }); export const setDoc = async () => {};
           export const deleteDoc = async () => {}; export const deleteField = () => ({ __delete: true });
           export const serverTimestamp = () => ({ __serverTimestamp: true }); export const Timestamp = { now: () => ({ seconds: 0 }) };
           export const runTransaction = async (_d, fn) => fn({ get: async () => ({ exists: () => false }), set: () => {}, update: () => {} });
           export const getDocs = async () => ({ docs: [] }); export const writeBatch = () => ({ set: () => {}, update: () => {}, commit: async () => {} });
           export const arrayUnion = (...a) => a; export const arrayRemove = (...a) => a; export const increment = n => n;
           export const getMessaging = () => ({}); export const getToken = async () => null; export const onMessage = () => () => {};
           export const signOut = async () => {}; export const onAuthStateChanged = () => () => {};`,
      loader: 'js',
      resolveDir: ROOT,
    }));
  },
};

const ENTRY = /* tsx */ `
import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/i18n';
import TopNav from './src/components/Sidebar';

const appUser = {
  id: 'u-mgr', displayName: 'Tariq Salama', email: 'tarekmoh123@gmail.com', photoURL: '',
  status: 'Approved', role: 'Manager', teamId: 'T1', department: 'Maintenance Planning',
  userColor: '#2563eb',
};
const notifications = [
  { id: 'n1', userId: 'u-mgr', type: 'task_assigned', title: 'New task assigned', body: 'Pump P-101 vibration report', read: false, createdAt: { seconds: 1755100000, toDate: () => new Date(1755100000000) } },
  { id: 'n2', userId: 'u-mgr', type: 'opportunity_deadline', title: 'Bid deadline in 3 days', body: 'EGPC turnaround tender', read: true, createdAt: { seconds: 1755000000, toDate: () => new Date(1755000000000) } },
];
const navCounts = { corrNeedsReview: 3, corrUnread: 2, myActiveTasks: 7, openBids: 4, bidsDueSoon: 1 };
const pwa = { canInstall: false, isInstalled: false, install: () => {}, permission: 'default', requestPush: async () => {}, pushEnabled: false, disablePush: async () => {} };

function Harness() {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => { document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); }, [dark]);
  window.__setDark = setDark;
  return React.createElement(TopNav, {
    appUser, activeView: 'tasks', onNavigate: v => { window.__navigated = v; },
    notifications, dueSoonCount: 2, announcementCount: 1, navCounts,
    onOpenPalette: () => {}, onLogout: () => { window.__loggedOut = true; },
    pwa, isDark: dark, onToggleTheme: () => setDark(d => !d),
  });
}

createRoot(document.getElementById('root')).render(React.createElement(Harness));
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'i18nEntry.tsx', loader: 'tsx' },
  bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  outfile: path.join(WORK, 'bundle.js'),
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '__VITE_ENV__',
  },
  banner: { js: `const __VITE_ENV__ = { VITE_GOOGLE_SCRIPT_URL: 'https://script.test/exec', VITE_GOOGLE_SCRIPT_SECRET: 'x' };` },
  plugins: [stubPlugin],
  logLevel: 'warning',
});

// The real stylesheet. The @import webfonts are dropped (they would hang in
// headless) — which also means this run proves LAYOUT, not glyph coverage.
const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  .replace(/@import url\([^)]*\);/g, '')
  .replace(/@tailwind [a-z]+;/g, '');
fs.writeFileSync(path.join(WORK, 'app.css'), css);
fs.writeFileSync(path.join(WORK, 'index.html'),
  `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0" />
   <link rel="stylesheet" href="app.css"></head>
   <body><div id="root"></div><script src="bundle.js"></script></body></html>`);

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('Microsoft Edge not found.'); process.exit(2); }

const PORT = 9511 + (process.pid % 100);
const edge = spawn(EDGE, [
  HEADED ? '--new-window' : '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(WORK, 'profile')}`,
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000',
  pathToFileURL(path.join(WORK, 'index.html')).href,
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function firstPage() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* not up */ }
    await sleep(150);
  }
  throw new Error('Edge did not expose a page target');
}
const page = await firstPage();
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
async function waitFor(expr, label, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalJS(`!!(${expr})`)) return true;
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${label || expr}`);
}

const HELPERS = `
window.__vis = el => !!(el && el.offsetParent !== null && el.getClientRects().length);
window.__byText = (sel, text, root) => [...(root || document).querySelectorAll(sel)]
  .filter(e => window.__vis(e) && (e.textContent || '').replace(/\\s+/g, ' ').trim().includes(text));
window.__one = (sel, text) => { const m = window.__byText(sel, text); return m.length ? m[0] : null; };
window.__box = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; };
`;
await waitFor(`document.getElementById('root') && document.getElementById('root').children.length`, 'TopNav mount');
await evalJS(HELPERS);

async function clickEl(finderJS, label) {
  const info = await evalJS(`(() => {
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
  if (info.err) throw new Error(`click ${label}: ${info.err}`);
  if (info.covered) throw new Error(`click ${label}: something else is on top (${info.hitTag})`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: info.x, y: info.y, button: 'left', clickCount: 1, buttons: 1 });
  }
  await sleep(180);
}

async function shot(name) {
  if (!SHOT) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(ROOT, `scripts/harness/i18nrtl-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}

// A word whose own text is split across more than one line box, or an element
// whose content is cut off by its own border box. Both are how an RTL layout
// bug actually shows up on screen.
const SCAN = `
window.__clipped = () => {
  const out = [];
  const walk = el => {
    if (!el || el.nodeType !== 1) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const over = el.scrollWidth - el.clientWidth;
    // Only hidden/clip actually cuts content off. 'visible' still draws it — a
    // notification badge is SUPPOSED to hang outside its button — and
    // auto/scroll leaves the user a way to reach it.
    // text-overflow:ellipsis is a DELIBERATE one-line truncation (the
    // correspondence subject, a long assignee name) and is direction-neutral —
    // it renders identically in LTR. Flagging it turns the scan into noise.
    const ellipsised = cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap';
    if (over > 0 && !ellipsised && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.clientWidth > 0) {
      out.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), over, text: (el.textContent || '').trim().slice(0, 30) });
    }
    for (const c of el.children) walk(c);
  };
  walk(document.body);
  return out;
};
// An element sitting outside the viewport is only a DEFECT if the user has no
// way to reach it. Inside a horizontally scrollable strip (the category chips,
// a wide table) it is normal — and in RTL such a strip starts scrolled to the
// far right, so its children legitimately have negative left coordinates. The
// scrollable ancestor is reported, and the caller decides.
window.__scrollParent = el => {
  let p = el.parentElement;
  while (p && p !== document.documentElement) {
    const ox = getComputedStyle(p).overflowX;
    if (ox === 'auto' || ox === 'scroll') return (String(p.className) || p.tagName).slice(0, 40);
    p = p.parentElement;
  }
  return null;
};
window.__offscreen = root => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.left < -1 || r.right > vw + 1) {
      bad.push({ cls: String(el.className).slice(0, 40), left: Math.round(r.left), right: Math.round(r.right), vw,
                 scrollable: window.__scrollParent(el) });
    }
  }
  return bad;
};
window.__unreachable = root => window.__offscreen(root).filter(b => !b.scrollable);
window.__docOverflow = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
`;
await evalJS(SCAN);

console.log('\n[B1] the switcher itself');
check('page renders with no thrown errors', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 300));
check('starts in en/ltr', await evalJS(`document.documentElement.getAttribute('dir')`) === 'ltr');

await clickEl(`document.querySelector('.topnav-avatar, .topnav-avatar-placeholder')`, 'avatar');
check('avatar opens the user menu',
  await evalJS(`!!window.__one('div','tarekmoh123@gmail.com')`));
check('the menu shows a Language section', await evalJS(`!!window.__one('div','Language')`));
await shot('menu-en');

// ★ The reason the menu is checked for containment: it is positioned with
// inset-inline-end, and a physical `right: 0` would hang it off the left edge
// in RTL — a defect no type-check and no source-reading assertion can see.
const menuOffLtr = await evalJS(`(() => {
  const b = window.__one('button','العربية'); if (!b) return 'no ar button';
  let m = b; while (m && getComputedStyle(m).position !== 'absolute') m = m.parentElement;
  return JSON.stringify(window.__offscreen(m || b));
})()`);
check('user menu sits inside the viewport in LTR', menuOffLtr === '[]', menuOffLtr);

check('both languages are offered', await evalJS(`!!window.__one('button','English') && !!window.__one('button','العربية')`));
check('English is the pressed option',
  await evalJS(`window.__one('button','English').getAttribute('aria-pressed')`) === 'true');

console.log('\n[B2] switching to Arabic');
await clickEl(`window.__one('button','العربية')`, 'Arabic');
check('<html dir> flips to rtl', await evalJS(`document.documentElement.getAttribute('dir')`) === 'rtl');
check('<html lang> flips to ar', await evalJS(`document.documentElement.getAttribute('lang')`) === 'ar');
check('the choice is persisted', await evalJS(`localStorage.getItem('etaske-lang')`) === 'ar');
check('العربية is now the pressed option',
  await evalJS(`window.__one('button','العربية').getAttribute('aria-pressed')`) === 'true');
check('the Language label itself is translated', await evalJS(`!!window.__one('div','اللغة')`));
check('the English button keeps its own script (not "الإنجليزية")',
  await evalJS(`window.__one('button','English').textContent.trim()`) === 'English');

// ★ Task 3: the nav labels themselves. Until this task they were hard-coded
// English strings inside the component, so the bar stayed English while the
// page around it flipped — the most visible possible miss.
const navTabsAr = await evalJS(`JSON.stringify([...document.querySelectorAll('.nav-tab')].map(b => b.textContent.trim()))`);
check('★ nav tabs are translated (المهام / المراسلات / الرئيسية)',
  /المهام/.test(navTabsAr) && /المراسلات/.test(navTabsAr) && /الرئيسية/.test(navTabsAr), navTabsAr);
const navStillEnglish = await evalJS(`(() => {
  const left = [...document.querySelectorAll('.nav-tab')]
    .map(b => b.textContent.replace(/[0-9+]/g, '').trim())
    .filter(txt => /^[A-Za-z ]+$/.test(txt) && txt.length);
  return JSON.stringify(left);
})()`);
check('★ no nav tab is still English in ar', navStillEnglish === '[]', navStillEnglish);
check('★ Sign Out in the open menu is translated',
  await evalJS(`!!window.__one('button','تسجيل الخروج')`));
await shot('menu-ar');

// The whole header must mirror, not just the menu. The avatar is the last item
// in the flex row, so in RTL it belongs on the LEFT half of the bar.
const avatarSide = await evalJS(`(() => {
  const a = document.querySelector('.topnav-avatar, .topnav-avatar-placeholder');
  const r = a.getBoundingClientRect();
  return JSON.stringify({ centre: Math.round(r.left + r.width / 2), vw: document.documentElement.clientWidth });
})()`).then(JSON.parse);
check('the header actually mirrors (avatar moves to the left half)',
  avatarSide.centre < avatarSide.vw / 2, JSON.stringify(avatarSide));

const menuOffRtl = await evalJS(`(() => {
  const b = window.__one('button','العربية'); if (!b) return 'no ar button';
  let m = b; while (m && getComputedStyle(m).position !== 'absolute') m = m.parentElement;
  return JSON.stringify(window.__offscreen(m || b));
})()`);
check('★ user menu still sits inside the viewport in RTL', menuOffRtl === '[]', menuOffRtl);

console.log('\n[B3] the notifications dropdown in RTL');
await clickEl(`document.querySelector('.topnav-avatar, .topnav-avatar-placeholder')`, 'close user menu');
await clickEl(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.querySelector('.lucide-bell, .lucide-bell-ring')); return b; })()`, 'bell');
const notifOff = await evalJS(`(() => {
  const d = document.querySelector('.notif-dropdown');
  return d ? JSON.stringify(window.__offscreen(d)) : 'dropdown not found';
})()`);
check('★ notif dropdown sits inside the viewport in RTL', notifOff === '[]', notifOff);
// ★ The unread badge is absolutely positioned AND nudged outward with a
// translateX. A logical property moves it to the inline end; only the explicit
// [dir=rtl] transform override makes it lean the right way. Assert both.
const badge = await evalJS(`(() => {
  const b = document.querySelector('.notif-badge');
  if (!b) return JSON.stringify({ err: 'no .notif-badge rendered' });
  const btn = b.parentElement.getBoundingClientRect(), r = b.getBoundingClientRect();
  return JSON.stringify({
    onInlineEnd: r.left + r.width / 2 < btn.left + btn.width / 2,
    leansOutward: r.left < btn.left,
    transform: getComputedStyle(b).transform,
  });
})()`).then(JSON.parse);
check('unread badge moves to the inline end in RTL', badge.onInlineEnd === true, JSON.stringify(badge));
check('unread badge leans outward, not back over the bell', badge.leansOutward === true, JSON.stringify(badge));
await shot('notif-ar');
await clickEl(`(() => [...document.querySelectorAll('button')].find(x => x.querySelector('.lucide-bell, .lucide-bell-ring')))()`, 'close bell');

console.log('\n[B4] no overflow / no clipping, RTL, both themes, 3 widths');
for (const dark of [false, true]) {
  await evalJS(`window.__setDark(${dark})`);
  // A theme flip animates colours; nothing here measures colour, but give the
  // layout a frame to settle before measuring boxes.
  await sleep(250);
  for (const w of [1440, 900, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w <= 768 });
    await sleep(220);
    const over = await evalJS(`window.__docOverflow()`);
    check(`${dark ? 'dark' : 'light'} @${w}px: no horizontal document overflow`, over <= 0, `${over}px`);
    const clipped = await evalJS(`JSON.stringify(window.__clipped())`);
    check(`${dark ? 'dark' : 'light'} @${w}px: nothing clips its own content`, clipped === '[]', clipped.slice(0, 300));
  }
}
await send('Emulation.clearDeviceMetricsOverride');
await sleep(150);
await evalJS(`window.__setDark(false)`);

console.log('\n[B5] directional icon flip (menu open — LogOut only renders there)');
await clickEl(`document.querySelector('.topnav-avatar, .topnav-avatar-placeholder')`, 'avatar');
const icons = await evalJS(`(() => {
  const lo = document.querySelector('.lucide-log-out');
  const bell = document.querySelector('.lucide-bell, .lucide-bell-ring');
  return JSON.stringify({
    logOut: lo ? getComputedStyle(lo).transform : 'not rendered',
    bell: bell ? getComputedStyle(bell).transform : 'not rendered',
  });
})()`).then(JSON.parse);
check('a directional icon (LogOut) is mirrored under dir=rtl',
  icons.logOut !== 'none' && icons.logOut !== 'not rendered', JSON.stringify(icons));
// Non-vacuous: proves the rule is scoped, not flipping every icon on the page.
check('a symbolic icon (Bell) is NOT mirrored', icons.bell === 'none', JSON.stringify(icons));

console.log('\n[B6] switching back to English');
// The menu is already open from B5 — toggling the avatar again would close it.
await clickEl(`window.__one('button','English')`, 'English');
check('<html dir> returns to ltr', await evalJS(`document.documentElement.getAttribute('dir')`) === 'ltr');
check('the en choice is persisted', await evalJS(`localStorage.getItem('etaske-lang')`) === 'en');
check('the Language label is English again', await evalJS(`!!window.__one('div','Language')`));
const navTabsEn = await evalJS(`JSON.stringify([...document.querySelectorAll('.nav-tab')].map(b => b.textContent.trim()))`);
check('non-vacuous: the same nav tabs read English again',
  /Tasks/.test(navTabsEn) && /Correspondences/.test(navTabsEn) && !/المهام/.test(navTabsEn), navTabsEn);
check('no errors across the whole run', pageErrors.length === 0 && (await evalJS(`window.__errors.length`)) === 0,
  pageErrors.join(' || ').slice(0, 400));

// ═══ [C] The big dashboards, mounted for real, in RTL ════════════════════════
// [B] only ever mounted the header. The ~140 physical inline styles this task
// converted live in the dashboards, and a `borderLeft` accent or an absolutely
// positioned search icon only misbehaves once the component is on screen with
// data in it. So: real TasksDashboard / CorrespondingsDashboard /
// OverviewDashboard / OpportunitiesDashboard / ArchiveDashboard, real
// index.css, real (fake-backed) Firestore reads, dir=rtl.
console.log('\n[C] the real dashboards in RTL');

const dashPlugin = {
  name: 'dash-stub',
  setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'stub-firestore', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/(auth|app|messaging)$/ }, () => ({ path: 'stub-empty', namespace: 'stub' }));
    b.onResolve({ filter: /\/firebase$/ }, () => ({ path: 'stub-firebase', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-firestore' ? FIRESTORE_STUB
        : args.path === 'stub-firebase'
          ? `export const app = {}; export const db = { __fake: true }; export const auth = { currentUser: { uid: 'u-mgr' } };`
          : `export const getMessaging = () => ({}); export const getToken = async () => null; export const onMessage = () => () => {};
             export const signOut = async () => {}; export const onAuthStateChanged = () => () => {};`,
      loader: 'js',
      resolveDir: ROOT,
    }));
  },
};

const DASH_ENTRY = /* tsx */ `
import React from 'react';
import { createRoot } from 'react-dom/client';
import i18n from './src/i18n';
import TasksDashboard from './src/TasksDashboard';
import CorrespondingsDashboard from './src/CorrespondingsDashboard';
import OverviewDashboard from './src/OverviewDashboard';
import OpportunitiesDashboard from './src/OpportunitiesDashboard';
import ArchiveDashboard from './src/ArchiveDashboard';

const T0 = Math.floor(new Date('2026-08-01T08:00:00Z').getTime() / 1000);
const ts = s => ({ seconds: T0 + s, nanoseconds: 0, toDate: () => new Date((T0 + s) * 1000) });

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@x.com', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Maintenance Planning', userColor: '#2563eb' },
  { id: 'u-emp1', displayName: 'Nevin Anwar',  email: 'n@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Maintenance Planning', userColor: '#16a34a' },
  { id: 'u-emp2', displayName: 'Ahmed Salem',  email: 'a@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Maintenance Planning', userColor: '#f97316' },
];

// Long, wrapping, mixed Arabic/Latin content on purpose: a short English title
// never reveals a clipping bug, and a serial number inside Arabic prose is
// exactly where bidi mangling shows up.
const LONG_AR = 'متابعة أعمال الصيانة الدورية لوحدة التقطير الجوي رقم 3 وإعداد تقرير الاهتزازات للمضخة P-101 قبل بدء الوقفة السنوية';

__seed('tasks', '--stats--', { value: 4 });
__seed('correspondences', '--stats--', { value: 4 });
['a', 'b', 'c'].forEach((k, i) => {
  __seed('tasks', 't-' + k, {
    taskName: i === 1 ? LONG_AR : 'Pump P-10' + i + ' vibration report and turnaround readiness review',
    description: i === 1 ? LONG_AR : 'Vendor reports high vibration. Investigate before the turnaround window closes.',
    status: ['Pending', 'In Progress', 'Done'][i], priority: ['High', 'Medium', 'Low'][i],
    serialNumber: 'TK00000' + (i + 1), category: ['Project', 'Administrative', 'Project'][i],
    assignedTo: USERS[i].displayName, assignedToId: USERS[i].id,
    isPrivate: false, collaboratorIds: i === 0 ? ['u-emp2'] : [],
    deadline: ['2026-08-16', '2026-12-31', '2026-07-01'][i],
    userId: 'u-mgr', teamId: 'T1', createdAt: ts(100 * i), updatedAt: ts(100 * i),
  });
  __seed('correspondences', 'c-' + k, {
    subject: i === 1 ? LONG_AR : 'Annual insurance renewal and asset schedule confirmation',
    body: i === 1 ? LONG_AR : 'Finance needs the asset list before the renewal date.',
    sentFrom: ['EGPC', 'الشركة المصرية للتكرير', 'Stores'][i],
    department: 'Maintenance Planning', subCategory: 'Refinery Upgrade',
    category: ['Project', 'Administrative', 'Project'][i], priority: ['High', 'Medium', 'Low'][i],
    dateReceived: '2026-08-1' + i, deadline: ['2026-08-16', '2026-12-31', '2026-07-01'][i],
    serialNumber: 'CR00000' + (i + 1), status: ['Unread', 'Assigned', 'Closed'][i],
    assignedTo: USERS[i].displayName, assignedToId: USERS[i].id,
    userId: 'u-mgr', teamId: 'T1', createdAt: ts(100 * i), updatedAt: ts(100 * i),
  });
  __seed('milestones', 'm-' + k, {
    taskId: 't-a', title: i === 1 ? LONG_AR : 'Vendor report received and reviewed by planning',
    status: ['Pending', 'In Progress', 'Done'][i], targetDate: '2026-08-2' + i,
    addedById: 'u-mgr', addedByName: 'Tariq Salama', createdAt: ts(10 * i), updatedAt: ts(10 * i),
  });
  __seed('opportunities', 'o-' + k, {
    title: i === 1 ? LONG_AR : 'EGPC turnaround maintenance tender — Alexandria refinery',
    client: ['EGPC', 'هيئة البترول', 'ECHEM'][i], sector: 'Refining', location: 'Alexandria',
    tenderNumber: 'RFQ-2026-0' + i, stage: ['Identified', 'Bid Submitted', 'Won'][i],
    probability: [20, 60, 100][i], estimatedValue: 12500000 * (i + 1), currency: 'EGP',
    announcedDate: '2026-07-0' + (i + 1), submissionDeadline: '2026-08-1' + (i + 5),
    ownerId: USERS[i].id, ownerName: USERS[i].displayName, collaboratorIds: [],
    userId: 'u-mgr', teamId: 'T1', createdAt: ts(100 * i), updatedAt: ts(100 * i),
  });
});

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@x.com' };
const appUser = USERS[0];
const shared = { user, appUser, projectUsers: USERS };
const VIEWS = {
  tasks: TasksDashboard, corr: CorrespondingsDashboard, overview: OverviewDashboard,
  opps: OpportunitiesDashboard, archive: ArchiveDashboard,
};

const root = createRoot(document.getElementById('root'));
// initialStatusFilter/initialView are forced OFF their defaults on purpose:
// Tasks opens on "My Tasks" and Correspondences on "Unassigned", which would
// leave the harness scanning an empty-state card instead of the rows that carry
// nearly every style this task converted.
window.__mount = (name, opts) => root.render(
  React.createElement('div', { className: 'app-main', style: { padding: 16 } },
    React.createElement(VIEWS[name], {
      ...shared, initialStatusFilter: 'All', initialView: 'all',
      onNavigate: () => {}, onNavigateTasks: () => {}, onNavigateCorrespondences: () => {},
      ...(opts || {}),
    }),
  ),
);
window.__mount('tasks');
// Lets [C4] read the SAME mounted DOM in both languages — the non-vacuous half
// of "this screen is translated" needs the English render to compare against.
window.__setLang = l => i18n.changeLanguage(l);

window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e =>
  window.__errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));
window.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
`;

await build({
  stdin: { contents: DASH_ENTRY, resolveDir: ROOT, sourcefile: 'dashEntry.tsx', loader: 'tsx' },
  bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  outfile: path.join(WORK, 'dash.js'),
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '__VITE_ENV__' },
  banner: { js: `const __VITE_ENV__ = { VITE_GOOGLE_SCRIPT_URL: 'https://script.test/exec', VITE_GOOGLE_SCRIPT_SECRET: 'x' };` },
  plugins: [dashPlugin],
  logLevel: 'warning',
});
fs.writeFileSync(path.join(WORK, 'dash.html'),
  `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0" />
   <link rel="stylesheet" href="app.css"></head>
   <body><div id="root"></div><script src="dash.js"></script></body></html>`);

// Same origin as the first page, so the 'ar' choice [B2] persisted is still in
// localStorage — i18n.ts reads it at module load and stamps dir=rtl before the
// first paint. That is the real code path, not a test-only setAttribute.
await evalJS(`localStorage.setItem('etaske-lang','ar')`);
const errorsBefore = pageErrors.length;
await send('Page.navigate', { url: pathToFileURL(path.join(WORK, 'dash.html')).href });
await sleep(400);
await waitFor(`document.getElementById('root') && document.getElementById('root').children.length`, 'dashboard mount');
await evalJS(HELPERS);
await evalJS(SCAN);
check('the dashboard page loads already in RTL (no LTR first paint)',
  await evalJS(`document.documentElement.getAttribute('dir')`) === 'rtl');

const DASHBOARDS = [
  ['tasks', 'TasksDashboard'],
  ['corr', 'CorrespondingsDashboard'],
  ['overview', 'OverviewDashboard'],
  ['opps', 'OpportunitiesDashboard'],
  ['archive', 'ArchiveDashboard'],
];
for (const [key, label] of DASHBOARDS) {
  console.log(`\n[C:${label}]`);
  await evalJS(`window.__mount('${key}')`);
  await sleep(500);
  check(`${label} renders`, await evalJS(`document.querySelectorAll('#root *').length`) > 40,
    String(await evalJS(`document.querySelectorAll('#root *').length`)));
  for (const w of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: w <= 768 });
    await sleep(260);
    const over = await evalJS(`window.__docOverflow()`);
    check(`${label} @${w}px: no horizontal document overflow`, over <= 0, `${over}px`);
    const clipped = await evalJS(`JSON.stringify(window.__clipped())`);
    check(`${label} @${w}px: nothing clips its own content`, clipped === '[]', clipped.slice(0, 240));
    const off = await evalJS(`JSON.stringify(window.__unreachable(document.getElementById('root')))`);
    check(`${label} @${w}px: nothing is stranded outside the viewport`, off === '[]', off.slice(0, 240));
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(150);
  await shot(`dash-${key}`);
}
check('no page errors while mounting all five dashboards in RTL',
  pageErrors.length === errorsBefore && (await evalJS(`window.__errors.length`)) === 0,
  pageErrors.slice(errorsBefore).join(' || ').slice(0, 400));

// ── [C2] the two conversions that actually move pixels ──────────────────────
// Measured in BOTH directions from the same DOM: an assertion that only holds
// in RTL could be true of a hard-coded layout too.
console.log('\n[C2] the search icon and the card accent, measured both ways');
// "All Tasks" renders per-employee summary cards; the task ROWS (accent stripe,
// serial number) only exist in the default "My Tasks" view.
await evalJS(`window.__mount('tasks', { initialView: 'mine' })`);
await sleep(500);

const sideOf = `(() => {
  const icon = document.querySelector('.lucide-search');
  const wrap = icon && icon.parentElement;
  const card = document.querySelector('#root .card[id^="task-"]') || document.querySelector('#root .card');
  if (!icon || !card) return JSON.stringify({ err: 'not rendered' });
  const i = icon.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  const cs = getComputedStyle(card);
  return JSON.stringify({
    iconPastCentre: i.left + i.width / 2 > w.left + w.width / 2,
    accentLeft: cs.borderLeftWidth, accentRight: cs.borderRightWidth,
  });
})()`;
const rtlSide = JSON.parse(await evalJS(sideOf));
check('★ the search icon sits on the RIGHT of its box in RTL', rtlSide.iconPastCentre === true, JSON.stringify(rtlSide));
// The opposite side reads 1px, not 0 — that is .card's own hairline border,
// which the 4px accent overrides on one side only.
check('★ the task card accent stripe moves to the right edge in RTL',
  rtlSide.accentRight === '4px' && rtlSide.accentLeft === '1px', JSON.stringify(rtlSide));

// ★ Found by LOOKING at the screenshot, not by an assertion: the serial
// rendered as "TK000001#". The '#' is a bidi-neutral character, so in an RTL
// paragraph it resolves to the paragraph direction and is drawn at the far end
// of the Latin run. textContent still reads "#TK000001" — only the painted
// glyph positions show it, so this measures the first and last glyph.
const glyphOrder = `(() => {
  const el = [...document.querySelectorAll('#root .ltr-data')].find(e => /^#[A-Z]{2}\\d+/.test((e.textContent || '').trim()));
  if (!el) return JSON.stringify({ err: 'no serial rendered' });
  // JSX renders \`#{serial}\` as TWO text nodes, so the first and last glyph do
  // not live in the same node — measure across the element's whole text.
  const nodes = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
  const first = nodes[0], lastNode = nodes[nodes.length - 1];
  const iHash = first.textContent.indexOf('#');
  const r = document.createRange();
  r.setStart(first, iHash); r.setEnd(first, iHash + 1);
  const hash = r.getBoundingClientRect();
  const lt = lastNode.textContent;
  r.setStart(lastNode, lt.length - 1); r.setEnd(lastNode, lt.length);
  const last = r.getBoundingClientRect();
  return JSON.stringify({ hashLeft: Math.round(hash.left), lastLeft: Math.round(last.left),
                          bidi: getComputedStyle(el).unicodeBidi, dir: getComputedStyle(el).direction });
})()`;
const serialRtl = JSON.parse(await evalJS(glyphOrder));
check('★ the "#" of a serial number stays in front of it in RTL (bidi isolation)',
  serialRtl.hashLeft < serialRtl.lastLeft && serialRtl.dir === 'ltr' && serialRtl.bidi === 'isolate',
  JSON.stringify(serialRtl));
// Non-vacuous: strip the isolation off that same element and the '#' really
// does jump to the far end. Without this the check above could be measuring a
// layout that never needed .ltr-data at all.
await evalJS(`[...document.querySelectorAll('#root .ltr-data')].forEach(e => { e.style.unicodeBidi = 'normal'; e.style.direction = 'inherit'; })`);
await sleep(120);
const serialBroken = JSON.parse(await evalJS(glyphOrder));
check('non-vacuous: without .ltr-data the "#" jumps behind the serial',
  serialBroken.hashLeft > serialBroken.lastLeft, JSON.stringify(serialBroken));
await evalJS(`[...document.querySelectorAll('#root .ltr-data')].forEach(e => { e.style.unicodeBidi = ''; e.style.direction = ''; })`);

await evalJS(`document.documentElement.setAttribute('dir','ltr')`);
await sleep(250);
const ltrSide = JSON.parse(await evalJS(sideOf));
check('non-vacuous: the same icon sits on the LEFT under dir=ltr', ltrSide.iconPastCentre === false, JSON.stringify(ltrSide));
check('non-vacuous: the same accent stripe is on the left edge under dir=ltr',
  ltrSide.accentLeft === '4px' && ltrSide.accentRight === '1px', JSON.stringify(ltrSide));
await evalJS(`document.documentElement.setAttribute('dir','rtl')`);
await shot('dash-ar');

// ── [C3] the literal "→" in the copy ────────────────────────────────────────
// index.css mirrors directional lucide icons, but "assigned → Nevin" is a bare
// text character no [dir] selector can reach. It needs the .dir-arrow wrapper,
// and this is the only thing that proves the wrapper is actually on it.
console.log('\n[C3] the literal arrow in the copy');
await evalJS(`window.__mount('corr')`);
await sleep(500);
const arrow = `(() => {
  const a = document.querySelector('#root .dir-arrow');
  return a ? getComputedStyle(a).transform : 'not rendered';
})()`;
const arrowRtl = await evalJS(arrow);
check('★ a literal "→" is mirrored in RTL', /matrix\(-1/.test(arrowRtl), arrowRtl);
await evalJS(`document.documentElement.setAttribute('dir','ltr')`);
await sleep(200);
const arrowLtr = await evalJS(arrow);
check('non-vacuous: the same "→" is not mirrored in LTR', arrowLtr === 'none', arrowLtr);
await evalJS(`document.documentElement.setAttribute('dir','rtl')`);

// ── [C4] the tasks flow really renders Arabic (task 4) ──────────────────────
// [A5]/[A6] only read source. This mounts the real TasksDashboard and the real
// CreateTaskPanel and reads the painted text, then flips the SAME DOM back to
// English so a hard-coded Arabic string could not pass either.
console.log('\n[C4] the tasks flow renders Arabic (task 4)');
await evalJS(`window.__mount('tasks', { initialView: 'mine' })`);
await sleep(500);

const tasksText = `(() => {
  const h1 = document.querySelector('#root h1');
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ h1: h1 ? h1.textContent.trim() : '', btns });
})()`;
const arText = JSON.parse(await evalJS(tasksText));
check('the Tasks heading reads المهام', arText.h1 === 'المهام', arText.h1);
check('the create button reads إضافة مهمة', arText.btns.some(b => b === 'إضافة مهمة'),
  arText.btns.slice(0, 12).join(' | '));
check('the view toggle reads مهامي / كل المهام',
  arText.btns.includes('مهامي') && arText.btns.includes('كل المهام'), arText.btns.slice(0, 12).join(' | '));

// The create panel is a separate component (CreateTaskPanel) reached by a real
// click — the same path a user takes from this screen.
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'إضافة مهمة')`, 'Add Task');
await sleep(500);
const panel = await evalJS(`(() => {
  const labels = [...document.querySelectorAll('.input-label')].map(l => (l.textContent || '').trim());
  const ph = [...document.querySelectorAll('input, textarea')].map(i => i.placeholder).filter(Boolean);
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ labels, ph, btns });
})()`).then(JSON.parse);
check('the create panel labels are Arabic (اسم المهمة / الوصف)',
  panel.labels.some(l => l.startsWith('اسم المهمة')) && panel.labels.some(l => l.startsWith('الوصف')),
  panel.labels.slice(0, 10).join(' | '));
check('the task-name placeholder is Arabic', panel.ph.includes('ما المطلوب إنجازه؟'), panel.ph.join(' | '));
check('the submit button reads إنشاء المهمة', panel.btns.some(b => b === 'إنشاء المهمة'),
  panel.btns.slice(-6).join(' | '));
check('the privacy toggle reads عامة / خاصة',
  panel.btns.some(b => b === 'عامة') && panel.btns.some(b => b === 'خاصة'), panel.btns.slice(0, 10).join(' | '));
// No label in the panel is still Latin — a floor of t() calls can be met with a
// whole section left in English.
const latinLabels = panel.labels.filter(l => /[A-Za-z]{3}/.test(l));
check('★ no create-panel label is still English', latinLabels.length === 0, latinLabels.join(' | '));

// Non-vacuous: the same nodes must read English again.
await evalJS(`window.__setLang('en')`);
await sleep(400);
const enPanel = await evalJS(`(() => {
  const labels = [...document.querySelectorAll('.input-label')].map(l => (l.textContent || '').trim());
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ labels, btns });
})()`).then(JSON.parse);
check('non-vacuous: the same panel reads English under en',
  enPanel.labels.some(l => l.startsWith('Task Name')) && enPanel.btns.some(b => b === 'Create Task'),
  enPanel.labels.slice(0, 8).join(' | '));
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await shot('tasks-panel-ar');
await clickEl(`[...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === 'إلغاء')`, 'Cancel');
await sleep(300);
check('no errors across the tasks-flow checks', (await evalJS(`window.__errors.length`)) === 0);

if (fail) {
  try {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/i18nrtl-failure.png');
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log(`  screenshot: ${p}`);
  } catch { /* best effort */ }
}

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
try { ws.close(); } catch {}
edge.kill();
await sleep(300);
try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
