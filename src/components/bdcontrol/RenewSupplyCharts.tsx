import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { amendmentGrowth, isEgpSupplier, isLiveSupplier } from '../../lib/bdControl';
import {
  ASSUMED_USD_EGP, endingSoon, pastEnd, spendByContractor, suppliersEndingFirst, topContractorShare, type SoonWindow,
} from '../../lib/analysisCenter';
import { ShowAll, TILE_FIRST, TileFoot, useBdWords } from './shared';
import { AssumedKey, Bar } from './MoneyAmendCharts';
import type { ChartCtx } from './ProjectCharts';

// Analysis center, queue A3: Renewals & risks (R1–R3) and Suppliers (S1–S3).
// Same rules as A2: every figure from the live rows as of today; an assumed
// figure is hatched and marked "≈", the key under the chart states the rule.
// Queue B2c: lists show the top 5, then "Show all" on the browse tab; the
// second lines are the row's hover note and the side lines sit behind ⓘ.

const WINDOW_LABEL: Record<SoonWindow, string> = { d30: 'Within 30 days', d90: 'In 31–90 days', d180: 'In 91–180 days' };
const WINDOW_TONE: Record<SoonWindow, string> = { d30: 'lo', d90: 'mid', d180: 'base' };

/** "Show all" for a supplier list: the Suppliers tab when the dashboard has one, else the Contracts tab. */
function toSuppliers({ onSuppliers, onContracts }: ChartCtx) {
  return () => (onSuppliers ? onSuppliers() : onContracts('all'));
}

/** R1 — lines ending in the next 30 / 90 / 180 days; a bar opens its first 5 lines. */
export function R1EndingSoon({ data, today, onClient, onContracts }: ChartCtx) {
  const { t, F, nameOf, bidi, ends } = useBdWords(data);
  const v = useMemo(() => endingSoon(data, today), [data, today]);
  const [open, setOpen] = useState<SoonWindow | null>(null);
  const max = Math.max(1, ...v.windows.map(x => x.lines.length));
  const shown = v.windows.find(x => x.w === open)?.lines || [];
  return (
    <>
      <div className="bdc-list">
        {v.windows.map(x => {
          const inner = <>
            <span className="bdc-name"><span>{t(WINDOW_LABEL[x.w])}</span></span>
            <span className="bdc-track"><span className={`bdc-fill bdc-fill-${WINDOW_TONE[x.w]}`} style={{ width: `${(x.lines.length / max) * 100}%` }} /></span>
            <span className="bdc-num" data-bdc-value>{F.number(x.lines.length)}</span>
          </>;
          return x.lines.length > 0
            ? <button key={x.w} type="button" className="bdc-row bdc-click" aria-expanded={open === x.w} onClick={() => setOpen(o => (o === x.w ? null : x.w))}
                data-ac-row="soon" data-ac-key={x.w}>{inner}</button>
            : <div key={x.w} className="bdc-row" data-ac-row="soon" data-ac-key={x.w}>{inner}</div>;
        })}
      </div>
      {open && (
        <div className="bdc-list ac-sublist" data-ac-list={open}>
          {shown.slice(0, TILE_FIRST).map(l => (
            <button key={l.id} type="button" className="bdc-row bdc-click ac-subrow" onClick={() => onClient(l.client)} title={`${t(l.type)} · ${ends(l.end, l.days)}`}
              data-ac-row="soonLine" data-ac-key={l.id}>
              <span className="bdc-name">{bidi(nameOf(l.client))}</span>
            </button>
          ))}
        </div>
      )}
      {open && <ShowAll total={shown.length} onOpen={() => onContracts('all')} attr="soonLine" />}
      {v.noDate > 0 && <TileFoot attr="nodate">{t('No end date on file: {{n}}', { n: F.number(v.noDate) })}</TileFoot>}
    </>
  );
}

/** R2 — lines past their end date that are still in the report, longest overdue first: the top 5, then "Show all" on the Contracts tab. */
export function R2PastEnd({ data, today, onClient, onContracts }: ChartCtx) {
  const { t, F, nameOf, bidi, ends } = useBdWords(data);
  const v = useMemo(() => pastEnd(data, today), [data, today]);
  const max = Math.max(1, ...v.lines.map(l => -l.days));
  const shown = v.lines.slice(0, TILE_FIRST);
  return (
    <>
      {v.lines.length === 0
        ? <p className="bdc-empty" data-ac-empty="pastEnd">{t('No project is past its end date.')}</p>
        : <div className="bdc-list">
            {shown.map(l => (
              <button key={l.id} type="button" className="bdc-row bdc-click" onClick={() => onClient(l.client)} title={`${t(l.type)} · ${ends(l.end, l.days)}`}
                data-ac-row="pastEnd" data-ac-key={l.id}>
                <span className="bdc-name">{bidi(nameOf(l.client))}</span>
                <span className="bdc-track"><span className="bdc-fill bdc-fill-lo" style={{ width: `${(-l.days / max) * 100}%` }} /></span>
                <span className="bdc-num" data-bdc-value>{t('{{n}} d', { n: F.number(-l.days) })}</span>
              </button>
            ))}
          </div>}
      <ShowAll total={v.lines.length} onOpen={() => onContracts('all')} attr="pastEnd" />
      {v.suppliers > 0 && <TileFoot attr="suppliers">{t('Supplier contracts still in progress past their end date: {{n}}', { n: F.number(v.suppliers) })}</TileFoot>}
    </>
  );
}

