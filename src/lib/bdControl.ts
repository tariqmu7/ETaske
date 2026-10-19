// BD control (queue E5a) — the pure maths behind the CEO page. No React, no
// Firestore: the hook hands rows in, everything here is worked out from them
// and from today, so an edit in eTaske or a fresh Excel load flows straight
// into the figures. Nothing derived is ever stored (see E2 plan): days left,
// expiry flags, roll-ups and totals are computed here at render.
//
// Data layout: bdControl/meta + bdControl/<table>/rows/<id>, loaded from the
// BD folder's bd_control_data.json by a script outside this repo. Field names
// are the camelCase of the Excel columns (`Ceiling EGP` -> ceilingEgp).

export const BD_TABLES = [
  'clients', 'clientContracts', 'changes', 'dayRates', 'supplierContracts',
  'supplierAmendments', 'agibaSOs', 'agibaSiteContracts', 'dataIssues',
] as const;
export type BdTable = typeof BD_TABLES[number];

/** Any stored row: the loader's fields + the app's edit stamps. */
export interface BdRow {
  id: string;
  appEdits?: Record<string, { excelValue?: unknown; byName?: string; at?: unknown }>;
  lastEditedBy?: string;
  lastEditedAt?: unknown;
  [field: string]: unknown;
}

export interface BdClient extends BdRow { code: string; name?: string; arabicName?: string | null; kind?: string }
export interface BdClientContract extends BdRow {
  sr?: number; client: string; contractType?: string; expiryDate?: string | null;
  ceilingEgp?: number | null; monthlyValueEgp?: number | null; status?: string | null; comments?: string | null;
}
export interface BdSupplierContract extends BdRow {
  contractNo: string; client?: string | null; contractor?: string | null; costType?: string | null;
  currentEnd?: string | null; currentValueEgp?: number | null; status?: string | null; valueCurrencyNote?: string | null;
}
export interface BdAgibaSiteContract extends BdRow { contractNo: string; currentEnd?: string | null; status?: string | null }
export interface BdDataIssue extends BdRow { table?: string; record?: string; issue?: string; whatToDo?: string }

export interface BdAwaited { measure: string; form?: string; received?: boolean }
export interface BdMeta {
  asof?: string; built?: string; sourceFolder?: string; csaReportTitle?: string;
  checks?: { check: string; result: string; detail?: string | null }[];
  awaited?: BdAwaited[];
  loadedAt?: string; loadedBy?: string;
}

export interface BdData {
  meta: BdMeta | null;
  clients: BdClient[];
  clientContracts: BdClientContract[];
  changes: BdRow[];
  dayRates: BdRow[];
  supplierContracts: BdSupplierContract[];
  supplierAmendments: BdRow[];
  agibaSOs: BdRow[];
  agibaSiteContracts: BdAgibaSiteContract[];
  dataIssues: BdDataIssue[];
}

/** The page warns once the Excel data is older than this. */
export const STALE_DAYS = 31;
/** "Renewal coming up" window on the tiles. */
export const RENEWAL_DAYS = 90;

export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}/;
const dayNo = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

/** Whole days from `today` to `date` (negative = passed). Null when the date is missing or not ISO. */
export function daysUntil(date: unknown, today: string): number | null {
  const s = typeof date === 'string' ? date.trim() : '';
  if (!ISO.test(s) || !ISO.test(today)) return null;
  return Math.round(dayNo(s) - dayNo(today));
}

/** Days since a past ISO date (0 = today). Null when missing. */
export const daysSince = (date: unknown, today: string): number | null => {
  const d = daysUntil(date, today);
  return d == null ? null : -d;
};

export type ExpiryFlag = 'Expired on paper' | 'Within 90 days' | 'Within 180 days' | 'OK' | 'No date' | 'Ended';

/** Same cut-offs as build_control_data.py, but counted from today, not the data date. */
export function expiryFlag(days: number | null): ExpiryFlag {
  if (days == null) return 'No date';
  if (days < 0) return 'Expired on paper';
  if (days <= 90) return 'Within 90 days';
  if (days <= 180) return 'Within 180 days';
  return 'OK';
}

/** A supplier contract still running: not Completed / Cancelled (same rule as the offline dashboard). */
export const isLiveSupplier = (s: Pick<BdSupplierContract, 'status'>) =>
  !['Completed', 'Cancelled'].includes(String(s.status || '').trim());

/** A past end date only counts as overdue while the contract is still listed as running. */
export function supplierFlag(s: BdSupplierContract, today: string): ExpiryFlag {
  const f = expiryFlag(daysUntil(s.currentEnd, today));
  const running = s.status == null || String(s.status).trim() === '' || s.status === 'In Progress';
  return f === 'Expired on paper' && !running ? 'Ended' : f;
}

/** Supplier / AGIBA values in another currency carry a note and stay out of every EGP total. */
export const isEgpSupplier = (s: Pick<BdSupplierContract, 'valueCurrencyNote'>) =>
  !String(s.valueCurrencyNote || '').trim();

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const sum = <T,>(xs: T[], f: (x: T) => unknown) => xs.reduce((a, x) => a + (num(f(x)) ?? 0), 0);

