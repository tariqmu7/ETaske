// Harness for src/lib/decisionMemory.ts -> decision memory on bids (queue D6).
//
// Bundles the REAL module with esbuild. No network, no Firebase.
//
//   node scripts/harness/decisionmemory.mjs
//
// Dates are relative to today so the fixtures never rot. Also cross-checks the
// locale files for every key the Decisions tab and the client file use.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'decisionmemory.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/decisionMemory.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  logLevel: 'warning',
});

const M = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const off = n => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() + n); return iso(d); };
let n = 0;
const ids = () => `id${++n}`;
const ME = { id: 'u1', name: 'Mona' };

// ── [1] Amounts as people type them ─────────────────────────────────────────
{
  eq(M.parseAmount('1,250,000'), 1250000, '[1] commas');
  eq(M.parseAmount(' 1 250 000.50 '), 1250000.5, '[1] spaces + decimals');
  eq(M.parseAmount('١٢٠٠'), 1200, '[1] Arabic-Indic digits');
  eq(M.parseAmount('١٬٢٠٠٫٥'), 1200.5, '[1] Arabic separators');
  eq(M.parseAmount(4500), 4500, '[1] number passes through');
  ok(isNaN(M.parseAmount('12k')), '[1] "12k" is not a number');
  ok(isNaN(M.parseAmount('')), '[1] empty is not a number');
  ok(isNaN(M.parseAmount('-5')), '[1] negative refused');
}

// ── [2] Validation ──────────────────────────────────────────────────────────
{
  const base = { kind: 'decision', date: off(0), text: 'Go ahead', why: '' };
  eq(M.validateDecision(base), [], '[2] a plain decision is fine');
  eq(M.validateDecision({ ...base, text: '   ' }), ['text'], '[2] decision needs words');
  eq(M.validateDecision({ ...base, kind: 'objection', text: '' }), ['text'], '[2] objection needs words');
  eq(M.validateDecision({ ...base, kind: 'price', text: '', amount: '' }), ['amount'], '[2] price needs an amount');
  eq(M.validateDecision({ ...base, kind: 'price', text: '', amount: '0' }), ['amount'], '[2] zero price refused');
  eq(M.validateDecision({ ...base, kind: 'price', text: '', amount: '980,000' }), [], '[2] price with no label is fine');
  eq(M.validateDecision({ ...base, date: '' }), ['date'], '[2] date required');
  eq(M.validateDecision({ ...base, date: '21/09/2026' }), ['date'], '[2] date must be yyyy-mm-dd');
  eq(M.validateDecision({ ...base, kind: 'nope' }), ['kind'], '[2] unknown kind');
  eq(M.validateDecision({ ...base, why: 'x'.repeat(M.WHY_MAX + 1) }), ['too-long'], '[2] long reason refused');
  eq(M.validateDecision(base, M.MAX_DECISIONS), ['full'], '[2] a full bid refuses more');
}

