import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { User } from 'firebase/auth';
import {
  AppUser, Opportunity, OpportunityMilestone, MilestoneStatus,
  MILESTONE_STATUS_OPTIONS,
} from '../../types';
import { daysUntil } from './opportunityUi';
import { Flag, Plus, Trash2, Check, X, CalendarClock, AlertTriangle } from 'lucide-react';

interface Props {
  opportunity: Opportunity;
  user: User;
  appUser: AppUser;
}

const STATUS_COLORS: Record<MilestoneStatus, string> = {
  'Planned': '#64748b',
  'In Progress': '#3b82f6',
  'Done': '#16a34a',
  'Blocked': '#dc2626',
};

// The gates a bid actually passes through. Offered as one-click starters so a
// new opportunity gets a comparable milestone set instead of ad-hoc titles —
// the analytics view later aggregates slippage by gate title.
const BID_GATES = [
  'Prequalification submitted',
  'Site visit',
  'Clarifications closed',
  'Bid submission',
  'Award decision',
];

const today = () => new Date().toISOString().slice(0, 10);

// Slippage is measured against `dueDate`: a finished gate compares its own
// completion date, an unfinished one compares today. Positive = days late.
const slippage = (m: OpportunityMilestone) => {
  if (!m.dueDate) return null;
  const due = new Date(`${m.dueDate}T00:00:00`).getTime();
  if (!isFinite(due)) return null;
  let ref: number;
  if (m.status === 'Done') {
    if (!m.completedDate) return null;
    ref = new Date(`${m.completedDate}T00:00:00`).getTime();
    if (!isFinite(ref)) return null;
  } else {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    ref = t.getTime();
  }
  return Math.round((ref - due) / 86_400_000);
};

