import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rateGrid } from '../../lib/bdControl';
import {
  ASSUMED_BENCH_SHARE, ASSUMED_GUARANTEE_SHARE, ASSUMED_VACANCY_DAYS, ASSUMED_WIN_CHANCE, ENDING_SOON_DAYS, GUARANTEE_DAYS_AFTER_END,
  KEY_PERSON_MAX_STAFF, PRICE_BUILDUP, STAFF_PER_VACANCY, WORK_DAYS_PER_PERSON, ASSUMED_USD_EGP,
  benchStaff, gradeCosts, guaranteesByExpiry, incomePerStaffDay, keyPersonProjects, pipelineByStage, risksByProject, staffByProject, vacancies,
  type GuaranteeWindow, type RiskSign,
} from '../../lib/analysisCenter';
import { GRADE_SHORT, ShowAll, TILE_FIRST, TileFoot, useBdWords } from './shared';
import { AssumedKey } from './MoneyAmendCharts';
import { HatchBar, useMoneyRules } from './MoneyCharts';
import type { ChartCtx } from './ProjectCharts';

// Analysis center, queue A7b: People H1, H2, H4–H6, Renewals R4, R5 and Growth
// G2, G3. HR, Operations and Finance have sent nothing yet, so every figure but
// G2's bids is ASSUMED by the rules in lib/analysisCenter.ts (agreed with Tariq,
// 20 Oct 2026) — hatched, marked "≈", the rules spelled out under each chart.

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

/** The staff rule sentences shared by H1, H2, H5 and H6. */
export function useStaffRules(anyRateAssumed: boolean) {
  const { t } = useTranslation();
  const money = useMoneyRules();
  return [
    money.billing,
    t('staff = 12 months of billing ÷ the client’s average day rate ÷ {{days}} working days a person (people supplied through subcontractors included)', { days: WORK_DAYS_PER_PERSON }),
    ...(anyRateAssumed ? [t('a client with no rate sheet takes the median of the other clients’ average rates')] : []),
  ];
}

/** H1 — staff per client project, most first: the top 5, then "Show all" on the Contracts tab. */
export function H1StaffPerProject({ data, today, onClient, onContracts }: ChartCtx) {
  const { t, F, nameOf, bidi } = useBdWords(data);
  const v = useMemo(() => staffByProject(data, today), [data, today]);
  const rules = useStaffRules(v.rows.some(r => r.rateAssumed));
  const max = Math.max(1, ...v.rows.map(r => r.staff));
  const shown = v.rows.slice(0, TILE_FIRST);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="H1">
        <span>{t('Staff on projects')}<b data-ac-fig="total">≈ {F.number(v.total)}</b></span>
        <span>{t('Projects')}<b data-ac-fig="projects">{F.number(v.rows.length)}</b></span>
      </div>
      {v.rows.length === 0
        ? <p className="bdc-empty">{t('No project bills anything in the last 12 months.')}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="staff" data-ac-key={r.client}
                title={t('≈ {{days}} man-days · day rate {{rate}}', { days: F.number(r.manDays, { maximumFractionDigits: 0 }), rate: `${r.rateAssumed ? '≈ ' : ''}${F.number(r.rate, { maximumFractionDigits: 0 })}` })}>
                <span className="bdc-name">{bidi(nameOf(r.client))}</span>
                <HatchBar value={r.staff} max={max} />
                <span className="bdc-num" data-bdc-value>≈ {F.number(r.staff)}</span>
              </button>
            ))}
          </div>}
      <ShowAll total={v.rows.length} onOpen={() => onContracts('all')} attr="staff" />
      {v.noRate > 0 && <TileFoot attr="noRate">{t('Projects with no day rate to count from: {{n}}', { n: F.number(v.noRate) })}</TileFoot>}
      <AssumedKey rules={rules} />
    </>
  );
}

