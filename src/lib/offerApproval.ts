/**
 * Offer sign-off (queue task D10).
 *
 * An offer may not go out until a manager has approved it. The bid owner asks
 * for sign-off on the bid page; every manager gets a notification; one of them
 * approves it or sends it back with a reason. Only then can the bid move to
 * "Submitted" (or on to "Under Evaluation" / "Won") — and who asked, who
 * decided and when is kept on the bid for good.
 *
 * The approval covers the PRICE AS IT STOOD when it was asked for. If the
 * estimated value or currency changes afterwards the approval goes stale and
 * the offer needs signing again — a manager approved one number, not whatever
 * number the bid ends up carrying.
 *
 * Storage: an `approval` MAP ON THE OPPORTUNITY DOC, changed through a
 * transaction (the checklist / decisions pattern). firestore.rules mirrors the
 * two rules that matter — only a manager may write "approved", and an employee
 * may not move a bid past the gate without a valid approval — so this module
 * and the rules must stay in step (see `passesOfferSignOff` there).
 *
 * Plain shapes, not the Firestore types, so `scripts/harness/offerapproval.mjs`
 * can feed fixtures.
 */

// ── Stages ───────────────────────────────────────────────────────────────────

/** Before the offer goes out. */
export const PRE_SEND_STAGES = ['Identified', 'Prequalification', 'Bid Preparation'];
/** Reaching one of these from a pre-send stage means the offer went out. Lost /
 *  No Bid / Cancelled are left free: dropping a bid needs nobody's sign-off. */
export const GATED_STAGES = ['Submitted', 'Under Evaluation', 'Won'];

export const isPreSend = (stage?: string) => !!stage && PRE_SEND_STAGES.includes(stage);

/** True when moving `from` → `to` is "sending the offer". */
export const crossesGate = (from?: string, to?: string) =>
  isPreSend(from) && !!to && GATED_STAGES.includes(to);

// ── The stored shape ─────────────────────────────────────────────────────────

export type ApprovalStatus = 'requested' | 'approved' | 'returned' | 'withdrawn';
export type ApprovalEventKind = 'requested' | 'approved' | 'returned' | 'withdrawn';

export interface ApprovalEvent {
  kind: ApprovalEventKind;
  byId: string;
  byName: string;
  /** ms since epoch. */
  at: number;
  note?: string;
  /** The price the event was about (the bid's value at that moment). */
  amount?: number | string | null;
  currency?: string;
  /** A manager moved the bid to "sent" with no sign-off on it — the save signed it. */
  onSend?: boolean;
}

export interface OfferApproval {
  status: ApprovalStatus;
  /** The price this approval covers — the bid's `estimatedValue` exactly as stored. */
  amount: number | string | null;
  currency: string;
  requestedById: string;
  requestedByName: string;
  requestedAt: number;
  requestNote?: string;
  decidedById?: string;
  decidedByName?: string;
  decidedAt?: number;
  decisionNote?: string;
  /** Every step, oldest first. Never shortened. */
  log: ApprovalEvent[];
}

export interface Actor { id: string; name: string; role?: string }

export const NOTE_MAX = 1000;

export const isManagerRole = (role?: string) => role === 'Manager' || role === 'Admin';

// ── Price the approval is tied to ────────────────────────────────────────────

/** The bid's price as stored — `undefined` and `''` both read as "no price". */
const normAmount = (v: unknown): number | string | null =>
  v === undefined || v === null || v === '' ? null : (v as number | string);

export const priceOf = (bid: { estimatedValue?: unknown; currency?: string }) => ({
  amount: normAmount(bid.estimatedValue),
  currency: bid.currency || '',
});

/** Same comparison firestore.rules makes: exact stored value and currency. */
export const samePrice = (a: { amount: unknown; currency?: string }, b: { amount: unknown; currency?: string }) =>
  normAmount(a.amount) === normAmount(b.amount) && (a.currency || '') === (b.currency || '');

