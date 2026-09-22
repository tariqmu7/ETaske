// Harness for src/lib/mailThreads.ts -> thread grouping + the "nobody replied"
// flag (queue task B2).
//
// Bundles the REAL module with esbuild. Nothing in it touches the network or
// Firebase, so nothing is stubbed except `import.meta.env` (src/utils.ts reads
// it at module load).
//
//   node scripts/harness/mailthreads.mjs
//
// Fixtures use RELATIVE dates (dayOffset) — a fixed calendar date would rot.
// The one exception is the working-day block, which pins real weekdays on
// purpose: the whole point is WHICH day of the week a date falls on.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'mailThreads.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/mailThreads.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  logLevel: 'warning',
});

const M = await import(pathToFileURL(OUT).href);
const {
  workingDaysBetween, threadKeyOf, answersSender, groupThreads, threadIndex,
  threadsAwaitingReply, threadSuggestions, REPLY_DUE_WORKING_DAYS, WAIT_LEDGER_PREFIX,
  threadsAwaitingTheirReply, CHASE_LEDGER_PREFIX, CHASE_DUE_WORKING_DAYS,
} = M;

// ── assertions ───────────────────────────────────────────────────────────────
let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// Monday 21 Sep 2026, local midnight. Egypt's weekend is Friday + Saturday.
const TODAY = new Date(2026, 8, 21);
eq(TODAY.getDay(), 1, 'setup: the fixture "today" is a Monday');

