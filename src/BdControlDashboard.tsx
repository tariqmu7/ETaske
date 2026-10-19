import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Gauge } from 'lucide-react';
import { useBdControl } from './hooks/useBdControl';
import { dataDate, hasData, millions, overviewKpis, todayISO } from './lib/bdControl';
import { useFormat, DATE_MEDIUM, DATETIME_SHORT } from './lib/format';
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
}

/**
 * BD control (queue E5a) — the CEO page over every client contract, supplier
 * contract and AGIBA site contract loaded from BD's Excel files. Every figure
 * is worked out from the rows as of today (lib/bdControl.ts); nothing on the
 * page is typed in. This task is the data-date strip + the KPI tiles; the
 * charts (E5b/E5c), browse tabs (E6a) and editing (E6b) come next.
 * Gated by `canViewBdControl` in App/TopNav/More/Home/palette, and by the rules.
 */
export default function BdControlDashboard(_props: Props) {
  const { t } = useTranslation();
  const F = useFormat();
  const { data, loading, error } = useBdControl();
  const today = useMemo(() => todayISO(), []);
  const k = useMemo(() => overviewKpis(data, today), [data, today]);
  const dd = useMemo(() => dataDate(data, today), [data, today]);

  const m = (egp: number) => F.number(millions(egp), { maximumFractionDigits: 1 });
  const warn = 'var(--surface-warn-text)';
  const red = '#b91c1c';

  const tiles: Tile[] = [
    { key: 'clients', label: t('Clients'), value: F.number(k.clients), sub: t('With a contract in the CSA & O&M report') },
    {
      key: 'lines', label: t('Client contract lines'), value: F.number(k.clientLines),
      sub: k.clientLinesExpired > 0
        ? <span style={{ color: red }}>{t('Expired on paper: {{n}}', { n: F.number(k.clientLinesExpired) })}</span>
        : t('None expired on paper'),
    },
    {
      key: 'ceiling', label: t('Total ceiling'), value: m(k.ceilingEgp), unit: t('m EGP'),
      sub: t('Lines with a ceiling: {{n}} of {{total}}', { n: F.number(k.linesWithCeiling), total: F.number(k.clientLines) }),
    },
    ...(k.monthly.length ? [{
      key: 'monthly', label: t('Paid by the month'), value: F.number(k.monthlyEgp, { maximumFractionDigits: 0 }), unit: t('EGP / month'),
      sub: t('{{list}} — not added to the ceiling total', { list: k.monthly.map(x => [x.client, x.contractType].filter(Boolean).join(' ')).join('، ') }),
    }] : []),
    {
      key: 'renewals', label: t('Renewals within 90 days'), value: F.number(k.renewals.total), tone: warn,
      sub: <>
        <div>{t('Client {{a}} · supplier {{b}} · AGIBA site {{c}}', { a: F.number(k.renewals.client), b: F.number(k.renewals.supplier), c: F.number(k.renewals.agibaSite) })}</div>
        {k.overdue.total > 0 && <div style={{ color: red, marginTop: 2 }} data-bd="overdue">{t('Already past their date: {{n}}', { n: F.number(k.overdue.total) })}</div>}
      </>,
    },
    {
      key: 'suppliers', label: t('Live supplier contracts'), value: F.number(k.liveSuppliers),
      sub: <>
        <div>{t('{{value}} m EGP', { value: m(k.liveSupplierEgp) })}</div>
        {k.liveSupplierOtherCurrency > 0 && <div style={{ marginTop: 2 }}>{t('In another currency, left out: {{n}}', { n: F.number(k.liveSupplierOtherCurrency) })}</div>}
      </>,
    },
    { key: 'issues', label: t('Data issues to fix'), value: F.number(k.dataIssues), tone: 'var(--blue-400)', sub: t('Gaps and clashes found in the Excel files') },
  ];

  return (
    <div style={{ maxWidth: 'var(--page-max)', margin: '0 auto', padding: '24px 16px' }} data-testid="bd-control-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Gauge className="w-6 h-6" style={{ color: 'var(--accent)' }} />
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{t('BD control')}</h1>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.55 }}>
        {t('Every client contract, supplier contract and AGIBA site contract from BD’s Excel files. Each figure is worked out from the records as of today.')}
      </p>

      {error ? (
        <div className="card" style={{ padding: 18, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }} data-bd="error">
          {error === 'permission-denied'
            ? t('The BD control data could not be opened: it is for managers only, or the new security rules are not live yet.')
            : t('The BD control data could not be loaded. Check the connection and reload the page.')}
        </div>
      ) : loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }} data-bd="loading">
          {[0, 1, 2, 3].map(i => <div key={i} className="card skeleton" style={{ height: 96 }} />)}
        </div>
      ) : !hasData(data) ? (
        <div className="card" style={{ padding: 18, fontSize: 13.5, color: 'var(--text-muted)' }} data-bd="empty">{t('No BD control data has been loaded yet.')}</div>
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

          {/* 2 — the top figures. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }} data-bd="tiles">
            {tiles.map(x => (
              <div key={x.key} className="card" data-bd-kpi={x.key} style={{ padding: '12px 14px', minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{x.label}</div>
                <div style={{ marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                  <span data-bd-value style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, color: x.tone && x.value !== F.number(0) ? x.tone : 'var(--text-primary)' }}>{x.value}</span>
                  {x.unit && <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{x.unit}</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }} data-bd-sub>{x.sub}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
