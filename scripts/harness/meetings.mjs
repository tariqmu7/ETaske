// Harness for src/lib/meetings.ts -> the meeting helper (queue D5).
//
// Bundles the REAL module with esbuild. No network, no Firebase.
//
//   node scripts/harness/meetings.mjs
//
// Covers: validation + the stored shape, the stages and the list order, who
// may edit, action points → task fields and their state, reading action
// points out of free notes (EN + AR), the series ("previous meeting"), agenda
// suggestions from every source, and the invitation + minutes in both
// languages (incl. an Arabic style sweep). Also cross-checks that every
// English key the page uses exists in both locale files.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);
const OUT = path.join(os.tmpdir(), 'meetings.bundle.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/meetings.ts')],
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

const BASE = new Date(2026, 8, 21); // Monday 21 Sep 2026 — every expectation is relative to it
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const off = n => { const d = new Date(BASE); d.setDate(d.getDate() + n); return iso(d); };
const TODAY = off(0);

const ME = { id: 'u-me', name: 'Tariq Mohamed' };
const PEOPLE = [ME, { id: 'u-mona', name: 'Mona Fathy' }, { id: 'u-ahmed', name: 'Ahmed Samir' }, { id: 'u-sara', name: 'سارة عبد الله' }];
const NAMES = Object.fromEntries(PEOPLE.map(p => [p.id, p.name]));

const meeting = (over = {}) => ({
  id: 'm1', title: 'Weekly BD meeting', date: TODAY, time: '10:00', place: 'Board room',
  attendeeIds: ['u-me', 'u-mona'], agenda: [], actions: [], createdById: 'u-me', createdBy: 'Tariq Mohamed', ...over,
});

// ── [1] Validation + stored shape ────────────────────────────────────────────
{
  eq(M.validateMeeting({ title: '', date: TODAY }), 'title', '[1] no title');
  eq(M.validateMeeting({ title: '  ', date: TODAY }), 'title', '[1] blank title');
  eq(M.validateMeeting({ title: 'x', date: '21/9/2026' }), 'date', '[1] bad date');
  eq(M.validateMeeting({ title: 'x', date: TODAY, time: '25:00' }), 'time', '[1] bad time');
  eq(M.validateMeeting({ title: 'x', date: TODAY, time: '09:30' }), null, '[1] good');
  eq(M.validateMeeting({ title: 'x', date: TODAY }), null, '[1] time optional');

  const f = M.meetingFields(meeting({
    title: '  Kick-off  ', place: '', guests: undefined,
    attendeeIds: ['u-me', 'u-me', 'u-mona'],
    opportunityId: '', opportunitySerial: 'OP1', projectId: 'p1', projectName: 'Meleiha',
    agenda: [{ id: 'a1', text: ' Scope ', notes: '' }, { id: 'a2', text: '   ' }],
    actions: [{ id: 'x1', text: 'Send offer', priority: 'High', due: 'bad' }, { id: 'x2', text: '' }],
  }));
  eq(f.title, 'Kick-off', '[1] title trimmed');
  ok(!('place' in f) && !('guests' in f), '[1] empty fields dropped, no undefined');
  eq(f.attendeeIds, ['u-me', 'u-mona'], '[1] attendees de-duplicated');
  ok(!('opportunitySerial' in f), '[1] bid serial dropped when no bid is linked');
  eq(f.projectName, 'Meleiha', '[1] project name kept with its id');
  eq(f.agenda.length, 1, '[1] blank agenda item dropped');
  eq(f.agenda[0], { id: 'a1', text: 'Scope' }, '[1] agenda item trimmed, empty notes dropped');
  eq(f.actions.length, 1, '[1] empty action dropped');
  ok(!('due' in f.actions[0]), '[1] a bad due date is not stored');
  ok(Object.values(f).every(v => v !== undefined), '[1] no undefined values anywhere at top level');
  ok(JSON.stringify(f).length > 0 && !JSON.stringify(f).includes('undefined'), '[1] serialises clean');
  const long = M.meetingFields(meeting({ agenda: Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, text: `Item ${i}` })) }));
  eq(long.agenda.length, M.MAX_AGENDA, '[1] agenda capped');
}

