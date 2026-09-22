// Harness for src/lib/projectDocuments.ts -> documents per project + Arabic search (queue D4).
//
// Bundles the REAL module with esbuild. No network, no Firebase.
//
//   node scripts/harness/projectdocs.mjs
//
// Also cross-checks the locale files for the labels the UI shows for each kind
// and direction (display-labelled at render; a missing key paints English).

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'projectdocs.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/projectDocuments.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  logLevel: 'warning',
});

const D = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const off = n => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() + n); return iso(d); };

// ── [1] Links ────────────────────────────────────────────────────────────────
{
  eq(D.linkKind(''), null, '[1] empty → null');
  eq(D.linkKind('  '), null, '[1] blank → null');
  eq(D.linkKind('https://drive.google.com/file/d/abc/view'), 'url', '[1] https');
  eq(D.linkKind('http://intranet/x.pdf'), 'url', '[1] http');
  eq(D.linkKind('\\\\eprom-fs01\\Commercial\\AGIBA\\offer.pdf'), 'path', '[1] UNC path');
  eq(D.linkKind('C:\\Users\\me\\x.docx'), 'path', '[1] drive path');
  eq(D.linkKind('D:/scans/x.pdf'), 'path', '[1] drive path with /');
  eq(D.linkKind('//server/share/x'), 'path', '[1] //server/share');
  eq(D.linkKind('javascript:alert(1)'), 'bad', '[1] javascript: refused');
  eq(D.linkKind('data:text/html,<b>x</b>'), 'bad', '[1] data: refused');
  eq(D.linkKind('JaVaScRiPt:alert(1)'), 'bad', '[1] mixed-case javascript: refused');
  eq(D.linkKind('file:///C:/x'), 'bad', '[1] file:// refused');
  eq(D.linkKind('just words'), 'bad', '[1] plain words refused');
  eq(D.linkKind('https://has space'), 'bad', '[1] url with a space refused');
}

// ── [2] Validation ───────────────────────────────────────────────────────────
{
  const base = { kind: 'letter', title: 'Letter' };
  eq(D.validateDocument({ ...base }), null, '[2] minimal ok');
  eq(D.validateDocument({ ...base, title: '  ' }), 'title', '[2] blank title');
  eq(D.validateDocument({ ...base, kind: 'memo' }), 'kind', '[2] unknown kind');
  eq(D.validateDocument({ ...base, date: '30/9/2026' }), 'date', '[2] non-iso date');
  eq(D.validateDocument({ ...base, date: off(0) }), null, '[2] iso date ok');
  eq(D.validateDocument({ ...base, link: 'javascript:x' }), 'link', '[2] bad link');
  eq(D.validateDocument({ ...base, link: '\\\\fs\\a\\b' }), null, '[2] path ok');
  eq(D.validateDocument({ ...base }, D.MAX_DOCUMENTS), 'full', '[2] list full blocks a NEW one');
  eq(D.validateDocument({ ...base }, D.MAX_DOCUMENTS, false), null, '[2] …but not an edit');
}