/** Seconds since epoch of a Firestore Timestamp / Date / ISO string, or null. */
export function timeOf(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t / 1000; }
  if (v instanceof Date) return v.getTime() / 1000;
  if (typeof v === 'object') {
    const o = v as { seconds?: number; toDate?: () => Date };
    if (typeof o.seconds === 'number') return o.seconds;
    if (typeof o.toDate === 'function') return o.toDate().getTime() / 1000;
  }
  return null;
}

const EDITABLE: BdTable[] = ['clients', 'clientContracts', 'dayRates', 'supplierContracts', 'supplierAmendments', 'agibaSOs', 'agibaSiteContracts'];

/** Rows someone changed in eTaske after the last Excel load. */
export function editsSinceLoad(data: BdData): number {
  const loaded = timeOf(data.meta?.loadedAt);
  let n = 0;
  for (const t of EDITABLE) {
    for (const r of data[t] as BdRow[]) {
      const at = timeOf(r.lastEditedAt);
      if (at != null && (loaded == null || at > loaded)) n++;
    }
  }
  return n;
}

export interface DataDate {
  asof: string | null;
  /** Days between the Excel data date and today. */
  ageDays: number | null;
  stale: boolean;
  loadedAt: string | null;
  loadedBy: string | null;
  edits: number;
}

export function dataDate(data: BdData, today: string): DataDate {
  const asof = data.meta?.asof || null;
  const ageDays = daysSince(asof, today);
  return {
    asof, ageDays, stale: ageDays != null && ageDays > STALE_DAYS,
    loadedAt: data.meta?.loadedAt || null, loadedBy: data.meta?.loadedBy || null,
    edits: editsSinceLoad(data),
  };
}

export interface OverviewKpis {
  clients: number;
  clientLines: number;
  /** Lines expired on paper (their expiry date has passed). */
  clientLinesExpired: number;
  ceilingEgp: number;
  linesWithCeiling: number;
  /** Lines paid by the month: kept out of the ceiling total. */
  monthly: { client: string; contractType?: string; monthlyValueEgp: number }[];
  monthlyEgp: number;
  renewals: { client: number; supplier: number; agibaSite: number; total: number };
  overdue: { client: number; supplier: number; agibaSite: number; total: number };
  liveSuppliers: number;
  liveSupplierEgp: number;
  liveSupplierOtherCurrency: number;
  dataIssues: number;
}

/** The KPI tiles at the top of the CEO page — every figure from rows, as of today. */
export function overviewKpis(data: BdData, today: string): OverviewKpis {
  const cc = data.clientContracts;
  const ccDays = cc.map(c => daysUntil(c.expiryDate, today));
  const live = data.supplierContracts.filter(isLiveSupplier);
  const supFlags = live.map(s => supplierFlag(s, today));
  const siteDays = data.agibaSiteContracts.map(a => daysUntil(a.currentEnd, today));
  const soon = (d: number | null) => d != null && d >= 0 && d <= RENEWAL_DAYS;
  const past = (d: number | null) => d != null && d < 0;

  const renewals = {
    client: ccDays.filter(soon).length,
    supplier: supFlags.filter(f => f === 'Within 90 days').length,
    agibaSite: siteDays.filter(soon).length,
    total: 0,
  };
  renewals.total = renewals.client + renewals.supplier + renewals.agibaSite;
  const overdue = {
    client: ccDays.filter(past).length,
    supplier: supFlags.filter(f => f === 'Expired on paper').length,
    agibaSite: siteDays.filter(past).length,
    total: 0,
  };
  overdue.total = overdue.client + overdue.supplier + overdue.agibaSite;

  const withCeiling = cc.filter(c => num(c.ceilingEgp) != null);
  const monthly = cc
    .filter(c => num(c.monthlyValueEgp) != null)
    .map(c => ({ client: c.client, contractType: c.contractType, monthlyValueEgp: c.monthlyValueEgp as number }));
  const egp = live.filter(isEgpSupplier);
  const named = data.clients.filter(c => c.kind === 'client').length;

  return {
    // The clients table also lists supplier-side and internal codes: only real clients count.
    clients: named || new Set(cc.map(c => c.client)).size,
    clientLines: cc.length,
    clientLinesExpired: overdue.client,
    ceilingEgp: sum(withCeiling, c => c.ceilingEgp),
    linesWithCeiling: withCeiling.length,
    monthly,
    monthlyEgp: sum(monthly, m => m.monthlyValueEgp),
    renewals,
    overdue,
    liveSuppliers: live.length,
    liveSupplierEgp: sum(egp, s => s.currentValueEgp),
    liveSupplierOtherCurrency: live.length - egp.length,
    dataIssues: data.dataIssues.length,
  };
}

/** EGP in millions for a tile: 3,277,355,000 -> 3277.4 (one decimal; none from 10,000 m up). */
export function millions(egp: number): number {
  const m = egp / 1e6;
  const d = Math.abs(m) >= 10000 ? 0 : 1;
  return Math.round(m * 10 ** d) / 10 ** d;
}

export const emptyBdData = (): BdData => ({
  meta: null, clients: [], clientContracts: [], changes: [], dayRates: [], supplierContracts: [],
  supplierAmendments: [], agibaSOs: [], agibaSiteContracts: [], dataIssues: [],
});

/** True once the loader has run at least once (meta written, or any row there). */
export const hasData = (d: BdData) => !!d.meta || BD_TABLES.some(t => d[t].length > 0);
