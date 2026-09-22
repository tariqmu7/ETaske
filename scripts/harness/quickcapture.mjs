// Harness for src/lib/quickCapture.ts -> the one-box capture on Home (queue C1).
//
// Bundles the REAL module (and the mailSuggest.ts it builds on) with esbuild.
// Nothing touches the network or Firebase; only `import.meta.env` is stubbed.
//
//   node scripts/harness/quickcapture.mjs
//
// `today` is injected, and every expected date is computed from it (dayOffset /
// nextDow), so the fixtures do not rot with the calendar. Each weekday case is
// run from all seven starting days.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'quickCapture.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/quickCapture.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  logLevel: 'warning',
});

const { readCapture, readDate, findPeople, parsePastedEmail, latinDigits, titleFrom } =
  await import(pathToFileURL(OUT).href);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const BASE = new Date(2026, 8, 21); // a Monday; every expectation is relative to it
const shift = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const off = (today, n) => iso(shift(today, n));
/** The NEXT given weekday after `today` (never today itself). */
const nextDow = (today, dow) => off(today, ((dow - today.getDay() + 7) % 7) || 7);

const ME = { id: 'u-me', name: 'Tariq Mohamed' };
const PEOPLE = [
  ME,
  { id: 'u-ahmed', name: 'Ahmed Samir' },
  { id: 'u-mona', name: 'Mona Fathy' },
  { id: 'u-sara', name: 'سارة عبد الله' },
  { id: 'u-mah1', name: 'Mahmoud Ali' },
  { id: 'u-mah2', name: 'Mahmoud Kamal' },
];
const PARTIES = [
  { name: 'Petrojet', type: 'opportunity', id: 'op-1', label: 'OP000012 · Algeria pipeline offer' },
  { name: 'AGIBA', type: 'project', id: 'pr-1', label: 'P000003 · Meleiha tanks' },
  { name: 'Meleiha', type: 'project', id: 'pr-1', label: 'P000003 · Meleiha tanks' },
  { name: 'بتروجت', type: 'opportunity', id: 'op-1', label: 'OP000012 · Algeria pipeline offer' },
];
const ctx = (today = BASE, extra = {}) => ({ me: ME, people: PEOPLE, parties: PARTIES, ownDomain: 'eprom.com.eg', today, ...extra });

// ── 1. The example from the queue ───────────────────────────────────────────
{
  const p = readCapture('meeting with Petrojet Tuesday about the Algeria offer, Ahmed to send prices', ctx());
  eq(p.source, 'sentence', 'example: source');
  eq(p.kind, 'task', 'example: kind');
  eq(p.owner.id, 'u-ahmed', 'example: owner = Ahmed ("Ahmed to send")');
  eq(p.date, nextDow(BASE, 2), 'example: date = next Tuesday');
  eq(p.match?.id, 'op-1', 'example: linked to the Petrojet bid');
  eq(p.match?.type, 'opportunity', 'example: link type');
  eq(p.client, 'Petrojet', 'example: client');
  ok(p.reasons.some(r => r.code === 'owner-named' && r.value === 'Ahmed Samir'), 'example: owner-named reason');
  ok(p.reasons.some(r => r.code === 'date' && /tuesday/i.test(r.value)), 'example: date reason quotes the words');
  ok(p.reasons.some(r => r.code === 'known-client'), 'example: known-client reason');
  eq(p.description, 'meeting with Petrojet Tuesday about the Algeria offer, Ahmed to send prices', 'example: description keeps the text');
  ok(p.title.startsWith('Meeting with Petrojet'), 'example: title capitalised');
}

