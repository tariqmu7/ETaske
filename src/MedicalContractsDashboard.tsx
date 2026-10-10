import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { AlertTriangle, Check, ChevronRight, MapPin, Pencil, Search, Stethoscope, X, ExternalLink } from 'lucide-react';
import { db } from './lib/firebase';
import { buildGroups, UNGROUPED } from './lib/grouping';
import GroupGrid, { type GroupCard, type GroupCardStat } from './components/GroupGrid';
import ComboBox from './components/ComboBox';
import { canEditMedical } from './lib/medicalAccess';
import {
  CONTRACT_STATES, MEDICAL_STATUSES, STATUS_BADGE, areasIn, compareContracts, contractPatch, countStatuses, daysLeft,
  draftOf, draftProblems, filterContracts, mapLink, statusOf, tally, todayISO,
  type ContractDraft, type ContractState, type MedicalContract, type MedicalStatus,
} from './lib/medicalContracts';
import { useFormat, DATE_MEDIUM } from './lib/format';
import { AppUser } from './types';
import type { AppView } from './App';

interface Props {
  appUser: AppUser;
  onNavigate: (v: AppView) => void;
}

/** Display key per stored/derived status — "Active" alone reads «نشط», a contract is «ساري». */
const STATUS_LABEL: Record<MedicalStatus, string> = {
  'Expired': 'Expired',
  'Ending soon': 'Ending soon',
  'Renewing': 'Being renewed',
  'Not signed': 'Not signed',
  'Active': 'In force',
  'Auto-renew': 'Renews automatically',
  'No end date': 'No end date',
};

/** Display key per state an editor can pick. */
const STATE_LABEL: Record<ContractState, string> = {
  'Signed': 'Signed — the dates decide',
  'Renewing': 'Being renewed',
  'Not signed': 'Not signed',
};

/**
 * Medical contracts (queue M4a) — the hospitals, pharmacies, labs and centres
 * EPROM staff may use, grouped governorate → area. People with 'edit' access
 * (`canEditMedical`) get an Edit form and "Mark as checked" in the contract
 * window (M4b); everyone else reads. Usage counts are a later task.
 * Gated by `canViewMedical` in App/TopNav/More/Home/palette, and by the rules.
 */
