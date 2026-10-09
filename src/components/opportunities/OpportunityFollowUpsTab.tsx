import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { User } from 'firebase/auth';
import {
  AppUser, Opportunity, OpportunityFollowUp, OpportunityStage,
  OPPORTUNITY_STAGE_OPTIONS,
} from '../../types';
import { getUserColor } from '../../utils';
import { useDisplayLabel } from '../../lib/displayLabel';
import { useFormat } from '../../lib/format';
import { Send, CalendarClock, Trash2, Plus, Hourglass, ArrowRightCircle } from 'lucide-react';
import { checkGate } from '../../lib/offerApproval';

interface Props {
  opportunity: Opportunity;
  user: User;
  appUser: AppUser;
  /** Bumped by the page's "Add an update" button — opens the form. */
  composeSignal?: number;
}

// A Firestore Timestamp reaches this file typed as `{ seconds }` only, so the
// millis are handed to the formatter rather than the object — `toDate()` in
// lib/format accepts a Date/millis/`.toDate()` shape, not a bare `{ seconds }`.
const STAMP: Intl.DateTimeFormatOptions = {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
};

export default function OpportunityFollowUpsTab({ opportunity, user, appUser, composeSignal = 0 }: Props) {
  const { t } = useTranslation();
  const dl = useDisplayLabel();
  const f = useFormat();
  const fmt = (ts?: { seconds: number }) => (ts ? f.dateTime(ts.seconds * 1000, STAMP) : t('Just now'));
  const [followUps, setFollowUps] = useState<OpportunityFollowUp[]>([]);
  const [text, setText] = useState('');
  const [stage, setStage] = useState<OpportunityStage>(opportunity.stage || 'Identified');
  const [nextActionDate, setNextActionDate] = useState(opportunity.nextActionDate || '');
  // Queue O2 — both start from what the bid says now, so an update only has to
  // change what actually changed.
  const [waitingFor, setWaitingFor] = useState(opportunity.waitingFor || '');
  const [nextStep, setNextStep] = useState(opportunity.nextStep || '');
  const [composing, setComposing] = useState(composeSignal > 0);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OpportunityFollowUp | null>(null);

  // The stage select is a snapshot of where the bid stands *now*, so it has to
  // follow the opportunity when the record changes underneath us.
  useEffect(() => { setStage(opportunity.stage || 'Identified'); }, [opportunity.stage]);
  useEffect(() => { setNextActionDate(opportunity.nextActionDate || ''); }, [opportunity.nextActionDate]);
  useEffect(() => { setWaitingFor(opportunity.waitingFor || ''); }, [opportunity.waitingFor]);
  useEffect(() => { setNextStep(opportunity.nextStep || ''); }, [opportunity.nextStep]);
  useEffect(() => { if (composeSignal > 0) setComposing(true); }, [composeSignal]);

  useEffect(() => {
    const q = query(collection(db, 'opportunityFollowUps'), where('opportunityId', '==', opportunity.id));
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as OpportunityFollowUp));
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setFollowUps(rows);
    }, err => {
      console.error('opportunityFollowUps listener:', err);
      setError(t('Failed to load follow-ups.'));
    });
    return () => unsub();
  }, [opportunity.id]);

  const post = async () => {
    if (!text.trim()) return;
    // Queue D10 — moving the stage here is the same "offer went out" as on the
    // edit form, so it passes the same sign-off gate (checked BEFORE the
    // follow-up is written, so a refused stage leaves nothing half-saved).
    const gate = checkGate(opportunity, { ...opportunity, stage },
      { id: appUser.id, name: appUser.displayName || appUser.email || '—', role: appUser.role }, Date.now());
    if ('problem' in gate) {
      setError(t('This offer needs a manager’s sign-off before it can be marked as sent. Save it at its current stage and use “Ask for sign-off” on the bid page.'));
      return;
    }
    setPosting(true);
    setError(null);
    try {
      await addDoc(collection(db, 'opportunityFollowUps'), {
        opportunityId: opportunity.id,
        text: text.trim(),
        stage,
        nextActionDate,
        waitingFor: waitingFor.trim(),
        nextStep: nextStep.trim(),
        authorId: user.uid,
        authorName: appUser.displayName || 'Unknown',
        authorColor: appUser.userColor || getUserColor(appUser.displayName || user.uid),
        createdAt: serverTimestamp(),
      });
      // Mirror the latest entry onto the opportunity so the list card and the
      // analytics view never have to read the follow-up collection.
      await updateDoc(doc(db, 'opportunities', opportunity.id), {
        lastFollowUpText: text.trim(),
        lastFollowUpAt: serverTimestamp(),
        nextActionDate,
        waitingFor: waitingFor.trim(),
        nextStep: nextStep.trim(),
        stage,
        ...('approval' in gate && gate.approval ? { approval: gate.approval } : {}),
        updatedAt: serverTimestamp(),
      });
      setText('');
      setComposing(false);
    } catch (e) {
      console.error('post follow-up failed:', e);
      setError(t('Failed to post the follow-up. Please try again.'));
    } finally {
      setPosting(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'opportunityFollowUps', deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      console.error('delete follow-up failed:', e);
      setError(t('Failed to delete. You can only delete your own follow-ups.'));
      setDeleteTarget(null);
    }
  };

  const canRemove = (f: OpportunityFollowUp) =>
    f.authorId === user.uid || appUser.role === 'Admin' || appUser.role === 'Manager';

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {error && (
        <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#991b1b', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* Composer — closed until asked for, so the history sits right under
          the page's "At a glance" card (queue O2). */}
      {!composing ? (
        <div>
          <button className="btn btn-primary" data-followup-open onClick={() => setComposing(true)}>
            <Plus className="w-4 h-4" /> {t('Add an update')}
          </button>
        </div>
      ) : (
      <div className="card" data-followup-form style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('Stage now')}</span>
            <select value={stage} onChange={e => setStage(e.target.value as OpportunityStage)} style={inputStyle}>
              {OPPORTUNITY_STAGE_OPTIONS.map(s => <option key={s} value={s}>{dl(s)}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('Next action date')}</span>
            <input type="date" value={nextActionDate} onChange={e => setNextActionDate(e.target.value)} style={inputStyle} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 10 }}>
          <label style={{ display: 'grid', gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('Waiting for')}</span>
            <input data-followup-waiting dir="auto" value={waitingFor} onChange={e => setWaitingFor(e.target.value)}
              placeholder={t('e.g. the client’s reply on the price')} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('Next step')}</span>
            <input data-followup-next dir="auto" value={nextStep} onChange={e => setNextStep(e.target.value)}
              placeholder={t('e.g. send the revised offer')} style={inputStyle} />
          </label>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={t('What happened? e.g. clarification issued, site visit booked, client called…')}
          rows={3}
          style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {t('Posting also updates the bid’s stage, what it is waiting for and its next step.')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setComposing(false)}>{t('Cancel')}</button>
            <button className="btn btn-primary" disabled={posting || !text.trim()} onClick={post}>
              <Send className="w-4 h-4" /> {posting ? t('Posting…') : t('Post follow-up')}
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Timeline */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px' }}>
          {t('History')} {followUps.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>({followUps.length})</span>}
        </h3>
        {followUps.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>{t('No follow-ups yet.')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', borderInlineStart: '2px solid var(--border)', paddingInlineStart: 18, marginInlineStart: 6 }}>
            {followUps.map(fu => (
              <div key={fu.id} style={{ position: 'relative', paddingBottom: 18 }}>
                <span style={{ position: 'absolute', insetInlineStart: -25, top: 4, width: 10, height: 10, borderRadius: '50%', background: fu.authorColor || 'var(--accent)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                  {fu.stage && <span className="badge badge-inprogress">{dl(fu.stage)}</span>}
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{fu.authorName}</span>
                  <span className={f.bidi(STAMP)} style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt(fu.createdAt)}</span>
                  {fu.nextActionDate && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <CalendarClock className="w-3 h-3" /> {t('next {{date}}', { date: f.date(fu.nextActionDate) })}
                    </span>
                  )}
                  {canRemove(fu) && (
                    <button className="btn btn-ghost btn-icon btn-sm" title={t('Delete follow-up')} onClick={() => setDeleteTarget(fu)}>
                      <Trash2 className="w-3.5 h-3.5" style={{ color: '#dc2626' }} />
                    </button>
                  )}
                </div>
                <p dir="auto" style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{fu.text}</p>
                {(fu.waitingFor || fu.nextStep) && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                    {fu.waitingFor && (
                      <span data-history-waiting style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Hourglass className="w-3 h-3" /> {t('Waiting for')}: <span dir="auto">{fu.waitingFor}</span>
                      </span>
                    )}
                    {fu.nextStep && (
                      <span data-history-next style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ArrowRightCircle className="w-3 h-3" /> {t('Next step')}: <span dir="auto">{fu.nextStep}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 420, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{t('Delete follow-up?')}</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 20px' }}>
              {t("This entry is removed from the timeline. The opportunity's own “latest follow-up” summary is not rewritten.")}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={remove}>{t('Delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '9px 11px', background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit',
};
