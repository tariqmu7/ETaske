import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../../lib/format';
import {
  ASSUMED_CEILING_USED, ASSUMED_PAY_DAYS, ASSUMED_TERM_YEARS, ASSUMED_USD_EGP, OVERHEAD_OF_DIRECT, OWN_COST_SPLIT, PRICE_BUILDUP,
  billingByQuarter, cashByQuarter, ceilingUsed, moneyLastYear, owedByAge, type ClientMoney, type OwedBand,
} from '../../lib/analysisCenter';
import { millions } from '../../lib/bdControl';
import { AssumedKey } from './MoneyAmendCharts';
import { Donut, QuarterPlot, ShowAll, TILE_FIRST, TileFoot, useBdWords } from './shared';
import type { ChartCtx } from './ProjectCharts';

// Analysis center, queue A7a: Money M2–M4 and M6–M11. Finance has sent no
// invoices, costs or cash yet, so every figure here is ASSUMED by the rules in
// lib/analysisCenter.ts (agreed with Tariq, 20 Oct 2026) — drawn hatched, marked
// "≈", the rules spelled out under each chart and the board's "Requested from"
// line naming who the real figures were asked from.

const pct = (x: number) => Math.round(x * 100);

/** The rule sentences, worded once for every money chart. */
export function useMoneyRules() {
  const { t } = useTranslation();
  const F = useFormat();
  const n = (x: number, d = 0) => F.number(x, { maximumFractionDigits: d });
  return {
    billing: t('billing = {{used}}% of each ceiling, spread evenly over {{years}} years ending on the end date (a line paid by the month bills its monthly value; nothing after the end date)',
      { used: n(pct(ASSUMED_CEILING_USED)), years: n(ASSUMED_TERM_YEARS) }),
    planned: t('should be paid = the whole ceiling spread the same way'),
    subcontract: t('subcontractors = live supplier contracts spread evenly over their term (US dollars at {{rate}} EGP)', { rate: n(ASSUMED_USD_EGP) }),
    own: t('our own direct cost = billing ÷ {{k}} (EPROM’s price build-up) less subcontractors', { k: n(PRICE_BUILDUP, 4) }),
    split: t('own cost split {{staff}}% salaries and benefits, {{allow}}% allowances, {{travel}}% travel and transport',
      { staff: n(pct(OWN_COST_SPLIT.staff)), allow: n(pct(OWN_COST_SPLIT.allowances)), travel: n(pct(OWN_COST_SPLIT.travel)) }),
    overhead: t('head-office overhead = {{pct}}% of direct cost', { pct: n(pct(OVERHEAD_OF_DIRECT)) }),
    pay: t('clients pay {{days}} days after each bill', { days: n(ASSUMED_PAY_DAYS) }),
  };
}

/** One hatched (assumed) bar; `lo` draws it in the loss colour. */
export function HatchBar({ value, max, lo }: { value: number; max: number; lo?: boolean }) {
  return (
    <span className="bdc-track">
      <span className="bdc-stack" style={{ width: `${(Math.abs(value) / Math.max(1e-9, max)) * 100}%` }}>
        <span className={`bdc-seg ac-hatch${lo ? ' ac-hatch-lo' : ''}`} style={{ flex: 1 }} data-ac-assumed-seg />
      </span>
    </span>
  );
}

/** A ranked list of client projects: the top 5, then "Show all" on the Contracts tab. `sub` is the row's hover note (one line per row keeps 5 in the tile). */
function ClientList({ data, onClient, onContracts, rows, value, attr, sub }: Pick<ChartCtx, 'data' | 'onClient' | 'onContracts'> & {
  rows: ClientMoney[]; value: (r: ClientMoney) => number; attr: string; sub?: (r: ClientMoney) => string;
}) {
  const { nameOf, bidi, egpM } = useBdWords(data);
  const max = Math.max(1e-9, ...rows.map(r => Math.abs(value(r))));
  const shown = rows.slice(0, TILE_FIRST);
  return (
    <>
      <div className="bdc-list">
        {shown.map(r => {
          const v = value(r);
          return (
            <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} title={sub?.(r)} data-ac-row={attr} data-ac-key={r.client}>
              <span className="bdc-name">{bidi(nameOf(r.client))}</span>
              <HatchBar value={v} max={max} lo={v < 0} />
              <span className={`bdc-num${v < 0 ? ' bdc-red' : ''}`} data-bdc-value>≈ {egpM(v)}</span>
            </button>
          );
        })}
      </div>
      <ShowAll total={rows.length} onOpen={() => onContracts('all')} attr={attr} />
    </>
  );
}

