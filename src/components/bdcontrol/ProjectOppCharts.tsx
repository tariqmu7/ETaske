import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { millions } from '../../lib/bdControl';
import {
  ASSUMED_BENCH_SHARE, ASSUMED_USD_EGP, STAFF_CATEGORY_SPLIT, UNDER_PLACED_SHARE, WORK_DAYS_PER_PERSON,
  benchLossByQuarter, bidsWonLost, opportunityCost, paperDelays, projectsByArea, staffByCategory, staffByLevel, turnedDownByQuarter,
  underPlacement, valuePerPerson,
  type Area, type ClosedBid, type LevelStaff, type PaperKind, type StaffCategory,
} from '../../lib/analysisCenter';
import { GRADE_SHORT, ShowAll, TILE_FIRST, TileFoot, useBdWords } from './shared';
import { AssumedKey, Bar } from './MoneyAmendCharts';
import { HatchBar, useMoneyRules } from './MoneyCharts';
import { useStaffRules } from './PeopleRiskCharts';
import type { ChartCtx } from './ProjectCharts';

// Analysis center, queue A7c: the last ten grey boxes — Projects P5, P7, P8,
// Amendments A6 and Opportunity cost O1, O3–O7. P7 and O6 read the app's own
// bids, A6 the report copies and end dates; the rest are ASSUMED by the rules in
// lib/analysisCenter.ts (agreed with Tariq, 20 Oct 2026) — hatched, marked "≈",
// the rules spelled out under each chart.

const pct = (x: number) => Math.round(x * 100);

/** The bid register's loading / error sentence, or null once the bids are in. */
function useBidState(bids: ChartCtx['bids']) {
  const { t } = useTranslation();
  if (bids === 'error') return <p className="bdc-empty" data-ac-empty="bidsError">{t('The bid register could not be read. Reload the page.')}</p>;
  if (!bids) return <p className="bdc-empty" data-ac-empty="bidsLoading">{t('Reading the bid register…')}</p>;
  return null;
}

/** Columns per quarter, each a stack of parts (bottom part first), the total on top in m EGP. */
function QuarterStack({ data, rows, label, attr }: {
  data: ChartCtx['data']; rows: { quarter: string; parts: { v: number; cls: string }[]; approx: boolean }[]; label: string; attr: string;
}) {
  const { t, F } = useBdWords(data);
  const sum = (r: (typeof rows)[number]) => r.parts.reduce((a, p) => a + p.v, 0);
  const max = Math.max(1e-9, ...rows.map(sum));
  const m1 = (x: number) => F.number(millions(x), { maximumFractionDigits: 1 });
  return (
    <div className="ac-cols" style={{ ['--ac-n' as string]: rows.length }} role="img" aria-label={label}>
      {rows.map(r => {
        const n = sum(r);
        return (
          <div key={r.quarter} className="ac-col" data-ac-row={attr} data-ac-key={r.quarter}>
            <b className={`ac-col-n${n ? '' : ' bdc-zero'}`} data-bdc-value>{r.approx && n ? '≈ ' : ''}{m1(n)}</b>
            <span className="ac-col-bar">
              {[...r.parts].reverse().map((p, i) => p.v > 0 && (
                <span key={i} className={p.cls} style={{ height: `${(p.v / max) * 100}%` }} {...(p.cls.includes('ac-hatch') ? { 'data-ac-assumed-seg': '' } : {})} />
              ))}
            </span>
            <span className="ac-col-l">{t('Q{{q}}', { q: F.number(Number(r.quarter.slice(-1))) })}<br />{r.quarter.slice(0, 4)}</span>
          </div>
        );
      })}
    </div>
  );
}

const AREA_NAME: Record<Area, string> = { upstream: 'Upstream', midstream: 'Midstream', downstream: 'Downstream' };
const AREA_LABEL: Record<Area, string> = { upstream: 'Exploration and production', midstream: 'Gas, pipelines and terminals', downstream: 'Refining and petrochemicals' };

