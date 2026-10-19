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
  currentEnd?: string | null; currentValueEgp?: number | null; originalValueEgp?: number | null;
  status?: string | null; valueCurrencyNote?: string | null;
}
export interface BdAgibaSiteContract extends BdRow { contractNo: string; company?: string | null; currentEnd?: string | null; status?: string | null }
/** One cell of the CSA day-rate sheet: what a client pays EPROM per man-day for one grade. */
export interface BdDayRate extends BdRow { client: string; grade: string; level?: number | null; dayRateEgp?: number | null }
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
  dayRates: BdDayRate[];
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

// ── Overview charts 3–6 (queue E5b) ──────────────────────────────────────────

export interface CeilingRow { client: string; ceilingEgp: number; lines: number; types: string[] }

/** Chart 3 — contract ceiling per client, biggest first. Clients with no ceiling are named, not dropped. */
export function ceilingByClient(data: BdData): { rows: CeilingRow[]; monthlyOnly: string[]; noValue: string[] } {
  const by = new Map<string, BdClientContract[]>();
  for (const c of data.clientContracts) by.set(c.client, [...(by.get(c.client) || []), c]);
  const rows: CeilingRow[] = [];
  const monthlyOnly: string[] = [], noValue: string[] = [];
  for (const [client, lines] of by) {
    const withCeiling = lines.filter(l => num(l.ceilingEgp) != null);
    if (withCeiling.length) {
      rows.push({
        client, ceilingEgp: sum(withCeiling, l => l.ceilingEgp), lines: withCeiling.length,
        types: [...new Set(withCeiling.map(l => String(l.contractType || '').trim()).filter(Boolean))],
      });
    } else if (lines.some(l => num(l.monthlyValueEgp) != null)) monthlyOnly.push(client);
    else noValue.push(client);
  }
  rows.sort((a, b) => b.ceilingEgp - a.ceilingEgp || a.client.localeCompare(b.client));
  return { rows, monthlyOnly: monthlyOnly.sort(), noValue: noValue.sort() };
}

export const RENEWAL_BUCKETS = ['overdue', 'd30', 'd90', 'd180', 'd365', 'later', 'noDate'] as const;
export type RenewalBucket = typeof RENEWAL_BUCKETS[number];
export const RENEWAL_KINDS = ['client', 'supplier', 'agibaSite'] as const;
export type RenewalKind = typeof RENEWAL_KINDS[number];

/** Past / ≤30 / 31–90 / 91–180 / 181–365 / more than a year / no date. */
export function renewalBucket(days: number | null): RenewalBucket {
  if (days == null) return 'noDate';
  if (days < 0) return 'overdue';
  if (days <= 30) return 'd30';
  if (days <= 90) return 'd90';
  if (days <= 180) return 'd180';
  if (days <= 365) return 'd365';
  return 'later';
}

export interface RenewalItem { kind: RenewalKind; id: string; name: string; sub: string; end: string | null; days: number | null }

/**
 * Everything with an end date: every client line, every live supplier contract
 * still running (an On Hold one past its date counts as ended, as on the tiles)
 * and every AGIBA site contract.
 */
export function renewalItems(data: BdData, today: string): RenewalItem[] {
  const j = (...xs: unknown[]) => xs.map(x => String(x ?? '').trim()).filter(Boolean).join(' · ');
  return [
    ...data.clientContracts.map(c => ({
      kind: 'client' as const, id: c.id, name: c.client, sub: j(c.contractType, c.status),
      end: c.expiryDate || null, days: daysUntil(c.expiryDate, today),
    })),
    ...data.supplierContracts.filter(s => isLiveSupplier(s) && supplierFlag(s, today) !== 'Ended').map(s => ({
      kind: 'supplier' as const, id: s.id, name: s.contractNo, sub: j(s.contractor, s.client),
      end: s.currentEnd || null, days: daysUntil(s.currentEnd, today),
    })),
    ...data.agibaSiteContracts.map(a => ({
      kind: 'agibaSite' as const, id: a.id, name: a.contractNo, sub: j(a.company),
      end: a.currentEnd || null, days: daysUntil(a.currentEnd, today),
    })),
  ];
}

export interface RenewalTimeline {
  buckets: Record<RenewalBucket, Record<RenewalKind, number> & { total: number }>;
  /** The soonest still to come (today or later), earliest first. */
  next: RenewalItem[];
  total: number;
}

