import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { User } from 'firebase/auth';
import {
  AppUser, Opportunity, OpportunityFeedback, OpportunityStage,
  CLOSED_OPPORTUNITY_STAGES, OPPORTUNITY_REASON_OPTIONS, isOpportunityOpen,
} from '../../types';
import { STAGE_COLORS, fullMoney, toNumber } from './opportunityUi';
import { Trophy, Save, Trash2, Edit2, X, AlertTriangle, Percent } from 'lucide-react';

interface Props {
  opportunity: Opportunity;
  user: User;
  appUser: AppUser;
}

type Outcome = OpportunityFeedback['outcome'];

const OUTCOMES = CLOSED_OPPORTUNITY_STAGES as Outcome[];

const today = () => new Date().toISOString().slice(0, 10);

const fmt = (ts?: { seconds: number }) =>
  ts ? new Date(ts.seconds * 1000).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—';

// (ours − winner) / winner × 100. Only meaningful when both prices are known and
// the winning price is not zero — otherwise the gap is left unset rather than
// stored as a fake 0, so the analytics view can ignore it honestly.
const priceGap = (ours: string, winning: string): number | null => {
  if (ours.trim() === '' || winning.trim() === '') return null;
  const o = toNumber(ours);
  const w = toNumber(winning);
  if (!isFinite(o) || !isFinite(w) || w === 0) return null;
  return Math.round(((o - w) / w) * 1000) / 10;
};

