import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { User } from 'firebase/auth';
import {
  Project, ProjectContractItem, ProjectContractType, PROJECT_CONTRACT_TYPE_OPTIONS,
  CURRENCY_OPTIONS,
} from '../../types';
import { parseAmount, formatMoney } from '../../utils';
import {
  Plus, X, Edit2, Trash2, FileText, ChevronRight, ChevronDown,
  CornerDownRight,
} from 'lucide-react';

interface Props { project: Project; user: User; }

const typeLabel = (t: ProjectContractType) =>
  PROJECT_CONTRACT_TYPE_OPTIONS.find(o => o.value === t)?.label || t;

function typeColor(t: ProjectContractType): string {
  switch (t) {
    case 'contract': return '#3b82f6';
    case 'sub_contract': return '#8b5cf6';
    case 'amendment': return '#f59e0b';
    case 'agreement': return '#06b6d4';
    case 'work_authorization': return '#10b981';
    default: return '#94a3b8';
  }
}

const emptyForm = (type: ProjectContractType = 'contract') => ({
  type,
  contractNumber: '',
  subject: '',
  companyName: '',
  department: '',
  srDate: '',
  srValue: '',
  contractValue: '',
  currency: 'EGP',
  loaDate: '',
  startDate: '',
  endDate: '',
  status: '',
  contractingMethod: '',
  amendmentNumber: '',
  valueAfterIncrease: '',
  remarks: '',
  inCharge: '',
});

