import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BENCHMARK_CLIENT, RENEWAL_BUCKETS, RENEWAL_KINDS, ceilingByClient, gradeChart, millions, rateGrid, rateWarnings,
  renewalTimeline, repriceList,
  type BdData, type Benchmark, type RenewalBucket, type RenewalKind, type RepriceWindow,
} from '../../lib/bdControl';
import { useFormat, DATE_MEDIUM } from '../../lib/format';
import OverviewMoreCharts from './OverviewMoreCharts';
import { GRADE_SHORT, useMasonry } from './shared';

interface Props {
  data: BdData;
  today: string;
  /** Opens a client's page (the browse tabs, E6a). */
  onClient: (code: string) => void;
}

/** Long lists start short. */
const FIRST = 10;

const BUCKET_LABEL: Record<RenewalBucket, string> = {
  overdue: 'Past their date', d30: 'Within 30 days', d90: '31 to 90 days', d180: '91 to 180 days',
  d365: '181 days to 1 year', later: 'More than a year', noDate: 'No end date on file',
};
const KIND_LABEL: Record<RenewalKind, string> = {
  client: 'Client contracts', supplier: 'Supplier contracts', agibaSite: 'AGIBA site contracts',
};
const KIND_ONE: Record<RenewalKind, string> = {
  client: 'Client contract', supplier: 'Supplier contract', agibaSite: 'AGIBA site contract',
};
const WINDOW_LABEL: Record<RepriceWindow, string> = {
  overdue: 'Expired on paper — reset rates in the renewal now',
  within180: 'Renewal within 6 months — put rates on the table',
  within365: 'Renews within a year — prepare the rate case',
  later: 'Next window at renewal',
  noDate: 'No expiry on file — raise at the next price review',
};

/** A gap this far below the benchmark is red / amber on the bars and pills. */
const gapTone = (g: number | null) => (g == null ? '' : g <= -25 ? 'lo' : g <= -10 ? 'mid' : g >= 10 ? 'hi' : '');

/**
 * BD control Overview charts 3–6 (queue E5b): contract ceiling by client, the
 * renewal timeline, day-rates against a benchmark, and the reprice-at-renewal
 * list. Every bar and figure comes from lib/bdControl.ts, worked out from the
 * rows as of today. A client row opens the client page (E6a). Charts 7–12
 * (E5c) sit in the same grid, from
 * OverviewMoreCharts.tsx.
 */
