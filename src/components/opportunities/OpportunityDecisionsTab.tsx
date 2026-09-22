import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'firebase/auth';
import { collection, doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { Gavel, Tag, MessageCircleWarning, Trophy, Lightbulb, Pencil, Trash2, History } from 'lucide-react';
import { db } from '../../lib/firebase';
import { requestOpen } from '../../lib/deepLink';
import { useFormat, DATE_MEDIUM } from '../../lib/format';
import { useDisplayLabel } from '../../lib/displayLabel';
import { clientKey, clientFileHash } from '../../lib/clientFile';
import {
  bidTimeline, clientMemory, feedbackByBid, validateDecision, buildDecision, addDecision, updateDecision,
  removeDecision, canChangeDecision, TEXT_MAX, WHY_MAX,
  type BidDecision, type DecisionInput, type DecisionKind, type DecisionProblem, type MemoryRow, type BidRef,
} from '../../lib/decisionMemory';
import { AppUser, Opportunity, CURRENCY_OPTIONS } from '../../types';
import EarlierWithClient from './EarlierWithClient';
import type { AppView } from '../../App';

interface Props {
  opportunity: Opportunity;
  user: User;
  appUser: AppUser;
  onNavigate?: (v: AppView) => void;
}

const rows = (snap: any) => snap.docs.filter((d: any) => d.id !== '--stats--').map((d: any) => ({ id: d.id, ...d.data() }));

/** Today as yyyy-mm-dd, local. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const localDate = (isoDay: string) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const KIND_ICON: Record<MemoryRow['kind'], React.ReactNode> = {
  decision: <Gavel size={15} />,
  price: <Tag size={15} />,
  objection: <MessageCircleWarning size={15} />,
  outcome: <Trophy size={15} />,
  lesson: <Lightbulb size={15} />,
};

/**
 * Decisions tab of a bid (queue D6) — the bid's memory: every decision and why,
 * every price put in front of the client, and what the client objected to,
 * logged as it happens. The Outcome record is shown alongside (read-only), and
 * the side box recalls what the client's EARLIER bids remember.
 *
 * ★ Writes go through a TRANSACTION on the bid's `decisions` array (the
 * checklist pattern): re-read, apply one change, write — so two people logging
 * at once never lose an entry. No new collection, so no rules deploy.
 */
export default function OpportunityDecisionsTab({ opportunity, user, appUser, onNavigate }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const dl = useDisplayLabel();
  const o = opportunity;

  const [bids, setBids] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<any[]>([]);
  const [form, setForm] = useState<{ id: string | null; input: DecisionInput } | null>(null);
  const [problems, setProblems] = useState<DecisionProblem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // The whole bid book + every outcome record: "earlier with this client"
  // needs the client's other bids, and it must not depend on what this
  // person's board happens to be filtered to.
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'opportunities'), s => setBids(rows(s)),
      err => { console.warn('Decisions — opportunities listener:', err.code); setBids([]); });
    const u2 = onSnapshot(collection(db, 'opportunityFeedback'), s => setFeedback(rows(s)),
      err => { console.warn('Decisions — opportunityFeedback listener:', err.code); setFeedback([]); });
    return () => { u1(); u2(); };
  }, []);

  const fbMap = useMemo(() => feedbackByBid(feedback), [feedback]);
  const timeline = useMemo(() => bidTimeline(o, fbMap.get(o.id) || null), [o, fbMap]);
  const key = clientKey(o.client);
  const memory = useMemo(() => clientMemory(key, bids, feedback, o.id), [key, bids, feedback, o.id]);

  const mutate = async (fn: (cur: BidDecision[]) => BidDecision[]) => {
    setBusy(true);
    setError(null);
    try {
      await runTransaction(db, async tx => {
        const ref = doc(db, 'opportunities', o.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('record gone');
        const cur = Array.isArray(snap.data().decisions) ? (snap.data().decisions as BidDecision[]) : [];
        // Not `updatedAt`: a note about the past is not activity on the bid,
        // and bumping it would restart the follow-up clocks that read it.
        tx.update(ref, { decisions: fn(cur) });
      });
      return true;
    } catch (e) {
      console.error('decisions update failed:', e);
      setError(t('Could not save. Please try again.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startNew = (kind: DecisionKind) => {
    setProblems([]);
    setForm({ id: null, input: { kind, date: localToday(), text: '', why: '', amount: '', currency: o.currency || 'EGP' } });
  };
  const startEdit = (d: BidDecision) => {
    setProblems([]);
    setForm({
      id: d.id,
      input: { kind: d.kind, date: d.date, text: d.text, why: d.why || '', amount: d.amount === undefined ? '' : String(d.amount), currency: d.currency || o.currency || 'EGP' },
    });
  };

  const save = async () => {
    if (!form) return;
    const count = form.id ? 0 : (o.decisions || []).length;
    const bad = validateDecision(form.input, count);
    setProblems(bad);
    if (bad.length) return;
    const who = { id: user.uid, name: appUser.displayName || user.displayName || '' };
    const done = form.id
      ? await mutate(cur => updateDecision(cur, form.id!, form.input))
      : await mutate(cur => addDecision(cur, buildDecision(form.input, who)));
    if (done) setForm(null);
  };

  const remove = async (id: string) => {
    setConfirmId(null);
    await mutate(cur => removeDecision(cur, id));
  };

  const openBid = (bid: BidRef) => {
    requestOpen({ type: 'opportunity', id: bid.id, label: bid.title, serial: bid.serial, tab: 'decisions' });
    onNavigate?.('opportunities');
  };

  const kindLabel: Record<MemoryRow['kind'], string> = {
    decision: t('Decision'),
    price: t('Price offered'),
    objection: t('Client objection'),
    outcome: t('Outcome'),
    lesson: t('Lesson learned'),
  };
  const whyLabel: Record<DecisionKind, string> = {
    decision: t('Why'),
    price: t('Notes'),
    objection: t('Our answer'),
  };

  const day = (d?: string) => (d ? fmt.date(localDate(d), DATE_MEDIUM) : '');

  return (
    <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', alignItems: 'start' }} data-decisions="tab">
      {/* This bid */}
      <section className="card" style={{ padding: 16, display: 'grid', gap: 14, minWidth: 0 }} data-decisions="this-bid">
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>{t('Decision memory')}</h3>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
            {t('Write down why we decided something, every price we offered and what the client objected to — so the next person does not have to ask.')}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => startNew('decision')} data-decisions="add-decision"><Gavel size={14} /> {t('Record a decision')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => startNew('price')} data-decisions="add-price"><Tag size={14} /> {t('Record a price offered')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => startNew('objection')} data-decisions="add-objection"><MessageCircleWarning size={14} /> {t('Record a client objection')}</button>
        </div>

        {form && (
          <DecisionForm
            input={form.input}
            editing={!!form.id}
            problems={problems}
            busy={busy}
            onChange={input => setForm(f => (f ? { ...f, input } : f))}
            onSave={save}
            onCancel={() => { setForm(null); setProblems([]); }}
          />
        )}

        {error && <div style={{ padding: '8px 12px', background: '#fee2e2', color: '#991b1b', fontSize: 13, fontWeight: 600 }} data-decisions="error">{error}</div>}

        {timeline.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }} data-decisions="empty">{t('Nothing recorded on this bid yet.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {timeline.map(r => {
              const mine = r.entry && canChangeDecision(r.entry, user.uid, appUser.role);
              return (
                <li key={r.key} data-decisions="row" data-kind={r.kind} data-source={r.source}
                  style={{ padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'grid', gap: 4, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--blue-600)', display: 'flex' }}>{KIND_ICON[r.kind]}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)' }}>{kindLabel[r.kind]}</span>
                    {r.kind === 'outcome' && r.stage && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>· {dl(r.stage)}</span>}
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginInlineStart: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {r.date && <span>{day(r.date)}</span>}
                      {r.by && <span dir="auto">· {r.by}</span>}
                      {r.entry?.editedAt && <span>· {t('edited')}</span>}
                      {r.source === 'outcome' && <span>· {t('from the Outcome tab')}</span>}
                    </span>
                  </div>
                  {r.kind === 'price' && r.amount !== undefined && (
                    <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}><span className="ltr-data" data-decisions="amount">{fmt.money(r.amount, r.currency)}</span></div>
                  )}
                  {r.kind === 'outcome' && (r.reasons || []).length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {r.reasons!.map((x, i) => (
                        <span key={x} style={{ fontSize: 11.5, fontWeight: i === 0 ? 700 : 500, padding: '1px 7px', border: '1px solid var(--border)', background: 'var(--surface)' }}>{dl(x)}</span>
                      ))}
                    </div>
                  )}
                  {r.kind === 'outcome' && (r.competitor || r.winningPrice !== undefined) && (
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      {r.competitor && <>{o.stage === 'Won' ? t('Competitor') : t('Won by')}: <span dir="auto">{r.competitor}</span></>}
                      {r.competitor && r.winningPrice !== undefined && ' · '}
                      {r.winningPrice !== undefined && <>{t('Winning price')}: <span className="ltr-data">{fmt.money(r.winningPrice, o.currency)}</span></>}
                    </div>
                  )}
                  {r.text && <div dir="auto" style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} data-decisions="text">{r.text}</div>}
                  {r.why && r.entry && (
                    <div dir="auto" style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} data-decisions="why">
                      <strong>{whyLabel[r.entry.kind]}:</strong> <bdi>{r.why}</bdi>
                    </div>
                  )}
                  {mine && (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {confirmId === r.entry!.id ? (
                        <>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)', alignSelf: 'center' }}>{t('Remove this entry?')}</span>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmId(null)}>{t('Cancel')}</button>
                          <button type="button" className="btn btn-sm" style={{ background: '#dc2626', color: '#fff' }} disabled={busy} onClick={() => remove(r.entry!.id)} data-decisions="confirm-remove">{t('Remove')}</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(r.entry!)} data-decisions="edit"><Pencil size={13} /> {t('Edit')}</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmId(r.entry!.id)} data-decisions="remove"><Trash2 size={13} /> {t('Remove')}</button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Earlier with this client */}
      <section className="card" style={{ padding: 16, display: 'grid', gap: 12, minWidth: 0 }} data-decisions="earlier">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--blue-600)', display: 'flex' }}><History size={16} /></span>
          {o.client ? t('Earlier with {{client}}', { client: o.client }) : t('Earlier with this client')}
          {o.client && (
            <a href={clientFileHash(o.client)} style={{ marginInlineStart: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--blue-600)', textDecoration: 'none' }}>
              {t('Client file')} <span className="dir-arrow">→</span>
            </a>
          )}
        </h3>
        {key
          ? <EarlierWithClient memory={memory} onOpenBid={openBid} />
          : <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }} data-memory="no-client">{t('This bid has no client yet — add one (Edit opportunity) to see what earlier bids with them remember.')}</p>}
      </section>
    </div>
  );
}

