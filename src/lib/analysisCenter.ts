// Analysis center (queue A1) — the maths behind the question charts. Pure, like
// lib/bdControl.ts: rows in, figures out, worked out from today at render, so an
// edit in eTaske or a new Excel load moves the charts with no code change.
//
// A "project" is one client contract line (bdControl/clientContracts). AGIBA is a
// project like any other (Tariq, 19 Oct 2026) — no special case here.

import {
  BENCHMARK_CLIENT, REPRICE_GAP_PCT, avgGapPct, daysUntil, isEgpSupplier, isLiveSupplier, periodDate, supplierFlag,
  type BdClientContract, type BdData, type BdDayRate, type BdSupplierContract, type RateGrid,
} from './bdControl';

/** Lines that are a real client's (the CSA report also carries no other kind, but a supplier-side code must never count). */
export function projectLines(data: BdData): BdClientContract[] {
  const kind = new Map(data.clients.map(c => [c.code, c.kind]));
  return data.clientContracts.filter(r => { const k = kind.get(r.client); return k == null || k === 'client'; });
}

const typeOf = (r: BdClientContract) => String(r.contractType || '').trim() || 'No type on file';

/**
 * Amendments on a line, from the CSA report's amendment column: "Amend. 9" = 9,
 * a bare "Amend." = 1 (at least one), anything else (blank, a site name) = 0.
 */
export function amendmentCount(v: unknown): { n: number; numbered: boolean } {
  const s = String(v ?? '').trim();
  if (!/amend|ملحق/i.test(s)) return { n: 0, numbered: false };
  const m = s.match(/(\d+)/);
  return m ? { n: Number(m[1]), numbered: true } : { n: 1, numbered: false };
}

export interface ProjectTotals {
  projects: number;
  /** Lines per contract form, biggest first (CSA, O&M, TSA, Farm-in…). */
  byType: { type: string; count: number }[];
  amendments: number;
  /** Lines that have at least one amendment. */
  amendedLines: number;
  /** Lines marked "Amend." with no number — each counted as one. */
  unnumbered: number;
}

export function projectTotals(data: BdData): ProjectTotals {
  const lines = projectLines(data);
  const types = new Map<string, number>();
  let amendments = 0, amendedLines = 0, unnumbered = 0;
  for (const r of lines) {
    types.set(typeOf(r), (types.get(typeOf(r)) || 0) + 1);
    const a = amendmentCount(r.amendment);
    if (a.n > 0) { amendments += a.n; amendedLines++; if (!a.numbered) unnumbered++; }
  }
  const byType = [...types].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  return { projects: lines.length, byType, amendments, amendedLines, unnumbered };
}

/** P2 — where each line stands against its end date, from today. */
export const PROJECT_STATES = ['running', 'endingSoon', 'pastEnd', 'noDate'] as const;
export type ProjectState = typeof PROJECT_STATES[number];
export const ENDING_SOON_DAYS = 90;

export function projectState(days: number | null): ProjectState {
  if (days == null) return 'noDate';
  if (days < 0) return 'pastEnd';
  return days <= ENDING_SOON_DAYS ? 'endingSoon' : 'running';
}

export function projectStatus(data: BdData, today: string): { state: ProjectState; count: number }[] {
  const n: Record<ProjectState, number> = { running: 0, endingSoon: 0, pastEnd: 0, noDate: 0 };
  for (const r of projectLines(data)) n[projectState(daysUntil(r.expiryDate, today))]++;
  return PROJECT_STATES.map(state => ({ state, count: n[state] }));
}

/** P3 — share of lines per contract form (the donut). */
export function projectsByType(data: BdData): { type: string; count: number; pct: number }[] {
  const t = projectTotals(data);
  return t.byType.map(x => ({ ...x, pct: t.projects ? (x.count / t.projects) * 100 : 0 }));
}

/** P4 — lines per client, most first (ties A–Z). */
export function projectsByClient(data: BdData): { client: string; count: number; types: string[] }[] {
  const m = new Map<string, { count: number; types: Set<string> }>();
  for (const r of projectLines(data)) {
    const e = m.get(r.client) || { count: 0, types: new Set<string>() };
    e.count++; e.types.add(typeOf(r)); m.set(r.client, e);
  }
  return [...m].map(([client, e]) => ({ client, count: e.count, types: [...e.types] }))
    .sort((a, b) => b.count - a.count || a.client.localeCompare(b.client));
}

export interface ValueLine { id: string; client: string; type: string; sr?: number; ceilingEgp: number }

/** P6 / M1 — lines by ceiling, biggest first; monthly-only and no-value lines named apart. */
export function projectsByValue(data: BdData): { rows: ValueLine[]; monthlyOnly: BdClientContract[]; noValue: BdClientContract[] } {
  const rows: ValueLine[] = [], monthlyOnly: BdClientContract[] = [], noValue: BdClientContract[] = [];
  for (const r of projectLines(data)) {
    const c = typeof r.ceilingEgp === 'number' && isFinite(r.ceilingEgp) && r.ceilingEgp > 0 ? r.ceilingEgp : null;
    if (c != null) rows.push({ id: r.id, client: r.client, type: typeOf(r), sr: r.sr, ceilingEgp: c });
    else if (typeof r.monthlyValueEgp === 'number' && r.monthlyValueEgp > 0) monthlyOnly.push(r);
    else noValue.push(r);
  }
  rows.sort((a, b) => b.ceilingEgp - a.ceilingEgp || a.client.localeCompare(b.client));
  return { rows, monthlyOnly, noValue };
}

