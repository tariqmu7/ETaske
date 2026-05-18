import * as XLSX from 'xlsx';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
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

  for (const name of BACKUP_COLLECTIONS) {
    try {
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

const WIDE_KEYS = new Set(['subject', 'body', 'taskName', 'description', 'notes']);

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
  const [corrSnap, taskSnap] = await Promise.all([
    getDocs(collection(db, 'correspondences')),
    getDocs(collection(db, 'tasks')),
  ]);
  const correspondences = corrSnap.docs
    .filter(d => d.id !== '--stats--')
    .map(d => ({ id: d.id, ...d.data() }));
  const tasks = taskSnap.docs
    .filter(d => d.id !== '--stats--')
    .map(d => ({ id: d.id, ...d.data() }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(correspondences, CORRESPONDENCE_COLUMNS),
    'Correspondences'
  );
  XLSX.utils.book_append_sheet(wb, buildSheet(tasks, TASK_COLUMNS), 'Tasks');

  const fileName = `ETaske-export-${stamp()}.xlsx`;
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    fileName,
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  );
  return { fileName, correspondences: correspondences.length, tasks: tasks.length };
}
