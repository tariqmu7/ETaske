import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Gauge } from 'lucide-react';
import { useBdControl } from './hooks/useBdControl';
import { AGIBA_CLIENT, BD_TABS, dataDate, hasData, todayISO, type BdTab, type Benchmark, type IssueTarget } from './lib/bdControl';
import type { AgibaFocus } from './components/bdcontrol/AgibaSections';
import { useFormat, DATE_MEDIUM, DATETIME_SHORT } from './lib/format';
import QuestionBoard from './components/bdcontrol/QuestionBoard';
import ContractsTab, { type ContractsState } from './components/bdcontrol/ContractsTab';
import ClientPage from './components/bdcontrol/ClientPage';
import PricingTab from './components/bdcontrol/PricingTab';
import SuppliersTab, { type SuppliersState } from './components/bdcontrol/SuppliersTab';
import DataQualityTab, { type QualityState } from './components/bdcontrol/DataQualityTab';
import { BdEditProvider } from './components/bdcontrol/EditRecord';
import { canEditBdControl } from './lib/bdControlAccess';
import { subscribeVisibleBids } from './lib/bidReads';
import type { ClosedBid } from './lib/analysisCenter';
import { AppUser } from './types';
import type { AppView } from './App';

interface Props {
  appUser: AppUser;
  onNavigate: (v: AppView) => void;
}

const TAB_LABEL: Record<BdTab, string> = {
  overview: 'Overview', contracts: 'Contracts', pricing: 'Pricing', suppliers: 'Suppliers', quality: 'Data quality',
};

/**
 * Analysis center (renamed from "BD control" in queue A1; view id stays
 * `bd-control` so links keep working). The Overview is the CEO question board
 * (components/bdcontrol/QuestionBoard.tsx): one chart per question, grey
 * "data needed" boxes for the rest, under a headline strip of the top figures.
 * The earlier KPI tiles and charts 3–12 were removed in queue A4b: each one now
 * has a question card (or a browse tab) of its own. AGIBA's site contracts and
 * service orders sit on the AGIBA client page (queue A5), not in Suppliers.
 *
 * BD control (queue E5a) — the CEO page over every client contract, supplier
 * contract and AGIBA site contract loaded from BD's Excel files. Every figure
 * is worked out from the rows as of today (lib/bdControl.ts); nothing on the
 * page is typed in. The data-date strip, then the browse tabs (E6a): Contracts +
 * the client page, Pricing, Suppliers, Data quality. Board rows and every data
 * issue open the matching tab. Managers and admin can correct a record in place
 * (E6b, components/bdcontrol/EditRecord.tsx); each change keeps its Excel value and a log.
 * Gated by `canViewBdControl` in App/TopNav/More/Home/palette, and by the rules.
 */
