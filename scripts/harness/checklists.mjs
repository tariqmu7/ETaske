// Harness for src/lib/checklists.ts -> starting checklists for bids and projects (queue C3).
//
// Bundles the REAL module with esbuild. No network, no Firebase.
//
//   node scripts/harness/checklists.mjs
//
// `today` is injected and every expected date is computed from it, so the
// fixtures do not rot with the calendar. Also cross-checks the locale files:
// every template title and label must be translated (they are display-labelled
// at render time, and a missing key would silently paint English in Arabic).

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'checklists.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/checklists.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  logLevel: 'warning',
});

const C = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const TODAY = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
const off = n => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() + n); return iso(d); };
let n = 0;
const ids = () => `id${++n}`;

// ── [1] Templates ────────────────────────────────────────────────────────────
{
  const bid = C.templatesFor('opportunity').map(t => t.key);
  const proj = C.templatesFor('project').map(t => t.key);
  eq(bid, ['tender', 'quotation'], '[1] bid templates');
  eq(proj, ['contract'], '[1] project templates');
  const tender = C.getTemplate('tender');
  const titles = tender.steps.map(s => s.title);
  for (const must of ['Bid bond requested from the bank', 'Technical offer drafted', 'Pricing and commercial offer', 'Offer submitted'])
    ok(titles.includes(must), `[1] tender has "${must}" (the four the queue names)`);
  eq(tender.steps[tender.steps.length - 1], { title: 'Offer submitted', offset: 0 }, '[1] tender ends ON the deadline');
  ok(tender.steps.every((s, i, a) => i === 0 || a[i - 1].offset <= s.offset), '[1] tender steps are in date order');
  ok(C.getTemplate('contract').steps.every(s => s.offset >= 0), '[1] project steps never fall before the start date');
  eq(C.getTemplate('nope'), null, '[1] unknown key → null');
  for (const tp of C.CHECKLIST_TEMPLATES) {
    const t = tp.steps.map(s => s.title.toLowerCase());
    ok(new Set(t).size === t.length, `[1] ${tp.key} has no duplicate titles`);
  }
}

// ── [2] Default by source ───────────────────────────────────────────────────
{
  for (const s of ['Public Tender', 'Limited Tender', 'Framework', undefined, null, ''])
    eq(C.defaultTemplateForSource(s), 'tender', `[2] ${s} → tender`);
  for (const s of ['Direct Order', 'Referral', 'Other'])
    eq(C.defaultTemplateForSource(s), 'quotation', `[2] ${s} → quotation`);
}

// ── [3] Dating from the anchor ──────────────────────────────────────────────
{
  const far = off(40);
  eq(C.stepDueDate(far, -10, TODAY), off(30), '[3] far deadline: natural date');
  eq(C.stepDueDate(far, 0, TODAY), far, '[3] offset 0 = the deadline');
  const near = off(5);
  eq(C.stepDueDate(near, -10, TODAY), TODAY, '[3] near deadline: a step already past is pulled to today');
  eq(C.stepDueDate(near, -3, TODAY), off(2), '[3] near deadline: a future step keeps its date');
  eq(C.stepDueDate(TODAY, -5, TODAY), TODAY, '[3] deadline today: every step today');
  const past = off(-10);
  eq(C.stepDueDate(past, -3, TODAY), off(-13), '[3] deadline already passed: honest late dates, no clamp');
  eq(C.stepDueDate('', -3, TODAY), '', '[3] no anchor → no date');
  eq(C.stepDueDate(undefined, -3, TODAY), '', '[3] undefined anchor → no date');
  eq(C.stepDueDate('30/9/2026', -3, TODAY), '', '[3] malformed anchor → no date');
  eq(C.addDays('2026-02-27', 3), '2026-03-02', '[3] month roll-over');
  eq(C.addDays('2028-02-28', 1), '2028-02-29', '[3] leap day');
  eq(C.addDays('2026-01-05', -10), '2025-12-26', '[3] year roll-back');
  eq(C.addDays('2026-03-28', 2), '2026-03-30', '[3] across a DST-ish weekend, still calendar days');
}

