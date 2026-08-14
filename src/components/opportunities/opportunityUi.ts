// Shared presentation helpers for the Opportunities module. They live here so
// the list dashboard and the detail page read a stage / a value / a deadline
// exactly the same way, without either file importing the other.
import { OpportunityStage } from '../../types';

// One colour per stage, reused by every badge, border and KPI tile.
export const STAGE_COLORS: Record<OpportunityStage, string> = {
  'Identified': '#64748b',
  'Prequalification': '#0ea5e9',
  'Bid Preparation': '#3b82f6',
  'Submitted': '#8b5cf6',
  'Under Evaluation': '#f59e0b',
  'Won': '#16a34a',
  'Lost': '#dc2626',
  'No Bid': '#94a3b8',
  'Cancelled': '#94a3b8',
};

export const toNumber = (v?: number | string) => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return isFinite(n) ? n : 0;
};

// Compact money so a KPI tile never wraps: 12.4M / 850K / 900.
export const money = (value: number, currency?: string) => {
  const abs = Math.abs(value);
  const short = abs >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M`
    : abs >= 1_000 ? `${(value / 1_000).toFixed(0)}K`
    : `${Math.round(value)}`;
  return currency ? `${short} ${currency}` : short;
};

// Full, unabbreviated amount — the detail page has room for the real number.
export const fullMoney = (value?: number | string, currency?: string) => {
  if (value === undefined || value === null || value === '') return '—';
  const n = toNumber(value);
  return `${n.toLocaleString('en-GB')}${currency ? ` ${currency}` : ''}`;
};

// Lives in src/utils.ts (the app-domain helpers module) so the alert engine in
// src/lib can share the exact same day arithmetic without importing out of the
// components tree. Re-exported here so the module's files keep one import.
export { daysUntil } from '../../utils';
