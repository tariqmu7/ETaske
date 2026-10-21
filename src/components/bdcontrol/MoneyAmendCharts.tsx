import React, { useContext, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../../lib/format';
import {
  ASSUMED_MONTHS, ASSUMED_USD_EGP, amendmentsByProject, amendmentsByQuarter, extensionsByProject, monthsAdded,
  projectGrowth, projectValues, subcontractByProject, type ProjectChange, type Yardstick,
} from '../../lib/analysisCenter';
import { InfoSlot, QuarterPlot, ShowAll, TILE_FIRST, TileFoot, useBdWords } from './shared';
import type { ChartCtx } from './ProjectCharts';

// Analysis center, queue A2: Money (M1, M5) and Changes & amendments (A1–A5).
// A figure we do not hold yet is still drawn, worked out by the rule in
// lib/analysisCenter.ts, hatched and marked "≈"; the key under the chart says the
// rule, and the board adds who the real figure was requested from.

/** One bar: the real part solid, the assumed part hatched. */
export function Bar({ real, assumed, max }: { real: number; assumed: number; max: number }) {
  return (
    <span className="bdc-track">
      <span className="bdc-stack" style={{ width: `${((real + assumed) / Math.max(1e-9, max)) * 100}%` }}>
        {real > 0 && <span className="bdc-seg bdc-client" style={{ flex: real }} />}
        {assumed > 0 && <span className="bdc-seg ac-hatch" style={{ flex: assumed }} data-ac-assumed-seg />}
      </span>
    </span>
  );
}

/** The hatched swatch + the rule behind the assumed figures on this chart. */
export function AssumedKey({ rules }: { rules: string[] }) {
  const { t, i18n } = useTranslation();
  const sep = i18n.language === 'ar' ? '، ' : ', ';
  const slot = useContext(InfoSlot);
  if (!rules.length) return null;
  const key = (
    <p className="ac-assumed" data-ac-assumed>
      <span className="bdc-key ac-hatch" aria-hidden="true" />
      <span>{t('Hatched and ≈ = assumed')}: {rules.join(sep)}</span>
    </p>
  );
  // Inside a dashboard tile the rule goes behind its ⓘ button (queue B1).
  return slot ? createPortal(key, slot) : key;
}

const pct0 = (x: number) => Math.round(x * 100);

/** M1 — contract value of every project, per client: the top 5, then "Show all" on the Contracts tab. */
export function M1Values({ data, onClient, onContracts }: ChartCtx) {
  const { t, F, nameOf, bidi, egpM } = useBdWords(data);
  const v = useMemo(() => projectValues(data), [data]);
  const max = Math.max(1, ...v.rows.map(r => r.totalEgp));
  const shown = v.rows.slice(0, TILE_FIRST);
  const bases = new Set(v.rows.flatMap(r => r.basis));
  const rules = [
    ...(bases.has('monthly') ? [t('a line paid by the month = {{n}} × its monthly value', { n: F.number(ASSUMED_MONTHS) })] : []),
    ...(bases.has('typeMedian') ? [t('a line with no value = the median ceiling of its contract form')] : []),
  ];
  if (!v.rows.length) return <p className="bdc-empty">{t('No project lines on file.')}</p>;
  return (
    <>
      <div className="bdc-figs" data-ac-figs="M1">
        <span>{t('Total contract value')}<b data-ac-fig="total">{egpM(v.realEgp + v.assumedEgp)}</b></span>
        {v.assumedEgp > 0 && <span>{t('Of which assumed')}<b data-ac-fig="assumed">≈ {egpM(v.assumedEgp)}</b></span>}
      </div>
      <div className="bdc-list">
        {shown.map(r => (
          <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} title={t('Contract lines: {{n}}', { n: F.number(r.lines) })} data-ac-row="values" data-ac-key={r.client}>
            <span className="bdc-name">{bidi(nameOf(r.client))}</span>
            <Bar real={r.realEgp} assumed={r.assumedEgp} max={max} />
            <span className="bdc-num" data-bdc-value>{r.assumedEgp > 0 ? '≈ ' : ''}{egpM(r.totalEgp)}</span>
          </button>
        ))}
      </div>
      <ShowAll total={v.rows.length} onOpen={() => onContracts('all')} attr="values" />
      <AssumedKey rules={rules} />
    </>
  );
}

