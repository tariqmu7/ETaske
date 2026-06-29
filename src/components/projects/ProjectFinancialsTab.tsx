import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { User } from 'firebase/auth';
import {
  Project, ProjectFinancialRecord, ProjectFinancialType, PROJECT_FINANCIAL_TYPE_OPTIONS,
  ProjectContractItem, CURRENCY_OPTIONS,
} from '../../types';
import { parseAmount, formatMoney } from '../../utils';
import { Plus, X, Edit2, Trash2, DollarSign, Link2 } from 'lucide-react';
import ListControls, { SortDir } from './ListControls';

interface Props { project: Project; user: User; }

const emptyForm = () => ({
  type: 'invoice' as ProjectFinancialType,
  title: '',
  amount: '',
  currency: 'EGP',
  date: '',
  status: '',
  notes: '',
  relatedContractId: '',
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

export default function ProjectFinancialsTab({ project, user }: Props) {
  const [records, setRecords] = useState<ProjectFinancialRecord[]>([]);
  const [contracts, setContracts] = useState<ProjectContractItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectFinancialRecord | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<ProjectFinancialRecord | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    const q = query(collection(db, 'projectFinancials'), where('projectId', '==', project.id));
    const unsub = onSnapshot(q, snap => {
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectFinancialRecord)));
    }, err => console.error('projectFinancials listener:', err));
    return () => unsub();
  }, [project.id]);

  const visible = useMemo(() => {
    let rows = records.slice();
    if (typeFilter !== 'all') rows = rows.filter(r => r.type === typeFilter);
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let r = 0;
      switch (sortKey) {
        case 'amount': r = (parseAmount(a.amount) ?? -Infinity) - (parseAmount(b.amount) ?? -Infinity); break;
        case 'title': r = (a.title || '').localeCompare(b.title || ''); break;
        case 'type': r = a.type.localeCompare(b.type); break;
        case 'status': r = (a.status || '').localeCompare(b.status || ''); break;
        default: r = (a.date || '').localeCompare(b.date || '');
      }
      return r * dir;
    });
    return rows;
  }, [records, typeFilter, sortKey, sortDir]);

  // Contracts power the optional "linked contract" picker on each record.
  useEffect(() => {
    const q = query(collection(db, 'projectContracts'), where('projectId', '==', project.id));
    const unsub = onSnapshot(q, snap => {
      setContracts(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectContractItem)));
    }, err => console.error('projectContracts listener:', err));
    return () => unsub();
  }, [project.id]);

  const contractLabel = (id?: string) => {
    if (!id) return '';
    const c = contracts.find(x => x.id === id);
    if (!c) return '';
    return c.contractNumber || c.subject || c.companyName || 'Contract';
  };

  // Per-currency rollup. Invoice and income are kept separate so that logging
  // an invoice and then its received income doesn't double-count revenue:
  // Net = income − expense, while Invoiced and Budget are shown for context.
  const totals = useMemo(() => {
    const byCur: Record<string, { income: number; expense: number; invoiced: number; budget: number }> = {};
    records.forEach(r => {
      const cur = r.currency || '—';
      const v = parseAmount(r.amount);
      if (v == null) return;
      byCur[cur] = byCur[cur] || { income: 0, expense: 0, invoiced: 0, budget: 0 };
      if (r.type === 'income') byCur[cur].income += v;
      else if (r.type === 'expense') byCur[cur].expense += v;
      else if (r.type === 'invoice') byCur[cur].invoiced += v;
      else if (r.type === 'budget') byCur[cur].budget += v;
    });
    return byCur;
  }, [records]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setIsOpen(true); };
  const openEdit = (r: ProjectFinancialRecord) => {
    setEditing(r);
    setForm({ type: r.type, title: r.title || '', amount: String(r.amount ?? ''), currency: r.currency || 'EGP', date: r.date || '', status: r.status || '', notes: r.notes || '', relatedContractId: r.relatedContractId || '' });
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 18 }}>
          {Object.entries(totals).map(([cur, t]) => {
            const net = t.income - t.expense;
            return (
              <div key={cur} className="card stat-green" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{cur}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
                  <span>Income</span><b style={{ color: '#16a34a' }}>{t.income.toLocaleString('en-US')}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-secondary)' }}>
                  <span>Expense</span><b style={{ color: '#dc2626' }}>{t.expense.toLocaleString('en-US')}</b>
                </div>
                {t.invoiced > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-muted)' }}>
                    <span>Invoiced</span><b style={{ color: 'var(--text-secondary)' }}>{t.invoiced.toLocaleString('en-US')}</b>
                  </div>
                )}
                {t.budget > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-muted)' }}>
                    <span>Budget</span><b style={{ color: 'var(--text-secondary)' }}>{t.budget.toLocaleString('en-US')}</b>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                  <span>Net</span><span style={{ color: net < 0 ? '#dc2626' : '#16a34a' }}>{net.toLocaleString('en-US')}</span>
                </div>
              </div>
            );
          })}
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
        <>
        <ListControls
          filters={[
            { key: 'type', label: 'Type', value: typeFilter, onChange: setTypeFilter, options: [
              { value: 'all', label: 'All types' },
              ...PROJECT_FINANCIAL_TYPE_OPTIONS.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
            ] },
          ]}
          sortOptions={[
            { value: 'date', label: 'Date' },
            { value: 'amount', label: 'Amount' },
            { value: 'title', label: 'Title' },
            { value: 'type', label: 'Type' },
            { value: 'status', label: 'Status' },
          ]}
          sortValue={sortKey}
          onSortChange={setSortKey}
          sortDir={sortDir}
          onSortDirToggle={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          trailing={`${visible.length} of ${records.length}`}
        />
        {visible.length === 0 ? (
          <div className="empty-state"><div className="empty-state-title">No records match</div></div>
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
              {visible.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 14px' }}><span className={typeBadge(r.type)} style={{ textTransform: 'capitalize' }}>{r.type}</span></td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {r.title}
                    {r.relatedContractId && contractLabel(r.relatedContractId) && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginLeft: 8 }}>
                        <Link2 className="w-3 h-3" /> {contractLabel(r.relatedContractId)}
                      </div>
                    )}
                    {r.notes && <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>{r.notes}</div>}
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{formatMoney(r.amount, r.currency)}</td>
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
        </>
      )}

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal" style={{ maxWidth: 480, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{editing ? 'Edit record' : 'Add record'}</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setIsOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label="Type"><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as ProjectFinancialType })} style={inp}>{PROJECT_FINANCIAL_TYPE_OPTIONS.map(t => <option key={t} value={t} style={{ textTransform: 'capitalize' }}>{t}</option>)}</select></L>
                <L label="Date"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} /></L>
              </div>
              <L label="Title *"><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={inp} placeholder="e.g. Milestone 1 invoice" /></L>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <L label="Amount"><input value={form.amount} inputMode="decimal" onChange={e => setForm({ ...form, amount: e.target.value })} style={inp} placeholder="0" /></L>
                <L label="Currency">
                  <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} style={inp}>
                    {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </L>
              </div>
              {contracts.length > 0 && (
                <L label="Linked contract">
                  <select value={form.relatedContractId} onChange={e => setForm({ ...form, relatedContractId: e.target.value })} style={inp}>
                    <option value="">— None —</option>
                    {contracts.map(c => <option key={c.id} value={c.id}>{c.contractNumber || c.subject || c.companyName || 'Contract'}</option>)}
                  </select>
                </L>
              )}
              <L label="Status"><input value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={inp} placeholder="Paid / Pending…" /></L>
              <L label="Notes"><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={inp} rows={2} /></L>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={() => setIsOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!form.title.trim()} onClick={save}>{editing ? 'Save' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 380, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
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