const at = (dayOffset, hour = 9) => {
  const d = new Date(TODAY.getTime());
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const isoAt = (dayOffset, hour = 9) => at(dayOffset, hour).toISOString();

let seq = 0;
const inbox = (over = {}) => ({
  id: `in${++seq}`,
  subject: 'Tender 4412 — workover services',
  sender: 'Ahmed Hassan',
  sender_email: 'a.hassan@agiba.com.eg',
  body_preview: 'Please find attached the invitation to bid.',
  received_at: isoAt(-1),
  direction: 'received',
  ...over,
});
const sent = (over = {}) => ({
  id: `out${++seq}`,
  subject: 'RE: Tender 4412 — workover services',
  sender: 'Tariq',
  sender_email: 'tariq@eprom.com.eg',
  recipients: ['Ahmed Hassan'],
  to: 'Ahmed Hassan',
  body_preview: 'Noted, we will revert.',
  received_at: isoAt(-1, 14),
  direction: 'sent',
  ...over,
});

// ── 1. Working days ──────────────────────────────────────────────────────────
{
  const d = (y, m, day) => new Date(y, m - 1, day);
  eq(workingDaysBetween(d(2026, 9, 21), d(2026, 9, 21)), 0, 'W1 the day it arrived counts as 0');
  eq(workingDaysBetween(d(2026, 9, 21), d(2026, 9, 22)), 1, 'W2 Monday -> Tuesday is 1');
  eq(workingDaysBetween(d(2026, 9, 21), d(2026, 9, 23)), 2, 'W3 Monday -> Wednesday is 2');
  // 24 Sep 2026 is a Thursday; 25th Friday and 26th Saturday are the weekend.
  eq(d(2026, 9, 24).getDay(), 4, 'W4 24 Sep 2026 is a Thursday');
  eq(workingDaysBetween(d(2026, 9, 24), d(2026, 9, 26)), 0, 'W5 Thursday -> Saturday is still 0 (weekend)');
  eq(workingDaysBetween(d(2026, 9, 24), d(2026, 9, 27)), 1, 'W6 …Sunday makes it 1');
  eq(workingDaysBetween(d(2026, 9, 24), d(2026, 9, 28)), 2, 'W7 …Monday makes it 2 — the flag day');
  eq(workingDaysBetween(d(2026, 9, 28), d(2026, 9, 21)), 0, 'W8 a date in the future is never negative');
  eq(workingDaysBetween(new Date('nonsense'), d(2026, 9, 21)), 0, 'W9 an unreadable date is 0, not a crash');
  // With a Sunday/Saturday weekend instead, only the Friday counts.
  eq(workingDaysBetween(d(2026, 9, 24), d(2026, 9, 27), [0, 6]), 1, 'W10 the weekend is configurable');
  eq(REPLY_DUE_WORKING_DAYS, 2, 'W11 the rule is two working days');
}

// ── 2. Thread keys ───────────────────────────────────────────────────────────
{
  const a = threadKeyOf(inbox({ subject: 'Tender 4412' }));
  eq(threadKeyOf(inbox({ subject: 'RE: Tender 4412' })), a, 'K1 RE: keys with the original');
  eq(threadKeyOf(inbox({ subject: 'FW: [EXTERNAL] Tender 4412' })), a, 'K2 …and so does a tagged forward');
  eq(threadKeyOf(inbox({ subject: 'RE: RE: Tender  4412 ' })), a, 'K3 …repeated prefixes and stray spacing too');
  eq(threadKeyOf(inbox({ subject: 'Tender 4412.' })), a, 'K4 …and trailing punctuation');
  ok(threadKeyOf(inbox({ subject: 'Tender 4413' })) !== a, 'K5 a different tender is a different thread');
  eq(threadKeyOf(inbox({ subject: 'مناقصة الحفر' })), threadKeyOf(inbox({ subject: 'رد: مناقصه الحفر' })),
    'K6 an Arabic subject keys past رد: and ة/ه');
  const short = threadKeyOf(inbox({ id: 'z1', subject: 'Hi' }));
  eq(short, '#z1', 'K7 a subject too short to be distinctive stands alone');
  eq(threadKeyOf(inbox({ id: 'z2', subject: '' })), '#z2', 'K8 …and so does an empty one');
}

// ── 3. Did we actually answer them? ──────────────────────────────────────────
{
  const them = inbox({ sender: 'Ahmed Hassan', sender_email: 'a.hassan@agiba.com.eg' });
  ok(answersSender(sent({ recipients: ['Ahmed Hassan'] }), them), 'A1 a reply to the sender answers');
  ok(answersSender(sent({ recipients: ['Mona Said', 'Ahmed Hassan'] }), them), 'A2 …even among other recipients');
  ok(answersSender(sent({ recipients: ['a.hassan@agiba.com.eg'] }), them), 'A3 …by address as well as by name');
  ok(!answersSender(sent({ recipients: ['Sara Fouad'] }), them), 'A4 a mail to somebody else does not');
  ok(answersSender(sent({ recipients: [], to: '' }), them), 'A5 with no recipients at all we stay quiet');
  ok(answersSender(sent({ recipients: [], to: 'Ahmed Hassan' }), them), 'A6 the flat To: line is read too');
}

// ── 4. Grouping ──────────────────────────────────────────────────────────────
{
  const rows = [
    inbox({ id: 'm1', subject: 'Tender 4412', received_at: isoAt(-5) }),
    sent({ id: 'm2', subject: 'RE: Tender 4412', received_at: isoAt(-4) }),
    inbox({ id: 'm3', subject: 'RE: RE: Tender 4412', received_at: isoAt(-3) }),
    inbox({ id: 'm4', subject: 'Invoice 9981', received_at: isoAt(-2) }),
  ];
  const threads = groupThreads(rows, { today: TODAY });
  eq(threads.length, 2, 'T1 four messages make two threads');
  const tender = threads.find(t => t.title.includes('4412'));
  eq(tender.count, 3, 'T2 the chain holds all three of its messages');
  eq(tender.title, 'Tender 4412', 'T3 the title is the first subject, cleaned');
  eq(tender.first.id, 'm1', 'T4 messages are ordered oldest first');
  eq(tender.last.id, 'm3', 'T5 …newest last');
  eq(tender.lastIncoming.id, 'm3', 'T6 the newest incoming message speaks for it');
  eq(tender.lastOutgoing.id, 'm2', 'T7 …and the last thing we sent is known');
  eq(tender.counterparty, 'Ahmed Hassan', 'T8 the chain names who it is with');
  eq(threads[0].title, 'Invoice 9981', 'T9 the most recently active thread is first');

  const dupes = groupThreads([rows[0], rows[0], rows[1]], { today: TODAY });
  eq(dupes[0].count, 2, 'T10 the same message fetched twice is counted once');

  const idx = threadIndex(threads);
  eq(idx.m2.key, tender.key, 'T11 every message points back at its thread');
  eq(Object.keys(idx).length, 4, 'T12 …all four of them');
}

// ── 5. The "nobody replied" flag ─────────────────────────────────────────────
{
  // Came in last Monday (7 days back), nothing sent since -> 5 working days.
  const stale = groupThreads([inbox({ id: 's1', subject: 'Tender 4412', received_at: isoAt(-7) })],
    { today: TODAY })[0];
  ok(stale.awaitingReply, 'F1 an unanswered mail is awaiting a reply');
  eq(stale.waitingDays, 5, 'F2 …counted in working days, not calendar days');
  ok(stale.overdue, 'F3 …and past two working days it is flagged');

  const answered = groupThreads([
    inbox({ id: 's2', subject: 'Tender 4412', received_at: isoAt(-7) }),
    sent({ id: 's3', subject: 'RE: Tender 4412', received_at: isoAt(-6) }),
  ], { today: TODAY })[0];
  ok(!answered.awaitingReply, 'F4 a reply clears the flag');
  eq(answered.waitingDays, 0, 'F5 …and the wait goes back to zero');

  const reopened = groupThreads([
    inbox({ id: 's4', subject: 'Tender 4412', received_at: isoAt(-7) }),
    sent({ id: 's5', subject: 'RE: Tender 4412', received_at: isoAt(-6) }),
    inbox({ id: 's6', subject: 'RE: Tender 4412', received_at: isoAt(-5) }),
  ], { today: TODAY })[0];
  ok(reopened.awaitingReply, 'F6 …until they write again');
  eq(reopened.waitingDays, 3, 'F7 …and the clock restarts from THAT mail');

  const wrongPerson = groupThreads([
    inbox({ id: 's7', subject: 'Monthly report', sender: 'Ahmed Hassan', received_at: isoAt(-7) }),
    sent({ id: 's8', subject: 'RE: Monthly report', recipients: ['Sara Fouad'], to: 'Sara Fouad', received_at: isoAt(-6) }),
  ], { today: TODAY })[0];
  ok(wrongPerson.awaitingReply, 'F8 a same-subject mail to somebody else does NOT clear it');

  const fresh = groupThreads([inbox({ id: 's9', subject: 'Tender 4412', received_at: isoAt(-1) })],
    { today: TODAY })[0];
  ok(fresh.awaitingReply, 'F9 yesterday\'s mail is unanswered…');
  ok(!fresh.overdue, 'F10 …but one working day is not yet a flag');

  const ours = groupThreads([sent({ id: 's10', subject: 'Our offer', received_at: isoAt(-9) })],
    { today: TODAY })[0];
  ok(!ours.awaitingReply, 'F11 a chain WE started is not waiting on us');

  const strict = groupThreads([inbox({ id: 's11', subject: 'Tender 4412', received_at: isoAt(-3) })],
    { today: TODAY, replyDueDays: 5 })[0];
  ok(!strict.overdue, 'F12 the two-day rule can be relaxed');
}

// ── 6. The chase list ────────────────────────────────────────────────────────
{
  const threads = groupThreads([
    inbox({ id: 'c1', subject: 'Tender 4412', received_at: isoAt(-3) }),   // 2 working days
    inbox({ id: 'c2', subject: 'Invoice 9981', received_at: isoAt(-9) }),  // 6 working days
    inbox({ id: 'c3', subject: 'Site visit plan', received_at: isoAt(-1) }), // not yet due
  ], { today: TODAY });

  const rows = threadsAwaitingReply(threads);
  eq(rows.length, 2, 'C1 only the overdue chains are chased');
  eq(rows[0].title, 'Invoice 9981', 'C2 the longest wait comes first');
  eq(rows[1].title, 'Tender 4412', 'C3 …then the shorter one');

  const quiet = threadsAwaitingReply(threads, { [WAIT_LEDGER_PREFIX + rows[0].key]: 'dismissed' });
  eq(quiet.length, 1, 'C4 a row waved away stays away');
  eq(quiet[0].title, 'Tender 4412', 'C5 …and only that one');

  // A dismissed SUGGESTION must not silence the flag — they are separate ledger keys.
  const stillFlagged = threadsAwaitingReply(threads, { [rows[0].key]: 'dismissed' });
  eq(stillFlagged.length, 2, 'C6 dismissing the suggestion does not stop the chasing');

  eq(threadsAwaitingReply(threads, {}, 1).length, 1, 'C7 the chase list is capped');
}

// ── 6b. The mirror: THEY have not replied (queue task B4) ────────────────────
{
  const threads = groupThreads([
    // We answered them 9 days ago (a Saturday) and nothing has come back — 7 working days.
    inbox({ id: 'm1', subject: 'Price revision', received_at: isoAt(-12) }),
    sent({ id: 'm2', subject: 'RE: Price revision', received_at: isoAt(-9) }),
    // Answered yesterday — too soon to chase anybody.
    inbox({ id: 'm3', subject: 'Site access', received_at: isoAt(-3) }),
    sent({ id: 'm4', subject: 'RE: Site access', received_at: isoAt(-1) }),
    // Their letter is the newest one: that is OUR debt, not theirs.
    inbox({ id: 'm5', subject: 'Invoice 9981', received_at: isoAt(-9) }),
    // A mail we sent into the blue, with nothing incoming behind it.
    sent({ id: 'm6', subject: 'Company profile 2026', received_at: isoAt(-20) }),
  ], { today: TODAY });

  const byTitle = title => threads.find(th => th.title === title);
  eq(byTitle('Price revision').awaitingTheirReply, true, 'B1 we wrote last and they went quiet');
  eq(byTitle('Price revision').theirWaitingDays, 7, 'B2 …measured in working days');
  eq(byTitle('Price revision').theirOverdue, true, 'B3 …and it has passed the chase threshold');
  eq(byTitle('Price revision').awaitingReply, false, 'B4 …while we owe them nothing ourselves');
  eq(byTitle('Site access').awaitingTheirReply, true, 'B5 a fresh answer is still awaiting theirs');
  eq(byTitle('Site access').theirOverdue, false, 'B6 …but nobody is chased after one day');
  eq(byTitle('Invoice 9981').awaitingTheirReply, false, 'B7 their unanswered letter is our debt, not theirs');
  eq(byTitle('Invoice 9981').awaitingReply, true, 'B8 …and it stays on the other list');
  eq(byTitle('Company profile 2026').awaitingTheirReply, false,
    'B9 a mail sent into the blue is not somebody failing to answer');

  const rows = threadsAwaitingTheirReply(threads);
  eq(rows.length, 1, 'B10 only the overdue silence is offered a letter');
  eq(rows[0].title, 'Price revision', 'B11 …the right one');

  const quiet = threadsAwaitingTheirReply(threads, { [CHASE_LEDGER_PREFIX + rows[0].key]: 'dismissed' });
  eq(quiet.length, 0, 'B12 a row waved away stays away');

  // The two chase lists have separate ledger prefixes, so waving one away must
  // not silence the other.
  eq(threadsAwaitingTheirReply(threads, { [WAIT_LEDGER_PREFIX + rows[0].key]: 'dismissed' }).length, 1,
    'B13 the two chase lists are dismissed independently');
  eq(threadsAwaitingReply(threads, { [CHASE_LEDGER_PREFIX + 'invoice 9981']: 'dismissed' }).length, 1,
    'B14 …in both directions');

  eq(threadsAwaitingTheirReply(threads, {}, 0).length, 0, 'B15 the list is capped');
}

// ── 7. One suggestion per thread ─────────────────────────────────────────────
{
  const CTX = {
    ownDomain: 'eprom.com.eg',
    parties: [{ name: 'AGIBA', type: 'opportunity', id: 'op1', label: 'OP000004 · AGIBA workover' }],
    today: TODAY,
  };
  const chain = [
    inbox({ id: 'p1', subject: 'AGIBA tender 4412', received_at: isoAt(-4) }),
    sent({ id: 'p2', subject: 'RE: AGIBA tender 4412', received_at: isoAt(-3) }),
    inbox({ id: 'p3', subject: 'RE: RE: AGIBA tender 4412', received_at: isoAt(-2) }),
  ];
  const threads = groupThreads(chain, { today: TODAY });
  const rows = threadSuggestions(threads, CTX);
  eq(rows.length, 1, 'S1 a three-message chain offers ONE record, not three');
  eq(rows[0].emailId, 'p3', 'S2 …built from the newest incoming message');
  eq(rows[0].threadCount, 3, 'S3 …and it says how long the chain is');
  eq(rows[0].kind, 'opportunity', 'S4 the suggestion engine still decides the kind');
  eq(rows[0].client, 'AGIBA', 'S5 …and still matches the client');
  ok(rows[0].awaitingReply, 'S6 the card knows nobody has replied');

  const settled = threadSuggestions(threads, { ...CTX, handled: { [rows[0].threadKey]: 'accepted' } });
  eq(settled.length, 0, 'S7 accepting the thread settles the whole chain');

  // A ledger written before B2 filed entries per MESSAGE — those still count.
  const legacy = threadSuggestions(threads, { ...CTX, handled: { p3: 'dismissed' } });
  eq(legacy.length, 0, 'S8 an old per-message ledger entry is still honoured');

  const ourOwn = threadSuggestions(groupThreads([sent({ id: 'p4', subject: 'Our offer to AGIBA' })], { today: TODAY }), CTX);
  eq(ourOwn.length, 0, 'S9 a chain we started is not suggested back to us');

  const old = threadSuggestions(
    groupThreads([inbox({ id: 'p5', subject: 'Old letter', received_at: isoAt(-30) })], { today: TODAY }),
    CTX,
  );
  eq(old.length, 0, 'S10 mail outside the window is left alone');
  eq(threadSuggestions(
    groupThreads([inbox({ id: 'p6', subject: 'Old letter', received_at: isoAt(-30) })], { today: TODAY }),
    { ...CTX, windowDays: 60 },
  ).length, 1, 'S11 …unless the window is widened');

  const many = groupThreads(
    Array.from({ length: 20 }, (_, i) => inbox({ id: `q${i}`, subject: `Letter ${i} about something` })),
    { today: TODAY },
  );
  eq(threadSuggestions(many, { ...CTX, limit: 5 }).length, 5, 'S12 the list is capped');

  // Order: the surest card first, exactly as the per-message queue sorted them.
  const mixed = groupThreads([
    inbox({ id: 'r1', subject: 'Just a note about the weather', received_at: isoAt(-1) }),
    inbox({ id: 'r2', subject: 'AGIBA tender 4412 closing 30/09/2026', received_at: isoAt(-1) }),
  ], { today: TODAY });
  const ordered = threadSuggestions(mixed, CTX);
  eq(ordered[0].emailId, 'r2', 'S13 the strongest match is offered first');
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\nmailthreads: ${pass}/${pass + fails.length} assertions passed`);
if (fails.length) {
  console.error('\nFAILED:');
  fails.forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}
