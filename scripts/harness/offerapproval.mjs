// Harness for src/lib/offerApproval.ts -> manager sign-off before an offer goes out (queue D10).
//
// Bundles the REAL module with esbuild. No network, no Firebase.
//
//   node scripts/harness/offerapproval.mjs
//
// Also reads firestore.rules and checks the rule mirrors the module (same
// stages, same "only a manager writes approved"), and cross-checks the locale
// files for every key the sign-off screens use.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'offerapproval.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/offerApproval.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  logLevel: 'warning',
});

const M = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const throws = (fn, msg, label) => { try { fn(); fails.push(`${label} — did not throw`); } catch (e) { ok(!msg || e.message === msg, `${label} — threw ${e.message}`); } };

const MONA = { id: 'u-mona', name: 'Mona Fathy', role: 'Employee' };
const SAMI = { id: 'u-sami', name: 'Sami Adel', role: 'Employee' };
const TARIQ = { id: 'u-mgr', name: 'Tariq Salama', role: 'Manager' };
const ADMIN = { id: 'u-adm', name: 'Admin', role: 'Admin' };
const T0 = new Date(2026, 8, 20, 10, 0).getTime();
const bid = (extra = {}) => ({ id: 'b1', title: 'Tank cleaning', stage: 'Bid Preparation', estimatedValue: 1200000, currency: 'EGP', ...extra });

// ── [1] Stages and the gate line ────────────────────────────────────────────
{
  for (const s of ['Identified', 'Prequalification', 'Bid Preparation']) ok(M.isPreSend(s), `[1] ${s} is before sending`);
  for (const s of ['Submitted', 'Under Evaluation', 'Won', 'Lost', 'No Bid', 'Cancelled', '', undefined]) ok(!M.isPreSend(s), `[1] ${s} is not pre-send`);
  ok(M.crossesGate('Bid Preparation', 'Submitted'), '[1] prep → submitted crosses');
  ok(M.crossesGate('Identified', 'Under Evaluation'), '[1] identified → under evaluation crosses');
  ok(M.crossesGate('Prequalification', 'Won'), '[1] prequal → won crosses');
  ok(!M.crossesGate('Bid Preparation', 'Lost'), '[1] dropping to Lost needs no sign-off');
  ok(!M.crossesGate('Bid Preparation', 'No Bid'), '[1] No Bid needs no sign-off');
  ok(!M.crossesGate('Bid Preparation', 'Cancelled'), '[1] Cancelled needs no sign-off');
  ok(!M.crossesGate('Submitted', 'Under Evaluation'), '[1] already sent → no gate');
  ok(!M.crossesGate('Submitted', 'Won'), '[1] sent → won no gate');
  ok(!M.crossesGate('Identified', 'Bid Preparation'), '[1] moving within pre-send no gate');
  ok(!M.crossesGate(undefined, 'Submitted'), '[1] a brand-new bid is not "crossing"');
}

// ── [2] Price the approval is tied to ───────────────────────────────────────
{
  eq(M.priceOf(bid()), { amount: 1200000, currency: 'EGP' }, '[2] price read off the bid');
  eq(M.priceOf({}), { amount: null, currency: '' }, '[2] no price, no currency');
  eq(M.priceOf({ estimatedValue: '' }), { amount: null, currency: '' }, '[2] empty string reads as no price');
  ok(M.samePrice({ amount: 5, currency: 'USD' }, { amount: 5, currency: 'USD' }), '[2] same');
  ok(!M.samePrice({ amount: 5, currency: 'USD' }, { amount: 6, currency: 'USD' }), '[2] amount differs');
  ok(!M.samePrice({ amount: 5, currency: 'USD' }, { amount: 5, currency: 'EGP' }), '[2] currency differs');
  ok(M.samePrice({ amount: null }, { amount: undefined }), '[2] null = undefined');
  ok(!M.samePrice({ amount: '5' }, { amount: 5 }), '[2] stored "5" ≠ 5 — same strict test as firestore.rules');
}

