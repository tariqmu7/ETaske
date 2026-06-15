import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { User } from 'firebase/auth';
import {
  Project, ProjectFinancialRecord, ProjectFinancialType, PROJECT_FINANCIAL_TYPE_OPTIONS,
} from '../../types';
import { Plus, X, Edit2, Trash2, DollarSign } from 'lucide-react';

interface Props { project: Project; user: User; }

const emptyForm = () => ({
  type: 'invoice' as ProjectFinancialType,
  title: '',
  amount: '',
  currency: 'EGP',
  date: '',
  status: '',
  notes: '',
});

function typeBadge(t: ProjectFinancialType) {
  switch (t) {
    case 'income': return 'badge badge-done';
    case 'expense': return 'badge badge-urgent';
    case 'invoice': return 'badge badge-inprogress';
    case 'budget': return 'badge badge-pending';
    default: return 'badge';
  }
}

const fmtAmount = (n?: number | string) => {
  const v = typeof n === 'string' ? parseFloat(n.replace(/[^0-9.\-]/g, '')) : n;
  if (v == null || isNaN(v as number)) return String(n ?? '');
  return (v as number).toLocaleString('en-US');
};

export default function ProjectFinancialsTab({ project, user }: Props) {
  const [records, setRecords] = useState<ProjectFinancialRecord[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectFinancialRecord | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<ProjectFinancialRecord | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'projectFinancials'), where('projectId', '==', project.id));
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectFinancialRecord));
      rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setRecords(rows);
    }, err => console.error('projectFinancials listener:', err));
    return () => unsub();
  }, [project.id]);

  const totals = useMemo(() => {
    const byCur: Record<string, { income: number; expense: number }> = {};
    records.forEach(r => {
      const cur = r.currency || '—';
      const v = typeof r.amount === 'string' ? parseFloat(r.amount.replace(/[^0-9.\-]/g, '')) : (r.amount || 0);
      if (isNaN(v as number)) return;
      byCur[cur] = byCur[cur] || { income: 0, expense: 0 };
      if (r.type === 'income' || r.type === 'invoice') byCur[cur].income += v as number;
      if (r.type === 'expense') byCur[cur].expense += v as number;
    });
    return byCur;
  }, [records]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setIsOpen(true); };
  const openEdit = (r: ProjectFinancialRecord) => {
    setEditing(r);
    setForm({ type: r.type, title: r.title || '', amount: String(r.amount ?? ''), currency: r.currency || 'EGP', date: r.date || '', status: r.status || '', notes: r.notes || '' });
    setIsOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) return;
    const payload = {
      ...form,
      amount: form.amount === '' ? '' : (isNaN(parseFloat(form.amount)) ? form.amount : parseFloat(form.amount)),
      projectId: project.id,
      updatedAt: serverTimestamp(),
    };
    try {
      if (editing) {
        await updateDoc(doc(db, 'projectFinancials', editing.id), payload);
      } else {
        await addDoc(collection(db, 'projectFinancials'), { ...payload, userId: user.uid, createdAt: serverTimestamp() });
      }
      setIsOpen(false);
    } catch (e) { console.error('save financial failed:', e); }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try { await deleteDoc(doc(db, 'projectFinancials', deleteTarget.id)); setDeleteTarget(null); }
    catch (e) { console.error('delete financial failed:', e); }
  };

  return (
    <div>
      {/* Totals */}
      {Object.keys(totals).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
          {Object.entries(totals).map(([cur, t]) => (
            <div key={cur} className="card stat-green" style={{ padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{cur}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>In: <b style={{ color: '#16a34a' }}>{t.income.toLocaleString('en-US')}</b></div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Out: <b style={{ color: '#dc2626' }}>{t.expense.toLocaleString('en-US')}</b></div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>Net: {(t.income - t.expense).toLocaleString('en-US')}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Financial Records</h3>
        <button className="btn btn-primary btn-sm" onClick={openCreate}><Plus className="w-4 h-4" /> Add record</button>
      </div>

      {records.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><DollarSign className="w-8 h-8" /></div>
          <div className="empty-state-title">No financial records</div>
          <div className="empty-state-sub">Track invoices, income, expenses and budgets for this project.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead style={{ background: 'var(--surface-3)', borderBottom: '2px solid var(--border)' }}>
              <tr>
                {['Type', 'Title', 'Amount', 'Date', 'Status', ''].map((h, i) => (
                  <th key={i} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 14px' }}><span className={typeBadge(r.type)} style={{ textTransform: 'capitalize' }}>{r.type}</span></td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-primary)', fontWeight: 600 }}>{r.title}{r.notes && <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>{r.notes}</div>}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{fmtAmount(r.amount)} {r.currency || ''}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{r.date || '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{r.status || '—'}</td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openEdit(r)}><Edit2 className="w-4 h-4" /></button>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setDeleteTarget(r)}><Trash2 className="w-4 h-4" style={{ color: '#dc2626' }} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{editing ? 'Edit record' : 'Add record'}</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setIsOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label="Type"><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as ProjectFinancialType })} style={inp}>{PROJECT_FINANCIAL_TYPE_OPTIONS.map(t => <option key={t} value={t} style={{ textTransform: 'capitalize' }}>{t}</option>)}</select></L>
                <L label="Date"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} /></L>
              </div>
              <L label="Title *"><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={inp} /></L>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <L label="Amount"><input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} style={inp} placeholder="0" /></L>
                <L label="Currency"><input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} style={inp} /></L>
              </div>
              <L label="Status"><input value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={inp} placeholder="Paid / Pending…" /></L>
              <L label="Notes"><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={inp} rows={2} /></L>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={() => setIsOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>{editing ? 'Save' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 16px' }}>Delete this record?</h2>
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
