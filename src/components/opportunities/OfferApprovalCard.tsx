import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { ShieldCheck, ShieldAlert, Clock, Send, Undo2, History, CheckCircle2, CornerUpLeft } from 'lucide-react';
import { db } from '../../lib/firebase';
import { createNotification } from '../../lib/pushNotification';
import { useFormat, DATETIME_SHORT } from '../../lib/format';
import {
  approvalState, isPreSend, requestApproval, decide, decideProblem, withdraw, canWithdraw, checkGate,
  historyNewestFirst, isManagerRole, priceOf, NOTE_MAX,
  type OfferApproval, type Actor, type ApprovalState,
} from '../../lib/offerApproval';
import { AppUser, Opportunity } from '../../types';
import { fullMoney } from './opportunityUi';

interface Props {
  opportunity: Opportunity;
  appUser: AppUser;
  projectUsers: AppUser[];
}

/** Money sits inside translated sentences: isolate it (LRI … PDI) so
 *  "1,200,000 EGP" never flips to "EGP 1,200,000" in an Arabic line. */
const iso = (s: string) => `\u2066${s}\u2069`;
/** A date follows its own words (an Arabic month name reads right-to-left): first-strong isolate. */
const fsi = (s: string) => `\u2068${s}\u2069`;

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const TONE: Record<ApprovalState, { color: string; bg: string }> = {
  none: { color: 'var(--text-secondary)', bg: 'var(--surface)' },
  requested: { color: '#b45309', bg: 'rgba(245,158,11,0.08)' },
  approved: { color: '#15803d', bg: 'rgba(22,163,74,0.08)' },
  stale: { color: '#b45309', bg: 'rgba(245,158,11,0.08)' },
  returned: { color: '#b91c1c', bg: 'rgba(220,38,38,0.07)' },
  withdrawn: { color: 'var(--text-secondary)', bg: 'var(--surface)' },
};

/**
 * Offer sign-off on a bid (queue D10). Shown while the offer has not gone out,
 * and afterwards as a one-line record of who approved it. A bid that went out
 * before this feature existed (sent, no approval) shows nothing.
 *
 * ★ Writes go through a TRANSACTION on the bid's `approval` map, re-reading it
 * first — a manager approving while the owner withdraws must not both "win".
 * `updatedAt` is not bumped (same as D6): a sign-off is not a change to the bid.
 */
