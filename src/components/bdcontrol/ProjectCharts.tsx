import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { millions, type BdData, type ContractFilter } from '../../lib/bdControl';
import {
  projectTotals, projectStatus, projectsByType, projectsByClient, projectsByValue, type ProjectState,
} from '../../lib/analysisCenter';
import { useBdWords } from './shared';

/** What every question chart gets from the board. */
export interface ChartCtx {
  data: BdData;
  today: string;
  onClient: (code: string) => void;
  onContracts: (f: ContractFilter) => void;
}

const FIRST = 10;

/** Contract forms as the CSA report writes them; anything else is shown as written. */
const TYPE_LABEL: Record<string, string> = { CSA: 'CSA contracts', 'O&M': 'O&M contracts', TSA: 'TSA contracts', 'Farm-in': 'Farm-in contracts' };

const STATE_LABEL: Record<ProjectState, string> = {
  running: 'Running', endingSoon: 'Ending within 90 days', pastEnd: 'Past its end date', noDate: 'No end date on file',
};
const STATE_TONE: Record<ProjectState, string> = { running: 'base', endingSoon: 'mid', pastEnd: 'lo', noDate: 'flat' };
const STATE_FILTER: Partial<Record<ProjectState, ContractFilter>> = { endingSoon: 'd90', pastEnd: 'expired', noDate: 'noDate' };

/** One number per tile (P1). */
function Stat({ label, value, sub, attr }: { label: string; value: string; sub?: string; attr: string }) {
  return (
    <div className="ac-stat" data-ac-stat={attr}>
      <span className="ac-stat-label">{label}</span>
      <b data-ac-value>{value}</b>
      {sub && <span className="ac-stat-sub">{sub}</span>}
    </div>
  );
}

/** P1 — our totals: projects, one tile per contract form, amendments. */
export function P1Totals({ data }: ChartCtx) {
  const { t } = useTranslation();
  const { F } = useBdWords(data);
  const k = useMemo(() => projectTotals(data), [data]);
  return (
    <div className="ac-stats">
      <Stat attr="projects" label={t('Projects')} value={F.number(k.projects)} />
      {k.byType.map(x => <Stat key={x.type} attr={`type:${x.type}`} label={t(TYPE_LABEL[x.type] || x.type)} value={F.number(x.count)} />)}
      <Stat attr="amendments" label={t('Amendments')} value={F.number(k.amendments)}
        sub={k.unnumbered > 0 ? t('Lines marked “Amend.” with no number: {{n}}', { n: F.number(k.unnumbered) }) : undefined} />
    </div>
  );
}

/** P2 — live / ending soon / past end / no date. */
export function P2Status({ data, today, onContracts }: ChartCtx) {
  const { t, F } = useBdWords(data);
  const rows = useMemo(() => projectStatus(data, today), [data, today]);
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div className="bdc-list">
      {rows.map(r => {
        const f = STATE_FILTER[r.state];
        const inner = <>
          <span className="bdc-name"><span>{t(STATE_LABEL[r.state])}</span></span>
          <span className="bdc-track"><span className={`bdc-fill bdc-fill-${STATE_TONE[r.state]}`} style={{ width: `${(r.count / max) * 100}%` }} /></span>
          <span className="bdc-num" data-bdc-value>{F.number(r.count)}</span>
        </>;
        return f && r.count > 0
          ? <button key={r.state} type="button" className="bdc-row bdc-click" onClick={() => onContracts(f)} data-ac-row="status" data-ac-key={r.state}>{inner}</button>
          : <div key={r.state} className="bdc-row" data-ac-row="status" data-ac-key={r.state}>{inner}</div>;
      })}
    </div>
  );
}

