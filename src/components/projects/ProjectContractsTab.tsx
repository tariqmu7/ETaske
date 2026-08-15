import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
import { parseAmount } from '../../utils';
import { useDisplayLabel } from '../../lib/displayLabel';
import { useFormat } from '../../lib/format';
import {
  Plus, X, Edit2, Trash2, FileText, ChevronRight, ChevronDown,
  CornerDownRight,
} from 'lucide-react';
import ListControls, { SortDir } from './ListControls';

interface Props { project: Project; user: User; }

/** The English label for a stored contract type — and the display layer's key. */
const typeLabel = (type: ProjectContractType) =>
  PROJECT_CONTRACT_TYPE_OPTIONS.find(o => o.value === type)?.label || type;

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
  const { t } = useTranslation();
  const dl = useDisplayLabel();
  const fmt = useFormat();
  // The tree paints the contract TYPE, whose English label is the locale key.
  const typeText = (type: ProjectContractType) => dl(typeLabel(type));
  const [items, setItems] = useState<ProjectContractItem[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectContractItem | null>(null);
  const [parentFor, setParentFor] = useState<ProjectContractItem | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<ProjectContractItem | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortKey, setSortKey] = useState('created');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    const q = query(collection(db, 'projectContracts'), where('projectId', '==', project.id));
    const unsub = onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectContractItem)));
    }, err => console.error('projectContracts listener:', err));
    return () => unsub();
  }, [project.id]);

  const comparator = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return (a: ProjectContractItem, b: ProjectContractItem) => {
      let r = 0;
      switch (sortKey) {
        case 'contractNumber': r = (a.contractNumber || '').localeCompare(b.contractNumber || ''); break;
        case 'companyName': r = (a.companyName || '').localeCompare(b.companyName || ''); break;
        case 'value': {
          const av = parseAmount(a.valueAfterIncrease) ?? parseAmount(a.contractValue) ?? -Infinity;
          const bv = parseAmount(b.valueAfterIncrease) ?? parseAmount(b.contractValue) ?? -Infinity;
          r = av - bv; break;
        }
        case 'startDate': r = (a.startDate || '').localeCompare(b.startDate || ''); break;
        case 'type': r = a.type.localeCompare(b.type); break;
        default: r = (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
      }
      return r * dir;
    };
  }, [sortKey, sortDir]);

  const { roots, childrenOf } = useMemo(() => {
    const childrenOf: Record<string, ProjectContractItem[]> = {};
    const roots: ProjectContractItem[] = [];
    const ids = new Set(items.map(i => i.id));
    items.forEach(i => {
      if (i.parentId && ids.has(i.parentId)) {
        (childrenOf[i.parentId] = childrenOf[i.parentId] || []).push(i);
      } else {
        roots.push(i);
      }
    });
    roots.sort(comparator);
    Object.values(childrenOf).forEach(arr => arr.sort(comparator));
    return { roots, childrenOf };
  }, [items, comparator]);

  // A type filter breaks the parent→child hierarchy, so when one is active we
  // switch to a flat, sorted list of just the matching items.
  const filteredFlat = useMemo(() => {
    if (typeFilter === 'all') return null;
    return items.filter(i => i.type === typeFilter).sort(comparator);
  }, [items, typeFilter, comparator]);

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

  const Node = ({ item, depth, flat = false }: { item: ProjectContractItem; depth: number; flat?: boolean }) => {
    const kids = flat ? [] : (childrenOf[item.id] || []);
    const isCollapsed = collapsed[item.id];
    return (
      <div>
        <div
          className="card"
          style={{ padding: '12px 14px', marginBottom: 8, marginInlineStart: depth * 22, display: 'flex', gap: 10, alignItems: 'flex-start', borderInlineStart: `3px solid ${typeColor(item.type)}` }}
        >
          <button
            onClick={() => setCollapsed(c => ({ ...c, [item.id]: !c[item.id] }))}
            style={{ background: 'none', border: 'none', cursor: kids.length ? 'pointer' : 'default', color: 'var(--text-muted)', padding: 2, marginTop: 2, visibility: kids.length ? 'visible' : 'hidden' }}
            title={isCollapsed ? t('Expand') : t('Collapse')}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#fff', background: typeColor(item.type), padding: '2px 7px' }}>{typeText(item.type)}</span>
              {item.contractNumber && <span className="ltr-data" style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{item.contractNumber}</span>}
              {item.amendmentNumber && <span className="ltr-data" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.amendmentNumber}</span>}
              {item.status && <span className="badge badge-inprogress">{dl(item.status)}</span>}
            </div>
            {item.subject && <div className={fmt.bidiFor(item.subject)} style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 600, lineHeight: 1.4 }}>{item.subject}</div>}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              {item.companyName && <span>🏢 {item.companyName}</span>}
              {parseAmount(item.contractValue) != null && <span>💰 <span className={fmt.bidiFor(fmt.money(item.contractValue, item.currency))}>{fmt.money(item.contractValue, item.currency)}</span></span>}
              {parseAmount(item.valueAfterIncrease) != null && <span style={{ color: '#16a34a', fontWeight: 600 }}>⬆ <span className={fmt.bidiFor(fmt.money(item.valueAfterIncrease, item.currency))}>{fmt.money(item.valueAfterIncrease, item.currency)}</span></span>}
              {(item.startDate || item.endDate) && <span>📅 <span className="ltr-data">{[item.startDate, item.endDate].filter(Boolean).map(d => fmt.date(d)).join(' → ')}</span></span>}
              {item.contractingMethod && <span>📝 {item.contractingMethod}</span>}
              {item.inCharge && <span>👤 {item.inCharge}</span>}
            </div>
            {item.remarks && <div className={fmt.bidiFor(item.remarks)} style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>{item.remarks}</div>}
          </div>

          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            <button className="btn btn-ghost btn-icon btn-sm" title={t('Add sub-item')} onClick={() => openCreate(item)}><CornerDownRight className="w-4 h-4" /></button>
            <button className="btn btn-ghost btn-icon btn-sm" title={t('Edit')} onClick={() => openEdit(item)}><Edit2 className="w-4 h-4" /></button>
            <button className="btn btn-ghost btn-icon btn-sm" title={t('Delete')} onClick={() => setDeleteTarget(item)}><Trash2 className="w-4 h-4" style={{ color: '#dc2626' }} /></button>
          </div>
        </div>
        {!isCollapsed && kids.map(k => <Node key={k.id} item={k} depth={depth + 1} />)}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{t('Contracts')}</h3>
        <button className="btn btn-primary btn-sm" onClick={() => openCreate(null)}><Plus className="w-4 h-4" /> {t('Add contract')}</button>
      </div>

      {Object.keys(valueByCurrency).length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          {Object.entries(valueByCurrency).map(([cur, total]) => (
            <div key={cur} className="card" style={{ padding: '10px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('Total value · {{currency}}', { currency: cur })}</div>
              <div className="ltr-data" style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>{fmt.number(total)}</div>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><FileText className="w-8 h-8" /></div>
          <div className="empty-state-title">{t('No contracts yet')}</div>
          <div className="empty-state-sub">{t('Add a contract, then attach amendments, agreements, work authorizations or sub-contracts under it.')}</div>
        </div>
      ) : (
        <>
          <ListControls
            filters={[
              { key: 'type', label: t('Type'), value: typeFilter, onChange: setTypeFilter, options: [
                { value: 'all', label: t('All types') },
                // The machine value ('sub_contract') is what gets stored and
                // filtered on; only its English label is translated.
                ...PROJECT_CONTRACT_TYPE_OPTIONS.map(o => ({ value: o.value, label: dl(o.label) })),
              ] },
            ]}
            sortOptions={[
              { value: 'created', label: t('Date added') },
              { value: 'contractNumber', label: t('Contract #') },
              { value: 'value', label: t('Value') },
              { value: 'companyName', label: t('Company') },
              { value: 'startDate', label: t('Start date') },
              { value: 'type', label: t('Type') },
            ]}
            sortValue={sortKey}
            onSortChange={setSortKey}
            sortDir={sortDir}
            onSortDirToggle={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            trailing={filteredFlat ? t('{{shown}} of {{total}}', { shown: filteredFlat.length, total: items.length }) : undefined}
          />
          {filteredFlat ? (
            filteredFlat.length === 0
              ? <div className="empty-state"><div className="empty-state-title">{t('No items match')}</div></div>
              : <div>{filteredFlat.map(r => <Node key={r.id} item={r} depth={0} flat />)}</div>
          ) : (
            <div>{roots.map(r => <Node key={r.id} item={r} depth={0} />)}</div>
          )}
        </>
      )}

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal" style={{ maxWidth: 640, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                {editing
                  ? t('Edit item')
                  : parentFor
                    ? t('Add under {{parent}}', { parent: parentFor.contractNumber || typeText(parentFor.type) })
                    : t('Add contract')}
              </h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setIsOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <div style={{ display: 'grid', gap: 12, maxHeight: '65vh', overflowY: 'auto', paddingInlineEnd: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label={t('Type')}><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as ProjectContractType })} style={inp}>{PROJECT_CONTRACT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{dl(o.label)}</option>)}</select></L>
                <L label={t('Contract #')}><input value={form.contractNumber} onChange={e => setForm({ ...form, contractNumber: e.target.value })} style={inp} /></L>
              </div>
              <L label={t('Subject')}><textarea value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} style={inp} rows={2} /></L>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label={t('Company')}><input value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} style={inp} /></L>
                <L label={t('Department')}><input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} style={inp} /></L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <L label={t('Contract value')}><input value={form.contractValue} inputMode="decimal" onChange={e => setForm({ ...form, contractValue: e.target.value })} style={inp} placeholder="0" /></L>
                <L label={t('Currency')}>
                  <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} style={inp}>
                    {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label={t('SR date')}><input type="date" value={form.srDate} onChange={e => setForm({ ...form, srDate: e.target.value })} style={inp} /></L>
                <L label={t('SR value')}><input value={form.srValue} inputMode="decimal" onChange={e => setForm({ ...form, srValue: e.target.value })} style={inp} placeholder="0" /></L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label={t('LOA date')}><input type="date" value={form.loaDate} onChange={e => setForm({ ...form, loaDate: e.target.value })} style={inp} /></L>
                <L label={t('Value after increase')}><input value={form.valueAfterIncrease} inputMode="decimal" onChange={e => setForm({ ...form, valueAfterIncrease: e.target.value })} style={inp} placeholder="0" /></L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label={t('Start date')}><input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} style={inp} /></L>
                <L label={t('End date')}><input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} style={inp} /></L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label={t('Status')}><input value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={inp} placeholder={t('Active / Expired…')} /></L>
                {/* ⚠ This placeholder is deliberately NOT a locale key: it is
                    already Arabic in the English UI (the two Egyptian
                    procurement routes), so a key would make ar identical to en. */}
                <L label={t('Contracting method')}><input value={form.contractingMethod} onChange={e => setForm({ ...form, contractingMethod: e.target.value })} style={inp} placeholder="أمر مباشر / ممارسة" /></L>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <L label={t('Amendment #')}><input value={form.amendmentNumber} onChange={e => setForm({ ...form, amendmentNumber: e.target.value })} style={inp} /></L>
                <L label={t('In charge')}><input value={form.inCharge} onChange={e => setForm({ ...form, inCharge: e.target.value })} style={inp} /></L>
              </div>
              <L label={t('Remarks')}><textarea value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} style={inp} rows={2} /></L>
            </div>
            {!form.subject.trim() && !form.contractNumber.trim() && !form.companyName.trim() && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0 0' }}>{t('Enter at least a contract #, subject or company to save.')}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => setIsOpen(false)}>{t('Cancel')}</button>
              <button className="btn btn-primary" disabled={!form.subject.trim() && !form.contractNumber.trim() && !form.companyName.trim()} onClick={save}>{editing ? t('Save') : t('Add')}</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 400, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{t('Delete this item?')}</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '0 0 18px' }}>{t('Any sub-items under it will also be deleted.')}</p>
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

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit' };
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 }}>{label}</span>{children}</label>;
}