export default function ProjectContractsTab({ project, user }: Props) {
  const [items, setItems] = useState<ProjectContractItem[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectContractItem | null>(null);
  const [parentFor, setParentFor] = useState<ProjectContractItem | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<ProjectContractItem | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'projectContracts'), where('projectId', '==', project.id));
    const unsub = onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectContractItem)));
    }, err => console.error('projectContracts listener:', err));
    return () => unsub();
  }, [project.id]);

  const { roots, childrenOf } = useMemo(() => {
    const childrenOf: Record<string, ProjectContractItem[]> = {};
    const roots: ProjectContractItem[] = [];
    const sortFn = (a: ProjectContractItem, b: ProjectContractItem) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
    const ids = new Set(items.map(i => i.id));
    items.forEach(i => {
      if (i.parentId && ids.has(i.parentId)) {
        (childrenOf[i.parentId] = childrenOf[i.parentId] || []).push(i);
      } else {
        roots.push(i);
      }
    });
    roots.sort(sortFn);
    Object.values(childrenOf).forEach(arr => arr.sort(sortFn));
    return { roots, childrenOf };
  }, [items]);

  // Total contracted value per currency. An amendment's "value after increase"
  // supersedes its base value when present, so the rollup reflects the latest
  // agreed figure rather than summing both.
  const valueByCurrency = useMemo(() => {
    const byCur: Record<string, number> = {};
    items.forEach(i => {
      const v = parseAmount(i.valueAfterIncrease) ?? parseAmount(i.contractValue);
      if (v == null) return;
      const cur = i.currency || '—';
      byCur[cur] = (byCur[cur] || 0) + v;
    });
    return byCur;
  }, [items]);

  const openCreate = (parent: ProjectContractItem | null) => {
    setEditing(null);
    setParentFor(parent);
    setForm(emptyForm(parent ? 'amendment' : 'contract'));
    setIsOpen(true);
  };
  const openEdit = (it: ProjectContractItem) => {
    setEditing(it);
    setParentFor(null);
    setForm({
      type: it.type, contractNumber: it.contractNumber || '', subject: it.subject || '', companyName: it.companyName || '',
      department: it.department || '', srDate: it.srDate || '', srValue: String(it.srValue ?? ''), contractValue: String(it.contractValue ?? ''),
      currency: it.currency || 'EGP', loaDate: it.loaDate || '', startDate: it.startDate || '', endDate: it.endDate || '',
      status: it.status || '', contractingMethod: it.contractingMethod || '', amendmentNumber: it.amendmentNumber || '',
      valueAfterIncrease: String(it.valueAfterIncrease ?? ''), remarks: it.remarks || '', inCharge: it.inCharge || '',
    });
    setIsOpen(true);
  };

  const save = async () => {
    if (!form.subject.trim() && !form.contractNumber.trim() && !form.companyName.trim()) return;
    const payload: any = { ...form, projectId: project.id, updatedAt: serverTimestamp() };
    try {
      if (editing) {
        await updateDoc(doc(db, 'projectContracts', editing.id), payload);
      } else {
        await addDoc(collection(db, 'projectContracts'), {
          ...payload,
          parentId: parentFor ? parentFor.id : null,
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
      }
      setIsOpen(false);
    } catch (e) { console.error('save contract failed:', e); }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      // Cascade-delete descendants so the tree never orphans children.
      const toDelete: string[] = [];
      const collect = (id: string) => { toDelete.push(id); (childrenOf[id] || []).forEach(c => collect(c.id)); };
      collect(deleteTarget.id);
      await Promise.all(toDelete.map(id => deleteDoc(doc(db, 'projectContracts', id))));
      setDeleteTarget(null);
    } catch (e) { console.error('delete contract failed:', e); }
  };

  const Node = ({ item, depth }: { item: ProjectContractItem; depth: number }) => {
    const kids = childrenOf[item.id] || [];
    const isCollapsed = collapsed[item.id];
    return (
      <div>
        <div
          className="card"
          style={{ padding: '12px 14px', marginBottom: 8, marginLeft: depth * 22, display: 'flex', gap: 10, alignItems: 'flex-start', borderLeft: `3px solid ${typeColor(item.type)}` }}
        >
          <button
            onClick={() => setCollapsed(c => ({ ...c, [item.id]: !c[item.id] }))}
            style={{ background: 'none', border: 'none', cursor: kids.length ? 'pointer' : 'default', color: 'var(--text-muted)', padding: 2, marginTop: 2, visibility: kids.length ? 'visible' : 'hidden' }}
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#fff', background: typeColor(item.type), padding: '2px 7px' }}>{typeLabel(item.type)}</span>
              {item.contractNumber && <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{item.contractNumber}</span>}
              {item.amendmentNumber && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.amendmentNumber}</span>}
              {item.status && <span className="badge badge-inprogress">{item.status}</span>}
            </div>
            {item.subject && <div style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 600, lineHeight: 1.4 }}>{item.subject}</div>}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              {item.companyName && <span>🏢 {item.companyName}</span>}
              {parseAmount(item.contractValue) != null && <span>💰 {formatMoney(item.contractValue, item.currency)}</span>}
              {parseAmount(item.valueAfterIncrease) != null && <span style={{ color: '#16a34a', fontWeight: 600 }}>⬆ {formatMoney(item.valueAfterIncrease, item.currency)}</span>}
              {(item.startDate || item.endDate) && <span>📅 {[item.startDate, item.endDate].filter(Boolean).join(' → ')}</span>}
              {item.contractingMethod && <span>📝 {item.contractingMethod}</span>}
              {item.inCharge && <span>👤 {item.inCharge}</span>}
            </div>
            {item.remarks && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>{item.remarks}</div>}
          </div>

          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            <button className="btn btn-ghost btn-icon btn-sm" title="Add sub-item" onClick={() => openCreate(item)}><CornerDownRight className="w-4 h-4" /></button>
            <button className="btn btn-ghost btn-icon btn-sm" title="Edit" onClick={() => openEdit(item)}><Edit2 className="w-4 h-4" /></button>
            <button className="btn btn-ghost btn-icon btn-sm" title="Delete" onClick={() => setDeleteTarget(item)}><Trash2 className="w-4 h-4" style={{ color: '#dc2626' }} /></button>
          </div>
        </div>
        {!isCollapsed && kids.map(k => <Node key={k.id} item={k} depth={depth + 1} />)}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Contracts</h3>
        <button className="btn btn-primary btn-sm" onClick={() => openCreate(null)}><Plus className="w-4 h-4" /> Add contract</button>
      </div>

      {Object.keys(valueByCurrency).length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          {Object.entries(valueByCurrency).map(([cur, total]) => (
            <div key={cur} className="card" style={{ padding: '10px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total value · {cur}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>{total.toLocaleString('en-US')}</div>
            </div>
          ))}
        </div>
      )}

      {roots.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><FileText className="w-8 h-8" /></div>
          <div className="empty-state-title">No contracts yet</div>
          <div className="empty-state-sub">Add a contract, then attach amendments, agreements, work authorizations or sub-contracts under it.</div>
        </div>
      ) : (
        <div>{roots.map(r => <Node key={r.id} item={r} depth={0} />)}</div>
      )}

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal" style={{ maxWidth: 640, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                {editing ? 'Edit item' : parentFor ? `Add under ${parentFor.contractNumber || typeLabel(parentFor.type)}` : 'Add contract'}
              </h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setIsOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <div style={{ display: 'grid', gap: 12, maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label="Type"><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as ProjectContractType })} style={inp}>{PROJECT_CONTRACT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></L>
                <L label="Contract #"><input value={form.contractNumber} onChange={e => setForm({ ...form, contractNumber: e.target.value })} style={inp} /></L>
              </div>
              <L label="Subject"><textarea value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} style={inp} rows={2} /></L>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label="Company"><input value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} style={inp} /></L>
                <L label="Department"><input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} style={inp} /></L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <L label="Contract value"><input value={form.contractValue} inputMode="decimal" onChange={e => setForm({ ...form, contractValue: e.target.value })} style={inp} placeholder="0" /></L>
                <L label="Currency">
                  <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} style={inp}>
                    {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label="SR date"><input type="date" value={form.srDate} onChange={e => setForm({ ...form, srDate: e.target.value })} style={inp} /></L>
                <L label="SR value"><input value={form.srValue} inputMode="decimal" onChange={e => setForm({ ...form, srValue: e.target.value })} style={inp} placeholder="0" /></L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label="LOA date"><input type="date" value={form.loaDate} onChange={e => setForm({ ...form, loaDate: e.target.value })} style={inp} /></L>
                <L label="Value after increase"><input value={form.valueAfterIncrease} inputMode="decimal" onChange={e => setForm({ ...form, valueAfterIncrease: e.target.value })} style={inp} placeholder="0" /></L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label="Start date"><input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} style={inp} /></L>
                <L label="End date"><input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} style={inp} /></L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label="Status"><input value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={inp} placeholder="Active / Expired…" /></L>
                <L label="Contracting method"><input value={form.contractingMethod} onChange={e => setForm({ ...form, contractingMethod: e.target.value })} style={inp} placeholder="أمر مباشر / ممارسة" /></L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label="Amendment #"><input value={form.amendmentNumber} onChange={e => setForm({ ...form, amendmentNumber: e.target.value })} style={inp} /></L>
                <L label="In charge"><input value={form.inCharge} onChange={e => setForm({ ...form, inCharge: e.target.value })} style={inp} /></L>
              </div>
              <L label="Remarks"><textarea value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} style={inp} rows={2} /></L>
            </div>
            {!form.subject.trim() && !form.contractNumber.trim() && !form.companyName.trim() && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0 0' }}>Enter at least a contract #, subject or company to save.</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => setIsOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!form.subject.trim() && !form.contractNumber.trim() && !form.companyName.trim()} onClick={save}>{editing ? 'Save' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 400, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>Delete this item?</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '0 0 18px' }}>Any sub-items under it will also be deleted.</p>
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