/** P3 — share of projects per contract form, as a donut (max 4 slices: the 4th folds the rest into "Other"). */
export function P3Types({ data }: ChartCtx) {
  const { t, F } = useBdWords(data);
  const all = useMemo(() => projectsByType(data), [data]);
  const total = all.reduce((a, x) => a + x.count, 0);
  const slices = all.length <= 4 ? all : [...all.slice(0, 3), {
    type: 'Other', count: all.slice(3).reduce((a, x) => a + x.count, 0), pct: all.slice(3).reduce((a, x) => a + x.pct, 0),
  }];
  if (!total) return <p className="bdc-empty">{t('No project lines on file.')}</p>;
  const R = 15.9155; // circumference 100, so a slice's length is its %
  let at = 0;
  const gap = slices.length > 1 ? 0.8 : 0;
  return (
    <div className="ac-donut-wrap">
      <svg viewBox="0 0 42 42" className="ac-donut" role="img" aria-label={t('Projects by contract form')}>
        <circle cx="21" cy="21" r={R} className="ac-donut-hole" />
        {slices.map((s, i) => {
          const len = Math.max(0, s.pct - gap);
          const el = (
            <circle key={s.type} cx="21" cy="21" r={R} className={`ac-slice ac-s${i + 1}`} strokeDasharray={`${len} ${100 - len}`}
              strokeDashoffset={25 - at} data-ac-slice={s.type}>
              <title>{`${t(TYPE_LABEL[s.type] || s.type)}: ${F.number(s.count)}`}</title>
            </circle>
          );
          at += s.pct;
          return el;
        })}
        <text x="21" y="20.5" textAnchor="middle" className="ac-donut-n">{F.number(total)}</text>
        <text x="21" y="26" textAnchor="middle" className="ac-donut-l">{t('projects')}</text>
      </svg>
      <ul className="ac-legend">
        {slices.map((s, i) => (
          <li key={s.type} data-ac-legend={s.type}>
            <span className={`bdc-key ac-s${i + 1}-bg`} />
            <span className="ac-legend-name">{t(TYPE_LABEL[s.type] || s.type)}</span>
            <b>{F.number(s.count)}</b>
            <span className="ac-legend-pct">{F.number(s.pct, { maximumFractionDigits: 0 })}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** P4 — projects per client. */
export function P4Clients({ data, onClient }: ChartCtx) {
  const { t, F, sep, nameOf, bidi } = useBdWords(data);
  const rows = useMemo(() => projectsByClient(data), [data]);
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...rows.map(r => r.count));
  const shown = all ? rows : rows.slice(0, FIRST);
  return (
    <>
      <div className="bdc-list">
        {shown.map(r => (
          <button key={r.client} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="clients" data-ac-key={r.client}>
            <span className="bdc-name">{bidi(nameOf(r.client))}<span className="bdc-sub">{r.types.map(x => t(x)).join(sep)}</span></span>
            <span className="bdc-track"><span className="bdc-fill" style={{ width: `${(r.count / max) * 100}%` }} /></span>
            <span className="bdc-num" data-bdc-value>{F.number(r.count)}</span>
          </button>
        ))}
      </div>
      {rows.length > FIRST && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(v => !v)} data-ac-more="clients" style={{ marginTop: 6 }}>
          {all ? t('Show fewer') : t('Show all {{count}}', { count: rows.length })}
        </button>
      )}
    </>
  );
}

/** P6 — the 10 biggest lines by ceiling. */
export function P6Biggest({ data, onClient }: ChartCtx) {
  const { t, F, sep, nameOf, bidi } = useBdWords(data);
  const v = useMemo(() => projectsByValue(data), [data]);
  const rows = v.rows.slice(0, FIRST);
  const max = Math.max(1, ...rows.map(r => r.ceilingEgp));
  const label = (r: { client: string; contractType?: string }) => [nameOf(r.client), r.contractType ? t(r.contractType) : ''].filter(Boolean).join(' · ');
  return (
    <>
      {rows.length === 0
        ? <p className="bdc-empty">{t('No client line has a ceiling on file.')}</p>
        : <div className="bdc-list">
            {rows.map(r => (
              <button key={r.id} type="button" className="bdc-row bdc-click" onClick={() => onClient(r.client)} data-ac-row="biggest" data-ac-key={r.id}>
                <span className="bdc-name">{bidi(nameOf(r.client))}<span className="bdc-sub">{t(r.type)}</span></span>
                <span className="bdc-track"><span className="bdc-fill" style={{ width: `${(r.ceilingEgp / max) * 100}%` }} /></span>
                <span className="bdc-num" data-bdc-value>{t('{{value}} m EGP', { value: F.number(millions(r.ceilingEgp), { maximumFractionDigits: 1 }) })}</span>
              </button>
            ))}
          </div>}
      {v.monthlyOnly.length > 0 && <p className="bdc-foot" data-ac-foot="monthly">{t('Paid by the month, not in this chart: {{list}}', { list: v.monthlyOnly.map(label).join(sep) })}</p>}
      {v.noValue.length > 0 && <p className="bdc-foot" data-ac-foot="novalue">{t('No ceiling or value on file: {{list}}', { list: v.noValue.map(label).join(sep) })}</p>}
    </>
  );
}

/** Question id → the chart that answers it. A question with no chart here shows as "data needed" when its data is missing. */
export const PROJECT_CHARTS: Record<string, (c: ChartCtx) => React.ReactElement> = {
  P1: c => <P1Totals {...c} />,
  P2: c => <P2Status {...c} />,
  P3: c => <P3Types {...c} />,
  P4: c => <P4Clients {...c} />,
  P6: c => <P6Biggest {...c} />,
};