/** Chart 4 — when contracts come up, stacked by client / supplier / AGIBA site. */
export function renewalTimeline(data: BdData, today: string, nextCount = 10): RenewalTimeline {
  const items = renewalItems(data, today);
  const buckets = Object.fromEntries(RENEWAL_BUCKETS.map(b => [b, { client: 0, supplier: 0, agibaSite: 0, total: 0 }])) as RenewalTimeline['buckets'];
  for (const it of items) { const b = buckets[renewalBucket(it.days)]; b[it.kind]++; b.total++; }
  const next = items.filter(it => it.days != null && it.days >= 0)
    .sort((a, b) => (a.days as number) - (b.days as number) || a.name.localeCompare(b.name))
    .slice(0, nextCount);
  return { buckets, next, total: items.length };
}

/** The rate sheet's comparison column, and the code the reprice list measures against. */
export const BENCHMARK_CLIENT = 'ANOPC';
export type Benchmark = 'anopc' | 'median';
/** A client this far below the benchmark on average is a reprice candidate. */
export const REPRICE_GAP_PCT = -10;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface RateGrid {
  /** Senior first (level 10 = General Manager), grades with no level last, in sheet order. */
  grades: string[];
  /** Clients with at least one rate, A–Z. */
  clients: string[];
  rate: (client: string, grade: string) => number | null;
}

export function rateGrid(rows: BdDayRate[]): RateGrid {
  const cell = new Map<string, number>();
  const level = new Map<string, number | null>();
  const order: string[] = [];
  const rated = new Set<string>();
  for (const r of rows) {
    const g = String(r.grade || '').trim(), c = String(r.client || '').trim(), v = num(r.dayRateEgp);
    if (!g || !c) continue;
    if (!level.has(g)) { order.push(g); level.set(g, num(r.level)); }
    else if (level.get(g) == null && num(r.level) != null) level.set(g, num(r.level));
    if (v != null) { cell.set(c + '\u0000' + g, v); rated.add(g); }
  }
  // A grade with no rate anywhere (a blank row on the sheet) gets no chip.
  const grades = order.filter(g => rated.has(g))
    .map((g, i) => ({ g, i, l: level.get(g) }))
    .sort((a, b) => (a.l == null ? 1 : 0) - (b.l == null ? 1 : 0) || (b.l ?? 0) - (a.l ?? 0) || a.i - b.i)
    .map(x => x.g);
  const clients = [...new Set([...cell.keys()].map(k => k.split('\u0000')[0]))].sort();
  return { grades, clients, rate: (c, g) => cell.get(c + '\u0000' + g) ?? null };
}

export function benchmarkRate(grid: RateGrid, grade: string, b: Benchmark): number | null {
  if (b === 'anopc') return grid.rate(BENCHMARK_CLIENT, grade);
  return median(grid.clients.map(c => grid.rate(c, grade)).filter((v): v is number => v != null));
}

/** % a client's rate sits above (+) or below (−) the benchmark for one grade. */
export function gapPct(grid: RateGrid, client: string, grade: string, b: Benchmark): number | null {
  const r = grid.rate(client, grade), base = benchmarkRate(grid, grade, b);
  return r == null || !base ? null : (r / base - 1) * 100;
}

/** Mean of the per-grade gaps the client has. */
export function avgGapPct(grid: RateGrid, client: string, b: Benchmark): number | null {
  const gs = grid.grades.map(g => gapPct(grid, client, g, b)).filter((v): v is number => v != null);
  return gs.length ? gs.reduce((a, x) => a + x, 0) / gs.length : null;
}

export interface GradeBar { client: string; rate: number; gap: number | null }

/** Chart 5 — every client's rate for one grade, highest first, against the benchmark. */
export function gradeChart(grid: RateGrid, grade: string, b: Benchmark): { base: number | null; rows: GradeBar[] } {
  const rows = grid.clients
    .map(c => ({ client: c, rate: grid.rate(c, grade), gap: gapPct(grid, c, grade, b) }))
    .filter((x): x is GradeBar => x.rate != null)
    .sort((x, y) => y.rate - x.rate || x.client.localeCompare(y.client));
  return { base: benchmarkRate(grid, grade, b), rows };
}