// ── [2] Stage, list order, rights ────────────────────────────────────────────
{
  eq(M.meetingStage(meeting({ date: off(3) }), TODAY), 'upcoming', '[2] future = upcoming');
  eq(M.meetingStage(meeting(), TODAY), 'today', '[2] today');
  eq(M.meetingStage(meeting({ date: off(-2) }), TODAY), 'needs-minutes', '[2] past, nothing written');
  eq(M.meetingStage(meeting({ date: off(-2), notes: 'x' }), TODAY), 'done', '[2] past with notes = done');
  eq(M.meetingStage(meeting({ date: off(-2), agenda: [{ id: 'a', text: 'A', decision: 'Go' }] }), TODAY), 'done', '[2] a decision counts');
  eq(M.meetingStage(meeting({ date: off(-2), actions: [{ id: 'x', text: 'Do', priority: 'Medium' }] }), TODAY), 'done', '[2] an action counts');
  eq(M.meetingStage(meeting({ date: off(-2), agenda: [{ id: 'a', text: 'A', notes: '  ' }] }), TODAY), 'needs-minutes', '[2] blank notes do not count');

  const L = M.listMeetings([
    meeting({ id: 'late', date: off(5) }), meeting({ id: 'soon', date: off(1), time: '09:00' }), meeting({ id: 'soon2', date: off(1), time: '08:00' }),
    meeting({ id: 'now', date: TODAY }), meeting({ id: 'old', date: off(-9) }), meeting({ id: 'old2', date: off(-2) }),
    meeting({ id: 'done1', date: off(-20), notes: 'x' }), meeting({ id: 'done2', date: off(-3), notes: 'y' }),
  ], TODAY);
  eq(L.upcoming.map(m => m.id), ['now', 'soon2', 'soon', 'late'], '[2] upcoming soonest first, by time within a day');
  eq(L.needsMinutes.map(m => m.id), ['old2', 'old'], '[2] needs-minutes newest first');
  eq(L.done.map(m => m.id), ['done2', 'done1'], '[2] done newest first');

  const m = meeting();
  ok(M.canEditMeeting(m, 'u-me', false), '[2] creator may edit');
  ok(M.canEditMeeting(m, 'u-mona', false), '[2] attendee may edit');
  ok(!M.canEditMeeting(m, 'u-ahmed', false), '[2] others may not');
  ok(M.canEditMeeting(m, 'u-ahmed', true), '[2] a manager may');
  ok(!M.canDeleteMeeting(m, 'u-mona', false), '[2] an attendee may NOT delete');
  ok(M.canDeleteMeeting(m, 'u-me', false) && M.canDeleteMeeting(m, 'u-x', true), '[2] creator / manager may delete');
  ok(M.isMyMeeting(m, 'u-mona') && !M.isMyMeeting(m, 'u-ahmed'), '[2] isMyMeeting');
}

