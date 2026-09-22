// Harness for PRIVATE Drive files (queue task A2b).
//
// Part A runs the WHOLE google-apps-script.js through doPost() / unshareAll()
// against fakes of Drive, Firebase Auth, Firestore and the cache (no network):
//
//   S1  an upload is no longer shared "anyone with the link"
//   S2  `download` needs a signed-in, Approved user, like every other action
//   S3  an Approved user gets the bytes, type and name of a file in the folder
//   S4  nothing outside the ETaske folder, trashed, unknown or malformed
//   S5  size cap + per-person hourly limit on downloads
//   S6  unshareAll(): folder + every open file made private, the rest left
//       alone, safe to run twice, stops early and says so on a big folder
//
// Part B runs the real client code (src/lib/driveFiles.ts, DriveImage.tsx and
// the Documents page) in headless Edge with the script faked:
//
//   C1  which links are "our Drive files" (driveFileIdOf)
//   C2  a picture preview loads through the script (once), a PDF collapses the
//       box, a refusal falls back to the old public URL, other URLs untouched
//   C3  clicking an attachment: PDF opens in a tab from a blob:, Word is saved,
//       a refusal opens the stored link, other links and ctrl-click untouched
//   C4  the real Documents page opens a Drive file the same way
//
//   node scripts/harness/drivefiles.mjs   (--headed to watch part B)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FIRESTORE_STUB } from './fakeFirestore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEADED = process.argv.includes('--headed');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ═════════════════════════ Part A — the Apps Script ═════════════════════════
console.log('Part A — google-apps-script.js');
const SRC = fs.readFileSync(path.join(ROOT, 'google-apps-script.js'), 'utf8');
const FOLDER = '1BCyJMwQ1ve84jhPmp6THzd1Mwk9azpTD';

const tok = (name) => `tok.${name}.` + 'x'.repeat(120);
const ACCOUNTS = {
  [tok('ahmed')]: { localId: 'u-ahmed', email: 'a@eprom.com.eg', emailVerified: true },
  [tok('pending')]: { localId: 'u-pending', email: 'p@eprom.com.eg', emailVerified: true },
};
const USERS = {
  'u-ahmed': { status: 'Approved', role: 'Employee' },
  'u-pending': { status: 'Pending', role: 'Employee' },
};

let drive, folderSharing, cacheStore, setSharingCalls;
const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
const enc = (v) => ({ stringValue: String(v) });

const wrap = (f) => ({
  getId: () => f.id, getName: () => f.name, getMimeType: () => f.mime,
  isTrashed: () => !!f.trashed, getSize: () => f.size ?? f.bytes.length,
  getParents: () => { const p = [...f.parents]; return { hasNext: () => p.length > 0, next: () => { const id = p.shift(); return { getId: () => id }; } }; },
  getBlob: () => ({ getContentType: () => f.mime, getBytes: () => f.bytes.map(b => (b > 127 ? b - 256 : b)) }),
  getSharingAccess: () => f.sharing,
  setSharing: (a) => { setSharingCalls++; f.sharing = a; },
  setDescription: (d) => { f.description = d; },
});
const addFile = (id, o) => drive.set(id, { id, name: id + '.png', mime: 'image/png', bytes: [...Buffer.from('png:' + id)], parents: [FOLDER], sharing: 'link', ...o });

// Drive's iterator, with the resume token a long run needs.
const fileIterator = (start) => {
  const list = [...drive.values()].filter(f => f.parents.includes(FOLDER));
  let i = start;
  return { hasNext: () => i < list.length, next: () => wrap(list[i++]), getContinuationToken: () => String(i) };
};
let props;
const DriveApp = {
  Access: { ANYONE_WITH_LINK: 'link', PRIVATE: 'private' }, Permission: { VIEW: 'view', NONE: 'none' },
  getFolderById: (id) => {
    if (id !== FOLDER) throw new Error('wrong folder ' + id);
    return {
      createFile(blob) {
        const id = 'new' + drive.size + 'aaaaaaaaaaaa';
        drive.set(id, { id, name: blob.name, mime: blob.mimeType, bytes: blob.bytes, parents: [FOLDER], sharing: 'private' });
        return wrap(drive.get(id));
      },
      getSharingAccess: () => folderSharing,
      setSharing: (a) => { folderSharing = a; },
      getFiles: () => fileIterator(0),
    };
  },
  continueFileIterator: (token) => fileIterator(Number(token)),
  getFileById: (id) => { const f = drive.get(id); if (!f) throw new Error('No item with the given ID'); return wrap(f); },
};

