// Analysis center (queue A1) — the maths behind the question charts. Pure, like
// lib/bdControl.ts: rows in, figures out, worked out from today at render, so an
// edit in eTaske or a new Excel load moves the charts with no code change.
//
// A "project" is one client contract line (bdControl/clientContracts). AGIBA is a
// project like any other (Tariq, 19 Oct 2026) — no special case here.

import { daysUntil, type BdClientContract, type BdData } from './bdControl';

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