/** H2 — one number: staff with no project today. */
export function H2Bench({ data, today }: ChartCtx) {
  const { t, F } = useBdWords(data);
  const v = useMemo(() => benchStaff(data, today), [data, today]);
  const rules = useStaffRules(false);
  return (
    <>
      <div className="ac-stats" data-ac-figs="H2">
        <div className="ac-stat" data-ac-stat="bench"><span className="ac-stat-label">{t('On the bench today')}</span><b data-ac-fig="bench">≈ {F.number(v.bench)}</b></div>
        <div className="ac-stat" data-ac-stat="total"><span className="ac-stat-label">{t('All our staff')}</span><b data-ac-fig="total">≈ {F.number(v.total)}</b>
          <span className="ac-stat-sub">{t('On projects: {{n}}', { n: `≈ ${F.number(v.placed)}` })}</span></div>
      </div>
      <AssumedKey rules={[...rules, t('{{pct}}% of all our staff have no project', { pct: F.number(ASSUMED_BENCH_SHARE * 100) })]} />
    </>
  );
}

/** H4 — per grade: what the client pays for a man-day against what it costs us; the first 5 grades, then "Show all" on the Pricing tab. */
export function H4GradeCost({ data, onPricing }: ChartCtx) {
  const { t, F } = useBdWords(data);
  const rows = useMemo(() => gradeCosts(rateGrid(data.dayRates)), [data.dayRates]);
  const max = Math.max(1, ...rows.map(r => r.rate));
  const gradeName = (g: string) => (GRADE_SHORT[g] ? t(GRADE_SHORT[g]) : g);
  const n0 = (x: number) => F.number(x, { maximumFractionDigits: 0 });
  if (!rows.length) return <p className="bdc-empty">{t('No day-rate sheet has been loaded.')}</p>;
  return (
    <>
      <ul className="bdc-legend" aria-hidden="true">
        <li><span className="bdc-key ac-hatch" />{t('Our cost')}</li>
        <li><span className="bdc-key bdc-client" />{t('Left for overhead and profit')}</li>
        <li>{t('EGP per man-day')}</li>
      </ul>
      <div className="bdc-list">
        {rows.slice(0, TILE_FIRST).map(r => (
          <div key={r.grade} className="bdc-row" data-ac-row="gradeCost" data-ac-key={r.grade} title={t('Client pays {{rate}} · clients: {{n}}', { rate: n0(r.rate), n: F.number(r.clients) })}>
            <span className="bdc-name">{gradeName(r.grade)}</span>
            <span className="bdc-track">
              <span className="bdc-stack" style={{ width: `${(r.rate / max) * 100}%` }}>
                <span className="bdc-seg ac-hatch" style={{ flex: r.cost }} data-ac-assumed-seg />
                <span className="bdc-seg bdc-client" style={{ flex: r.rate - r.cost }} />
              </span>
            </span>
            <span className="bdc-num" data-bdc-value>≈ {n0(r.cost)}</span>
          </div>
        ))}
      </div>
      {onPricing && <ShowAll total={rows.length} onOpen={onPricing} attr="gradeCost" />}
      <AssumedKey rules={[t('our cost of a man-day = the median day rate ÷ {{k}} (EPROM’s price build-up)', { k: F.number(PRICE_BUILDUP, { maximumFractionDigits: 4 }) })]} />
    </>
  );
}

/** H5 — projects small enough to hang on one key person, smallest first: the top 5, then "Show all" on the Contracts tab. */
export function H5KeyPerson({ data, today, onClient, onContracts }: ChartCtx) {
  const { t, F, nameOf, bidi, egpM } = useBdWords(data);
  const v = useMemo(() => keyPersonProjects(data, today), [data, today]);
  const rules = useStaffRules(v.rows.some(r => r.rateAssumed));
  const shown = v.rows.slice(0, TILE_FIRST);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="H5">
        <span>{t('Projects on {{n}} people or fewer', { n: F.number(KEY_PERSON_MAX_STAFF) })}<b data-ac-fig="key">≈ {F.number(v.rows.length)}</b></span>
        <span>{t('Of projects')}<b data-ac-fig="projects">{F.number(v.projects)}</b></span>
      </div>
      {v.rows.length === 0
        ? <p className="bdc-empty" data-ac-empty="keyPerson">{t('Every project has more than {{n}} people on it.', { n: F.number(KEY_PERSON_MAX_STAFF) })}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="keyPerson" data-ac-key={r.client}
                title={t('Billed ≈ {{v}} in 12 months · key person: to be named by the project manager', { v: egpM(r.billedEgp) })}>
                <span className="bdc-name">{bidi(nameOf(r.client))}</span>
                <HatchBar value={r.staff} max={KEY_PERSON_MAX_STAFF} />
                <span className="bdc-num" data-bdc-value>{t('≈ {{n}} people', { n: F.number(r.staff) })}</span>
              </button>
            ))}
          </div>}
      <ShowAll total={v.rows.length} onOpen={() => onContracts('all')} attr="keyPerson" />
      <AssumedKey rules={[...rules, t('a project with {{n}} people or fewer hangs on one key person', { n: F.number(KEY_PERSON_MAX_STAFF) })]} />
    </>
  );
}

