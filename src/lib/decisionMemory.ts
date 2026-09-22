/**
 * Decision memory (queue task D6).
 *
 * The part of a bid that walks out of the door when a person leaves: WHY we
 * dropped it, WHAT PRICE we last offered, and WHAT THE CLIENT OBJECTED TO. The
 * Outcome tab already records the end of the story (reasons, final price,
 * winner, lessons) — this module adds the middle of it, logged as it happens,
 * and reads both back per bid and per client:
 *
 *   · a bid's own timeline (its Decisions tab),
 *   · "earlier with this client" — the last price we offered them, why earlier
 *     bids were lost or dropped, what they objected to, what we learned — on a
 *     new bid for the same client and on the client's file.
 *
 * Storage: a `decisions` ARRAY ON THE OPPORTUNITY DOC, changed through a
 * transaction (like the checklist), so no new collection and no rules deploy.
 * Everything else is derived at render (settled rule 3). Plain shapes, not the
 * Firestore types, so `scripts/harness/decisionmemory.mjs` can feed fixtures.
 */

import { clientKey, dayOf, toMs } from './clientFile';

// ── The logged entry ─────────────────────────────────────────────────────────

/** decision = we chose something (go / no-go / discount / drop) and why;
 *  price = a price we put in front of the client;
 *  objection = what the client pushed back on, and our answer. */
export type DecisionKind = 'decision' | 'price' | 'objection';
export const DECISION_KINDS: DecisionKind[] = ['decision', 'price', 'objection'];

export interface BidDecision {
  id: string;
  kind: DecisionKind;
  /** yyyy-mm-dd — when it happened (not when it was typed). */
  date: string;
  /** decision: what was decided · objection: what they objected to · price: what the price was (e.g. "revised offer"). */
  text: string;
  /** decision: why · objection: our answer · price: what it covered / conditions. */
  why?: string;
  /** price only. */
  amount?: number;
  currency?: string;
  byId: string;
  byName: string;
  /** ms since epoch — typing order, the tie-break for one day. */
  at: number;
  editedAt?: number;
}

export interface DecisionInput {
  kind: DecisionKind;
  date: string;
  text: string;
  why?: string;
  amount?: string | number;
  currency?: string;
}

export const TEXT_MAX = 1000;
export const WHY_MAX = 2000;
/** Keeps one bid doc far below Firestore's 1 MiB cap. */
export const MAX_DECISIONS = 300;

export type DecisionProblem = 'kind' | 'text' | 'amount' | 'date' | 'full' | 'too-long';