export default function OpportunityOutcomeTab({ opportunity, user, appUser }: Props) {
  const [record, setRecord] = useState<OpportunityFeedback | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Form state
  const [outcome, setOutcome] = useState<Outcome>(
    isOpportunityOpen(opportunity.stage) ? 'Lost' : (opportunity.stage as Outcome),
  );
  const [reasons, setReasons] = useState<string[]>([]);
  const [primaryReason, setPrimaryReason] = useState('');
  const [competitorName, setCompetitorName] = useState('');
  const [ourPrice, setOurPrice] = useState('');
  const [winningPrice, setWinningPrice] = useState('');
  const [decisionDate, setDecisionDate] = useState(opportunity.decisionDate || '');
  const [clientFeedback, setClientFeedback] = useState('');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'opportunityFeedback'), where('opportunityId', '==', opportunity.id));
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as OpportunityFeedback));
      // One closing record per opportunity; the oldest wins if a race ever
      // produced two, so the id the form edits stays stable.
      rows.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
      setRecord(rows[0] || null);
      setLoaded(true);
    }, err => {
      console.error('opportunityFeedback listener:', err);
      setError('Failed to load the outcome record.');
      setLoaded(true);
    });
    return () => unsub();
  }, [opportunity.id]);

  // Load the saved record into the form whenever it arrives or changes, unless
  // the user is mid-edit (a live snapshot must not wipe what they are typing).
  useEffect(() => {
    if (!record || editing) return;
    setOutcome(record.outcome);
    setReasons(record.reasons || []);
    setPrimaryReason(record.primaryReason || '');
    setCompetitorName(record.competitorName || '');
    setOurPrice(record.ourPrice === undefined || record.ourPrice === null ? '' : String(record.ourPrice));
    setWinningPrice(record.winningPrice === undefined || record.winningPrice === null ? '' : String(record.winningPrice));
    setClientFeedback(record.clientFeedback || '');
    setLessonsLearned(record.lessonsLearned || '');
    setNotes(record.notes || '');
  }, [record, editing]);

  useEffect(() => { setDecisionDate(opportunity.decisionDate || ''); }, [opportunity.decisionDate]);

  // Seed the form's outcome from the opportunity while it is still open, so a
  // stage set elsewhere (edit modal, follow-up) is what the form proposes.
  useEffect(() => {
    if (record) return;
    if (!isOpportunityOpen(opportunity.stage)) setOutcome(opportunity.stage as Outcome);
  }, [opportunity.stage, record]);

  const gap = useMemo(() => priceGap(ourPrice, winningPrice), [ourPrice, winningPrice]);

  const canEdit = !record || record.authorId === user.uid || appUser.role === 'Admin' || appUser.role === 'Manager';

  const toggleReason = (r: string) => {
    setReasons(prev => {
      const next = prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r];
      // The primary reason must stay one of the selected ones.
      setPrimaryReason(p => (p && next.includes(p) ? p : (next[0] || '')));
      return next;
    });
  };

  const save = async () => {
    if (reasons.length === 0) {
      setError('Pick at least one reason — the win/loss analysis is built from these.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      opportunityId: opportunity.id,
      outcome,
      reasons,
      primaryReason: primaryReason || reasons[0],
      competitorName: competitorName.trim(),
      ourPrice: ourPrice.trim() === '' ? null : Number(toNumber(ourPrice)),
      winningPrice: winningPrice.trim() === '' ? null : Number(toNumber(winningPrice)),
      priceGapPercent: gap,
      clientFeedback: clientFeedback.trim(),
      lessonsLearned: lessonsLearned.trim(),
      notes: notes.trim(),
      updatedAt: serverTimestamp(),
    };
    try {
      if (record) {
        await updateDoc(doc(db, 'opportunityFeedback', record.id), payload);
      } else {
        await addDoc(collection(db, 'opportunityFeedback'), {
          ...payload,
          authorId: user.uid,
          authorName: appUser.displayName || 'Unknown',
          createdAt: serverTimestamp(),
        });
      }
      // Closing the record is what closes the bid: the outcome becomes the
      // stage, and the competitor / winning price fill the opportunity's own
      // outcome fields so the list card and analytics never read this
      // collection.
      await updateDoc(doc(db, 'opportunities', opportunity.id), {
        stage: outcome as OpportunityStage,
        decisionDate: decisionDate || today(),
        awardedTo: competitorName.trim(),
        awardedValue: winningPrice.trim() === '' ? null : Number(toNumber(winningPrice)),
        updatedAt: serverTimestamp(),
      });
      setEditing(false);
    } catch (e) {
      console.error('save opportunity feedback failed:', e);
      setError('Failed to save the outcome. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Deleting the feedback deliberately leaves the opportunity closed — the
  // stage is a fact of the tender, the feedback is our analysis of it.
  const remove = async () => {
    if (!record) return;
    try {
      await deleteDoc(doc(db, 'opportunityFeedback', record.id));
      setConfirmDelete(false);
      setEditing(false);
    } catch (e) {
      console.error('delete opportunity feedback failed:', e);
      setError('Failed to delete the outcome record.');
      setConfirmDelete(false);
    }
  };

  const outcomeColor = STAGE_COLORS[outcome] || 'var(--border)';
  const showForm = editing || (!record && loaded);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {error && (
        <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#991b1b', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* Header / current standing */}
      <div className="card" style={{ padding: 22, borderInlineStart: `3px solid ${record ? STAGE_COLORS[record.outcome] : outcomeColor}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <Trophy className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            Outcome &amp; feedback
          </span>
          {record && (
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#fff', background: STAGE_COLORS[record.outcome], padding: '3px 9px' }}>
              {record.outcome}
            </span>
          )}
          {record && canEdit && !editing && (
            <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" title="Delete outcome record" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="w-3.5 h-3.5" style={{ color: '#dc2626' }} />
              </button>
            </span>
          )}
        </div>

        {record ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Recorded by {record.authorName} · {fmt(record.createdAt)}
            {record.updatedAt && record.updatedAt.seconds !== record.createdAt?.seconds && ` · edited ${fmt(record.updatedAt)}`}
          </p>
        ) : isOpportunityOpen(opportunity.stage) ? (
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
            This bid is still open. Closing it here records <strong>why</strong> it went the way it did —
            saving sets the opportunity's stage, decision date and competitor.
          </p>
        ) : (
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: 7, lineHeight: 1.5 }}>
            <AlertTriangle className="w-4 h-4" style={{ color: '#f59e0b', flexShrink: 0 }} />
            Closed as <strong>{opportunity.stage}</strong> with no reasons captured — it counts in the win rate but not in the loss analysis.
          </p>
        )}
      </div>

      {/* Saved record */}
      {record && !editing && (
        <>
          <div className="card" style={{ padding: 20 }}>
            <SectionTitle>Reasons</SectionTitle>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(record.reasons || []).map(r => {
                const isPrimary = r === record.primaryReason;
                return (
                  <span
                    key={r}
                    style={{
                      fontSize: 12.5, fontWeight: 700, padding: '5px 11px',
                      background: isPrimary ? STAGE_COLORS[record.outcome] : 'var(--surface-2)',
                      color: isPrimary ? '#fff' : 'var(--text-secondary)',
                      border: `1px solid ${isPrimary ? STAGE_COLORS[record.outcome] : 'var(--border)'}`,
                    }}
                  >
                    {r}{isPrimary ? ' · primary' : ''}
                  </span>
                );
              })}
              {(record.reasons || []).length === 0 && (
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No reasons recorded.</span>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <SectionTitle>Competition &amp; price</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              <Row label={record.outcome === 'Won' ? 'Closest competitor' : 'Awarded to'} value={record.competitorName} />
              <Row label="Our price" value={record.ourPrice === undefined || record.ourPrice === null || record.ourPrice === '' ? undefined : fullMoney(record.ourPrice, opportunity.currency)} />
              <Row label={record.outcome === 'Won' ? 'Next-best price' : 'Winning price'} value={record.winningPrice === undefined || record.winningPrice === null || record.winningPrice === '' ? undefined : fullMoney(record.winningPrice, opportunity.currency)} />
              <div>
                <div style={labelCapsStyle}>Price gap</div>
                <div style={{
                  fontSize: 14, marginTop: 2, fontWeight: record.priceGapPercent === undefined || record.priceGapPercent === null ? 400 : 800,
                  color: record.priceGapPercent === undefined || record.priceGapPercent === null ? 'var(--text-primary)'
                    : record.priceGapPercent > 0 ? '#dc2626' : '#16a34a',
                }}>
                  {record.priceGapPercent === undefined || record.priceGapPercent === null
                    ? '—'
                    : `${record.priceGapPercent > 0 ? '+' : ''}${record.priceGapPercent}%`}
                </div>
              </div>
            </div>
          </div>

          {(record.clientFeedback || record.lessonsLearned || record.notes) && (
            <div className="card" style={{ padding: 20, display: 'grid', gap: 16 }}>
              {record.clientFeedback && <Para title="What the client told us" text={record.clientFeedback} />}
              {record.lessonsLearned && <Para title="Lessons learned" text={record.lessonsLearned} />}
              {record.notes && <Para title="Notes" text={record.notes} />}
            </div>
          )}
        </>
      )}

      {/* Form */}
      {showForm && (
        <div className="card" style={{ padding: 20, display: 'grid', gap: 18 }}>
          <div>
            <SectionTitle>Outcome</SectionTitle>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {OUTCOMES.map(o => (
                <button
                  key={o}
                  onClick={() => setOutcome(o)}
                  style={{
                    fontSize: 13, fontWeight: 800, padding: '8px 16px', cursor: 'pointer', fontFamily: 'inherit',
                    background: outcome === o ? STAGE_COLORS[o] : 'var(--surface)',
                    color: outcome === o ? '#fff' : 'var(--text-secondary)',
                    border: `1px solid ${outcome === o ? STAGE_COLORS[o] : 'var(--border)'}`,
                  }}
                >
                  {o}
                </button>
              ))}
              <label style={{ display: 'grid', gap: 4, marginInlineStart: 'auto' }}>
                <span style={labelStyle}>Decision date</span>
                <input type="date" value={decisionDate} onChange={e => setDecisionDate(e.target.value)} style={inputStyle} />
              </label>
            </div>
          </div>

          <div>
            <SectionTitle>
              {outcome === 'Won' ? 'Why we won' : outcome === 'Lost' ? 'Why we lost' : 'Why it closed'} — pick all that apply
            </SectionTitle>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {OPPORTUNITY_REASON_OPTIONS.map(r => {
                const on = reasons.includes(r);
                return (
                  <button
                    key={r}
                    onClick={() => toggleReason(r)}
                    style={{
                      fontSize: 12.5, fontWeight: 700, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit',
                      background: on ? 'var(--accent)' : 'var(--surface)',
                      color: on ? '#fff' : 'var(--text-secondary)',
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                    }}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
            {reasons.length > 0 && (
              <label style={{ display: 'grid', gap: 4, marginTop: 14, maxWidth: 320 }}>
                <span style={labelStyle}>Primary reason</span>
                <select value={primaryReason} onChange={e => setPrimaryReason(e.target.value)} style={inputStyle}>
                  {reasons.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            )}
          </div>

          <div>
            <SectionTitle>Competition &amp; price</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={labelStyle}>{outcome === 'Won' ? 'Closest competitor' : 'Awarded to (competitor)'}</span>
                <input value={competitorName} onChange={e => setCompetitorName(e.target.value)} style={inputStyle} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={labelStyle}>Our price {opportunity.currency ? `(${opportunity.currency})` : ''}</span>
                <input type="number" min="0" value={ourPrice} onChange={e => setOurPrice(e.target.value)} style={inputStyle} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={labelStyle}>{outcome === 'Won' ? 'Next-best price' : 'Winning price'} {opportunity.currency ? `(${opportunity.currency})` : ''}</span>
                <input type="number" min="0" value={winningPrice} onChange={e => setWinningPrice(e.target.value)} style={inputStyle} />
              </label>
              <div>
                <span style={labelStyle}>Price gap</span>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5, marginTop: 6,
                  fontSize: 18, fontWeight: 800,
                  color: gap === null ? 'var(--text-muted)' : gap > 0 ? '#dc2626' : '#16a34a',
                }}>
                  <Percent className="w-4 h-4" />
                  {gap === null ? '—' : `${gap > 0 ? '+' : ''}${gap}`}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  Calculated — how far our price sat above (+) or below (−) the winner's.
                </div>
              </div>
            </div>
          </div>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>What the client told us</span>
            <textarea value={clientFeedback} onChange={e => setClientFeedback(e.target.value)} rows={2}
              placeholder="Debrief notes, evaluation comments…"
              style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>Lessons learned</span>
            <textarea value={lessonsLearned} onChange={e => setLessonsLearned(e.target.value)} rows={3}
              placeholder="What we would do differently on the next bid of this type…"
              style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>Notes (optional)</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Saving sets the opportunity to <strong>{outcome}</strong> with decision date {decisionDate || today()}.
            </span>
            <span style={{ display: 'flex', gap: 10 }}>
              {editing && (
                <button className="btn btn-ghost" onClick={() => setEditing(false)}>
                  <X className="w-4 h-4" /> Cancel
                </button>
              )}
              <button className="btn btn-primary" disabled={busy || reasons.length === 0} onClick={save}>
                <Save className="w-4 h-4" /> {busy ? 'Saving…' : record ? 'Save changes' : 'Record outcome'}
              </button>
            </span>
          </div>
        </div>
      )}

      {record && !editing && !canEdit && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          Only {record.authorName}, a manager or an admin can change this record.
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="modal" style={{ maxWidth: 420, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              Delete the outcome record?
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 20px' }}>
              The reasons, prices and lessons learned are removed from the win/loss analysis. The opportunity stays
              closed as {opportunity.stage}.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}><X className="w-4 h-4" /> Cancel</button>
              <button className="btn btn-danger" onClick={remove}><Trash2 className="w-4 h-4" /> Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div style={labelCapsStyle}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text-primary)', marginTop: 2 }}>{value || '—'}</div>
    </div>
  );
}

function Para({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div style={labelCapsStyle}>{title}</div>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{text}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '0 0 14px' }}>
      {children}
    </h3>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '9px 11px', background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
};

const labelCapsStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)',
};