// ── [3] Action points → tasks ────────────────────────────────────────────────
{
  const m = meeting({ opportunityId: 'op1', opportunitySerial: 'OP000012', opportunityTitle: 'Algeria pipeline', projectId: '', projectName: 'x' });
  const by = { uid: 'u-me', name: 'Tariq Mohamed', teamId: 'T1', department: 'Business Development' };
  const f = M.actionTaskFields({ id: 'x', text: ' Send the revised offer ', ownerId: 'u-mona', ownerName: 'Mona Fathy', due: off(3), priority: 'High' }, m, by, 'en');
  eq(f.taskName, 'Send the revised offer', '[3] task name trimmed');
  eq([f.assignedToId, f.assignedTo], ['u-mona', 'Mona Fathy'], '[3] owner → assignee');
  eq([f.assignedById, f.assignedBy], ['u-me', 'Tariq Mohamed'], '[3] creator → assigner (the rules check assignedById)');
  eq(f.status, 'Pending', '[3] Pending');
  eq(f.priority, 'High', '[3] priority kept');
  eq(f.dueDate, off(3), '[3] due → dueDate (not deadline)');
  eq(f.isPrivate, false, '[3] public');
  eq([f.meetingId, f.meetingTitle], ['m1', 'Weekly BD meeting'], '[3] carries the meeting');
  eq([f.opportunityId, f.opportunitySerial], ['op1', 'OP000012'], '[3] carries the bid link');
  ok(!('projectId' in f) && !('projectName' in f), '[3] no project link when none is set');
  eq(f.category, 'Internal', '[3] Internal when no project');
  ok(/From the meeting "Weekly BD meeting" on 21\/09\/2026\./.test(f.description), `[3] EN description — ${f.description}`);
  ok(Object.values(f).every(v => v !== undefined), '[3] no undefined values');
  const g = M.actionTaskFields({ id: 'y', text: 'Call them', priority: 'Medium' }, meeting({ projectId: 'p1', projectName: 'Meleiha' }), by, 'ar');
  eq([g.assignedToId, g.assignedTo], ['u-me', 'Tariq Mohamed'], '[3] no owner → the creator');
  eq(g.dueDate, null, '[3] no date → null');
  eq(g.category, 'Project', '[3] Project when a project is linked');
  eq(g.description, 'من اجتماع «Weekly BD meeting» بتاريخ 21/09/2026.', '[3] AR description');

  const tasks = new Map([
    ['t1', { id: 't1', status: 'Done' }], ['t2', { id: 't2', status: 'Pending', dueDate: off(-1) }],
    ['t3', { id: 't3', status: 'In Progress', dueDate: off(2) }], ['t4', { id: 't4', status: 'Archived' }],
  ]);
  const acts = [
    { id: 'a', text: 'A', taskId: 't1' }, { id: 'b', text: 'B', taskId: 't2' }, { id: 'c', text: 'C', taskId: 't3' },
    { id: 'd', text: 'D', taskId: 't4' }, { id: 'e', text: 'E', taskId: 'gone' }, { id: 'f', text: 'F' },
  ];
  eq(acts.map(a => M.actionState(a, tasks, TODAY)), ['done', 'late', 'open', 'done', 'gone', 'draft'], '[3] action states');
  eq(M.actionSummary(acts, tasks, TODAY), { total: 6, created: 5, done: 2, late: 1, drafts: 1 }, '[3] summary');
  eq(M.readyActions([...acts, { id: 'g', text: '  ' }]).map(a => a.id), ['f'], '[3] only drafts with words are ready');
}

// ── [4] Action points out of the notes ───────────────────────────────────────
{
  const ctx = { me: ME, people: PEOPLE, today: BASE };
  const notes = [
    'We reviewed the scope with the client.',
    '- Mona to send the revised offer by Thursday',
    'Action: book the site visit',
    '• I will call AGIBA tomorrow',
    'I think the price is high.',
    '1. Ahmed should prepare the HSE plan next week',
    'إجراء: مراجعة العقد مع الشؤون القانونية',
    'تتولى سارة إعداد جدول الكميات يوم الخميس',
    'ok',
  ].join('\n');
  const got = M.actionsFromNotes(notes, ctx);
  const texts = got.map(a => a.text);
  eq(got.length, 6, `[4] six action lines found — ${JSON.stringify(texts)}`);
  const mona = got.find(a => /revised offer/.test(a.text));
  ok(!!mona && mona.ownerId === 'u-mona' && mona.ownerName === 'Mona Fathy', '[4] "Mona to …" → Mona');
  const thursday = off(3); // Mon 21 → Thu 24
  ok(!!mona && mona.due === thursday, `[4] "by Thursday" → ${thursday}, got ${mona && mona.due}`);
  ok(!!mona && mona.text.startsWith('Mona to send'), '[4] the bullet is stripped, the words kept');
  const visit = got.find(a => /site visit/.test(a.text));
  ok(!!visit && !visit.ownerId, '[4] marked line with nobody named → no owner');
  ok(!!visit && visit.text === 'Book the site visit', `[4] "Action:" marker stripped, capitalised — ${visit && visit.text}`);
  const call = got.find(a => /call AGIBA/i.test(a.text));
  ok(!!call && call.ownerId === 'u-me' && call.due === off(1), '[4] "I will … tomorrow" → me, tomorrow');
  ok(!texts.some(t => /price is high/.test(t)), '[4] an opinion is not an action');
  ok(!texts.some(t => /reviewed the scope/.test(t)), '[4] a plain statement is not an action');
  const ahmed = got.find(a => /HSE/.test(a.text));
  ok(!!ahmed && ahmed.ownerId === 'u-ahmed', '[4] numbered line "Ahmed should …" → Ahmed');
  const legal = got.find(a => /العقد/.test(a.text));
  ok(!!legal && legal.text === 'مراجعة العقد مع الشؤون القانونية', `[4] «إجراء:» marker stripped — ${legal && legal.text}`);
  const sara = got.find(a => /الكميات/.test(a.text));
  ok(!!sara && sara.ownerId === 'u-sara', '[4] «تتولى سارة …» → Sara');
  ok(!!sara && sara.due === thursday, `[4] «يوم الخميس» → Thursday, got ${sara && sara.due}`);
  ok(got.every(a => a.priority), '[4] every draft has a priority');
  ok(new Set(got.map(a => a.id)).size === got.length, '[4] unique ids');
  eq(M.actionsFromNotes(notes, ctx, got).length, 0, '[4] running it again adds nothing');
  eq(M.actionsFromNotes('', ctx).length, 0, '[4] empty notes → none');
  eq(M.minutesText({ agenda: [{ id: 'a', text: 'A', notes: 'n1', decision: 'd1' }, { id: 'b', text: 'B' }], notes: 'n2' }), 'n1\nd1\nn2', '[4] minutesText order');
}

