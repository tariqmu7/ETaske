// Harness for src/lib/recordLinks.ts — the cross-linking write layer.
//
// Bundles the REAL module with esbuild, stubbing only Firestore: ./firebase (the
// app instance) and firebase/firestore (addDoc/updateDoc/doc/collection/
// serverTimestamp/deleteField). Every write the module makes is recorded, so the
// assertions are about the ACTUAL documents that would hit the database —
// collection names, the authorId the rules check, which fields are mirrored and
// which are deliberately NOT.
//
// Run: node scripts/harness/recordlinks.mjs

import { build } from 'esbuild';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(os.tmpdir(), 'recordLinks.bundle.mjs');

const stubPlugin = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /\.\/firebase$/ }, () => ({ path: 'stub-app', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'stub-fs', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-app'
        ? `export const db = { __db: true };`
        : `export function collection(db, name) { return { kind: 'collection', name }; }
           export function doc(db, name, id) { return { kind: 'doc', name, id }; }
           export function serverTimestamp() { return '<serverTimestamp>'; }
           export function deleteField() { return '<deleteField>'; }
           export async function addDoc(ref, data) {
             if (globalThis.__failOn === ref.name) throw new Error('permission-denied');
             globalThis.__writes.push({ op: 'add', col: ref.name, data });
             return { id: 'new1' };
           }
           export async function updateDoc(ref, data) {
             if (globalThis.__failOn === ref.name) throw new Error('permission-denied');
             globalThis.__writes.push({ op: 'update', col: ref.name, id: ref.id, data });
           }`,
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [path.join(ROOT, 'src/lib/recordLinks.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  // src/utils.ts (getUserColor) reads import.meta.env at module load.
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  plugins: [stubPlugin],
  logLevel: 'warning',
});

const writes = [];
globalThis.__writes = writes;
globalThis.__failOn = null;

const M = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const reset = () => { writes.length = 0; globalThis.__failOn = null; };
const of = (op, col) => writes.filter(w => w.op === op && w.col === col);

const OPP = { id: 'op1', serialNumber: 'OP000012', title: 'Zohr tie-in' };
const PRJ = { id: 'pr1', name: 'Ras Ghareb Tanks' };
const ACTOR = { uid: 'u1', displayName: 'Tariq', color: '#123456' };
const SRC = {
  kind: 'task', id: 't1', title: 'Prepare technical proposal',
  serialNumber: 'TK000123', status: 'In Progress', assignedTo: 'Nevin', dueDate: '2026-09-01',
};

// ── [1] building the link block ──────────────────────────────────────────────
console.log('\n[1] buildRecordLinks');
{
  const both = M.buildRecordLinks(OPP, PRJ);
  check('carries the opportunity id + denormalized labels',
    both.opportunityId === 'op1' && both.opportunitySerial === 'OP000012' && both.opportunityTitle === 'Zohr tie-in');
  check('carries the project id + name', both.projectId === 'pr1' && both.projectName === 'Ras Ghareb Tanks');

  const none = M.buildRecordLinks(null, null);
  check('nothing picked = EMPTY object, no undefined keys (Firestore rejects undefined)',
    Object.keys(none).length === 0 && !Object.values(none).includes(undefined));

  const onlyPrj = M.buildRecordLinks(undefined, PRJ);
  check('one side picked leaves the other side\'s keys absent',
    !('opportunityId' in onlyPrj) && onlyPrj.projectId === 'pr1');

  const noLabels = M.buildRecordLinks({ id: 'op2', title: '' }, { id: 'pr2', name: '' });
  check('a missing label is omitted, not written as ""',
    noLabels.opportunityId === 'op2' && !('opportunityTitle' in noLabels) &&
    !('opportunitySerial' in noLabels) && !('projectName' in noLabels));

  check('hasAnyLink false on empty', M.hasAnyLink(none) === false);
  check('hasAnyLink true with one side', M.hasAnyLink(onlyPrj) === true);
  check('sameLinkTargets ignores stale labels',
    M.sameLinkTargets(both, { opportunityId: 'op1', opportunityTitle: 'OLD NAME', projectId: 'pr1' }) === true);
  check('sameLinkTargets sees a moved link',
    M.sameLinkTargets(both, { opportunityId: 'opX', projectId: 'pr1' }) === false);
}

// ── [2] the UPDATE patch must CLEAR a dropped link ───────────────────────────
console.log('\n[2] recordLinksPatch');
{
  const p = M.recordLinksPatch(M.buildRecordLinks(OPP, null));
  check('sets the kept side', p.opportunityId === 'op1' && p.opportunitySerial === 'OP000012');
  check('★ the DROPPED side is deleteField(), not an omitted key (omitting keeps the old link)',
    p.projectId === '<deleteField>' && p.projectName === '<deleteField>');
  const cleared = M.recordLinksPatch({});
  check('clearing both sides deletes all five fields',
    Object.keys(cleared).length === 5 && Object.values(cleared).every(v => v === '<deleteField>'));
  const partial = M.recordLinksPatch({ opportunityId: 'op9' });
  check('a kept link with no label deletes the stale label',
    partial.opportunityId === 'op9' && partial.opportunityTitle === '<deleteField>');
}

// ── [3] reading links back off a stored record ───────────────────────────────
console.log('\n[3] linksOf');
{
  const stored = { id: 't1', taskName: 'x', opportunityId: 'op1', opportunityTitle: 'Zohr tie-in', notes: [] };
  const l = M.linksOf(stored);
  check('picks only the link fields', Object.keys(l).sort().join() === 'opportunityId,opportunityTitle');
  check('an unlinked record reads as empty', Object.keys(M.linksOf({ id: 't2' })).length === 0);
}

// ── [4] history wording ──────────────────────────────────────────────────────
console.log('\n[4] historyText (stored ENGLISH by design)');
{
  check('created', M.historyText(SRC, 'created') ===
    'Task TK000123 "Prepare technical proposal" created — assigned to Nevin, due 2026-09-01.',
    M.historyText(SRC, 'created'));
  check('linked', M.historyText({ ...SRC, dueDate: undefined }, 'linked') ===
    'Task TK000123 "Prepare technical proposal" linked to this record — assigned to Nevin.');
  check('status carries the new status', M.historyText(SRC, 'status').includes('is now In Progress.'));
  check('completed names the owner', M.historyText(SRC, 'completed').includes('completed by Nevin.'));
  check('a correspondence is labelled as one',
    M.historyText({ kind: 'correspondence', id: 'c1', title: 'Budget request', serialNumber: 'CR000045' }, 'linked')
      .startsWith('Correspondence CR000045 "Budget request"'));
  check('no serial = no stray double space',
    M.historyText({ kind: 'task', id: 't9', title: 'Ad-hoc' }, 'linked') === 'Task "Ad-hoc" linked to this record.');
  check('a note is appended verbatim', M.historyText(SRC, 'status', 'Waiting on the client.')
    .endsWith('is now In Progress. Waiting on the client.'));
}

// ── [5] the mirrored documents ───────────────────────────────────────────────
console.log('\n[5] mirrorRecordEvent — what actually hits Firestore');
{
  reset();
  const r = await M.mirrorRecordEvent(M.buildRecordLinks(OPP, PRJ), SRC, ACTOR, 'created');
  check('both sides reported written', r.opportunity && r.project && r.errors.length === 0);

  const fu = of('add', 'opportunityFollowUps')[0];
  check('the follow-up goes to opportunityFollowUps', !!fu);
  check('★ authorId is the ACTOR uid — rules require authorId == request.auth.uid', fu.data.authorId === 'u1');
  check('keyed to the opportunity', fu.data.opportunityId === 'op1');
  check('author name + colour are denormalized like the tab does',
    fu.data.authorName === 'Tariq' && fu.data.authorColor === '#123456');

  const oppUpd = of('update', 'opportunities')[0];
  check('the opportunity summary is mirrored',
    oppUpd.data.lastFollowUpText === fu.data.text && oppUpd.data.lastFollowUpAt === '<serverTimestamp>');
  check('★ stage is NOT touched — a task event must never move the pipeline',
    !('stage' in oppUpd.data) && !('nextActionDate' in oppUpd.data));

  const pu = of('add', 'projectUpdates')[0];
  check('the project update goes to projectUpdates', pu.data.projectId === 'pr1' && pu.data.authorId === 'u1');
  const prjUpd = of('update', 'projects')[0];
  check('the project summary is mirrored', prjUpd.data.lastUpdateText === pu.data.text);
  check('★ project status is NOT touched — a task status is not the project status',
    !('status' in prjUpd.data) && !('currentStatus' in prjUpd.data));
  check('the same sentence is stored on both sides', fu.data.text === pu.data.text);

  reset();
  await M.mirrorRecordEvent(M.buildRecordLinks(OPP, null), SRC, ACTOR, 'linked');
  check('an opportunity-only link writes nothing to the project collections',
    of('add', 'projectUpdates').length === 0 && of('update', 'projects').length === 0);

  reset();
  await M.mirrorRecordEvent({}, SRC, ACTOR, 'linked');
  check('an unlinked record writes nothing at all', writes.length === 0);

  reset();
  const anon = await M.mirrorRecordEvent(M.buildRecordLinks(OPP, null), SRC, { uid: 'u9' }, 'linked');
  check('a nameless actor still writes a name + a colour',
    anon.opportunity && of('add', 'opportunityFollowUps')[0].data.authorName === 'Unknown' &&
    !!of('add', 'opportunityFollowUps')[0].data.authorColor);
}

// ── [6] a failed mirror is reported, never thrown ────────────────────────────
console.log('\n[6] best-effort mirroring');
{
  reset();
  globalThis.__failOn = 'opportunityFollowUps';
  let threw = false;
  let r;
  try { r = await M.mirrorRecordEvent(M.buildRecordLinks(OPP, PRJ), SRC, ACTOR, 'created'); }
  catch { threw = true; }
  check('★ a denied opportunity write does NOT throw at the caller', threw === false);
  check('it is reported instead', r && r.opportunity === false && r.errors.includes('opportunity'));
  check('★ and the OTHER side still gets its entry', r && r.project === true && of('add', 'projectUpdates').length === 1);
}

// ── [7] applyRecordLinks — patch + mirror, no repeat entries ─────────────────
console.log('\n[7] applyRecordLinks');
{
  reset();
  await M.applyRecordLinks(SRC, M.buildRecordLinks(OPP, PRJ), ACTOR);
  const patch = of('update', 'tasks')[0];
  check('patches the right collection + doc', patch.col === 'tasks' && patch.id === 't1');
  check('the link fields are in the patch', patch.data.opportunityId === 'op1' && patch.data.projectId === 'pr1');
  check('and it stamps updatedAt', patch.data.updatedAt === '<serverTimestamp>');
  check('both targets got a "linked" entry',
    of('add', 'opportunityFollowUps')[0].data.text.includes('linked to this record') &&
    of('add', 'projectUpdates').length === 1);

  reset();
  await M.applyRecordLinks(SRC, M.buildRecordLinks(OPP, PRJ), ACTOR, { previous: M.buildRecordLinks(OPP, null) });
  check('★ re-saving an unchanged link posts NO second entry (a form save is not spam)',
    of('add', 'opportunityFollowUps').length === 0);
  check('but the newly added side does get one', of('add', 'projectUpdates').length === 1);

  reset();
  await M.applyRecordLinks(SRC, {}, ACTOR, { previous: M.buildRecordLinks(OPP, PRJ) });
  check('detaching clears the fields', of('update', 'tasks')[0].data.opportunityId === '<deleteField>');
  check('and posts no history to the record it just left', writes.filter(w => w.op === 'add').length === 0);

  reset();
  await M.applyRecordLinks(SRC, M.buildRecordLinks({ id: 'op2', title: 'New bid' }, null), ACTOR,
    { previous: M.buildRecordLinks(OPP, null), event: 'status', note: 'Moved.' });
  check('a MOVED link posts to the new target only',
    of('add', 'opportunityFollowUps').length === 1 &&
    of('add', 'opportunityFollowUps')[0].data.opportunityId === 'op2');
  check('the caller\'s event + note are honoured',
    of('add', 'opportunityFollowUps')[0].data.text.endsWith('is now In Progress. Moved.'));

  reset();
  globalThis.__failOn = 'tasks';
  let threw = false;
  try { await M.applyRecordLinks(SRC, M.buildRecordLinks(OPP, null), ACTOR); } catch { threw = true; }
  check('★ a failed LINK write DOES throw — there is no link, the caller must say so', threw === true);
}

// ── [8] announceNewRecord (create-time twin) ─────────────────────────────────
console.log('\n[8] announceNewRecord');
{
  reset();
  await M.announceNewRecord(M.buildRecordLinks(OPP, null), SRC, ACTOR);
  check('mirrors only — the new doc already carries its links', of('update', 'tasks').length === 0);
  check('and the entry reads as a creation',
    of('add', 'opportunityFollowUps')[0].data.text.includes('created — assigned to Nevin'));
}

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
fs.rmSync(OUT, { force: true });
process.exit(fail ? 1 : 0);