// ── [3] Build / add / update / remove ────────────────────────────────────────
{
  const t0 = new Date(2026, 8, 21, 10, 0, 0);
  const d = D.buildDocument({
    kind: 'offer', title: '  Technical offer rev 2  ', date: off(-3), direction: 'out',
    refNo: 'BD/118', party: 'AGIBA', summary: '', link: '  ', fileName: undefined,
  }, { uid: 'u1', name: 'Mona Fathy' }, t0);
  eq(d.title, 'Technical offer rev 2', '[3] title trimmed');
  ok(!('summary' in d) && !('link' in d) && !('fileName' in d), '[3] empty fields are OMITTED (Firestore rejects undefined)');
  ok(!Object.values(d).some(v => v === undefined), '[3] no undefined value anywhere');
  eq(d.addedById, 'u1', '[3] filer uid');
  eq(d.addedBy, 'Mona Fathy', '[3] filer name');
  eq(d.addedAt, t0.toISOString(), '[3] addedAt ISO');
  ok(/^doc_/.test(d.id), '[3] id shape');
  const d2 = D.buildDocument({ kind: 'weird', title: 'x' }, { uid: 'u2' }, t0);
  eq(d2.kind, 'other', '[3] unknown kind stored as other');
  ok(d.id !== d2.id, '[3] ids unique even in the same millisecond');
  const long = D.buildDocument({ kind: 'report', title: 'x'.repeat(500), summary: 'y'.repeat(9000) }, { uid: 'u' }, t0);
  eq(long.title.length, D.TITLE_MAX, '[3] title capped');
  eq(long.summary.length, D.SUMMARY_MAX, '[3] summary capped');

  let list = D.addDocument([], d);
  list = D.addDocument(list, d2);
  eq(list.length, 2, '[3] added two');
  eq(D.addDocument(list, d).length, 2, '[3] re-adding the same id does not duplicate');
  const t1 = new Date(2026, 8, 22);
  const up = D.updateDocument(list, d.id, { kind: 'offer', title: 'Technical offer rev 3', refNo: '', direction: 'out' }, t1);
  const u = up.find(x => x.id === d.id);
  eq(u.title, 'Technical offer rev 3', '[3] update title');
  ok(!('refNo' in u), '[3] emptied refNo removed on update');
  ok(!('party' in u) && !('date' in u), '[3] fields absent from the form input are cleared too (form sends all)');
  eq(u.addedById, 'u1', '[3] filer kept on update');
  eq(u.addedAt, t0.toISOString(), '[3] addedAt kept on update');
  eq(u.editedAt, t1.toISOString(), '[3] editedAt stamped');
  eq(up.find(x => x.id === d2.id), d2, '[3] other entry untouched');
  eq(D.removeDocument(up, d.id).map(x => x.id), [d2.id], '[3] remove');
  eq(D.removeDocument(up, 'nope').length, 2, '[3] remove unknown = no-op');
  eq(D.addDocument(undefined, d).length, 1, '[3] add to a missing array');

  ok(D.canChangeDocument({ addedById: 'u1' }, 'u1', 'Employee'), '[3] filer may change');
  ok(!D.canChangeDocument({ addedById: 'u1' }, 'u2', 'Employee'), '[3] another employee may not');
  ok(D.canChangeDocument({ addedById: 'u1' }, 'u2', 'Manager'), '[3] manager may');
  ok(D.canChangeDocument({}, 'u2', 'Admin'), '[3] admin may, even unowned');
  ok(!D.canChangeDocument({}, 'u2', 'Employee'), '[3] unowned entry: employee may not');
}

