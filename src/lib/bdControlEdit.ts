// BD control editing (queue E6b) — which fields each record lets a manager
// change, and the exact write a change becomes. Pure: no React, no Firestore —
// the caller hands in the server-time sentinel, so the shapes are unit-tested.
//
// The write follows the E2 plan and the `bdControl` block in firestore.rules:
//   · every changed field gets a note `appEdits.<field> = {excelValue, byName, at}`;
//     `excelValue` is what the Excel file said BEFORE the first app edit and is
//     kept on later edits, so the loader can still spot an Excel-side change;
//   · `lastEditedBy` = the editor's uid, `lastEditedAt` = server time;
//   · one history doc per changed field `{field, from, to, byUid, byName, at}`.
// Only existing rows are edited here; adding a new record is a later task (E6c).
import type { BdRow, BdTable } from './bdControl';

export type EditKind = 'text' | 'long' | 'number' | 'date';
export interface EditField {
  key: string;
  label: string;
  kind: EditKind;
  /** Offer the values already used in this column (status words, currencies…) as suggestions. */
  suggest?: boolean;
  /** Suggestions are the client codes. */
  clients?: boolean;
}

/** Tables a manager can edit from the page. The identity fields (contract no., client + type, grade) are not offered. */
export type EditTable = Extract<BdTable, 'clientContracts' | 'dayRates' | 'supplierContracts' | 'agibaSiteContracts' | 'agibaSOs'>;

const f = (key: string, label: string, kind: EditKind = 'text', extra: Partial<EditField> = {}): EditField => ({ key, label, kind, ...extra });

export const EDIT_FIELDS: Record<EditTable, EditField[]> = {
  clientContracts: [
    f('expiryDate', 'Expiry', 'date'),
    f('status', 'Status', 'text', { suggest: true }),
    f('ceilingEgp', 'Ceiling (EGP)', 'number'),
    f('monthlyValueEgp', 'Monthly value (EGP)', 'number'),
    f('valueBasis', 'Value basis'),
    f('amendment', 'Amendment'),
    f('comments', 'Comments', 'long'),
  ],
  dayRates: [
    f('dayRateEgp', 'Day rate (EGP per man-day)', 'number'),
  ],
  supplierContracts: [
    f('status', 'Status', 'text', { suggest: true }),
    f('currentEnd', 'Current end', 'date'),
    f('currentValueEgp', 'Current value (EGP)', 'number'),
    f('contractor', 'Contractor', 'text', { suggest: true }),
    f('client', 'Client', 'text', { clients: true }),
    f('costType', 'Cost type', 'text', { suggest: true }),
    f('subject', 'Subject', 'long'),
    f('project', 'Project'),
    f('originalStart', 'Original start', 'date'),
    f('originalEnd', 'Original end', 'date'),
    f('originalValueEgp', 'Original value (EGP)', 'number'),
    f('approvedBudgetEgp', 'Approved budget (EGP)', 'number'),
    f('latestAmendment', 'Latest amendment', 'number'),
    f('valueCurrencyNote', 'Other-currency note'),
    f('admin', 'Contract admin', 'text', { suggest: true }),
    f('remarks', 'Remarks', 'long'),
  ],
  agibaSiteContracts: [
    f('status', 'Status', 'text', { suggest: true }),
    f('currentEnd', 'Current end', 'date'),
    f('company', 'Company', 'text', { suggest: true }),
    f('subject', 'Subject', 'long'),
    f('contractValueAsWritten', 'Contract value'),
    f('srValue', 'SR value', 'number'),
    f('start', 'Start', 'date'),
    f('originalEnd', 'Original end', 'date'),
    f('amendments', 'Amendments', 'number'),
    f('latestAmendment', 'Latest amendment'),
    f('inCharge', 'In charge', 'text', { suggest: true }),
    f('remarks', 'Remarks', 'long'),
  ],
  agibaSOs: [
    f('status', 'Status', 'text', { suggest: true }),
    f('expiry', 'Expiry', 'date'),
    f('amount', 'Amount', 'number'),
    f('currency', 'Currency', 'text', { suggest: true }),
    f('contractor', 'Contractor', 'text', { suggest: true }),
    f('item', 'Item', 'long'),
    f('start', 'Start', 'date'),
    f('duration', 'Duration'),
    f('completionCertificate', 'Completion certificate'),
    f('inCharge', 'In charge', 'text', { suggest: true }),
    f('remarks', 'Remarks', 'long'),
  ],
};

