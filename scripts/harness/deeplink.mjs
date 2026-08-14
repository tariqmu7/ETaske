// Round-trip harness for src/lib/deepLink.ts: the notification a bid alert
// writes must produce a URL that, on a cold load, resolves back to the same
// opportunity — without breaking the task / correspondence routes.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'deepLink.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/deepLink.ts')],
  bundle: true, format: 'esm', platform: 'neutral', outfile: OUT, logLevel: 'warning',
});

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k), clear: () => store.clear(),
};
globalThis.window = {
  location: { origin: 'https://tariqmu7.github.io', pathname: '/ETaske/', hash: '' },
  dispatchEvent: () => {},
};
globalThis.CustomEvent = class { constructor(t) { this.type = t; } };

const { refTypeForNotification, buildDeepLinkUrl, readHashOpenRef, requestOpen, consumePending, subscribeOpen }
  = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('\n[1] notification type -> target view');
for (const [type, expect] of [
  ['opportunity_deadline', 'opportunity'],
  ['task_overdue', 'task'],
  ['task_assigned', 'task'],
  ['milestone_added', 'task'],
  ['corresponding_overdue', 'corresponding'],
  ['new_corresponding', 'corresponding'],
  ['correspondence_updated', 'corresponding'],
  ['task_done', 'task'],
  ['unknown_thing', null],
]) check(`${type} -> ${expect}`, refTypeForNotification(type) === expect, String(refTypeForNotification(type)));

console.log('\n[2] URL round-trip (cold load from a Telegram DM)');
for (const [type, view] of [['opportunity', 'opportunities'], ['task', 'tasks'], ['corresponding', 'correspondences']]) {
  const url = buildDeepLinkUrl(type, 'abc 123/x');
  check(`${type} url targets #/${view}`, url.includes(`#/${view}?open=`), url);
  globalThis.window.location.hash = url.split('#')[1] ? `#${url.split('#')[1]}` : '';
  const ref = readHashOpenRef();
  check(`${type} url parses back`, ref && ref.type === type && ref.id === 'abc 123/x', JSON.stringify(ref));
}

console.log('\n[3] the bus');
globalThis.window.location.hash = '';
// Mounted-dashboard path.
let seen = null;
const unsub = subscribeOpen(ref => { seen = ref; });
requestOpen({ type: 'opportunity', id: 'op1', label: 'EGPC Tender', serial: 'OP000001' });
check('live subscriber receives the ref', seen && seen.id === 'op1', JSON.stringify(seen));
check('a labelled open feeds recents',
  JSON.parse(store.get('etaske.recents.v1') || '[]')[0]?.kind === 'opportunity',
  store.get('etaske.recents.v1'));
unsub();
// Cold-mount path.
check('pending is claimed by its own type only', consumePending('task') === null);
requestOpen({ type: 'opportunity', id: 'op2' });
check('opportunity claims its pending id', consumePending('opportunity') === 'op2');
check('pending is one-shot', consumePending('opportunity') === null);

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
fs.rmSync(OUT, { force: true });
process.exit(fail ? 1 : 0);
