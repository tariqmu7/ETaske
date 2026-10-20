// Analysis center (queue A1) — the maths behind the question charts. Pure, like
// lib/bdControl.ts: rows in, figures out, worked out from today at render, so an
// edit in eTaske or a new Excel load moves the charts with no code change.
//
// A "project" is one client contract line (bdControl/clientContracts). AGIBA is a
// project like any other (Tariq, 19 Oct 2026) — no special case here.

import {
  daysUntil, isEgpSupplier, isLiveSupplier, periodDate, supplierFlag, type BdClientContract, type BdData, type BdSupplierContract,
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
export function projectValues(data: BdData): { rows: ProjectValue[]; realEgp: number; assumedEgp: number; assumedLines: number } {
  const lines = projectLines(data);
  const ceil = (r: BdClientContract) => { const c = num(r.ceilingEgp); return c != null && c > 0 ? c : null; };
  const all = lines.map(ceil).filter((c): c is number => c != null);
  const byType = new Map<string, number[]>();
  for (const r of lines) { const c = ceil(r); if (c != null) byType.set(typeOf(r), [...(byType.get(typeOf(r)) || []), c]); }
  const m = new Map<string, ProjectValue>();
  let assumedLines = 0;
  for (const r of lines) {
    const e = m.get(r.client) || { client: r.client, lines: 0, realEgp: 0, assumedEgp: 0, totalEgp: 0, basis: [] };
    e.lines++;
    const c = ceil(r), monthly = num(r.monthlyValueEgp);
    if (c != null) e.realEgp += c;
    else {
      const [v, b]: [number | null, AssumeBasis] = monthly != null && monthly > 0
        ? [monthly * ASSUMED_MONTHS, 'monthly']
        : [medianOf(byType.get(typeOf(r)) || []) ?? medianOf(all), 'typeMedian'];
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