let logs = [];
let clock = null; // when set, Date.now() advances by `clock` ms per call
class FakeDate extends Date { static now() { return clock ? (FakeDate.t += clock) : Date.now(); } }
FakeDate.t = 0;

const ctx = {
  DriveApp,
  UrlFetchApp: {
    fetch(url, opts) {
      const body = opts && opts.payload ? JSON.parse(opts.payload) : null;
      if (url.includes('accounts:lookup')) {
        const a = ACCOUNTS[body.idToken];
        return a ? resp(200, { users: [a] }) : resp(400, {});
      }
      if (url.includes('/users/')) {
        const u = USERS[decodeURIComponent(url.split('/users/')[1])];
        return u ? resp(200, { fields: Object.fromEntries(Object.entries(u).map(([k, v]) => [k, enc(v)])) }) : resp(404, {});
      }
      throw new Error('unexpected fetch ' + url);
    },
  },
  CacheService: { getScriptCache: () => ({ get: (k) => cacheStore.get(k) ?? null, put: (k, v) => { cacheStore.set(k, String(v)); } }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    base64Decode: (b) => [...Buffer.from(b, 'base64')],
    base64Encode: (bytes) => Buffer.from(bytes.map(b => b & 255)).toString('base64'),
    newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }),
  },
  ContentService: { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => { props.set(k, v); }, deleteProperty: (k) => { props.delete(k); } }) },
  ScriptApp: { getOAuthToken: () => 'owner-token' },
  Logger: { log: (s) => logs.push(String(s)) },
  Session: { getScriptTimeZone: () => 'Africa/Cairo' },
  JSON, Date: FakeDate, Math, Number, String, Object, Array, Error, RegExp, encodeURIComponent, decodeURIComponent,
};
vm.createContext(ctx);
vm.runInContext(SRC, ctx);

function reset() {
  drive = new Map(); folderSharing = 'link'; cacheStore = new Map(); setSharingCalls = 0; logs = []; clock = null; props = new Map();
  addFile('inFolder0001', { name: 'offer.pdf', mime: 'application/pdf', bytes: [...Buffer.from('%PDF-1.4 hello \xff\x80')] });
  addFile('elsewhere001', { parents: ['someOtherFolder'] });
  addFile('trashed00001', { trashed: true });
  addFile('huge00000001', { size: 16 * 1024 * 1024 });
  addFile('private00001', { sharing: 'private' });
}
const post = (data) => JSON.parse(ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(data) } }).text);
const dl = (fileId, who = 'ahmed') => post({ action: 'download', fileId, idToken: tok(who) });

// S1
reset();
let r = post({ action: 'upload', filename: 'letter.png', mimeType: 'image/png', base64: 'data:image/png;base64,' + Buffer.from('x').toString('base64'), idToken: tok('ahmed') });
const newId = [...drive.keys()].find(k => k.startsWith('new'));
check('S1 upload succeeds and returns a Drive URL carrying the file id', r.status === 'success' && r.url.endsWith('id=' + newId), JSON.stringify(r));
check('S1 upload no longer shares the file by link', setSharingCalls === 0 && drive.get(newId).sharing === 'private');
check('S1 the old public downloadUrl is no longer handed out', !('downloadUrl' in r));

// S2
reset();
r = post({ action: 'download', fileId: 'inFolder0001' });
check('S2 download with no token -> Unauthorized', r.status === 'error' && r.message === 'Unauthorized');
r = post({ action: 'download', fileId: 'inFolder0001', secret: 'old-secret' });
check('S2 download with only the old shared secret -> Unauthorized', r.message === 'Unauthorized');
check('S2 download by a Pending user -> Unauthorized', dl('inFolder0001', 'pending').message === 'Unauthorized');
check('S2 download with a forged token -> Unauthorized', dl('inFolder0001', 'forged').message === 'Unauthorized');

