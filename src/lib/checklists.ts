/**
 * Starting checklists for a new tender or project (queue C3).
 *
 * A new bid or project opens with its standard steps already in place — bid
 * bond, technical offer, pricing, submission — each dated back from the record's
 * own anchor date (the submission deadline for a bid, the start date for a
 * project). The steps then live ON the record as a `checklist` array.
 *
 * ── Why an array on the parent and not a child collection ───────────────────
 * Settled rule 1: list cards read only the parent. A checklist is short (a
 * dozen rows), belongs to exactly one record and is never queried on its own,
 * so it rides on the doc — the board card can show "4/11 steps" for free, and
 * `firestore.rules` already let any Approved user update a bid or a project, so
 * there is nothing to deploy. Concurrent ticks are made safe by the caller
 * writing through a transaction (see ChecklistPanel), not by this module.
 *
 * ── Why the step titles are stored in English ───────────────────────────────
 * Same rule as the bid gates: the title is DATA and is painted through the
 * display-label layer. Storing Arabic for one user and English for another
 * would make "have we done the bid bond?" unanswerable across the book.
 * A step the user types in is stored exactly as typed.
 *
 * Pure: no Firebase, no React, no clock — `today` and the id maker are injected
 * so the harness (`scripts/harness/checklists.mjs`) can pin them.
 */

export interface ChecklistItem {
  id: string;
  /** English template title (display-labelled) or the user's own text. */
  title: string;
  /** yyyy-mm-dd, or '' when the anchor date was unknown. */
  dueDate: string;
  done: boolean;
  /** yyyy-mm-dd the step was ticked. */
  doneAt?: string;
  doneByName?: string;
  /**
   * Days from the anchor date, kept for template steps only — lets
   * "Re-date from the deadline" move the step when the anchor moves. A step
   * whose date the user changed by hand loses it, so a re-date never
   * overwrites a date somebody chose.
   */
  offset?: number;
}

export type ChecklistTarget = 'opportunity' | 'project';
export type ChecklistTemplateKey = 'tender' | 'quotation' | 'contract';

export interface ChecklistStep { title: string; offset: number }

export interface ChecklistTemplate {
  key: ChecklistTemplateKey;
  /** English display name — also its i18next key. */
  label: string;
  target: ChecklistTarget;
  steps: ChecklistStep[];
}

// Offsets are in calendar days from the anchor: negative = before the bid's
// submission deadline, positive = after the project's start date. They are a
// starting guess the team edits per record, not a rule.
export const CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
  {
    key: 'tender',
    label: 'Full tender',
    target: 'opportunity',
    steps: [
      { title: 'Tender documents received', offset: -21 },
      { title: 'Go / no-go decision', offset: -18 },
      { title: 'Site visit / pre-bid meeting', offset: -14 },
      { title: 'Clarification questions sent', offset: -12 },
      { title: 'Bid bond requested from the bank', offset: -10 },
      { title: 'Technical offer drafted', offset: -7 },
      { title: 'Pricing and commercial offer', offset: -5 },
      { title: 'Price approved by management', offset: -3 },
      { title: 'Bid bond received', offset: -3 },
      { title: 'Offer signed, stamped and sealed', offset: -1 },
      { title: 'Offer submitted', offset: 0 },
    ],
  },
  {
    key: 'quotation',
    label: 'Quick quotation',
    target: 'opportunity',
    steps: [
      { title: 'Scope clarified with the client', offset: -3 },
      { title: 'Price prepared', offset: -2 },
      { title: 'Price approved by management', offset: -1 },
      { title: 'Quotation sent', offset: 0 },
    ],
  },
  {
    key: 'contract',
    label: 'New contract',
    target: 'project',
    steps: [
      { title: 'Contract signed', offset: 0 },
      { title: 'Performance bond issued', offset: 7 },
      { title: 'Insurance policies in place', offset: 7 },
      { title: 'Kick-off meeting with the client', offset: 7 },
      { title: 'Subcontracts placed', offset: 14 },
      { title: 'HSE and quality plan submitted', offset: 14 },
      { title: 'Mobilisation to site', offset: 14 },
      { title: 'First invoice issued', offset: 30 },
    ],
  },
];

export const templatesFor = (target: ChecklistTarget) =>
  CHECKLIST_TEMPLATES.filter(tp => tp.target === target);

export const getTemplate = (key?: string | null) =>
  CHECKLIST_TEMPLATES.find(tp => tp.key === key) || null;

/**
 * The template a new bid starts with, from its source. A formal tender gets
 * the full list; a direct order or a referral is usually a short quotation.
 */
export const defaultTemplateForSource = (source?: string | null): ChecklistTemplateKey =>
  source === 'Direct Order' || source === 'Referral' || source === 'Other' ? 'quotation' : 'tender';

// ── Date helpers (local calendar days, no time zone drift) ──────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const addDays = (iso: string, n: number) => {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return fmt(d);
};

/**
 * Due date for a template step.
 *
 * With the anchor still ahead, a step whose natural date is already past is
 * pulled up to TODAY — a tender announced a week before its deadline must not
 * open with half its checklist red. With the anchor itself in the past (a bid
 * recorded after the fact) the natural dates stand: those steps really are late,
 * and saying otherwise would be a flattering default.
 */