// ── 2. Weekdays, from every starting day ────────────────────────────────────
const EN = [['sunday', 0], ['Mon', 1], ['tuesday', 2], ['Wed', 3], ['thursday', 4], ['friday', 5], ['Sat', 6]];
const AR = [['الأحد', 0], ['الاثنين', 1], ['الثلاثاء', 2], ['الأربعاء', 3], ['الخميس', 4], ['الجمعة', 5], ['السبت', 6]];
for (let s = 0; s < 7; s++) {
  const today = shift(BASE, s);
  for (const [w, dow] of EN) eq(readDate(`call them ${w}`, today)?.date, nextDow(today, dow), `EN weekday "${w}" from dow ${today.getDay()}`);
  for (const [w, dow] of AR) eq(readDate(`اجتماع ${w}`, today)?.date, nextDow(today, dow), `AR weekday "${w}" from dow ${today.getDay()}`);
  eq(readDate('أجّل للأحد', today)?.date, nextDow(today, 0), `AR «للأحد» from dow ${today.getDay()}`);
  eq(readDate('يوم الخميس إن شاء الله', today)?.date, nextDow(today, 4), `AR «يوم الخميس» from dow ${today.getDay()}`);
  eq(readDate('by next Thu', today)?.date, nextDow(today, 4), `"next Thu" from dow ${today.getDay()}`);
}
// A weekday on that very day means a week today.
eq(readDate('monday', BASE)?.date, off(BASE, 7), 'Monday said on a Monday = +7');

// ── 3. Relative words ───────────────────────────────────────────────────────
eq(readDate('send it today', BASE)?.date, off(BASE, 0), 'today');
eq(readDate('by EOD', BASE)?.date, off(BASE, 0), 'EOD');
eq(readDate('tomorrow please', BASE)?.date, off(BASE, 1), 'tomorrow');
eq(readDate('day after tomorrow', BASE)?.date, off(BASE, 2), 'day after tomorrow beats tomorrow');
eq(readDate('بكرة الصبح', BASE)?.date, off(BASE, 1), '«بكرة»');
eq(readDate('غداً', BASE)?.date, off(BASE, 1), '«غداً» (with tanween)');
eq(readDate('بعد بكرة', BASE)?.date, off(BASE, 2), '«بعد بكرة»');
eq(readDate('النهارده', BASE)?.date, off(BASE, 0), '«النهارده»');
eq(readDate('in 3 days', BASE)?.date, off(BASE, 3), 'in 3 days');
eq(readDate('within 2 weeks', BASE)?.date, off(BASE, 14), 'within 2 weeks');
eq(readDate('بعد ٣ أيام', BASE)?.date, off(BASE, 3), '«بعد ٣ أيام» (Arabic digits)');
eq(readDate('خلال أسبوعين', BASE)?.date, off(BASE, 14), '«خلال أسبوعين»');
eq(readDate('next week', BASE)?.date, nextDow(BASE, 0), 'next week = coming Sunday');
eq(readDate('الأسبوع الجاي', BASE)?.date, nextDow(BASE, 0), '«الأسبوع الجاي»');
eq(readDate('end of the week', BASE)?.date, nextDow(BASE, 4), 'end of week = Thursday');
eq(readDate('end of the week', shift(BASE, 3))?.date, off(shift(BASE, 3), 0), 'end of week said on Thursday = today');
eq(readDate('آخر الأسبوع', BASE)?.date, nextDow(BASE, 4), '«آخر الأسبوع»');

// ── 4. Dates without a year / with a year ───────────────────────────────────
eq(readDate('submit 30/9', BASE)?.date, `${BASE.getFullYear()}-09-30`, '30/9 this year');
eq(readDate('submit 1/9', BASE)?.date, `${BASE.getFullYear() + 1}-09-01`, '1/9 already gone → next year');
eq(readDate('«٣٠/٩»', BASE)?.date, `${BASE.getFullYear()}-09-30`, 'Arabic-digit 30/9');
eq(readDate('by 5 Oct', BASE)?.date, `${BASE.getFullYear()}-10-05`, '5 Oct');
eq(readDate('Oct 12 latest', BASE)?.date, `${BASE.getFullYear()}-10-12`, 'Oct 12');
eq(readDate('closing 12/10/2026', BASE)?.date, '2026-10-12', 'full dd/mm/yyyy via mail reader');
eq(readDate('32/9', BASE), undefined, 'no 32/9');
eq(readDate('price is 2.5 million', BASE), undefined, 'a decimal is not a date');
eq(readDate('3 days of work', BASE), undefined, '"3 days" alone is not a date');
eq(readDate('the monthly report', BASE), undefined, '"monthly" is not Monday');
eq(readDate('nothing here', BASE), undefined, 'no date');
eq(readDate('call Tuesday then send Thursday', BASE)?.date, nextDow(BASE, 2), 'first date in the text wins');
eq(readDate('call Tuesday then send Thursday', BASE)?.words.toLowerCase(), 'tuesday', 'words = what was typed');
eq(latinDigits('٠١٢٣٤٥٦٧٨٩ ۴'), '0123456789 4', 'latinDigits');