/** Clients whose rate column has an odd value (lower grade not cheaper, …) — confirm before negotiating. */
export function rateWarnings(data: BdData): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const i of data.dataIssues) {
    if (i.table !== 'Day Rates' || !i.record || /no rates/i.test(String(i.issue || ''))) continue;
    m.set(i.record, [...(m.get(i.record) || []), String(i.issue || '')]);
  }
  return m;
}

export type RepriceWindow = 'overdue' | 'within180' | 'within365' | 'later' | 'noDate';
export const repriceWindow = (days: number | null): RepriceWindow =>
  days == null ? 'noDate' : days < 0 ? 'overdue' : days <= 180 ? 'within180' : days <= 365 ? 'within365' : 'later';

export interface RepriceRow {
  client: string;
  /** Average gap vs the benchmark client, % (negative = below). */
  gapPct: number;
  /** Average EGP per man-day below the benchmark over the grades on the sheet. */
  belowPerDay: number;
  /** Days to the client's nearest expiry (negative = already past), null when no line has a date. */
  days: number | null;
  window: RepriceWindow;
  /** The client line that expires first. */
  line: BdClientContract | null;
}

/** Chart 6 — day-rate clients 10 %+ below ANOPC, the soonest renewal window first. */
export function repriceList(data: BdData, today: string, grid: RateGrid = rateGrid(data.dayRates)): RepriceRow[] {
  const out: RepriceRow[] = [];
  for (const c of grid.clients) {
    if (c === BENCHMARK_CLIENT) continue;
    const g = avgGapPct(grid, c, 'anopc');
    if (g == null || g > REPRICE_GAP_PCT) continue;
    const diffs = grid.grades.map(gr => {
      const r = grid.rate(c, gr), a = grid.rate(BENCHMARK_CLIENT, gr);
      return r != null && a != null ? a - r : null;
    }).filter((v): v is number => v != null);
    const lines = data.clientContracts.filter(l => l.client === c)
      .map(l => ({ l, d: daysUntil(l.expiryDate, today) }))
      .sort((p, q) => (p.d ?? 1e9) - (q.d ?? 1e9));
    const days = lines.length ? lines[0].d : null;
    out.push({
      client: c, gapPct: g, belowPerDay: diffs.reduce((a, x) => a + x, 0) / diffs.length,
      days, window: repriceWindow(days), line: lines[0]?.l ?? null,
    });
  }
  return out.sort((p, q) => (p.days ?? 1e6) - (q.days ?? 1e6) || p.gapPct - q.gapPct);
}

// ── Overview charts 7–12 (queue E5c) ─────────────────────────────────────────

const txt = (v: unknown) => String(v ?? '').trim();
/** Groups rows by a text key; a blank key becomes '' (the page names it). */
function groupBy<T>(xs: T[], key: (x: T) => unknown): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = txt(key(x)); m.set(k, [...(m.get(k) || []), x]); }
  return m;
}
/** Growth from the original value to today's, %; null without both values. */
const growthPct = (orig: number | null, cur: number | null) =>
  orig == null || cur == null || orig <= 0 ? null : (cur / orig - 1) * 100;

export interface SupplierGroup {
  /** Client code or cost type; '' = not filled in. */
  key: string;
  count: number;
  currentEgp: number;
  /** Original value over the lines that have one. */
  originalEgp: number;
}

export interface SupplierCost {
  byClient: SupplierGroup[];
  byCostType: SupplierGroup[];
  live: number;
  currentEgp: number;
  originalEgp: number;
  /** Growth original → current, over the lines that hold both values. */
  growthPct: number | null;
  linesWithBoth: number;
  otherCurrency: number;
}

/** Chart 7 — what live supplier contracts cost, per client and per cost type (EGP lines only). */
export function supplierCost(data: BdData): SupplierCost {
  const live = data.supplierContracts.filter(isLiveSupplier);
  const egp = live.filter(isEgpSupplier);
  const group = (key: (s: BdSupplierContract) => unknown): SupplierGroup[] =>
    [...groupBy(egp, key)].map(([k, xs]) => ({
      key: k, count: xs.length, currentEgp: sum(xs, s => s.currentValueEgp), originalEgp: sum(xs, s => s.originalValueEgp),
    })).sort((a, b) => b.currentEgp - a.currentEgp || b.count - a.count || a.key.localeCompare(b.key));
  const both = egp.filter(s => num(s.originalValueEgp) != null && num(s.currentValueEgp) != null);
  return {
    byClient: group(s => s.client), byCostType: group(s => s.costType),
    live: live.length, currentEgp: sum(egp, s => s.currentValueEgp), originalEgp: sum(egp, s => s.originalValueEgp),
    growthPct: growthPct(sum(both, s => s.originalValueEgp) || null, sum(both, s => s.currentValueEgp)),
    linesWithBoth: both.length, otherCurrency: live.length - egp.length,
  };
}