// ── Where a bid stands ───────────────────────────────────────────────────────

/** none = never asked · stale = approved, but the price has changed since. */
export type ApprovalState = 'none' | 'requested' | 'approved' | 'stale' | 'returned' | 'withdrawn';

export function approvalState(bid: { approval?: OfferApproval | null; estimatedValue?: unknown; currency?: string }): ApprovalState {
  const a = bid.approval;
  if (!a || !a.status) return 'none';
  if (a.status === 'approved') return samePrice(a, priceOf(bid)) ? 'approved' : 'stale';
  return a.status;
}

/** The approval lets the offer go out at the bid's CURRENT price. */
export const isSignedOff = (bid: { approval?: OfferApproval | null; estimatedValue?: unknown; currency?: string }) =>
  approvalState(bid) === 'approved';

// ── Changes (pure: each returns the NEW approval) ────────────────────────────

const clean = (s?: string) => (s || '').trim().slice(0, NOTE_MAX);

const event = (kind: ApprovalEventKind, by: Actor, at: number, note: string, price: { amount: unknown; currency: string }): ApprovalEvent => {
  const e: ApprovalEvent = { kind, byId: by.id, byName: by.name, at, amount: normAmount(price.amount), currency: price.currency };
  if (note) e.note = note;
  return e;
};

/** Ask for sign-off at the bid's current price. Starts a fresh request but keeps the history. */
export function requestApproval(bid: { approval?: OfferApproval | null; estimatedValue?: unknown; currency?: string }, by: Actor, note: string | undefined, now: number): OfferApproval {
  const price = priceOf(bid);
  const n = clean(note);
  const a: OfferApproval = {
    status: 'requested',
    amount: price.amount,
    currency: price.currency,
    requestedById: by.id,
    requestedByName: by.name,
    requestedAt: now,
    log: [...(bid.approval?.log || []), event('requested', by, now, n, price)],
  };
  if (n) a.requestNote = n;
  return a;
}

export type DecideProblem = 'not-manager' | 'nothing-to-decide' | 'reason-needed';

/**
 * A manager approves or sends back. A manager may also approve with no request
 * pending (they are the one who would sign it anyway) — the record then shows
 * them as both asker and approver. Sending back needs a reason, or the owner
 * has nothing to fix.
 */
export function decideProblem(
  bid: { approval?: OfferApproval | null },
  by: Actor, verdict: 'approved' | 'returned', note?: string,
): DecideProblem | null {
  if (!isManagerRole(by.role)) return 'not-manager';
  const pending = bid.approval?.status === 'requested';
  if (verdict === 'returned' && !pending) return 'nothing-to-decide';
  if (verdict === 'returned' && !clean(note)) return 'reason-needed';
  return null;
}

export function decide(
  bid: { approval?: OfferApproval | null; estimatedValue?: unknown; currency?: string },
  by: Actor, verdict: 'approved' | 'returned', note: string | undefined, now: number,
): OfferApproval {
  const problem = decideProblem(bid, by, verdict, note);
  if (problem) throw new Error(problem);
  const price = priceOf(bid);
  const n = clean(note);
  // No open request: the manager signs straight away. They stand as the asker
  // too, but the history gets only the one "approved" line, not a fake request.
  const base: OfferApproval = bid.approval?.status === 'requested'
    ? bid.approval
    : { ...requestApproval(bid, by, undefined, now), log: [...(bid.approval?.log || [])] };
  const a: OfferApproval = {
    ...base,
    status: verdict,
    // The approval covers the price as it stands NOW, which is what the manager is looking at.
    amount: price.amount,
    currency: price.currency,
    decidedById: by.id,
    decidedByName: by.name,
    decidedAt: now,
    log: [...base.log, event(verdict, by, now, n, price)],
  };
  if (n) a.decisionNote = n; else delete a.decisionNote;
  return a;
}

