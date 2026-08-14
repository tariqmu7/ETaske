// Harness for exportOpportunities() in src/lib/exportData.ts.
//
// Runs the REAL export against stubbed Firestore snapshots, captures the .xlsx
// bytes it hands to the browser, then reads the workbook back with xlsx and
// asserts the sheets/columns/derived values. Firestore and the DOM download are
// the only stubs; the sheet building is the shipping code.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const XLSX = await import(pathToFileURL(path.join(ROOT, 'node_modules/xlsx/xlsx.mjs')).href);
const OUT = path.join(os.tmpdir(), 'exportData.bundle.mjs');

const iso = off => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── fixture data ─────────────────────────────────────────────────────────────
const DATA = {
  opportunities: [
    { id: 'o1', serialNumber: 'OP000001', title: 'EGPC Turnaround', client: 'EGPC', stage: 'Lost',
      estimatedValue: 2_000_000, probability: 25, currency: 'EGP', submissionDeadline: iso(-10) },
    { id: 'o2', serialNumber: 'OP000002', title: 'AGIBA Maintenance', client: 'AGIBA', stage: 'Bid Preparation',
      estimatedValue: '1,500,000', currency: 'EGP' },            // string value, NO probability
    { id: '--stats--', count: 2 },                               // counter doc must be excluded
  ],
  opportunityFeedback: [
    { id: 'f1', opportunityId: 'o1', outcome: 'Lost', reasons: ['Price too high', 'Commercial terms'],
      primaryReason: 'Price too high', ourPrice: 2_000_000, winningPrice: 1_600_000, priceGapPercent: 25 },
  ],
  opportunityMilestones: [
    { id: 'm1', opportunityId: 'o1', title: 'Bid submission', status: 'Done', dueDate: iso(-20), completedDate: iso(-18) },
    { id: 'm2', opportunityId: 'o1', title: 'Site visit', status: 'Planned', dueDate: iso(-5) },
    { id: 'm3', opportunityId: 'o1', title: 'Award decision', status: 'Planned' },          // no due date
    { id: 'm4', opportunityId: 'ghost', title: 'Prequalification', status: 'Done', dueDate: iso(-9) }, // orphan
  ],
  opportunityFollowUps: [
    { id: 'u1', opportunityId: 'o1', text: 'Called the client', authorName: 'Tariq', createdAt: { seconds: 100 } },
    { id: 'u2', opportunityId: 'o1', text: 'Clarifications sent', authorName: 'Nevin', createdAt: { seconds: 200 } },
  ],
};

const snapFor = name => ({
  docs: (DATA[name] || []).map(d => ({ id: d.id, data: () => { const { id, ...rest } = d; return rest; } })),
  size: (DATA[name] || []).length,
});

const stubPlugin = {
  name: 'stub',
  setup(b) {
    // platform:neutral can't read xlsx's "main"; point it at the ESM build.
    b.onResolve({ filter: /^xlsx$/ }, () => ({ path: path.join(ROOT, 'node_modules/xlsx/xlsx.mjs') }));
    b.onResolve({ filter: /firebase$/ }, () => ({ path: 'stub-app', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'stub-fs', namespace: 'stub' }));
    b.onResolve({ filter: /taskVisibility$/ }, () => ({ path: 'stub-tv', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-app'
        ? `export const db = {}; export const auth = { currentUser: { uid: 'u1' } };`
        : args.path === 'stub-tv'
          ? `export async function getVisibleTasks() { return []; }`
          : `export function collection(_db, name) { return name; }
             export async function getDocs(name) { return globalThis.__snap(name); }
             export class Timestamp {}`,
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [path.join(ROOT, 'src/lib/exportData.ts')],
  bundle: true, format: 'esm', platform: 'neutral', outfile: OUT,
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  plugins: [stubPlugin], logLevel: 'warning',
});

globalThis.__snap = snapFor;

// Capture the download instead of performing it.
let captured = null;
globalThis.URL = { createObjectURL: blob => { captured = blob; return 'blob:x'; }, revokeObjectURL: () => {} };
globalThis.document = {
  createElement: () => ({ click: () => {}, remove: () => {}, style: {} }),
  body: { appendChild: () => {} },
};

const { exportOpportunities } = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const result = await exportOpportunities();
const wb = XLSX.read(new Uint8Array(await captured.arrayBuffer()), { type: 'array' });
const rows = sheet => XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });

console.log('\n[1] workbook shape');
check('file name is distinct from the main export', /^ETaske-bids-.*\.xlsx$/.test(result.fileName), result.fileName);
check('four sheets', JSON.stringify(wb.SheetNames) === '["Opportunities","Outcomes","Bid Gates","Follow-ups"]', wb.SheetNames.join(','));
check('counts reported back', result.opportunities === 2 && result.feedback === 1 && result.milestones === 4 && result.followUps === 2,
  JSON.stringify(result));

console.log('\n[2] opportunities sheet');
const opps = rows('Opportunities');
check('--stats-- counter is excluded', opps.length === 2 && !opps.some(r => r['Doc ID'] === '--stats--'), String(opps.length));
check('weighted value = value x probability', opps[0]['Weighted Value'] === 500000, String(opps[0]['Weighted Value']));
check('a missing probability weights to 0, never to full value',
  opps[1]['Weighted Value'] === 0, String(opps[1]['Weighted Value']));
check('string values with commas still parse', opps[1]['Estimated Value'] === '1,500,000', String(opps[1]['Estimated Value']));
check('headers are human, not field names', 'Tender / RFQ No.' in opps[0] && 'Bid Owner' in opps[0], Object.keys(opps[0]).join(','));

console.log('\n[3] outcomes sheet');
const fb = rows('Outcomes');
check('child row carries the parent serial', fb[0]['Bid Serial'] === 'OP000001', String(fb[0]['Bid Serial']));
check('child row carries the parent title', fb[0]['Bid Title'] === 'EGPC Turnaround', String(fb[0]['Bid Title']));
check('reason array is readable in one cell', fb[0]['All Reasons'] === 'Price too high | Commercial terms', String(fb[0]['All Reasons']));
check('price gap survives', fb[0]['Price Gap %'] === 25, String(fb[0]['Price Gap %']));

console.log('\n[4] bid gates sheet — slippage');
const gates = rows('Bid Gates');
const gate = t => gates.find(g => g.Gate === t);
check('Done gate measured against its completion date (2d late)', gate('Bid submission')['Slippage (days)'] === 2,
  String(gate('Bid submission')['Slippage (days)']));
check('open gate measured against today (5d late)', gate('Site visit')['Slippage (days)'] === 5,
  String(gate('Site visit')['Slippage (days)']));
check('gate with no due date reports blank, not 0', gate('Award decision')['Slippage (days)'] === '',
  String(gate('Award decision')['Slippage (days)']));
check('orphan row is exported and labelled', gate('Prequalification')['Bid Serial'] === '(deleted bid)',
  String(gate('Prequalification')['Bid Serial']));

console.log('\n[5] follow-ups sheet');
const fus = rows('Follow-ups');
check('newest follow-up first', fus[0]['Follow-up'] === 'Clarifications sent', String(fus[0]['Follow-up']));

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
fs.rmSync(OUT, { force: true });
process.exit(fail ? 1 : 0);
