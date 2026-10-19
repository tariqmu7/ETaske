import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BENCHMARK_CLIENT, pricingRows, rateGrid, rateWarnings, type BdData, type Benchmark } from '../../lib/bdControl';
import { Chips, GRADE_SHORT, useBdWords } from './shared';

interface Props {
  data: BdData;
  today: string;
  bench: Benchmark;
  onBench: (b: Benchmark) => void;
  onClient: (code: string) => void;
}

/**
 * Pricing tab (queue E6a): the whole CSA day-rate sheet as one grid — a row per
 * client, a column per grade — every cell coloured by its gap to ANOPC or to
 * the median client. Clients furthest below come first; a name opens the
 * client page.
 */
export default function PricingTab({ data, bench, onBench, onClient }: Props) {
  const w = useBdWords(data);
  const { t } = useTranslation();
  const { F } = w;
  const grid = useMemo(() => rateGrid(data.dayRates), [data.dayRates]);
  const warns = useMemo(() => rateWarnings(data), [data]);
  const pr = useMemo(() => pricingRows(grid, bench), [grid, bench]);
  const benchName = bench === 'anopc' ? w.nameOf(BENCHMARK_CLIENT) : t('Median client');
  const rate = (v: number | null) => (v == null ? '—' : F.number(v, { maximumFractionDigits: 0 }));

  return (
    <section className="card bdc-card" data-bdc-tab="pricing">
      <h2 className="bdc-h">{t('Day-rate grid')}</h2>
      <p className="bdc-cap">{t('EGP per man-day, from the CSA daily-rates sheet · the clients furthest below the benchmark first')}</p>
      {grid.grades.length === 0
        ? <p className="bdc-empty" data-bdc-empty="pricing">{t('No day-rate sheet has been loaded.')}</p>
        : <>
            <Chips attr="bench" label={t('Compare to')} value={bench} onChange={onBench}
              options={[{ key: 'anopc' as Benchmark, label: w.nameOf(BENCHMARK_CLIENT) }, { key: 'median' as Benchmark, label: t('Median client') }]} />
            <div className="bdc-scroll" data-bdc="pricing-scroll">
              <table className="bdc-table" data-bdc="pricing-grid">
                <thead>
                  <tr>
                    <th scope="col">{t('Client')}</th>
                    {grid.grades.map(g => <th key={g} scope="col" className="bdc-numcol" data-bdc-grade-col={g}>{GRADE_SHORT[g] ? t(GRADE_SHORT[g]) : g}</th>)}
                    <th scope="col" className="bdc-numcol">{t('Average gap')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bdc-benchrow" data-bdc-row="benchrow">
                    <th scope="row">{benchName}</th>
                    {pr.base.map(b => <td key={b.grade} className="bdc-numcol">{rate(b.rate)}</td>)}
                    <td className="bdc-numcol">{t('benchmark')}</td>
                  </tr>
                  {pr.rows.map(r => (
                    <tr key={r.client} data-bdc-row="price" data-bdc-key={r.client}>
                      <th scope="row">
                        <button type="button" className="bdc-link" onClick={() => onClient(r.client)} data-bdc-open={r.client}>{w.bidi(w.nameOf(r.client))}</button>
                        {warns.has(r.client) && <span className="bdc-warn" title={warns.get(r.client)!.join(' | ')} data-bdc-warn={r.client} aria-label={t('Odd value on the rate sheet')}>⚠</span>}
                      </th>
                      {r.cells.map(c => (
                        <td key={c.grade} className={`bdc-numcol bdc-cell-${c.rate == null ? 'none' : w.gapTone(c.gap)}`} data-bdc-cell={c.grade}
                          title={c.gap == null ? undefined : w.pct(c.gap)}>
                          {rate(c.rate)}
                          {c.rate != null && c.gap != null && Math.abs(c.gap) >= 0.05 && <span className="bdc-cellgap">{w.pct(c.gap)}</span>}
                        </td>
                      ))}
                      <td className={`bdc-numcol bdc-gap bdc-gap-${w.gapTone(r.avgGap)}`} data-bdc-avg>{w.pct(r.avgGap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="bdc-legend">
              <li><span className="bdc-key bdc-fill-lo" aria-hidden />{t('25%+ below')}</li>
              <li><span className="bdc-key bdc-fill-mid" aria-hidden />{t('10–25% below')}</li>
              <li><span className="bdc-key bdc-hi-key" aria-hidden />{t('10%+ above')}</li>
              <li>{t('— = no rate on the sheet')}</li>
              {warns.size > 0 && <li>{t('⚠ = odd value on the rate sheet — confirm it before quoting')}</li>}
            </ul>
          </>}
    </section>
  );
}