export default function OpportunityMilestonesTab({ opportunity, user, appUser }: Props) {
  const [milestones, setMilestones] = useState<OpportunityMilestone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OpportunityMilestone | null>(null);

  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<MilestoneStatus>('Planned');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'opportunityMilestones'), where('opportunityId', '==', opportunity.id));
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as OpportunityMilestone));
      // Sorted client-side (undated gates last) so no composite index is needed.
      rows.sort((a, b) => {
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
      });
      setMilestones(rows);
    }, err => {
      console.error('opportunityMilestones listener:', err);
      setError('Failed to load milestones.');
    });
    return () => unsub();
  }, [opportunity.id]);

  const stats = useMemo(() => {
    const done = milestones.filter(m => m.status === 'Done').length;
    const blocked = milestones.filter(m => m.status === 'Blocked').length;
    const late = milestones.filter(m => m.status !== 'Done' && (slippage(m) ?? -1) > 0).length;
    const next = milestones.find(m => m.status !== 'Done');
    const worst = milestones.reduce<number | null>((acc, m) => {
      const s = slippage(m);
      return s !== null && s > 0 && (acc === null || s > acc) ? s : acc;
    }, null);
    return {
      done, blocked, late, next, worst,
      total: milestones.length,
      percent: milestones.length ? Math.round((done / milestones.length) * 100) : 0,
    };
  }, [milestones]);

  const existingTitles = useMemo(
    () => new Set(milestones.map(m => m.title.trim().toLowerCase())),
    [milestones],
  );
  const missingGates = BID_GATES.filter(g => !existingTitles.has(g.toLowerCase()));

  const create = async (t: string, due: string, st: MilestoneStatus, note: string) => {
    await addDoc(collection(db, 'opportunityMilestones'), {
      opportunityId: opportunity.id,
      title: t,
      status: st,
      dueDate: due,
      completedDate: st === 'Done' ? today() : '',
      notes: note,
      addedById: user.uid,
      addedByName: appUser.displayName || 'Unknown',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await create(title.trim(), dueDate, status, notes.trim());
      setTitle(''); setDueDate(''); setNotes(''); setStatus('Planned');
    } catch (e) {
      console.error('add milestone failed:', e);
      setError('Failed to add the milestone. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Seeds only the gates that are missing, so it is safe to press twice. The
  // submission gate inherits the opportunity's own deadline.
  const seedGates = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const g of missingGates) {
        const due = g === 'Bid submission' ? (opportunity.submissionDeadline || '') : '';
        await create(g, due, 'Planned', '');
      }
    } catch (e) {
      console.error('seed gates failed:', e);
      setError('Failed to add the standard gates.');
    } finally {
      setBusy(false);
    }
  };

  const setStatusOf = async (m: OpportunityMilestone, next: MilestoneStatus) => {
    try {
      await updateDoc(doc(db, 'opportunityMilestones', m.id), {
        status: next,
        // A gate that stops being Done loses its completion date, so slippage
        // can never be read off a stale one.
        completedDate: next === 'Done' ? (m.completedDate || today()) : '',
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('update milestone status failed:', e);
      setError('Failed to update the milestone.');
    }
  };

  const setField = async (m: OpportunityMilestone, patch: Partial<OpportunityMilestone>) => {
    try {
      await updateDoc(doc(db, 'opportunityMilestones', m.id), { ...patch, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error('update milestone failed:', e);
      setError('Failed to update the milestone.');
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'opportunityMilestones', deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      console.error('delete milestone failed:', e);
      setError('Failed to delete the milestone.');
      setDeleteTarget(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {error && (
        <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#991b1b', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* Gate progress */}
      <div className="card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Flag className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            Bid gates
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
            {stats.done}/{stats.total}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700 }}>gates passed · {stats.percent}%</span>
        </div>
        <div style={{ height: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', marginTop: 10 }}>
          <div style={{ width: `${stats.percent}%`, height: '100%', background: stats.late > 0 ? '#f59e0b' : '#16a34a' }} />
        </div>

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14, fontSize: 12.5 }}>
          {stats.next && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)' }}>
              <CalendarClock className="w-3.5 h-3.5" />
              Next gate: <strong style={{ color: 'var(--text-primary)' }}>{stats.next.title}</strong>
              {stats.next.dueDate ? ` · ${stats.next.dueDate}` : ' · no date set'}
            </span>
          )}
          {stats.late > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#dc2626', fontWeight: 700 }}>
              <AlertTriangle className="w-3.5 h-3.5" />
              {stats.late} gate{stats.late > 1 ? 's' : ''} past due
              {stats.worst !== null && ` · worst slippage ${stats.worst}d`}
            </span>
          )}
          {stats.blocked > 0 && (
            <span style={{ color: '#dc2626', fontWeight: 700 }}>{stats.blocked} blocked</span>
          )}
          {stats.total === 0 && (
            <span style={{ color: 'var(--text-muted)' }}>No gates recorded yet.</span>
          )}
        </div>

        {missingGates.length > 0 && (
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} disabled={busy} onClick={seedGates}>
            <Plus className="w-4 h-4" />
            {stats.total === 0
              ? 'Add the standard bid gates'
              : `Add the ${missingGates.length} missing standard gate${missingGates.length > 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {/* Add a gate */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 4, flex: '2 1 240px' }}>
            <span style={labelStyle}>Milestone</span>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              list="opp-gate-suggestions"
              placeholder="e.g. Technical clarification meeting"
              style={{ ...inputStyle, width: '100%' }}
            />
            <datalist id="opp-gate-suggestions">
              {BID_GATES.map(g => <option key={g} value={g} />)}
            </datalist>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>Due date</span>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>Status</span>
            <select value={status} onChange={e => setStatus(e.target.value as MilestoneStatus)} style={inputStyle}>
              {MILESTONE_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, flex: '1 1 200px' }}>
            <span style={labelStyle}>Notes (optional)</span>
            <input value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
          </label>
          <button className="btn btn-primary" disabled={busy || !title.trim()} onClick={add}>
            <Plus className="w-4 h-4" /> Add gate
          </button>
        </div>
      </div>

      {/* The gates */}
      {milestones.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>
          No milestones yet — add the standard bid gates above to track prequalification through award.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {milestones.map(m => {
            const slip = slippage(m);
            const color = STATUS_COLORS[m.status] || 'var(--border)';
            const isLate = m.status !== 'Done' && slip !== null && slip > 0;
            const dueIn = m.status !== 'Done' ? daysUntil(m.dueDate) : null;
            return (
              <div key={m.id} className="card" style={{ padding: 14, borderLeft: `3px solid ${color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    title={m.status === 'Done' ? 'Mark as planned' : 'Mark as done'}
                    onClick={() => setStatusOf(m, m.status === 'Done' ? 'Planned' : 'Done')}
                    style={{
                      width: 22, height: 22, flexShrink: 0, cursor: 'pointer', padding: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: m.status === 'Done' ? '#16a34a' : 'var(--surface)',
                      border: `1px solid ${m.status === 'Done' ? '#16a34a' : 'var(--border)'}`,
                    }}
                  >
                    {m.status === 'Done' && <Check className="w-3.5 h-3.5" style={{ color: '#fff' }} />}
                  </button>

                  <span style={{
                    fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)',
                    textDecoration: m.status === 'Done' ? 'line-through' : 'none',
                    opacity: m.status === 'Done' ? 0.75 : 1,
                  }}>
                    {m.title}
                  </span>

                  <select
                    value={m.status}
                    onChange={e => setStatusOf(m, e.target.value as MilestoneStatus)}
                    style={{ ...inputStyle, padding: '5px 8px', fontSize: 12, fontWeight: 700, color }}
                  >
                    {MILESTONE_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                    Due
                    <input
                      type="date"
                      value={m.dueDate || ''}
                      onChange={e => setField(m, { dueDate: e.target.value })}
                      style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}
                    />
                  </label>

                  {m.status === 'Done' && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                      Completed
                      <input
                        type="date"
                        value={m.completedDate || ''}
                        onChange={e => setField(m, { completedDate: e.target.value })}
                        style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}
                      />
                    </label>
                  )}

                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {slip !== null && (
                      <span style={{
                        fontSize: 11.5, fontWeight: 800, padding: '3px 8px',
                        color: slip > 0 ? '#991b1b' : '#166534',
                        background: slip > 0 ? '#fee2e2' : '#dcfce7',
                      }}>
                        {slip > 0
                          ? `${slip}d late`
                          : m.status === 'Done'
                            ? (slip === 0 ? 'On time' : `${Math.abs(slip)}d early`)
                            : (dueIn === 0 ? 'Due today' : `${Math.abs(slip)}d left`)}
                      </span>
                    )}
                    <button className="btn btn-ghost btn-icon btn-sm" title="Delete milestone" onClick={() => setDeleteTarget(m)}>
                      <Trash2 className="w-3.5 h-3.5" style={{ color: '#dc2626' }} />
                    </button>
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, marginLeft: 32, fontSize: 12, color: 'var(--text-muted)' }}>
                  {m.notes && <span style={{ color: 'var(--text-secondary)' }}>{m.notes}</span>}
                  {m.addedByName && <span>Added by {m.addedByName}</span>}
                  {isLate && m.status === 'Blocked' && (
                    <span style={{ color: '#dc2626', fontWeight: 700 }}>Blocked and past due</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 420, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              Delete “{deleteTarget.title}”?
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 20px' }}>
              The gate and its slippage record are removed from this opportunity.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}><X className="w-4 h-4" /> Cancel</button>
              <button className="btn btn-danger" onClick={remove}><Trash2 className="w-4 h-4" /> Delete</button>
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

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
};