// ── [4] Gathering the three sources ──────────────────────────────────────────
const projects = [
  {
    id: 'p1', name: 'AGIBA Meleiha O&M', client: 'AGIBA',
    documents: [
      { id: 'a', kind: 'minutes', title: 'محضر اجتماع بدء الأعمال', date: off(-10), direction: 'internal', summary: 'اتُّفق على موعد التعبئة وتسليم خطة السلامة.', addedById: 'u1', addedBy: 'Mona' },
      { id: 'b', kind: 'offer', title: 'Technical offer — Meleiha tank cleaning', date: off(-40), direction: 'out', refNo: 'EPROM/BD/2026/118', party: 'AGIBA Petroleum', summary: 'Scope: cleaning of 4 crude tanks, sludge handling, 45 days.', link: 'https://drive.google.com/x' },
      { id: 'c', kind: 'invoice', title: 'المستخلص رقم ٣', date: off(-2), direction: 'out', refNo: '٣/٢٠٢٦', summary: 'مستخلص جاري عن شهر أغسطس' },
      { id: 'bad', kind: 'letter' },                     // no title → skipped
      { id: 'u', kind: 'offer', title: 'Undated price list' },
    ],
  },
  {
    id: 'p2', name: 'مشروع صيانة خزانات رأس غارب', client: 'بتروجت',
    documents: [
      { id: 'd', kind: 'letter', title: 'خطاب طلب تمديد مدة العقد', date: off(-5), direction: 'in', party: 'شركة بتروجت', summary: 'تطلب الشركة تمديد مدة التنفيذ ثلاثين يومًا.' },
      { id: 'e', kind: 'contract', title: 'Amendment 2 — extension', date: off(-1), refNo: '4600001234-A2' },
    ],
  },
  { id: 'p3', name: 'Empty project' },
];
const letters = [
  { id: 'L1', subject: 'Request for site access permits', body: 'Please issue the permits for the tank farm.', sentFrom: 'AGIBA', dateReceived: off(-7), serialNumber: 'CR000045', projectId: 'p1', status: 'Assigned', attachedFile: 'https://drive/y', attachedFileName: 'permits.pdf', filePaths: ['\\\\eprom-fs01\\Commercial\\AGIBA'] },
  { id: 'L2', subject: 'Unlinked letter', dateReceived: off(-1) },
  { id: 'L3', subject: 'Linked to a deleted project', projectId: 'gone', dateReceived: off(-1) },
];
const tasks = [
  { id: 'T1', taskName: 'Prepare HSE plan', serialNumber: 'TK000120', projectId: 'p1', attachedFile: 'https://drive/z', attachedFileName: 'HSE plan v1.docx', createdAt: { toDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() - 4) }, status: 'In Progress', assignedTo: 'Ahmed' },
  { id: 'T2', taskName: 'Call client', projectId: 'p1' },                  // no file → not a document
  { id: 'T3', taskName: 'Scan contract', projectId: 'p2', filePaths: ['  ', '\\\\fs\\scans'] },
];
const rows = D.gatherDocuments({ projects, letters, tasks });
{
  const keys = rows.map(r => r.key);
  eq(rows.length, 6 + 1 + 2, '[4] 6 filed (1 untitled skipped) + 1 letter + 2 tasks');
  ok(keys.includes('filed:p1:a') && keys.includes('filed:p2:e'), '[4] filed keys');
  ok(!keys.includes('filed:p1:bad'), '[4] untitled entry skipped');
  ok(keys.includes('letter:L1'), '[4] linked letter included');
  ok(!keys.includes('letter:L2') && !keys.includes('letter:L3'), '[4] unlinked / dangling letters excluded');
  ok(keys.includes('task:T1') && keys.includes('task:T3') && !keys.includes('task:T2'), '[4] only tasks WITH a file/path');
  const L1 = rows.find(r => r.key === 'letter:L1');
  eq([L1.kind, L1.direction, L1.refNo, L1.party, L1.projectName, L1.client], ['letter', 'in', 'CR000045', 'AGIBA', 'AGIBA Meleiha O&M', 'AGIBA'], '[4] letter mapped');
  eq(L1.paths, ['\\\\eprom-fs01\\Commercial\\AGIBA'], '[4] letter paths');
  const T1 = rows.find(r => r.key === 'task:T1');
  eq(T1.title, 'HSE plan v1.docx', '[4] task row titled by its file');
  eq(T1.date, off(-4), '[4] task date from createdAt (local day)');
  eq(rows.find(r => r.key === 'task:T3').paths, ['\\\\fs\\scans'], '[4] blank paths dropped');
  // Order: newest date first, undated last
  const dated = rows.filter(r => r.date).map(r => r.date);
  ok(dated.every((d, i) => i === 0 || dated[i - 1] >= d), '[4] newest first');
  eq(rows[rows.length - 1].date, undefined, '[4] undated rows last');
  eq(D.gatherDocuments({ projects: [] }).length, 0, '[4] no projects → nothing');
  eq(D.gatherDocuments({ projects: [{ id: 'x', name: 'x', documents: 'oops' }] }).length, 0, '[4] malformed documents field tolerated');
  const counts = D.countByKind(rows);
  eq([counts.offer, counts.letter, counts.other, counts.drawing], [2, 2, 2, 0], '[4] countByKind');
}

// ── [5] Folding ──────────────────────────────────────────────────────────────
{
  eq(D.foldText('أإآٱ'), 'اااا', '[5] alef forms');
  eq(D.foldText('مدرسة'), 'مدرسه', '[5] ta marbuta');
  eq(D.foldText('مستشفى'), 'مستشفي', '[5] alef maqsura');
  eq(D.foldText('مؤتمر'), 'موتمر', '[5] waw hamza');
  eq(D.foldText('رئيس'), 'رييس', '[5] ya hamza');
  eq(D.foldText('مُسْتَخْلَص'), 'مستخلص', '[5] harakat');
  eq(D.foldText('مـــستخلص'), 'مستخلص', '[5] tatweel');
  eq(D.foldText('رقم ٣/٢٠٢٦ و ۴'), 'رقم 3/2026 و 4', '[5] Arabic-Indic + Persian digits');
  eq(D.foldText('AGIBA  Offer'), 'agiba offer', '[5] lower + spaces');
  eq(D.searchTokens('خطاب من بتروجت'), ['خطاب', 'بتروجت'], '[5] stop word dropped');
  eq(D.searchTokens('في من'), ['في', 'من'], '[5] all-stop query kept');
  eq(D.searchTokens('علي'), ['علي'], '[5] "Ali" is not a stop word');
  eq(D.searchTokens('offer, AGIBA؛ «tank»'), ['offer', 'agiba', 'tank'], '[5] punctuation split');
  eq(D.tokenForms('الخطاب'), ['الخطاب', 'خطاب'], '[5] ال stripped');
  eq(D.tokenForms('ولد'), ['ولد'], '[5] too short to strip');
  eq(D.tokenForms('بالعقد'), ['بالعقد', 'عقد'], '[5] بال stripped');
}