// ── [5] Series ───────────────────────────────────────────────────────────────
{
  eq(M.seriesKey('Weekly BD meeting 14/9'), 'weekly bd meeting', '[5] numbers dropped');
  eq(M.seriesKey('Weekly BD Meeting – 21 Sep'), 'weekly bd meeting', '[5] month + dash dropped');
  eq(M.seriesKey('اجتماع الإدارة الأسبوعي ٢١/٩'), M.seriesKey('اجتماع الادارة الاسبوعي 14/9'), '[5] Arabic digits + hamza folded');
  const all = [
    meeting({ id: 'w1', title: 'Weekly BD meeting 7/9', date: off(-14) }),
    meeting({ id: 'w2', title: 'Weekly BD meeting 14/9', date: off(-7) }),
    meeting({ id: 'x', title: 'Supplier call', date: off(-1) }),
    meeting({ id: 'bid', title: 'Kick-off', date: off(-3), opportunityId: 'op1' }),
    meeting({ id: 'w3', title: 'Weekly BD meeting 28/9', date: off(7) }),
  ];
  eq(M.previousMeeting(meeting({ title: 'Weekly BD meeting 21/9' }), all)?.id, 'w2', '[5] the latest earlier one of the series');
  eq(M.previousMeeting(meeting({ title: 'Something new' }), all), null, '[5] no series → none');
  eq(M.previousMeeting(meeting({ title: 'Pricing review', opportunityId: 'op1' }), all)?.id, 'bid', '[5] same bid = same series');
  eq(M.previousMeeting(meeting({ id: 'w2', title: 'Weekly BD meeting 14/9', date: off(-7) }), all)?.id, 'w1', '[5] never itself');
}

