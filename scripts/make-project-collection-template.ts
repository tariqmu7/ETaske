/**
 * Generates the bilingual (EN/AR) project data-collection workbook that gets sent
 * to each team member so they can declare: the projects they own, the scope of work
 * assigned to them, the current status, and where the project's files actually live.
 *
 *   npx tsx scripts/make-project-collection-template.ts
 *
 * Output: templates/ETaske-Project-Data-Collection.xlsx
 *
 * Uses exceljs (devDependency) rather than the app's `xlsx` because the free SheetJS
 * build cannot WRITE data-validation dropdowns, and the dropdowns are the whole point
 * of a form: they keep 30 people from inventing 30 spellings of "In Progress".
 */
import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(process.cwd(), 'templates/ETaske-Project-Data-Collection.xlsx');

const INK = 'FF16202E';        // header band
const INK_SOFT = 'FF2D3B4E';   // sub band
const ACCENT = 'FFC9A227';     // gold rule
const PAPER = 'FFF7F5F0';
const EXAMPLE = 'FFFFF6DC';
const BORDER = 'FFBFC7D1';

type Col = {
  key: string;
  en: string;
  ar: string;
  width: number;
  list?: string[];
  kind?: 'date' | 'percent' | 'text';
  example: string | number | Date;
};

const LISTS = {
  type: ['Operation & Maintenance', 'Technical Support', 'Turnaround / Shutdown', 'EPC / Construction', 'Study / Consultancy', 'Supply / Procurement', 'Tender / Bid', 'Agency Agreement', 'Internal / Corporate', 'Other'],
  role: ['Project Manager', 'Owner / Lead', 'Team Member', 'Technical Support', 'Commercial / Contracts', 'Follow-up only', 'Other'],
  status: ['Not started', 'In progress', 'On hold', 'Waiting on client', 'Waiting on internal dept.', 'Completed', 'Cancelled'],
  priority: ['High', 'Medium', 'Low'],
  storage: ['Local PC', 'Shared network drive', 'Google Drive', 'OneDrive', 'SharePoint', 'Email only', 'Hard copy only', 'Other'],
};

const COLS: Col[] = [
  { key: 'n', en: '#', ar: 'م', width: 5, example: 1 },
  { key: 'project', en: 'Project / contract name', ar: 'اسم المشروع أو العقد', width: 34, example: 'Burgan Kuwait — O&M tender package' },
  { key: 'client', en: 'Client / owner', ar: 'جهة العمل / العميل', width: 20, example: 'Burgan Drilling Co.' },
  { key: 'location', en: 'Location / country', ar: 'الموقع / الدولة', width: 16, example: 'Kuwait' },
  { key: 'type', en: 'Project type', ar: 'نوع المشروع', width: 22, list: LISTS.type, example: 'Tender / Bid' },
  { key: 'role', en: 'My role on it', ar: 'دوري في المشروع', width: 18, list: LISTS.role, example: 'Commercial / Contracts' },
  { key: 'scope', en: 'Scope of work assigned to me — be specific', ar: 'نطاق العمل المسند إليّ — بالتفصيل', width: 46, example: 'Collect technical replies from all departments, compile and submit the integrated bid response.' },
  { key: 'status', en: 'Current status', ar: 'الحالة الحالية', width: 20, list: LISTS.status, example: 'Waiting on internal dept.' },
  { key: 'pct', en: '% complete', ar: 'نسبة الإنجاز %', width: 12, kind: 'percent', example: 40 },
  { key: 'start', en: 'Start date', ar: 'تاريخ البدء', width: 13, kind: 'date', example: new Date('2026-06-01') },
  { key: 'due', en: 'Target finish date', ar: 'تاريخ الانتهاء المستهدف', width: 15, kind: 'date', example: new Date('2026-09-30') },
  { key: 'priority', en: 'Priority', ar: 'الأولوية', width: 11, list: LISTS.priority, example: 'High' },
  { key: 'storage', en: 'Where the files are kept', ar: 'مكان حفظ الملفات', width: 20, list: LISTS.storage, example: 'Shared network drive' },
  { key: 'path', en: 'FULL folder path or link', ar: 'المسار الكامل للمجلد أو الرابط', width: 46, example: '\\\\eprom-fs01\\Commercial\\2026\\Burgan_Kuwait_Tender' },
  { key: 'access', en: 'Who else can access that folder', ar: 'من لديه صلاحية الوصول للمجلد', width: 24, example: 'Commercial dept. + M. Farid' },
  { key: 'docs', en: 'Main documents inside', ar: 'أهم المستندات بداخله', width: 30, example: 'Tender docs, dept. replies, pricing sheet v3' },
  { key: 'next', en: 'Next action', ar: 'الخطوة التالية', width: 30, example: 'Chase Rotating Equipment dept. for their reply' },
  { key: 'nextDate', en: 'Next action date', ar: 'تاريخ الخطوة التالية', width: 14, kind: 'date', example: new Date('2026-08-24') },
  { key: 'blockers', en: 'Blockers / issues', ar: 'المعوقات والمشاكل', width: 30, example: '3 departments have not replied since 5 Aug' },
  { key: 'notes', en: 'Notes', ar: 'ملاحظات', width: 26, example: '' },
];

