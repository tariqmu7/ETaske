// Harness for bid privacy, every-other-screen side (queue M6b).
//
// Proves two things:
//   1. the shared reader (src/lib/bidReads.ts) — live and one-shot — hands each
//      viewer ONLY the bids they may see, drops the --stats-- counter, follows a
//      live change, and sorts newest first when asked;
//   2. a source guard: NO other file in src/ reads the `opportunities`
//      collection as a list, and every caller of the reader passes a role — so
//      a new screen cannot quietly bring back the whole book. M6c (the server
//      lock) then only has to change bidReads.ts.
//
// Real code under test:  src/lib/bidReads.ts, src/lib/bidVisibility.ts.
// Faked:                 firebase/firestore (the shared in-memory store), src/lib/firebase.ts.
//
//   node scripts/harness/bidreaders.mjs

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { FIRESTORE_STUB } from './fakeFirestore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-bidreaders-')), 'bidReads.mjs');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const stubPlugin = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'stub-firestore', namespace: 'stub' }));
    b.onResolve({ filter: /\/firebase$/ }, () => ({ path: 'stub-firebase', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-firestore' ? FIRESTORE_STUB : 'export const db = { __fake: true };',
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [path.join(ROOT, 'src/lib/bidReads.ts')],
  bundle: true, format: 'esm', platform: 'neutral', outfile: OUT,
  plugins: [stubPlugin], logLevel: 'warning',
});
const { subscribeVisibleBids, getVisibleBids, byCreatedDesc } = await import(pathToFileURL(OUT).href);

// ── fixture: one bid of each kind ───────────────────────────────────────────
const ts = s => ({ seconds: s, nanoseconds: 0 });
const seed = (id, data) => globalThis.__seed('opportunities', id, data);
seed('--stats--', { value: 9 });
seed('b-all',   { title: 'Open to all',        createdAt: ts(100) });                         // no field = everyone
seed('b-mgrs',  { title: 'Managers bid',       createdAt: ts(300), visibility: 'managers', ownerId: 'u-sara' });
seed('b-priv',  { title: 'Private bid',        createdAt: ts(200), visibility: 'private', ownerId: 'u-sara' });
seed('b-collab',{ title: 'Private, Mona helps', createdAt: ts(400), visibility: 'private', ownerId: 'u-sara', collaboratorIds: ['u-mona'] });
seed('b-made',  { title: 'Private, Ali made it', createdAt: ts(50), visibility: 'private', ownerId: 'u-sara', userId: 'u-ali' });

const VIEWERS = {
  admin:    { id: 'u-adm',  role: 'Admin' },
  manager:  { id: 'u-mgr',  role: 'Manager' },
  owner:    { id: 'u-sara', role: 'Employee' },
  collab:   { id: 'u-mona', role: 'Employee' },
  creator:  { id: 'u-ali',  role: 'Employee' },
  employee: { id: 'u-emp',  role: 'Employee' },
};
const EXPECT = {
  admin:    ['b-all', 'b-collab', 'b-made', 'b-mgrs', 'b-priv'],
  manager:  ['b-all', 'b-mgrs'],
  owner:    ['b-all', 'b-collab', 'b-made', 'b-mgrs', 'b-priv'],
  collab:   ['b-all', 'b-collab'],
  creator:  ['b-all', 'b-made'],
  employee: ['b-all'],
};
const ids = list => list.map(b => b.id).sort();

console.log('\n[1] one-shot read — each role gets only what it may see');
for (const [who, viewer] of Object.entries(VIEWERS)) {
  const got = ids(await getVisibleBids(viewer));
  check(`${who}: ${EXPECT[who].join(', ')}`, JSON.stringify(got) === JSON.stringify(EXPECT[who]), got.join(', '));
}
check('--stats-- counter never comes back as a bid', !(await getVisibleBids(VIEWERS.admin)).some(b => b.id === '--stats--'));

console.log('\n[2] live read — same filter; a re-read follows a change');
const seen = {};
const stops = Object.entries(VIEWERS).map(([who, viewer]) => subscribeVisibleBids(viewer, list => { seen[who] = ids(list); }));
await new Promise(r => setTimeout(r, 20));
for (const who of Object.keys(VIEWERS)) {
  check(`${who}: live list matches`, JSON.stringify(seen[who]) === JSON.stringify(EXPECT[who]), String(seen[who]));
}
// Sara opens her private bid to managers — the manager's list must grow, the employee's must not.
seed('b-priv', { title: 'Private bid', createdAt: ts(200), visibility: 'managers', ownerId: 'u-sara' });
const reread = { manager: ids(await getVisibleBids(VIEWERS.manager)), employee: ids(await getVisibleBids(VIEWERS.employee)) };
check('after the change a manager sees it', reread.manager.includes('b-priv'), reread.manager.join(', '));
check('after the change a plain employee still does not', !reread.employee.includes('b-priv'), reread.employee.join(', '));
stops.forEach(s => s());

console.log('\n[3] newest first');
const sorted = (await getVisibleBids(VIEWERS.admin)).sort(byCreatedDesc).map(b => b.id);
check('sorted by createdAt, newest first', sorted.join(',') === 'b-collab,b-mgrs,b-priv,b-all,b-made', sorted.join(','));
check('a bid with no createdAt sorts last, without crashing',
  [{ id: 'x' }, { id: 'y', createdAt: { toMillis: () => 5 } }].sort(byCreatedDesc)[0].id === 'y');

console.log('\n[4] source guard — nothing else reads the bid list directly');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []);
const files = walk(path.join(ROOT, 'src'));
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');
const offenders = [];
const noRole = [];
for (const f of files) {
  if (rel(f) === 'src/lib/bidReads.ts') continue;
  const src = fs.readFileSync(f, 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    // A list read of the collection: collection(db,'opportunities') not inside addDoc(...), or a generic sub/listen helper.
    if ((/collection\(\s*db\s*,\s*['"]opportunities['"]\s*\)/.test(line) && !/addDoc\(/.test(line))
      || /\b(sub|listen)\(\s*['"]opportunities['"]/.test(line)) offenders.push(`${rel(f)}:${i + 1}`);
    if (/\b(subscribeVisibleBids|getVisibleBids|useKnownParties|exportOpportunities)\(\s*\{/.test(line) && !/role:/.test(line)) {
      noRole.push(`${rel(f)}:${i + 1}`);
    }
  });
  if (/<RecordLinkPicker\b/.test(src) && !/<RecordLinkPicker[\s\S]{0,200}?viewer=\{\{[^}]*role:/.test(src)) noRole.push(`${rel(f)} (RecordLinkPicker)`);
}
check('no file outside bidReads.ts reads the opportunities list', offenders.length === 0, offenders.join(' | '));
check('every caller of the reader passes the viewer role', noRole.length === 0, noRole.join(' | '));
const callers = files.filter(f => /subscribeVisibleBids|getVisibleBids/.test(fs.readFileSync(f, 'utf8')) && rel(f) !== 'src/lib/bidReads.ts');
check('the reader is used by the screens it should be (>= 17 files)', callers.length >= 17, `${callers.length}: ${callers.map(rel).join(', ')}`);

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
fs.rmSync(path.dirname(OUT), { recursive: true, force: true });
process.exit(fail ? 1 : 0);