export default function MedicalContractsDashboard({ appUser }: Props) {
  const { t } = useTranslation();
  const F = useFormat();
  const [list, setList] = useState<MedicalContract[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [gov, setGov] = useState('all');
  const [area, setArea] = useState<string | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  // The id, not the object: after a save the window must show the new snapshot.
  const [openId, setOpenId] = useState<string | null>(null);
  const canEdit = canEditMedical(appUser);
  const today = useMemo(() => todayISO(), []);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'medicalContracts'),
      s => { setList(s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))); setError(null); },
      err => { console.warn('Medical contracts listener:', err.code); setError(err.code || 'error'); setList([]); });
    return () => unsub();
  }, []);

  const all = list || [];
  const open = openId ? all.find(c => c.id === openId) || null : null;
  const closeWindow = useCallback(() => setOpenId(null), []);
  // Everything but the governorate: the governorate is where you are, not a filter on the cards.
  const filtered = useMemo(
    () => filterContracts(all, { q, type, status, needsCheck }, today).sort(compareContracts(today)),
    [all, q, type, status, needsCheck, today],
  );
  const counts = useMemo(() => countStatuses(all, today), [all, today]);
  const types = useMemo(() => tally(all, c => c.type), [all]);
  const govs = useMemo(() => tally(all, c => c.governorate), [all]);
  const searching = q.trim() !== '';
  const inGov = useMemo(() => (gov === 'all' ? filtered : filtered.filter(c => c.governorate === gov)), [filtered, gov]);
  const inArea = useMemo(() => (area == null ? [] : inGov.filter(c => (c.area || '').trim() === (area === UNGROUPED ? '' : area))), [inGov, area]);
  const anyFilter = searching || type !== 'all' || status !== 'all' || needsCheck;

  const unit = (n: number) => (n === 1 ? t('contract') : t('contracts'));
  const statsFor = (items: MedicalContract[]): GroupCardStat[] => {
    const c = countStatuses(items, today);
    return [
      { label: t('expired'), value: c.byStatus['Expired'], tone: 'warn' },
      { label: t('ending soon'), value: c.byStatus['Ending soon'], tone: 'warn' },
      { label: t('to check'), value: c.needsCheck, tone: 'info' },
    ];
  };

  const govCards: GroupCard[] = useMemo(() => {
    const order = govs.map(([g]) => g);
    return buildGroups(filtered, c => c.governorate, { order }).map(g => ({
      key: g.key,
      title: g.key === UNGROUPED ? t('No governorate') : g.value,
      subtitle: t('Areas: {{count}}', { count: new Set(g.items.map(c => (c.area || '').trim())).size }),
      icon: MapPin,
      count: g.items.length,
      countLabel: unit(g.items.length),
      stats: statsFor(g.items),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, govs, t, today]);

  const areaCards: GroupCard[] = useMemo(() => {
    if (gov === 'all') return [];
    const order = tally(inGov, c => c.area).map(([a]) => a);
    return buildGroups(inGov, c => c.area, { order }).map(g => ({
      key: g.key,
      title: g.key === UNGROUPED ? t('Area not named yet') : g.value,
      subtitle: tally(g.items, c => c.type).slice(0, 2).map(([ty]) => ty).join('، '),
      icon: MapPin,
      count: g.items.length,
      countLabel: unit(g.items.length),
      stats: statsFor(g.items),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inGov, gov, t, today]);

  const pickGov = (g: string) => { setGov(g); setArea(null); };
  const resetFilters = () => { setQ(''); setType('all'); setStatus('all'); setNeedsCheck(false); };

  const kpis: { key: string; label: string; value: number; active: boolean; onClick: () => void; tone?: string }[] = [
    { key: 'all', label: t('All contracts'), value: counts.total, active: !anyFilter, onClick: resetFilters },
    { key: 'Active', label: t(STATUS_LABEL['Active']), value: counts.byStatus['Active'] + counts.byStatus['Auto-renew'], active: status === 'Active', onClick: () => { setNeedsCheck(false); setStatus(status === 'Active' ? 'all' : 'Active'); } },
    { key: 'Ending soon', label: t('Ending soon'), value: counts.byStatus['Ending soon'], active: status === 'Ending soon', onClick: () => { setNeedsCheck(false); setStatus(status === 'Ending soon' ? 'all' : 'Ending soon'); }, tone: 'var(--surface-warn-text)' },
    { key: 'Expired', label: t('Expired'), value: counts.byStatus['Expired'], active: status === 'Expired', onClick: () => { setNeedsCheck(false); setStatus(status === 'Expired' ? 'all' : 'Expired'); }, tone: '#b91c1c' },
    { key: 'check', label: t('Needs check'), value: counts.needsCheck, active: needsCheck, onClick: () => { setStatus('all'); setNeedsCheck(!needsCheck); }, tone: 'var(--blue-400)' },
  ];

  const statusBadge = (c: MedicalContract) => {
    const s = statusOf(c, today);
    return <span className={`badge ${STATUS_BADGE[s]}`} data-medical-status={s}>{t(STATUS_LABEL[s])}</span>;
  };

  const endLine = (c: MedicalContract) => {
    if (c.autoRenew) return t('Renews automatically');
    const left = daysLeft(c, today);
    if (!c.endDate || left == null) return t('No end date');
    const when = F.date(c.endDate, DATE_MEDIUM);
    if (left < 0) return t('Ended {{date}}', { date: when });
    if (left === 0) return t('Ends today');
    return left <= 60
      ? t('Ends {{date}} · days remaining: {{days}}', { date: when, days: left })
      : t('Ends {{date}}', { date: when });
  };

  const row = (c: MedicalContract, showPlace: boolean) => (
    <button key={c.id} type="button" className="card" onClick={() => setOpenId(c.id)} data-medical-row={c.id}
      style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', textAlign: 'start', width: '100%', cursor: 'pointer', fontFamily: 'inherit' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)' }} className={F.bidiFor(c.provider)}>{c.provider}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span>{c.type}</span>
          <span aria-hidden>·</span>
          <span className="ltr-data">{c.contractNo}</span>
          {showPlace && <><span aria-hidden>·</span><span>{c.governorate}{c.area ? ` › ${c.area}` : ''}</span></>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4 }} data-medical-end>{endLine(c)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
        {statusBadge(c)}
        {c.needsCheck && <span className="badge badge-review" data-medical-check>{t('Needs check')}</span>}
      </div>
    </button>
  );

  const crumb = (label: string, onClick?: () => void, attr?: string) => onClick
    ? <button type="button" className="btn btn-ghost btn-sm" onClick={onClick} data-medical-crumb={attr} style={{ padding: '4px 6px' }}>{label}</button>
    : <span style={{ fontWeight: 700, color: 'var(--text-primary)', padding: '4px 6px' }}>{label}</span>;

  const noneMatch = (
    <div className="card" style={{ padding: 18, fontSize: 13.5, color: 'var(--text-muted)' }} data-medical="none">
      {t('No contract matches these filters.')}{' '}
      {anyFilter && <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>{t('Clear filters')}</button>}
    </div>
  );

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 16px' }} data-testid="medical-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Stethoscope className="w-6 h-6" style={{ color: 'var(--accent)' }} />
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{t('Medical contracts')}</h1>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.55 }}>
        {t('The hospitals, pharmacies, labs and centres our staff may use, by governorate and area. Status is worked out from the end date as of today.')}
      </p>

      {error ? (
        <div className="card" style={{ padding: 18, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }} data-medical="error">
          {error === 'permission-denied'
            ? t('The contracts could not be opened: access is not switched on for you yet, or the new security rules are not live yet.')
            : t('The contracts could not be loaded. Check the connection and reload the page.')}
        </div>
      ) : list == null ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {[0, 1, 2].map(i => <div key={i} className="card skeleton" style={{ height: 80 }} />)}
        </div>
      ) : all.length === 0 ? (
        <div className="card" style={{ padding: 18, fontSize: 13.5, color: 'var(--text-muted)' }} data-medical="empty">{t('No medical contracts yet.')}</div>
      ) : (
        <>
          {/* KPI strip — each one is also a one-click filter. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
            {kpis.map(k => (
              <button key={k.key} type="button" className="card" onClick={k.onClick} data-medical-kpi={k.key} aria-pressed={k.active}
                style={{ padding: '10px 12px', textAlign: 'start', cursor: 'pointer', fontFamily: 'inherit',
                  outline: k.active ? '2px solid var(--accent)' : 'none', outlineOffset: -2 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: k.value > 0 && k.tone ? k.tone : 'var(--text-primary)' }}>{F.number(k.value)}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{k.label}</div>
              </button>
            ))}
          </div>

          <div className="card" style={{ padding: 12, display: 'grid', gap: 10, marginBottom: 14 }}>
            <div style={{ position: 'relative' }}>
              <Search size={17} style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input ref={inputRef} className="input" value={q} onChange={e => setQ(e.target.value)} data-medical="search"
                placeholder={t('Search a provider, contract number, area or address')}
                style={{ paddingInlineStart: 38, paddingInlineEnd: 36, width: '100%', fontSize: 15 }} />
              {q && (
                <button type="button" className="btn btn-ghost btn-icon" aria-label={t('Clear')} onClick={() => setQ('')}
                  style={{ position: 'absolute', insetInlineEnd: 4, top: '50%', transform: 'translateY(-50%)' }}>
                  <X size={15} />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select className="input" style={{ flex: '1 1 170px', maxWidth: 300 }} value={gov} onChange={e => pickGov(e.target.value)} data-medical="gov-filter">
                <option value="all">{t('All governorates')}</option>
                {govs.map(([g, n]) => <option key={g} value={g}>{g} ({n})</option>)}
              </select>
              <select className="input" style={{ flex: '1 1 170px', maxWidth: 300 }} value={type} onChange={e => setType(e.target.value)} data-medical="type-filter">
                <option value="all">{t('All types')}</option>
                {types.map(([ty, n]) => <option key={ty} value={ty}>{ty} ({n})</option>)}
              </select>
              <select className="input" style={{ flex: '1 1 170px', maxWidth: 300 }} value={status} onChange={e => setStatus(e.target.value)} data-medical="status-filter">
                <option value="all">{t('All statuses')}</option>
                {MEDICAL_STATUSES.filter(s => counts.byStatus[s] > 0).map(s => <option key={s} value={s}>{t(STATUS_LABEL[s])} ({counts.byStatus[s]})</option>)}
              </select>
            </div>
          </div>

          {/* Where you are: All governorates › Alexandria › Smouha */}
          {!searching && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, fontSize: 13, marginBottom: 10, color: 'var(--text-muted)' }} data-medical="crumbs">
              {crumb(t('All governorates'), gov !== 'all' ? () => pickGov('all') : undefined, 'all')}
              {gov !== 'all' && <>
                <ChevronRight size={14} />
                {crumb(gov, area != null ? () => setArea(null) : undefined, 'gov')}
              </>}
              {gov !== 'all' && area != null && <>
                <ChevronRight size={14} />
                {crumb(area === UNGROUPED ? t('Area not named yet') : area)}
              </>}
            </div>
          )}

          {searching ? (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 10 }} data-medical="count">
                {t('Found: {{count}}', { count: inGov.length })}
              </div>
              {inGov.length === 0 ? noneMatch : <div style={{ display: 'grid', gap: 8 }}>{inGov.map(c => row(c, true))}</div>}
            </>
          ) : gov === 'all' ? (
            <GroupGrid cards={govCards} onSelect={k => pickGov(k)} empty={noneMatch} />
          ) : area == null ? (
            <GroupGrid cards={areaCards} onSelect={k => setArea(k)} empty={noneMatch} />
          ) : inArea.length === 0 ? noneMatch : (
            <div style={{ display: 'grid', gap: 8 }}>{inArea.map(c => row(c, false))}</div>
          )}
        </>
      )}

      {open && <ContractWindow c={open} all={all} appUser={appUser} canEdit={canEdit} statusBadge={statusBadge} endLine={endLine} onClose={closeWindow} />}
    </div>
  );
}