// ── 5. Owner ────────────────────────────────────────────────────────────────
eq(readCapture('prepare the BOQ, I will send it Sunday', ctx()).owner.id, 'u-me', '"I will" → me');
eq(readCapture('Ask Mona to call AGIBA', ctx()).owner.id, 'u-mona', '"Ask Mona" → Mona');
eq(readCapture('Mona to check, Ahmed to send', ctx()).owner.id, 'u-mona', 'first doer wins (Mona to…)');
eq(readCapture('Mona and Ahmed to check', ctx()).owner.id, 'u-ahmed', '"and" does not make Mona the doer');
eq(readCapture('review drawings with Ahmed', ctx()).owner.id, 'u-ahmed', 'only colleague named → owner');
eq(readCapture('review the drawings', ctx()).owner.id, 'u-me', 'nobody named → me');
eq(readCapture('Mahmoud to send prices', ctx()).owner.id, 'u-me', 'ambiguous first name (two Mahmouds) → nobody');
eq(readCapture('Mahmoud Kamal to send prices', ctx()).owner.id, 'u-mah2', 'full name resolves the ambiguity');
eq(readCapture('على سارة ترسل الأسعار يوم الخميس', ctx()).owner.id, 'u-sara', 'Arabic «على سارة» → Sara');
eq(readCapture('سأرسل العرض بكرة', ctx()).owner.id, 'u-me', '«سأرسل» → me');
eq(readCapture('Tell Ahmed to loop in Mona', ctx()).others.map(p => p.id).join(','), 'u-mona', 'others = the rest named');
eq(readCapture('Tell Ahmed to loop in Mona', ctx()).owner.id, 'u-ahmed', 'Tell Ahmed → Ahmed');
{
  const f = findPeople('ahmedabad visit', PEOPLE);
  eq(f.length, 0, 'name inside a longer word does not match');
  eq(findPeople('وأحمد', [{ id: 'x', name: 'أحمد سمير' }]).length, 1, 'Arabic conjunction prefix «وأحمد» matches');
}

// Names across scripts: an English account found from Arabic, and back.
eq(readCapture('على منى إرسال الأسعار', ctx()).owner.id, 'u-mona', '«منى» finds "Mona Fathy"');
eq(readCapture('Sara to call them', ctx()).owner.id, 'u-sara', '"Sara" finds «سارة عبد الله»');
eq(readCapture('محمود يرسل الأسعار', ctx()).owner.id, 'u-me', '«محمود» is still ambiguous (two Mahmouds)');
eq(findPeople('منى', [{ id: 'a', name: 'Mona Fathy' }, { id: 'b', name: 'منى علي' }]).length, 0, 'Mona + «منى» on two people = ambiguous');
eq(findPeople('Tarek will do it', [{ id: 't', name: 'Tariq Mohamed' }]).length, 1, 'spelling variant Tarek → Tariq');

// ── 6. Kind ─────────────────────────────────────────────────────────────────
{
  const p = readCapture('New tender from AGIBA, RFQ-2026-118, closing 12/10/2026', ctx());
  eq(p.kind, 'opportunity', 'new tender with number → bid');
  eq(p.tenderNumber, '2026-118', 'tender number read');
  eq(p.date, '2026-10-12', 'closing date read');
  eq(p.match?.id, 'pr-1', 'AGIBA matched');
}
eq(readCapture('وصلت مناقصة جديدة من بتروجت', ctx()).kind, 'opportunity', 'Arabic new tender → bid');
eq(readCapture('وصلت مناقصة جديدة من بتروجت', ctx()).match?.id, 'op-1', 'Arabic client matched');
eq(readCapture('prepare prices for the Algeria tender', ctx()).kind, 'task', 'working ON a tender is a task');
eq(readCapture('We received a letter from AGIBA about the delay penalty', ctx()).kind, 'corresponding', 'received a letter → correspondence');
eq(readCapture('وصلنا خطاب من أجيبا بخصوص الغرامة', ctx()).kind, 'corresponding', 'Arabic letter → correspondence');
eq(readCapture('call Mona', ctx()).kind, 'task', 'plain → task');