// ── [6] Search ───────────────────────────────────────────────────────────────
const keysOf = hits => hits.map(h => h.row.key);
{
  eq(D.searchDocuments(rows, '').length, rows.length, '[6] empty query → everything');
  eq(keysOf(D.searchDocuments(rows, '')), rows.map(r => r.key), '[6] empty query keeps date order');
  // Arabic, spelling-insensitive
  ok(keysOf(D.searchDocuments(rows, 'محضر')).includes('filed:p1:a'), '[6] «محضر» finds the minutes');
  ok(keysOf(D.searchDocuments(rows, 'اجتماع بدء الاعمال')).includes('filed:p1:a'), '[6] no-hamza query finds «الأعمال»');
  ok(keysOf(D.searchDocuments(rows, 'مستخلص 3')).includes('filed:p1:c'), '[6] Latin digit finds «٣»');
  ok(keysOf(D.searchDocuments(rows, 'مستخلص ٣')).includes('filed:p1:c'), '[6] Arabic digit too');
  ok(keysOf(D.searchDocuments(rows, 'الخطاب')).includes('filed:p2:d'), '[6] «الخطاب» finds «خطاب» (prefix)');
  ok(keysOf(D.searchDocuments(rows, 'تمديد')).includes('filed:p2:d'), '[6] word inside the title');
  ok(keysOf(D.searchDocuments(rows, 'ثلاثين')).includes('filed:p2:d'), '[6] word inside the summary');
  // Kind words across languages
  ok(keysOf(D.searchDocuments(rows, 'minutes')).includes('filed:p1:a'), '[6] English "minutes" finds an Arabic-titled محضر');
  ok(keysOf(D.searchDocuments(rows, 'عرض')).includes('filed:p1:b'), '[6] «عرض» finds the English offer');
  ok(keysOf(D.searchDocuments(rows, 'quotation')).includes('filed:p1:u'), '[6] "quotation" finds an offer');
  ok(keysOf(D.searchDocuments(rows, 'صادر')).includes('filed:p1:b'), '[6] «صادر» finds what we sent');
  ok(!keysOf(D.searchDocuments(rows, 'صادر')).includes('filed:p2:d'), '[6] …and not what we received');
  // Reference numbers, party, project, client, path, filer
  eq(keysOf(D.searchDocuments(rows, '2026/118')), ['filed:p1:b'], '[6] outgoing number');
  eq(keysOf(D.searchDocuments(rows, 'CR000045')), ['letter:L1'], '[6] letter serial');
  ok(keysOf(D.searchDocuments(rows, '4600001234')).includes('filed:p2:e'), '[6] contract number');
  ok(keysOf(D.searchDocuments(rows, 'رأس غارب')).includes('filed:p2:e'), '[6] project name finds its English-titled doc');
  ok(keysOf(D.searchDocuments(rows, 'eprom-fs01')).includes('letter:L1'), '[6] folder path searchable');
  ok(keysOf(D.searchDocuments(rows, 'mona')).includes('filed:p1:a'), '[6] filer name searchable');
  // AND semantics
  eq(keysOf(D.searchDocuments(rows, 'offer AGIBA tank')), ['filed:p1:b'], '[6] all words must match');
  eq(D.searchDocuments(rows, 'offer zzzzz').length, 0, '[6] one missing word = no hit');
  // Ranking: title beats body
  const h = keysOf(D.searchDocuments(rows, 'permits'));
  eq(h[0], 'letter:L1', '[6] title hit ranks first');
  // Filters
  eq(keysOf(D.searchDocuments(rows, '', { kind: 'offer' })).sort(), ['filed:p1:b', 'filed:p1:u'], '[6] kind filter');
  ok(D.searchDocuments(rows, '', { projectId: 'p2' }).every(x => x.row.projectId === 'p2'), '[6] project filter');
  eq(D.searchDocuments(rows, '', { projectId: 'p2' }).length, 3, '[6] p2 has 3 (2 filed + 1 task)');
  eq(keysOf(D.searchDocuments(rows, '', { direction: 'in' })).sort(), ['filed:p2:d', 'letter:L1'], '[6] direction filter');
  eq(D.searchDocuments(rows, 'x', { kind: 'all', projectId: 'all', direction: 'all' }).length >= 0, true, '[6] "all" filters accepted');
  eq(D.searchDocuments(rows, 'محضر', { kind: 'offer' }).length, 0, '[6] filter AND query');
}