export const stepDueDate = (anchor: string | undefined | null, offset: number, today: string) => {
  if (!anchor || !ISO.test(anchor)) return '';
  const natural = addDays(anchor, offset);
  if (anchor >= today && natural < today) return today;
  return natural;
};

let seq = 0;
export const defaultMakeId = () =>
  `c${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const itemFrom = (step: ChecklistStep, anchor: string | undefined | null, today: string, makeId: () => string): ChecklistItem => ({
  id: makeId(),
  title: step.title,
  dueDate: stepDueDate(anchor, step.offset, today),
  done: false,
  offset: step.offset,
});

/** The full starting checklist for a template ('' / unknown key → none). */
export function buildChecklist(
  key: string | null | undefined,
  anchor: string | undefined | null,
  today: string,
  makeId: () => string = defaultMakeId,
): ChecklistItem[] {
  const tp = getTemplate(key);
  if (!tp) return [];
  return tp.steps.map(s => itemFrom(s, anchor, today, makeId));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Template steps not yet on the list (matched by title, case-insensitive). */
export function missingSteps(key: string | null | undefined, items: ChecklistItem[]): ChecklistStep[] {
  const tp = getTemplate(key);
  if (!tp) return [];
  const have = new Set(items.map(i => norm(i.title)));
  return tp.steps.filter(s => !have.has(norm(s.title)));
}

/**
 * Adds the missing template steps, keeping the list in date order. Safe to
 * press twice — a step already on the list is never duplicated.
 */
export function addTemplateSteps(
  items: ChecklistItem[],
  key: string | null | undefined,
  anchor: string | undefined | null,
  today: string,
  makeId: () => string = defaultMakeId,
): ChecklistItem[] {
  const added = missingSteps(key, items).map(s => itemFrom(s, anchor, today, makeId));
  return sortChecklist([...items, ...added]);
}

/**
 * Date order, undated last; ties keep their existing order. `Array.sort` is
 * stable, so a template's own step order survives for steps sharing a day.
 */
export function sortChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return [...items].sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });
}

export function addItem(
  items: ChecklistItem[],
  title: string,
  dueDate: string,
  makeId: () => string = defaultMakeId,
): ChecklistItem[] {
  const t = title.trim();
  if (!t) return items;
  return sortChecklist([...items, { id: makeId(), title: t, dueDate: ISO.test(dueDate) ? dueDate : '', done: false }]);
}

export function setDone(
  items: ChecklistItem[],
  id: string,
  done: boolean,
  today: string,
  byName: string,
): ChecklistItem[] {
  return items.map(i => {
    if (i.id !== id) return i;
    if (done) return { ...i, done: true, doneAt: i.done && i.doneAt ? i.doneAt : today, doneByName: i.done && i.doneByName ? i.doneByName : byName };
    // Unticking drops the who/when so a stale completion can never be read.
    const { doneAt: _a, doneByName: _b, ...rest } = i;
    return { ...rest, done: false };
  });
}

/** A hand-set date detaches the step from the anchor (drops `offset`). */
export function setDue(items: ChecklistItem[], id: string, dueDate: string): ChecklistItem[] {
  return sortChecklist(items.map(i => {
    if (i.id !== id) return i;
    const { offset: _o, ...rest } = i;
    return { ...rest, dueDate: ISO.test(dueDate) ? dueDate : '' };
  }));
}

export function renameItem(items: ChecklistItem[], id: string, title: string): ChecklistItem[] {
  const t = title.trim();
  if (!t) return items;
  return items.map(i => (i.id === id ? { ...i, title: t } : i));
}

export function removeItem(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.filter(i => i.id !== id);
}

/**
 * Moves every OPEN step that still follows the anchor to its new date. Done
 * steps keep their date (it is history) and hand-dated steps keep theirs.
 */
export function redate(items: ChecklistItem[], anchor: string | undefined | null, today: string): ChecklistItem[] {
  if (!anchor || !ISO.test(anchor)) return items;
  return sortChecklist(items.map(i =>
    !i.done && typeof i.offset === 'number' ? { ...i, dueDate: stepDueDate(anchor, i.offset, today) } : i,
  ));
}

/** How many open steps `redate` would move — 0 hides the button. */
export function redateCount(items: ChecklistItem[], anchor: string | undefined | null, today: string): number {
  if (!anchor || !ISO.test(anchor)) return 0;
  return items.filter(i => !i.done && typeof i.offset === 'number' && stepDueDate(anchor, i.offset, today) !== i.dueDate).length;
}

export interface ChecklistProgress {
  done: number;
  total: number;
  percent: number;
  /** Open steps whose date is before today. */
  late: number;
  /** The earliest open step (by list order, which is date order). */
  next: ChecklistItem | null;
}

export function checklistProgress(items: ChecklistItem[] | undefined | null, today: string): ChecklistProgress {
  const list = Array.isArray(items) ? items : [];
  const done = list.filter(i => i.done).length;
  const open = sortChecklist(list.filter(i => !i.done));
  return {
    done,
    total: list.length,
    percent: list.length ? Math.round((done / list.length) * 100) : 0,
    late: open.filter(i => i.dueDate && i.dueDate < today).length,
    next: open[0] || null,
  };
}

/** Today as yyyy-mm-dd in local time (the one impure helper; callers inject it). */
export const localToday = () => fmt(new Date());