export default function OfferApprovalCard({ opportunity, appUser, projectUsers }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const o = opportunity;
  const me: Actor = { id: appUser.id, name: appUser.displayName || appUser.email || '—', role: appUser.role };
  const manager = isManagerRole(appUser.role);
  const state = approvalState(o);
  const a = o.approval;
  const preSend = isPreSend(o.stage);

  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // After the offer went out, only a bid that WAS signed keeps the card.
  if (!preSend && !(a && a.status === 'approved')) return null;

  const price = iso(fullMoney(priceOf(o).amount ?? undefined, o.currency));
  const approvedPrice = iso(a ? fullMoney(a.amount ?? undefined, a.currency) : '—');
  const when = (ms?: number) => fsi(ms ? fmt.dateTime(ms, DATETIME_SHORT) : '—');

  const notify = async (to: string[], type: 'opportunity_approval_requested' | 'opportunity_approval_decided', title: string, message: string) => {
    let failed = 0;
    for (const id of to) {
      if (id === appUser.id) continue;
      try {
        await createNotification({
          type, title, message, forUserId: id, read: false, relatedId: o.id, createdAt: serverTimestamp(),
        }, projectUsers);
      } catch (e) {
        console.warn('Sign-off — notification failed:', e);
        failed++;
      }
    }
    return failed;
  };

  /** Re-read the bid, apply one change, write. Returns the approval written, or null on failure. */
  const write = async (fn: (cur: Opportunity) => { approval: OfferApproval; extra?: Record<string, unknown> }) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      let written: OfferApproval | null = null;
      await runTransaction(db, async tx => {
        const ref = doc(db, 'opportunities', o.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('record gone');
        const cur = { id: o.id, ...snap.data() } as Opportunity;
        const { approval, extra } = fn(cur);
        written = approval;
        tx.update(ref, { approval, ...(extra || {}) });
      });
      return written as OfferApproval | null;
    } catch (e: any) {
      console.error('sign-off update failed:', e);
      setError(e?.message === 'changed'
        ? t('Someone else changed this sign-off a moment ago. Look again and retry.')
        : t('Could not save. Please try again.'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const label = [o.serialNumber, o.title].filter(Boolean).join(' ');

  const ask = async () => {
    const r = await write(cur => {
      if (approvalState(cur) === 'requested' || approvalState(cur) === 'approved') throw new Error('changed');
      return { approval: requestApproval(cur, me, note, Date.now()) };
    });
    if (!r) return;
    setNote('');
    const managers = projectUsers.filter(u => u.status === 'Approved' && isManagerRole(u.role)).map(u => u.id);
    const failed = await notify(managers, 'opportunity_approval_requested',
      `Offer waiting for your sign-off: ${label}`,
      `${me.name} asks you to approve the offer at ${fullMoney(r.amount ?? undefined, r.currency)} before it is sent.${r.requestNote ? ` Note: ${r.requestNote}` : ''}`);
    setDone(failed ? t('Asked — but some managers could not be notified. Tell them directly.') : t('Asked. Every manager has a notification.'));
  };

  const verdict = async (v: 'approved' | 'returned') => {
    const problem = decideProblem(o, me, v, note);
    if (problem === 'reason-needed') { setError(t('Write why it is sent back, so the owner knows what to fix.')); return; }
    if (problem) return;
    const r = await write(cur => {
      if (v === 'returned' && cur.approval?.status !== 'requested') throw new Error('changed');
      return { approval: decide(cur, me, v, note, Date.now()) };
    });
    if (!r) return;
    setNote('');
    const failed = r.requestedById !== me.id
      ? await notify([r.requestedById], 'opportunity_approval_decided',
          v === 'approved' ? `Offer approved: ${label}` : `Offer sent back: ${label}`,
          v === 'approved'
            ? `${me.name} approved the offer at ${fullMoney(r.amount ?? undefined, r.currency)}. You can send it now.${r.decisionNote ? ` Note: ${r.decisionNote}` : ''}`
            : `${me.name} sent the offer back: ${r.decisionNote}`)
      : 0;
    setDone(failed ? t('Saved — but the owner could not be notified. Tell them directly.')
      : v === 'approved' ? t('Approved. The offer can be sent now.') : t('Sent back. The owner has a notification.'));
  };

  const takeBack = async () => {
    const r = await write(cur => {
      if (!canWithdraw(cur, me)) throw new Error('changed');
      return { approval: withdraw(cur, me, Date.now()) };
    });
    if (r) setDone(t('Request taken back.'));
  };

  /** Approved → the offer goes out: stage Submitted, submitted today unless a date is there. */
  const markSent = async () => {
    const r = await write(cur => {
      const gate = checkGate(cur, { ...cur, stage: 'Submitted' }, me, Date.now());
      if ('problem' in gate) throw new Error('changed');
      return {
        approval: ('approval' in gate && gate.approval) || (cur.approval as OfferApproval),
        extra: { stage: 'Submitted', submittedDate: cur.submittedDate || localToday(), updatedAt: serverTimestamp() },
      };
    });
    if (r) setDone(t('Marked as sent.'));
  };

  const tone = TONE[state];
  const Icon = state === 'approved' ? ShieldCheck : state === 'returned' || state === 'stale' ? ShieldAlert : state === 'requested' ? Clock : ShieldCheck;

  // ── After the offer went out: one line of record ──────────────────────────
  if (!preSend && a) {
    return (
      <div className="card" data-approval="record" style={{ padding: '10px 14px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)' }}>
        <ShieldCheck className="w-4 h-4" style={{ color: '#15803d', flexShrink: 0 }} />
        <span>
          {t('Offer approved by {{name}} on {{when}} at {{price}}.', { name: a.decidedByName || '—', when: when(a.decidedAt), price: approvedPrice })}
        </span>
        {a.log.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" data-approval="history-toggle" onClick={() => setShowHistory(s => !s)}>
            <History className="w-3.5 h-3.5" /> {t('History ({{count}})', { count: a.log.length })}
          </button>
        )}
        {showHistory && <HistoryList approval={a} when={when} />}
      </div>
    );
  }

  // ── Before the offer goes out ─────────────────────────────────────────────
  const heading = {
    none: t('Manager sign-off needed before sending'),
    requested: t('Waiting for a manager’s sign-off'),
    approved: t('Approved — ready to send'),
    stale: t('The price changed after it was approved'),
    returned: t('Sent back by a manager'),
    withdrawn: t('Sign-off request taken back'),
  }[state];

  const canAsk = state === 'none' || state === 'stale' || state === 'returned' || state === 'withdrawn';
  const canDecide = manager && state === 'requested';
  const canApproveDirect = manager && canAsk;
  const noteBox = canAsk || canDecide;

  return (
    <div className="card" data-approval="card" data-state={state} style={{ padding: 16, marginBottom: 18, background: tone.bg, borderInlineStart: `3px solid ${tone.color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon className="w-5 h-5" style={{ color: tone.color, flexShrink: 0 }} />
        <h3 data-approval="heading" style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{heading}</h3>
        {a && a.log.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" data-approval="history-toggle" style={{ marginInlineStart: 'auto' }} onClick={() => setShowHistory(s => !s)}>
            <History className="w-3.5 h-3.5" /> {t('History ({{count}})', { count: a.log.length })}
          </button>
        )}
      </div>

      <div data-approval="status" style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.55 }}>
        {state === 'none' && <p style={{ margin: 0 }}>{t('A manager must approve this offer before it is marked as sent. The approval covers the price as it stands: {{price}}.', { price })}</p>}
        {state === 'withdrawn' && <p style={{ margin: 0 }}>{t('Ask again when the offer is ready. Price now: {{price}}.', { price })}</p>}
        {state === 'requested' && a && (
          <>
            <p style={{ margin: 0 }}>
              {t('{{name}} asked on {{when}}. Price to approve: {{price}}.', { name: a.requestedByName, when: when(a.requestedAt), price: approvedPrice })}
            </p>
            {a.requestNote && <p data-approval="request-note" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>“<bdi>{a.requestNote}</bdi>”</p>}
            {!manager && <p style={{ margin: '4px 0 0' }}>{t('Every manager has been notified. The offer cannot be marked as sent until one of them approves it.')}</p>}
          </>
        )}
        {(state === 'approved' || state === 'stale' || state === 'returned') && a && (
          <p style={{ margin: 0 }}>
            {state === 'returned'
              ? t('{{name}} sent it back on {{when}}.', { name: a.decidedByName || '—', when: when(a.decidedAt) })
              : t('{{name}} approved it on {{when}} at {{price}}.', { name: a.decidedByName || '—', when: when(a.decidedAt), price: approvedPrice })}
          </p>
        )}
        {state === 'stale' && <p data-approval="stale" style={{ margin: '4px 0 0', fontWeight: 700, color: tone.color }}>{t('The price is now {{price}} — ask for sign-off again before sending.', { price })}</p>}
        {(state === 'approved' || state === 'returned') && a?.decisionNote && (
          <p data-approval="decision-note" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontWeight: state === 'returned' ? 700 : 400, color: state === 'returned' ? tone.color : undefined }}>“<bdi>{a.decisionNote}</bdi>”</p>
        )}
      </div>

      {noteBox && (
        <textarea
          data-approval="note"
          value={note}
          maxLength={NOTE_MAX}
          onChange={e => setNote(e.target.value)}
          rows={2}
          placeholder={canDecide ? t('Note for the owner (needed when sending it back)') : t('Note for the manager (optional) — what changed, what to look at')}
          style={{ width: '100%', marginTop: 10, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical' }}
        />
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {canAsk && !manager && (
          <button type="button" className="btn btn-primary btn-sm" data-approval="ask" disabled={busy} onClick={ask}>
            <Send className="w-3.5 h-3.5" /> {state === 'none' ? t('Ask for sign-off') : t('Ask for sign-off again')}
          </button>
        )}
        {canApproveDirect && (
          <button type="button" className="btn btn-primary btn-sm" data-approval="approve" disabled={busy} onClick={() => verdict('approved')}>
            <CheckCircle2 className="w-3.5 h-3.5" /> {t('Approve this offer')}
          </button>
        )}
        {canDecide && (
          <>
            <button type="button" className="btn btn-primary btn-sm" data-approval="approve" disabled={busy} onClick={() => verdict('approved')}>
              <CheckCircle2 className="w-3.5 h-3.5" /> {t('Approve')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" data-approval="return" disabled={busy} onClick={() => verdict('returned')}>
              <CornerUpLeft className="w-3.5 h-3.5" /> {t('Send back')}
            </button>
          </>
        )}
        {state === 'requested' && canWithdraw(o, me) && (
          <button type="button" className="btn btn-ghost btn-sm" data-approval="withdraw" disabled={busy} onClick={takeBack}>
            <Undo2 className="w-3.5 h-3.5" /> {t('Take the request back')}
          </button>
        )}
        {state === 'approved' && (
          <button type="button" className="btn btn-primary btn-sm" data-approval="mark-sent" disabled={busy} onClick={markSent}>
            <Send className="w-3.5 h-3.5" /> {t('Mark as sent')}
          </button>
        )}
      </div>

      {error && <p role="alert" data-approval="error" style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 700, color: '#b91c1c' }}>{error}</p>}
      {done && <p role="status" data-approval="done" style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 700, color: '#15803d' }}>{done}</p>}
      {showHistory && a && <HistoryList approval={a} when={when} />}
    </div>
  );
}

function HistoryList({ approval, when }: { approval: OfferApproval; when: (ms?: number) => string }) {
  const { t } = useTranslation();
  const verb = (k: string, onSend?: boolean) => ({
    requested: t('asked for sign-off'),
    approved: onSend ? t('approved it when marking it as sent') : t('approved'),
    returned: t('sent it back'),
    withdrawn: t('took the request back'),
  } as Record<string, string>)[k] || k;
  return (
    <ol data-approval="history" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, width: '100%', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
      {historyNewestFirst(approval).map((e, i) => (
        <li key={i} data-approval="history-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>{when(e.at)}</span>{' · '}
          <strong><bdi>{e.byName}</bdi></strong> {verb(e.kind, e.onSend)}
          {e.amount !== undefined && e.kind !== 'withdrawn' && <> · {iso(fullMoney(e.amount ?? undefined, e.currency))}</>}
          {e.note && <> · “<bdi>{e.note}</bdi>”</>}
        </li>
      ))}
    </ol>
  );
}
