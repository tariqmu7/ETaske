// Harness for queue task C2 — Arabic voice note -> task.
//
// Bundles the REAL src/lib/dictation.ts (stitching the recogniser's pieces)
// and the REAL src/lib/quickCapture.ts (reading what was said), with esbuild.
// No microphone, no network: the input is what a browser's recogniser writes
// for Egyptian speech — no punctuation, numbers as words, «يوم الحد».
//
//   node scripts/harness/voicenote.mjs
//
// `today` is injected and every expected date is computed from it; each
// weekday case runs from all seven starting days.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'voicenote.bundle.mjs');

await build({
  stdin: {
    contents: `export * from './src/lib/dictation'; export { readCapture, readDate, spokenNumbers } from './src/lib/quickCapture';`,
    resolveDir: ROOT,
    sourcefile: 'voicenoteEntry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  logLevel: 'warning',
});

const {
  readCapture, readDate, spokenNumbers,
  joinSegments, tidySpoken, withSpoken, classifyError, initialLang,
} = await import(pathToFileURL(OUT).href);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const BASE = new Date(2026, 8, 21); // a Monday
const shift = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const off = (today, n) => iso(shift(today, n));
const nextDow = (today, dow) => off(today, ((dow - today.getDay() + 7) % 7) || 7);
const WEEK = [0, 1, 2, 3, 4, 5, 6].map(n => shift(BASE, n));
/** The next time day/month comes round from `today` (this year, else next). */
const nextDM = (today, dd, mm) => {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let d = new Date(t0.getFullYear(), mm - 1, dd);
  if (d < t0) d = new Date(t0.getFullYear() + 1, mm - 1, dd);
  return iso(d);
};

const ME = { id: 'u-me', name: 'Tariq Mohamed' };
const PEOPLE = [
  ME,
  { id: 'u-ahmed', name: 'Ahmed Samir' },
  { id: 'u-mona', name: 'Mona Fathy' },
  { id: 'u-sara', name: 'سارة عبد الله' },
];
const PARTIES = [
  { name: 'Petrojet', type: 'opportunity', id: 'op-1', label: 'OP000012 · Algeria pipeline offer' },
  { name: 'بتروجت', type: 'opportunity', id: 'op-1', label: 'OP000012 · Algeria pipeline offer' },
  { name: 'AGIBA', type: 'project', id: 'pr-1', label: 'P000003 · Meleiha tanks' },
];
const ctx = (today = BASE) => ({ me: ME, people: PEOPLE, parties: PARTIES, ownDomain: 'eprom.com.eg', today });
const date = (text, today = BASE) => readDate(text, today)?.date;

// ── 1. Spoken numbers (private copy only) ───────────────────────────────────
eq(spokenNumbers('خمسه'), '5', 'number: خمسه');
eq(spokenNumbers('تلاتين'), '30', 'number: تلاتين');
eq(spokenNumbers('خمسه وعشرين'), '25', 'number: خمسه وعشرين (compound)');
eq(spokenNumbers('واحد وتلاتين'), '31', 'number: واحد وتلاتين');
eq(spokenNumbers('حداشر'), '11', 'number: حداشر (Egyptian 11)');
eq(spokenNumbers('خمسه عشر'), '15', 'number: خمسه عشر (MSA 15)');
eq(spokenNumbers('عشرين'), '20', 'number: عشرين, not عشر + ين');
eq(spokenNumbers('الخامس'), '5', 'number: ordinal الخامس');
eq(spokenNumbers('اول'), '1', 'number: اول');
eq(spokenNumbers('الاتنين'), 'الاتنين', 'number: «الاتنين» (Monday) left alone');
eq(spokenNumbers('التلات'), 'التلات', 'number: «التلات» (Tuesday) left alone');
eq(spokenNumbers('سبتمبر'), 'سبتمبر', 'number: a month is not «سبع»');

// ── 2. Dates as they are spoken ─────────────────────────────────────────────
eq(date('ابعت العرض يوم خمسة أكتوبر'), nextDM(BASE, 5, 10), 'date: «خمسة أكتوبر»');
eq(date('الخامس من أكتوبر'), nextDM(BASE, 5, 10), 'date: «الخامس من أكتوبر»');
eq(date('أول نوفمبر'), nextDM(BASE, 1, 11), 'date: «أول نوفمبر»');
eq(date('٥ أكتوبر'), nextDM(BASE, 5, 10), 'date: «٥ أكتوبر» (Arabic digits, typed)');
eq(date('خمسة وعشرين أكتوبر'), nextDM(BASE, 25, 10), 'date: «خمسة وعشرين أكتوبر»');
eq(date('5 شهر أكتوبر'), nextDM(BASE, 5, 10), 'date: «5 شهر أكتوبر»');
eq(date('خمسة شهر عشرة'), nextDM(BASE, 5, 10), 'date: «خمسة شهر عشرة»');
eq(date('التسليم يوم تلاتين تسعة'), nextDM(BASE, 30, 9), 'date: «يوم تلاتين تسعة» = 30/9');
eq(date('10 سبتمبر'), '2027-09-10', 'date: a day already gone this year = next year');
eq(date('15 يناير 2027'), '2027-01-15', 'date: with a year');
eq(date('يوم خمسة أكتوبر سنة 2027'), '2027-10-05', 'date: «سنة 2027»');
ok(date('5 أكتوبر 2025') !== '2025-10-05', 'date: a past date WITH its year is not a deadline');
eq(date('31 سبتمبر'), undefined, 'date: 31 September does not exist');

eq(date('بعد تلات أيام'), off(BASE, 3), 'date: «بعد تلات أيام»');
eq(date('خلال عشرة أيام'), off(BASE, 10), 'date: «خلال عشرة أيام»');
eq(date('بعد يومين'), off(BASE, 2), 'date: «بعد يومين»');
eq(date('خلال أسبوع'), off(BASE, 7), 'date: «خلال أسبوع»');
eq(date('بعد أسبوع من الاستلام'), undefined, 'date: «بعد أسبوع من …» is not a week from today');

for (const today of WEEK) {
  const d = today.getDay();
  eq(date('يوم الحد', today), nextDow(today, 0), `date: «يوم الحد» from day ${d}`);
  eq(date('التلات الجاي', today), nextDow(today, 2), `date: «التلات الجاي» from day ${d}`);
  eq(date('يوم الاتنين', today), nextDow(today, 1), `date: «يوم الاتنين» from day ${d}`);
  eq(date('يوم الأربع', today), nextDow(today, 3), `date: «يوم الأربع» from day ${d}`);
  eq(date('للحد الجاي', today), nextDow(today, 0), `date: «للحد الجاي» from day ${d}`);
}
eq(date('يوم الاثنين'), nextDow(BASE, 1), 'date: MSA «الاثنين» still reads');

// …and the same words when they are NOT days.
eq(date('راجع الحد الأدنى للأسعار'), undefined, 'not a date: «الحد الأدنى»');
eq(date('التلات عروض جاهزين'), undefined, 'not a date: «التلات عروض»');
eq(date('الاتنين هيروحوا الموقع'), undefined, 'not a date: «الاتنين هيروحوا»');
eq(date('عندنا ست مناقصات'), undefined, 'not a date: «ست مناقصات»');

// ── 3. Whole voice notes → proposals ────────────────────────────────────────
{
  const p = readCapture('خلي أحمد يبعت الأسعار لبتروجت يوم الحد', ctx());
  eq(p.kind, 'task', 'note 1: kind');
  eq(p.owner.id, 'u-ahmed', 'note 1: owner = Ahmed («خلي أحمد يبعت»)');
  eq(p.date, nextDow(BASE, 0), 'note 1: date = next Sunday');
  eq(p.match?.id, 'op-1', 'note 1: linked to the Petrojet bid');
  eq(p.description, 'خلي أحمد يبعت الأسعار لبتروجت يوم الحد', 'note 1: what was said is kept word for word');
}
{
  const p = readCapture('فكرني أكلم أجيبا بكرة', ctx());
  eq(p.owner.id, 'u-me', 'note 2: «فكرني» = me');
  ok(p.reasons.some(r => r.code === 'owner-me'), 'note 2: owner-me reason');
  eq(p.date, off(BASE, 1), 'note 2: tomorrow');
}
{
  const p = readCapture('منى تراجع العقد خمسة وعشرين أكتوبر عاجل', ctx());
  eq(p.owner.id, 'u-mona', 'note 3: owner = Mona');
  eq(p.date, nextDM(BASE, 25, 10), 'note 3: 25 October');
  eq(p.priority, 'High', 'note 3: «عاجل» a month out = High');
}
{
  const p = readCapture('هكلم سارة بخصوص مناقصة بتروجت الجديدة الخميس', ctx());
  eq(p.kind, 'opportunity', 'note 4: a new tender = bid');
  eq(p.owner.id, 'u-me', 'note 4: «هكلم» = me, Sara is only mentioned');
  eq(p.date, nextDow(BASE, 4), 'note 4: Thursday');
}
{
  const p = readCapture('Ahmed to send the prices to Petrojet by Tuesday', ctx());
  eq(p.owner.id, 'u-ahmed', 'note 5 (English voice): owner');
  eq(p.date, nextDow(BASE, 2), 'note 5 (English voice): Tuesday');
}

// ── 4. Stitching the recogniser's pieces ────────────────────────────────────
eq(joinSegments(['ابعت العرض', 'لبتروجت بكرة']), 'ابعت العرض لبتروجت بكرة', 'join: desktop pieces are appended');
eq(joinSegments(['ابعت', 'ابعت العرض', 'ابعت العرض لبتروجت']), 'ابعت العرض لبتروجت', 'join: Android cumulative pieces are not repeated');
eq(joinSegments(['ابعت العرض', 'ابعت العرض']), 'ابعت العرض', 'join: an identical piece is dropped');
eq(joinSegments(['ابعت العرض لبتروجت', 'لبتروجت']), 'ابعت العرض لبتروجت', 'join: a trailing echo is dropped');
eq(joinSegments(['', '  ', 'بكرة']), 'بكرة', 'join: empty pieces skipped');
eq(joinSegments([]), '', 'join: nothing said');
eq(tidySpoken('اممم ابعت um العرض'), 'ابعت العرض', 'tidy: hesitation sounds dropped');
eq(tidySpoken('العرض أم الخطاب'), 'العرض أم الخطاب', 'tidy: «أم» (or) kept');
eq(tidySpoken('اه ابعته'), 'اه ابعته', 'tidy: «اه» (yes) kept');
eq(tidySpoken('  ابعت   العرض ، بكرة '), 'ابعت العرض، بكرة', 'tidy: spaces');
eq(withSpoken('', 'بكرة'), 'بكرة', 'with: empty box');
eq(withSpoken('Petrojet offer ', 'بكرة'), 'Petrojet offer بكرة', 'with: added after what was typed');
eq(withSpoken('From: x\nSubject: y', 'Ahmed to reply'), 'From: x\nSubject: y\nAhmed to reply', 'with: after a pasted mail, on a new line');
eq(withSpoken('typed', ''), 'typed', 'with: nothing said keeps the box');

// ── 5. Errors and the starting language ─────────────────────────────────────
eq(classifyError('not-allowed'), 'blocked', 'error: not-allowed');
eq(classifyError('service-not-allowed'), 'blocked', 'error: service-not-allowed');
eq(classifyError('no-speech'), 'no-speech', 'error: no-speech');
eq(classifyError('network'), 'network', 'error: network');
eq(classifyError('audio-capture'), 'no-mic', 'error: audio-capture');
eq(classifyError('language-not-supported'), 'failed', 'error: anything else');
eq(classifyError(undefined), 'failed', 'error: none given');
eq(initialLang(null), 'ar-EG', 'lang: Arabic by default');
eq(initialLang('en-US'), 'en-US', 'lang: remembers English');
eq(initialLang('fr-FR'), 'ar-EG', 'lang: junk in storage = Arabic');

if (fails.length) {
  console.log(fails.map(f => `  FAIL ${f}`).join('\n'));
  console.log(`\nvoicenote: ${pass}/${pass + fails.length} passed — ${fails.length} FAILED`);
  process.exit(1);
}
console.log(`voicenote: all ${pass} assertions passed`);
