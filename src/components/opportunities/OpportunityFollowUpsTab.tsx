import React, { useState, useEffect, useMemo } from 'react';
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
import { Send, Clock, CalendarClock, Trash2, MessageSquare } from 'lucide-react';

interface Props {
  opportunity: Opportunity;
  user: User;
  appUser: AppUser;
}

const fmt = (ts?: { seconds: number }) =>
  ts ? new Date(ts.seconds * 1000).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : 'Just now';

export default function OpportunityFollowUpsTab({ opportunity, user, appUser }: Props) {
  const [followUps, setFollowUps] = useState<OpportunityFollowUp[]>([]);
  const [text, setText] = useState('');
  const [stage, setStage] = useState<OpportunityStage>(opportunity.stage || 'Identified');
  const [nextActionDate, setNextActionDate] = useState(opportunity.nextActionDate || '');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OpportunityFollowUp | null>(null);

  // The stage select is a snapshot of where the bid stands *now*, so it has to
  // follow the opportunity when the record changes underneath us.
  useEffect(() => { setStage(opportunity.stage || 'Identified'); }, [opportunity.stage]);
  useEffect(() => { setNextActionDate(opportunity.nextActionDate || ''); }, [opportunity.nextActionDate]);

  useEffect(() => {
    const q = query(collection(db, 'opportunityFollowUps'), where('opportunityId', '==', opportunity.id));
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as OpportunityFollowUp));
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setFollowUps(rows);
    }, err => {
      console.error('opportunityFollowUps listener:', err);
      setError('Failed to load follow-ups.');
    });
    return () => unsub();
  }, [opportunity.id]);

  const nextDue = useMemo(() => {
    if (!opportunity.nextActionDate) return null;
    const target = new Date(`${opportunity.nextActionDate}T00:00:00`).getTime();
    if (!isFinite(target)) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today.getTime()) / 86_400_000);
  }, [opportunity.nextActionDate]);

  const post = async () => {
    if (!text.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await addDoc(collection(db, 'opportunityFollowUps'), {
        opportunityId: opportunity.id,
        text: text.trim(),
        stage,
        nextActionDate,
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
        stage,
        updatedAt: serverTimestamp(),
      });
      setText('');
    } catch (e) {
      console.error('post follow-up failed:', e);
      setError('Failed to post the follow-up. Please try again.');
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
      setError('Failed to delete. You can only delete your own follow-ups.');
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

      {/* Latest follow-up + next action */}
      <div className="card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <MessageSquare className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            Latest follow-up
          </span>
        </div>
        {opportunity.lastFollowUpText ? (
          <p style={{ fontSize: 15, color: 'var(--text-primary)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {opportunity.lastFollowUpText}
          </p>
        ) : (
          <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>No follow-up recorded yet.</p>
        )}
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          {opportunity.lastFollowUpAt && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Clock className="w-3.5 h-3.5" /> {fmt(opportunity.lastFollowUpAt)}
            </span>
          )}
          {opportunity.nextActionDate && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700,
              color: nextDue !== null && nextDue < 0 ? '#dc2626'
                : nextDue !== null && nextDue <= 3 ? '#f59e0b' : 'var(--text-secondary)',
            }}>
              <CalendarClock className="w-3.5 h-3.5" />
              Next action {opportunity.nextActionDate}
              {nextDue !== null && (nextDue < 0 ? ` · ${Math.abs(nextDue)}d overdue` : nextDue === 0 ? ' · today' : ` · in ${nextDue}d`)}
            </span>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Stage now</span>
            <select value={stage} onChange={e => setStage(e.target.value as OpportunityStage)} style={inputStyle}>
              {OPPORTUNITY_STAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Next action date</span>
            <input type="date" value={nextActionDate} onChange={e => setNextActionDate(e.target.value)} style={inputStyle} />
          </label>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="What happened? e.g. clarification issued, site visit booked, client called…"
          rows={3}
          style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Posting also updates the opportunity's stage and next action date.
          </span>
          <button className="btn btn-primary" disabled={posting || !text.trim()} onClick={post}>
            <Send className="w-4 h-4" /> {posting ? 'Posting…' : 'Post follow-up'}
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px' }}>
          History {followUps.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>({followUps.length})</span>}
        </h3>
        {followUps.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>No follow-ups yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', borderInlineStart: '2px solid var(--border)', paddingInlineStart: 18, marginInlineStart: 6 }}>
            {followUps.map(f => (
              <div key={f.id} style={{ position: 'relative', paddingBottom: 18 }}>
                <span style={{ position: 'absolute', insetInlineStart: -25, top: 4, width: 10, height: 10, borderRadius: '50%', background: f.authorColor || 'var(--accent)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                  {f.stage && <span className="badge badge-inprogress">{f.stage}</span>}
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{f.authorName}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt(f.createdAt)}</span>
                  {f.nextActionDate && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <CalendarClock className="w-3 h-3" /> next {f.nextActionDate}
                    </span>
                  )}
                  {canRemove(f) && (
                    <button className="btn btn-ghost btn-icon btn-sm" title="Delete follow-up" onClick={() => setDeleteTarget(f)}>
                      <Trash2 className="w-3.5 h-3.5" style={{ color: '#dc2626' }} />
                    </button>
                  )}
                </div>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{f.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 420, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>Delete follow-up?</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 20px' }}>
              This entry is removed from the timeline. The opportunity's own "latest follow-up" summary is not rewritten.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={remove}>Delete</button>
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