// ── [6] Agenda suggestions ───────────────────────────────────────────────────
{
  const prev = meeting({
    id: 'prev', title: 'Weekly BD meeting 14/9', date: off(-7),
    actions: [
      { id: 'pa1', text: 'Send the revised offer', ownerId: 'u-mona', ownerName: 'Mona Fathy', due: off(-1), priority: 'High', taskId: 'tp1', taskSerial: 'TK000101' },
      { id: 'pa2', text: 'Book the site visit', priority: 'Medium', taskId: 'tp2' },
      { id: 'pa3', text: 'Never made a task', priority: 'Medium' },
    ],
  });
  const tasks = [
    { id: 'tp1', taskName: 'Send the revised offer', status: 'In Progress', assignedToId: 'u-mona', dueDate: off(-1) },
    { id: 'tp2', taskName: 'Book the site visit', status: 'Done', assignedToId: 'u-me' },
    { id: 't-bid', taskName: 'Price the bill of quantities', status: 'Pending', assignedToId: 'u-ahmed', assignedTo: 'Ahmed Samir', opportunityId: 'op1', dueDate: off(4), serialNumber: 'TK000200' },
    { id: 't-late-mona1', taskName: 'Late 1', status: 'Pending', assignedToId: 'u-mona', dueDate: off(-10) },
    { id: 't-late-mona2', taskName: 'Late 2', status: 'Pending', assignedToId: 'u-mona', dueDate: off(-9) },
    { id: 't-late-mona3', taskName: 'Late 3', status: 'Pending', assignedToId: 'u-mona', dueDate: off(-8) },
    { id: 't-late-mona4', taskName: 'Late 4', status: 'Pending', assignedToId: 'u-mona', dueDate: off(-7) },
    { id: 't-late-collab', taskName: 'Late as collaborator', status: 'Pending', assignedToId: 'u-ahmed', collaboratorIds: ['u-me'], dueDate: off(-2) },
    { id: 't-late-other', taskName: 'Not an attendee', status: 'Pending', assignedToId: 'u-ahmed', dueDate: off(-3) },
    { id: 't-done-late', taskName: 'Done late', status: 'Done', assignedToId: 'u-mona', dueDate: off(-5) },
  ];
  const bids = [
    { id: 'op1', title: 'Algeria pipeline', client: 'Petrojet', stage: 'Bid Preparation', submissionDeadline: off(10), serialNumber: 'OP000012',
      checklist: [
        { id: 's1', title: 'Site visit', dueDate: off(2), done: false },
        { id: 's2', title: 'Pricing', dueDate: off(30), done: false },
        { id: 's3', title: 'Documents', dueDate: off(-1), done: true },
      ] },
    { id: 'op2', title: 'Petrojet tank farm', client: 'PETROJET Co.', stage: 'Submitted', serialNumber: 'OP000013' },
    { id: 'op3', title: 'Other client bid', client: 'AGIBA', stage: 'Bid Preparation', submissionDeadline: off(3), serialNumber: 'OP000014' },
    { id: 'op4', title: 'Far bid', client: 'Petrojet', stage: 'Identified', submissionDeadline: off(60) },
  ];
  const letters = [
    { id: 'L1', subject: 'Clarification request', sentFrom: 'Petrojet', status: 'Assigned', deadline: off(2), serialNumber: 'CR000045' },
    { id: 'L2', subject: 'Closed letter', sentFrom: 'Petrojet', status: 'Closed' },
    { id: 'L3', subject: 'From CAPCO', sentFrom: 'CAPCO', status: 'Unread' },
    { id: 'L4', subject: 'Linked by id', sentFrom: 'Someone', status: 'Reviewing', opportunityId: 'op1' },
  ];
  const input = (m, extra = {}) => ({ meeting: m, meetings: [prev], tasks, letters, bids, projects: [], userNames: NAMES, ...extra });

  const m = meeting({ title: 'Weekly BD meeting 21/9', opportunityId: 'op1', opportunityTitle: 'Algeria pipeline' });
  const s = M.suggestAgenda(input(m), TODAY);
  const keys = s.map(x => x.key);
  ok(keys.includes('carry:prev:pa1'), '[6] unfinished action from last meeting carried');
  ok(keys.includes('carry:prev:pa3'), '[6] an action that never became a task is carried too');
  ok(!keys.includes('carry:prev:pa2'), '[6] a DONE action is not carried');
  const c1 = s.find(x => x.key === 'carry:prev:pa1');
  ok(c1.owner === 'Mona Fathy' && c1.days === -1 && c1.ref.serial === 'TK000101', '[6] carry keeps owner, lateness, task ref');
  eq(s[0].source, 'carry', '[6] carried items come first');
  ok(keys.includes('bid:op1'), '[6] the linked bid’s deadline');
  eq(s.find(x => x.key === 'bid:op1').source, 'bid-deadline', '[6] …as a deadline');
  eq(s.find(x => x.key === 'bid:op1').days, 10, '[6] …in 10 days');
  ok(keys.includes('bid:op2'), '[6] same client ("PETROJET Co." = "Petrojet"): submitted bid awaiting decision');
  eq(s.find(x => x.key === 'bid:op2').source, 'bid-decision', '[6] …as awaiting decision');
  ok(!keys.includes('bid:op3'), '[6] another client’s bid is out of scope');
  ok(!keys.includes('bid:op4'), '[6] a deadline 60 days out is not agenda material');
  ok(keys.includes('step:op1:s1'), '[6] checklist step due in 2 days');
  ok(!keys.includes('step:op1:s2'), '[6] a step 30 days out is not');
  ok(!keys.includes('step:op1:s3'), '[6] a ticked step is not');
  eq(s.find(x => x.key === 'step:op1:s1').on, 'Algeria pipeline', '[6] the step says which bid');
  ok(keys.includes('task:t-bid'), '[6] open task on the linked bid');
  ok(!keys.includes('task:tp1'), '[6] a task already carried from last meeting is not suggested a second time');
  eq(s.find(x => x.key === 'task:t-bid').source, 'open-task', '[6] …not late → open-task');
  ok(keys.includes('letter:L1') && keys.includes('letter:L4'), '[6] open letters: by client name and by link');
  ok(!keys.includes('letter:L2'), '[6] a closed letter is not');
  ok(!keys.includes('letter:L3'), '[6] CAPCO is not Petrojet');
  const lateMona = keys.filter(k => k.startsWith('task:t-late-mona'));
  eq(lateMona.length, M.LATE_PER_PERSON, '[6] at most 3 late tasks per attendee');
  ok(lateMona.includes('task:t-late-mona1'), '[6] …the longest-late first');
  ok(keys.includes('task:t-late-collab'), '[6] a collaborator’s late task counts for that attendee');
  ok(!keys.includes('task:t-late-other'), '[6] a non-attendee’s late task stays off a scoped agenda');
  ok(!keys.includes('task:t-done-late'), '[6] done tasks never');
  ok(s.length <= M.MAX_SUGGESTIONS, '[6] capped');
  ok(new Set(keys).size === keys.length, '[6] no duplicates');

  const withOne = M.suggestAgenda(input({ ...m, agenda: [{ id: 'a', text: 'x', key: 'bid:op1' }] }), TODAY);
  ok(!withOne.some(x => x.key === 'bid:op1'), '[6] a suggestion already on the agenda is not offered again');

  // No scope, no attendees: the department's week.
  const open = M.suggestAgenda(input(meeting({ id: 'm9', title: 'Something new', attendeeIds: [] }), { meetings: [] }), TODAY);
  const ok9 = open.map(x => x.key);
  ok(ok9.includes('bid:op3'), '[6] unscoped: any bid closing within 7 days');
  ok(!ok9.includes('bid:op1'), '[6] unscoped: a bid 10 days out is not');
  ok(ok9.filter(k => k.startsWith('task:')).length <= 5, '[6] unscoped: at most 5 late tasks');
  ok(!ok9.some(k => k.startsWith('letter:')), '[6] unscoped: letters are not dumped on the agenda');

  // A task created from THIS meeting is not suggested back to it.
  const own = M.suggestAgenda(input(m, { tasks: [...tasks, { id: 'mine', taskName: 'From here', status: 'Pending', opportunityId: 'op1', meetingId: 'm1', assignedToId: 'u-me', dueDate: off(-3) }] }), TODAY);
  ok(!own.some(x => x.key === 'task:mine'), '[6] tasks born in this meeting are not suggested back');
}