// S3
r = dl('inFolder0001');
check('S3 Approved user downloads a file in the folder', r.status === 'success', JSON.stringify(r));
check('S3 the bytes come back intact (incl. high bytes)', Buffer.from(r.base64 || '', 'base64').equals(Buffer.from(drive.get('inFolder0001').bytes)));
check('S3 the type and name come back', r.mimeType === 'application/pdf' && r.fileName === 'offer.pdf');
check('S3 reading a file does not change its sharing', drive.get('inFolder0001').sharing === 'link' && setSharingCalls === 0);

// S4
check('S4 a file OUTSIDE the ETaske folder -> Not found', dl('elsewhere001').message === 'Not found');
check('S4 a trashed file -> Not found', dl('trashed00001').message === 'Not found');
check('S4 an unknown id -> Not found', dl('doesNotExist1').message === 'Not found');
check('S4 a malformed id is refused before Drive is asked', dl('../../etc').message === 'Bad file id' && dl('').message === 'Bad file id' && dl('a/b?c=deadbeef').message === 'Bad file id');
check('S4 a non-string id is refused', post({ action: 'download', fileId: { $gt: '' }, idToken: tok('ahmed') }).message === 'Bad file id');

// S5
check('S5 a file over the size cap is refused', dl('huge00000001').message === 'File too large');
reset();
let okCount = 0, last;
for (let i = 0; i < 301; i++) { last = dl('inFolder0001'); if (last.status === 'success') okCount++; }
check('S5 300 downloads an hour pass, the 301st is refused', okCount === 300 && last.message === 'Too many requests', `${okCount} / ${last.message}`);

// S6
reset();
ctx.unshareAll();
const shared = [...drive.values()].filter(f => f.parents.includes(FOLDER) && f.sharing !== 'private');
check('S6 unshareAll makes the folder private', folderSharing === 'private');
check('S6 unshareAll makes every file in the folder private', shared.length === 0, shared.map(f => f.id).join(','));
check('S6 a file outside the folder is not touched', drive.get('elsewhere001').sharing === 'link');
check('S6 an already-private file is not re-written', setSharingCalls === 3, String(setSharingCalls));
check('S6 the log says how many were closed', logs.some(l => /Done: 4 files checked, 3 were open/.test(l)), logs.join(' | '));
setSharingCalls = 0; logs = [];
ctx.unshareAll();
check('S6 running it twice changes nothing more', setSharingCalls === 0 && logs.some(l => /0 were open/.test(l)));
reset();
for (let i = 0; i < 20; i++) addFile('bulk' + String(i).padStart(8, '0'));
clock = 70 * 1000; FakeDate.t = 0; // every Date.now() is 70 s later -> the 5-minute budget runs out
ctx.unshareAll();
clock = null;
const leftOpen = [...drive.values()].filter(f => f.parents.includes(FOLDER) && f.sharing !== 'private').length;
check('S6 on a big folder it stops early and says "run again"', leftOpen > 0 && logs.some(l => /run unshareAll again/.test(l)), logs.join(' | '));
let runs = 0;
for (let i = 0; i < 20 && [...drive.values()].some(f => f.parents.includes(FOLDER) && f.sharing !== 'private'); i++) { runs++; logs = []; FakeDate.t = 0; clock = 70 * 1000; ctx.unshareAll(); clock = null; }
check('S6 running it again finishes the job, resuming where it stopped', [...drive.values()].every(f => !f.parents.includes(FOLDER) || f.sharing === 'private') && logs.some(l => /^Done: /.test(l)), logs.slice(-2).join(' | '));
check('S6 the resume token is cleared once finished', !props.has('UNSHARE_RESUME_TOKEN'));

// ═════════════════════════ Part B — the client, in Edge ═════════════════════
console.log('Part B — src/lib/driveFiles.ts + DriveImage + Documents page (Edge)');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-drivefiles-'));

const IDS = { img: 'IMGfile0000000000001', pdf: 'PDFfile0000000000001', docx: 'DOCXfile000000000001', broken: 'BROKENfile0000000001', doc: 'DOCSpagefile00000001' };
const U = (id) => `https://drive.google.com/uc?export=view&id=${id}`;