// ── [4] buildChecklist ──────────────────────────────────────────────────────
{
  const dl = off(30);
  const list = C.buildChecklist('tender', dl, TODAY, ids);
  eq(list.length, C.getTemplate('tender').steps.length, '[4] one row per step');
  ok(list.every(i => i.done === false), '[4] nothing starts done');
  ok(list.every(i => typeof i.id === 'string' && i.id), '[4] every row has an id');
  ok(new Set(list.map(i => i.id)).size === list.length, '[4] ids are unique');
  eq(list.find(i => i.title === 'Offer submitted').dueDate, dl, '[4] submission step = deadline');
  eq(list.find(i => i.title === 'Bid bond requested from the bank').dueDate, off(20), '[4] bid bond = deadline − 10');
  ok(list.every(i => typeof i.offset === 'number'), '[4] template rows keep their offset');
  ok(list.every(i => Object.values(i).every(v => v !== undefined)), '[4] no undefined values (Firestore rejects them)');
  eq(C.buildChecklist('none', dl, TODAY, ids), [], '[4] "none" → empty');
  eq(C.buildChecklist('', dl, TODAY, ids), [], '[4] "" → empty');
  eq(C.buildChecklist(null, dl, TODAY, ids), [], '[4] null → empty');
  const undated = C.buildChecklist('quotation', '', TODAY, ids);
  eq(undated.length, 4, '[4] quotation without a deadline still builds');
  ok(undated.every(i => i.dueDate === ''), '[4] …with blank dates');
  const proj = C.buildChecklist('contract', off(3), TODAY, ids);
  eq(proj.find(i => i.title === 'Contract signed').dueDate, off(3), '[4] project: signed on start date');
  eq(proj.find(i => i.title === 'First invoice issued').dueDate, off(33), '[4] project: first invoice start + 30');
  const late = C.buildChecklist('contract', off(-20), TODAY, ids);
  eq(late.find(i => i.title === 'Performance bond issued').dueDate, off(-13), '[4] project recorded late keeps real dates');
}

// ── [5] Progress ────────────────────────────────────────────────────────────
{
  eq(C.checklistProgress(undefined, TODAY), { done: 0, total: 0, percent: 0, late: 0, next: null }, '[5] no list');
  eq(C.checklistProgress('junk', TODAY).total, 0, '[5] a non-array field is treated as empty');
  const list = [
    { id: 'a', title: 'A', dueDate: off(-2), done: false },
    { id: 'b', title: 'B', dueDate: off(-1), done: true, doneAt: off(-1) },
    { id: 'c', title: 'C', dueDate: TODAY, done: false },
    { id: 'd', title: 'D', dueDate: '', done: false },
  ];
  const p = C.checklistProgress(list, TODAY);
  eq([p.done, p.total, p.percent, p.late], [1, 4, 25, 1], '[5] counts (today is NOT late, done is never late)');
  eq(p.next.id, 'a', '[5] next = earliest open');
  eq(C.checklistProgress([{ id: 'x', title: 'X', dueDate: '', done: false }, { id: 'y', title: 'Y', dueDate: off(9), done: false }], TODAY).next.id, 'y', '[5] undated sorts after dated');
  eq(C.checklistProgress(list.map(i => ({ ...i, done: true })), TODAY).next, null, '[5] all done → no next');
  eq(C.checklistProgress(list.map(i => ({ ...i, done: true })), TODAY).percent, 100, '[5] all done → 100%');
}

// ── [6] Editing ─────────────────────────────────────────────────────────────
{
  let list = C.buildChecklist('quotation', off(10), TODAY, ids);
  const firstId = list[0].id;

  let t = C.setDone(list, firstId, true, TODAY, 'Mona');
  eq([t[0].done, t[0].doneAt, t[0].doneByName], [true, TODAY, 'Mona'], '[6] tick records who + when');
  eq(list[0].done, false, '[6] setDone does not mutate its input');
  const again = C.setDone(t, firstId, true, off(1), 'Ahmed');
  eq([again[0].doneAt, again[0].doneByName], [TODAY, 'Mona'], '[6] re-ticking keeps the first completion');
  const un = C.setDone(t, firstId, false, TODAY, 'Mona');
  ok(un[0].done === false && !('doneAt' in un[0]) && !('doneByName' in un[0]), '[6] untick drops who + when (no undefined left behind)');

  const added = C.addItem(list, '  Get the ISO copy  ', off(1), ids);
  const row = added.find(i => i.title === 'Get the ISO copy');
  ok(!!row, '[6] add trims the title');
  ok(row && !('offset' in row), '[6] a typed step has no offset (never re-dated)');
  eq(added.map(i => i.dueDate), [...added.map(i => i.dueDate)].sort((a, b) => (a && b ? a.localeCompare(b) : a ? -1 : 1)), '[6] list stays in date order after add');
  eq(C.addItem(list, '   ', off(1), ids), list, '[6] blank title adds nothing');
  eq(C.addItem(list, 'X', 'tomorrow', ids).find(i => i.title === 'X').dueDate, '', '[6] a bad date is blanked, not stored');

  const moved = C.setDue(list, firstId, off(8));
  const m = moved.find(i => i.id === firstId);
  eq(m.dueDate, off(8), '[6] setDue changes the date');
  ok(!('offset' in m), '[6] a hand-set date detaches the step from the anchor');

  eq(C.renameItem(list, firstId, ' Scope agreed ').find(i => i.id === firstId).title, 'Scope agreed', '[6] rename trims');
  eq(C.renameItem(list, firstId, '  '), list, '[6] blank rename is ignored');
  eq(C.removeItem(list, firstId).length, list.length - 1, '[6] remove');
  eq(C.removeItem(list, 'nope').length, list.length, '[6] removing an unknown id is harmless');
}