/** P5 — project lines per area. */
export function P5Areas({ data }: ChartCtx) {
  const { t, F, nameOf, sep } = useBdWords(data);
  const v = useMemo(() => projectsByArea(data), [data]);
  const max = Math.max(1, ...v.rows.map(r => r.count));
  if (!v.total) return <p className="bdc-empty">{t('No project lines on file.')}</p>;
  return (
    <>
      <div className="bdc-list">
        {v.rows.map(r => (
          <div key={r.area} className="bdc-row" data-ac-row="area" data-ac-key={r.area}>
            <span className="bdc-name"><span>{t(AREA_NAME[r.area])}</span>
              <span className="bdc-sub ac-wrap">{t(AREA_LABEL[r.area])} · {t('{{pct}}% of projects', { pct: F.number(v.total ? (r.count / v.total) * 100 : 0, { maximumFractionDigits: 0 }) })}</span>
            </span>
            <Bar real={r.count - r.assumed} assumed={r.assumed} max={max} />
            <span className={`bdc-num${r.count ? '' : ' bdc-zero'}`} data-bdc-value>{r.assumed ? '≈ ' : ''}{F.number(r.count)}</span>
          </div>
        ))}
      </div>
      {v.unknown.length > 0 && <TileFoot attr="unknown">{t('Area not known (works across the chain, or not read from the name): {{list}}', { list: v.unknown.map(nameOf).join(sep) })}</TileFoot>}
      <AssumedKey rules={v.rows.some(r => r.assumed) ? [t('a project takes its client’s main business: refining and petrochemicals = downstream; gas, pipelines and terminals = midstream; exploration and production = upstream')] : []} />
    </>
  );
}

/** P7 — bids won vs lost per quarter, from the app's bid register. */
export function P7WinLoss({ data, today, bids }: ChartCtx) {
  const { t, F, egpM, sep } = useBdWords(data);
  const v = useMemo(() => (Array.isArray(bids) ? bidsWonLost(bids as ClosedBid[], today) : null), [bids, today]);
  const wait = useBidState(bids);
  if (wait || !v) return wait;
  const max = Math.max(1, ...v.rows.flatMap(r => [r.won, r.lost]));
  const closed = v.won + v.lost;
  const foot = [
    v.earlier > 0 ? t('Decided before these quarters: {{n}}', { n: F.number(v.earlier) }) : '',
    v.noDate > 0 ? t('No date on file: {{n}}', { n: F.number(v.noDate) }) : '',
  ].filter(Boolean);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="P7">
        <span>{t('Won')}<b data-ac-fig="won">{F.number(v.won)}</b></span>
        <span>{t('Lost')}<b data-ac-fig="lost" className={v.lost ? 'bdc-red' : undefined}>{F.number(v.lost)}</b></span>
        <span>{t('Win rate')}<b data-ac-fig="rate">{closed ? `${F.number((v.won / closed) * 100, { maximumFractionDigits: 0 })}%` : '—'}</b></span>
        <span>{t('Value won')}<b data-ac-fig="wonValue">{egpM(v.wonEgp)}</b></span>
      </div>
      {closed === 0
        ? <p className="bdc-empty" data-ac-empty="winLoss">{t('No bid won or lost in these quarters.')}</p>
        : <>
            <ul className="bdc-legend" aria-hidden="true">
              <li><span className="bdc-key bdc-client" />{t('Won')}</li>
              <li><span className="bdc-key bdc-fill-lo" />{t('Lost')}</li>
              <li>{t('Number of bids')}</li>
            </ul>
            <div className="ac-cols" style={{ ['--ac-n' as string]: v.rows.length }} role="img" aria-label={t('Bids won and lost per quarter')}>
              {v.rows.map(r => (
                <div key={r.quarter} className="ac-col" data-ac-row="winLoss" data-ac-key={r.quarter}>
                  <b className="ac-col-n ac-col-pair-n" data-bdc-value>{r.assumed ? '≈ ' : ''}{F.number(r.won)}<span>{F.number(r.lost)}</span></b>
                  <span className="ac-col-bar ac-pair">
                    <span className="bdc-client" style={{ height: `${(r.won / max) * 100}%` }} />
                    <span className="bdc-fill-lo" style={{ height: `${(r.lost / max) * 100}%` }} />
                  </span>
                  <span className="ac-col-l">{t('Q{{q}}', { q: F.number(Number(r.quarter.slice(-1))) })}<br />{r.quarter.slice(0, 4)}</span>
                </div>
              ))}
            </div>
          </>}
      {foot.length > 0 && <TileFoot attr="winLoss">{foot.join(sep)}</TileFoot>}
      <AssumedKey rules={v.assumed ? [t('a closed bid with no decision date is placed in the quarter it was last changed')] : []} />
    </>
  );
}

