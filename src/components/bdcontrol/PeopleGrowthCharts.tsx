import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BENCHMARK_CLIENT, gradeChart, rateGrid, rateWarnings } from '../../lib/bdControl';
import { NO_NEW_WORK_MONTHS, lastNewWork, levelValues, ratesVsMarket, serviceGaps } from '../../lib/analysisCenter';
import { GRADE_SHORT, ShowAll, TILE_FIRST, TileFoot, useBdWords } from './shared';
import { AssumedKey, Bar } from './MoneyAmendCharts';
import type { ChartCtx } from './ProjectCharts';

// Analysis center, queue A4: People (H3), Growth (G1, G4) and Opportunity cost
// (O2). Same rules as A2/A3: figures from the live rows as of today; an assumed
// figure is hatched and marked "≈", the key under the chart states the rule.

const FIRST = 10;

function ShowMore({ total, all, onToggle, attr }: { total: number; all: boolean; onToggle: () => void; attr: string }) {
  const { t } = useTranslation();
  if (total <= FIRST) return null;
  return (
    <button type="button" className="btn btn-ghost btn-sm ac-more" onClick={onToggle} data-ac-more={attr}>
      {all ? t('Show fewer') : t('Show all {{count}}', { count: total })}
    </button>
  );
}

/**
 * H3 — per grade, our clients' median day rate against the reference client:
 * the first 5 grades, then "Show all" on the Pricing tab. A grade opens its
 * clients in place of the grade list (both lists would overflow the tile).
 */
export function H3RatesVsMarket({ data, onClient, onPricing }: ChartCtx) {
  const { t, F, nameOf, bidi, sep, pct, gapTone } = useBdWords(data);
  const grid = useMemo(() => rateGrid(data.dayRates), [data.dayRates]);
  const v = useMemo(() => ratesVsMarket(data, grid), [data, grid]);
  const warns = useMemo(() => rateWarnings(data), [data]);
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...v.rows.flatMap(r => [r.median ?? 0, r.reference ?? 0])) * 1.04;
  const per = open ? gradeChart(grid, open, 'anopc') : null;
  const perMax = Math.max(1, ...(per?.rows.map(r => r.rate) || []), per?.base ?? 0) * 1.04;
  const ref = nameOf(BENCHMARK_CLIENT);
  const gradeName = (g: string) => (GRADE_SHORT[g] ? t(GRADE_SHORT[g]) : g);
  const egpDay = (x: number) => F.number(x, { maximumFractionDigits: 0 });
  if (!v.rows.length) return <p className="bdc-empty">{t('No day-rate sheet has been loaded.')}</p>;
  return (
    <>
      <div className="bdc-list">
        {(open ? v.rows.filter(r => r.grade === open) : v.rows.slice(0, TILE_FIRST)).map(r => (
          <button key={r.grade} type="button" className="bdc-row bdc-row-rate bdc-click" aria-expanded={open === r.grade}
            onClick={() => setOpen(o => (o === r.grade ? null : r.grade))} data-ac-row="grade" data-ac-key={r.grade}>
            <span className="bdc-name">{bidi(gradeName(r.grade))}
              <span className="bdc-sub ac-wrap">
                {r.reference != null
                  ? t('{{name}}: {{value}} · clients: {{n}}', { name: ref, value: egpDay(r.reference), n: F.number(r.clients) })
                  : t('No {{name}} rate · clients: {{n}}', { name: ref, n: F.number(r.clients) })}
              </span>
            </span>
            <span className="bdc-track bdc-track-mark">
              <span className={`bdc-fill bdc-fill-${r.gap == null || gapTone(r.gap) === 'flat' || gapTone(r.gap) === 'hi' ? 'base' : gapTone(r.gap)}`}
                style={{ width: `${((r.median ?? 0) / max) * 100}%` }} />
              {r.reference != null && <span className="bdc-mark" style={{ insetInlineStart: `${(r.reference / max) * 100}%` }} aria-hidden />}
            </span>
            <span className="bdc-num" data-bdc-value>{r.median == null ? '—' : egpDay(r.median)}</span>
            <span className={`bdc-gap bdc-gap-${gapTone(r.gap)}`} data-ac-gap>{pct(r.gap)}</span>
          </button>
        ))}
      </div>
      {per && (
        <div className="bdc-list ac-sublist" data-ac-list={open}>
          {per.rows.slice(0, TILE_FIRST).map(r => {
            const isRef = r.client === BENCHMARK_CLIENT;
            return (
              <button key={r.client} type="button" className="bdc-row bdc-row-rate bdc-click ac-subrow" onClick={() => onClient(r.client)} data-ac-row="gradeClient" data-ac-key={r.client}>
                <span className="bdc-name"><span>{bidi(nameOf(r.client))}{warns.has(r.client) && <span className="bdc-warn" title={warns.get(r.client)!.join(' | ')} data-ac-warn={r.client} aria-label={t('Odd value on the rate sheet')}>⚠</span>}</span></span>
                <span className="bdc-track bdc-track-mark">
                  <span className={`bdc-fill bdc-fill-${isRef || gapTone(r.gap) === 'flat' || gapTone(r.gap) === 'hi' ? 'base' : gapTone(r.gap)}`} style={{ width: `${(r.rate / perMax) * 100}%` }} />
                  {per.base != null && <span className="bdc-mark" style={{ insetInlineStart: `${(per.base / perMax) * 100}%` }} aria-hidden />}
                </span>
                <span className="bdc-num" data-bdc-value>{egpDay(r.rate)}</span>
                <span className={`bdc-gap bdc-gap-${isRef ? 'flat' : gapTone(r.gap)}`} data-ac-gap>{isRef ? t('benchmark') : pct(r.gap)}</span>
              </button>
            );
          })}
        </div>
      )}
      {onPricing && <ShowAll total={per ? per.rows.length : v.rows.length} onOpen={onPricing} attr={per ? 'gradeClient' : 'grade'} />}
      <ul className="bdc-legend">
        <li><span className="bdc-key bdc-key-mark" aria-hidden />{ref}</li>
        <li><span className="bdc-key bdc-fill-lo" aria-hidden />{t('25%+ below')}</li>
        <li><span className="bdc-key bdc-fill-mid" aria-hidden />{t('10–25% below')}</li>
      </ul>
      {v.below.length > 0 && (
        <TileFoot attr="below">{t('Paying 10%+ below {{name}} on average — reprice at renewal: {{list}}', { name: ref, list: v.below.map(nameOf).join(sep) })}</TileFoot>
      )}
    </>
  );
}

