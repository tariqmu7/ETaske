// Harness for src/lib/clientFile.ts -> the Clients page (queue D1).
//
// Bundles the REAL module with esbuild. Nothing touches the network or Firebase.
//
//   node scripts/harness/clientfile.mjs
//
// `today` is injected and every fixture date is an offset from it, so the
// fixtures do not rot with the calendar.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'clientFile.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/clientFile.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT,
  define: { 'import.meta.env': '__VITE_ENV__' },
  banner: { js: 'const __VITE_ENV__ = {};' },
  logLevel: 'warning',
});

const {
  clientKey, textNamesClient, listClients, buildClientFile, toMs, dayOf,
  STEP_HORIZON_DAYS, CONTRACT_WARN_DAYS,
} = await import(pathToFileURL(OUT).href);

let pass = 0;
const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (actual, expected, label) =>
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = new Date(); TODAY.setHours(12, 0, 0, 0);
const off = n => iso(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + n));
// A Firestore-ish Timestamp n days from today.
const ts = n => { const d = new Date(TODAY.getTime() + n * 86_400_000); return { toMillis: () => d.getTime(), toDate: () => d }; };

// ── [1] clientKey ────────────────────────────────────────────────────────────
eq(clientKey('AGIBA'), 'agiba', '[1] upper case folds');
eq(clientKey('  Agiba  '), 'agiba', '[1] spaces trimmed');
eq(clientKey('Agiba Co.'), 'agiba', '[1] "Co." dropped');
eq(clientKey('AGIBA Company'), 'agiba', '[1] "Company" dropped');
eq(clientKey('Petrojet Ltd'), 'petrojet', '[1] "Ltd" dropped');
eq(clientKey('ENPPI S.A.E.'), 'enppi', '[1] "S.A.E." dropped');
eq(clientKey('AGIBA Petroleum'), 'agiba petroleum', '[1] a real word is kept — no over-merging');
eq(clientKey('شركة أجيبا'), 'اجيبا', '[1] «شركة» dropped + alef folded');
eq(clientKey('الشركة المصرية'), 'المصريه', '[1] «الشركة» dropped, ة folded');
eq(clientKey('Alex-Fert'), 'alex fert', '[1] hyphen = space');
eq(clientKey('ALEX FERT'), 'alex fert', '[1] …so both spellings share a key');
eq(clientKey(''), '', '[1] empty');
eq(clientKey(undefined), '', '[1] undefined');
eq(clientKey('Co'), 'co', '[1] a name that IS the suffix survives');

// ── [2] textNamesClient ──────────────────────────────────────────────────────
ok(textNamesClient('AGIBA Petroleum Co.', 'agiba'), '[2] sender starting with the name');
ok(textNamesClient('From: agiba', 'agiba'), '[2] lower case sender');
ok(!textNamesClient('CAPCO', 'apc'), '[2] APC not inside CAPCO');
ok(!textNamesClient('APCO', 'apc'), '[2] APC not inside APCO');
ok(textNamesClient('APC - Alexandria Petroleum', 'apc'), '[2] APC as a word');
ok(textNamesClient('خطاب لأجيبا', 'اجيبا'), '[2] Arabic ل prefix + hamza folded');
ok(textNamesClient('شركة اجيبا للبترول', 'اجيبا'), '[2] Arabic mid-sentence');
ok(!textNamesClient('', 'agiba'), '[2] empty text');
ok(!textNamesClient('AGIBA', ''), '[2] empty key');
ok(textNamesClient('Alex-Fert', 'alex fert'), '[2] two-word key across a hyphen');