/** The asker (or a manager) takes a pending request back. */
export function canWithdraw(bid: { approval?: OfferApproval | null }, by: Actor) {
  const a = bid.approval;
  return !!a && a.status === 'requested' && (a.requestedById === by.id || isManagerRole(by.role));
}

export function withdraw(bid: { approval?: OfferApproval | null; estimatedValue?: unknown; currency?: string }, by: Actor, now: number): OfferApproval {
  if (!canWithdraw(bid, by)) throw new Error('cannot-withdraw');
  const a = bid.approval as OfferApproval;
  return { ...a, status: 'withdrawn', log: [...a.log, event('withdrawn', by, now, '', priceOf(bid))] };
}

// ── The gate, as a save sees it ──────────────────────────────────────────────

export type GateProblem = 'needs-approval' | 'pending' | 'returned' | 'price-changed';

export type GateResult =
  | { ok: true; approval?: OfferApproval }   // approval set = write this with the save
  | { ok: false; problem: GateProblem };

/**
 * Called by every save that can change a bid's stage (the edit form, the
 * Outcome tab, "Mark as sent"). `next` is the bid AS IT WILL BE SAVED — the
 * price the approval is checked against is the new one.
 *
 * A manager is never stopped: when a manager sends an offer nobody signed, the
 * save records THEM as the approver, so the who/when is still on the bid.
 */
export function checkGate(
  before: { stage?: string; approval?: OfferApproval | null },
  next: { stage?: string; estimatedValue?: unknown; currency?: string },
  by: Actor, now: number,
): GateResult {
  if (!crossesGate(before.stage, next.stage)) return { ok: true };
  const bid = { approval: before.approval, estimatedValue: next.estimatedValue, currency: next.currency };
  const state = approvalState(bid);
  if (state === 'approved') return { ok: true };
  if (isManagerRole(by.role)) {
    const a = decide(bid, by, 'approved', undefined, now);
    a.log[a.log.length - 1] = { ...a.log[a.log.length - 1], onSend: true };
    return { ok: true, approval: a };
  }
  if (state === 'requested') return { ok: false, problem: 'pending' };
  if (state === 'returned') return { ok: false, problem: 'returned' };
  if (state === 'stale') return { ok: false, problem: 'price-changed' };
  return { ok: false, problem: 'needs-approval' };
}

// ── The managers' queue ──────────────────────────────────────────────────────

export interface WaitingOffer {
  id: string;
  serial?: string;
  title: string;
  client?: string;
  ownerName?: string;
  amount: number | string | null;
  currency: string;
  requestedByName: string;
  requestedAt: number;
  note?: string;
  /** Whole days since the request (0 = today). */
  ageDays: number;
  deadline?: string;
}

const DAY = 86400000;
const startOfDay = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

/** Offers waiting for a manager, oldest request first. Closed or already-sent bids never wait. */
export function waitingForSignOff(bids: any[], now: number): WaitingOffer[] {
  return bids
    .filter(b => b && b.id !== '--stats--' && isPreSend(b.stage) && b.approval?.status === 'requested')
    .map(b => ({
      id: b.id,
      serial: b.serialNumber,
      title: b.title || '',
      client: b.client || undefined,
      ownerName: b.ownerName || undefined,
      amount: normAmount(b.approval.amount),
      currency: b.approval.currency || '',
      requestedByName: b.approval.requestedByName || '',
      requestedAt: b.approval.requestedAt || 0,
      note: b.approval.requestNote || undefined,
      ageDays: Math.max(0, Math.round((startOfDay(now) - startOfDay(b.approval.requestedAt || now)) / DAY)),
      deadline: b.submissionDeadline || undefined,
    }))
    .sort((a, b) => a.requestedAt - b.requestedAt);
}

/** The history newest first — what the bid page lists. */
export const historyNewestFirst = (a?: OfferApproval | null) => [...(a?.log || [])].sort((x, y) => y.at - x.at);