/** O2 — the median day rate per competency level, with the lowest and highest. */
export function O2LevelValue({ data }: ChartCtx) {
  const { t, F, sep } = useBdWords(data);
  const v = useMemo(() => levelValues(data.dayRates), [data.dayRates]);
  const max = Math.max(1, ...v.rows.map(r => r.median));
  const gradeName = (g: string) => (GRADE_SHORT[g] ? t(GRADE_SHORT[g]) : g);
  const egpDay = (x: number) => F.number(x, { maximumFractionDigits: 0 });
  if (!v.rows.length) return <p className="bdc-empty">{t('No day-rate sheet has been loaded.')}</p>;
  return (
    <>
      <div className="bdc-list">
        {v.rows.map(r => (
          <div key={r.level} className="bdc-row" data-ac-row="level" data-ac-key={r.level}>
            <span className="bdc-name"><span>{t('Level {{n}}', { n: F.number(r.level) })} · {r.grades.map(gradeName).join(sep)}</span>
              <span className="bdc-sub ac-wrap">{t('Lowest {{low}} · highest {{high}} · clients: {{n}}', { low: egpDay(r.low), high: egpDay(r.high), n: F.number(r.clients) })}</span>
            </span>
            <Bar real={r.assumed ? 0 : r.median} assumed={r.assumed ? r.median : 0} max={max} />
            <span className="bdc-num" data-bdc-value>{r.assumed ? '≈ ' : ''}{t('{{value}} EGP', { value: egpDay(r.median) })}</span>
          </div>
        ))}
      </div>
      {v.noLevel.length > 0 && <p className="bdc-foot" data-ac-foot="noLevel">{t('Grades with no level on the rate sheet: {{list}}', { list: v.noLevel.map(gradeName).join(sep) })}</p>}
      <AssumedKey rules={v.rows.some(r => r.assumed) ? [t('each grade is taken as one competency level, by the level number on the day-rate sheet')] : []} />
    </>
  );
}