/** R3 — supplier contracts that end before the client contract they support: the top 5, then "Show all" on the Suppliers tab. */
export function R3SupplierFirst(c: ChartCtx) {
  const { data, today, onClient } = c;
  const { t, F, nameOf, bidi, date } = useBdWords(data);
  const v = useMemo(() => suppliersEndingFirst(data, today), [data, today]);
  const max = Math.max(1, ...v.rows.map(r => r.months));
  const shown = v.rows.slice(0, TILE_FIRST);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="R3">
        <span>{t('Ending before their client contract')}<b data-ac-fig="count">{F.number(v.rows.length)}</b></span>
        <span>{t('Supplier contracts checked')}<b data-ac-fig="matched">{F.number(v.matched)}</b></span>
      </div>
      {v.rows.length === 0
        ? <p className="bdc-empty" data-ac-empty="supplierFirst">{t('No live supplier contract ends before its client contract.')}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.id} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="supplierFirst" data-ac-key={r.id}
                title={`${r.contractNo} · ${nameOf(r.client)} ${t(r.lineType)} · ${t('Supplier ends {{a}} · client contract ends {{b}}', { a: date(r.supplierEnd), b: date(r.clientEnd) })}`}>
                <span className="bdc-name">{bidi(r.contractor || r.contractNo)}</span>
                <Bar real={r.assumed ? 0 : r.months} assumed={r.assumed ? r.months : 0} max={max} />
                <span className="bdc-num" data-bdc-value>{r.assumed ? '≈ ' : ''}{t('{{n}} mo', { n: F.number(r.months) })}</span>
              </button>
            ))}
          </div>}
      <ShowAll total={v.rows.length} onOpen={toSuppliers(c)} attr="supplierFirst" />
      {v.unmatched > 0 && <TileFoot attr="unmatched">{t('Not checked (no client project, EPROM’s own need or no end date): {{n}}', { n: F.number(v.unmatched) })}</TileFoot>}
      <AssumedKey rules={v.rows.some(r => r.assumed) ? [t('where the client has several contracts, the supplier is matched to the one that runs longest')] : []} />
    </>
  );
}

/** S1 — live supplier spend per contractor: the top 5, then "Show all" on the Suppliers tab. */
export function S1Spend(c: ChartCtx) {
  const { data } = c;
  const { t, F, bidi, egpM } = useBdWords(data);
  const v = useMemo(() => spendByContractor(data), [data]);
  const max = Math.max(1, ...v.rows.map(r => r.totalEgp));
  const shown = v.rows.slice(0, TILE_FIRST);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="S1">
        <span>{t('Live supplier spend')}<b data-ac-fig="total">{v.assumedEgp > 0 ? '≈ ' : ''}{egpM(v.realEgp + v.assumedEgp)}</b></span>
        <span>{t('Contractors')}<b data-ac-fig="contractors">{F.number(v.rows.length)}</b></span>
      </div>
      {v.rows.length === 0
        ? <p className="bdc-empty">{t('No live supplier contract on file.')}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <div key={r.contractor || '-'} className="bdc-row" data-ac-row="spend" data-ac-key={r.contractor} title={t('Supplier contracts: {{n}}', { n: F.number(r.count) })}>
                <span className="bdc-name">{bidi(r.contractor || t('No contractor on file'))}</span>
                <Bar real={r.realEgp} assumed={r.assumedEgp} max={max} />
                <span className="bdc-num" data-bdc-value>{r.assumedEgp > 0 ? '≈ ' : ''}{egpM(r.totalEgp)}</span>
              </div>
            ))}
          </div>}
      <ShowAll total={v.rows.length} onOpen={toSuppliers(c)} attr="spend" />
      {v.leftOut > 0 && <TileFoot attr="currency">{t('In another currency, left out: {{n}}', { n: F.number(v.leftOut) })}</TileFoot>}
      <AssumedKey rules={v.usdLines > 0 ? [t('a contract in US dollars at {{rate}} EGP per dollar', { rate: F.number(ASSUMED_USD_EGP) })] : []} />
    </>
  );
}