/** M5 — what subcontractors cost us on each client project: the top 5, then "Show all" on the Suppliers tab. */
export function M5Subcontract({ data, onClient, onContracts, onSuppliers }: ChartCtx) {
  const { t, F, nameOf, bidi, egpM } = useBdWords(data);
  const v = useMemo(() => subcontractByProject(data), [data]);
  const max = Math.max(1, ...v.rows.map(r => r.totalEgp));
  const shown = v.rows.slice(0, TILE_FIRST);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="M5">
        <span>{t('Live subcontracts on client projects')}<b data-ac-fig="total">{v.assumedEgp > 0 ? '≈ ' : ''}{egpM(v.realEgp + v.assumedEgp)}</b></span>
      </div>
      {v.rows.length === 0
        ? <p className="bdc-empty">{t('No live supplier contract is tied to a client project.')}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.client || '-'} type="button" className="bdc-row bdc-click" onClick={() => r.client && onClient(r.client)} title={t('Supplier contracts: {{n}}', { n: F.number(r.count) })} data-ac-row="subcontract" data-ac-key={r.client}>
                <span className="bdc-name">{bidi(r.client ? nameOf(r.client) : t('No client on file'))}</span>
                <Bar real={r.realEgp} assumed={r.assumedEgp} max={max} />
                <span className="bdc-num" data-bdc-value>{r.assumedEgp > 0 ? '≈ ' : ''}{egpM(r.totalEgp)}</span>
              </button>
            ))}
          </div>}
      <ShowAll total={v.rows.length} onOpen={() => (onSuppliers ? onSuppliers() : onContracts('all'))} attr="subcontract" />
      {v.own.count > 0 && <TileFoot attr="own">{t('EPROM’s own needs, not a client project: {{value}} · contracts: {{n}}', { n: F.number(v.own.count), value: egpM(v.own.egp) })}</TileFoot>}
      {v.leftOut > 0 && <TileFoot attr="currency">{t('In another currency, left out: {{n}}', { n: F.number(v.leftOut) })}</TileFoot>}
      <AssumedKey rules={v.usdLines > 0 ? [t('a contract in US dollars at {{rate}} EGP per dollar', { rate: F.number(ASSUMED_USD_EGP) })] : []} />
    </>
  );
}

/** A1 — amendments per project line: the top 5, then "Show all" on the Contracts tab. */
export function A1PerProject({ data, onClient, onContracts }: ChartCtx) {
  const { t, F, nameOf, bidi } = useBdWords(data);
  const v = useMemo(() => amendmentsByProject(data), [data]);
  const max = Math.max(1, ...v.rows.map(r => r.n));
  const shown = v.rows.slice(0, TILE_FIRST);
  return (
    <>
      {v.rows.length === 0
        ? <p className="bdc-empty">{t('No amendment on file for any project.')}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.id} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="amendments" data-ac-key={r.id}>
                <span className="bdc-name">{bidi(nameOf(r.client))}<span className="bdc-sub">{t(r.type)}</span></span>
                <Bar real={r.assumed ? 0 : r.n} assumed={r.assumed ? r.n : 0} max={max} />
                <span className="bdc-num" data-bdc-value>{r.assumed ? '≈ ' : ''}{F.number(r.n)}</span>
              </button>
            ))}
          </div>}
      <ShowAll total={v.rows.length} onOpen={() => onContracts('all')} attr="amendments" />
      {v.none > 0 && <TileFoot attr="none">{t('Projects with no amendment on file: {{n}}', { n: F.number(v.none) })}</TileFoot>}
      <AssumedKey rules={v.assumed > 0 ? [t('a line marked “Amend.” with no number counts as one')] : []} />
    </>
  );
}