const CATEGORY_LABEL: Record<StaffCategory, string> = { operation: 'Operation', maintenance: 'Maintenance', inspection: 'Inspection', engineering: 'Engineering and support' };

/** P8 — all our staff, and per category. */
export function P8Categories({ data, today }: ChartCtx) {
  const { t, F } = useBdWords(data);
  const v = useMemo(() => staffByCategory(data, today), [data, today]);
  const rules = useStaffRules(false);
  const max = Math.max(1, ...v.rows.map(r => r.staff));
  const split = (Object.keys(STAFF_CATEGORY_SPLIT) as StaffCategory[]).map(c => `${t(CATEGORY_LABEL[c])} ${F.number(pct(STAFF_CATEGORY_SPLIT[c]))}%`).join(' · ');
  return (
    <>
      <div className="bdc-figs" data-ac-figs="P8">
        <span>{t('All our staff')}<b data-ac-fig="total">≈ {F.number(v.total)}</b></span>
      </div>
      <div className="bdc-list">
        {v.rows.map(r => (
          <div key={r.category} className="bdc-row" data-ac-row="category" data-ac-key={r.category}>
            <span className="bdc-name"><span>{t(CATEGORY_LABEL[r.category])}</span><span className="bdc-sub">{t('{{pct}}% of staff', { pct: F.number(pct(r.share)) })}</span></span>
            <HatchBar value={r.staff} max={max} />
            <span className="bdc-num" data-bdc-value>≈ {F.number(r.staff)}</span>
          </div>
        ))}
      </div>
      <AssumedKey rules={[...rules, t('all our staff = staff on projects plus the bench ({{pct}}%)', { pct: F.number(pct(ASSUMED_BENCH_SHARE)) }), t('split by category: {{split}}', { split })]} />
    </>
  );
}

const PAPER_LABEL: Record<PaperKind, string> = {
  pastEnd: 'Still working past the end date — not signed yet',
  signedLate: 'Extended after the old end date had passed',
  assumed: 'Amendments with no dates on file',
};

/**
 * A6 — days of work without a signed paper, per line, longest first: the top 5,
 * then "Show all" on the Contracts tab. Contract form and kind of delay are the
 * row's hover note; a line still past its end shows its days in red.
 */
export function A6Paper({ data, today, onClient, onContracts }: ChartCtx) {
  const { t, F, nameOf, bidi } = useBdWords(data);
  const v = useMemo(() => paperDelays(data, today), [data, today]);
  const max = Math.max(1, ...v.rows.map(r => r.days));
  const shown = v.rows.slice(0, TILE_FIRST);
  const open = v.rows.filter(r => r.kind === 'pastEnd').length, late = v.rows.filter(r => r.kind === 'signedLate').length;
  const days = (r: { kind: PaperKind; days: number }) => (r.kind === 'signedLate' ? t('at least {{n}} days', { n: F.number(r.days) })
    : r.kind === 'assumed' ? `≈ ${t('{{n}} days', { n: F.number(r.days) })}` : t('{{n}} days', { n: F.number(r.days) }));
  return (
    <>
      <div className="bdc-figs" data-ac-figs="A6">
        <span>{t('Working without paper now')}<b data-ac-fig="open" className={open ? 'bdc-red' : undefined}>{F.number(open)}</b></span>
        <span>{t('Signed late')}<b data-ac-fig="late">{F.number(late)}</b></span>
        <span>{t('Signed on time')}<b data-ac-fig="onTime">{F.number(v.onTime)}</b></span>
      </div>
      {v.rows.length === 0
        ? <p className="bdc-empty" data-ac-empty="paper">{t('Every line is within its end date and no extension came late.')}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.id} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} title={`${t(r.type)} · ${t(PAPER_LABEL[r.kind])}`} data-ac-row="paper" data-ac-key={r.id}>
                <span className="bdc-name" data-ac-kind={r.kind}>{bidi(nameOf(r.client))}</span>
                <Bar real={r.kind === 'assumed' ? 0 : r.days} assumed={r.kind === 'assumed' ? r.days : 0} max={max} />
                <span className={`bdc-num${r.kind === 'pastEnd' ? ' bdc-red' : ''}`} data-bdc-value>{days(r)}</span>
              </button>
            ))}
          </div>}
      <ShowAll total={v.rows.length} onOpen={() => onContracts('all')} attr="paper" />
      {v.noDates > 0 && <TileFoot attr="noDates">{t('Lines with amendments but no dates to count from: {{n}}', { n: F.number(v.noDates) })}</TileFoot>}
      <AssumedKey rules={v.median != null && v.rows.some(r => r.kind === 'assumed')
        ? [t('a line with amendments but no dates takes the median delay of the late extensions we can see ({{n}} days)', { n: F.number(Math.round(v.median)) })] : []} />
    </>
  );
}