// ── 7. Priority ─────────────────────────────────────────────────────────────
eq(readCapture('send the invoice today', ctx()).priority, 'Urgent', 'due today → Urgent');
eq(readCapture('send the invoice tomorrow', ctx()).priority, 'High', 'due tomorrow → High, not Urgent');
eq(readCapture('send the invoice in 3 days', ctx()).priority, 'High', '3 days → High');
eq(readCapture('send the invoice next week', ctx()).priority, 'Medium', 'next week → Medium');
eq(readCapture('urgent: send the invoice', ctx()).priority, 'High', 'urgent, no date → High');
eq(readCapture('عاجل ارسال الفاتورة بكرة', ctx()).priority, 'Urgent', 'urgent + tomorrow → Urgent');

// ── 8. Pasted e-mail ────────────────────────────────────────────────────────
const MAIL = `From: Hany Adel <h.adel@agiba.com.eg>
Sent: Monday, September 21, 2026 10:14 AM
To: Tariq Mohamed
Subject: RE: Meleiha tanks - revised schedule

Dear Tariq,
Please send the revised schedule within 5 days. Ahmed to confirm the manpower.
Regards`;
{
  const m = parsePastedEmail(MAIL);
  ok(!!m, 'mail headers recognised');
  eq(m?.sender_email, 'h.adel@agiba.com.eg', 'sender address');
  eq(m?.sender, 'Hany Adel', 'sender name');
  eq(m?.subject, 'RE: Meleiha tanks - revised schedule', 'subject');
  ok(m?.body_preview.startsWith('Dear Tariq'), 'body after headers');
  const p = readCapture(MAIL, ctx());
  eq(p.source, 'email', 'mail: source');
  eq(p.kind, 'corresponding', 'mail from outside → correspondence (mail rules)');
  eq(p.title, 'Meleiha tanks - revised schedule', 'mail: title cleaned of RE:');
  eq(p.date, off(BASE, 5), 'mail: "within 5 days"');
  eq(p.owner.id, 'u-ahmed', 'mail: owner from the body');
  eq(p.match?.id, 'pr-1', 'mail: linked project');
  eq(p.sender, 'Hany Adel <h.adel@agiba.com.eg>', 'mail: sender kept');
  eq(p.category, 'Project', 'mail: category from project match');
  ok(p.reasons[0].code === 'pasted-email', 'mail: reason first');
}
{
  const AR_MAIL = `من: منى فتحي <mona@eprom.com.eg>
تاريخ الإرسال: الاثنين 21 سبتمبر 2026
إلى: طارق محمد
الموضوع: مراجعة الرسومات

برجاء مراجعة الرسومات قبل الخميس.`;
  const p = readCapture(AR_MAIL, ctx());
  eq(p.source, 'email', 'Arabic Outlook headers recognised');
  eq(p.kind, 'task', 'internal mail → task');
  eq(p.title, 'مراجعة الرسومات', 'Arabic subject');
  eq(p.date, nextDow(BASE, 4), 'Arabic mail: «قبل الخميس»');
  eq(p.category, 'Internal', 'internal category');
}
eq(parsePastedEmail('send it to: Mona tomorrow'), null, 'one "to:" is not a mail');
eq(parsePastedEmail('To: Mona\nplease call'), null, 'a lone To: is not a mail');
ok(!!parsePastedEmail('Subject: hello\nTo: Mona\n\nbody'), 'subject + to is a mail');

// ── 9. Title / edge cases ───────────────────────────────────────────────────
eq(readCapture('', ctx()), null, 'empty → null');
eq(readCapture('  a ', ctx()), null, 'too short → null');
eq(titleFrom('call mona. then send the offer'), 'Call mona', 'title = first sentence');
ok(titleFrom('x '.repeat(100)).length <= 107, 'long title cut');
ok(titleFrom('word '.repeat(40)).endsWith('…'), 'long title marked');
eq(titleFrom('هل أرسلنا العرض؟ نعم'), 'هل أرسلنا العرض', 'Arabic question mark ends a sentence');

// ── report ───────────────────────────────────────────────────────────────────
if (fails.length) {
  console.log(`quickcapture: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`quickcapture: all ${pass} assertions passed`);