// ── [3] Asking ──────────────────────────────────────────────────────────────
{
  const b = bid();
  eq(M.approvalState(b), 'none', '[3] nothing asked yet');
  const a = M.requestApproval(b, MONA, '  Discount 5% vs last year  ', T0);
  eq(a.status, 'requested', '[3] status requested');
  eq([a.amount, a.currency], [1200000, 'EGP'], '[3] price snapshot');
  eq([a.requestedById, a.requestedByName, a.requestedAt], ['u-mona', 'Mona Fathy', T0], '[3] who + when');
  eq(a.requestNote, 'Discount 5% vs last year', '[3] note trimmed');
  eq(a.log.length, 1, '[3] one history line');
  eq(a.log[0].kind, 'requested', '[3] history says requested');
  eq(M.approvalState({ ...b, approval: a }), 'requested', '[3] state requested');
  const a2 = M.requestApproval(b, MONA, '', T0);
  ok(!('requestNote' in a2), '[3] blank note not stored');
  ok(!('note' in a2.log[0]), '[3] blank note not in history');
  const long = M.requestApproval(b, MONA, 'x'.repeat(5000), T0);
  eq(long.requestNote.length, M.NOTE_MAX, '[3] note capped');
  ok(!M.isSignedOff({ ...b, approval: a }), '[3] a request is not a sign-off');
}

// ── [4] Deciding ────────────────────────────────────────────────────────────
{
  const b = bid();
  const req = M.requestApproval(b, MONA, 'please', T0);
  const withReq = { ...b, approval: req };
  eq(M.decideProblem(withReq, MONA, 'approved'), 'not-manager', '[4] employee cannot approve');
  eq(M.decideProblem(withReq, SAMI, 'returned', 'no'), 'not-manager', '[4] employee cannot send back');
  eq(M.decideProblem(withReq, TARIQ, 'returned', '  '), 'reason-needed', '[4] sending back needs a reason');
  eq(M.decideProblem(withReq, TARIQ, 'approved'), null, '[4] manager may approve');
  eq(M.decideProblem(withReq, ADMIN, 'approved'), null, '[4] admin may approve');
  eq(M.decideProblem(b, TARIQ, 'returned', 'why'), 'nothing-to-decide', '[4] nothing to send back');
  throws(() => M.decide(withReq, MONA, 'approved', '', T0 + 1), 'not-manager', '[4] decide() refuses an employee');

  const ap = M.decide(withReq, TARIQ, 'approved', 'OK at this price', T0 + 3600000);
  eq(ap.status, 'approved', '[4] approved');
  eq([ap.decidedById, ap.decidedByName, ap.decidedAt], ['u-mgr', 'Tariq Salama', T0 + 3600000], '[4] who + when decided');
  eq([ap.requestedById, ap.requestNote], ['u-mona', 'please'], '[4] the request is kept');
  eq(ap.decisionNote, 'OK at this price', '[4] decision note');
  eq(ap.log.map(e => e.kind), ['requested', 'approved'], '[4] history grows');
  ok(M.isSignedOff({ ...b, approval: ap }), '[4] signed off');
  eq(M.approvalState({ ...b, approval: ap }), 'approved', '[4] state approved');

  const back = M.decide(withReq, TARIQ, 'returned', 'Price too low — check scaffolding', T0 + 5);
  eq(back.status, 'returned', '[4] returned');
  eq(back.decisionNote, 'Price too low — check scaffolding', '[4] reason kept');
  eq(M.approvalState({ ...b, approval: back }), 'returned', '[4] state returned');
  ok(!M.isSignedOff({ ...b, approval: back }), '[4] returned is not signed');

  // asking again after a return keeps the whole story
  const again = M.requestApproval({ ...b, approval: back }, MONA, 'fixed', T0 + 10);
  eq(again.status, 'requested', '[4] asked again');
  eq(again.log.map(e => e.kind), ['requested', 'returned', 'requested'], '[4] history not lost');
  ok(!('decidedById' in again) && !('decisionNote' in again), '[4] old verdict cleared from the live fields');

  // manager approves with no request pending
  const direct = M.decide(b, TARIQ, 'approved', '', T0);
  eq(direct.status, 'approved', '[4] direct approval');
  eq([direct.requestedById, direct.decidedById], ['u-mgr', 'u-mgr'], '[4] manager is asker and approver');
  eq(direct.log.map(e => e.kind), ['approved'], '[4] no fake "requested" line');
  ok(!('decisionNote' in direct), '[4] no empty note stored');

  // approving picks up the price as it is NOW (the manager looks at the bid, not the request)
  const moved = M.decide({ ...b, estimatedValue: 1150000, approval: req }, TARIQ, 'approved', '', T0 + 9);
  eq(moved.amount, 1150000, '[4] approval covers the current price');
  ok(M.isSignedOff({ ...b, estimatedValue: 1150000, approval: moved }), '[4] ... and is valid for it');
}