/** S2 — the live EGP supplier contracts that grew most through amendments: the top 5, then "Show all" on the Suppliers tab. */
export function S2Growth(c: ChartCtx) {
  const { data, onClient } = c;
  const { t, F, nameOf, bidi } = useBdWords(data);
  const v = useMemo(() => {
    const g = amendmentGrowth(data, Infinity);
    const grown = g.rows.filter(r => r.growthPct > 0);
    const noOriginal = data.supplierContracts.filter(s => isLiveSupplier(s) && isEgpSupplier(s)
      && !(typeof s.originalValueEgp === 'number' && typeof s.currentValueEgp === 'number' && s.originalValueEgp > 0)).length;
    return { rows: grown, flat: g.rows.length - grown.length, noOriginal };
  }, [data]);
  const max = Math.max(1e-9, ...v.rows.map(r => r.growthPct));
  return (
    <>
      {v.rows.length === 0
        ? <p className="bdc-empty">{t('No live supplier contract grew in value.')}</p>
        : <div className="bdc-list">
            {v.rows.slice(0, TILE_FIRST).map(r => (
              <button key={r.id} type="button" className="bdc-row bdc-click" onClick={() => r.client && onClient(r.client)} data-ac-row="supplierGrowth" data-ac-key={r.id}
                title={[r.contractNo, r.client ? nameOf(r.client) : '', t('Amendments: {{n}}', { n: F.number(r.amendments) })].filter(Boolean).join(' · ')}>
                <span className="bdc-name">{bidi(r.contractor || r.contractNo)}</span>
                <span className="bdc-track"><span className="bdc-fill" style={{ width: `${(r.growthPct / max) * 100}%` }} /></span>
                <span className="bdc-num" data-bdc-value>+{F.number(r.growthPct, { maximumFractionDigits: 0 })}%</span>
              </button>
            ))}
          </div>}
      <ShowAll total={v.rows.length} onOpen={toSuppliers(c)} attr="supplierGrowth" />
      {v.flat > 0 && <TileFoot attr="flat">{t('Live contracts with no growth: {{n}}', { n: F.number(v.flat) })}</TileFoot>}
      {v.noOriginal > 0 && <TileFoot attr="noOriginal">{t('Live contracts with no value at signing on file: {{n}}', { n: F.number(v.noOriginal) })}</TileFoot>}
    </>
  );
}

/** S3 — the share of live supplier spend held by the 5 biggest contractors. */
export function S3Reliance({ data }: ChartCtx) {
  const { t, F, bidi } = useBdWords(data);
  const v = useMemo(() => topContractorShare(data), [data]);
  const ap = v.assumed ? '≈ ' : '';
  const pct = (x: number) => `${ap}${F.number(x, { maximumFractionDigits: 0 })}%`;
  if (!v.rows.length) return <p className="bdc-empty">{t('No live supplier contract on file.')}</p>;
  return (
    <>
      <div className="bdc-figs" data-ac-figs="S3">
        <span>{t('Held by the top {{n}}', { n: F.number(v.rows.length) })}<b data-ac-fig="top">{pct(v.topPct)}</b></span>
      </div>
      <div className="bdc-list">
        {v.rows.map(r => (
          <div key={r.contractor || '-'} className="bdc-row" data-ac-row="reliance" data-ac-key={r.contractor}>
            <span className="bdc-name">{bidi(r.contractor || t('No contractor on file'))}</span>
            <span className="bdc-track"><span className={`bdc-fill${r.assumedEgp > 0 ? ' ac-hatch' : ''}`} style={{ width: `${r.pct}%` }} /></span>
            <span className="bdc-num" data-bdc-value>{pct(r.pct)}</span>
          </div>
        ))}
        {v.others.count > 0 && (
          <div className="bdc-row" data-ac-row="reliance" data-ac-key="others">
            <span className="bdc-name"><span>{t('All others ({{n}})', { n: F.number(v.others.count) })}</span></span>
            <span className="bdc-track"><span className="bdc-fill bdc-fill-flat" style={{ width: `${v.others.pct}%` }} /></span>
            <span className="bdc-num" data-bdc-value>{pct(v.others.pct)}</span>
          </div>
        )}
      </div>
      <AssumedKey rules={v.assumed ? [t('a contract in US dollars at {{rate}} EGP per dollar', { rate: F.number(ASSUMED_USD_EGP) })] : []} />
    </>
  );
}

export const RENEW_SUPPLY_CHARTS: Record<string, (c: ChartCtx) => React.ReactElement> = {
  R1: c => <R1EndingSoon {...c} />,
  R2: c => <R2PastEnd {...c} />,
  R3: c => <R3SupplierFirst {...c} />,
  S1: c => <S1Spend {...c} />,
  S2: c => <S2Growth {...c} />,
  S3: c => <S3Reliance {...c} />,
};
