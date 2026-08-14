import * as XLSX from 'xlsx';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { db, auth } from './firebase';
import { getVisibleTasks } from './taskVisibility';
import firebaseConfig from '../../firebase-applet-config.json';

const PROJECT_ID = firebaseConfig.projectId;
const DATABASE_ID = firebaseConfig.firestoreDatabaseId || '(default)';

// Collections included in a full backup. `messages` (1:1 chat) and the legacy
// `followUps` collection are listed but will be skipped at runtime if Firestore
// rules deny an unfiltered read from the browser — chat is participant-scoped
// with no admin bypass (see firestore.rules). For a guaranteed-complete backup
// that includes chat, use the server-side `npm run firestore:backup`.
const BACKUP_COLLECTIONS = [
  'correspondences',
  'tasks',
  'milestones',
  'users',
  'notifications',
  'announcements',
  'messages',
  'followUps',
  // Projects — these were missing, so a "full" backup silently omitted the
  // whole projects module.
  'projects',
  'projectFinancials',
  'projectUpdates',
  // Opportunities module — the bid pipeline plus the three child collections
  // the analytics view is computed from. Losing the feedback records would lose
  // the loss analysis, which cannot be reconstructed from the opportunity docs.
  'opportunities',
  'opportunityFollowUps',
  'opportunityMilestones',
  'opportunityFeedback',
] as const;