const stubPlugin = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'stub-firestore', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/(auth|app|messaging)$/ }, () => ({ path: 'stub-empty', namespace: 'stub' }));
    b.onResolve({ filter: /\/firebase$/ }, () => ({ path: 'stub-firebase', namespace: 'stub' }));
    b.onResolve({ filter: /\/scriptProxy$/ }, () => ({ path: 'stub-script', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-firestore' ? FIRESTORE_STUB
        : args.path === 'stub-firebase' ? `export const app = {}; export const db = { __fake: true }; export const auth = { currentUser: { uid: 'u-ahmed' } };`
        : args.path === 'stub-script' ? `export const SCRIPT_URL = 'https://script.test/exec'; export async function callScript(p) { return window.__script(p); }`
        : 'export {};',
      loader: 'js',
      resolveDir: ROOT,
    }));
  },
};

// A real 1x1 PNG so the browser actually decodes the preview.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const ENTRY = /* tsx */ `
import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/i18n';
import DriveImage from './src/components/DriveImage';
import DocumentsDashboard from './src/DocumentsDashboard';
import { attachmentClick, driveFileIdOf } from './src/lib/driveFiles';

const IDS = ${JSON.stringify(IDS)};
const U = id => 'https://drive.google.com/uc?export=view&id=' + id;
const FILES = {
  [IDS.img]: { mimeType: 'image/png', fileName: 'site photo.png', base64: '${PNG_B64}' },
  [IDS.pdf]: { mimeType: 'application/pdf', fileName: 'offer.pdf', base64: btoa('%PDF-1.4') },
  [IDS.docx]: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'HSE plan.docx', base64: btoa('PK..') },
  [IDS.doc]: { mimeType: 'application/pdf', fileName: 'Technical offer.pdf', base64: btoa('%PDF-1.4') },
};
window.__calls = [];
window.__script = async p => {
  window.__calls.push(p);
  await new Promise(r => setTimeout(r, 30));
  if (p.action !== 'download') return { status: 'error', message: 'Unknown action' };
  const f = FILES[p.fileId];
  return f ? { status: 'success', ...f } : { status: 'error', message: 'Not found' };
};

// window.open is recorded, never a real tab.
window.__tabs = [];
window.open = (url, target, features) => {
  const tab = { closed: false, opener: window, document: { title: '', body: {} }, location: { href: url || '' }, close() { this.closed = true; } };
  window.__tabs.push({ url, target, features, tab });
  return features && features.includes('noopener') ? null : tab;
};
// A download is an <a download> click — record it instead of saving.
window.__saved = [];
const realClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  if (this.hasAttribute('download')) { window.__saved.push({ href: this.href, download: this.download }); return; }
  return realClick.call(this);
};
// After React has seen a click, note whether it stopped the browser, then stop
// it anyway so the harness page never navigates.
window.__prevented = [];
window.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a'); if (a) { window.__prevented.push({ t: a.dataset.t || a.dataset.docs, p: e.defaultPrevented }); e.preventDefault(); } });
window.__imgErr = [];
window.__idOf = driveFileIdOf;

__seed('projects', 'p1', { name: 'AGIBA Meleiha O&M', client: 'AGIBA', status: 'Active', serialNumber: 'PR000001', userId: 'u-ahmed',
  documents: [{ id: 'b', kind: 'offer', title: 'Technical offer', date: '2026-01-01', direction: 'out', link: 'https://drive.google.com/file/d/' + IDS.doc + '/view', fileName: 'Technical offer.pdf', addedById: 'u-ahmed', addedBy: 'Ahmed Nabil' }] });
const USER = { id: 'u-ahmed', displayName: 'Ahmed Nabil', email: 'a@eprom.com.eg', status: 'Approved', role: 'Employee', teamId: 'T1' };