// ── Fixtures ─────────────────────────────────────────────────────────────────
const projects = [
  { id: 'p1', serialNumber: 'PR000001', name: 'Meleiha O&M', client: 'AGIBA', status: 'Active', lastUpdateAt: ts(-3),
    checklist: [
      { id: 's1', title: 'Performance bond', dueDate: off(-2), done: false },
      { id: 's2', title: 'Kick-off meeting', dueDate: off(5), done: false },
      { id: 's3', title: 'First invoice', dueDate: off(STEP_HORIZON_DAYS + 10), done: false },
      { id: 's4', title: 'Contract signed', dueDate: off(-20), done: true },
    ] },
  { id: 'p2', serialNumber: 'PR000002', name: 'Old tank job', client: 'Agiba Co.', status: 'Completed', updatedAt: ts(-200),
    checklist: [{ id: 's5', title: 'Should not show', dueDate: off(-1), done: false }] },
  { id: 'p3', serialNumber: 'PR000003', name: 'Terminal study', client: 'APC', status: 'Active', createdAt: ts(-40) },
  { id: 'p4', serialNumber: 'PR000004', name: 'No client project', status: 'Active' },
];
const opportunities = [
  { id: 'o1', serialNumber: 'OP000001', title: 'Meleiha compressor overhaul', client: 'AGIBA', stage: 'Bid Preparation',
    submissionDeadline: off(4), ownerName: 'Mona Fathy', lastFollowUpAt: ts(-1),
    checklist: [
      { id: 'c1', title: 'Bid bond requested', dueDate: off(-1), done: false },
      { id: 'c2', title: 'Technical offer', dueDate: off(2), done: false },
      { id: 'c3', title: 'Documents purchased', dueDate: off(-10), done: true },
    ] },
  { id: 'o2', serialNumber: 'OP000002', title: 'Gas plant revamp', client: 'agiba', stage: 'Submitted',
    submissionDeadline: off(-5), ownerName: 'Ahmed Samir', checklist: [{ id: 'c4', title: 'Signed and sealed', dueDate: off(-6), done: false }] },
  { id: 'o3', serialNumber: 'OP000003', title: 'Pipeline 2025', client: 'AGIBA', stage: 'Won', decisionDate: off(-100), ownerName: 'Mona Fathy' },
  { id: 'o4', serialNumber: 'OP000004', title: 'Flare 2024', client: 'AGIBA', stage: 'Lost', decisionDate: off(-300) },
  { id: 'o5', serialNumber: 'OP000005', title: 'APC jetty', client: 'APC', stage: 'Identified', submissionDeadline: off(30) },
  { id: 'o6', serialNumber: 'OP000006', title: 'Late quote', client: 'AGIBA', stage: 'Identified', submissionDeadline: off(-3), ownerName: 'Ahmed Samir' },
  { id: 'o7', serialNumber: 'OP000007', title: 'No-bid thing', client: 'AGIBA', stage: 'No Bid' },
];
const correspondences = [
  // From them by sender
  { id: 'l1', serialNumber: 'CR000001', subject: 'Request for clarification', sentFrom: 'AGIBA Petroleum Co.', status: 'Assigned',
    assignedTo: 'Mona Fathy', dateReceived: off(-2), deadline: off(1), userId: 'u-sec' },
  // Linked to their project, sender internal
  { id: 'l2', serialNumber: 'CR000002', subject: 'Internal memo on Meleiha', sentFrom: 'Finance Department', projectId: 'p1',
    status: 'Closed', dateReceived: off(-10), userId: 'u-sec' },
  // Linked to their bid
  { id: 'l3', serialNumber: 'CR000003', subject: 'Bid bond letter', sentFrom: 'Bank', opportunityId: 'o1',
    status: 'Unread', dateReceived: off(-1), userId: 'u-sec' },
  // Another client
  { id: 'l4', serialNumber: 'CR000004', subject: 'APC invite', sentFrom: 'APC', status: 'Unread', dateReceived: off(-4), userId: 'u-sec' },
  // Mentions a lookalike — must not land on APC
  { id: 'l5', serialNumber: 'CR000005', subject: 'CAPCO offer', sentFrom: 'CAPCO', status: 'Unread', dateReceived: off(-4), userId: 'u-sec' },
  // Open, no deadline, from them in Arabic
  { id: 'l6', serialNumber: 'CR000006', subject: 'خطاب بخصوص المستخلص', sentFrom: 'شركة AGIBA للبترول', status: 'Reviewing', createdAt: ts(-6), userId: 'u-sec' },
];
const tasks = [
  { id: 't1', serialNumber: 'TK000001', taskName: 'Prepare pricing', status: 'In Progress', opportunityId: 'o1', opportunityTitle: 'Meleiha compressor overhaul', assignedTo: 'Ahmed Samir', dueDate: off(3) },
  { id: 't2', serialNumber: 'TK000002', taskName: 'Answer clarification', status: 'Pending', correspondingId: 'l1', correspondingSubject: 'Request for clarification', assignedTo: 'Mona Fathy', dueDate: off(-1) },
  { id: 't3', serialNumber: 'TK000003', taskName: 'Done already', status: 'Done', projectId: 'p1', dueDate: off(-5) },
  { id: 't4', serialNumber: 'TK000004', taskName: 'APC visit', status: 'Pending', projectId: 'p3', dueDate: off(1) },
  { id: 't5', serialNumber: 'TK000005', taskName: 'Undated task', status: 'Pending', projectId: 'p1', assignedTo: 'Mona Fathy' },
];
const contracts = [
  { id: 'k1', projectId: 'p1', contractNumber: '4600001234', subject: 'O&M services', contractValue: 1000000, currency: 'EGP', endDate: off(20), status: 'Running', inCharge: 'Mona Fathy' },
  { id: 'k2', projectId: 'p1', contractNumber: 'WA-1', subject: 'Work authorization', valueAfterIncrease: 50000, contractValue: 40000, currency: 'USD', endDate: off(-10), status: 'Running', inCharge: 'Mona Fathy' },
  { id: 'k3', projectId: 'p1', contractNumber: 'WA-2', subject: 'Closed WA', endDate: off(-30), status: 'Completed' },
  { id: 'k4', projectId: 'p1', contractNumber: 'WA-3', subject: 'Long one', endDate: off(CONTRACT_WARN_DAYS + 30), status: 'Running' },
  { id: 'k5', projectId: 'p1', contractNumber: 'WA-4', subject: 'No end date' },
  { id: 'k6', projectId: 'p2', contractNumber: 'OLD-1', subject: 'Old job contract', endDate: off(-200), status: 'منتهي' },
  { id: 'k7', projectId: 'p3', contractNumber: 'APC-1', subject: 'APC contract', endDate: off(10) },
];
const followUps = [
  { id: 'f1', opportunityId: 'o1', text: 'Called their planning manager', authorName: 'Mona Fathy', createdAt: ts(-1) },
  { id: 'f2', opportunityId: 'o5', text: 'APC call', authorName: 'Ahmed Samir', createdAt: ts(0) },
];
const projectUpdates = [
  { id: 'u1', projectId: 'p1', text: 'Mobilisation on track', authorName: 'Ahmed Samir', createdAt: ts(-3) },
];
const mails = [
  { id: 'm1', subject: 'RE: compressor overhaul', sender: 'Hassan (AGIBA)', sender_email: 'hassan@agiba.com.eg', to: '', direction: 'received', received_at: new Date(TODAY.getTime() - 2 * 3600e3).toISOString() },
  { id: 'm2', subject: 'Offer clarification', sender: 'Me', to: 'Hassan Ali; AGIBA Tenders', direction: 'sent', received_at: new Date(TODAY.getTime() - 26 * 3600e3).toISOString() },
  { id: 'm3', subject: 'Lunch', sender: 'Friend', to: 'Me', direction: 'received', received_at: new Date(TODAY.getTime() - 1 * 3600e3).toISOString() },
  { id: 'm4', subject: 'Invoice', sender: 'Accounts', sender_email: 'ap@agiba.com', to: 'Me', direction: 'received', received_at: new Date(TODAY.getTime() - 50 * 3600e3).toISOString() },
];
const input = { projects, opportunities, correspondences, tasks, contracts, followUps, projectUpdates, mails, userNames: { 'u-sec': 'Secretary Name' } };