/** G1 — per client, the services on our list it does not buy from us yet. */
export function G1ServiceGaps({ data, onClient }: ChartCtx) {
  const { t, F, nameOf, bidi, sep } = useBdWords(data);
  const v = useMemo(() => serviceGaps(data), [data]);
  const [all, setAll] = useState(false);
  const max = Math.max(1, v.list.length);
  const shown = all ? v.rows : v.rows.slice(0, FIRST);
  if (!v.list.length) return <p className="bdc-empty">{t('No project lines on file.')}</p>;
  return (
    <>
      <div className="bdc-figs" data-ac-figs="G1">
        <span>{t('Services on our list')}<b data-ac-fig="list">{`≈ ${F.number(v.list.length)}`}</b></span>
        <span>{t('Clients who could buy more')}<b data-ac-fig="clients">{F.number(v.rows.length)}</b></span>
      </div>
      {v.rows.length === 0
        ? <p className="bdc-empty" data-ac-empty="serviceGaps">{t('Every client already buys every service on our list.')}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="serviceGap" data-ac-key={r.client}>
                <span className="bdc-name">{bidi(nameOf(r.client))}
                  <span className="bdc-sub ac-wrap" data-ac-could>{t('Could add: {{list}}', { list: r.couldAdd.map(x => t(x)).join(sep) })}</span>
                  <span className="bdc-sub ac-wrap">{t('Buys today: {{list}}', { list: r.buys.length ? r.buys.map(x => t(x)).join(sep) : '—' })}</span>
                </span>
                <Bar real={0} assumed={r.couldAdd.length} max={max} />
                <span className="bdc-num" data-bdc-value>≈ {F.number(r.couldAdd.length)}</span>
              </button>
            ))}
          </div>}
      <ShowMore total={v.rows.length} all={all} onToggle={() => setAll(x => !x)} attr="serviceGap" />
      {v.full > 0 && <p className="bdc-foot" data-ac-foot="full">{t('Clients who already buy every service on our list: {{n}}', { n: F.number(v.full) })}</p>}
      <AssumedKey rules={[t('our service list = the contract forms our clients hold today ({{list}})', { list: v.list.map(x => t(x)).join(sep) })]} />
    </>
  );
}

/** G4 — clients whose newest work with us started 12+ months ago, longest first. */
export function G4NoNewWork({ data, today, onClient }: ChartCtx) {
  const { t, F, nameOf, bidi, sep, date } = useBdWords(data);
  const v = useMemo(() => lastNewWork(data, today), [data, today]);
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...v.rows.map(r => r.months));
  const shown = all ? v.rows : v.rows.slice(0, FIRST);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="G4">
        <span>{t('No new work in {{n}} months', { n: F.number(NO_NEW_WORK_MONTHS) })}<b data-ac-fig="stale">{F.number(v.rows.length)}</b></span>
        <span>{t('New work in the last {{n}} months', { n: F.number(NO_NEW_WORK_MONTHS) })}<b data-ac-fig="recent">{F.number(v.recent)}</b></span>
      </div>
      {v.rows.length === 0
        ? <p className="bdc-empty" data-ac-empty="noNewWork">{t('Every client with a start date on file gave us new work in the last {{n}} months.', { n: F.number(NO_NEW_WORK_MONTHS) })}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="noNewWork" data-ac-key={r.client}>
                <span className="bdc-name">{bidi(nameOf(r.client))}<span className="bdc-sub ac-wrap">{t('Latest start: {{date}}', { date: date(r.start) })}</span></span>
                <Bar real={r.assumed ? 0 : r.months} assumed={r.assumed ? r.months : 0} max={max} />
                <span className="bdc-num" data-bdc-value>{r.assumed ? '≈ ' : ''}{t('{{n}} mo', { n: F.number(r.months) })}</span>
              </button>
            ))}
          </div>}
      <ShowMore total={v.rows.length} all={all} onToggle={() => setAll(x => !x)} attr="noNewWork" />
      {v.noDate.length > 0 && <p className="bdc-foot" data-ac-foot="noDate">{t('No start date on file: {{list}}', { list: v.noDate.map(nameOf).join(sep) })}</p>}
      <AssumedKey rules={v.rows.some(r => r.assumed) ? [t('where a client’s contract has no start date, its newest work = the newest supplier contract we signed for that client')] : []} />
    </>
  );
}

export const PEOPLE_GROWTH_CHARTS: Record<string, (c: ChartCtx) => React.ReactElement> = {
  H3: c => <H3RatesVsMarket {...c} />,
  G1: c => <G1ServiceGaps {...c} />,
  G4: c => <G4NoNewWork {...c} />,
  O2: c => <O2LevelValue {...c} />,
};