// ── [5] Price moves after approval → stale ──────────────────────────────────
{
  const b = bid();
  const ap = M.decide({ ...b, approval: M.requestApproval(b, MONA, '', T0) }, TARIQ, 'approved', '', T0 + 1);
  eq(M.approvalState({ ...b, approval: ap, estimatedValue: 1300000 }), 'stale', '[5] new amount → stale');
  eq(M.approvalState({ ...b, approval: ap, currency: 'USD' }), 'stale', '[5] new currency → stale');
  eq(M.approvalState({ ...b, approval: ap, estimatedValue: null }), 'stale', '[5] price cleared → stale');
  eq(M.approvalState({ ...b, approval: ap, title: 'renamed' }), 'approved', '[5] other edits do not matter');
  const re = M.requestApproval({ ...b, estimatedValue: 1300000, approval: ap }, MONA, 'new price', T0 + 2);
  eq([re.status, re.amount], ['requested', 1300000], '[5] asking again takes the new price');
  eq(re.log.length, 3, '[5] history keeps the old approval');
}

// ── [6] Withdrawing ─────────────────────────────────────────────────────────
{
  const b = bid();
  const req = { ...b, approval: M.requestApproval(b, MONA, '', T0) };
  ok(M.canWithdraw(req, MONA), '[6] the asker may take it back');
  ok(M.canWithdraw(req, TARIQ), '[6] a manager may too');
  ok(!M.canWithdraw(req, SAMI), '[6] another employee may not');
  ok(!M.canWithdraw(b, MONA), '[6] nothing to take back');
  const w = M.withdraw(req, MONA, T0 + 1);
  eq(w.status, 'withdrawn', '[6] withdrawn');
  eq(w.log.map(e => e.kind), ['requested', 'withdrawn'], '[6] history');
  ok(!M.canWithdraw({ ...b, approval: w }, MONA), '[6] cannot withdraw twice');
  throws(() => M.withdraw(req, SAMI, T0), 'cannot-withdraw', '[6] withdraw() refuses');
  const ap = M.decide(req, TARIQ, 'approved', '', T0);
  ok(!M.canWithdraw({ ...b, approval: ap }, MONA), '[6] an approval cannot be "withdrawn"');
}