function ContractWindow({ c, all, appUser, canEdit, statusBadge, endLine, onClose }: {
  c: MedicalContract;
  all: MedicalContract[];
  appUser: AppUser;
  canEdit: boolean;
  statusBadge: (c: MedicalContract) => React.ReactNode;
  endLine: (c: MedicalContract) => string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const F = useFormat();
  const map = mapLink(c);
  const [draft, setDraft] = useState<ContractDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const editing = draft != null;
  const me = appUser.displayName || appUser.email || '';

  // Escape closes the window — but not while the form is open (it would throw
  // the typing away), and not when a picker inside the form used the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !editing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

  const types = useMemo(() => tally(all, x => x.type).map(([v]) => v), [all]);
  const govs = useMemo(() => tally(all, x => x.governorate).map(([v]) => v), [all]);
  const areas = useMemo(() => (draft ? areasIn(all, draft.governorate) : []), [all, draft]);

  const set = <K extends keyof ContractDraft>(k: K, v: ContractDraft[K]) => {
    setDraft(d => (d ? { ...d, [k]: v } : d));
    setProblems([]);
    setSaveFailed(false);
  };
  const startEdit = () => { setDraft(draftOf(c)); setProblems([]); setSaveFailed(false); };
  const cancelEdit = () => { setDraft(null); setProblems([]); setSaveFailed(false); };
  const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: appUser.id, updatedByName: me });

  const write = async (data: Record<string, unknown>) => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateDoc(doc(db, 'medicalContracts', c.id), data);
      return true;
    } catch (err) {
      console.warn('Medical contract save:', (err as any)?.code || err);
      setSaveFailed(true);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const p = draftProblems(draft);
    if (p.length) { setProblems(p); return; }
    const patch = contractPatch(c, draft);
    if (Object.keys(patch).length === 0) { setDraft(null); return; }
    const cleared = patch.needsCheck === false ? { checkedAt: serverTimestamp(), checkedByName: me } : {};
    if (await write({ ...patch, ...cleared, ...stamp() })) setDraft(null);
  };

  const markChecked = () => write({ needsCheck: false, checkedAt: serverTimestamp(), checkedByName: me, ...stamp() });

  const field = (label: string, value: React.ReactNode, attr: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 30%) 1fr', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', alignItems: editing ? 'center' : undefined }} data-medical-field={attr}>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: 'var(--text-primary)', minWidth: 0 }}>{value || <span style={{ color: 'var(--text-muted)' }}>—</span>}</div>
    </div>
  );
  const textInput = (k: 'provider' | 'address') => (
    <input className="input" style={{ width: '100%' }} dir="auto" value={draft![k]} onChange={e => set(k, e.target.value)} data-edit={k} />
  );
  const dateInput = (k: 'startDate' | 'endDate', disabled = false) => (
    <input type="date" className="input" style={{ width: '100%', maxWidth: 220 }} value={draft![k]} disabled={disabled}
      onChange={e => set(k, e.target.value)} data-edit={k} />
  );
  const tick = (k: 'autoRenew' | 'needsCheck', label: string) => (
    <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={draft![k]} onChange={e => set(k, e.target.checked)} data-edit={k} />
      {label}
    </label>
  );

  return (
    <div className="modal-overlay" onClick={editing ? undefined : onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={c.provider} onClick={e => e.stopPropagation()} data-medical-detail={c.id} style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}><span className="ltr-data">{c.contractNo}</span> · {c.type}</div>
            <h2 style={{ fontSize: 19, fontWeight: 800, margin: '4px 0 0', color: 'var(--text-primary)' }} className={F.bidiFor(c.provider)}>{c.provider}</h2>
          </div>
          {canEdit && !editing && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={startEdit} data-medical="edit" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Pencil size={14} /> {t('Edit')}
            </button>
          )}
          {!editing && <button type="button" className="btn btn-ghost btn-icon" aria-label={t('Close')} onClick={onClose} data-medical="close"><X size={18} /></button>}
        </div>

        {c.needsCheck && !editing && (
          <div style={{ display: 'flex', gap: 8, padding: '10px 12px', background: 'var(--surface-warn-strong)', color: 'var(--surface-warn-text)', fontSize: 13, marginBottom: 12, lineHeight: 1.5 }} data-medical="check-note">
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{t('Needs check: the sheet and the dates disagree.')}</div>
              {(c.importNotes || []).length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
                  {c.importNotes!.map((n, i) => <li key={i} className={F.bidiFor(n)}>{n}</li>)}
                </ul>
              )}
              {canEdit && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={markChecked} disabled={saving} data-medical="mark-checked"
                  style={{ marginTop: 8, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <Check size={14} /> {t('Mark as checked')}
                </button>
              )}
            </div>
          </div>
        )}

        {editing ? (
          <div data-medical="form">
            {field(t('Provider'), textInput('provider'), 'provider')}
            {field(t('Type'), <div data-edit="type"><ComboBox value={draft.type} onChange={v => set('type', v)} options={types} /></div>, 'type')}
            {field(t('Contract state'), (
              <select className="input" style={{ width: '100%' }} value={draft.state} onChange={e => set('state', e.target.value as ContractState)} data-edit="state">
                {CONTRACT_STATES.map(s => <option key={s} value={s}>{t(STATE_LABEL[s])}</option>)}
              </select>
            ), 'state')}
            {field(t('Governorate'), <div data-edit="governorate"><ComboBox value={draft.governorate} onChange={v => set('governorate', v)} options={govs} /></div>, 'governorate')}
            {field(t('Area'), (
              <div data-edit="area">
                <ComboBox value={draft.area} onChange={v => set('area', v)} options={areas} placeholder={t('Type a new area or pick one')} />
              </div>
            ), 'area')}
            {field(t('Address'), textInput('address'), 'address')}
            {field(t('Start date'), dateInput('startDate'), 'start')}
            {field(t('End date'), (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {dateInput('endDate', draft.autoRenew)}
                {tick('autoRenew', t('Renews automatically'))}
              </div>
            ), 'end')}
            {field(t('Needs check'), tick('needsCheck', t('Someone must confirm this contract')), 'needsCheck')}
          </div>
        ) : (
          <>
            {field(t('Status'), <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{statusBadge(c)}<span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{endLine(c)}</span></span>, 'status')}
            {field(t('The sheet says'), c.sheetStatusAr, 'sheet')}
            {field(t('Governorate'), c.governorate, 'governorate')}
            {field(t('Area'), c.area || t('Area not named yet'), 'area')}
            {field(t('Address'), c.address, 'address')}
            {field(t('Start date'), c.startDate ? <span className={F.bidi(DATE_MEDIUM)}>{F.date(c.startDate, DATE_MEDIUM)}</span> : '', 'start')}
            {field(t('End date'), c.autoRenew ? t('Renews automatically') : c.endDate ? <span className={F.bidi(DATE_MEDIUM)}>{F.date(c.endDate, DATE_MEDIUM)}</span> : '', 'end')}
          </>
        )}

        {(problems.length > 0 || saveFailed) && (
          <div role="alert" style={{ marginTop: 12, padding: '10px 12px', border: '1px solid #b91c1c', color: '#b91c1c', fontSize: 13, lineHeight: 1.5 }} data-medical="problems">
            {saveFailed ? t('Could not save the change. Check your connection and try again.') : problems.map(p => <div key={p}>{t(p)}</div>)}
          </div>
        )}

        {editing ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" onClick={cancelEdit} disabled={saving} data-medical="cancel">{t('Cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving} data-medical="save">{saving ? t('Saving…') : t('Save changes')}</button>
          </div>
        ) : (
          <>
            {map && (
              <a href={map} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ marginTop: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }} data-medical="map">
                <MapPin size={14} /> {t('Open on the map')} <ExternalLink size={12} />
              </a>
            )}
            {(c.updatedByName || (c.checkedByName && !c.needsCheck)) && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', display: 'grid', gap: 2 }} data-medical="history">
                {c.updatedByName && <div>{t('Last edited by {{name}}', { name: c.updatedByName })}</div>}
                {c.checkedByName && !c.needsCheck && <div>{t('Checked by {{name}}', { name: c.checkedByName })}</div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