// ── Firestore REST value encoding ─────────────────────────────────────────────
// Produces the same typed-value shape the REST API returns, so backups made
// here can be restored with the existing `npm run firestore:restore` script
// (it PATCHes `{ fields: doc.fields }` back to `documents/{path}`).
function toRestValue(v: any): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Timestamp) return { timestampValue: v.toDate().toISOString() };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  const t = typeof v;
  if (t === 'boolean') return { booleanValue: v };
  if (t === 'string') return { stringValue: v };
  if (t === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toRestValue) } };
  }
  if (t === 'object') {
    const fields: Record<string, any> = {};
    for (const k of Object.keys(v)) fields[k] = toRestValue(v[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function toRestFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const k of Object.keys(data)) fields[k] = toRestValue(data[k]);
  return fields;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Filesystem-safe timestamp, e.g. 2026-05-18T12-34-56-789Z (matches the
// naming used by scripts/firestore-backup.ts).
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export interface BackupResult {
  fileName: string;
  collections: Record<string, number>;
  skipped: { collection: string; reason: string }[];
}

// Full database backup → JSON compatible with scripts/firestore-restore.ts.
// Reads run under the signed-in admin's Firestore rules; any collection the
// browser cannot read (chat, legacy) is skipped and reported, never thrown.
export async function downloadFullBackup(): Promise<BackupResult> {
  const backup: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  const skipped: { collection: string; reason: string }[] = [];

  const uid = auth.currentUser?.uid ?? '';

  for (const name of BACKUP_COLLECTIONS) {
    try {
      // `tasks` can't be read with one unfiltered query anymore (private tasks
      // would trip the rules); read the public-OR-mine union instead. Other
      // users' private tasks aren't included in a browser backup — use the
      // server-side `npm run firestore:backup` for a complete copy.
      if (name === 'tasks') {
        const tasks = await getVisibleTasks(uid);
        backup[name] = tasks.map(({ id, ...data }) => ({
          name: `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${name}/${id}`,
          fields: toRestFields(data),
        }));
        counts[name] = tasks.length;
        continue;
      }
      const snap = await getDocs(collection(db, name));
      backup[name] = snap.docs.map(d => ({
        name: `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${name}/${d.id}`,
        fields: toRestFields(d.data()),
      }));
      counts[name] = snap.size;
    } catch (e: any) {
      const reason =
        e?.code === 'permission-denied'
          ? 'Blocked by Firestore rules in the browser — use `npm run firestore:backup` for this collection.'
          : e?.message || 'Failed to read';
      skipped.push({ collection: name, reason });
    }
  }

  const fileName = `firestore-backup-${stamp()}.json`;
  downloadBlob(
    fileName,
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  );
  return { fileName, collections: counts, skipped };
}

// ── Excel workbook export ─────────────────────────────────────────────────────

// Render any Firestore value into a single readable spreadsheet cell.
function cell(v: any): string | number | boolean {
  if (v === null || v === undefined) return '';
  if (v instanceof Timestamp) return v.toDate().toLocaleString('en-GB');
  if (v instanceof Date) return v.toLocaleString('en-GB');
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v
      .map(x => (x && typeof x === 'object' ? x.text ?? JSON.stringify(x) : String(x)))
      .join(' | ');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// [docKey, columnHeader] — fixed order so the sheet is stable and readable.
const CORRESPONDENCE_COLUMNS: [string, string][] = [
  ['serialNumber', 'Serial'],
  ['subject', 'Subject'],
  ['body', 'Body'],
  ['sentFrom', 'Sent From'],
  ['department', 'Department'],
  ['category', 'Category'],
  ['subCategory', 'Sub-Category'],
  ['priority', 'Priority'],
  ['status', 'Status'],
  ['dateReceived', 'Date Received'],
  ['deadline', 'Deadline'],
  ['actions', 'Actions'],
  ['assignedTo', 'Assigned To'],
  ['assignedToId', 'Assigned To (uid)'],
  ['assignedAt', 'Assigned At'],
  ['convertedToTaskId', 'Converted Task ID'],
  ['notes', 'Manager Notes'],
  ['attachedFileName', 'Attachment Name'],
  ['attachedFile', 'Attachment URL'],
  ['filePaths', 'File Paths'],
  ['userId', 'Created By (uid)'],
  ['teamId', 'Team'],
  ['createdAt', 'Created At'],
  ['updatedAt', 'Updated At'],
  ['id', 'Doc ID'],
];

const TASK_COLUMNS: [string, string][] = [
  ['serialNumber', 'Serial'],
  ['taskName', 'Task Name'],
  ['description', 'Description'],
  ['priority', 'Priority'],
  ['status', 'Status'],
  ['isPrivate', 'Private'],
  ['category', 'Category'],
  ['subCategory', 'Sub-Category'],
  ['department', 'Department'],
  ['assignedTo', 'Assigned To'],
  ['assignedToId', 'Assigned To (uid)'],
  ['assignedBy', 'Assigned By'],
  ['assignedById', 'Assigned By (uid)'],
  ['dueDate', 'Due Date'],
  ['statusUpdate', 'Status Update'],
  ['milestoneCount', 'Milestones'],
  ['completedMilestones', 'Completed Milestones'],
  ['correspondingSerialNumber', 'Source Corr. Serial'],
  ['correspondingSubject', 'Source Corr. Subject'],
  ['correspondingId', 'Source Corr. ID'],
  ['notes', 'Notes'],
  ['attachedFileName', 'Attachment Name'],
  ['attachedFile', 'Attachment URL'],
  ['filePaths', 'File Paths'],
  ['archivedAt', 'Archived At'],
  ['userId', 'Created By (uid)'],
  ['teamId', 'Team'],
  ['createdAt', 'Created At'],
  ['updatedAt', 'Updated At'],
  ['id', 'Doc ID'],
];

const OPPORTUNITY_COLUMNS: [string, string][] = [
  ['serialNumber', 'Serial'],
  ['title', 'Title'],
  ['client', 'Client'],
  ['sector', 'Sector'],
  ['location', 'Location'],
  ['tenderNumber', 'Tender / RFQ No.'],
  ['source', 'Source'],
  ['stage', 'Stage'],
  ['probability', 'Win %'],
  ['estimatedValue', 'Estimated Value'],
  ['currency', 'Currency'],
  ['weightedValue', 'Weighted Value'],
  ['announcedDate', 'Announced'],
  ['submissionDeadline', 'Submission Deadline'],
  ['submittedDate', 'Submitted On'],
  ['decisionDate', 'Decision Date'],
  ['ownerName', 'Bid Owner'],
  ['awardedTo', 'Awarded To'],
  ['awardedValue', 'Awarded Value'],
  ['scope', 'Scope'],
  ['lastFollowUpText', 'Last Follow-up'],
  ['nextActionDate', 'Next Action'],
  ['createdAt', 'Created At'],
  ['updatedAt', 'Updated At'],
  ['id', 'Doc ID'],
];

// The child sheets lead with the parent's serial + title so a row still says
// which bid it belongs to when the sheet is filtered or sorted on its own.
const OPPORTUNITY_FEEDBACK_COLUMNS: [string, string][] = [
  ['opportunitySerial', 'Bid Serial'],
  ['opportunityTitle', 'Bid Title'],
  ['outcome', 'Outcome'],
  ['primaryReason', 'Primary Reason'],
  ['reasons', 'All Reasons'],
  ['competitorName', 'Competitor'],
  ['ourPrice', 'Our Price'],
  ['winningPrice', 'Winning Price'],
  ['priceGapPercent', 'Price Gap %'],
  ['clientFeedback', 'Client Feedback'],
  ['lessonsLearned', 'Lessons Learned'],
  ['notes', 'Notes'],
  ['authorName', 'Recorded By'],
  ['createdAt', 'Created At'],
  ['updatedAt', 'Updated At'],
  ['id', 'Doc ID'],
];

const OPPORTUNITY_MILESTONE_COLUMNS: [string, string][] = [
  ['opportunitySerial', 'Bid Serial'],
  ['opportunityTitle', 'Bid Title'],
  ['title', 'Gate'],
  ['status', 'Status'],
  ['dueDate', 'Due Date'],
  ['completedDate', 'Completed Date'],
  ['slippageDays', 'Slippage (days)'],
  ['notes', 'Notes'],
  ['addedByName', 'Added By'],
  ['createdAt', 'Created At'],
  ['id', 'Doc ID'],
];

const OPPORTUNITY_FOLLOWUP_COLUMNS: [string, string][] = [
  ['opportunitySerial', 'Bid Serial'],
  ['opportunityTitle', 'Bid Title'],
  ['createdAt', 'Logged At'],
  ['authorName', 'Author'],
  ['stage', 'Stage At The Time'],
  ['text', 'Follow-up'],
  ['nextActionDate', 'Next Action'],
  ['id', 'Doc ID'],
];

const WIDE_KEYS = new Set([
  'subject', 'body', 'taskName', 'description', 'notes',
  'title', 'scope', 'text', 'lastFollowUpText', 'opportunityTitle',
  'clientFeedback', 'lessonsLearned', 'reasons',
]);

function buildSheet(rows: any[], columns: [string, string][]) {
  const headers = columns.map(c => c[1]);
  const data = rows.map(r => {
    const o: Record<string, any> = {};
    for (const [key, header] of columns) o[header] = cell(r[key]);
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: headers });
  ws['!cols'] = columns.map(([key]) => ({ wch: WIDE_KEYS.has(key) ? 45 : 18 }));
  return ws;
}

export interface ExcelResult {
  fileName: string;
  correspondences: number;
  tasks: number;
}

// Export all correspondences and tasks to a two-sheet .xlsx workbook.
// The per-collection serial-counter doc (`--stats--`) is excluded.
export async function exportToExcel(): Promise<ExcelResult> {
  const [corrSnap, visibleTasks] = await Promise.all([
    getDocs(collection(db, 'correspondences')),
    getVisibleTasks(auth.currentUser?.uid ?? ''),
  ]);
  const correspondences = corrSnap.docs
    .filter(d => d.id !== '--stats--')
    .map(d => ({ id: d.id, ...d.data() }));
  const tasks = visibleTasks;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(correspondences, CORRESPONDENCE_COLUMNS),
    'Correspondences'
  );
  XLSX.utils.book_append_sheet(wb, buildSheet(tasks, TASK_COLUMNS), 'Tasks');

  const fileName = `ETaske-export-${stamp()}.xlsx`;
  writeWorkbook(fileName, wb);
  return { fileName, correspondences: correspondences.length, tasks: tasks.length };
}

function writeWorkbook(fileName: string, wb: XLSX.WorkBook) {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    fileName,
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  );
}

// ── Opportunities (bid pipeline) workbook ────────────────────────────────────

export interface OpportunityExportResult {
  fileName: string;
  opportunities: number;
  feedback: number;
  milestones: number;
  followUps: number;
}

const num = (v: any): number => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return isFinite(n) ? n : 0;
};

// Days between a gate's due date and the day it was (or wasn't) completed —
// the same rule the milestones tab shows on screen: a Done gate is measured
// against its own completion date, an open one against today. Positive = late.
const gateSlippage = (m: any): number | '' => {
  if (!m.dueDate) return '';
  const due = new Date(`${m.dueDate}T00:00:00`).getTime();
  if (!isFinite(due)) return '';
  let end: number;
  if (m.status === 'Done') {
    if (!m.completedDate) return '';
    end = new Date(`${m.completedDate}T00:00:00`).getTime();
    if (!isFinite(end)) return '';
  } else {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    end = today.getTime();
  }
  return Math.round((end - due) / 86_400_000);
};

/**
 * Export the whole bid pipeline as a four-sheet workbook: the opportunities
 * themselves, the outcome/feedback records, the bid gates and the follow-up
 * log. Everything the analytics view aggregates is in here as raw rows, so the
 * numbers on screen can be re-derived (or re-cut) in Excel.
 *
 * Weighted value is computed here rather than stored — a missing probability
 * reads as 0, matching the dashboard, so an unassessed bid never inflates it.
 */
export async function exportOpportunities(): Promise<OpportunityExportResult> {
  const [oppSnap, fbSnap, msSnap, fuSnap] = await Promise.all([
    getDocs(collection(db, 'opportunities')),
    getDocs(collection(db, 'opportunityFeedback')),
    getDocs(collection(db, 'opportunityMilestones')),
    getDocs(collection(db, 'opportunityFollowUps')),
  ]);

  const opportunities = oppSnap.docs
    .filter(d => d.id !== '--stats--')
    .map(d => {
      const data = d.data() as any;
      return {
        id: d.id,
        ...data,
        weightedValue: Math.round(num(data.estimatedValue) * ((data.probability ?? 0) / 100)),
      };
    });

  const byId = new Map(opportunities.map(o => [o.id, o]));
  // A child row whose parent has been deleted still exports, labelled as such,
  // rather than silently vanishing from the record.
  const withParent = (rows: any[]) => rows.map(r => {
    const parent = byId.get(r.opportunityId);
    return {
      ...r,
      opportunitySerial: parent?.serialNumber ?? '(deleted bid)',
      opportunityTitle: parent?.title ?? r.opportunityId,
    };
  });

  const read = (snap: any) => snap.docs
    .filter((d: any) => d.id !== '--stats--')
    .map((d: any) => ({ id: d.id, ...d.data() }));

  const feedback = withParent(read(fbSnap));
  const milestones = withParent(read(msSnap)).map(m => ({ ...m, slippageDays: gateSlippage(m) }));
  const followUps = withParent(read(fuSnap))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(opportunities, OPPORTUNITY_COLUMNS), 'Opportunities');
  XLSX.utils.book_append_sheet(wb, buildSheet(feedback, OPPORTUNITY_FEEDBACK_COLUMNS), 'Outcomes');
  XLSX.utils.book_append_sheet(wb, buildSheet(milestones, OPPORTUNITY_MILESTONE_COLUMNS), 'Bid Gates');
  XLSX.utils.book_append_sheet(wb, buildSheet(followUps, OPPORTUNITY_FOLLOWUP_COLUMNS), 'Follow-ups');

  const fileName = `ETaske-bids-${stamp()}.xlsx`;
  writeWorkbook(fileName, wb);
  return {
    fileName,
    opportunities: opportunities.length,
    feedback: feedback.length,
    milestones: milestones.length,
    followUps: followUps.length,
  };
}