// ── [7] The gate as a save sees it ──────────────────────────────────────────
{
  const b = bid();
  const next = (extra = {}) => ({ stage: 'Submitted', estimatedValue: 1200000, currency: 'EGP', ...extra });
  eq(M.checkGate(b, next(), MONA, T0), { ok: false, problem: 'needs-approval' }, '[7] employee, never asked → stopped');
  const req = { ...b, approval: M.requestApproval(b, MONA, '', T0) };
  eq(M.checkGate(req, next(), MONA, T0), { ok: false, problem: 'pending' }, '[7] still waiting → stopped');
  const ret = { ...b, approval: M.decide(req, TARIQ, 'returned', 'no', T0) };
  eq(M.checkGate(ret, next(), MONA, T0), { ok: false, problem: 'returned' }, '[7] sent back → stopped');
  const ap = { ...b, approval: M.decide(req, TARIQ, 'approved', '', T0) };
  eq(M.checkGate(ap, next(), MONA, T0), { ok: true }, '[7] approved → through, nothing extra written');
  eq(M.checkGate(ap, next({ estimatedValue: 999 }), MONA, T0), { ok: false, problem: 'price-changed' }, '[7] price changed in the SAME save → stopped');
  eq(M.checkGate(ap, next({ stage: 'Won' }), MONA, T0), { ok: true }, '[7] approved → can go straight to Won');
  eq(M.checkGate(b, next({ stage: 'Lost' }), MONA, T0), { ok: true }, '[7] Lost is never gated');
  eq(M.checkGate(b, next({ stage: 'Bid Preparation' }), MONA, T0), { ok: true }, '[7] staying pre-send is free');
  eq(M.checkGate({ ...b, stage: 'Submitted' }, next({ stage: 'Under Evaluation' }), MONA, T0), { ok: true }, '[7] old sent bids (no approval) are left alone');
  const w = { ...b, approval: M.withdraw(req, MONA, T0) };
  eq(M.checkGate(w, next(), MONA, T0), { ok: false, problem: 'needs-approval' }, '[7] withdrawn → like never asked');

  // manager: never stopped, and the save carries their signature
  const g = M.checkGate(b, next(), TARIQ, T0 + 7);
  ok(g.ok && g.approval && g.approval.status === 'approved', '[7] manager sending unsigned → approval written');
  eq([g.approval.decidedById, g.approval.decidedAt, g.approval.amount], ['u-mgr', T0 + 7, 1200000], '[7] ... by them, now, at the saved price');
  ok(g.approval.log[g.approval.log.length - 1].onSend === true, '[7] ... marked as signed when sending');
  const g2 = M.checkGate(req, next({ estimatedValue: 1250000 }), TARIQ, T0 + 8);
  eq([g2.approval.amount, g2.approval.requestedById], [1250000, 'u-mona'], '[7] manager over a pending request: signs it at the new price, asker kept');
  eq(M.checkGate(ap, next(), TARIQ, T0), { ok: true }, '[7] manager, already approved → nothing extra');
  const g3 = M.checkGate(ret, next(), ADMIN, T0);
  ok(g3.ok && g3.approval.status === 'approved', '[7] admin overrides a return by signing');
}

// ── [8] Managers' queue ─────────────────────────────────────────────────────
{
  const now = new Date(2026, 8, 21, 9, 0).getTime();
  const req = (id, at, extra = {}) => ({ ...bid({ id, serialNumber: 'OP' + id, ownerName: 'Mona Fathy', ...extra }),
    approval: M.requestApproval(bid(extra), MONA, id === 'x1' ? 'look at the discount' : '', at) });
  const list = M.waitingForSignOff([
    req('x1', new Date(2026, 8, 18, 15, 0).getTime()),
    req('x2', new Date(2026, 8, 21, 8, 0).getTime()),
    req('x3', new Date(2026, 8, 20, 23, 0).getTime()),
    { ...req('x4', T0), stage: 'Submitted' },              // already out
    { ...req('x5', T0), stage: 'Lost' },                   // dropped
    { ...bid({ id: 'x6' }) },                             // never asked
    { ...bid({ id: 'x7' }), approval: M.decide(bid(), TARIQ, 'approved', '', T0) },
    { id: '--stats--', value: 4 },
    null,
  ], now);
  eq(list.map(w => w.id), ['x1', 'x3', 'x2'], '[8] only pending pre-send offers, oldest first');
  eq(list.map(w => w.ageDays), [3, 1, 0], '[8] age counted in calendar days');
  eq(list[0].note, 'look at the discount', '[8] note carried');
  eq([list[0].serial, list[0].amount, list[0].currency, list[0].requestedByName], ['OPx1', 1200000, 'EGP', 'Mona Fathy'], '[8] row fields');
  eq(M.waitingForSignOff([], now), [], '[8] empty');
}