/** H6 — open positions per project: the top 5, then "Show all" on the Contracts tab. */
export function H6Vacancies({ data, today, onClient, onContracts }: ChartCtx) {
  const { t, F, nameOf, bidi } = useBdWords(data);
  const v = useMemo(() => vacancies(data, today), [data, today]);
  const rules = useStaffRules(false);
  const max = Math.max(1, ...v.rows.map(r => r.open));
  const shown = v.rows.slice(0, TILE_FIRST);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="H6">
        <span>{t('Open positions')}<b data-ac-fig="open">≈ {F.number(v.open)}</b></span>
        <span>{t('Days open')}<b data-ac-fig="days">≈ {F.number(ASSUMED_VACANCY_DAYS)}</b></span>
      </div>
      {v.rows.length === 0
        ? <p className="bdc-empty" data-ac-empty="vacancies">{t('No project has {{n}} people or more, so none carries an open position under this rule.', { n: F.number(STAFF_PER_VACANCY) })}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="vacancy" data-ac-key={r.client}
                title={t('≈ {{n}} staff · open ≈ {{days}} days', { n: F.number(r.staff), days: F.number(r.days) })}>
                <span className="bdc-name">{bidi(nameOf(r.client))}</span>
                <HatchBar value={r.open} max={max} />
                <span className="bdc-num" data-bdc-value>≈ {F.number(r.open)}</span>
              </button>
            ))}
          </div>}
      <ShowAll total={v.rows.length} onOpen={() => onContracts('all')} attr="vacancy" />
      <AssumedKey rules={[...rules, t('one open position per {{n}} staff on a project, each open {{days}} days', { n: F.number(STAFF_PER_VACANCY), days: F.number(ASSUMED_VACANCY_DAYS) })]} />
    </>
  );
}

const SIGN_LABEL: Record<RiskSign, string> = {
  pastEnd: 'Past its end date', endingSoon: 'Ending within {{n}} days', supplierFirst: 'Supplier contract ends first',
  extended: 'End date moved later', loss: 'Losing money (assumed)',
};

/** R4 — warning signs per client project, most first. */
export function R4Risks({ data, today, onClient }: ChartCtx) {
  const { t, F, nameOf, bidi, sep } = useBdWords(data);
  const v = useMemo(() => risksByProject(data, today), [data, today]);
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...v.rows.map(r => r.total));
  const shown = all ? v.rows : v.rows.slice(0, FIRST);
  const label = (s: RiskSign) => t(SIGN_LABEL[s], { n: F.number(ENDING_SOON_DAYS) });
  return (
    <>
      <div className="bdc-figs" data-ac-figs="R4">
        <span>{t('Open risks')}<b data-ac-fig="risks">≈ {F.number(v.rows.reduce((a, r) => a + r.total, 0))}</b></span>
        <span>{t('Projects with a risk')}<b data-ac-fig="projects">{F.number(v.rows.length)}</b></span>
      </div>
      {v.rows.length === 0
        ? <p className="bdc-empty" data-ac-empty="risks">{t('No project shows a warning sign today.')}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="risk" data-ac-key={r.client}>
                <span className="bdc-name">{bidi(nameOf(r.client))}
                  <span className="bdc-sub ac-wrap" data-ac-signs>{r.signs.map(s => (s.n > 1 ? `${label(s.sign)} ×${F.number(s.n)}` : label(s.sign))).join(sep)}</span>
                </span>
                <HatchBar value={r.total} max={max} />
                <span className="bdc-num" data-bdc-value>≈ {F.number(r.total)}</span>
              </button>
            ))}
          </div>}
      <ShowMore total={v.rows.length} all={all} onToggle={() => setAll(x => !x)} attr="risk" />
      {v.clean > 0 && <p className="bdc-foot" data-ac-foot="clean">{t('Projects with no warning sign: {{n}}', { n: F.number(v.clean) })}</p>}
      <AssumedKey rules={[t('a risk = a warning sign in the contract rows (past its end date, ending soon, a supplier contract ending first, an end date moved later, an assumed loss), until the risk log arrives')]} />
    </>
  );
}