const A = (t, url, name) => React.createElement('a', { 'data-t': t, href: url, target: '_blank', rel: 'noopener noreferrer', onClick: attachmentClick(url, name), style: { display: 'block', padding: 8 } }, t);
function App() {
  return React.createElement('div', { className: 'app-main' },
    React.createElement(DriveImage, { url: U(IDS.img), alt: 'img', 'data-t': 'img', style: { width: 40 } }),
    React.createElement(DriveImage, { url: U(IDS.img), alt: 'img2', 'data-t': 'img2', style: { width: 40 } }),
    React.createElement(DriveImage, { url: U(IDS.pdf), alt: 'pdf', 'data-t': 'pdf', onError: () => window.__imgErr.push('pdf') }),
    React.createElement(DriveImage, { url: U(IDS.broken), alt: 'broken', 'data-t': 'broken', onError: () => window.__imgErr.push('broken') }),
    React.createElement(DriveImage, { url: 'https://example.com/pic.png', alt: 'ext', 'data-t': 'ext', onError: () => {} }),
    A('a-pdf', U(IDS.pdf), 'offer.pdf'),
    A('a-docx', U(IDS.docx), 'HSE plan.docx'),
    A('a-broken', U(IDS.broken), 'lost.pdf'),
    A('a-ext', 'https://example.com/tender.pdf', 'tender.pdf'),
    A('a-ctrl', U(IDS.pdf), 'offer.pdf'),
    React.createElement(DocumentsDashboard, { user: { uid: 'u-ahmed', displayName: 'Ahmed Nabil', email: 'a@eprom.com.eg' }, appUser: USER, onNavigate: () => {} }),
  );
}
createRoot(document.getElementById('root')).render(React.createElement(App));
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'drivefilesEntry.tsx', loader: 'tsx' },
  bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  outfile: path.join(WORK, 'bundle.js'),
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '__VITE_ENV__' },
  banner: { js: `const __VITE_ENV__ = { VITE_GOOGLE_SCRIPT_URL: 'https://script.test/exec' };` },
  plugins: [stubPlugin], logLevel: 'warning',
});
fs.writeFileSync(path.join(WORK, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>`);

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!EDGE) { console.error('Microsoft Edge not found.'); process.exit(2); }
const PORT = 9811 + (process.pid % 100);
const edge = spawn(EDGE, [HEADED ? '--new-window' : '--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(WORK, 'profile')}`, '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1200,900', pathToFileURL(path.join(WORK, 'index.html')).href], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
const pending = new Map();
const pageErrors = [];
let msgId = 0;
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
}
async function waitFor(expression, label, timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await evalJS(`!!(${expression})`)) return true; await sleep(60); }
  throw new Error(`timed out waiting for ${label || expression}`);
}
// A real mouse click at the element's centre (optionally with ctrl held).
async function clickAt(selector, modifiers = 0) {
  const b = await evalJS(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1, modifiers });
}