// ── [9] History order ───────────────────────────────────────────────────────
{
  const b = bid();
  const r1 = M.requestApproval(b, MONA, '', T0);
  const r2 = M.decide({ ...b, approval: r1 }, TARIQ, 'returned', 'x', T0 + 10);
  const r3 = M.requestApproval({ ...b, approval: r2 }, MONA, '', T0 + 20);
  eq(M.historyNewestFirst(r3).map(e => e.at), [T0 + 20, T0 + 10, T0], '[9] newest first');
  eq(M.historyNewestFirst(undefined), [], '[9] none');
  eq(r3.log.map(e => e.at), [T0, T0 + 10, T0 + 20], '[9] stored oldest first, untouched');
}

// ── [10] firestore.rules mirrors the module ─────────────────────────────────
{
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  ok(/function passesOfferSignOff\(\)/.test(rules), '[10] rule function exists');
  ok(/allow update: if isApproved\(\) && id != '--stats--' && passesOfferSignOff\(\);/.test(rules), '[10] bid updates go through it');
  const list = s => JSON.stringify(s.map(x => `'${x}'`).join(', '));
  ok(rules.includes(`in [${M.PRE_SEND_STAGES.map(x => `'${x}'`).join(', ')}]`), `[10] same pre-send stages ${list(M.PRE_SEND_STAGES)}`);
  ok(rules.includes(`in [${M.GATED_STAGES.map(x => `'${x}'`).join(', ')}]`), `[10] same gated stages ${list(M.GATED_STAGES)}`);
  ok(/request\.resource\.data\.get\('approval', \{\}\)\.get\('status', ''\) != 'approved'/.test(rules), '[10] an employee cannot create a bid "approved"');
  ok(/a\.get\('amount', null\) == after\.get\('estimatedValue', null\)/.test(rules), '[10] rule checks the price too');
}

// ── [11] Locale keys ────────────────────────────────────────────────────────
{
  const en = fs.readFileSync(path.join(ROOT, 'src/locales/en.ts'), 'utf8');
  const ar = fs.readFileSync(path.join(ROOT, 'src/locales/ar.ts'), 'utf8');
  const files = ['src/components/opportunities/OfferApprovalCard.tsx', 'src/OpportunitiesDashboard.tsx', 'src/components/opportunities/OpportunityOutcomeTab.tsx', 'src/components/opportunities/OpportunityFollowUpsTab.tsx'];
  const keys = new Set();
  for (const f of files) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  }
  let n = 0;
  for (const k of keys) {
    const q = JSON.stringify(k) + ':';
    ok(en.includes(q), `[11] en has "${k}"`);
    ok(ar.includes(q), `[11] ar has "${k}"`);
    n++;
  }
  ok(n > 60, `[11] scanned ${n} keys`);
  // the Arabic block: no banned forms, no Latin commas, Latin digits only
  const block = ar.slice(ar.indexOf('Queue D10'));
  const vals = [...block.matchAll(/": "([^"]*)"/g)].map(m => m[1]);
  ok(vals.length >= 50, `[11] Arabic D10 values found (${vals.length})`);
  for (const v of vals) {
    ok(!/(^|\s)(تم|يتم|بواسطة|الخاص ب|القيام ب)/.test(v), `[11] no translationese in «${v}»`);
    ok(!/[؀-ۿ][^{}]*,/.test(v.replace(/\{\{[^}]*\}\}/g, '')), `[11] no Latin comma in «${v}»`);
    ok(!/[٠-٩]/.test(v), `[11] no Arabic-Indic digits in «${v}»`);
  }
}

console.log(`${pass}/${pass + fails.length} passed`);
if (fails.length) { console.log(fails.map(f => '  FAIL ' + f).join('\n')); process.exit(1); }