const G_WINDOW_LABEL: Record<GuaranteeWindow, string> = { d30: 'Within 30 days', d90: 'In 31–90 days', d180: 'In 91–180 days', later: 'Later' };

/** R5 — guarantees by time left to expiry; a window opens its lines. */
export function R5Guarantees({ data, today, onClient }: ChartCtx) {
  const { t, F, nameOf, bidi, egpM, date } = useBdWords(data);
  const v = useMemo(() => guaranteesByExpiry(data, today), [data, today]);
  const [open, setOpen] = useState<GuaranteeWindow | null>(null);
  const max = Math.max(1e-9, ...v.windows.map(x => x.egp));
  const shown = v.windows.find(x => x.w === open)?.lines || [];
  const total = v.windows.reduce((a, x) => a + x.egp, 0);
  const soon = v.windows.filter(x => x.w === 'd30' || x.w === 'd90').reduce((a, x) => a + x.lines.length, 0);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="R5">
        <span>{t('Guarantees in force')}<b data-ac-fig="total">≈ {egpM(total)}</b></span>
        <span>{t('Expiring within 90 days')}<b data-ac-fig="soon" className={soon ? 'bdc-red' : undefined}>≈ {F.number(soon)}</b></span>
      </div>
      <div className="bdc-list">
        {v.windows.map(x => {
          const inner = <>
            <span className="bdc-name"><span>{t(G_WINDOW_LABEL[x.w])}</span><span className="bdc-sub">{t('Guarantees: {{n}}', { n: F.number(x.lines.length) })}</span></span>
            <HatchBar value={x.egp} max={max} lo={x.w === 'd30' && x.egp > 0} />
            <span className={`bdc-num${x.egp ? '' : ' bdc-zero'}`} data-bdc-value>≈ {egpM(x.egp)}</span>
          </>;
          return x.lines.length > 0
            ? <button key={x.w} type="button" className="bdc-row bdc-click" aria-expanded={open === x.w} onClick={() => setOpen(o => (o === x.w ? null : x.w))}
                data-ac-row="guarantee" data-ac-key={x.w}>{inner}</button>
            : <div key={x.w} className="bdc-row" data-ac-row="guarantee" data-ac-key={x.w}>{inner}</div>;
        })}
      </div>
      {open && (
        <div className="bdc-list ac-sublist" data-ac-list={open}>
          {shown.map(l => (
            <button key={l.id} type="button" className="bdc-row bdc-click ac-subrow" onClick={() => onClient(l.client)} data-ac-row="guaranteeLine" data-ac-key={l.id}>
              <span className="bdc-name">{bidi(nameOf(l.client))}
                <span className="bdc-sub ac-wrap">{t(l.type)} · {t('≈ {{v}} · expires ≈ {{date}}', { v: egpM(l.valueEgp), date: date(l.expires) })}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {(v.noCeiling > 0 || v.released > 0) && (
        <p className="bdc-foot" data-ac-foot="guarantees">{t('No ceiling or end date on file: {{a}} · taken as released (expired): {{b}}', { a: F.number(v.noCeiling), b: F.number(v.released) })}</p>
      )}
      <AssumedKey rules={[t('every contract line has a performance guarantee of {{pct}}% of its ceiling, expiring {{days}} days after its end date', { pct: F.number(ASSUMED_GUARANTEE_SHARE * 100), days: F.number(GUARANTEE_DAYS_AFTER_END) })]} />
    </>
  );
}

/** G2 — open bids by stage, as a funnel; from the app's own bid register. */
export function G2Pipeline({ data, bids }: ChartCtx) {
  const { t, F, egpM, sep } = useBdWords(data);
  const v = useMemo(() => (Array.isArray(bids) ? pipelineByStage(bids) : null), [bids]);
  if (bids === 'error') return <p className="bdc-empty" data-ac-empty="bidsError">{t('The bid register could not be read. Reload the page.')}</p>;
  if (!v) return <p className="bdc-empty" data-ac-empty="bidsLoading">{t('Reading the bid register…')}</p>;
  const max = Math.max(1, ...v.stages.map(s => s.count));
  const chance = Object.entries(ASSUMED_WIN_CHANCE).map(([s, p]) => `${t(s)} ${F.number(p)}%`).join(sep);
  return (
    <>
      <div className="bdc-figs" data-ac-figs="G2">
        <span>{t('Open bids')}<b data-ac-fig="open">{F.number(v.open)}</b></span>
        <span>{t('Pipeline value')}<b data-ac-fig="value">{egpM(v.valueEgp)}</b></span>
        <span>{t('Weighted by win chance')}<b data-ac-fig="weighted">{v.chanceAssumed ? '≈ ' : ''}{egpM(v.weightedEgp)}</b></span>
      </div>
      {v.open === 0
        ? <p className="bdc-empty" data-ac-empty="pipeline">{t('No open bid in the bid register.')}</p>
        : <div className="bdc-list ac-funnel">
            {v.stages.map(s => (
              <div key={s.stage} className="bdc-row" data-ac-row="stage" data-ac-key={s.stage}>
                <span className="bdc-name"><span>{t(s.stage)}</span>
                  <span className="bdc-sub ac-wrap">{t('Value {{v}} · weighted {{w}}', { v: egpM(s.valueEgp), w: `${s.chanceAssumed ? '≈ ' : ''}${egpM(s.weightedEgp)}` })}</span>
                </span>
                <span className="bdc-track"><span className="bdc-fill bdc-fill-base" style={{ width: `${(s.count / max) * 100}%` }} /></span>
                <span className={`bdc-num${s.count ? '' : ' bdc-zero'}`} data-bdc-value>{F.number(s.count)}</span>
              </div>
            ))}
          </div>}
      {v.noValue > 0 && <p className="bdc-foot" data-ac-foot="noValue">{t('Bids with no value, or in a currency other than EGP or USD (counted, not added): {{n}}', { n: F.number(v.noValue) })}</p>}
      <AssumedKey rules={v.chanceAssumed ? [
        t('a bid with no win chance typed in takes its stage’s: {{list}}', { list: chance }),
        t('US dollars at {{rate}} EGP', { rate: F.number(ASSUMED_USD_EGP) }),
      ] : []} />
    </>
  );
}

/** G3 — income per staff-day, per client, highest first. */
export function G3IncomePerDay({ data, onClient }: ChartCtx) {
  const { t, F, nameOf, bidi, sep } = useBdWords(data);
  const v = useMemo(() => incomePerStaffDay(data), [data]);
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...v.rows.map(r => r.rate));
  const shown = all ? v.rows : v.rows.slice(0, FIRST);
  const n0 = (x: number) => F.number(x, { maximumFractionDigits: 0 });
  return (
    <>
      {v.rows.length === 0
        ? <p className="bdc-empty">{t('No day-rate sheet has been loaded.')}</p>
        : <div className="bdc-list">
            {shown.map(r => (
              <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="income" data-ac-key={r.client}>
                <span className="bdc-name">{bidi(nameOf(r.client))}<span className="bdc-sub">{t('Average over {{n}} grades', { n: F.number(r.grades) })}</span></span>
                <HatchBar value={r.rate} max={max} />
                <span className="bdc-num" data-bdc-value>≈ {t('{{value}} EGP', { value: n0(r.rate) })}</span>
              </button>
            ))}
          </div>}
      <ShowMore total={v.rows.length} all={all} onToggle={() => setAll(x => !x)} attr="income" />
      {v.noRate.length > 0 && <p className="bdc-foot" data-ac-foot="noRate">{t('No rates on the day-rate sheet: {{list}}', { list: v.noRate.map(nameOf).join(sep) })}</p>}
      <AssumedKey rules={[t('income per staff-day = the client’s average day rate over its grades on the rate sheet')]} />
    </>
  );
}

export const PEOPLE_RISK_CHARTS: Record<string, (c: ChartCtx) => React.ReactElement> = {
  H1: c => <H1StaffPerProject {...c} />,
  H2: c => <H2Bench {...c} />,
  H4: c => <H4GradeCost {...c} />,
  H5: c => <H5KeyPerson {...c} />,
  H6: c => <H6Vacancies {...c} />,
  R4: c => <R4Risks {...c} />,
  R5: c => <R5Guarantees {...c} />,
  G2: c => <G2Pipeline {...c} />,
  G3: c => <G3IncomePerDay {...c} />,
};