export const EDIT_TABLES = Object.keys(EDIT_FIELDS) as EditTable[];

/** A stored value as the form shows it ('' = blank). */
export function toInput(v: unknown, kind: EditKind): string {
  if (v == null) return '';
  if (kind === 'date') return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : String(v);
  return String(v).trim();
}

/** What the form's text becomes when stored. Blank = null. A number field refuses words. */
export function fromInput(s: string, kind: EditKind): { ok: true; value: string | number | null } | { ok: false } {
  const x = s.trim();
  if (!x) return { ok: true, value: null };
  if (kind === 'number') {
    // Western or Arabic-Indic digits, thousands commas/spaces allowed.
    const western = x.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,،\s]/g, '').replace('٫', '.');
    if (!/^-?\d+(\.\d+)?$/.test(western)) return { ok: false };
    return { ok: true, value: Number(western) };
  }
  if (kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(x) ? { ok: true, value: x } : { ok: false };
  return { ok: true, value: x };
}

export interface FieldChange { field: string; from: unknown; to: string | number | null }

/**
 * Which fields the form changed. A field counts as changed only when its form
 * text differs from the stored value's form text, so opening and saving an
 * untouched form changes nothing. Returns the bad fields when a number or date
 * does not read.
 */
export function diffForm(table: EditTable, row: BdRow, form: Record<string, string>): { changes: FieldChange[]; bad: string[] } {
  const changes: FieldChange[] = [], bad: string[] = [];
  for (const fd of EDIT_FIELDS[table]) {
    if (!(fd.key in form)) continue;
    const before = toInput(row[fd.key], fd.kind);
    if (form[fd.key].trim() === before) continue;
    const p = fromInput(form[fd.key], fd.kind);
    if (!p.ok) { bad.push(fd.key); continue; }
    if (p.value === (row[fd.key] ?? null)) continue;
    changes.push({ field: fd.key, from: row[fd.key] ?? null, to: p.value });
  }
  return { changes, bad };
}

export interface EditWho { uid: string; name: string }

/**
 * The row update and the history docs for a set of changes. `stamp` is the
 * caller's serverTimestamp(). The whole `appEdits` map is written back with the
 * earlier notes kept, so the rules' "no note may be dropped" check passes.
 */
export function planEdit(row: BdRow, changes: FieldChange[], who: EditWho, stamp: unknown) {
  const appEdits: Record<string, unknown> = { ...(row.appEdits || {}) };
  const update: Record<string, unknown> = {};
  for (const c of changes) {
    const prev = row.appEdits?.[c.field];
    // First app edit of this field: remember what Excel said. Later edits keep that.
    const excelValue = prev && 'excelValue' in prev ? prev.excelValue ?? null : c.from ?? null;
    appEdits[c.field] = { excelValue, byName: who.name, at: stamp };
    update[c.field] = c.to;
  }
  update.appEdits = appEdits;
  update.lastEditedBy = who.uid;
  update.lastEditedAt = stamp;
  const history = changes.map(c => ({ field: c.field, from: c.from ?? null, to: c.to, byUid: who.uid, byName: who.name, at: stamp }));
  return { update, history };
}

/** The suggestions a field offers: the distinct values already in that column, most used first. */
export function suggestions(rows: BdRow[], key: string, max = 30): string[] {
  const n = new Map<string, number>();
  for (const r of rows) {
    const v = r[key];
    if (v == null || typeof v === 'object') continue;
    const s = String(v).trim();
    if (s) n.set(s, (n.get(s) || 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([s]) => s);
}

/** The edit notes on a row: one per field changed in eTaske, with what Excel had. */
export function editNotes(row: BdRow): { field: string; excelValue: unknown; byName: string | null; at: unknown }[] {
  return Object.entries(row.appEdits || {}).map(([field, n]) => ({
    field, excelValue: n?.excelValue ?? null, byName: n?.byName || null, at: n?.at ?? null,
  }));
}
