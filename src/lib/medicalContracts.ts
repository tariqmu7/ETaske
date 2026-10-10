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