// ── [7] Invitation + minutes ─────────────────────────────────────────────────
{
  const m = meeting({
    title: 'Algeria pipeline — pricing review', date: off(2), time: '11:30', place: 'Room 4',
    attendeeIds: ['u-me', 'u-mona'], guests: 'Petrojet (2)', client: 'Petrojet',
    opportunityId: 'op1', opportunitySerial: 'OP000012', opportunityTitle: 'Algeria pipeline',
    agenda: [
      { id: 'a1', text: 'Price build-up', notes: 'Steel prices rose 8%.\nFreight quote pending.', decision: 'Hold the margin at 12%.' },
      { id: 'a2', text: 'Site visit' },
    ],
    notes: 'Next review in two weeks.',
    actions: [
      { id: 'x1', text: 'Update the steel price', ownerId: 'u-mona', ownerName: 'Mona Fathy', due: off(5), priority: 'High', taskSerial: 'TK000300' },
      { id: 'x2', text: 'Ask for the freight quote', priority: 'Medium' },
    ],
  });
  const ctx = { names: NAMES, from: 'Tariq Mohamed' };

  const inv = M.buildInvitation(m, ctx, 'en');
  eq(inv.subject, 'Meeting invitation: Algeria pipeline — pricing review — 23/09/2026', '[7] EN invitation subject');
  ok(inv.body.includes('on Wednesday 23/09/2026 at 11:30, Room 4'), `[7] EN when + where — ${inv.body.split('\n')[2]}`);
  ok(inv.body.includes('1. Price build-up\n2. Site visit'), '[7] EN agenda numbered');
  ok(inv.body.includes('Bid: OP000012 — Algeria pipeline · Client: Petrojet'), '[7] EN linked line');
  ok(inv.body.trim().endsWith('Tariq Mohamed'), '[7] EN signed');

  const invAr = M.buildInvitation(m, ctx, 'ar');
  eq(invAr.subject, 'دعوة إلى اجتماع: Algeria pipeline — pricing review — 23/09/2026', '[7] AR invitation subject');
  ok(invAr.body.includes('يوم الأربعاء 23/09/2026 الساعة 11:30، في Room 4'), '[7] AR when + where');
  ok(invAr.body.includes('جدول الأعمال:\n1. Price build-up'), '[7] AR agenda');
  ok(invAr.body.includes('المناقصة: OP000012 — Algeria pipeline'), '[7] AR linked line');

  const min = M.buildMinutes(m, ctx, 'en');
  eq(min.subject, 'Minutes of meeting: Algeria pipeline — pricing review — 23/09/2026', '[7] EN minutes subject');
  ok(min.body.includes('Attendees: Tariq Mohamed, Mona Fathy; guests: Petrojet (2)'), '[7] EN attendees + guests');
  ok(min.body.includes('   Discussed: Steel prices rose 8%.\n   Freight quote pending.'), '[7] EN notes, multi-line');
  ok(min.body.includes('   Decision: Hold the margin at 12%.'), '[7] EN decision');
  ok(min.body.includes('2. Site visit\n   Not discussed.'), '[7] EN an empty item says so');
  ok(min.body.includes('OTHER NOTES\n- Next review in two weeks.') && min.body.includes('AGENDA — WHAT WAS DISCUSSED AND DECIDED\n1. Price build-up'), '[7] EN section headings, unnumbered (only the items are)');
  ok(min.body.includes('1. Update the steel price (TK000300) — Owner: Mona Fathy — Due: 26/09/2026'), '[7] EN action with serial, owner, date');
  ok(min.body.includes('2. Ask for the freight quote — Owner: not set — Due: no date'), '[7] EN action without owner / date');
  ok(min.body.trim().endsWith('Minutes by: Tariq Mohamed'), '[7] EN signed');

  const minAr = M.buildMinutes(m, ctx, 'ar');
  ok(minAr.body.startsWith('محضر اجتماع: Algeria pipeline'), '[7] AR heading');
  ok(minAr.body.includes('التاريخ: الأربعاء 23/09/2026 — الساعة 11:30'), '[7] AR date line');
  ok(minAr.body.includes('الحضور: Tariq Mohamed، Mona Fathy، ومن الخارج: Petrojet (2)'), '[7] AR attendees with Arabic comma');
  ok(minAr.body.includes('أولًا: بنود جدول الأعمال وما دار فيها'), '[7] AR first section');
  ok(minAr.body.includes('ثانيًا: ملاحظات أخرى') && minAr.body.includes('ثالثًا: المهام المطلوبة'), '[7] AR section ordinals');
  ok(minAr.body.includes('   ما نوقش: Steel prices rose 8%.') && minAr.body.includes('   القرار: Hold the margin at 12%.'), '[7] AR notes + decision');
  ok(minAr.body.includes('لم يُناقَش هذا البند.'), '[7] AR empty item');
  ok(minAr.body.includes('— المسؤول: لم يُحدَّد — الموعد: دون موعد'), '[7] AR unset owner / date');
  ok(minAr.body.trim().endsWith('أعدّ المحضر: Tariq Mohamed'), '[7] AR signed');

  // Sections left out when empty.
  const bare = M.buildMinutes(meeting({ agenda: [], notes: '', actions: [] }), ctx, 'en');
  ok(!/Agenda|Other notes|Action points/.test(bare.body), '[7] no empty sections');
  const onlyActs = M.buildMinutes(meeting({ actions: [{ id: 'z', text: 'Z', priority: 'Low' }] }), ctx, 'ar');
  ok(onlyActs.body.includes('أولًا: المهام المطلوبة'), '[7] AR numbering starts at the first section present');

  // Arabic style sweep over every Arabic text this module writes.
  const arTexts = [invAr.subject, invAr.body, minAr.subject, minAr.body, onlyActs.body,
    M.buildInvitation(meeting({ agenda: [] }), ctx, 'ar').body,
    M.actionTaskFields({ id: 'q', text: 'q', priority: 'Low' }, m, { uid: 'u', name: 'n' }, 'ar').description];
  for (const [i, s] of arTexts.entries()) {
    ok(!/(^|[\s«])(تم|تمت|يتم|بواسطة|القيام)(?=[\s»،.]|$)/m.test(s), `[7] AR text ${i}: no «تم/يتم/بواسطة/القيام»`);
    ok(!/الخاص(ة)? ب/.test(s), `[7] AR text ${i}: no «الخاص بـ»`);
    ok(!/[٠-٩]/.test(s), `[7] AR text ${i}: no Arabic-Indic digits`);
    ok(!/[؀-ۿ]\s*,/.test(s) && !/[؀-ۿ]\s*\?/.test(s), `[7] AR text ${i}: no Latin comma / question mark after Arabic`);
  }

  eq(M.numericDate('2026-09-05'), '05/09/2026', '[7] numeric date');
  eq(M.numericDate('nope'), '', '[7] bad date → empty');
  const url = M.meetingMailto({ subject: 'S & T', body: 'a\nb' }, ['a@x.com', 'b@y.com']);
  ok(url.startsWith('mailto:a%40x.com,b%40y.com?subject=S%20%26%20T&body=a%0Ab'), `[7] mailto — ${url}`);
}