// ── [7] Top-up with missing template steps ──────────────────────────────────
{
  const dl = off(30);
  let list = C.buildChecklist('tender', dl, TODAY, ids);
  eq(C.missingSteps('tender', list), [], '[7] full list → nothing missing');
  eq(C.addTemplateSteps(list, 'tender', dl, TODAY, ids).length, list.length, '[7] pressing twice adds nothing');
  const cut = list.filter(i => i.title !== 'Bid bond received' && i.title !== 'Site visit / pre-bid meeting');
  eq(C.missingSteps('tender', cut).map(s => s.title).sort(), ['Bid bond received', 'Site visit / pre-bid meeting'], '[7] the two removed steps are missing');
  const topped = C.addTemplateSteps(cut, 'tender', dl, TODAY, ids);
  eq(topped.length, list.length, '[7] top-up restores them');
  ok(topped.every((i, k, a) => k === 0 || !a[k - 1].dueDate || !i.dueDate || a[k - 1].dueDate <= i.dueDate), '[7] top-up keeps date order');
  const renamedCase = cut.map(i => i.title === 'Offer submitted' ? { ...i, title: '  offer   SUBMITTED ' } : i);
  ok(!C.missingSteps('tender', renamedCase).some(s => s.title === 'Offer submitted'), '[7] title match ignores case and spacing');
  const custom = C.addItem([], 'Our own step', '', ids);
  eq(C.addTemplateSteps(custom, 'quotation', off(10), TODAY, ids).length, 5, '[7] template added beside a custom step');
  eq(C.addTemplateSteps(list, 'none', dl, TODAY, ids), list, '[7] unknown template changes nothing');
}

// ── [8] Re-dating when the anchor moves ─────────────────────────────────────
{
  const oldDl = off(20), newDl = off(27);
  let list = C.buildChecklist('tender', oldDl, TODAY, ids);
  const bond = list.find(i => i.title === 'Bid bond requested from the bank').id;
  const tech = list.find(i => i.title === 'Technical offer drafted').id;
  list = C.setDone(list, bond, true, TODAY, 'Mona');                 // done → keeps its date
  list = C.setDue(list, tech, off(15));                              // hand-dated → keeps its date
  list = C.addItem(list, 'Custom', off(4), ids);                     // typed → keeps its date
  eq(C.redateCount(list, oldDl, TODAY), 0, '[8] unchanged anchor → nothing to re-date');
  const expectMoved = list.filter(i => !i.done && typeof i.offset === 'number').length;
  eq(C.redateCount(list, newDl, TODAY), expectMoved, '[8] count = open template steps whose date changes');
  const re = C.redate(list, newDl, TODAY);
  eq(re.find(i => i.title === 'Offer submitted').dueDate, newDl, '[8] submission follows the new deadline');
  eq(re.find(i => i.id === bond).dueDate, off(10), '[8] a done step keeps its date');
  eq(re.find(i => i.id === tech).dueDate, off(15), '[8] a hand-dated step keeps its date');
  eq(re.find(i => i.title === 'Custom').dueDate, off(4), '[8] a typed step keeps its date');
  eq(C.redateCount(re, newDl, TODAY), 0, '[8] after re-dating, nothing left to move');
  eq(C.redate(list, '', TODAY), list, '[8] no anchor → untouched');
  eq(C.redateCount(list, '', TODAY), 0, '[8] no anchor → button hidden');
  // Anchor added later to an undated list
  const undated = C.buildChecklist('quotation', '', TODAY, ids);
  eq(C.redateCount(undated, off(10), TODAY), 4, '[8] deadline set later → all four can be dated');
  eq(C.redate(undated, off(10), TODAY).map(i => i.dueDate), [off(7), off(8), off(9), off(10)], '[8] …to the right dates');
}

// ── [9] Locale coverage ─────────────────────────────────────────────────────
{
  const en = fs.readFileSync(path.join(ROOT, 'src/locales/en.ts'), 'utf8');
  const ar = fs.readFileSync(path.join(ROOT, 'src/locales/ar.ts'), 'utf8');
  const keyIn = (src, k) => src.includes(`\n  ${JSON.stringify(k)}:`);
  const arLines = ar.split(/\r?\n/);
  const arVal = k => {
    const head = `  ${JSON.stringify(k)}: `;
    const line = arLines.find(l => l.startsWith(head));
    return line ? JSON.parse(line.slice(head.length).replace(/,\s*$/, '')) : null;
  };
  const words = new Set();
  for (const tp of C.CHECKLIST_TEMPLATES) { words.add(tp.label); tp.steps.forEach(s => words.add(s.title)); }
  for (const w of words) {
    ok(keyIn(en, w), `[9] en.ts has "${w}"`);
    const v = arVal(w);
    ok(!!v && v !== w, `[9] ar.ts translates "${w}"`);
    if (v) {
      ok(!/[٠-٩]/.test(v), `[9] "${w}" Arabic has no Arabic-Indic digits`);
      ok(!/(^|\s)(تم|يتم)\s/.test(v) && !v.includes('بواسطة') && !v.includes(','), `[9] "${w}" Arabic passes the style sweep`);
    }
  }
}

console.log(`checklists: ${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
