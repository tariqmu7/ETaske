// Harness for src/lib/mailSuggest.ts -> the Outlook Feed's suggestions.
//
// Bundles the REAL module with esbuild. Nothing in it touches the network or
// Firebase, so nothing is stubbed except `import.meta.env` (src/utils.ts reads
// it at module load) and localStorage (the handled-mail ledger).
//
//   node scripts/harness/mailsuggest.mjs
//
// Fixtures use RELATIVE dates (dayOffset) — a fixed calendar date would rot.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'mailSuggest.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/mailSuggest.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  logLevel: 'warning',
});

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const M = await import(pathToFileURL(OUT).href);
const {
  cleanSubject, domainOf, detectTenderNumber, detectDeadline, detectParty,
  suggestFromEmail, suggestionsFor, loadMailLedger, markMailHandled, MAIL_LEDGER_KEY,
} = M;

// ── assertions ───────────────────────────────────────────────────────────────
let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const TODAY = new Date(2026, 8, 21); // 21 Sep 2026, local midnight
const at = dayOffset => {
  const d = new Date(TODAY.getTime());
  d.setDate(d.getDate() + dayOffset);
  return d;
};
const isoAt = dayOffset => {
  const d = at(dayOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dmyAt = dayOffset => {
  const d = at(dayOffset);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const PARTIES = [
  { name: 'AGIBA', type: 'opportunity', id: 'op1', label: 'OP000004 · AGIBA workover tender' },
  { name: 'Meleiha', type: 'project', id: 'pr1', label: 'PR000003 · AGIBA Meleiha' },
  { name: 'شركة خالدة للبترول', type: 'project', id: 'pr2', label: 'PR000011 · Khalda' },
];

const CTX = { ownDomain: 'eprom.com.eg', parties: PARTIES, today: TODAY };

const mail = (over = {}) => ({
  id: over.id || 'm1',
  subject: '',
  sender: 'Ahmed Samir',
  sender_email: 'a.samir@agiba.com.eg',
  body_preview: '',
  received_at: at(0).toISOString(),
  importance: 'Normal',
  has_attachments: false,
  attachment_names: [],
  direction: 'received',
  ...over,
});

// ── 1. Subject cleaning ──────────────────────────────────────────────────────
eq(cleanSubject('RE: FW: Tender 123'), 'Tender 123', 'C1 strips stacked RE:/FW:');
eq(cleanSubject('RE: [EXTERNAL] Invitation to bid'), 'Invitation to bid', 'C2 strips the gateway tag');
eq(cleanSubject('  Quarterly report  '), 'Quarterly report', 'C3 trims a plain subject');
eq(cleanSubject('رد: خطاب رقم 55'), 'خطاب رقم 55', 'C4 strips the Arabic reply prefix');
eq(cleanSubject('RE:'), 'RE:', 'C5 never returns an empty title');

// ── 2. Sender domain ─────────────────────────────────────────────────────────
eq(domainOf('a.samir@agiba.com.eg'), 'agiba', 'D1 drops a two-part public suffix');
eq(domainOf('x@eprom.com.eg'), 'eprom', 'D2 own domain');
eq(domainOf('someone@shell.co.uk'), 'shell', 'D3 co.uk');
eq(domainOf('broken-address'), '', 'D4 no @ -> empty');

// ── 3. Tender number ─────────────────────────────────────────────────────────
eq(detectTenderNumber('Tender No. 4600001234 for services'), '4600001234', 'T1 reads a tender number');
eq(detectTenderNumber('RFQ# EG-2026/114 attached'), 'EG-2026/114', 'T2 keeps slashes and dashes');
eq(detectTenderNumber('مناقصة رقم 2026-77'), '2026-77', 'T3 Arabic wording');
eq(detectTenderNumber('Please bid documents required'), undefined, 'T4 a word is not a reference');
eq(detectTenderNumber('Weekly report'), undefined, 'T5 nothing to find');

// ── 4. Deadlines ─────────────────────────────────────────────────────────────
eq(detectDeadline(`Closing date ${isoAt(9)}`, TODAY), isoAt(9), 'L1 ISO date');
eq(detectDeadline(`Offers due by ${dmyAt(12)}`, TODAY), isoAt(12), 'L2 dd/mm/yyyy is read day-first');
eq(detectDeadline('Please reply within 9 days', TODAY), isoAt(9), 'L3 "within N days"');
eq(detectDeadline('برجاء الرد خلال 3 ايام', TODAY), isoAt(3), 'L4 Arabic "within N days"');
eq(detectDeadline('12 October 2026', TODAY), '2026-10-12', 'L5 "12 October 2026"');
eq(detectDeadline('October 12, 2026', TODAY), '2026-10-12', 'L6 "October 12, 2026"');
eq(detectDeadline(`Submitted on ${dmyAt(-40)}`, TODAY), undefined, 'L7 a past date is not a deadline');
eq(detectDeadline('No date here at all', TODAY), undefined, 'L8 nothing to find');

// ── 5. Client detection ──────────────────────────────────────────────────────
{
  const r = detectParty(mail({ subject: 'AGIBA workover scope' }), PARTIES, false);
  eq(r.client, 'AGIBA', 'P1 matches a client already on a board');
  eq(r.match.id, 'op1', 'P2 carries the record it matched');
  eq(r.match.type, 'opportunity', 'P3 and its type');
}
{
  const r = detectParty(mail({ subject: 'Meleiha shutdown plan' }), PARTIES, false);
  eq(r.match.id, 'pr1', 'P4 a project name matches too');
}
{
  const r = detectParty(mail({ subject: 'خطاب من شركة خالدة للبترول' }), PARTIES, false);
  eq(r.match.id, 'pr2', 'P5 Arabic client name matches');
}
{
  const r = detectParty(mail({ subject: 'Quotation', sender_email: 'sales@petrogas.com' }), PARTIES, false);
  eq(r.client, 'PETROGAS', 'P6 unknown outside sender falls back to the domain');
  eq(r.match, undefined, 'P7 …with no record attached');
}
{
  const r = detectParty(mail({ subject: 'Team lunch', sender_email: 'hr@eprom.com.eg' }), PARTIES, true);
  eq(r.client, '', 'P8 internal mail gets no client');
}

// ── 6. Which record the mail should become ───────────────────────────────────
{
  const s = suggestFromEmail(mail({
    id: 'tender',
    subject: 'Invitation to bid — Tender No. 4600001234',
    body_preview: `Kindly submit your technical offer. Closing date ${isoAt(9)}.`,
    has_attachments: true,
    attachment_names: ['ITB.pdf'],
  }), CTX);
  eq(s.kind, 'opportunity', 'K1 a tender from outside becomes a bid');
  eq(s.client, 'AGIBA', 'K2 …with the client filled in');
  eq(s.match.id, 'op1', 'K3 …pointing at the live AGIBA bid');
  eq(s.tenderNumber, '4600001234', 'K4 …and the tender number');
  eq(s.deadline, isoAt(9), 'K5 …and the closing date');
  eq(s.confidence, 'high', 'K6 …at high confidence');
  eq(s.priority, 'Medium', 'K7 nine days out is not urgent yet');
  eq(s.category, 'External', 'K8 category External');
  ok(s.reasons.some(r => r.code === 'tender-words'), 'K9 says why: tender wording');
  ok(s.reasons.some(r => r.code === 'known-client'), 'K10 says why: known client');
  ok(s.reasons.some(r => r.code === 'attachment'), 'K11 says why: attachments');
}
{
  const s = suggestFromEmail(mail({
    id: 'letter',
    subject: 'RE: Official letter — service order 55',
    body_preview: 'Please find our letter attached regarding the service order.',
  }), CTX);
  eq(s.kind, 'corresponding', 'K12 an outside letter becomes a correspondence');
  eq(s.title, 'Official letter — service order 55', 'K13 …under its cleaned subject');
  ok(s.reasons.some(r => r.code === 'letter-words'), 'K14 says why: letter wording');
}
{
  const s = suggestFromEmail(mail({
    id: 'internal',
    subject: 'Please prepare the monthly report',
    sender: 'Nevine',
    sender_email: 'nevine@eprom.com.eg',
    body_preview: 'Kindly send it before the meeting.',
  }), CTX);
  eq(s.kind, 'task', 'K15 a colleague asking for something becomes a task');
  eq(s.category, 'Internal', 'K16 …categorised Internal');
  ok(s.reasons.some(r => r.code === 'internal-sender'), 'K17 says why: from a colleague');
  ok(s.reasons.some(r => r.code === 'action-words'), 'K18 says why: asks for action');
}
{
  const s = suggestFromEmail(mail({
    id: 'urgent',
    subject: 'Bid clarification needed',
    body_preview: `Answers must reach us by ${isoAt(2)}.`,
    importance: 'High',
  }), CTX);
  eq(s.priority, 'Urgent', 'K19 a deadline inside 3 days is Urgent');
  ok(s.reasons.some(r => r.code === 'high-importance'), 'K20 says why: flagged important');
}
{
  const s = suggestFromEmail(mail({
    id: 'soon',
    subject: 'Letter — comments on the contract',
    body_preview: `Please reply by ${isoAt(6)}.`,
  }), CTX);
  eq(s.priority, 'High', 'K21 a deadline inside a week is High');
}
{
  const s = suggestFromEmail(mail({
    id: 'thin',
    subject: 'Hello',
    sender_email: 'someone@unknownco.com',
    body_preview: 'Just saying hello.',
  }), CTX);
  eq(s.confidence, 'low', 'K22 nothing concrete -> low confidence');
  eq(s.kind, 'corresponding', 'K23 …still offered as a correspondence');
}

// ── 7. The queue: what is offered, and in what order ─────────────────────────
{
  const emails = [
    mail({ id: 'a', subject: 'Hello', body_preview: 'nothing here', sender_email: 'x@unknownco.com' }),
    mail({ id: 'b', subject: 'Invitation to tender — AGIBA', body_preview: `Closing ${isoAt(4)}`, has_attachments: true }),
    mail({ id: 'c', subject: 'Tender for Meleiha', body_preview: `Closing ${isoAt(2)}`, has_attachments: true }),
    mail({ id: 'old', subject: 'Old tender', received_at: at(-30).toISOString() }),
    mail({ id: 'mine', subject: 'My reply', direction: 'sent' }),
  ];
  const rows = suggestionsFor(emails, { ...CTX, handled: { a: 'dismissed' } });
  const ids = rows.map(r => r.emailId);
  ok(!ids.includes('a'), 'Q1 a dismissed mail never comes back');
  ok(!ids.includes('old'), 'Q2 mail older than the window is left out');
  ok(!ids.includes('mine'), 'Q3 sent mail is not suggested');
  eq(ids[0], 'c', 'Q4 same confidence -> nearest deadline first');
  eq(ids[1], 'b', 'Q5 …then the later one');
  eq(rows.length, 2, 'Q6 nothing else is offered');

  const capped = suggestionsFor(
    Array.from({ length: 30 }, (_, i) => mail({ id: `x${i}`, subject: 'Letter' })),
    { ...CTX, limit: 5 },
  );
  eq(capped.length, 5, 'Q7 the list is capped');

  const wide = suggestionsFor([mail({ id: 'old2', subject: 'Letter', received_at: at(-30).toISOString() })],
    { ...CTX, windowDays: 60 });
  eq(wide.length, 1, 'Q8 a wider window reaches further back');
}

// ── 8. The handled ledger ────────────────────────────────────────────────────
store.clear();
eq(Object.keys(loadMailLedger()).length, 0, 'G1 empty storage -> empty ledger');
{
  const after = markMailHandled('m1', 'accepted');
  eq(after.m1, 'accepted', 'G2 marks a mail accepted');
  eq(loadMailLedger().m1, 'accepted', 'G3 …and it survives a reload');
  const after2 = markMailHandled('m2', 'dismissed', after);
  eq(Object.keys(after2).length, 2, 'G4 the second mark keeps the first');
  eq(loadMailLedger().m2, 'dismissed', 'G5 dismissal is stored too');
}
store.set(MAIL_LEDGER_KEY, 'not json');
eq(Object.keys(loadMailLedger()).length, 0, 'G6 a corrupt ledger reads as empty, not a crash');
{
  store.clear();
  let led = {};
  for (let i = 0; i < 430; i++) led = markMailHandled(`k${i}`, 'dismissed', led);
  eq(Object.keys(led).length, 400, 'G7 the ledger is trimmed to its cap');
  eq(led.k429, 'dismissed', 'G8 …keeping the newest entry');
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\nmailsuggest: ${pass}/${pass + fails.length} assertions passed`);
if (fails.length) {
  console.error('\nFAILED:');
  fails.forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}