/** Two tinted columns per quarter (first series teal, second charcoal) on one value axis, oldest on the start side. */
function PairColumns({ data, rows, label, keys }: {
  data: ChartCtx['data']; rows: { quarter: string; a: number; b: number }[]; label: string; keys: [string, string];
}) {
  const { t, F } = useBdWords(data);
  const m0 = (x: number) => F.number(millions(x), { maximumFractionDigits: 0 });
  return (
    <>
      <ul className="bdc-legend" aria-hidden="true">
        <li><span className="bdc-key ac-hatch" />{keys[0]}</li>
        <li><span className="bdc-key ac-hatch ac-hatch-2" />{keys[1]}</li>
        <li>{t('Figures in m EGP')}</li>
      </ul>
      <QuarterPlot attr="moneyQuarters" label={label} tick={m0} rows={rows.map(r => ({ quarter: r.quarter, bars: [
        { segs: [{ v: r.a, cls: 'ac-hatch', assumed: true }], label: m0(r.a) },
        { segs: [{ v: r.b, cls: 'ac-hatch ac-hatch-2', assumed: true }], label: m0(r.b) },
      ] }))} />
    </>
  );
}

/** M2 — should be paid vs billed, per completed quarter. */
export function M2Billing({ data, today }: ChartCtx) {
  const { t, egpM } = useBdWords(data);
  const r = useMoneyRules();
  const v = useMemo(() => billingByQuarter(data, today), [data, today]);
  const plan = v.reduce((a, x) => a + x.plannedEgp, 0), billed = v.reduce((a, x) => a + x.invoicedEgp, 0);
  if (!plan && !billed) return <p className="bdc-empty">{t('No contract line with an end date and a value on file.')}</p>;
  return (
    <>
      <div className="bdc-figs" data-ac-figs="M2">
        <span>{t('Should be paid, last {{n}} quarters', { n: v.length })}<b data-ac-fig="planned">≈ {egpM(plan)}</b></span>
        <span>{t('Billed')}<b data-ac-fig="billed">≈ {egpM(billed)}</b></span>
      </div>
      <PairColumns data={data} rows={v.map(x => ({ quarter: x.quarter, a: x.plannedEgp, b: x.invoicedEgp }))}
        label={t('Should be paid vs billed per quarter')} keys={[t('Should be paid'), t('Billed')]} />
      <AssumedKey rules={[r.billing, r.planned]} />
    </>
  );
}

const BAND_LABEL: Record<OwedBand, string> = { d30: '0–30 days', d60: '31–60 days', d90: '61–90 days', over90: 'Over 90 days' };
/** Older debt reads warmer: teal, charcoal, yellow, then coral for over 90 days. */
const BAND_TONE: Record<OwedBand, number> = { d30: 1, d60: 2, d90: 4, over90: 3 };

/** M3 — owed to us by age, and collected over the last 12 months. */
export function M3Owed({ data, today }: ChartCtx) {
  const { t, F, egpM } = useBdWords(data);
  const r = useMoneyRules();
  const v = useMemo(() => owedByAge(data, today), [data, today]);
  if (!v.owedEgp && !v.collectedEgp) return <p className="bdc-empty">{t('No contract line with an end date and a value on file.')}</p>;
  return (
    <>
      <div className="bdc-figs" data-ac-figs="M3">
        <span>{t('Owed to us now')}<b data-ac-fig="owed">≈ {egpM(v.owedEgp)}</b></span>
        <span>{t('Collected in the last 12 months')}<b data-ac-fig="collected">≈ {egpM(v.collectedEgp)}</b></span>
      </div>
      <Donut attr="owed" label={t('Owed to us by age')} centre={`≈ ${F.number(millions(v.owedEgp), { maximumFractionDigits: 0 })}`} centreLabel={t('m EGP owed')}
        parts={v.bands.map(b => ({ key: b.band, name: t(BAND_LABEL[b.band]), value: b.egp, assumed: b.egp, text: `≈ ${egpM(b.egp)}`, tone: BAND_TONE[b.band] }))} />
      <AssumedKey rules={[r.billing, r.pay]} />
    </>
  );
}