/** A2 — amendments signed per quarter (columns, oldest on the start side). */
export function A2PerQuarter({ data, today }: ChartCtx) {
  const { t, F, sep } = useBdWords(data);
  const v = useMemo(() => amendmentsByQuarter(data, today), [data, today]);
  const qLabel = (k: string) => `${t('Q{{q}}', { q: F.number(Number(k.slice(-1))) })} ${k.slice(0, 4)}`;
  const foot = [
    v.earlier > 0 ? t('Before {{q}}: {{n}}', { q: qLabel(v.rows[0].quarter), n: F.number(v.earlier) }) : '',
    v.later > 0 ? t('Starting after this quarter: {{n}}', { n: F.number(v.later) }) : '',
    v.noDate > 0 ? t('No date on file: {{n}}', { n: F.number(v.noDate) }) : '',
  ].filter(Boolean);
  const any = v.rows.some(r => r.real + r.assumed > 0);
  return (
    <>
      {!any && <p className="bdc-empty" data-ac-empty="quarters">{t('No amendment starts in the last 8 quarters.')}</p>}
      {any && <QuarterPlot attr="quarters" label={t('Supplier amendments per quarter')} tick={n => F.number(n)}
        rows={v.rows.map(r => { const n = r.real + r.assumed; return { quarter: r.quarter, bars: [{
          segs: [{ v: r.real, cls: 'bdc-client' }, { v: r.assumed, cls: 'ac-hatch', assumed: true }],
          label: `${r.assumed > 0 ? '≈ ' : ''}${F.number(n)}`, zero: !n }] }; })} />}
      {foot.length > 0 && <TileFoot attr="quarters">{foot.join(sep)}</TileFoot>}
      <AssumedKey rules={v.rows.some(r => r.assumed > 0) ? [t('no start date on file, so taken as the day after the end date it extends')] : []} />
    </>
  );
}

/**
 * The ranked list A3–A5 share: one bar per project line, assumed rows hatched;
 * the top 5, then "Show all" on the Contracts tab. The contract form and the
 * amendment count are the row's hover note (two-line rows overflow the tile).
 */
function ChangeList({ data, onClient, onContracts, rows, attr, fmt, extra }: Pick<ChartCtx, 'data' | 'onClient' | 'onContracts'> & {
  rows: ProjectChange[]; attr: string; fmt: (r: ProjectChange) => string; extra?: (r: ProjectChange) => React.ReactNode;
}) {
  const { t, F, nameOf, bidi } = useBdWords(data);
  const max = Math.max(1e-9, ...rows.map(r => r.value));
  return (
    <>
      <div className="bdc-list">
        {rows.slice(0, TILE_FIRST).map(r => (
          <button key={r.id} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} title={`${t(r.type)} · ${t('Amendments: {{n}}', { n: F.number(r.amendments) })}`} data-ac-row={attr} data-ac-key={r.id}>
            <span className="bdc-name">{bidi(nameOf(r.client))}{extra?.(r)}</span>
            <Bar real={r.assumed ? 0 : r.value} assumed={r.assumed ? r.value : 0} max={max} />
            <span className="bdc-num" data-bdc-value>{r.assumed ? '≈ ' : ''}{fmt(r)}</span>
          </button>
        ))}
      </div>
      <ShowAll total={rows.length} onOpen={() => onContracts('all')} attr={attr} />
    </>
  );
}