try {
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch { /* not up */ }
    if (!page) await sleep(150);
  }
  if (!page) throw new Error('Edge did not expose a page target');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push('console.error: ' + m.params.args.map(a => a.description || a.value).join(' '));
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  };
  await send('Runtime.enable');
  await waitFor(`document.querySelector('[data-t="a-pdf"]')`, 'mount');

  // C1
  const ids = await evalJS(`[
    __idOf('https://drive.google.com/uc?export=view&id=${IDS.img}'),
    __idOf('https://drive.google.com/file/d/${IDS.pdf}/view?usp=sharing'),
    __idOf('https://docs.google.com/document/d/${IDS.doc}/edit'),
    __idOf('https://drive.google.com/open?id=${IDS.docx}'),
    __idOf('https://example.com/file/d/${IDS.img}/view'),
    __idOf('https://drive.google.com.evil.test/file/d/${IDS.img}/view'),
    __idOf('http://drive.google.com/uc?id=${IDS.img}'),
    __idOf('\\\\\\\\eprom-fs01\\\\Commercial\\\\a.pdf'),
    __idOf(''), __idOf(null)
  ]`);
  check('C1 Drive URLs of every shape give their file id', ids[0] === IDS.img && ids[1] === IDS.pdf && ids[2] === IDS.doc && ids[3] === IDS.docx, JSON.stringify(ids));
  check('C1 look-alike hosts, plain http, folder paths and blanks are NOT treated as ours', ids.slice(4).every(v => v === null), JSON.stringify(ids.slice(4)));

  // C2
  await waitFor(`document.querySelector('[data-t="img"]') && document.querySelector('[data-t="img"]').complete && document.querySelector('[data-t="img"]').naturalWidth > 0`, 'image preview');
  check('C2 a Drive picture is shown from a blob: URL fetched through the script', await evalJS(`document.querySelector('[data-t="img"]').src.startsWith('blob:')`));
  check('C2 the same picture twice costs ONE download', await evalJS(`__calls.filter(c => c.fileId === '${IDS.img}').length`) === 1);
  await waitFor(`__imgErr.includes('pdf')`, 'pdf preview collapses');
  check('C2 a PDF in an image slot runs the caller onError (box collapses) and shows no blob', await evalJS(`!document.querySelector('[data-t="pdf"]') || !document.querySelector('[data-t="pdf"]').src.startsWith('blob:')`));
  await waitFor(`document.querySelector('[data-t="broken"]')`, 'broken fallback');
  check('C2 a refused file falls back to the old public preview URL', await evalJS(`document.querySelector('[data-t="broken"]').getAttribute('src')`) === U(IDS.broken));
  check('C2 a non-Drive picture is shown as-is and never asks the script', await evalJS(`document.querySelector('[data-t="ext"]').getAttribute('src') === 'https://example.com/pic.png' && !__calls.some(c => String(c.fileId || '').includes('example'))`));

  // C3
  await evalJS(`__tabs.length = 0; __saved.length = 0; __prevented.length = 0; __calls.length = 0`);
  await clickAt('[data-t="a-pdf"]');
  await waitFor(`__tabs[0] && __tabs[0].tab.location.href.startsWith('blob:')`, 'pdf tab');
  let tabs = await evalJS(`__tabs.map(t => ({ url: t.url, features: t.features || '', href: t.tab.location.href, opener: t.tab.opener === null }))`);
  check('C3 PDF: the tab is opened blank inside the click (no pop-up block)', tabs.length === 1 && tabs[0].url === '' && !tabs[0].features.includes('noopener'), JSON.stringify(tabs));
  check('C3 PDF: the tab then shows the file from a blob:, opener cut', tabs[0].href.startsWith('blob:') && tabs[0].opener);
  check('C3 PDF: the browser did NOT follow the stored Drive link', await evalJS(`__prevented.find(x => x.t === 'a-pdf').p === true`));
  check('C3 PDF: reuses the copy its preview already fetched (no second download)', await evalJS(`__calls.length`) === 0);

  await evalJS(`__tabs.length = 0; __saved.length = 0`);
  await clickAt('[data-t="a-docx"]');
  await waitFor(`__saved.length === 1`, 'docx saved');
  const saved = await evalJS(`__saved[0]`);
  check('C3 Word file: saved under its name from a blob:, no empty tab left open', saved.download === 'HSE plan.docx' && saved.href.startsWith('blob:') && await evalJS(`__tabs.length`) === 0, JSON.stringify(saved));

  await evalJS(`__tabs.length = 0`);
  await clickAt('[data-t="a-broken"]');
  await waitFor(`__tabs[0] && __tabs[0].tab.location.href.startsWith('https://')`, 'broken tab');
  check('C3 refused by the script: the tab falls back to the stored link', await evalJS(`__tabs[0].tab.location.href`) === U(IDS.broken));

  await evalJS(`__tabs.length = 0; __calls.length = 0; __prevented.length = 0`);
  await clickAt('[data-t="a-ext"]');
  await sleep(150);
  check('C3 a non-Drive link is left to the browser (not intercepted, no script call)', await evalJS(`__prevented.find(x => x.t === 'a-ext').p === false && __calls.length === 0 && __tabs.length === 0`));
  await clickAt('[data-t="a-ctrl"]', 2 /* ctrl */);
  await sleep(150);
  check('C3 ctrl-click on a Drive link is left to the browser', await evalJS(`__prevented.find(x => x.t === 'a-ctrl').p === false && __calls.length === 0`));

  // C4
  await waitFor(`document.querySelector('[data-docs="open-file"]')`, 'documents page row');
  await evalJS(`__tabs.length = 0; __calls.length = 0; __prevented.length = 0`);
  await clickAt('[data-docs="open-file"]');
  await waitFor(`__tabs[0] && __tabs[0].tab.location.href.startsWith('blob:')`, 'documents page tab');
  check('C4 Documents page: "open file" fetches the private file and opens it', await evalJS(`__calls.length === 1 && __calls[0].fileId === '${IDS.doc}' && __prevented[0].p === true`));

  check('no uncaught page errors or console.errors', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 400));
} catch (err) {
  fail++;
  console.log(`\n  FAIL harness aborted — ${err.message}`);
  console.log('  page errors :', pageErrors.join(' || ').slice(0, 600));
}

console.log(`\ndrivefiles: ${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
try { ws && ws.close(); } catch {}
edge.kill();
await sleep(300);
try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