/** M4, M6, M7 — one own-cost item per client project, last 12 months. */
function OwnCostChart({ data, today, onClient, onContracts, field, id }: ChartCtx & { field: 'staffEgp' | 'allowancesEgp' | 'travelEgp'; id: string }) {
  const { t, egpM } = useBdWords(data);
  const r = useMoneyRules();
  const v = useMemo(() => moneyLastYear(data, today), [data, today]);
  const rows = v.rows.filter(x => x[field] > 0).sort((a, b) => b[field] - a[field] || a.client.localeCompare(b.client));
  return (
    <>
      <div className="bdc-figs" data-ac-figs={id}>
        <span>{t('Last 12 months, all projects')}<b data-ac-fig="total">≈ {egpM(v.total[field])}</b></span>
      </div>
      {rows.length === 0
        ? <p className="bdc-empty">{t('No project bills anything in the last 12 months.')}</p>
        : <ClientList data={data} onClient={onClient} onContracts={onContracts} rows={rows} value={x => x[field]} attr={id} />}
      <AssumedKey rules={[r.billing, r.own, r.split]} />
    </>
  );
}

/** M8 — total direct cost per client project, last 12 months. */
export function M8TotalCost({ data, today, onClient, onContracts }: ChartCtx) {
  const { t, egpM } = useBdWords(data);
  const r = useMoneyRules();
  const v = useMemo(() => moneyLastYear(data, today), [data, today]);
  const rows = v.rows.filter(x => x.costEgp > 0).sort((a, b) => b.costEgp - a.costEgp || a.client.localeCompare(b.client));
  return (
    <>
      <div className="bdc-figs" data-ac-figs="M8">
        <span>{t('Last 12 months, all projects')}<b data-ac-fig="total">≈ {egpM(v.total.costEgp)}</b></span>
        <span>{t('Of which subcontractors')}<b data-ac-fig="sub">≈ {egpM(v.total.subcontractEgp)}</b></span>
      </div>
      {rows.length === 0
        ? <p className="bdc-empty">{t('No project bills anything in the last 12 months.')}</p>
        : <ClientList data={data} onClient={onClient} onContracts={onContracts} rows={rows} value={x => x.costEgp} attr="M8"
            sub={x => t('Subcontractors ≈ {{sub}} · our own ≈ {{own}}', { sub: egpM(x.subcontractEgp), own: egpM(x.ownEgp) })} />}
      <AssumedKey rules={[r.billing, r.subcontract, r.own]} />
    </>
  );
}

/**
 * M9 — profit per client project, last 12 months, loss-makers first. A project
 * with costs but no billing (its line is past its end date, or has no value) is
 * named under the chart rather than drawn as a loss.
 */
export function M9Profit({ data, today, onClient, onContracts }: ChartCtx) {
  const { t, F, sep, nameOf, egpM } = useBdWords(data);
  const r = useMoneyRules();
  const v = useMemo(() => moneyLastYear(data, today), [data, today]);
  const billed = v.rows.filter(x => x.invoicedEgp > 0).sort((a, b) => a.profitEgp - b.profitEgp || a.client.localeCompare(b.client));
  const unbilled = v.rows.filter(x => x.invoicedEgp <= 0 && x.costEgp > 0).sort((a, b) => b.costEgp - a.costEgp);
  const profit = billed.reduce((a, x) => a + x.profitEgp, 0), income = billed.reduce((a, x) => a + x.invoicedEgp, 0);
  const losing = billed.filter(x => x.profitEgp < 0).length;
  return (
    <>
      <div className="bdc-figs" data-ac-figs="M9">
        <span>{t('Profit, last 12 months')}<b data-ac-fig="profit" className={profit < 0 ? 'bdc-red' : undefined}>≈ {egpM(profit)}</b></span>
        {income > 0 && <span>{t('Margin')}<b data-ac-fig="margin">≈ {F.number((profit / income) * 100, { maximumFractionDigits: 0 })}%</b></span>}
        <span>{t('Losing money')}<b data-ac-fig="losing" className={losing ? 'bdc-red' : undefined}>{F.number(losing)}</b></span>
      </div>
      {billed.length === 0
        ? <p className="bdc-empty">{t('No project bills anything in the last 12 months.')}</p>
        : <ClientList data={data} onClient={onClient} onContracts={onContracts} rows={billed} value={x => x.profitEgp} attr="M9"
            sub={x => t('Billed ≈ {{billed}} · cost and overhead ≈ {{cost}}', { billed: egpM(x.invoicedEgp), cost: egpM(x.costEgp + x.overheadEgp) })} />}
      {unbilled.length > 0 && (
        <TileFoot attr="unbilled">
          {t('Costs but no billing assumed (past the end date or no value on file): {{list}}', {
            list: unbilled.map(x => `${nameOf(x.client)} ≈ ${egpM(x.costEgp)}`).join(sep),
          })}
        </TileFoot>
      )}
      <AssumedKey rules={[r.billing, r.subcontract, r.own, r.overhead]} />
    </>
  );
}

