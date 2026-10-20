import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Gauge } from 'lucide-react';
import { useBdControl } from './hooks/useBdControl';
import { BD_TABS, dataDate, hasData, millions, overviewKpis, todayISO, type BdTab, type Benchmark, type IssueTarget } from './lib/bdControl';
import { useFormat, DATE_MEDIUM, DATETIME_SHORT } from './lib/format';
import OverviewCharts from './components/bdcontrol/OverviewCharts';
import QuestionBoard from './components/bdcontrol/QuestionBoard';
import ContractsTab, { type ContractsState } from './components/bdcontrol/ContractsTab';
import ClientPage from './components/bdcontrol/ClientPage';
import PricingTab from './components/bdcontrol/PricingTab';
import SuppliersTab, { type SuppliersState } from './components/bdcontrol/SuppliersTab';
import DataQualityTab, { type QualityState } from './components/bdcontrol/DataQualityTab';
import { BdEditProvider } from './components/bdcontrol/EditRecord';
import { canEditBdControl } from './lib/bdControlAccess';
import { AppUser } from './types';
import type { AppView } from './App';

interface Props {
  appUser: AppUser;
  onNavigate: (v: AppView) => void;
}

interface Tile {
  key: string;
  label: string;
  value: string;
  unit?: string;
  sub: React.ReactNode;
  tone?: string;
  /** The browse tab the tile opens. */
  go: () => void;
}

const TAB_LABEL: Record<BdTab, string> = {
  overview: 'Overview', contracts: 'Contracts', pricing: 'Pricing', suppliers: 'Suppliers', quality: 'Data quality',
};

/**
 * Analysis center (renamed from "BD control" in queue A1; view id stays
 * `bd-control` so links keep working). The Overview is the CEO question board
 * (components/bdcontrol/QuestionBoard.tsx): one chart per question, grey
 * "data needed" boxes for the rest. Below it, until queue A4 re-homes them, the
 * earlier tiles and charts.
 *
 * BD control (queue E5a) — the CEO page over every client contract, supplier
 * contract and AGIBA site contract loaded from BD's Excel files. Every figure
 * is worked out from the rows as of today (lib/bdControl.ts); nothing on the
 * page is typed in. So far: the data-date strip, the KPI tiles and charts 3–12
 * (E5b + E5c, components/bdcontrol/OverviewCharts.tsx + OverviewMoreCharts.tsx),
 * then the browse tabs (E6a): Contracts + the client page, Pricing, Suppliers,
 * Data quality. The tiles, the ceiling / day-rate / reprice rows and every data
 * issue open the matching tab. Managers and admin can correct a record in place
 * (E6b, components/bdcontrol/EditRecord.tsx); each change keeps its Excel value and a log.
 * Gated by `canViewBdControl` in App/TopNav/More/Home/palette, and by the rules.
 */