export default function OverviewCharts({ data, today, onClient }: Props) {
  const { t, i18n } = useTranslation();
  const F = useFormat();
  const ar = i18n.language === 'ar';
  const packed = useMasonry<HTMLDivElement>();
  const sep = ar ? '، ' : ', ';

  const ceil = useMemo(() => ceilingByClient(data), [data]);
  const tl = useMemo(() => renewalTimeline(data, today), [data, today]);
  const grid = useMemo(() => rateGrid(data.dayRates), [data.dayRates]);
  const warns = useMemo(() => rateWarnings(data), [data]);
  const reprice = useMemo(() => repriceList(data, today, grid), [data, today, grid]);

  const [allCeil, setAllCeil] = useState(false);
  const [gradePick, setGrade] = useState<string | null>(null);
  const [bench, setBench] = useState<Benchmark>('anopc');
  const grade = gradePick && grid.grades.includes(gradePick) ? gradePick : grid.grades[0];
  const gc = useMemo(() => (grade ? gradeChart(grid, grade, bench) : { base: null, rows: [] }), [grid, grade, bench]);

  const names = useMemo(() => new Map(data.clients.map(c => [c.code, c.arabicName || ''])), [data.clients]);
  const nameOf = (code: string) => (ar && names.get(code)) || code;
  const pct = (v: number | null) => v == null ? ''
    : `${v > 0.05 ? '+' : v < -0.05 ? '−' : ''}${F.number(Math.abs(v), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const egpM = (egp: number) => t('{{value}} m EGP', { value: F.number(millions(egp), { maximumFractionDigits: 1 }) });
  const ends = (end: string | null, days: number | null) =>
    days == null || !end ? t('No expiry on file')
      : days === 0 ? t('Ends today')
        : days > 0 ? t('Ends {{date}} · days remaining: {{days}}', { date: F.date(end, DATE_MEDIUM), days: F.number(days) })
          : t('Ended {{date}} · {{n}} days ago', { date: F.date(end, DATE_MEDIUM), n: F.number(-days) });
  const warn = (code: string) => warns.has(code) && (
    <span className="bdc-warn" title={warns.get(code)!.join(' | ')} data-bdc-warn={code} aria-label={t('Odd value on the rate sheet')}>⚠</span>
  );

  const section = (title: string, attr: string, sub: string | null, body: React.ReactNode) => (
    <section className="card bdc-card" data-bdc={attr}>
      <h2 className="bdc-h">{title}</h2>
      {sub && <p className="bdc-cap">{sub}</p>}
      {body}
    </section>
  );

  // 3 — ceiling by client
  const ceilRows = allCeil ? ceil.rows : ceil.rows.slice(0, FIRST);
  const ceilMax = Math.max(1, ...ceil.rows.map(r => r.ceilingEgp));
  const chart3 = section(t('Contract ceiling by client'), 'ceiling', t('Biggest first · lines with a ceiling only'), (
    <>
      {ceil.rows.length === 0
        ? <p className="bdc-empty" data-bdc-empty="ceiling">{t('No client line has a ceiling on file.')}</p>
        : <div className="bdc-list">
            {ceilRows.map(r => (
              <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-bdc-row="ceiling" data-bdc-key={r.client}>
                <span className="bdc-name">
                  <span className={F.bidiFor(nameOf(r.client))}>{nameOf(r.client)}</span>
                  <span className="bdc-sub">{t('{{types}} · lines: {{n}}', { types: r.types.join(sep) || '—', n: F.number(r.lines) })}</span>
                </span>
                <span className="bdc-track"><span className="bdc-fill" style={{ width: `${(r.ceilingEgp / ceilMax) * 100}%` }} /></span>
                <span className="bdc-num" data-bdc-value>{egpM(r.ceilingEgp)}</span>
              </button>
            ))}
          </div>}
      {ceil.rows.length > FIRST && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAllCeil(v => !v)} data-bdc-more="ceiling" style={{ marginTop: 6 }}>
          {allCeil ? t('Show fewer') : t('Show all {{count}}', { count: ceil.rows.length })}
        </button>
      )}
      {ceil.monthlyOnly.length > 0 && <p className="bdc-foot" data-bdc-foot="monthly">{t('Paid by the month, not in this chart: {{list}}', { list: ceil.monthlyOnly.map(nameOf).join(sep) })}</p>}
      {ceil.noValue.length > 0 && <p className="bdc-foot" data-bdc-foot="novalue">{t('No ceiling or value on file: {{list}}', { list: ceil.noValue.map(nameOf).join(sep) })}</p>}
    </>
  ));

  // 4 — renewal timeline
  const shown = (it: { kind: RenewalKind; name: string }) => (it.kind === 'client' ? nameOf(it.name) : it.name);
  const tlMax =Math.max(1, ...RENEWAL_BUCKETS.map(b => tl.buckets[b].total));
  const chart4 = section(t('When contracts come up for renewal'), 'renewals', t('Counted from today · stacked by kind of contract'), (
    <>
      <ul className="bdc-legend">
        {RENEWAL_KINDS.map(k => <li key={k} data-bdc-legend={k}><span className={`bdc-key bdc-${k}`} aria-hidden />{t(KIND_LABEL[k])}</li>)}
      </ul>
      <div className="bdc-list">
        {RENEWAL_BUCKETS.map(b => {
          const x = tl.buckets[b];
          return (
            <div key={b} className={`bdc-row${x.total === 0 ? ' bdc-zero' : ''}`} data-bdc-row="bucket" data-bdc-key={b}>
              <span className="bdc-name">
                <span className={b === 'overdue' && x.total > 0 ? 'bdc-red' : undefined}>{t(BUCKET_LABEL[b])}</span>
                {x.total > 0 && <span className="bdc-sub">{t('Client {{a}} · supplier {{b}} · AGIBA site {{c}}', { a: F.number(x.client), b: F.number(x.supplier), c: F.number(x.agibaSite) })}</span>}
              </span>
              <span className="bdc-track">
                <span className="bdc-stack" style={{ width: `${(x.total / tlMax) * 100}%` }}>
                  {RENEWAL_KINDS.filter(k => x[k] > 0).map(k => <span key={k} className={`bdc-seg bdc-${k}`} style={{ flexGrow: x[k] }} data-bdc-seg={k} />)}
                </span>
              </span>
              <span className="bdc-num" data-bdc-value>{F.number(x.total)}</span>
            </div>
          );
        })}
      </div>
      <h3 className="bdc-h3">{t('Next to come up')}</h3>
      {tl.next.length === 0
        ? <p className="bdc-empty" data-bdc-empty="next">{t('Nothing is due from today on.')}</p>
        : <div className="bdc-list">
            {tl.next.map(it => (
              <div key={it.kind + it.id} className={`bdc-row bdc-row-dated${it.kind === 'client' ? ' bdc-click' : ''}`} data-bdc-row="next" data-bdc-key={it.name}
                {...(it.kind === 'client' ? { role: 'button', tabIndex: 0, onClick: () => onClient(it.name),
                  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClient(it.name); } } } : {})}>
                <span className="bdc-name">
                  <span><span className={`bdc-key bdc-${it.kind}`} aria-hidden /> <span className={F.bidiFor(shown(it))}>{shown(it)}</span></span>
                  <span className="bdc-sub">{[t(KIND_ONE[it.kind]), it.sub].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="bdc-when">{ends(it.end, it.days)}</span>
              </div>
            ))}
          </div>}
    </>
  ));

  // 5 — day-rates against a benchmark
  const gcMax = Math.max(1, ...gc.rows.map(r => r.rate), gc.base ?? 0) * 1.04;
  const benchName = bench === 'anopc' ? nameOf(BENCHMARK_CLIENT) : t('Median client');
  const chart5 = section(t('Day-rate by client'), 'rates', t('EGP per man-day, from the CSA daily-rates sheet'), grid.grades.length === 0
    ? <p className="bdc-empty" data-bdc-empty="rates">{t('No day-rate sheet has been loaded.')}</p>
    : <>
        <div className="bdc-chips" role="group" aria-label={t('Grade')}>
          {grid.grades.map(g => (
            <button key={g} type="button" className="bdc-chip" aria-pressed={g === grade} onClick={() => setGrade(g)} data-bdc-grade={g}>
              {GRADE_SHORT[g] ? t(GRADE_SHORT[g]) : g}
            </button>
          ))}
        </div>
        <div className="bdc-chips" role="group" aria-label={t('Compare to')}>
          <span className="bdc-chips-label">{t('Compare to')}</span>
          <button type="button" className="bdc-chip" aria-pressed={bench === 'anopc'} onClick={() => setBench('anopc')} data-bdc-bench="anopc">{nameOf(BENCHMARK_CLIENT)}</button>
          <button type="button" className="bdc-chip" aria-pressed={bench === 'median'} onClick={() => setBench('median')} data-bdc-bench="median">{t('Median client')}</button>
        </div>
        <p className="bdc-cap" data-bdc="base">
          {gc.base == null ? t('No benchmark rate for this grade.')
            : t('{{name}}: {{value}} EGP per man-day', { name: benchName, value: F.number(gc.base, { maximumFractionDigits: 1 }) })}
        </p>
        <div className="bdc-list">
          {gc.rows.map(r => {
            const isBase = bench === 'anopc' && r.client === BENCHMARK_CLIENT;
            return (
              <button key={r.client} type="button" className="bdc-row bdc-row-rate bdc-click" onClick={() => onClient(r.client)} data-bdc-row="rate" data-bdc-key={r.client}>
                <span className="bdc-name"><span><span className={F.bidiFor(nameOf(r.client))}>{nameOf(r.client)}</span>{warn(r.client)}</span></span>
                <span className="bdc-track bdc-track-mark">
                  <span className={`bdc-fill bdc-fill-${gapTone(isBase ? null : r.gap) || 'base'}`} style={{ width: `${(r.rate / gcMax) * 100}%` }} />
                  {gc.base != null && <span className="bdc-mark" style={{ insetInlineStart: `${(gc.base / gcMax) * 100}%` }} aria-hidden />}
                </span>
                <span className="bdc-num" data-bdc-value>{F.number(r.rate, { maximumFractionDigits: 1 })}</span>
                <span className={`bdc-gap bdc-gap-${gapTone(isBase ? null : r.gap) || 'flat'}`} data-bdc-gap>{isBase ? t('benchmark') : pct(r.gap)}</span>
              </button>
            );
          })}
        </div>
        <ul className="bdc-legend">
          <li><span className="bdc-key bdc-key-mark" aria-hidden />{benchName}</li>
          <li><span className="bdc-key bdc-fill-lo" aria-hidden />{t('25%+ below')}</li>
          <li><span className="bdc-key bdc-fill-mid" aria-hidden />{t('10–25% below')}</li>
          <li><span className="bdc-key bdc-fill-base" aria-hidden />{t('Within 10% or above')}</li>
          {warns.size > 0 && <li>{t('⚠ = odd value on the rate sheet — confirm it before quoting')}</li>}
        </ul>
      </>);

  // 6 — reprice at renewal
  const chart6 = section(t('Reprice at renewal'), 'reprice',
    t('Clients paying 10%+ below {{name}} on average, the soonest renewal first', { name: nameOf(BENCHMARK_CLIENT) }), (
    <>
      {reprice.length === 0
        ? <p className="bdc-empty" data-bdc-empty="reprice">{t('No client pays 10% or more below {{name}}.', { name: nameOf(BENCHMARK_CLIENT) })}</p>
        : <div className="bdc-list">
            {reprice.map(r => (
              <button key={r.client} type="button" className="bdc-row bdc-row-reprice bdc-click" onClick={() => onClient(r.client)} data-bdc-row="reprice" data-bdc-key={r.client}>
                <span className="bdc-name">
                  <span><span className={F.bidiFor(nameOf(r.client))}>{nameOf(r.client)}</span>{warn(r.client)}</span>
                  <span className="bdc-sub">{[r.line?.contractType, r.line?.status].filter(Boolean).join(' · ') || t('No client line on file')}</span>
                </span>
                <span className="bdc-reprice-figs">
                  <span className={`bdc-gap bdc-gap-${gapTone(r.gapPct) || 'flat'}`} data-bdc-gap>{pct(r.gapPct)}</span>
                  <span className="bdc-sub" data-bdc-perday>{t('{{n}} EGP below per man-day', { n: F.number(r.belowPerDay, { maximumFractionDigits: 0 }) })}</span>
                </span>
                <span className="bdc-reprice-when">
                  <span className={`bdc-window bdc-window-${r.window}`} data-bdc-window={r.window}>{t(WINDOW_LABEL[r.window])}</span>
                  <span className="bdc-sub">{ends(r.line?.expiryDate || null, r.days)}</span>
                </span>
              </button>
            ))}
          </div>}
      <p className="bdc-foot">{t('Gap = average over the grades on the sheet. The money effect needs man-days per grade, which the files do not hold yet.')}</p>
    </>
  ));

  return (
    <div ref={packed} className="bdc bdc-grid" data-bd="charts">
      {chart3}
      {chart4}
      {chart5}
      {chart6}
      <OverviewMoreCharts data={data} today={today} />
    </div>
  );
}