function useYardstickRule(y: Yardstick, kind: 'value' | 'time') {
  const { t } = useTranslation();
  const F = useFormat();
  if (kind === 'value') {
    return y.pctPerIncrease == null ? null : t('{{share}}% of our supplier amendments raise the value, by {{pct}}% each (median), applied to each project’s amendment count',
      { share: F.number(pct0(y.valueShare)), pct: F.number(y.pctPerIncrease, { maximumFractionDigits: 1 }) });
  }
  return y.monthsPerExtension == null ? null : t('{{share}}% of our supplier amendments extend the time, by {{m}} months each (median), applied to each project’s amendment count',
    { share: F.number(pct0(y.timeShare)), m: F.number(y.monthsPerExtension, { maximumFractionDigits: 0 }) });
}

/** A3 — growth in value per project, %. */
export function A3Growth({ data, onClient, onContracts }: ChartCtx) {
  const { t, F } = useBdWords(data);
  const v = useMemo(() => projectGrowth(data), [data]);
  const rule = useYardstickRule(v.y, 'value');
  return (
    <>
      {v.rows.length === 0
        ? <p className="bdc-empty">{t('No project shows a growth in value yet.')}</p>
        : <ChangeList data={data} onClient={onClient} onContracts={onContracts} rows={v.rows} attr="growth" fmt={r => `+${F.number(r.value, { maximumFractionDigits: 0 })}%`} />}
      {v.flat > 0 && <TileFoot attr="flat">{t('Projects with no growth to show: {{n}}', { n: F.number(v.flat) })}</TileFoot>}
      <AssumedKey rules={v.rows.some(r => r.assumed) && rule ? [rule] : []} />
    </>
  );
}

/** A4 — months added per project. */
export function A4Months({ data, onClient, onContracts }: ChartCtx) {
  const { t, F } = useBdWords(data);
  const v = useMemo(() => monthsAdded(data), [data]);
  const rule = useYardstickRule(v.y, 'time');
  return (
    <>
      {v.rows.length === 0
        ? <p className="bdc-empty">{t('No project shows months added yet.')}</p>
        : <ChangeList data={data} onClient={onClient} onContracts={onContracts} rows={v.rows} attr="months" fmt={r => `+${F.number(r.value)}`} />}
      {v.flat > 0 && <TileFoot attr="flat">{t('Projects with no months added to show: {{n}}', { n: F.number(v.flat) })}</TileFoot>}
      <AssumedKey rules={v.rows.some(r => r.assumed) && rule ? [rule] : []} />
    </>
  );
}

/** A5 — projects ranked by time extensions, with the real "extended lately" tag. */
export function A5Extensions({ data, onClient, onContracts }: ChartCtx) {
  const { t, F } = useBdWords(data);
  const v = useMemo(() => extensionsByProject(data), [data]);
  const rule = useYardstickRule(v.y, 'time');
  const moved = new Map(v.rows.map(r => [r.id, r.movedMonths]));
  return (
    <>
      {v.rows.length === 0
        ? <p className="bdc-empty">{t('No project shows a time extension yet.')}</p>
        : <ChangeList data={data} onClient={onClient} onContracts={onContracts} rows={v.rows} attr="extensions" fmt={r => F.number(r.value)}
            extra={r => moved.get(r.id) != null && (
              <span className="bdc-pill bdc-pill-mid ac-tag" data-ac-moved>{t('Extended in the latest report (months: +{{n}})', { n: F.number(moved.get(r.id) as number) })}</span>
            )} />}
      {v.flat > 0 && <TileFoot attr="flat">{t('Projects with no extension to show: {{n}}', { n: F.number(v.flat) })}</TileFoot>}
      <AssumedKey rules={v.rows.some(r => r.assumed) && rule ? [rule] : []} />
    </>
  );
}

export const MONEY_AMEND_CHARTS: Record<string, (c: ChartCtx) => React.ReactElement> = {
  M1: c => <M1Values {...c} />,
  M5: c => <M5Subcontract {...c} />,
  A1: c => <A1PerProject {...c} />,
  A2: c => <A2PerQuarter {...c} />,
  A3: c => <A3Growth {...c} />,
  A4: c => <A4Months {...c} />,
  A5: c => <A5Extensions {...c} />,
};