/** A money string as typed ("1,250,000", "1 250 000.50", "١٢٠٠") → number, or NaN. */
export function parseAmount(v: string | number | undefined | null): number {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  const s = String(v ?? '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٬,\s]/g, '')
    .replace('٫', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validateDecision(input: DecisionInput, count = 0): DecisionProblem[] {
  const out: DecisionProblem[] = [];
  if (!DECISION_KINDS.includes(input.kind)) out.push('kind');
  if (!DAY.test(input.date || '')) out.push('date');
  if (input.kind === 'price') {
    const n = parseAmount(input.amount);
    if (!(n > 0)) out.push('amount');
  } else if (!(input.text || '').trim()) {
    out.push('text');
  }
  if ((input.text || '').length > TEXT_MAX || (input.why || '').length > WHY_MAX) out.push('too-long');
  if (count >= MAX_DECISIONS) out.push('full');
  return out;
}

let seq = 0;
export const defaultMakeId = () =>
  `d${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A clean entry — no undefined keys (Firestore refuses them inside an array). */
export function buildDecision(
  input: DecisionInput,
  who: { id: string; name: string },
  now: number = Date.now(),
  makeId: () => string = defaultMakeId,
): BidDecision {
  const d: BidDecision = {
    id: makeId(),
    kind: input.kind,
    date: input.date,
    text: (input.text || '').trim(),
    byId: who.id,
    byName: who.name || '',
    at: now,
  };
  const why = (input.why || '').trim();
  if (why) d.why = why;
  if (input.kind === 'price') {
    d.amount = parseAmount(input.amount);
    if (input.currency) d.currency = input.currency;
  }
  return d;
}

export function addDecision(list: BidDecision[] | undefined, d: BidDecision): BidDecision[] {
  const cur = Array.isArray(list) ? list : [];
  if (cur.some(x => x.id === d.id)) return cur;
  return [...cur, d];
}

/** Edits keep the author and the typing time; `editedAt` says it was changed. */
export function updateDecision(list: BidDecision[] | undefined, id: string, input: DecisionInput, now: number = Date.now()): BidDecision[] {
  const cur = Array.isArray(list) ? list : [];
  return cur.map(x => {
    if (x.id !== id) return x;
    const fresh = buildDecision(input, { id: x.byId, name: x.byName }, x.at, () => x.id);
    return { ...fresh, editedAt: now };
  });
}

export function removeDecision(list: BidDecision[] | undefined, id: string): BidDecision[] {
  return (Array.isArray(list) ? list : []).filter(x => x.id !== id);
}

/** The person who wrote it, or a manager / admin. */
export function canChangeDecision(d: Pick<BidDecision, 'byId'>, uid: string, role?: string): boolean {
  return d.byId === uid || role === 'Manager' || role === 'Admin';
}

// ── A bid's timeline ─────────────────────────────────────────────────────────

/** 'outcome' and 'lesson' come from the Outcome tab (opportunityFeedback). */
export type MemoryKind = DecisionKind | 'outcome' | 'lesson';

export interface MemoryRow {
  key: string;
  kind: MemoryKind;
  source: 'log' | 'outcome';
  /** yyyy-mm-dd, or '' when the record carries no date. */
  date: string;
  text: string;
  why?: string;
  amount?: number;
  currency?: string;
  by?: string;
  /** The logged entry, so the tab can edit / remove it. */
  entry?: BidDecision;
  /** Outcome rows: the stage, the reasons and the winner. */
  stage?: string;
  reasons?: string[];
  competitor?: string;
  winningPrice?: number;
  gapPercent?: number;
  /** Set on the per-client view: which bid it belongs to. */
  bid?: BidRef;
}

export interface BidRef { id: string; serial?: string; title: string; stage?: string }

const CLOSED = ['Won', 'Lost', 'No Bid', 'Cancelled'];

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseAmount(v as any);
  return isFinite(n) && n > 0 ? n : undefined;
};

const bidRef = (o: any): BidRef => ({ id: o.id, serial: o.serialNumber, title: o.title || '', stage: o.stage });

/** When the bid's end-of-story happened: decision date, else the feedback's own time. */
const outcomeDay = (o: any, f: any) => dayOf(o.decisionDate) || dayOf(f?.updatedAt) || dayOf(f?.createdAt);

/**
 * Everything remembered about one bid, newest first: the logged entries plus
 * what the Outcome record says (read-only here — it is edited on its own tab).
 */
export function bidTimeline(bid: any, feedback?: any | null): MemoryRow[] {
  const rows: MemoryRow[] = [];
  const logged: BidDecision[] = Array.isArray(bid?.decisions) ? bid.decisions : [];
  for (const d of logged) {
    rows.push({
      key: `log:${d.id}`, kind: d.kind, source: 'log', date: d.date || dayOf(d.at),
      text: d.text || '', why: d.why, amount: d.kind === 'price' ? num(d.amount) : undefined,
      currency: d.currency, by: d.byName, entry: d,
    });
  }
  const f = feedback;
  if (f && CLOSED.includes(f.outcome || bid?.stage)) {
    const day = outcomeDay(bid, f);
    rows.push({
      key: `fb:${f.id}:outcome`, kind: 'outcome', source: 'outcome', date: day,
      text: f.notes || '', by: f.authorName,
      stage: f.outcome || bid?.stage,
      reasons: orderedReasons(f),
      competitor: f.competitorName || bid?.awardedTo || undefined,
      winningPrice: num(f.winningPrice),
      gapPercent: typeof f.priceGapPercent === 'number' ? f.priceGapPercent : undefined,
    });
    const ours = num(f.ourPrice);
    if (ours !== undefined) {
      rows.push({
        key: `fb:${f.id}:price`, kind: 'price', source: 'outcome', date: day,
        text: '', amount: ours, currency: bid?.currency, by: f.authorName,
      });
    }
    if ((f.clientFeedback || '').trim()) {
      rows.push({ key: `fb:${f.id}:client`, kind: 'objection', source: 'outcome', date: day, text: f.clientFeedback.trim(), by: f.authorName });
    }
    if ((f.lessonsLearned || '').trim()) {
      rows.push({ key: `fb:${f.id}:lesson`, kind: 'lesson', source: 'outcome', date: day, text: f.lessonsLearned.trim(), by: f.authorName });
    }
  }
  return rows.sort(newestFirst);
}

/** Primary reason first, then the rest in the order they were ticked. */
function orderedReasons(f: any): string[] {
  const all: string[] = Array.isArray(f?.reasons) ? f.reasons.filter(Boolean) : [];
  const p = f?.primaryReason;
  return p && all.includes(p) ? [p, ...all.filter(r => r !== p)] : all;
}

/** Newest day first; on one day, a logged entry by typing time, outcome facts last-in-first. */
function newestFirst(a: MemoryRow, b: MemoryRow): number {
  if (a.date !== b.date) return (b.date || '').localeCompare(a.date || '');
  if (a.source !== b.source) return a.source === 'outcome' ? -1 : 1;
  return (b.entry?.at ?? 0) - (a.entry?.at ?? 0);
}

/**
 * The latest price on one bid, by date. The Outcome's "our price" is dated on
 * the decision, so it wins over earlier logged offers — it is the final one.
 * An undated price never beats a dated one.
 */
export function lastPriceOf(bid: any, feedback?: any | null): MemoryRow | null {
  const prices = bidTimeline(bid, feedback).filter(r => r.kind === 'price' && r.amount !== undefined);
  return prices.find(r => r.date) || prices[0] || null;
}

// ── Earlier with this client ─────────────────────────────────────────────────

export interface DroppedBid {
  bid: BidRef;
  stage: string;
  date: string;
  /** Primary reason first (the fixed Outcome list — display-label at render). */
  reasons: string[];
  /** The last logged decision on that bid, which usually says it in words. */
  said?: string;
  saidWhy?: string;
  competitor?: string;
  gapPercent?: number;
}

export interface ClientMemory {
  key: string;
  /** Bids read (the client's bids, minus the one being looked at). */
  bidCount: number;
  lastPrice: (MemoryRow & { bid: BidRef }) | null;
  /** The latest price on each bid, newest first — "what we have charged them". */
  prices: (MemoryRow & { bid: BidRef })[];
  /** Lost / No Bid / Cancelled, newest first, with the why. */
  dropped: DroppedBid[];
  objections: (MemoryRow & { bid: BidRef })[];
  lessons: (MemoryRow & { bid: BidRef })[];
  decisions: (MemoryRow & { bid: BidRef })[];
  /** How often each reason came up on their lost / dropped bids, most first. */
  reasonTally: { reason: string; count: number }[];
  empty: boolean;
}

/**
 * What we know from the client's OTHER bids. `feedback` is the whole
 * opportunityFeedback collection (read once, filtered here by bid id — settled
 * rule 2). `excludeId` leaves out the bid being worked on.
 */
export function clientMemory(key: string, opportunities: any[], feedback: any[], excludeId?: string): ClientMemory {
  const bids = key ? opportunities.filter(o => o.id !== excludeId && clientKey(o.client) === key) : [];
  const fbFor = feedbackByBid(feedback);

  const prices: ClientMemory['prices'] = [];
  const objections: ClientMemory['objections'] = [];
  const lessons: ClientMemory['lessons'] = [];
  const decisions: ClientMemory['decisions'] = [];
  const dropped: DroppedBid[] = [];
  const tally = new Map<string, number>();

  for (const o of bids) {
    const ref = bidRef(o);
    const fb = fbFor.get(o.id) || null;
    const rows = bidTimeline(o, fb);
    const p = lastPriceOf(o, fb);
    if (p) prices.push({ ...p, bid: ref });
    for (const r of rows) {
      if (r.kind === 'objection') objections.push({ ...r, bid: ref });
      else if (r.kind === 'lesson') lessons.push({ ...r, bid: ref });
      else if (r.kind === 'decision') decisions.push({ ...r, bid: ref });
    }
    if (o.stage === 'Lost' || o.stage === 'No Bid' || o.stage === 'Cancelled') {
      const outcome = rows.find(r => r.kind === 'outcome');
      const lastDecision = rows.find(r => r.kind === 'decision');
      const reasons = outcome?.reasons || [];
      for (const r of reasons) tally.set(r, (tally.get(r) || 0) + 1);
      dropped.push({
        bid: ref, stage: o.stage,
        date: dayOf(o.decisionDate) || outcome?.date || lastDecision?.date || dayOf(o.updatedAt),
        reasons,
        said: lastDecision?.text, saidWhy: lastDecision?.why,
        competitor: outcome?.competitor || o.awardedTo || undefined,
        gapPercent: outcome?.gapPercent,
      });
    }
  }

  const byDate = <T extends { date: string }>(a: T, b: T) => (b.date || '').localeCompare(a.date || '');
  prices.sort(byDate);
  objections.sort(newestFirst);
  lessons.sort(newestFirst);
  decisions.sort(newestFirst);
  dropped.sort(byDate);
  const reasonTally = [...tally.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return {
    key, bidCount: bids.length,
    lastPrice: prices[0] || null,
    prices, dropped, objections, lessons, decisions, reasonTally,
    empty: !prices.length && !dropped.length && !objections.length && !lessons.length && !decisions.length,
  };
}

/** One feedback record per bid — the oldest wins, as on the Outcome tab. */
export function feedbackByBid(feedback: any[]): Map<string, any> {
  const out = new Map<string, any>();
  const sorted = [...(feedback || [])].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
  for (const f of sorted) if (f?.opportunityId && !out.has(f.opportunityId)) out.set(f.opportunityId, f);
  return out;
}