const DATA_ROWS = 60;
const HEAD = 7;              // header row index
const EX = HEAD + 1;         // example row
const FIRST = HEAD + 2;      // first blank data row
const LAST = FIRST + DATA_ROWS - 1;

const wb = new ExcelJS.Workbook();
wb.creator = 'ETaske';
wb.created = new Date();

/* ------------------------------------------------------------------ lists */
const lists = wb.addWorksheet('Lists');
lists.state = 'veryHidden';
Object.values(LISTS).forEach((values, i) => {
  values.forEach((v, r) => {
    lists.getCell(r + 1, i + 1).value = v;
  });
});
const listRef = (i: number, len: number) =>
  `Lists!$${String.fromCharCode(65 + i)}$1:$${String.fromCharCode(65 + i)}$${len}`;
const LIST_REF: Record<string, string> = {};
Object.entries(LISTS).forEach(([name, values], i) => {
  LIST_REF[name] = listRef(i, values.length);
});
const refFor = (list: string[]) => {
  const name = Object.keys(LISTS).find((k) => LISTS[k as keyof typeof LISTS] === list)!;
  return LIST_REF[name];
};

/* ---------------------------------------------------------- instructions */
const info = wb.addWorksheet('Instructions | تعليمات', {
  views: [{ showGridLines: false }],
});
info.getColumn(1).width = 4;
info.getColumn(2).width = 108;

let r = 2;
const put = (
  text: string,
  opts: { size?: number; bold?: boolean; color?: string; height?: number; rtl?: boolean } = {},
) => {
  const cell = info.getCell(r, 2);
  cell.value = text;
  cell.font = { name: 'Calibri', size: opts.size ?? 11, bold: opts.bold, color: { argb: opts.color ?? 'FF16202E' } };
  cell.alignment = { vertical: 'middle', wrapText: true, horizontal: opts.rtl ? 'right' : 'left', readingOrder: opts.rtl ? 'rtl' : 'ltr' };
  info.getRow(r).height = opts.height ?? 18;
  r += 1;
  return cell;
};