// ── [3] Build / add / edit / remove ─────────────────────────────────────────
{
  const d = M.buildDecision({ kind: 'price', date: off(-3), text: ' Revised offer ', amount: '1,100,000', currency: 'EGP', why: '' }, ME, 1000, ids);
  eq(d, { id: d.id, kind: 'price', date: off(-3), text: 'Revised offer', byId: 'u1', byName: 'Mona', at: 1000, amount: 1100000, currency: 'EGP' }, '[3] price entry is clean');
  ok(!Object.values(d).includes(undefined), '[3] no undefined values (Firestore refuses them in arrays)');
  const dec = M.buildDecision({ kind: 'decision', date: off(0), text: 'Drop it', why: 'Scope is 70% civil' }, ME, 2000, ids);
  ok(!('amount' in dec) && !('currency' in dec), '[3] a decision carries no amount');
  eq(dec.why, 'Scope is 70% civil', '[3] why kept');
  const noWhy = M.buildDecision({ kind: 'objection', date: off(0), text: 'Too slow', why: '  ' }, ME, 1, ids);
  ok(!('why' in noWhy), '[3] blank why is dropped');

  let list = M.addDecision(undefined, d);
  list = M.addDecision(list, dec);
  eq(list.length, 2, '[3] two added');
  eq(M.addDecision(list, d).length, 2, '[3] same id twice is ignored');
  const edited = M.updateDecision(list, dec.id, { kind: 'decision', date: off(-1), text: 'Drop it', why: 'Civil scope, no partner' }, 5000);
  const e = edited.find(x => x.id === dec.id);
  eq([e.why, e.date, e.byId, e.at, e.editedAt], ['Civil scope, no partner', off(-1), 'u1', 2000, 5000], '[3] edit keeps author + typing time, stamps editedAt');
  eq(edited.find(x => x.id === d.id), d, '[3] edit leaves the other entry alone');
  eq(M.removeDecision(edited, d.id).map(x => x.id), [dec.id], '[3] remove');
  eq(M.removeDecision(undefined, 'x'), [], '[3] remove on nothing');

  ok(M.canChangeDecision(d, 'u1', 'Employee'), '[3] author may change');
  ok(!M.canChangeDecision(d, 'u2', 'Employee'), '[3] another employee may not');
  ok(M.canChangeDecision(d, 'u2', 'Manager') && M.canChangeDecision(d, 'u2', 'Admin'), '[3] manager / admin may');
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const entry = (kind, date, text, extra = {}) => ({ id: ids(), kind, date, text, byId: 'u1', byName: 'Mona', at: Date.parse(date + 'T10:00:00'), ...extra });

const bids = [
  { // Lost on price, with a logged story
    id: 'b1', serialNumber: 'OP000001', title: 'Tank cleaning 2025', client: 'AGIBA Co.', stage: 'Lost', currency: 'EGP',
    decisionDate: off(-200), awardedTo: 'Petrojet',
    decisions: [
      entry('price', off(-260), 'First offer', { amount: 1500000, currency: 'EGP' }),
      entry('objection', off(-240), 'Price 20% above budget', { why: 'We explained the scaffolding cost' }),
      entry('price', off(-230), 'Revised offer', { amount: 1350000, currency: 'EGP' }),
    ],
  },
  { // No Bid — the logged decision says why in words
    id: 'b2', serialNumber: 'OP000002', title: 'Civil works Meleiha', client: 'agiba', stage: 'No Bid',
    decisions: [entry('decision', off(-90), 'Not bidding', { why: 'Scope is 70% civil — not our work' })],
  },
  { // Won — price only in the Outcome record
    id: 'b3', serialNumber: 'OP000003', title: 'Pump overhaul', client: 'AGIBA', stage: 'Won', currency: 'USD', decisionDate: off(-30),
  },
  { // The bid being worked on now
    id: 'b4', serialNumber: 'OP000004', title: 'Tank cleaning 2026', client: 'Agiba', stage: 'Bid Preparation',
    decisions: [entry('price', off(-1), 'Draft', { amount: 999, currency: 'EGP' })],
  },
  { id: 'b5', title: 'Other client', client: 'APC', stage: 'Lost', decisions: [entry('objection', off(-5), 'APC thing')] },
  { id: 'b6', title: 'No client at all', stage: 'Lost' },
];
const feedback = [
  { id: 'f1', opportunityId: 'b1', outcome: 'Lost', reasons: ['Technical evaluation', 'Price too high'], primaryReason: 'Price too high',
    competitorName: 'Petrojet', ourPrice: '1,300,000', winningPrice: 1100000, priceGapPercent: 18.2,
    clientFeedback: 'Wanted a shorter shutdown', lessonsLearned: 'Offer a night shift option', authorName: 'Ali', createdAt: { seconds: 10 } },
  { id: 'f1b', opportunityId: 'b1', outcome: 'Lost', reasons: ['Other'], createdAt: { seconds: 99 } }, // a race duplicate — ignored
  { id: 'f3', opportunityId: 'b3', outcome: 'Won', reasons: ['Client relationship'], ourPrice: 250000, authorName: 'Ali', createdAt: { seconds: 20 } },
  { id: 'f5', opportunityId: 'b5', outcome: 'Lost', reasons: ['Local content'], createdAt: { seconds: 30 } },
];

// ── [4] One bid's timeline ──────────────────────────────────────────────────
{
  const fb = M.feedbackByBid(feedback);
  eq(fb.get('b1').id, 'f1', '[4] oldest feedback wins, as on the Outcome tab');
  const tl = M.bidTimeline(bids[0], fb.get('b1'));
  eq(tl.map(r => `${r.source}:${r.kind}`), [
    'outcome:outcome', 'outcome:price', 'outcome:objection', 'outcome:lesson',
    'log:price', 'log:objection', 'log:price',
  ], '[4] newest first, outcome facts on top');
  const out = tl[0];
  eq(out.reasons, ['Price too high', 'Technical evaluation'], '[4] primary reason first');
  eq([out.stage, out.competitor, out.winningPrice, out.gapPercent, out.date], ['Lost', 'Petrojet', 1100000, 18.2, off(-200)], '[4] outcome row facts');
  eq(tl[1].amount, 1300000, '[4] outcome "our price" parsed from text');
  eq(tl[4].text, 'Revised offer', '[4] logged rows by date');
  ok(tl.filter(r => r.source === 'log').every(r => r.entry), '[4] logged rows carry their entry (edit/remove)');
  ok(tl.filter(r => r.source === 'outcome').every(r => !r.entry), '[4] outcome rows are read-only');

  eq(M.bidTimeline(bids[3], null).map(r => r.kind), ['price'], '[4] open bid: log only');
  eq(M.bidTimeline({ id: 'x', stage: 'Identified' }, null), [], '[4] nothing remembered → empty');
  eq(M.bidTimeline({ id: 'x', stage: 'Identified', decisions: 'junk' }, null), [], '[4] junk field tolerated');
  // Feedback saved while the bid is still open (outcome picked ahead of the stage) still counts.
  eq(M.bidTimeline({ id: 'x', stage: 'Submitted' }, { id: 'f', outcome: 'Lost', reasons: ['Other'] }).map(r => r.kind), ['outcome'], '[4] outcome with open stage');

  // Same day: the later-typed entry comes first.
  const sameDay = { id: 's', decisions: [entry('decision', off(0), 'A', { at: 1 }), entry('decision', off(0), 'B', { at: 2 })] };
  eq(M.bidTimeline(sameDay, null).map(r => r.text), ['B', 'A'], '[4] same day → typing order, newest first');
}

// ── [5] Last price on a bid ─────────────────────────────────────────────────
{
  const fb = M.feedbackByBid(feedback);
  eq(M.lastPriceOf(bids[0], fb.get('b1')).amount, 1300000, '[5] outcome price (dated on the decision) is the final one');
  eq(M.lastPriceOf(bids[0], null).amount, 1350000, '[5] without an outcome: the latest logged offer');
  eq(M.lastPriceOf(bids[1], null), null, '[5] no price → null');
  eq(M.lastPriceOf(bids[2], fb.get('b3')).amount, 250000, '[5] outcome-only price');
  eq(M.lastPriceOf(bids[2], fb.get('b3')).currency, 'USD', '[5] outcome price takes the bid currency');
  eq(M.lastPriceOf({ id: 'z', decisions: [entry('price', '', 'undated', { amount: 5 }), entry('price', off(-9), 'dated', { amount: 7 })] }, null).amount, 7, '[5] a dated price beats an undated one');
}

// ── [6] Earlier with this client ────────────────────────────────────────────
{
  const mem = M.clientMemory('agiba', bids, feedback, 'b4');
  eq(mem.bidCount, 3, '[6] three OTHER AGIBA bids (spellings merged, current bid excluded)');
  ok(!mem.empty, '[6] not empty');
  eq([mem.lastPrice.amount, mem.lastPrice.currency, mem.lastPrice.bid.id], [250000, 'USD', 'b3'], '[6] last price = newest across bids');
  eq(mem.prices.map(p => p.bid.id), ['b3', 'b1'], '[6] one price per bid, newest first');
  ok(!mem.prices.some(p => p.bid.id === 'b4'), '[6] the draft price on the current bid is not "earlier"');
  eq(mem.dropped.map(d => [d.bid.id, d.stage]), [['b2', 'No Bid'], ['b1', 'Lost']], '[6] lost + dropped, newest first');
  const nb = mem.dropped[0];
  eq([nb.said, nb.saidWhy, nb.date], ['Not bidding', 'Scope is 70% civil — not our work', off(-90)], '[6] No Bid carries the logged why + its date');
  const lost = mem.dropped[1];
  eq([lost.reasons[0], lost.competitor, lost.gapPercent], ['Price too high', 'Petrojet', 18.2], '[6] Lost carries reasons, winner, gap');
  eq(mem.objections.map(o => o.text), ['Wanted a shorter shutdown', 'Price 20% above budget'], '[6] objections from the log AND the outcome, newest first');
  eq(mem.objections[1].why, 'We explained the scaffolding cost', '[6] our answer kept');
  eq(mem.lessons.map(l => l.text), ['Offer a night shift option'], '[6] lessons');
  eq(mem.decisions.map(d => d.text), ['Not bidding'], '[6] decisions');
  eq(mem.reasonTally, [{ reason: 'Price too high', count: 1 }, { reason: 'Technical evaluation', count: 1 }], '[6] reason tally (lost/dropped only — a Won reason is not counted)');
  ok(mem.objections.every(o => o.bid && o.bid.title), '[6] every row names its bid');

  const all = M.clientMemory('agiba', bids, feedback);
  eq(all.bidCount, 4, '[6] no exclusion → the client file sees all four');
  eq(all.lastPrice.bid.id, 'b4', '[6] ... and its newest price is the draft');

  const none = M.clientMemory('', bids, feedback);
  ok(none.empty && none.bidCount === 0, '[6] no client key → nothing (the no-client bid is not everyone\'s)');
  const apc = M.clientMemory('apc', bids, feedback);
  eq(apc.objections.map(o => o.text), ['APC thing'], '[6] another client stays separate');
  eq(apc.reasonTally, [{ reason: 'Local content', count: 1 }], '[6] APC tally');
  ok(M.clientMemory('nobody', bids, feedback).empty, '[6] unknown client → empty');
}

// ── [7] Locale keys ─────────────────────────────────────────────────────────
{
  const en = fs.readFileSync(path.join(ROOT, 'src/locales/en.ts'), 'utf8');
  const ar = fs.readFileSync(path.join(ROOT, 'src/locales/ar.ts'), 'utf8');
  const files = ['src/components/opportunities/OpportunityDecisionsTab.tsx', 'src/components/opportunities/EarlierWithClient.tsx'];
  const keys = new Set();
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) { ok(false, `[7] ${f} exists`); continue; }
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)+)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
  }
  ok(keys.size > 20, `[7] found the tab's t() keys (${keys.size})`);
  const has = (src, k) => src.includes(`'${k.replace(/'/g, "\\'")}':`) || src.includes(`"${k}":`);
  for (const k of keys) {
    ok(has(en, k), `[7] en has "${k}"`);
    ok(has(ar, k), `[7] ar has "${k}"`);
  }
  ok(!/[٠-٩]/.test(ar.split('// ─── D6')[1] || ''), '[7] D6 Arabic block uses Latin digits');
}

console.log(`decisionmemory: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
