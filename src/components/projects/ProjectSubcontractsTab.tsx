import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { User } from 'firebase/auth';
import { Project, ProjectSubcontract, CURRENCY_OPTIONS } from '../../types';
import { isOverdue, isDueSoon, parseAmount, formatMoney } from '../../utils';
import { Plus, X, Edit2, Trash2, Truck, Building2, AlertTriangle } from 'lucide-react';
import ListControls, { SortDir } from './ListControls';

interface Props { project: Project; user: User; }

const emptyForm = () => ({
  name: '', typeOfService: '', soOrContract: '', reference: '',
  startDate: '', expiryDate: '', price: '', currency: 'EGP',
  status: '', currentStatus: '', remarks: '',
});

function daysLeftLabel(expiry?: string): { text: string; color: string } | null {
  if (!expiry) return null;
  if (isOverdue(expiry)) return { text: 'Expired', color: '#dc2626' };
  const d = new Date(expiry).getTime() - Date.now();
  const days = Math.ceil(d / 86400000);
  return { text: `${days} day${days === 1 ? '' : 's'} left`, color: isDueSoon(expiry, 24 * 30) ? '#f59e0b' : '#16a34a' };
}

export default function ProjectSubcontractsTab({ project, user }: Props) {
  const [items, setItems] = useState<ProjectSubcontract[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectSubcontract | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<ProjectSubcontract | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [validityFilter, setValidityFilter] = useState('all');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    const q = query(collection(db, 'projectSubcontracts'), where('projectId', '==', project.id));
    const unsub = onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectSubcontract)));
    }, err => console.error('projectSubcontracts listener:', err));
    return () => unsub();
  }, [project.id]);

  const statusOf = (s: ProjectSubcontract) => (s.currentStatus || s.status || '').trim();

  // Filter dropdown is populated from the statuses actually in use.
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach(s => { const v = statusOf(s); if (v) set.add(v); });
    return [{ value: 'all', label: 'All statuses' }, ...Array.from(set).sort().map(v => ({ value: v, label: v }))];
  }, [items]);

  const visible = useMemo(() => {
    let rows = items.slice();
    if (statusFilter !== 'all') rows = rows.filter(s => statusOf(s) === statusFilter);
    if (validityFilter !== 'all') {
      rows = rows.filter(s => {
        if (validityFilter === 'expired') return s.expiryDate && isOverdue(s.expiryDate);
        if (validityFilter === 'soon') return s.expiryDate && !isOverdue(s.expiryDate) && isDueSoon(s.expiryDate, 24 * 30);
        if (validityFilter === 'valid') return s.expiryDate && !isOverdue(s.expiryDate) && !isDueSoon(s.expiryDate, 24 * 30);
        return true;
      });
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let r = 0;
      switch (sortKey) {
        case 'price': r = (parseAmount(a.price) ?? -Infinity) - (parseAmount(b.price) ?? -Infinity); break;
        case 'startDate': r = (a.startDate || '').localeCompare(b.startDate || ''); break;
        case 'expiryDate': r = (a.expiryDate || '').localeCompare(b.expiryDate || ''); break;
        case 'status': r = statusOf(a).localeCompare(statusOf(b)); break;
        case 'createdAt': r = (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0); break;
        default: r = (a.name || '').localeCompare(b.name || '');
      }
      return r * dir;
    });
    return rows;
  }, [items, statusFilter, validityFilter, sortKey, sortDir]);

  // Surface validity at a glance: how many subcontracts have expired or are
  // within their final 30 days.
  const expirySummary = useMemo(() => {
    let expired = 0, expiringSoon = 0;
    items.forEach(s => {
      if (!s.expiryDate) return;
      if (isOverdue(s.expiryDate)) expired++;
      else if (isDueSoon(s.expiryDate, 24 * 30)) expiringSoon++;
    });
    return { expired, expiringSoon };
  }, [items]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setIsOpen(true); };
  const openEdit = (s: ProjectSubcontract) => {
    setEditing(s);
    setForm({ name: s.name || '', typeOfService: s.typeOfService || '', soOrContract: s.soOrContract || '', reference: s.reference || '', startDate: s.startDate || '', expiryDate: s.expiryDate || '', price: String(s.price ?? ''), currency: s.currency || 'EGP', status: s.status || '', currentStatus: s.currentStatus || '', remarks: s.remarks || '' });
    setIsOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const payload: any = { ...form, projectId: project.id, updatedAt: serverTimestamp() };
    try {
      if (editing) await updateDoc(doc(db, 'projectSubcontracts', editing.id), payload);
      else await addDoc(collection(db, 'projectSubcontracts'), { ...payload, userId: user.uid, createdAt: serverTimestamp() });
      setIsOpen(false);
    } catch (e) { console.error('save subcontract failed:', e); }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try { await deleteDoc(doc(db, 'projectSubcontracts', deleteTarget.id)); setDeleteTarget(null); }
    catch (e) { console.error('delete subcontract failed:', e); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Subcontracts</h3>
        <button className="btn btn-primary btn-sm" onClick={openCreate}><Plus className="w-4 h-4" /> Add subcontract</button>
      </div>

      {(expirySummary.expired > 0 || expirySummary.expiringSoon > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '9px 14px', marginBottom: 14, background: 'rgba(245,158,11,0.12)', color: '#92400e', fontSize: 13, fontWeight: 600 }}>
          <AlertTriangle className="w-4 h-4" style={{ flexShrink: 0 }} />
          {expirySummary.expired > 0 && <span>{expirySummary.expired} expired</span>}
          {expirySummary.expired > 0 && expirySummary.expiringSoon > 0 && <span>·</span>}
          {expirySummary.expiringSoon > 0 && <span>{expirySummary.expiringSoon} expiring within 30 days</span>}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Truck className="w-8 h-8" /></div>
          <div className="empty-state-title">No subcontracts</div>
          <div className="empty-state-sub">Track subcontractors / service orders, their service, validity and current status.</div>
        </div>
      ) : (
        <>
          <ListControls
            filters={[
              { key: 'status', label: 'Status', value: statusFilter, options: statusOptions, onChange: setStatusFilter },
              { key: 'validity', label: 'Validity', value: validityFilter, onChange: setValidityFilter, options: [
                { value: 'all', label: 'All' },
                { value: 'valid', label: 'Valid' },
                { value: 'soon', label: 'Expiring soon' },
                { value: 'expired', label: 'Expired' },
              ] },
            ]}
            sortOptions={[
              { value: 'name', label: 'Name' },
              { value: 'price', label: 'Price' },
              { value: 'startDate', label: 'Start date' },
              { value: 'expiryDate', label: 'Expiry date' },
              { value: 'status', label: 'Status' },
              { value: 'createdAt', label: 'Recently added' },
            ]}
            sortValue={sortKey}
            onSortChange={setSortKey}
            sortDir={sortDir}
            onSortDirToggle={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            trailing={`${visible.length} of ${items.length}`}
          />
          {visible.length === 0 ? (
            <div className="empty-state"><div className="empty-state-title">No subcontracts match</div></div>
          ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {visible.map(s => {
            const dl = daysLeftLabel(s.expiryDate);
            return (
              <div key={s.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <Building2 className="w-4 h-4" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <span style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text-primary)' }}>{s.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openEdit(s)}><Edit2 className="w-4 h-4" /></button>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setDeleteTarget(s)}><Trash2 className="w-4 h-4" style={{ color: '#dc2626' }} /></button>
                  </div>
                </div>
                {s.typeOfService && <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{s.typeOfService}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {s.soOrContract && <span>SO/Contract: <b style={{ color: 'var(--text-secondary)' }}>{s.soOrContract}</b></span>}
                  {parseAmount(s.price) != null && <span>{formatMoney(s.price, s.currency)}</span>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {(s.startDate || s.expiryDate) && <span>📅 {[s.startDate, s.expiryDate].filter(Boolean).join(' → ')}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 4, flexWrap: 'wrap' }}>
                  {(s.currentStatus || s.status) && <span className="badge badge-inprogress">{s.currentStatus || s.status}</span>}
                  {dl && <span style={{ fontSize: 12, fontWeight: 700, color: dl.color }}>{dl.text}</span>}
                </div>
              </div>
            );
          })}
          </div>
          )}
        </>
      )}

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal" style={{ maxWidth: 520, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{editing ? 'Edit subcontract' : 'Add subcontract'}</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setIsOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <div style={{ display: 'grid', gap: 12, maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }}>
              <L label="Subcontractor / supplier *"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inp} /></L>
              <L label="Type of service"><textarea value={form.typeOfService} onChange={e => setForm({ ...form, typeOfService: e.target.value })} style={inp} rows={2} /></L>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label="SO / Contract"><input value={form.soOrContract} onChange={e => setForm({ ...form, soOrContract: e.target.value })} style={inp} /></L>
                <L label="Reference"><input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} style={inp} /></L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <L label="Price"><input value={form.price} inputMode="decimal" onChange={e => setForm({ ...form, price: e.target.value })} style={inp} placeholder="0" /></L>
                <L label="Currency">
                  <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} style={inp}>
                    {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label="Start date"><input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} style={inp} /></L>
                <L label="Expiry date"><input type="date" value={form.expiryDate} onChange={e => setForm({ ...form, expiryDate: e.target.value })} style={inp} /></L>
              </div>
              <L label="Current status"><input value={form.currentStatus} onChange={e => setForm({ ...form, currentStatus: e.target.value })} style={inp} placeholder="e.g. 50% Completion, Awaiting Spares…" /></L>
              <L label="Remarks"><textarea value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} style={inp} rows={2} /></L>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={() => setIsOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!form.name.trim()} onClick={save}>{editing ? 'Save' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 380, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 16px' }}>Delete "{deleteTarget.name}"?</h2>
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

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit' };
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 }}>{label}</span>{children}</label>;
}