// ─── The form ────────────────────────────────────────────────────────────────

function DecisionForm({ input, editing, problems, busy, onChange, onSave, onCancel }: {
  input: DecisionInput; editing: boolean; problems: DecisionProblem[]; busy: boolean;
  onChange: (i: DecisionInput) => void; onSave: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const set = (k: keyof DecisionInput, v: string) => onChange({ ...input, [k]: v });
  const k = input.kind;

  const title = {
    decision: editing ? t('Edit decision') : t('Record a decision'),
    price: editing ? t('Edit price') : t('Record a price offered'),
    objection: editing ? t('Edit objection') : t('Record a client objection'),
  }[k];
  const textLabel = { decision: t('What was decided'), price: t('What this price was'), objection: t('What the client objected to') }[k];
  const textHint = {
    decision: t('e.g. We will not bid — the scope is mostly civil works'),
    price: t('e.g. Revised offer after the clarification meeting'),
    objection: t('e.g. Price is 20% above their budget'),
  }[k];
  const whyLabel = { decision: t('Why'), price: t('Notes (what it covers, conditions)'), objection: t('Our answer') }[k];
  const whyHint = {
    decision: t('The reason, in a sentence or two — this is what people will look for later.'),
    price: t('e.g. Excludes scaffolding; valid 60 days'),
    objection: t('What we told them, or what we changed'),
  }[k];

  const MESSAGE: Record<DecisionProblem, string> = {
    kind: t('Choose what you are recording.'),
    text: k === 'objection' ? t('Write what the client objected to.') : t('Write what was decided.'),
    amount: t('Enter the price as a number, e.g. 1,250,000'),
    date: t('The date is not valid.'),
    full: t('This bid already holds the most entries one bid can keep.'),
    'too-long': t('That text is too long — keep it shorter.'),
  };

  return (
    <form
      className="card"
      style={{ padding: 14, display: 'grid', gap: 10, borderInlineStart: '3px solid var(--accent)' }}
      data-decisions="form"
      data-kind={k}
      onSubmit={e => { e.preventDefault(); onSave(); }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="input-label">{t('Date')}</span>
          <input className="input" type="date" value={input.date} onChange={e => set('date', e.target.value)} data-decisions="date" />
        </label>
        {k === 'price' && (
          <>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="input-label">{t('Amount')} *</span>
              <input className="input ltr-data" dir="ltr" inputMode="decimal" value={String(input.amount ?? '')} onChange={e => set('amount', e.target.value)} placeholder="1,250,000" data-decisions="amount-input" />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="input-label">{t('Currency')}</span>
              <select className="input" value={input.currency || 'EGP'} onChange={e => set('currency', e.target.value)} data-decisions="currency">
                {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </>
        )}
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="input-label">{textLabel}{k === 'price' ? '' : ' *'}</span>
        <input className="input" maxLength={TEXT_MAX} value={input.text} onChange={e => set('text', e.target.value)} placeholder={textHint} data-decisions="text-input" dir="auto" />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="input-label">{whyLabel}</span>
        <textarea className="input" rows={3} maxLength={WHY_MAX} value={input.why || ''} onChange={e => set('why', e.target.value)} placeholder={whyHint} data-decisions="why-input" dir="auto" style={{ resize: 'vertical', fontFamily: 'inherit' }} />
      </label>
      {problems.length > 0 && (
        <div style={{ padding: '8px 12px', background: '#fee2e2', color: '#991b1b', fontSize: 13, fontWeight: 600 }} data-decisions="problem">
          {problems.map(p => <div key={p}>{MESSAGE[p]}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('Cancel')}</button>
        <button type="submit" className="btn btn-primary" disabled={busy} data-decisions="save">{t('Save')}</button>
      </div>
    </form>
  );
}