/** The level-spread rule sentences shared by O1 and O3. */
function useLevelRules() {
  const { t } = useTranslation();
  const staff = useStaffRules(false);
  return [...staff,
    t('all our staff = staff on projects plus the bench ({{pct}}%)', { pct: Math.round(ASSUMED_BENCH_SHARE * 100) }),
    t('staff spread over the levels as a pyramid: the top level takes 1 share, each level down one share more; grades with no level are the bottom step'),
  ];
}

/** "Level 10 · GM" or the grades with no level. */
function useStepName() {
  const { t, i18n } = useTranslation();
  const sep = i18n.language === 'ar' ? '، ' : ', ';
  return (r: LevelStaff, num: (n: number) => string) => {
    const grades = r.grades.map(g => (GRADE_SHORT[g] ? t(GRADE_SHORT[g]) : g)).join(sep);
    return r.level != null ? `${t('Level {{n}}', { n: num(r.level) })} · ${grades}` : t('No level · {{grades}}', { grades });
  };
}

/** O1 — staff per competency level, top first: the first 5 levels, then "Show all" on the Pricing tab. */
export function O1Levels({ data, today, onPricing }: ChartCtx) {
  const { t, F } = useBdWords(data);
  const v = useMemo(() => staffByLevel(data, today), [data, today]);
  const rules = useLevelRules();
  const stepName = useStepName();
  const max = Math.max(1, ...v.rows.map(r => r.staff));
  if (!v.rows.length) return <p className="bdc-empty">{t('No day-rate sheet has been loaded.')}</p>;
  return (
    <>
      <div className="bdc-figs" data-ac-figs="O1">
        <span>{t('All our staff')}<b data-ac-fig="total">≈ {F.number(v.total)}</b></span>
        <span>{t('Levels')}<b data-ac-fig="levels">{F.number(v.rows.length)}</b></span>
      </div>
      <div className="bdc-list">
        {v.rows.slice(0, TILE_FIRST).map(r => (
          <div key={r.key} className="bdc-row" data-ac-row="levelStaff" data-ac-key={r.key}>
            <span className="bdc-name"><span>{stepName(r, n => F.number(n))}</span></span>
            <HatchBar value={r.staff} max={max} />
            <span className="bdc-num" data-bdc-value>≈ {F.number(r.staff)}</span>
          </div>
        ))}
      </div>
      {onPricing && <ShowAll total={v.rows.length} onOpen={onPricing} attr="levelStaff" />}
      <AssumedKey rules={rules} />
    </>
  );
}

/** O3 — what one person at each level is worth in a year (staff and rate on hover): the first 5 levels, then "Show all" on the Pricing tab. */
export function O3PersonValue({ data, today, onPricing }: ChartCtx) {
  const { t, F, egpM } = useBdWords(data);
  const v = useMemo(() => valuePerPerson(data, today), [data, today]);
  const rules = useLevelRules();
  const stepName = useStepName();
  const max = Math.max(1, ...v.rows.map(r => r.yearEgp));
  if (!v.rows.length) return <p className="bdc-empty">{t('No day-rate sheet has been loaded.')}</p>;
  return (
    <>
      <div className="bdc-figs" data-ac-figs="O3">
        <span>{t('All staff, one year fully billed')}<b data-ac-fig="total">≈ {egpM(v.totalEgp)}</b></span>
      </div>
      <div className="bdc-list">
        {v.rows.slice(0, TILE_FIRST).map(r => (
          <div key={r.key} className="bdc-row" data-ac-row="personValue" data-ac-key={r.key}
            title={t('≈ {{n}} staff · day rate {{rate}}', { n: F.number(r.staff), rate: F.number(r.rate as number, { maximumFractionDigits: 0 }) })}>
            <span className="bdc-name"><span>{stepName(r, n => F.number(n))}</span></span>
            <HatchBar value={r.yearEgp} max={max} />
            <span className="bdc-num" data-bdc-value>≈ {egpM(r.yearEgp)}</span>
          </div>
        ))}
      </div>
      {onPricing && <ShowAll total={v.rows.length} onOpen={onPricing} attr="personValue" />}
      <TileFoot attr="names">{t('Names for the CEO only, once HR sends the levels.')}</TileFoot>
      <AssumedKey rules={[...rules, t('a person’s yearly value = the median day rate at the level × {{days}} billable days', { days: F.number(WORK_DAYS_PER_PERSON) })]} />
    </>
  );
}