export default function BdControlDashboard({ appUser }: Props) {
  const { t } = useTranslation();
  const F = useFormat();
  const { data, loading, error } = useBdControl();
  const today = useMemo(() => todayISO(), []);
  const k = useMemo(() => overviewKpis(data, today), [data, today]);
  const dd = useMemo(() => dataDate(data, today), [data, today]);
  const who = useMemo(() => ({ uid: appUser.id, name: appUser.displayName || appUser.email }), [appUser.id, appUser.displayName, appUser.email]);

  // Where the reader is. Each tab keeps its search and filters while you move between tabs.
  const [tab, setTab] = useState<BdTab>('overview');
  const [client, setClient] = useState<string | null>(null);
  const [contracts, setContracts] = useState<ContractsState>({ filter: 'all', q: '' });
  const [bench, setBench] = useState<Benchmark>('anopc');
  const [sup, setSup] = useState<SuppliersState>({ view: 'supplier', filter: 'live', soOpen: true, q: '' });
  const [quality, setQuality] = useState<QualityState>({ sheet: '', q: '' });
  const top = useRef<HTMLDivElement>(null);
  const toTop = () => requestAnimationFrame(() => top.current?.scrollIntoView?.({ block: 'start' }));
  const openTab = (x: BdTab) => { setTab(x); setClient(null); toTop(); };
  const openClient = (code: string) => { setTab('contracts'); setClient(code); toTop(); };
  const openContracts = (filter: ContractsState['filter']) => { setContracts({ filter, q: '' }); openTab('contracts'); };
  const openSuppliers = (p: Partial<SuppliersState>) => { setSup(s => ({ ...s, filter: 'all', soOpen: false, q: '', ...p })); openTab('suppliers'); };
  const openTarget = (tg: Exclude<IssueTarget, null>) => (tg.kind === 'client' ? openClient(tg.code) : openSuppliers({ view: tg.kind, q: tg.query }));

  const m = (egp: number) => F.number(millions(egp), { maximumFractionDigits: 1 });
  const warn = 'var(--surface-warn-text)';
  const red = '#b91c1c';

  const tiles: Tile[] = [
    { key: 'clients', label: t('Clients'), value: F.number(k.clients), sub: t('With a contract in the CSA & O&M report'), go: () => openContracts('all') },
    {
      key: 'lines', label: t('Client contract lines'), value: F.number(k.clientLines),
      sub: k.clientLinesExpired > 0
        ? <span style={{ color: red }}>{t('Expired on paper: {{n}}', { n: F.number(k.clientLinesExpired) })}</span>
        : t('None expired on paper'),
      go: () => openContracts(k.clientLinesExpired > 0 ? 'expired' : 'all'),
    },
    {
      key: 'ceiling', label: t('Total ceiling'), value: m(k.ceilingEgp), unit: t('m EGP'),
      sub: t('Lines with a ceiling: {{n}} of {{total}}', { n: F.number(k.linesWithCeiling), total: F.number(k.clientLines) }),
      go: () => openContracts('all'),
    },
    ...(k.monthly.length ? [{
      key: 'monthly', label: t('Paid by the month'), value: F.number(k.monthlyEgp, { maximumFractionDigits: 0 }), unit: t('EGP / month'),
      sub: t('{{list}} — not added to the ceiling total', { list: k.monthly.map(x => [x.client, x.contractType].filter(Boolean).join(' ')).join('، ') }),
      go: () => openContracts('all'),
    }] : []),
    {
      key: 'renewals', label: t('Renewals within 90 days'), value: F.number(k.renewals.total), tone: warn,
      sub: <>
        <div>{t('Client {{a}} · supplier {{b}} · AGIBA site {{c}}', { a: F.number(k.renewals.client), b: F.number(k.renewals.supplier), c: F.number(k.renewals.agibaSite) })}</div>
        {k.overdue.total > 0 && <div style={{ color: red, marginTop: 2 }} data-bd="overdue">{t('Already past their date: {{n}}', { n: F.number(k.overdue.total) })}</div>}
      </>,
      go: () => openContracts('d90'),
    },
    {
      key: 'suppliers', label: t('Live supplier contracts'), value: F.number(k.liveSuppliers),
      sub: <>
        <div>{t('{{value}} m EGP', { value: m(k.liveSupplierEgp) })}</div>
        {k.liveSupplierOtherCurrency > 0 && <div style={{ marginTop: 2 }}>{t('In another currency, left out: {{n}}', { n: F.number(k.liveSupplierOtherCurrency) })}</div>}
      </>,
      go: () => openSuppliers({ view: 'supplier', filter: 'live' }),
    },
    { key: 'issues', label: t('Data issues to fix'), value: F.number(k.dataIssues), tone: 'var(--blue-400)', sub: t('Gaps and clashes found in the Excel files'), go: () => { setQuality({ sheet: '', q: '' }); openTab('quality'); } },
  ];

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
            ? <ClientPage key={client} data={data} today={today} code={client} onBack={() => openTab('contracts')}
                onSupplier={no => openSuppliers({ view: 'supplier', q: no })} />
            : <ContractsTab data={data} today={today} state={contracts} onState={setContracts} onClient={openClient} />)
          : tab === 'pricing' ? <PricingTab data={data} today={today} bench={bench} onBench={setBench} onClient={openClient} />
          : tab === 'suppliers' ? <SuppliersTab data={data} today={today} state={sup} onState={setSup} onClient={openClient} />
          : tab === 'quality' ? <DataQualityTab data={data} state={quality} onState={setQuality} onTarget={openTarget} />
          : <>
          <QuestionBoard data={data} today={today} onClient={openClient} onContracts={openContracts} />

          {/* Earlier figures — each moves under its question in queues A2–A4, then this block goes. */}
          <section className="ac-legacy" data-ac="legacy">
          <h2>{t('More figures')}</h2>
          <p className="bdc-cap">{t('The earlier summary tiles and charts. They move under their questions above one group at a time.')}</p>
          {/* 2 — the top figures. Each opens the tab behind it. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }} data-bd="tiles">
            {tiles.map(x => (
              <button key={x.key} type="button" className="card bdc-tile" data-bd-kpi={x.key} onClick={x.go} style={{ padding: '12px 14px', minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{x.label}</div>
                <div style={{ marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                  <span data-bd-value style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, color: x.tone && x.value !== F.number(0) ? x.tone : 'var(--text-primary)' }}>{x.value}</span>
                  {x.unit && <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{x.unit}</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }} data-bd-sub>{x.sub}</div>
              </button>
            ))}
          </div>

          {/* 3–12 — ceilings, renewals, day-rates, reprice list, suppliers, amendments, AGIBA SOs, changes, data issues, awaited data. */}
          <OverviewCharts data={data} today={today} onClient={openClient} />
          </section>
          </>}
          </BdEditProvider>
        </>
      )}
    </div>
  );
}