// ── [3] listClients ──────────────────────────────────────────────────────────
const list = listClients(input);
eq(list.map(c => c.key).sort(), ['agiba', 'apc'], '[3] two clients; the client-less project adds none; CAPCO is not a client');
const agiba = list.find(c => c.key === 'agiba');
eq(agiba.name, 'AGIBA', '[3] the most-used spelling names the client');
eq(agiba.otherNames.sort(), ['Agiba Co.', 'agiba'], '[3] the other spellings are kept');
eq(agiba.projects, 2, '[3] AGIBA projects (both spellings)');
eq(agiba.activeProjects, 1, '[3] active projects');
eq(agiba.bids, 6, '[3] AGIBA bids');
eq(agiba.openBids, 3, '[3] open bids (Bid Prep + Submitted + Identified)');
eq(agiba.letters, 4, '[3] letters: sender ×2 (EN+AR), project link, bid link');
const apc = list.find(c => c.key === 'apc');
eq(apc.letters, 1, '[3] APC has its own letter only — CAPCO is not APC');
eq(list[0].key, 'agiba', '[3] newest activity first');
ok(agiba.lastActivity >= off(-1), '[3] last activity is recent');

// ── [4] buildClientFile — what we owe them ───────────────────────────────────
const file = buildClientFile('agiba', input, TODAY);
eq(file.name, 'AGIBA', '[4] name');
const owedTitles = file.owed.map(o => o.title);
ok(owedTitles.includes('Request for clarification'), '[4] open letter from them is owed');
ok(owedTitles.includes('Bid bond letter'), '[4] open letter linked to their bid is owed');
ok(owedTitles.includes('خطاب بخصوص المستخلص'), '[4] Arabic open letter is owed');
ok(!owedTitles.includes('Internal memo on Meleiha'), '[4] a closed letter is not owed');
ok(owedTitles.includes('Prepare pricing'), '[4] task linked to their bid');
ok(owedTitles.includes('Answer clarification'), '[4] task made from their letter');
ok(owedTitles.includes('Undated task'), '[4] undated task on their project');
ok(!owedTitles.includes('Done already'), '[4] a done task is not owed');
ok(!owedTitles.includes('APC visit'), '[4] another client\'s task is not owed');
ok(owedTitles.includes('Meleiha compressor overhaul'), '[4] a bid still in preparation = a submission owed');
ok(!owedTitles.includes('Gas plant revamp'), '[4] a submitted bid is not owed (waiting on them)');
ok(!owedTitles.includes('Signed and sealed'), '[4] steps of a submitted bid are not owed');
ok(owedTitles.includes('Late quote'), '[4] an Identified bid with a passed deadline is owed');
ok(owedTitles.includes('Bid bond requested'), '[4] late bid step is owed');
ok(owedTitles.includes('Technical offer'), '[4] bid step within the horizon is owed');
ok(!owedTitles.includes('Documents purchased'), '[4] a ticked step is not owed');
ok(owedTitles.includes('Performance bond'), '[4] late project step is owed');
ok(owedTitles.includes('Kick-off meeting'), '[4] project step within the horizon');
ok(!owedTitles.includes('First invoice'), '[4] a step beyond the horizon is not owed yet');
ok(!owedTitles.includes('Should not show'), '[4] steps of a completed project are not owed');

