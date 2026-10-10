/**
 * Medical contracts board (queue M4a) — pure logic, harness-covered.
 *
 * The `medicalContracts` collection holds the ~125 contracts EPROM has with
 * hospitals, pharmacies, labs and centres for its staff, uploaded in M3 by a
 * script kept OUTSIDE the repo (the data must never be committed — public repo).
 * Who may open it is per person (`lib/medicalAccess.ts`), never the role.
 *
 * ── Status is derived, never stored (settled rule 3) ─────────────────────────
 * The import deliberately left `dateStatus` / `daysLeft` out of the docs: an
 * "Ending soon" written on 10 Oct is wrong by November. The board computes the
 * status from the end date as of TODAY, with two sheet facts that a date
 * cannot express taking precedence: a contract the sheet calls *Not signed* or
 * *Renewing* says so, whatever its dates.
 *
 * ── Keys are the stored text ─────────────────────────────────────────────────
 * Governorate, area and type are Arabic data, shown as typed. Status values are
 * English enum values and are translated at display time only.
 */
import { normalizeArabic } from '../utils';

export interface MedicalContract {
  id: string;
  contractNo: string;
  type: string;
  provider: string;
  /** ISO yyyy-mm-dd, or ''. */
  startDate?: string;
  /** ISO yyyy-mm-dd; '' when the contract renews by itself. */
  endDate?: string;
  autoRenew?: boolean;
  address?: string;
  /** The sheet's own words, Arabic. */
  sheetStatusAr?: string;
  sheetStatus?: 'Active' | 'Expired' | 'Renewing' | 'Not signed' | string;
  governorate: string;
  /** '' = nobody has named the area yet (M4b lets an editor do it). */
  area: string;
  lat?: number;
  lng?: number;
  /** The sheet and the dates disagree — someone must confirm. */
  needsCheck?: boolean;
  importNotes?: string[];
  sheetRowNo?: number;
  importedAsOf?: string;
  /** Who last saved the form (M4b). */
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: unknown;
  /** Who cleared "Needs check" (M4b). */
  checkedByName?: string;
  checkedAt?: unknown;
}

export type MedicalStatus = 'Expired' | 'Ending soon' | 'Renewing' | 'Not signed' | 'Active' | 'Auto-renew' | 'No end date';

/** Worst first — the order of the status filter, the chips and the rows. */
export const MEDICAL_STATUSES: MedicalStatus[] = ['Expired', 'Ending soon', 'Renewing', 'Not signed', 'Active', 'Auto-renew', 'No end date'];

/** A contract ending within this many days is "Ending soon" (same window as the Calendar). */
export const ENDING_SOON_DAYS = 60;

/** Local calendar date as yyyy-mm-dd (not UTC — a contract ends on Egypt's date). */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayNo = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

/** Whole days from `today` to the end date (negative = ended). null when there is no usable end date. */
export function daysLeft(c: Pick<MedicalContract, 'endDate'>, today: string): number | null {
  const end = (c.endDate || '').trim();
  if (!ISO.test(end) || !ISO.test(today)) return null;
  return Math.round(dayNo(end) - dayNo(today));
}

export function statusOf(c: Pick<MedicalContract, 'endDate' | 'autoRenew' | 'sheetStatus'>, today: string): MedicalStatus {
  if (c.sheetStatus === 'Not signed') return 'Not signed';
  if (c.sheetStatus === 'Renewing') return 'Renewing';
  if (c.autoRenew) return 'Auto-renew';
  const left = daysLeft(c, today);
  if (left == null) return 'No end date';
  if (left < 0) return 'Expired';
  if (left <= ENDING_SOON_DAYS) return 'Ending soon';
  return 'Active';
}

/** Badge class (index.css) per status. Red = gone, amber = act now, green = fine. */
export const STATUS_BADGE: Record<MedicalStatus, string> = {
  'Expired': 'badge-urgent',
  'Ending soon': 'badge-high',
  'Renewing': 'badge-inprogress',
  'Not signed': 'badge-closed',
  'Active': 'badge-done',
  'Auto-renew': 'badge-done',
  'No end date': 'badge-closed',
};

export interface MedicalFilter {
  q?: string;
  type?: string;        // 'all' or a stored type
  status?: string;      // 'all' or a MedicalStatus
  governorate?: string; // 'all' or a stored governorate
  needsCheck?: boolean;
}

/** Folded text a search word is matched against. */
const haystack = (c: MedicalContract) => normalizeArabic([
  c.provider, c.contractNo, c.type, c.governorate, c.area, c.address, c.sheetStatusAr,
].filter(Boolean).join(' ')).toLowerCase();