export default function BdControlDashboard({ appUser }: Props) {
  const { t } = useTranslation();
  const F = useFormat();
  const { data, loading, error } = useBdControl();
  const today = useMemo(() => todayISO(), []);
  const dd = useMemo(() => dataDate(data, today), [data, today]);
  const who = useMemo(() => ({ uid: appUser.id, name: appUser.displayName || appUser.email }), [appUser.id, appUser.displayName, appUser.email]);

  // Where the reader is. Each tab keeps its search and filters while you move between tabs.
  const [tab, setTab] = useState<BdTab>('overview');
  const [client, setClient] = useState<string | null>(null);
  // The AGIBA site contract / SO a data issue opened the AGIBA page on (queue A5).
  const [focus, setFocus] = useState<AgibaFocus | null>(null);
  const [contracts, setContracts] = useState<ContractsState>({ filter: 'all', q: '' });
  const [bench, setBench] = useState<Benchmark>('anopc');
  // The app's own bid register, for the pipeline question (G2, queue A7b) — only the bids this person may see.
  const [bids, setBids] = useState<ClosedBid[] | null | 'error'>(null);
  useEffect(() => subscribeVisibleBids({ id: appUser.id, role: appUser.role }, setBids, () => setBids('error')), [appUser.id, appUser.role]);
  const [sup, setSup] = useState<SuppliersState>({ filter: 'live', q: '' });
  const [quality, setQuality] = useState<QualityState>({ sheet: '', q: '' });
  const top = useRef<HTMLDivElement>(null);
  const toTop = () => requestAnimationFrame(() => top.current?.scrollIntoView?.({ block: 'start' }));
  const openTab = (x: BdTab) => { setTab(x); setClient(null); setFocus(null); toTop(); };
  const openClient = (code: string, f: AgibaFocus | null = null) => { setTab('contracts'); setClient(code); setFocus(f); toTop(); };
  const openContracts = (filter: ContractsState['filter']) => { setContracts({ filter, q: '' }); openTab('contracts'); };
  const openSuppliers = (p: Partial<SuppliersState>) => { setSup(s => ({ ...s, filter: 'all', q: '', ...p })); openTab('suppliers'); };
  const openTarget = (tg: Exclude<IssueTarget, null>) => (tg.kind === 'client' ? openClient(tg.code)
    : tg.kind === 'supplier' ? openSuppliers({ q: tg.query })
    : openClient(AGIBA_CLIENT, { kind: tg.kind, query: tg.query }));

  const warn = 'var(--surface-warn-text)';

  return (
    <div ref={top} className="bdc" style={{ maxWidth: 'var(--page-max)', margin: '0 auto', padding: '24px 16px', scrollMarginTop: 72 }} data-testid="bd-control-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Gauge className="w-6 h-6" style={{ color: 'var(--accent)' }} />
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{t('Analysis center')}</h1>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.55 }}>
        {t('The CEO’s questions on our projects, each answered by one chart from BD’s Excel files as of today. A grey box marks data we still have to collect.')}
      </p>

      {error ? (
        <div className="card" style={{ padding: 18, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }} data-bd="error">
          {error === 'permission-denied'
            ? t('The Analysis center data could not be opened: it is for managers only, or the new security rules are not live yet.')
            : t('The Analysis center data could not be loaded. Check the connection and reload the page.')}
        </div>
      ) : loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }} data-bd="loading">
          {[0, 1, 2, 3].map(i => <div key={i} className="card skeleton" style={{ height: 96 }} />)}
        </div>
      ) : !hasData(data) ? (
        <div className="card" style={{ padding: 18, fontSize: 13.5, color: 'var(--text-muted)' }} data-bd="empty">{t('No Analysis center data has been loaded yet.')}</div>
      ) : (
        <>
          {/* 1 — how fresh the figures are. */}
          <div className="card" data-bd="date-strip"
            style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }} data-bd="asof">
              {dd.asof ? t('Excel data as of {{date}}', { date: F.date(dd.asof, DATE_MEDIUM) }) : t('Data date not recorded')}
            </span>
            {dd.loadedAt && (
              <span data-bd="loaded">
                {dd.loadedBy
                  ? t('Loaded {{when}} by {{who}}', { when: F.dateTime(dd.loadedAt, DATETIME_SHORT), who: dd.loadedBy })
                  : t('Loaded {{when}}', { when: F.dateTime(dd.loadedAt, DATETIME_SHORT) })}
              </span>
            )}
            <span data-bd="edits">
              {dd.edits > 0
                ? t('Records edited in eTaske since the last load: {{n}}', { n: F.number(dd.edits) })
                : t('No edits in eTaske since the last load.')}
            </span>
            {dd.stale && (
              <span data-bd="stale" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: warn, fontWeight: 700 }}>
                <AlertTriangle size={15} />
                {t('The Excel data is {{n}} days old. Ask BD to refresh it.', { n: F.number(dd.ageDays) })}
              </span>
            )}
          </div>

          <div className="ms-tabs bdc-tabs" role="tablist" aria-label={t('Analysis center')} data-bd="tabs">
            {BD_TABS.map(x => (
              <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => openTab(x)} data-bd-tab={x}>
                {t(TAB_LABEL[x])}
              </button>
            ))}
          </div>

          <BdEditProvider data={data} canEdit={canEditBdControl(appUser)} who={who}>
          {tab === 'contracts' ? (client
            ? <ClientPage key={`${client}|${focus?.kind ?? ''}|${focus?.query ?? ''}`} data={data} today={today} code={client} focus={focus}
                onBack={() => openTab('contracts')} onSupplier={no => openSuppliers({ q: no })} />
            : <ContractsTab data={data} today={today} state={contracts} onState={setContracts} onClient={c => openClient(c)} />)
          : tab === 'pricing' ? <PricingTab data={data} today={today} bench={bench} onBench={setBench} onClient={c => openClient(c)} />
          : tab === 'suppliers' ? <SuppliersTab data={data} today={today} state={sup} onState={setSup} onClient={c => openClient(c)} />
          : tab === 'quality' ? <DataQualityTab data={data} state={quality} onState={setQuality} onTarget={openTarget} />
          : <QuestionBoard data={data} today={today} onClient={c => openClient(c)} onContracts={openContracts} bids={bids} />}
          </BdEditProvider>
        </>
      )}
    </div>
  );
}