export interface GrowthRow {
  id: string;
  contractNo: string;
  contractor: string;
  client: string;
  originalEgp: number;
  currentEgp: number;
  growthPct: number;
  /** Amendments on file for the contract, and how many of them raised the value. */
  amendments: number;
  valueIncreases: number;
}

/** Chart 8 — the live EGP supplier contracts that grew most from their original value through amendments. */
export function amendmentGrowth(data: BdData, top = 10): { rows: GrowthRow[]; types: { type: string; count: number }[]; amendments: number } {
  const byNo = groupBy(data.supplierAmendments, a => a.contractNo);
  const live = data.supplierContracts.filter(s => isLiveSupplier(s) && isEgpSupplier(s));
  const rows: GrowthRow[] = [];
  for (const s of live) {
    const g = growthPct(num(s.originalValueEgp), num(s.currentValueEgp));
    if (g == null) continue;
    const am = byNo.get(txt(s.contractNo)) || [];
    rows.push({
      id: s.id, contractNo: s.contractNo, contractor: txt(s.contractor), client: txt(s.client),
      originalEgp: s.originalValueEgp as number, currentEgp: s.currentValueEgp as number, growthPct: g,
      amendments: am.length, valueIncreases: am.filter(a => txt(a.type) === 'Value Increase').length,
    });
  }
  rows.sort((a, b) => b.growthPct - a.growthPct || b.amendments - a.amendments || a.contractNo.localeCompare(b.contractNo));
  // The kind of every amendment on those same live contracts, most frequent first.
  const liveNos = new Set(live.map(s => txt(s.contractNo)));
  const ams = data.supplierAmendments.filter(a => liveNos.has(txt(a.contractNo)));
  const types = [...groupBy(ams, a => (txt(a.type) === 'N/A' ? '' : a.type))].map(([type, xs]) => ({ type, count: xs.length }))
    .sort((a, b) => (a.type ? 0 : 1) - (b.type ? 0 : 1) || b.count - a.count || a.type.localeCompare(b.type));
  return { rows: rows.slice(0, top), types, amendments: ams.length };
}

/** An SO still to be delivered: not Completed / Cancelled, and not marked CANCELLED in the SO / SR column. */
export const isOpenSO = (s: BdRow) =>
  !['Completed', 'Cancelled'].includes(txt(s.status)) && txt(s.soSr).toUpperCase() !== 'CANCELLED';

/** "Ending soon" window for open AGIBA SOs. */
export const SO_SOON_DAYS = 60;

export interface SoItem { id: string; so: string; item: string; contractor: string; status: string; expiry: string | null; days: number | null }

export interface AgibaSos {
  total: number;
  open: number;
  /** Status as written ('' = blank), the open ones first. */
  byStatus: { status: string; count: number }[];
  /** All SOs per contractor: count, open count and EGP amount. */
  byContractor: { contractor: string; count: number; open: number; egp: number }[];
  /** Open SOs ending within 60 days, soonest first. */
  soon: SoItem[];
  /** Open SOs already past their expiry date, longest overdue first. */
  past: SoItem[];
  /** SOs whose amount is in another currency (kept out of the EGP sums). */
  otherCurrency: number;
}