// ── Money + amendments (queue A2) ────────────────────────────────────────────
//
// Assumed figures (Tariq, 20 Oct 2026): where a figure is missing, the chart still
// shows one, worked out by a stated rule and drawn hatched, and the card says the
// real figure has been requested. Every rule below reads the live rows, so a real
// value arriving (a new column from the loader, or an edit) replaces the assumed
// one on its own.

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const txt = (v: unknown) => String(v ?? '').trim();
const isoOf = (v: unknown) => { const s = txt(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };
const medianOf = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Months between two ISO dates (30.44 days a month). */
const monthsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000 / 30.44;

/** A line paid by the month is valued at this many months until its contract value arrives. */
export const ASSUMED_MONTHS = 12;
/** EGP per USD for a supplier contract held in dollars, until Finance gives the rate it books. */
export const ASSUMED_USD_EGP = 50;

/** Why a value is assumed — the chart prints the matching sentence. */
export type AssumeBasis = 'monthly' | 'typeMedian';

export interface ProjectValue {
  client: string;
  lines: number;
  realEgp: number;
  assumedEgp: number;
  totalEgp: number;
  basis: AssumeBasis[];
}

/**
 * M1 — contract value per client, every line counted. A line's ceiling is real;
 * a line paid by the month is assumed at ASSUMED_MONTHS × its monthly value; a
 * line with no value at all is assumed at the median ceiling of the other lines
 * of the same contract form (or of all lines when the form has none).
 */
const ceilingOf = (r: BdClientContract) => { const c = num(r.ceilingEgp); return c != null && c > 0 ? c : null; };

/** A line with no ceiling and no monthly value: the median ceiling of its contract form (or of all lines). */
function typeMedianValue(lines: BdClientContract[]): (r: BdClientContract) => number | null {
  const all = lines.map(ceilingOf).filter((c): c is number => c != null);
  const byType = new Map<string, number[]>();
  for (const r of lines) { const c = ceilingOf(r); if (c != null) byType.set(typeOf(r), [...(byType.get(typeOf(r)) || []), c]); }
  return r => medianOf(byType.get(typeOf(r)) || []) ?? medianOf(all);
}

export function projectValues(data: BdData): { rows: ProjectValue[]; realEgp: number; assumedEgp: number; assumedLines: number } {
  const lines = projectLines(data);
  const median = typeMedianValue(lines);
  const m = new Map<string, ProjectValue>();
  let assumedLines = 0;
  for (const r of lines) {
    const e = m.get(r.client) || { client: r.client, lines: 0, realEgp: 0, assumedEgp: 0, totalEgp: 0, basis: [] };
    e.lines++;
    const c = ceilingOf(r), monthly = num(r.monthlyValueEgp);
    if (c != null) e.realEgp += c;
    else {
      const [v, b]: [number | null, AssumeBasis] = monthly != null && monthly > 0
        ? [monthly * ASSUMED_MONTHS, 'monthly']
        : [median(r), 'typeMedian'];
      if (v != null) { e.assumedEgp += v; assumedLines++; if (!e.basis.includes(b)) e.basis.push(b); }
    }
    e.totalEgp = e.realEgp + e.assumedEgp;
    m.set(r.client, e);
  }
  const rows = [...m.values()].sort((a, b) => b.totalEgp - a.totalEgp || a.client.localeCompare(b.client));
  return { rows, realEgp: rows.reduce((a, x) => a + x.realEgp, 0), assumedEgp: rows.reduce((a, x) => a + x.assumedEgp, 0), assumedLines };
}

const isUsd = (s: BdSupplierContract) => /usd|\$|dollar/i.test(txt(s.valueCurrencyNote));

export interface SubcontractRow { client: string; count: number; realEgp: number; assumedEgp: number; totalEgp: number }

/**
 * M5 — what live supplier contracts cost per client project. EGP lines are real; a
 * line the files mark as USD is assumed at ASSUMED_USD_EGP; any other currency is
 * left out and counted. EPROM's own needs (client kind "internal") are not a client
 * project: they are summed apart.
 */
export function subcontractByProject(data: BdData): {
  rows: SubcontractRow[]; own: { count: number; egp: number }; realEgp: number; assumedEgp: number; usdLines: number; leftOut: number;
} {
  const kind = new Map(data.clients.map(c => [c.code, c.kind]));
  const m = new Map<string, SubcontractRow>();
  const own = { count: 0, egp: 0 };
  let usdLines = 0, leftOut = 0;
  for (const s of data.supplierContracts.filter(isLiveSupplier)) {
    const v = num(s.currentValueEgp);
    let real = 0, assumed = 0;
    if (isEgpSupplier(s)) real = v ?? 0;
    else if (isUsd(s) && v != null) { assumed = v * ASSUMED_USD_EGP; usdLines++; }
    else { leftOut++; continue; }
    const client = txt(s.client);
    if (kind.get(client) === 'internal') { own.count++; own.egp += real + assumed; continue; }
    const e = m.get(client) || { client, count: 0, realEgp: 0, assumedEgp: 0, totalEgp: 0 };
    e.count++; e.realEgp += real; e.assumedEgp += assumed; e.totalEgp = e.realEgp + e.assumedEgp;
    m.set(client, e);
  }
  const rows = [...m.values()].sort((a, b) => b.totalEgp - a.totalEgp || a.client.localeCompare(b.client));
  return { rows, own, realEgp: rows.reduce((a, x) => a + x.realEgp, 0), assumedEgp: rows.reduce((a, x) => a + x.assumedEgp, 0), usdLines, leftOut };
}

export interface AmendLine { id: string; client: string; type: string; n: number; assumed: boolean }

/** A1 — amendments per project line; a bare "Amend." is assumed to be one. */
export function amendmentsByProject(data: BdData): { rows: AmendLine[]; none: number; assumed: number } {
  const rows: AmendLine[] = [];
  let none = 0;
  for (const r of projectLines(data)) {
    const a = amendmentCount(r.amendment);
    if (a.n > 0) rows.push({ id: r.id, client: r.client, type: typeOf(r), n: a.n, assumed: !a.numbered });
    else none++;
  }
  rows.sort((a, b) => b.n - a.n || Number(a.assumed) - Number(b.assumed) || a.client.localeCompare(b.client));
  return { rows, none, assumed: rows.filter(r => r.assumed).length };
}

/** "2026-08-14" -> "2026-Q3". */
export const quarterOf = (iso: string) => `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;

/** The last `n` quarters up to today's, oldest first. */
export function lastQuarters(today: string, n: number): string[] {
  let y = Number(today.slice(0, 4)), q = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.unshift(`${y}-Q${q}`); q--; if (q === 0) { q = 4; y--; } }
  return out;
}

const dayAfter = (iso: string) => new Date(Date.parse(iso) + 86400000).toISOString().slice(0, 10);

/**
 * A2 — supplier amendments per quarter they start in (the only amendments with
 * dates on file). An amendment with no start date is assumed to start the day
 * after the end date it extends; with neither it is counted under the chart.
 */
export function amendmentsByQuarter(data: BdData, today: string, n = 8): {
  rows: { quarter: string; real: number; assumed: number }[]; earlier: number; later: number; noDate: number;
} {
  const qs = lastQuarters(today, n);
  const at = new Map(qs.map(q => [q, { quarter: q, real: 0, assumed: 0 }]));
  let earlier = 0, later = 0, noDate = 0;
  for (const a of data.supplierAmendments) {
    const start = isoOf(a.start), prev = isoOf(a.previousEnd);
    const d = start || (prev ? dayAfter(prev) : null);
    if (!d) { noDate++; continue; }
    const q = quarterOf(d);
    const e = at.get(q);
    if (e) { if (start) e.real++; else e.assumed++; }
    else if (q < qs[0]) earlier++;
    else later++;
  }
  return { rows: qs.map(q => at.get(q)!), earlier, later, noDate };
}

/**
 * The yardstick for client projects, read from our own supplier amendments: what
 * share of amendments extend time / raise value, the median months a time
 * extension adds and the median % a value increase adds.
 */
export interface Yardstick { typed: number; timeShare: number; valueShare: number; monthsPerExtension: number | null; pctPerIncrease: number | null }

export function amendmentYardstick(data: BdData): Yardstick {
  const typed = data.supplierAmendments.filter(a => txt(a.type) && txt(a.type) !== 'N/A');
  const time = typed.filter(a => txt(a.type) === 'Time Extension');
  const value = typed.filter(a => txt(a.type) === 'Value Increase');
  const months = time.map(a => { const p = isoOf(a.previousEnd), q = isoOf(a.newEnd); return p && q ? monthsBetween(p, q) : null; })
    .filter((x): x is number => x != null && x > 0);
  const pcts = value.map(a => {
    let v = num(a.variationPct);
    if (v != null && Math.abs(v) > 5) v /= 100; // written as 10 rather than 0.10
    if (v == null) { const p = num(a.previousValueEgp), q = num(a.valueAfterEgp); v = p && q && p > 0 ? q / p - 1 : null; }
    return v;
  }).filter((x): x is number => x != null && x > 0);
  const pct = medianOf(pcts);
  return {
    typed: typed.length,
    timeShare: typed.length ? time.length / typed.length : 0,
    valueShare: typed.length ? value.length / typed.length : 0,
    monthsPerExtension: medianOf(months),
    pctPerIncrease: pct == null ? null : pct * 100,
  };
}

export interface ProjectChange { id: string; client: string; type: string; amendments: number; value: number; assumed: boolean }

/**
 * A3 — growth in value per project, %. Real when the line holds its original
 * value (`originalValueEgp`, once Contracts sends it); otherwise assumed: the
 * line's amendments × the share that raise value, each adding the median %.
 */
export function projectGrowth(data: BdData, top = 10): { rows: ProjectChange[]; y: Yardstick; flat: number } {
  const y = amendmentYardstick(data);
  const rows: ProjectChange[] = [];
  let flat = 0;
  for (const r of projectLines(data)) {
    const orig = num(r.originalValueEgp), cur = num(r.ceilingEgp), n = amendmentCount(r.amendment).n;
    let value: number | null = null, assumed = false;
    if (orig != null && orig > 0 && cur != null) value = (cur / orig - 1) * 100;
    else if (n > 0 && y.pctPerIncrease != null) { value = (Math.pow(1 + y.pctPerIncrease / 100, Math.round(n * y.valueShare)) - 1) * 100; assumed = true; }
    if (value == null || value <= 0) { flat++; continue; }
    rows.push({ id: r.id, client: r.client, type: typeOf(r), amendments: n, value, assumed });
  }
  rows.sort((a, b) => b.value - a.value || Number(a.assumed) - Number(b.assumed) || a.client.localeCompare(b.client));
  return { rows: rows.slice(0, top), y, flat };
}

/**
 * A4 — months added to each project. Real when the line holds its original end
 * date (`originalExpiryDate`); otherwise assumed: amendments × the share that
 * extend time × the median months per extension.
 */
export function monthsAdded(data: BdData, top = 10): { rows: ProjectChange[]; y: Yardstick; flat: number } {
  const y = amendmentYardstick(data);
  const rows: ProjectChange[] = [];
  let flat = 0;
  for (const r of projectLines(data)) {
    const o = isoOf(r.originalExpiryDate), e = isoOf(r.expiryDate), n = amendmentCount(r.amendment).n;
    let value: number | null = null, assumed = false;
    if (o && e) value = Math.round(monthsBetween(o, e));
    else if (n > 0 && y.monthsPerExtension != null) { value = Math.round(Math.round(n * y.timeShare) * y.monthsPerExtension); assumed = true; }
    if (value == null || value <= 0) { flat++; continue; }
    rows.push({ id: r.id, client: r.client, type: typeOf(r), amendments: n, value, assumed });
  }
  rows.sort((a, b) => b.value - a.value || Number(a.assumed) - Number(b.assumed) || a.client.localeCompare(b.client));
  return { rows: rows.slice(0, top), y, flat };
}

/** End date moved later between the two CSA report copies on file: "client|form" → months moved. */
export function endMovedLately(data: BdData): Map<string, number> {
  const out = new Map<string, number>();
  const periods = new Set<string>();
  for (const r of data.changes) for (const k of Object.keys(r)) if (periodDate(k)) periods.add(k);
  const [from, to] = [...periods].sort((a, b) => (periodDate(a) as string).localeCompare(periodDate(b) as string)).slice(-2);
  if (!from || !to) return out;
  for (const r of data.changes) {
    if (txt(r.field) !== 'Expiry date') continue;
    const a = isoOf(r[from]), b = isoOf(r[to]);
    if (a && b && b > a) out.set(`${txt(r.client)}|${txt(r.type)}`, Math.round(monthsBetween(a, b)));
  }
  return out;
}

export interface ExtensionRow extends ProjectChange { movedMonths: number | null }

/**
 * A5 — projects ranked by time extensions. Real when the line holds a count
 * (`timeExtensions`); otherwise assumed: amendments × the share that extend time.
 * A line is also flagged when its end date moved later between the two report
 * copies on file — real evidence of a recent extension.
 */
export function extensionsByProject(data: BdData, top = 10): { rows: ExtensionRow[]; y: Yardstick; flat: number } {
  const y = amendmentYardstick(data);
  const moved = endMovedLately(data);
  const rows: ExtensionRow[] = [];
  let flat = 0;
  for (const r of projectLines(data)) {
    const real = num(r.timeExtensions);
    const mv = moved.get(`${r.client}|${typeOf(r)}`) ?? null;
    const value = real ?? Math.round(amendmentCount(r.amendment).n * y.timeShare);
    if (value <= 0 && mv == null) { flat++; continue; }
    rows.push({ id: r.id, client: r.client, type: typeOf(r), amendments: amendmentCount(r.amendment).n, value: Math.max(0, value), assumed: real == null && value > 0, movedMonths: mv });
  }
  rows.sort((a, b) => b.value - a.value || (b.movedMonths ?? -1) - (a.movedMonths ?? -1) || a.client.localeCompare(b.client));
  return { rows: rows.slice(0, top), y, flat };
}

// ── Renewals + suppliers (queue A3) ──────────────────────────────────────────

/** R1 — the three windows the CEO asked for, in days left from today. */
export const SOON_WINDOWS = ['d30', 'd90', 'd180'] as const;
export type SoonWindow = typeof SOON_WINDOWS[number];
const soonWindow = (days: number): SoonWindow | null => (days < 0 ? null : days <= 30 ? 'd30' : days <= 90 ? 'd90' : days <= 180 ? 'd180' : null);

export interface EndLine { id: string; client: string; type: string; end: string; days: number }

/**
 * R1 — project lines ending in 0–30, 31–90 and 91–180 days, soonest first in
 * each window. Lines past their end are R2's; lines with no end date are counted.
 */
export function endingSoon(data: BdData, today: string): { windows: { w: SoonWindow; lines: EndLine[] }[]; noDate: number; later: number } {
  const at = new Map(SOON_WINDOWS.map(w => [w, [] as EndLine[]]));
  let noDate = 0, later = 0;
  for (const r of projectLines(data)) {
    const days = daysUntil(r.expiryDate, today);
    if (days == null) { noDate++; continue; }
    const w = soonWindow(days);
    if (w) at.get(w)!.push({ id: r.id, client: r.client, type: typeOf(r), end: String(r.expiryDate).slice(0, 10), days });
    else if (days > 180) later++;
  }
  for (const xs of at.values()) xs.sort((a, b) => a.days - b.days || a.client.localeCompare(b.client));
  return { windows: SOON_WINDOWS.map(w => ({ w, lines: at.get(w)! })), noDate, later };
}

/**
 * R2 — project lines still in the report although their end date has passed,
 * longest overdue first; plus how many live supplier contracts are in the same
 * state (still In Progress past their end).
 */
export function pastEnd(data: BdData, today: string): { lines: EndLine[]; suppliers: number } {
  const lines: EndLine[] = [];
  for (const r of projectLines(data)) {
    const days = daysUntil(r.expiryDate, today);
    if (days != null && days < 0) lines.push({ id: r.id, client: r.client, type: typeOf(r), end: String(r.expiryDate).slice(0, 10), days });
  }
  lines.sort((a, b) => a.days - b.days || a.client.localeCompare(b.client));
  const suppliers = data.supplierContracts.filter(s => isLiveSupplier(s) && supplierFlag(s, today) === 'Expired on paper').length;
  return { lines, suppliers };
}

export interface SupplierGap {
  id: string; contractNo: string; contractor: string; client: string;
  /** The client line it is matched to. */
  lineId: string; lineType: string;
  supplierEnd: string; clientEnd: string;
  /** Months the client line runs on after the supplier contract ends. */
  months: number;
  /** True when the client has several lines and the match is the assumed one. */
  assumed: boolean;
}

/**
 * R3 — live supplier contracts that end before the client contract they
 * support. Until Contracts says which supplier serves which project, a supplier
 * is matched by its client: one line = that line (certain); several lines = the
 * one that runs longest (assumed — the stated rule). EPROM's own needs and
 * contracts with no client or no end date are counted, not matched.
 */
export function suppliersEndingFirst(data: BdData, today: string): { rows: SupplierGap[]; matched: number; unmatched: number } {
  const kind = new Map(data.clients.map(c => [c.code, c.kind]));
  const byClient = new Map<string, BdClientContract[]>();
  for (const r of projectLines(data)) if (isoOf(r.expiryDate)) byClient.set(r.client, [...(byClient.get(r.client) || []), r]);
  const rows: SupplierGap[] = [];
  let matched = 0, unmatched = 0;
  for (const s of data.supplierContracts) {
    if (!isLiveSupplier(s) || supplierFlag(s, today) === 'Ended') continue;
    const client = txt(s.client), end = isoOf(s.currentEnd), lines = byClient.get(client);
    if (!end || !lines || kind.get(client) === 'internal') { unmatched++; continue; }
    matched++;
    const line = [...lines].sort((a, b) => String(b.expiryDate).localeCompare(String(a.expiryDate)))[0];
    const clientEnd = isoOf(line.expiryDate) as string;
    if (end >= clientEnd) continue;
    rows.push({
      id: s.id, contractNo: txt(s.contractNo), contractor: txt(s.contractor), client, lineId: line.id, lineType: typeOf(line),
      supplierEnd: end, clientEnd, months: Math.max(0, Math.round(monthsBetween(end, clientEnd))), assumed: lines.length > 1,
    });
  }
  rows.sort((a, b) => a.supplierEnd.localeCompare(b.supplierEnd) || b.months - a.months || a.contractNo.localeCompare(b.contractNo));
  return { rows, matched, unmatched };
}

export interface ContractorSpend { contractor: string; count: number; realEgp: number; assumedEgp: number; totalEgp: number }

/**
 * S1 / S3 — live supplier spend per contractor. EGP lines are real, USD lines
 * assumed at ASSUMED_USD_EGP (as M5), any other currency left out and counted.
 */
export function spendByContractor(data: BdData): { rows: ContractorSpend[]; realEgp: number; assumedEgp: number; usdLines: number; leftOut: number } {
  const m = new Map<string, ContractorSpend>();
  let usdLines = 0, leftOut = 0;
  for (const s of data.supplierContracts.filter(isLiveSupplier)) {
    const v = num(s.currentValueEgp);
    let real = 0, assumed = 0;
    if (isEgpSupplier(s)) real = v ?? 0;
    else if (isUsd(s) && v != null) { assumed = v * ASSUMED_USD_EGP; usdLines++; }
    else { leftOut++; continue; }
    const contractor = txt(s.contractor);
    const e = m.get(contractor) || { contractor, count: 0, realEgp: 0, assumedEgp: 0, totalEgp: 0 };
    e.count++; e.realEgp += real; e.assumedEgp += assumed; e.totalEgp = e.realEgp + e.assumedEgp;
    m.set(contractor, e);
  }
  const rows = [...m.values()].sort((a, b) => b.totalEgp - a.totalEgp || a.contractor.localeCompare(b.contractor));
  return { rows, realEgp: rows.reduce((a, x) => a + x.realEgp, 0), assumedEgp: rows.reduce((a, x) => a + x.assumedEgp, 0), usdLines, leftOut };
}

/** S3 — how much of the live supplier spend the biggest `top` contractors hold. */
export function topContractorShare(data: BdData, top = 5): {
  rows: (ContractorSpend & { pct: number })[]; topPct: number; others: { count: number; pct: number }; totalEgp: number; assumed: boolean;
} {
  const s = spendByContractor(data);
  const total = s.realEgp + s.assumedEgp;
  const pct = (x: number) => (total > 0 ? (x / total) * 100 : 0);
  const rows = s.rows.slice(0, top).map(r => ({ ...r, pct: pct(r.totalEgp) }));
  const rest = s.rows.slice(top);
  return {
    rows, topPct: rows.reduce((a, r) => a + r.pct, 0), totalEgp: total, assumed: s.assumedEgp > 0,
    others: { count: rest.length, pct: pct(rest.reduce((a, r) => a + r.totalEgp, 0)) },
  };
}

// ── People, growth, opportunity (queue A4) ───────────────────────────────────

export interface GradeVsMarket {
  grade: string;
  level: number | null;
  /** Median rate over our clients other than the reference client. */
  median: number | null;
  /** The reference client's rate (the rate sheet's comparison column). */
  reference: number | null;
  /** % the median sits above (+) or below (−) the reference. */
  gap: number | null;
  clients: number;
}

/**
 * H3 — per grade, senior first: our clients' median day rate against the
 * reference client (ANOPC). Plus the clients paying 10 %+ below it on average —
 * the ones to reprice at renewal.
 */
export function ratesVsMarket(data: BdData, grid: RateGrid): { rows: GradeVsMarket[]; below: string[] } {
  const level = new Map<string, number>();
  for (const r of data.dayRates) { const l = num(r.level); if (l != null && !level.has(txt(r.grade))) level.set(txt(r.grade), l); }
  const rows = grid.grades.map(grade => {
    const rates = grid.clients.filter(c => c !== BENCHMARK_CLIENT).map(c => grid.rate(c, grade)).filter((v): v is number => v != null);
    const median = medianOf(rates), reference = grid.rate(BENCHMARK_CLIENT, grade);
    return { grade, level: level.get(grade) ?? null, median, reference, gap: median != null && reference ? (median / reference - 1) * 100 : null, clients: rates.length };
  });
  const below = grid.clients.filter(c => c !== BENCHMARK_CLIENT)
    .map(c => ({ c, g: avgGapPct(grid, c, 'anopc') }))
    .filter((x): x is { c: string; g: number } => x.g != null && x.g <= REPRICE_GAP_PCT)
    .sort((a, b) => a.g - b.g || a.c.localeCompare(b.c)).map(x => x.c);
  return { rows, below };
}

export interface LevelValue { level: number; grades: string[]; median: number; low: number; high: number; clients: number; assumed: boolean }

/**
 * O2 — what each competency level is worth per day: the median of every client's
 * day rate for the grades at that level, with the lowest and highest. Real when a
 * rate row carries `competencyLevel` (once HR and BD match each grade to a level);
 * until then assumed: one grade = one level, the rate sheet's own level number.
 * Grades with neither are named apart.
 */
export function levelValues(rows: BdDayRate[]): { rows: LevelValue[]; noLevel: string[] } {
  const byGrade = new Map<string, { real: number | null; sheet: number | null }>();
  for (const r of rows) {
    const g = txt(r.grade); if (!g) continue;
    const e = byGrade.get(g) || { real: null, sheet: null };
    e.real ??= num(r.competencyLevel); e.sheet ??= num(r.level);
    byGrade.set(g, e);
  }
  const at = new Map<number, { grades: Set<string>; rates: number[]; clients: Set<string>; assumed: boolean }>();
  const noLevel = new Set<string>();
  for (const r of rows) {
    const g = txt(r.grade), v = num(r.dayRateEgp);
    if (!g || v == null) continue;
    const e = byGrade.get(g)!, lvl = e.real ?? e.sheet;
    if (lvl == null) { noLevel.add(g); continue; }
    const x = at.get(lvl) || { grades: new Set<string>(), rates: [], clients: new Set<string>(), assumed: false };
    x.grades.add(g); x.rates.push(v); x.clients.add(txt(r.client)); if (e.real == null) x.assumed = true;
    at.set(lvl, x);
  }
  const out = [...at].map(([level, x]) => ({
    level, grades: [...x.grades], median: medianOf(x.rates) as number, low: Math.min(...x.rates), high: Math.max(...x.rates), clients: x.clients.size, assumed: x.assumed,
  })).sort((a, b) => b.level - a.level);
  return { rows: out, noLevel: [...noLevel] };
}

export interface ServiceGap { client: string; buys: string[]; couldAdd: string[] }

/**
 * G1 — per client, the services on our list it does not buy from us yet. Until BD
 * sends the services list per client, the list is assumed: the contract forms our
 * clients hold today (CSA, O&M, TSA…), most common first.
 */
export function serviceGaps(data: BdData): { list: string[]; rows: ServiceGap[]; full: number } {
  const lines = projectLines(data).filter(r => typeOf(r) !== 'No type on file');
  const count = new Map<string, number>();
  for (const r of lines) count.set(typeOf(r), (count.get(typeOf(r)) || 0) + 1);
  const list = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(x => x[0]);
  const buys = new Map<string, Set<string>>();
  for (const r of projectLines(data)) {
    const s = buys.get(r.client) || new Set<string>();
    if (typeOf(r) !== 'No type on file') s.add(typeOf(r));
    buys.set(r.client, s);
  }
  const all = [...buys].map(([client, s]) => ({ client, buys: list.filter(x => s.has(x)), couldAdd: list.filter(x => !s.has(x)) }));
  const rows = all.filter(r => r.couldAdd.length > 0)
    .sort((a, b) => b.couldAdd.length - a.couldAdd.length || b.buys.length - a.buys.length || a.client.localeCompare(b.client));
  return { list, rows, full: all.length - rows.length };
}

/** G4 — a client counts as "no new work" when its newest work started this many months ago or more. */
export const NO_NEW_WORK_MONTHS = 12;

export interface LastWork { client: string; start: string; months: number; assumed: boolean }

/**
 * G4 — clients whose newest work with us started 12+ months ago, longest first.
 * Real when a client line holds its start date (`startDate`); otherwise assumed:
 * the newest supplier contract we signed for that client (its original start).
 */
export function lastNewWork(data: BdData, today: string): { rows: LastWork[]; recent: number; noDate: string[]; clients: number } {
  const real = new Map<string, string>(), proxy = new Map<string, string>();
  const later = (m: Map<string, string>, k: string, d: string | null) => { if (d && (!m.has(k) || d > (m.get(k) as string))) m.set(k, d); };
  const clients = [...new Set(projectLines(data).map(r => r.client))];
  for (const r of projectLines(data)) later(real, r.client, isoOf(r.startDate));
  for (const s of data.supplierContracts) later(proxy, txt(s.client), isoOf(s.originalStart));
  const rows: LastWork[] = [], noDate: string[] = [];
  let recent = 0;
  for (const client of clients) {
    const start = real.get(client) ?? proxy.get(client);
    if (!start || start > today) { if (!start) noDate.push(client); else recent++; continue; }
    const months = Math.floor(monthsBetween(start, today));
    if (months < NO_NEW_WORK_MONTHS) { recent++; continue; }
    rows.push({ client, start, months, assumed: !real.has(client) });
  }
  rows.sort((a, b) => b.months - a.months || a.client.localeCompare(b.client));
  return { rows, recent, noDate: noDate.sort(), clients: clients.length };
}

// ── Money (queue A7a) ────────────────────────────────────────────────────────
//
// Finance has sent no invoices, costs, collections or cash yet, so every money
// figure in M2–M4 and M6–M11 is ASSUMED by the rules below (agreed with Tariq,
// 20 Oct 2026) and drawn hatched. What is real: the ceilings, monthly values and
// end dates of the client lines, and the live supplier contracts. Every rule reads
// those rows, so an edit or a new load moves every figure; a start date on a line
// (`startDate`) or a supplier contract (`originalStart`) replaces the assumed one.

/** A contract runs this long, ending on its end date, until its start date is on file. */
export const ASSUMED_TERM_YEARS = 3;
/** Share of a ceiling the client ends up paying (a ceiling is a maximum). A monthly line is billed in full. */
export const ASSUMED_CEILING_USED = 0.8;
/** EPROM's own price build-up (Discovery Brief, ANOPC tender): direct cost × 1.35 (overheads 25 % + contingency 10 %) × 1.25 (profit). */
export const PRICE_BUILDUP = 1.35 * 1.25;
/** Head-office overhead on top of direct cost (same build-up). */
export const OVERHEAD_OF_DIRECT = 0.25;
/** How our own direct cost (everything but subcontractors) splits. */
export const OWN_COST_SPLIT = { staff: 0.75, allowances: 0.2, travel: 0.05 } as const;
/** Days a client takes to pay an invoice. */
export const ASSUMED_PAY_DAYS = 90;
/** M2 / M11 show this many completed quarters. */
export const MONEY_QUARTERS = 6;

const DAY = 86400000;
const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const plusYears = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + n); return d.toISOString().slice(0, 10); };
/** Days of [a, b) that fall inside [from, to). */
const overlap = (a: string, b: string, from: string, to: string) => Math.max(0, Math.min(dayOf(b), dayOf(to)) - Math.max(dayOf(a), dayOf(from)));

/** "2026-Q3" → its first day and the next quarter's first day. */
export function quarterSpan(q: string): [string, string] {
  const y = Number(q.slice(0, 4)), n = Number(q.slice(-1));
  const from = `${y}-${String(3 * (n - 1) + 1).padStart(2, '0')}-01`;
  return [from, n === 4 ? `${y + 1}-01-01` : `${y}-${String(3 * n + 1).padStart(2, '0')}-01`];
}

/** So much money a day between two dates (`to` = the end date, not counted). */
interface Stream { id: string; client: string; type: string; from: string; to: string; perDay: number }

export interface BillingLine extends Stream { ceilingEgp: number | null; planPerDay: number; startAssumed: boolean }

export interface MoneyModel {
  lines: BillingLine[];
  suppliers: Stream[];
  /** Client lines with no end date (or no value anywhere to assume one from). */
  linesLeftOut: number;
  /** Live supplier contracts on a client project with no value, no end date or another currency. */
  suppliersLeftOut: number;
}

/**
 * The streams every money chart reads. A client line bills from its start date
 * (assumed ASSUMED_TERM_YEARS before its end) to its end date: a line paid by the
 * month its monthly value in full; any other line ASSUMED_CEILING_USED of its
 * ceiling (no value at all: M1's median rule), spread evenly — `planPerDay` is
 * the whole ceiling spread the same way. A live supplier contract on a client
 * project costs its current value (USD at ASSUMED_USD_EGP, as M5) spread from
 * its original start (assumed the same way) to its current end. EPROM's own
 * needs and supplier-side codes are not a client project and are left out. A
 * line bills nothing after its end date, even while it is still in the report
 * (R2) — its supplier costs still count, so the profit chart names it apart.
 */
export function moneyModel(data: BdData): MoneyModel {
  const all = projectLines(data);
  const median = typeMedianValue(all);
  const lines: BillingLine[] = [];
  let linesLeftOut = 0;
  for (const r of all) {
    const to = isoOf(r.expiryDate);
    if (!to) { linesLeftOut++; continue; }
    const real = isoOf(r.startDate);
    const startAssumed = !(real && real < to);
    const from = startAssumed ? plusYears(to, -ASSUMED_TERM_YEARS) : (real as string);
    const c = ceilingOf(r), monthly = num(r.monthlyValueEgp);
    let plan: number, bill: number;
    if (c == null && monthly != null && monthly > 0) plan = bill = (monthly * 12) / 365;
    else {
      const v = c ?? median(r);
      if (v == null) { linesLeftOut++; continue; }
      plan = v / (dayOf(to) - dayOf(from)); bill = plan * ASSUMED_CEILING_USED;
    }
    lines.push({ id: r.id, client: r.client, type: typeOf(r), from, to, perDay: bill, planPerDay: plan, ceilingEgp: c, startAssumed });
  }
  const kind = new Map(data.clients.map(c => [c.code, c.kind]));
  const suppliers: Stream[] = [];
  let suppliersLeftOut = 0;
  for (const s of data.supplierContracts.filter(isLiveSupplier)) {
    const client = txt(s.client), k = kind.get(client);
    if (k != null && k !== 'client') continue;
    const v = num(s.currentValueEgp);
    const value = v == null ? null : isEgpSupplier(s) ? v : isUsd(s) ? v * ASSUMED_USD_EGP : null;
    const to = isoOf(s.currentEnd);
    if (!client || value == null || value <= 0 || !to) { suppliersLeftOut++; continue; }
    const real = isoOf(s.originalStart);
    const from = real && real < to ? real : plusYears(to, -ASSUMED_TERM_YEARS);
    suppliers.push({ id: s.id, client, type: txt(s.costType), from, to, perDay: value / (dayOf(to) - dayOf(from)) });
  }
  return { lines, suppliers, linesLeftOut, suppliersLeftOut };
}

export interface ClientMoney {
  client: string;
  invoicedEgp: number;
  /** The whole ceiling spread over the term (M2's "should be paid"). */
  plannedEgp: number;
  subcontractEgp: number;
  /** Own direct cost = invoiced ÷ PRICE_BUILDUP − subcontractors, not below zero; split by OWN_COST_SPLIT. */
  ownEgp: number;
  staffEgp: number;
  allowancesEgp: number;
  travelEgp: number;
  /** Subcontractors + own direct cost (M8). */
  costEgp: number;
  overheadEgp: number;
  /** Invoiced − cost − overhead (M9). */
  profitEgp: number;
}

const blankMoney = (client: string): ClientMoney => ({
  client, invoicedEgp: 0, plannedEgp: 0, subcontractEgp: 0, ownEgp: 0, staffEgp: 0, allowancesEgp: 0, travelEgp: 0, costEgp: 0, overheadEgp: 0, profitEgp: 0,
});

/** Billing, cost and profit per client project between two dates, plus the total. */
export function moneyBetween(m: MoneyModel, from: string, to: string): { rows: ClientMoney[]; total: ClientMoney } {
  const at = new Map<string, ClientMoney>();
  const get = (c: string) => { const e = at.get(c) || blankMoney(c); at.set(c, e); return e; };
  for (const l of m.lines) {
    const d = overlap(l.from, l.to, from, to);
    if (d > 0) { const e = get(l.client); e.invoicedEgp += l.perDay * d; e.plannedEgp += l.planPerDay * d; }
  }
  for (const s of m.suppliers) {
    const d = overlap(s.from, s.to, from, to);
    if (d > 0) get(s.client).subcontractEgp += s.perDay * d;
  }
  const total = blankMoney('');
  for (const e of at.values()) {
    e.ownEgp = Math.max(0, e.invoicedEgp / PRICE_BUILDUP - e.subcontractEgp);
    e.staffEgp = e.ownEgp * OWN_COST_SPLIT.staff;
    e.allowancesEgp = e.ownEgp * OWN_COST_SPLIT.allowances;
    e.travelEgp = e.ownEgp * OWN_COST_SPLIT.travel;
    e.costEgp = e.subcontractEgp + e.ownEgp;
    e.overheadEgp = e.costEgp * OVERHEAD_OF_DIRECT;
    e.profitEgp = e.invoicedEgp - e.costEgp - e.overheadEgp;
    for (const k of Object.keys(total) as (keyof ClientMoney)[]) if (k !== 'client') (total[k] as number) += e[k] as number;
  }
  return { rows: [...at.values()], total };
}

/** M4, M6–M9 — per client project over the last 12 months up to today. */
export function moneyLastYear(data: BdData, today: string): { rows: ClientMoney[]; total: ClientMoney; model: MoneyModel } {
  const model = moneyModel(data);
  return { ...moneyBetween(model, plusDays(today, -365), today), model };
}

/** The last `n` COMPLETED quarters, oldest first. */
const doneQuarters = (today: string, n: number) => lastQuarters(today, n + 1).slice(0, n);

/** M2 — per completed quarter: what the ceilings say we should bill vs what we billed. */
export function billingByQuarter(data: BdData, today: string, n = MONEY_QUARTERS): { quarter: string; plannedEgp: number; invoicedEgp: number }[] {
  const model = moneyModel(data);
  return doneQuarters(today, n).map(q => {
    const [from, to] = quarterSpan(q);
    const t = moneyBetween(model, from, to).total;
    return { quarter: q, plannedEgp: t.plannedEgp, invoicedEgp: t.invoicedEgp };
  });
}

/** M11 — per completed quarter: cash in (bills paid ASSUMED_PAY_DAYS later) vs cash out (cost + overhead, paid when incurred). */
export function cashByQuarter(data: BdData, today: string, n = MONEY_QUARTERS): { quarter: string; inEgp: number; outEgp: number }[] {
  const model = moneyModel(data);
  return doneQuarters(today, n).map(q => {
    const [from, to] = quarterSpan(q);
    const paid = moneyBetween(model, plusDays(from, -ASSUMED_PAY_DAYS), plusDays(to, -ASSUMED_PAY_DAYS)).total;
    const spent = moneyBetween(model, from, to).total;
    return { quarter: q, inEgp: paid.invoicedEgp, outEgp: spent.costEgp + spent.overheadEgp };
  });
}

/** M3 — the age bands of money owed, in days since the invoice: [band, from, to]. */
export const OWED_BANDS = [['d30', 0, 30], ['d60', 30, 60], ['d90', 60, 90], ['over90', 90, Infinity]] as const;
export type OwedBand = typeof OWED_BANDS[number][0];

/**
 * M3 — what clients still owe us, by age: every bill of the last ASSUMED_PAY_DAYS
 * is unpaid, everything older is paid; plus what we collected over the last 12
 * months (the bills of the 12 months before those).
 */
export function owedByAge(data: BdData, today: string): { bands: { band: OwedBand; egp: number }[]; owedEgp: number; collectedEgp: number } {
  const model = moneyModel(data);
  const billed = (from: string, to: string) => (from < to ? moneyBetween(model, from, to).total.invoicedEgp : 0);
  const oldest = plusDays(today, -ASSUMED_PAY_DAYS);
  const bands = OWED_BANDS.map(([band, lo, hi]) => {
    const start = hi === Infinity ? oldest : plusDays(today, -hi);
    return { band, egp: billed(start > oldest ? start : oldest, plusDays(today, -lo)) };
  });
  return { bands, owedEgp: bands.reduce((a, b) => a + b.egp, 0), collectedEgp: billed(plusDays(oldest, -365), oldest) };
}

export interface UsedLine { id: string; client: string; type: string; ceilingEgp: number; usedEgp: number; usedPct: number; startAssumed: boolean }

/** M10 — per line with a ceiling: billed from its start to today against the ceiling, most used first. */
export function ceilingUsed(data: BdData, today: string): { rows: UsedLine[]; noCeiling: number } {
  const model = moneyModel(data);
  const rows: UsedLine[] = [];
  let noCeiling = model.linesLeftOut;
  for (const l of model.lines) {
    if (l.ceilingEgp == null) { noCeiling++; continue; }
    const usedEgp = l.perDay * overlap(l.from, l.to, l.from, today);
    rows.push({ id: l.id, client: l.client, type: l.type, ceilingEgp: l.ceilingEgp, usedEgp, usedPct: (usedEgp / l.ceilingEgp) * 100, startAssumed: l.startAssumed });
  }
  rows.sort((a, b) => b.usedPct - a.usedPct || b.ceilingEgp - a.ceilingEgp || a.client.localeCompare(b.client));
  return { rows, noCeiling };
}
