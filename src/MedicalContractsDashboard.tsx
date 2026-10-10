import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot } from 'firebase/firestore';
import { AlertTriangle, ChevronRight, MapPin, Search, Stethoscope, X, ExternalLink } from 'lucide-react';
import { db } from './lib/firebase';
import { buildGroups, UNGROUPED } from './lib/grouping';
import GroupGrid, { type GroupCard, type GroupCardStat } from './components/GroupGrid';
import {
  MEDICAL_STATUSES, STATUS_BADGE, compareContracts, countStatuses, daysLeft, filterContracts,
  mapLink, statusOf, tally, todayISO, type MedicalContract, type MedicalStatus,
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

/**
 * Medical contracts (queue M4a) — the hospitals, pharmacies, labs and centres
 * EPROM staff may use, grouped governorate → area. Read-only in this pass:
 * editing (area naming, clearing "Needs check", usage counts) is M4b.
 * Gated by `canViewMedical` in App/TopNav/More/Home/palette, and by the rules.
 */
export default function MedicalContractsDashboard(_props: Props) {
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
  const [open, setOpen] = useState<MedicalContract | null>(null);
  const today = useMemo(() => todayISO(), []);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'medicalContracts'),
      s => { setList(s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))); setError(null); },
      err => { console.warn('Medical contracts listener:', err.code); setError(err.code || 'error'); setList([]); });
    return () => unsub();
  }, []);

  // Escape closes the contract window.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const all = list || [];
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
    <button key={c.id} type="button" className="card" onClick={() => setOpen(c)} data-medical-row={c.id}
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

      {open && <ContractWindow c={open} statusBadge={statusBadge} endLine={endLine} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ContractWindow({ c, statusBadge, endLine, onClose }: {
  c: MedicalContract;
  statusBadge: (c: MedicalContract) => React.ReactNode;
  endLine: (c: MedicalContract) => string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const F = useFormat();
  const map = mapLink(c);
  const field = (label: string, value: React.ReactNode, attr: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 30%) 1fr', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }} data-medical-field={attr}>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: 'var(--text-primary)', minWidth: 0 }}>{value || <span style={{ color: 'var(--text-muted)' }}>—</span>}</div>
    </div>
  );
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={c.provider} onClick={e => e.stopPropagation()} data-medical-detail={c.id} style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}><span className="ltr-data">{c.contractNo}</span> · {c.type}</div>
            <h2 style={{ fontSize: 19, fontWeight: 800, margin: '4px 0 0', color: 'var(--text-primary)' }} className={F.bidiFor(c.provider)}>{c.provider}</h2>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" aria-label={t('Close')} onClick={onClose} data-medical="close"><X size={18} /></button>
        </div>

        {c.needsCheck && (
          <div style={{ display: 'flex', gap: 8, padding: '10px 12px', background: 'var(--surface-warn-strong)', color: 'var(--surface-warn-text)', fontSize: 13, marginBottom: 12, lineHeight: 1.5 }} data-medical="check-note">
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700 }}>{t('Needs check: the sheet and the dates disagree.')}</div>
              {(c.importNotes || []).length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
                  {c.importNotes!.map((n, i) => <li key={i} className={F.bidiFor(n)}>{n}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}

        {field(t('Status'), <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{statusBadge(c)}<span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{endLine(c)}</span></span>, 'status')}
        {field(t('The sheet says'), c.sheetStatusAr, 'sheet')}
        {field(t('Governorate'), c.governorate, 'governorate')}
        {field(t('Area'), c.area || t('Area not named yet'), 'area')}
        {field(t('Address'), c.address, 'address')}
        {field(t('Start date'), c.startDate ? <span className={F.bidi(DATE_MEDIUM)}>{F.date(c.startDate, DATE_MEDIUM)}</span> : '', 'start')}
        {field(t('End date'), c.autoRenew ? t('Renews automatically') : c.endDate ? <span className={F.bidi(DATE_MEDIUM)}>{F.date(c.endDate, DATE_MEDIUM)}</span> : '', 'end')}
        {map && (
          <a href={map} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ marginTop: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }} data-medical="map">
            <MapPin size={14} /> {t('Open on the map')} <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}