// ── [8] Page address ─────────────────────────────────────────────────────────
{
  eq(M.meetingHash('abc'), '#/meetings?id=abc', '[8] hash for one');
  eq(M.meetingHash(null), '#/meetings', '[8] hash for the list');
  eq(M.meetingFromHash('#/meetings?id=abc_1-2'), 'abc_1-2', '[8] read back');
  eq(M.meetingFromHash('#/meetings'), null, '[8] list → null');
  eq(M.meetingFromHash('#/tasks?id=abc'), null, '[8] another view → null');
  eq(M.meetingFromHash('#/meetings?id=<script>'), null, '[8] junk id refused');
}

// ── [9] Locale keys the page uses exist in both files ────────────────────────
{
  const page = fs.existsSync(path.join(ROOT, 'src/MeetingsDashboard.tsx')) ? fs.readFileSync(path.join(ROOT, 'src/MeetingsDashboard.tsx'), 'utf8') : '';
  const en = fs.readFileSync(path.join(ROOT, 'src/locales/en.ts'), 'utf8');
  const ar = fs.readFileSync(path.join(ROOT, 'src/locales/ar.ts'), 'utf8');
  const keys = new Set();
  for (const re of [/\bt\(\s*'((?:[^'\\]|\\.)+)'/g, /\bt\(\s*"((?:[^"\\]|\\.)+)"/g]) {
    for (const mm of page.matchAll(re)) keys.add(mm[1].replace(/\\'/g, "'"));
  }
  const has = (src, k) => src.includes(JSON.stringify(k) + ':');
  const missingEn = [...keys].filter(k => !has(en, k));
  const missingAr = [...keys].filter(k => !has(ar, k));
  ok(keys.size > 40, `[9] the page uses ${keys.size} keys`);
  eq(missingEn, [], '[9] every key is in en.ts');
  eq(missingAr, [], '[9] every key is in ar.ts');
}

console.log(`${pass}/${pass + fails.length} passed`);
if (fails.length) {
  console.log('\nFAILED:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