put('PROJECT DATA COLLECTION', { size: 20, bold: true, height: 30 });
put('حصر المشروعات ونطاق العمل ومكان حفظ الملفات', { size: 14, bold: true, color: INK_SOFT, height: 24, rtl: true });
r += 1;
put('What this is for', { size: 13, bold: true, color: 'FF8A6D00', height: 22 });
put(
  'We are building one central register of every project running in the company: who owns it, exactly what that person is responsible for, where it stands today, and where its files are physically stored. Please fill in YOUR projects only — the ones you personally work on or follow up.',
  { height: 46 },
);
put(
  'الهدف: عمل حصر مركزي لكل المشروعات — من المسؤول عنها، وما هو نطاق العمل المسند إليه بالتحديد، والحالة الحالية، ومكان حفظ الملفات. برجاء تسجيل مشروعاتك أنت فقط.',
  { height: 40, rtl: true },
);
r += 1;
put('How to fill it in', { size: 13, bold: true, color: 'FF8A6D00', height: 22 });
[
  '1.  Fill in your name, department and email in the yellow boxes at the top of the "Projects" sheet.',
  '2.  One project per row. The first row is a filled-in EXAMPLE — delete it before you send the file back.',
  '3.  Grey columns have drop-down lists. Click the cell, then the small arrow, and pick a value. Do not type your own wording there.',
  '4.  "Scope of work assigned to me" is the most important column. Write what YOU deliver, not what the project is about. e.g. "prepare the pricing sheet and submit the bid", not "it is a tender".',
  '5.  "FULL folder path or link" must be a path someone else can actually open — copy it from the address bar of the folder (e.g. \\\\server\\dept\\2026\\Project) or paste the Drive/SharePoint link. "My documents" is not an answer.',
  '6.  Dates: use the format DD/MM/YYYY. Leave a cell empty if it genuinely does not apply — do not write "N/A" everywhere.',
  '7.  If a project is finished but the files still exist, still list it and set the status to "Completed".',
  '8.  Save the file as  ProjectData_<YourName>.xlsx  and send it back by the deadline below.',
].forEach((line) => put(line, { height: line.length > 110 ? 34 : 18 }));
r += 1;
put(
  'خطوات التعبئة: اكتب بياناتك في الخانات الصفراء أعلى صفحة "Projects" — مشروع واحد في كل صف — الصف الأول مثال توضيحي يُحذف قبل الإرسال — الأعمدة الرمادية بها قوائم منسدلة اختر منها ولا تكتب بنفسك — عمود "نطاق العمل المسند إليّ" هو الأهم فاكتب ما تقوم به أنت تحديدًا — ومسار المجلد يجب أن يكون مسارًا كاملًا يستطيع غيرك فتحه.',
  { height: 60, rtl: true },
);
r += 1;
put('Deadline / الموعد النهائي:  ______________________', { size: 12, bold: true, height: 24 });
put('Send back to / يُرسل إلى:  ______________________', { size: 12, bold: true, height: 24 });
r += 1;
put('Any question about a column — ask before you guess. A wrong folder path costs more time than an empty one.', {
  color: 'FF6B7280',
  height: 20,
});

/* --------------------------------------------------------------- projects */
const ws = wb.addWorksheet('Projects', {
  views: [{ state: 'frozen', xSplit: 2, ySplit: HEAD, showGridLines: false }],
  pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
});

COLS.forEach((c, i) => {
  ws.getColumn(i + 1).width = c.width;
});

// title band
ws.mergeCells(1, 1, 1, COLS.length);
const title = ws.getCell(1, 1);
title.value = 'PROJECT DATA COLLECTION   |   حصر المشروعات ونطاق العمل';
title.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
ws.getRow(1).height = 34;

ws.mergeCells(2, 1, 2, COLS.length);
const rule = ws.getCell(2, 1);
rule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
ws.getRow(2).height = 4;

// respondent block
const field = (row: number, label: string, span: number, startCol: number) => {
  const lab = ws.getCell(row, startCol);
  lab.value = label;
  lab.font = { bold: true, size: 11, color: { argb: INK } };
  lab.alignment = { vertical: 'middle', horizontal: 'right' };
  ws.mergeCells(row, startCol + 1, row, startCol + span);
  const input = ws.getCell(row, startCol + 1);
  input.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3C4' } };
  input.border = {
    top: { style: 'thin', color: { argb: BORDER } },
    left: { style: 'thin', color: { argb: BORDER } },
    bottom: { style: 'thin', color: { argb: BORDER } },
    right: { style: 'thin', color: { argb: BORDER } },
  };
  input.alignment = { vertical: 'middle', indent: 1 };
  return input;
};

field(4, 'Your name / الاسم:', 3, 1);
field(4, 'Department / الإدارة:', 3, 6);
field(5, 'Email / البريد:', 3, 1);
field(5, 'Date / التاريخ:', 2, 6).numFmt = 'dd/mm/yyyy';
ws.getRow(4).height = 22;
ws.getRow(5).height = 22;