const lateOnes = file.owed.filter(o => o.late);
ok(lateOnes.length === 4, `[4] four late items (Late quote, Bid bond requested, Performance bond, Answer clarification) — got ${lateOnes.map(o => o.title)}`);
ok(file.owed.slice(0, lateOnes.length).every(o => o.late), '[4] late items come first');
eq(file.owed[0].title, 'Late quote', '[4] the longest-late item leads');
eq(file.owed[0].days, 3, '[4] …3 days late');
eq(file.owed[file.owed.length - 1].due, '', '[4] undated items come last');
const notLate = file.owed.filter(o => !o.late && o.due);
ok(notLate.every((o, i) => i === 0 || notLate[i - 1].due <= o.due), '[4] upcoming items soonest first');
const tech = file.owed.find(o => o.title === 'Technical offer');
eq([tech.kind, tech.days, tech.context, tech.open.type, tech.open.id], ['step', 2, 'Meleiha compressor overhaul', 'opportunity', 'o1'], '[4] a bid step opens its bid');
const pb = file.owed.find(o => o.title === 'Performance bond');
eq([pb.open.type, pb.open.id], ['project', 'p1'], '[4] a project step opens its project');
const at = file.owed.find(o => o.title === 'Answer clarification');
eq([at.kind, at.owner, at.open.type, at.open.serial], ['task', 'Mona Fathy', 'task', 'TK000002'], '[4] a task row carries owner + serial');
const rc = file.owed.find(o => o.title === 'Request for clarification');
eq([rc.kind, rc.due, rc.late, rc.days], ['letter', off(1), false, 1], '[4] the letter carries its deadline');

// ── [5] contacts ─────────────────────────────────────────────────────────────
eq(file.contacts[0].via, 'mail-in', '[5] the newest contact is the e-mail 2 h ago');
eq(file.contacts[0].them, 'Hassan (AGIBA)', '[5] …from their person');
ok(!file.contacts.some(c => c.what === 'Lunch'), '[5] a mail that does not name the client is left out');
ok(file.contacts.some(c => c.what === 'Invoice'), '[5] a mail from their domain counts even without the name');
const out = file.contacts.find(c => c.via === 'mail-out');
eq(out.them, 'Hassan Ali; AGIBA Tenders', '[5] a sent mail names who we wrote to');
const fu = file.contacts.find(c => c.via === 'bid-follow-up');
eq([fu.who, fu.open.id], ['Mona Fathy', 'o1'], '[5] bid follow-up: author + bid');
ok(!file.contacts.some(c => c.what === 'APC call'), '[5] another client\'s follow-up is left out');
const pu = file.contacts.find(c => c.via === 'project-update');
eq([pu.who, pu.open.type], ['Ahmed Samir', 'project'], '[5] project update: author + project');
const l6 = file.contacts.find(c => c.what === 'خطاب بخصوص المستخلص');
eq(l6.who, 'Secretary Name', '[5] an unassigned letter falls back to whoever entered it');
ok(file.contacts.every((c, i) => i === 0 || file.contacts[i - 1].at >= c.at), '[5] newest first');