// ── [7] Highlight + snippet ──────────────────────────────────────────────────
{
  const text = 'المُسْتَخْلَص رقم ٣ عن شهر أغسطس';
  const r = D.highlightRanges(text, 'مستخلص');
  eq(r.length, 1, '[7] one range');
  ok(text.slice(r[0][0], r[0][1]).includes('مُسْتَخْلَص'), '[7] range covers the vowelled word in the ORIGINAL text');
  const r2 = D.highlightRanges('Technical OFFER for AGIBA — offer rev 2', 'offer agiba');
  eq(r2.length, 3, '[7] every occurrence of every word');
  eq(r2.map(([s, e]) => 'Technical OFFER for AGIBA — offer rev 2'.slice(s, e)), ['OFFER', 'AGIBA', 'offer'], '[7] exact slices, case kept');
  eq(D.highlightRanges('abc', ''), [], '[7] empty query → nothing');
  eq(D.highlightRanges('', 'x'), [], '[7] empty text → nothing');
  const merged = D.highlightRanges('tanktank', 'tank tan');
  eq(merged, [[0, 8]], '[7] overlapping ranges merged');
  eq(D.highlightRanges('الخطاب المرسل', 'الخطاب').map(([s, e]) => 'الخطاب المرسل'.slice(s, e)), ['الخطاب'], '[7] fullest form wins');
  eq(D.highlightRanges('ارسلنا خطاب', 'الخطاب').map(([s, e]) => 'ارسلنا خطاب'.slice(s, e)), ['خطاب'], '[7] stem form used when the full one is absent');
  const digits = 'رقم ٣/٢٠٢٦';
  eq(D.highlightRanges(digits, '2026').map(([s, e]) => digits.slice(s, e)), ['٢٠٢٦'], '[7] Latin query marks Arabic digits');

  eq(D.snippet('short text', 'x'), 'short text', '[7] short text unchanged');
  const long = 'word '.repeat(80) + 'NEEDLE ' + 'tail '.repeat(80);
  const s = D.snippet(long, 'needle', 120);
  ok(s.includes('NEEDLE'), '[7] snippet shows the match');
  ok(s.startsWith('… ') && s.endsWith(' …'), '[7] snippet marks both cuts');
  ok(s.length <= 130, '[7] snippet about the width');
  const s2 = D.snippet(long, 'zzz', 60);
  ok(s2.startsWith('word') && s2.endsWith(' …'), '[7] no match → the start');
  eq(D.snippet(undefined, 'x'), '', '[7] undefined → empty');
}

// ── [8] Locale labels used by the UI ─────────────────────────────────────────
{
  const en = fs.readFileSync(path.join(ROOT, 'src/locales/en.ts'), 'utf8');
  const ar = fs.readFileSync(path.join(ROOT, 'src/locales/ar.ts'), 'utf8');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const arVal = k => { const m = ar.match(new RegExp(`^\\s*"${esc(k)}":\\s*"([^"]*)"`, 'm')); return m ? m[1] : null; };
  const LABELS = [
    'Letter', 'Offer', 'Minutes', 'Contract', 'Invoice / claim', 'Report', 'Drawing', 'Other document',
    'Received (incoming)', 'Sent (outgoing)', 'Internal', 'Documents', 'File a document',
  ];
  for (const w of LABELS) {
    ok(new RegExp(`^\\s*"${esc(w)}":`, 'm').test(en), `[8] en.ts has "${w}"`);
    const v = arVal(w);
    ok(!!v && v !== w, `[8] ar.ts translates "${w}"`);
  }
  // Every Arabic string this task added passes the house style sweep.
  const block = ar.split('// ── Documents per project (D4) ──')[1] || '';
  ok(block.length > 0, '[8] ar.ts has the D4 block');
  const vals = [...block.matchAll(/^\s*"[^"]*":\s*"([^"]*)"/gm)].map(m => m[1]);
  ok(vals.length >= 40, `[8] D4 block has its strings (${vals.length})`);
  for (const v of vals) {
    ok(!/[٠-٩]/.test(v), `[8] no Arabic-Indic digits: ${v}`);
    ok(!/(^|\s)(تم|يتم)\s/.test(v) && !v.includes('بواسطة') && !v.includes('الخاص ب') && !/[A-Za-z]\s*,|,/.test(v), `[8] style sweep: ${v}`);
  }
}

console.log(`projectdocs: ${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