ws.mergeCells(6, 1, 6, COLS.length);
const hint = ws.getCell(6, 1);
hint.value =
  'One project per row.  Grey columns = pick from the drop-down list.  Delete the yellow EXAMPLE row before sending.  |  مشروع واحد في كل صف — الأعمدة الرمادية بها قوائم منسدلة — احذف صف المثال قبل الإرسال';
hint.font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
hint.alignment = { vertical: 'middle', indent: 1 };
ws.getRow(6).height = 20;

// header
const header = ws.getRow(HEAD);
header.height = 46;
COLS.forEach((c, i) => {
  const cell = header.getCell(i + 1);
  cell.value = { richText: [
    { text: c.en, font: { bold: true, size: 10.5, color: { argb: 'FFFFFFFF' } } },
    { text: '\n' + c.ar, font: { bold: false, size: 9.5, color: { argb: 'FFC9D3E0' } } },
  ] };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.list ? INK_SOFT : INK } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = { right: { style: 'thin', color: { argb: 'FF44546A' } } };
});

const thin = { style: 'thin' as const, color: { argb: BORDER } };
const boxed = { top: thin, left: thin, bottom: thin, right: thin };

// example row
const example = ws.getRow(EX);
example.height = 44;
COLS.forEach((c, i) => {
  const cell = example.getCell(i + 1);
  cell.value = c.example === '' ? null : (c.example as ExcelJS.CellValue);
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXAMPLE } };
  cell.font = { size: 10, italic: true, color: { argb: 'FF7A5C00' } };
  cell.alignment = { vertical: 'top', wrapText: true, indent: 1 };
  cell.border = boxed;
  if (c.kind === 'date') cell.numFmt = 'dd/mm/yyyy';
  if (c.kind === 'percent') cell.numFmt = '0"%"';
});
example.getCell(1).value = 'EX';
example.getCell(1).alignment = { vertical: 'top', horizontal: 'center' };

// blank data rows
for (let row = FIRST; row <= LAST; row += 1) {
  const line = ws.getRow(row);
  line.height = 30;
  COLS.forEach((c, i) => {
    const cell = line.getCell(i + 1);
    cell.border = boxed;
    cell.alignment = { vertical: 'top', wrapText: true, indent: 1 };
    cell.font = { size: 10.5 };
    if (row % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } };
    if (c.kind === 'date') cell.numFmt = 'dd/mm/yyyy';
    if (c.kind === 'percent') cell.numFmt = '0"%"';
  });
  line.getCell(1).value = { formula: `IF(B${row}="","",COUNTA($B$${FIRST}:B${row}))`, result: '' };
  line.getCell(1).alignment = { vertical: 'top', horizontal: 'center' };
}

// validation
// exceljs ships `dataValidations` at runtime but leaves it out of its .d.ts
const dv = (ws as unknown as { dataValidations: { add: (range: string, rule: unknown) => void } }).dataValidations;
COLS.forEach((c, i) => {
  const letter = ws.getColumn(i + 1).letter;
  const range = `${letter}${FIRST}:${letter}${LAST}`;
  if (c.list) {
    dv.add(range, {
      type: 'list',
      allowBlank: true,
      formulae: [refFor(c.list)],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Pick from the list',
      error: `Please choose one of: ${c.list.join(', ')}`,
      promptTitle: c.en,
      prompt: 'Click the arrow and pick a value.',
      showInputMessage: true,
    });
  } else if (c.kind === 'percent') {
    dv.add(range, {
      type: 'whole',
      operator: 'between',
      formulae: [0, 100],
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: 'Percentage 0–100',
      error: 'Enter a whole number between 0 and 100 (no % sign).',
    });
  } else if (c.kind === 'date') {
    dv.add(range, {
      type: 'date',
      operator: 'between',
      formulae: [new Date('2000-01-01'), new Date('2050-12-31')],
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: 'Enter a date',
      error: 'Use a real date, format DD/MM/YYYY.',
    });
  }
});

ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: LAST, column: COLS.length } };

mkdirSync(dirname(OUT), { recursive: true });
await wb.xlsx.writeFile(OUT);
console.log(`wrote ${OUT}`);
console.log(`  ${COLS.length} columns, ${DATA_ROWS} blank rows, ${Object.keys(LISTS).length} drop-down lists`);