/** O4 — income lost to the bench per completed quarter. */
export function O4Bench({ data, today }: ChartCtx) {
  const { t, F, egpM } = useBdWords(data);
  const money = useMoneyRules();
  const v = useMemo(() => benchLossByQuarter(data, today), [data, today]);
  const total = v.reduce((a, x) => a + x.lostEgp, 0);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="O4">
        <span>{t('Lost over these quarters')}<b data-ac-fig="total" className={total ? 'bdc-red' : undefined}>≈ {egpM(total)}</b></span>
      </div>
      <ul className="bdc-legend" aria-hidden="true"><li><span className="bdc-key ac-hatch" />{t('Unbilled staff-days')}</li><li>{t('Figures in m EGP')}</li></ul>
      <QuarterStack data={data} rows={v.map(x => ({ quarter: x.quarter, parts: [{ v: x.lostEgp, cls: 'ac-hatch' }], approx: true }))} label={t('Income lost to the bench per quarter')} attr="benchLoss" />
      <AssumedKey rules={[money.billing,
        t('the bench ({{pct}}% of our staff) would bill at the same day rates as the staff placed: lost = billed × {{a}} ÷ {{b}}', { pct: F.number(pct(ASSUMED_BENCH_SHARE)), a: F.number(pct(ASSUMED_BENCH_SHARE)), b: F.number(100 - pct(ASSUMED_BENCH_SHARE)) })]} />
    </>
  );
}

/** The under-placement rule sentence (O5, O7). */
function useUnderRule() {
  const { t } = useTranslation();
  return t('{{pct}}% of each project’s staff are paid one grade below their level; each of their man-days loses the client’s step to the next grade up (highest rate − lowest, ÷ the steps between; a client with one rate takes the median step)',
    { pct: pct(UNDER_PLACED_SHARE) });
}

/** O5 — income lost to under-placement per client project, last 12 months: the top 5, then "Show all" on the Contracts tab. */
export function O5Under({ data, today, onClient, onContracts }: ChartCtx) {
  const { t, F, nameOf, bidi, egpM } = useBdWords(data);
  const v = useMemo(() => underPlacement(data, today), [data, today]);
  const rules = useStaffRules(false);
  const under = useUnderRule();
  const max = Math.max(1e-9, ...v.rows.map(r => r.lostEgp));
  const shown = v.rows.slice(0, TILE_FIRST);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="O5">
        <span>{t('Lost in the last 12 months')}<b data-ac-fig="total" className={v.totalEgp ? 'bdc-red' : undefined}>≈ {egpM(v.totalEgp)}</b></span>
      </div>
      {v.rows.length === 0
        ? <p className="bdc-empty">{t('No project bills anything in the last 12 months.')}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="under" data-ac-key={r.client}
                title={t('≈ {{days}} man-days · grade step {{step}}', { days: F.number(r.manDays, { maximumFractionDigits: 0 }), step: `${r.stepAssumed ? '≈ ' : ''}${F.number(r.step, { maximumFractionDigits: 0 })}` })}>
                <span className="bdc-name">{bidi(nameOf(r.client))}</span>
                <HatchBar value={r.lostEgp} max={max} />
                <span className="bdc-num" data-bdc-value>≈ {egpM(r.lostEgp)}</span>
              </button>
            ))}
          </div>}
      <ShowAll total={v.rows.length} onOpen={() => onContracts('all')} attr="under" />
      <AssumedKey rules={[...rules, under]} />
    </>
  );
}

/** The turned-down rule sentences (O6, O7). */
function useTurnedRules(assumedDate: boolean) {
  const { t } = useTranslation();
  return [
    t('every bid marked “No Bid” counts as work turned down for lack of qualified staff, at its estimated value (US dollars at {{rate}} EGP)', { rate: ASSUMED_USD_EGP }),
    ...(assumedDate ? [t('a closed bid with no decision date is placed in the quarter it was last changed')] : []),
  ];
}