/** Every word of the query must appear (Arabic letter variants folded, any order). */
export function matchesQuery(c: MedicalContract, q: string): boolean {
  const words = normalizeArabic(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const h = haystack(c);
  return words.every(w => h.includes(w));
}

export function filterContracts(list: readonly MedicalContract[], f: MedicalFilter, today: string): MedicalContract[] {
  return list.filter(c =>
    (!f.type || f.type === 'all' || c.type === f.type)
    && (!f.governorate || f.governorate === 'all' || c.governorate === f.governorate)
    && (!f.status || f.status === 'all' || statusOf(c, today) === f.status)
    && (!f.needsCheck || !!c.needsCheck)
    && matchesQuery(c, f.q || ''));
}

/** Rows inside an area: worst status first, then soonest end, then provider name. */
export function compareContracts(today: string) {
  return (a: MedicalContract, b: MedicalContract) => {
    const sa = MEDICAL_STATUSES.indexOf(statusOf(a, today));
    const sb = MEDICAL_STATUSES.indexOf(statusOf(b, today));
    if (sa !== sb) return sa - sb;
    const da = daysLeft(a, today), dbv = daysLeft(b, today);
    if (da !== dbv) return (da ?? Infinity) - (dbv ?? Infinity);
    return (a.provider || '').localeCompare(b.provider || '', 'ar');
  };
}

export interface StatusCounts { total: number; byStatus: Record<MedicalStatus, number>; needsCheck: number; }

export function countStatuses(list: readonly MedicalContract[], today: string): StatusCounts {
  const byStatus = Object.fromEntries(MEDICAL_STATUSES.map(s => [s, 0])) as Record<MedicalStatus, number>;
  let needsCheck = 0;
  for (const c of list) {
    byStatus[statusOf(c, today)]++;
    if (c.needsCheck) needsCheck++;
  }
  return { total: list.length, byStatus, needsCheck };
}

/** Distinct non-empty values with their counts, biggest first then by name. */
export function tally(list: readonly MedicalContract[], keyOf: (c: MedicalContract) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const c of list) {
    const k = (keyOf(c) || '').trim();
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'));
}

/** Google Maps link for a contract with coordinates, else null. */
export function mapLink(c: Pick<MedicalContract, 'lat' | 'lng'>): string | null {
  if (typeof c.lat !== 'number' || typeof c.lng !== 'number' || !isFinite(c.lat) || !isFinite(c.lng)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`;
}

// ── Editing (queue M4b) ──────────────────────────────────────────────────────
// Only people with 'edit' access (lib/medicalAccess.ts) see the form; the rules
// refuse anyone else. The contract number is the doc id and is never edited.
// `sheetStatusAr` stays as the sheet's own words — it is a record of the import.

/** What an editor picks; dates still decide Active / Ending soon / Expired. */
export type ContractState = 'Signed' | 'Renewing' | 'Not signed';
export const CONTRACT_STATES: ContractState[] = ['Signed', 'Renewing', 'Not signed'];

export interface ContractDraft {
  provider: string;
  type: string;
  governorate: string;
  area: string;
  address: string;
  startDate: string;
  endDate: string;
  autoRenew: boolean;
  state: ContractState;
  needsCheck: boolean;
}

export const stateOf = (c: Pick<MedicalContract, 'sheetStatus'>): ContractState =>
  c.sheetStatus === 'Renewing' || c.sheetStatus === 'Not signed' ? c.sheetStatus : 'Signed';

export function draftOf(c: MedicalContract): ContractDraft {
  return {
    provider: c.provider || '',
    type: c.type || '',
    governorate: c.governorate || '',
    area: c.area || '',
    address: c.address || '',
    startDate: c.startDate || '',
    endDate: c.endDate || '',
    autoRenew: !!c.autoRenew,
    state: stateOf(c),
    needsCheck: !!c.needsCheck,
  };
}

/** Trim and squeeze inner spaces, so «سموحة » and «سموحة» are one area. */
export const tidy = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

/** Problems that block saving, as i18n keys (English sentences). Empty = fine. */
export function draftProblems(d: ContractDraft): string[] {
  const out: string[] = [];
  if (!tidy(d.provider)) out.push('Write the provider name.');
  if (!tidy(d.governorate)) out.push('Choose or type the governorate.');
  if ((d.startDate && !ISO.test(d.startDate)) || (!d.autoRenew && d.endDate && !ISO.test(d.endDate))) out.push('A date is not complete.');
  else if (!d.autoRenew && d.startDate && d.endDate && d.endDate < d.startDate) out.push('The end date comes before the start date.');
  return out;
}

/** Only the fields that changed, ready for `updateDoc`. Empty object = nothing to save. */
export function contractPatch(c: MedicalContract, d: ContractDraft): Partial<MedicalContract> {
  const before = draftOf(c);
  const after: ContractDraft = {
    ...d,
    provider: tidy(d.provider), type: tidy(d.type), governorate: tidy(d.governorate),
    area: tidy(d.area), address: tidy(d.address),
    // A contract that renews by itself has no end date (the import's shape).
    endDate: d.autoRenew ? '' : d.endDate,
  };
  const patch: Partial<MedicalContract> = {};
  for (const k of ['provider', 'type', 'governorate', 'area', 'address', 'startDate', 'endDate', 'autoRenew', 'needsCheck'] as const) {
    if (after[k] !== before[k]) (patch as any)[k] = after[k];
  }
  if (after.state !== before.state) patch.sheetStatus = after.state === 'Signed' ? 'Active' : after.state;
  return patch;
}

/** Area names already used in a governorate, biggest first — the area picker's list. */
export function areasIn(list: readonly MedicalContract[], governorate: string): string[] {
  const g = tidy(governorate);
  return tally(list.filter(c => tidy(c.governorate) === g), c => tidy(c.area)).map(([a]) => a);
}

// ── Statistics (queue M5) ────────────────────────────────────────────────────
// Every figure is worked out from the contracts at render (settled rule 3), as
// of today, so the statistics can never disagree with the board. The seven
// statuses fold into four plain buckets for the charts; the status split keeps
// all seven.

export type StatBucket = 'inForce' | 'endingSoon' | 'expired' | 'other';
/** Bar order: fine first, then act now, then gone, then the rest. */
export const STAT_BUCKETS: StatBucket[] = ['inForce', 'endingSoon', 'expired', 'other'];

export const bucketOf = (s: MedicalStatus): StatBucket =>
  s === 'Active' || s === 'Auto-renew' ? 'inForce'
    : s === 'Ending soon' ? 'endingSoon'
    : s === 'Expired' ? 'expired'
    : 'other';

export interface StatRow {
  /** The stored text ('' = not named yet). */
  key: string;
  /** Area rows only: the governorate the area sits in. */
  governorate?: string;
  total: number;
  buckets: Record<StatBucket, number>;
}

export interface DatedContract { c: MedicalContract; days: number; }

export interface MedicalStats {
  total: number;
  byStatus: Record<MedicalStatus, number>;
  buckets: Record<StatBucket, number>;
  needsCheck: number;
  byGovernorate: StatRow[];
  /** Every area across governorates, most contracts first; an area is named per governorate. */
  areas: StatRow[];
  byType: StatRow[];
  /** In force today and ending within ENDING_SOON_DAYS — soonest first. */
  endingSoon: DatedContract[];
  /** Ended and not being renewed — most recently ended first. */
  expired: DatedContract[];
}

const emptyBuckets = (): Record<StatBucket, number> => ({ inForce: 0, endingSoon: 0, expired: 0, other: 0 });

/** Rows biggest first, then by name; the unnamed ('') row always last. */
function rowsOf(list: readonly MedicalContract[], today: string, keyOf: (c: MedicalContract) => string, govOf?: (c: MedicalContract) => string): StatRow[] {
  const m = new Map<string, StatRow>();
  for (const c of list) {
    const key = tidy(keyOf(c));
    const governorate = govOf ? tidy(govOf(c)) : undefined;
    const id = governorate == null ? key : `${governorate}\u0000${key}`;
    let r = m.get(id);
    if (!r) { r = { key, governorate, total: 0, buckets: emptyBuckets() }; m.set(id, r); }
    r.total++;
    r.buckets[bucketOf(statusOf(c, today))]++;
  }
  return [...m.values()].sort((a, b) =>
    (a.key === '' ? 1 : 0) - (b.key === '' ? 1 : 0)
    || b.total - a.total
    || a.key.localeCompare(b.key, 'ar')
    || (a.governorate || '').localeCompare(b.governorate || '', 'ar'));
}

export function medicalStats(list: readonly MedicalContract[], today: string): MedicalStats {
  const counts = countStatuses(list, today);
  const buckets = emptyBuckets();
  for (const s of MEDICAL_STATUSES) buckets[bucketOf(s)] += counts.byStatus[s];
  const dated = (s: MedicalStatus) => list
    .filter(c => statusOf(c, today) === s)
    .map(c => ({ c, days: daysLeft(c, today) as number }));
  return {
    total: counts.total,
    byStatus: counts.byStatus,
    buckets,
    needsCheck: counts.needsCheck,
    byGovernorate: rowsOf(list, today, c => c.governorate),
    areas: rowsOf(list, today, c => c.area, c => c.governorate),
    byType: rowsOf(list, today, c => c.type),
    endingSoon: dated('Ending soon').sort((a, b) => a.days - b.days || a.c.provider.localeCompare(b.c.provider, 'ar')),
    expired: dated('Expired').sort((a, b) => b.days - a.days || a.c.provider.localeCompare(b.c.provider, 'ar')),
  };
}