/** Chart 9 — AGIBA service orders: status, who holds them, and the open ones ending soon or overdue. */
export function agibaSos(data: BdData, today: string): AgibaSos {
  const sos = data.agibaSOs;
  const isEgp = (s: BdRow) => !txt(s.currency) || txt(s.currency).toUpperCase() === 'EGP';
  const STATUS_ORDER = ['In Progress', 'Pending', '', 'Completed', 'Cancelled'];
  const rank = (s: string) => { const i = STATUS_ORDER.indexOf(s); return i < 0 ? 1.5 : i; };
  const byStatus = [...groupBy(sos, s => s.status)].map(([status, xs]) => ({ status, count: xs.length }))
    .sort((a, b) => rank(a.status) - rank(b.status) || b.count - a.count || a.status.localeCompare(b.status));
  const byContractor = [...groupBy(sos, s => s.contractor)].map(([contractor, xs]) => ({
    contractor, count: xs.length, open: xs.filter(isOpenSO).length, egp: sum(xs.filter(isEgp), s => s.amount),
  })).sort((a, b) => b.count - a.count || b.egp - a.egp || a.contractor.localeCompare(b.contractor));
  const items: SoItem[] = sos.filter(isOpenSO).map(s => ({
    id: s.id, so: txt(s.so) || s.id, item: txt(s.item), contractor: txt(s.contractor), status: txt(s.status),
    expiry: txt(s.expiry) || null, days: daysUntil(s.expiry, today),
  }));
  return {
    total: sos.length, open: items.length, byStatus, byContractor,
    soon: items.filter(x => x.days != null && x.days >= 0 && x.days <= SO_SOON_DAYS).sort((a, b) => (a.days as number) - (b.days as number)),
    past: items.filter(x => x.days != null && x.days < 0).sort((a, b) => (a.days as number) - (b.days as number)),
    otherCurrency: sos.filter(s => num(s.amount) != null && !isEgp(s)).length,
  };
}

const CHANGE_KEYS = new Set(['id', 'client', 'type', 'field', 'appEdits', 'lastEditedBy', 'lastEditedAt']);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "march2026" -> "2026-03-01"; null for a key that is not month + year. */
export function periodDate(key: string): string | null {
  const m = /^([a-z]+)(\d{4})$/.exec(key.toLowerCase());
  const i = m ? MONTHS.indexOf(m[1]) : -1;
  return m && i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, '0')}-01` : null;
}

export interface ChangeRow { id: string; type: string; field: string; from: unknown; to: unknown }
export interface ChangesByClient { client: string; changes: ChangeRow[]; fields: string[] }

/**
 * Chart 10 — what moved between two copies of the CSA report, per client. The two
 * copies are whatever month columns the loader stored (march2026 / september2026
 * today), read from the rows — a later pair of reports needs no code change.
 */
export function changesByClient(rows: BdRow[]): { from: string | null; to: string | null; clients: ChangesByClient[]; total: number } {
  const periods = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!CHANGE_KEYS.has(k) && periodDate(k)) periods.add(k);
  const [from = null, to = null] = [...periods].sort((a, b) => (periodDate(a) as string).localeCompare(periodDate(b) as string)).slice(-2);
  const clients = [...groupBy(rows, r => r.client)].map(([client, xs]) => {
    const changes = xs.map(r => ({ id: r.id, type: txt(r.type), field: txt(r.field), from: from ? r[from] ?? null : null, to: to ? r[to] ?? null : null }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.field.localeCompare(b.field));
    return { client, changes, fields: [...new Set(changes.map(c => c.field).filter(Boolean))] };
  }).sort((a, b) => b.changes.length - a.changes.length || a.client.localeCompare(b.client));
  return { from, to, clients, total: rows.length };
}

/** Chart 11 — data issues per sheet, most first, with how many records they touch. */
export function issuesByTable(rows: BdDataIssue[]): { table: string; count: number; records: number }[] {
  return [...groupBy(rows, r => r.table)].map(([table, xs]) => ({
    table, count: xs.length, records: new Set(xs.map(x => txt(x.record))).size,
  })).sort((a, b) => b.count - a.count || a.table.localeCompare(b.table));
}

/** Chart 12 — the measures the request pack will bring; flips as `received` turns true on the meta doc. */
export function awaitedData(meta: BdMeta | null): { listed: boolean; items: BdAwaited[]; received: number } {
  const items = Array.isArray(meta?.awaited) ? meta!.awaited!.filter(a => txt(a?.measure)) : [];
  return { listed: Array.isArray(meta?.awaited), items, received: items.filter(a => a.received === true).length };
}

export const emptyBdData = (): BdData => ({
  meta: null, clients: [], clientContracts: [], changes: [], dayRates: [], supplierContracts: [],
  supplierAmendments: [], agibaSOs: [], agibaSiteContracts: [], dataIssues: [],
});

/** True once the loader has run at least once (meta written, or any row there). */
export const hasData = (d: BdData) => !!d.meta || BD_TABLES.some(t => d[t].length > 0);