// ── [6] people ───────────────────────────────────────────────────────────────
eq(file.people[0].name, 'Mona Fathy', '[6] the most involved person leads');
ok(file.people.some(p => p.name === 'Ahmed Samir'), '[6] Ahmed is on the file');
ok(!file.people.some(p => p.name === ''), '[6] no blank names');

// ── [7] contracts ────────────────────────────────────────────────────────────
eq(file.contracts.map(c => c.number).sort(), ['4600001234', 'OLD-1', 'WA-1', 'WA-2', 'WA-3', 'WA-4'], '[7] six AGIBA contracts (both projects), none of APC\'s');
eq(file.contracts[0].number, '4600001234', '[7] the one running out leads');
eq([file.contracts[0].expiry, file.contracts[0].daysLeft], ['soon', 20], '[7] …flagged with days left');
const wa1 = file.contracts.find(c => c.number === 'WA-1');
eq([wa1.expiry, wa1.value], ['ended', 50000], '[7] past end = ended; value after increase wins');
eq(file.contracts.find(c => c.number === 'WA-2').expiry, undefined, '[7] a completed contract is not flagged');
eq(file.contracts.find(c => c.number === 'OLD-1').expiry, undefined, '[7] Arabic «منتهي» status is not flagged');
eq(file.contracts.find(c => c.number === 'WA-3').expiry, undefined, '[7] a long contract is not flagged');
eq(file.contracts.find(c => c.number === 'WA-4').expiry, undefined, '[7] no end date = no flag');
eq(file.contracts[file.contracts.length - 1].expiry, 'ended', '[7] ended ones sink to the bottom');
eq(file.contracts[0].projectName, 'Meleiha O&M', '[7] contract row names its project');

// ── [8] bids, record, projects, letters ──────────────────────────────────────
eq(file.openBids.map(o => o.id), ['o2', 'o6', 'o1'], '[8] open bids by deadline');
eq(file.closedBids.map(o => o.id).slice(0, 2), ['o3', 'o4'], '[8] closed bids newest decision first');
eq(file.record, { won: 1, lost: 1, noBid: 1, cancelled: 0 }, '[8] our record with them');
eq(file.projects.map(p => p.id), ['p1', 'p2'], '[8] active projects first');
eq(file.letters.map(l => l.id), ['l3', 'l1', 'l6', 'l2'], '[8] letters newest first');
eq(file.mails.map(m => m.id), ['m1', 'm2', 'm4'], '[8] mails naming the client, newest first');

// ── [9] edges ────────────────────────────────────────────────────────────────
const bare = buildClientFile('agiba', { projects, opportunities, correspondences }, TODAY);
ok(bare.contacts.every(c => c.via === 'letter'), '[9] without the optional feeds only letters are contacts');
eq(bare.contracts, [], '[9] no contracts feed = no contracts');
ok(bare.owed.length > 0, '[9] owed still works without tasks');
const nobody = buildClientFile('unknown co', input, TODAY);
eq([nobody.name, nobody.owed.length, nobody.letters.length], ['unknown co', 0, 0], '[9] an unknown key gives an empty file, not a crash');
// A letter from "AGIBA Meleiha" is Meleiha's when Meleiha is a client too.
const withMeleiha = listClients({
  projects: [...projects, { id: 'p9', name: 'x', client: 'AGIBA Meleiha', status: 'Active' }],
  opportunities, correspondences: [{ id: 'z', subject: 's', sentFrom: 'AGIBA Meleiha', status: 'Unread' }],
});
eq([withMeleiha.find(c => c.key === 'agiba').letters, withMeleiha.find(c => c.key === 'agiba meleiha').letters], [0, 1], '[9] the longer client name wins a letter');
eq(dayOf('2026-03-05'), '2026-03-05', '[9] dayOf keeps a plain day');
eq(dayOf(''), '', '[9] dayOf empty');
eq(toMs(null), 0, '[9] toMs null');
ok(toMs('2026-03-05') === new Date(2026, 2, 5, 12).getTime(), '[9] a plain day is local noon');

console.log(`clientfile: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  ✗', f);
process.exit(fails.length ? 1 : 0);