/** O6 — value of work turned down per completed quarter, from the bid register. */
export function O6TurnedDown({ data, today, bids }: ChartCtx) {
  const { t, F, egpM } = useBdWords(data);
  const v = useMemo(() => (Array.isArray(bids) ? turnedDownByQuarter(bids as ClosedBid[], today) : null), [bids, today]);
  const rules = useTurnedRules(!!v?.assumedDate);
  const wait = useBidState(bids);
  if (wait || !v) return wait;
  const count = v.rows.reduce((a, r) => a + r.count, 0), egp = v.rows.reduce((a, r) => a + r.egp, 0);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="O6">
        <span>{t('Turned down')}<b data-ac-fig="count">≈ {F.number(count)}</b></span>
        <span>{t('Value lost')}<b data-ac-fig="value" className={egp ? 'bdc-red' : undefined}>≈ {egpM(egp)}</b></span>
      </div>
      {count === 0
        ? <p className="bdc-empty" data-ac-empty="turnedDown">{t('No bid marked “No Bid” was decided in these quarters.')}</p>
        : <>
            <ul className="bdc-legend" aria-hidden="true"><li><span className="bdc-key ac-hatch-lo" />{t('Work turned down')}</li><li>{t('Figures in m EGP')}</li></ul>
            <QuarterStack data={data} rows={v.rows.map(r => ({ quarter: r.quarter, parts: [{ v: r.egp, cls: 'ac-hatch ac-hatch-lo' }], approx: true }))} label={t('Value of work turned down per quarter')} attr="turnedDown" />
          </>}
      {v.noValue > 0 && <TileFoot attr="noValue">{t('Bids with no value, or in a currency other than EGP or USD (counted, not added): {{n}}', { n: F.number(v.noValue) })}</TileFoot>}
      <AssumedKey rules={rules} />
    </>
  );
}

/** O7 — total opportunity cost per completed quarter, in three parts. */
export function O7Total({ data, today, bids }: ChartCtx) {
  const { t, F, egpM } = useBdWords(data);
  const money = useMoneyRules();
  const under = useUnderRule();
  const list = Array.isArray(bids) ? bids : null;
  const v = useMemo(() => opportunityCost(data, today, list), [data, today, list]);
  const turned = useTurnedRules(false);
  const total = v.reduce((a, x) => a + x.benchEgp + x.underEgp + (x.turnedEgp ?? 0), 0);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="O7">
        <span>{t('Opportunity cost over these quarters')}<b data-ac-fig="total" className={total ? 'bdc-red' : undefined}>≈ {egpM(total)}</b></span>
      </div>
      <ul className="bdc-legend" aria-hidden="true">
        <li><span className="bdc-key ac-hatch" />{t('Unbilled staff-days')}</li>
        <li><span className="bdc-key ac-hatch ac-hatch-2" />{t('Placed below their level')}</li>
        <li><span className="bdc-key ac-hatch ac-hatch-lo" />{t('Work turned down')}</li>
        <li>{t('Figures in m EGP')}</li>
      </ul>
      <QuarterStack data={data} attr="oppCost" label={t('Opportunity cost per quarter')}
        rows={v.map(x => ({ quarter: x.quarter, approx: true, parts: [
          { v: x.benchEgp, cls: 'ac-hatch' }, { v: x.underEgp, cls: 'ac-hatch ac-hatch-2' }, { v: x.turnedEgp ?? 0, cls: 'ac-hatch ac-hatch-lo' }] }))} />
      {!list && <TileFoot attr="bids">{bids === 'error' ? t('The bid register could not be read. Reload the page.') : t('Reading the bid register…')}</TileFoot>}
      <AssumedKey rules={[money.billing,
        t('unbilled days: the bench ({{pct}}%) at the day rates of the staff placed', { pct: F.number(pct(ASSUMED_BENCH_SHARE)) }), under, ...turned]} />
    </>
  );
}

export const PROJECT_OPP_CHARTS: Record<string, (c: ChartCtx) => React.ReactElement> = {
  P5: c => <P5Areas {...c} />,
  P7: c => <P7WinLoss {...c} />,
  P8: c => <P8Categories {...c} />,
  A6: c => <A6Paper {...c} />,
  O1: c => <O1Levels {...c} />,
  O3: c => <O3PersonValue {...c} />,
  O4: c => <O4Bench {...c} />,
  O5: c => <O5Under {...c} />,
  O6: c => <O6TurnedDown {...c} />,
  O7: c => <O7Total {...c} />,
};