/** M10 — share of each ceiling billed to date, most used first: the top 5, then "Show all" on the Contracts tab. */
export function M10Used({ data, today, onClient, onContracts }: ChartCtx) {
  const { t, F, nameOf, bidi, egpM } = useBdWords(data);
  const r = useMoneyRules();
  const v = useMemo(() => ceilingUsed(data, today), [data, today]);
  const shown = v.rows.slice(0, TILE_FIRST);
  return (
    <>
      {v.rows.length === 0
        ? <p className="bdc-empty">{t('No contract line with a ceiling and an end date on file.')}</p>
        : <div className="bdc-list">
            {shown.map(x => (
              <button key={x.id} type="button" className="bdc-row bdc-click" onClick={() => onClient(x.client)} data-ac-row="used" data-ac-key={x.id}>
                <span className="bdc-name">{bidi(nameOf(x.client))}<span className="bdc-sub">{t(x.type)} · {t('Ceiling {{v}}', { v: egpM(x.ceilingEgp) })}</span></span>
                <HatchBar value={Math.min(100, x.usedPct)} max={100} />
                <span className="bdc-num" data-bdc-value>≈ {F.number(x.usedPct, { maximumFractionDigits: 0 })}%</span>
              </button>
            ))}
          </div>}
      <ShowAll total={v.rows.length} onOpen={() => onContracts('all')} attr="used" />
      {v.noCeiling > 0 && <TileFoot attr="noCeiling">{t('Lines with no ceiling or no end date on file: {{n}}', { n: F.number(v.noCeiling) })}</TileFoot>}
      <AssumedKey rules={[r.billing]} />
    </>
  );
}

/** M11 — cash in vs cash out, per completed quarter. */
export function M11Cash({ data, today }: ChartCtx) {
  const { t, egpM } = useBdWords(data);
  const r = useMoneyRules();
  const v = useMemo(() => cashByQuarter(data, today), [data, today]);
  const net = v.reduce((a, x) => a + x.inEgp - x.outEgp, 0);
  if (!v.some(x => x.inEgp || x.outEgp)) return <p className="bdc-empty">{t('No contract line with an end date and a value on file.')}</p>;
  return (
    <>
      <div className="bdc-figs" data-ac-figs="M11">
        <span>{t('Net cash, last {{n}} quarters', { n: v.length })}<b data-ac-fig="net" className={net < 0 ? 'bdc-red' : undefined}>≈ {egpM(net)}</b></span>
      </div>
      <PairColumns data={data} rows={v.map(x => ({ quarter: x.quarter, a: x.inEgp, b: x.outEgp }))}
        label={t('Cash in vs cash out per quarter')} keys={[t('Cash in'), t('Cash out')]} />
      <AssumedKey rules={[r.billing, r.pay, r.subcontract, r.own, r.overhead]} />
    </>
  );
}

export const MONEY_CHARTS: Record<string, (c: ChartCtx) => React.ReactElement> = {
  M2: c => <M2Billing {...c} />,
  M3: c => <M3Owed {...c} />,
  M4: c => <OwnCostChart {...c} field="staffEgp" id="M4" />,
  M6: c => <OwnCostChart {...c} field="travelEgp" id="M6" />,
  M7: c => <OwnCostChart {...c} field="allowancesEgp" id="M7" />,
  M8: c => <M8TotalCost {...c} />,
  M9: c => <M9Profit {...c} />,
  M10: c => <M10Used {...c} />,
  M11: c => <M11Cash {...c} />,
};
