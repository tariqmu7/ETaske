import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDashed, Info, X } from 'lucide-react';
import {
  CEO_QUESTIONS, GROUP_LABEL, OWNER_LABEL, QUESTION_GROUPS, pick, questionsIn, type CeoQuestion, type QGroup,
} from '../../lib/ceoQuestions';
import { PROJECT_CHARTS, type ChartCtx } from './ProjectCharts';
import { MONEY_AMEND_CHARTS } from './MoneyAmendCharts';
import { RENEW_SUPPLY_CHARTS } from './RenewSupplyCharts';
import { PEOPLE_GROWTH_CHARTS } from './PeopleGrowthCharts';
import { MONEY_CHARTS } from './MoneyCharts';
import { PEOPLE_RISK_CHARTS } from './PeopleRiskCharts';
import { PROJECT_OPP_CHARTS } from './ProjectOppCharts';
import Headline from './Headline';
import { InfoSlot } from './shared';

/** Every question chart built so far, by question id. */
const CHARTS: Record<string, (c: ChartCtx) => React.ReactElement> = { ...PROJECT_CHARTS, ...MONEY_AMEND_CHARTS, ...RENEW_SUPPLY_CHARTS, ...PEOPLE_GROWTH_CHARTS, ...MONEY_CHARTS, ...PEOPLE_RISK_CHARTS, ...PROJECT_OPP_CHARTS };

/** How a question shows today: its chart, a grey "data needed" box, or not yet (chart still to be built). */
export type QShow = 'chart' | 'need' | null;
export const showOf = (q: CeoQuestion): QShow => (CHARTS[q.id] ? 'chart' : q.data === 'missing' ? 'need' : null);

/**
 * Each group's tiles in reading order with their width out of 12 columns
 * (queue L1, Tariq: "all boxes the same size"). Every row adds up to 12, so a
 * row has no hole: quarter-by-quarter column charts get the wide tiles, short
 * figure lists the narrow ones, and a row's tiles are only as tall as the
 * tallest chart in it. A question not listed here goes last at width 4.
 */
const LAYOUT: Partial<Record<QGroup, [string, number][]>> = {
  projects: [['P1', 3], ['P2', 5], ['P3', 4], ['P4', 4], ['P5', 4], ['P6', 4], ['P7', 5], ['P8', 7]],
  money: [['M9', 4], ['M2', 8], ['M3', 4], ['M11', 8], ['M8', 6], ['M10', 6], ['M4', 4], ['M7', 4], ['M6', 4], ['M1', 6], ['M5', 6]],
  amendments: [['A2', 8], ['A1', 4], ['A3', 6], ['A4', 6], ['A5', 6], ['A6', 6]],
  people: [['H2', 3], ['H1', 5], ['H3', 4], ['H4', 4], ['H5', 4], ['H6', 4]],
  renewals: [['R1', 7], ['R2', 5], ['R3', 4], ['R4', 4], ['R5', 4]],
  suppliers: [['S1', 5], ['S2', 4], ['S3', 3]],
  growth: [['G1', 6], ['G2', 6], ['G3', 6], ['G4', 6]],
  opportunity: [['O7', 8], ['O1', 4], ['O4', 6], ['O6', 6], ['O2', 4], ['O3', 4], ['O5', 4]],
};
const spanOf = (g: QGroup, id: string) => LAYOUT[g]?.find(x => x[0] === id)?.[1] ?? 4;
const placeOf = (g: QGroup, id: string) => { const i = LAYOUT[g]?.findIndex(x => x[0] === id) ?? -1; return i < 0 ? 99 : i; };

/**
 * Analysis center Overview, laid out as a dashboard (queue B1, Tariq: "no text
 * unrelated to the charts", modelled on a Power BI report): the headline tiles
 * on top, then one tab per question group, each a grid of chart tiles sized
 * to their chart (LAYOUT). A tile carries only its question as title; how to read it, the rule
 * behind any assumed (hatched, ≈) figure and who the real data was requested
 * from sit behind the ⓘ button. Every group stays rendered (the inactive ones
 * `hidden`) so a tab keeps its state. Figures come from the live rows only.
 */
export default function QuestionBoard(ctx: ChartCtx) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';

  const groups = useMemo(() => QUESTION_GROUPS.map(g => {
    const qs = questionsIn(g).filter(q => showOf(q));
    // Answered questions first in their LAYOUT order, grey boxes after them.
    const charts = qs.filter(q => showOf(q) === 'chart').sort((a, b) => placeOf(g, a.id) - placeOf(g, b.id));
    return { g, qs: [...charts, ...qs.filter(q => showOf(q) === 'need')] };
  }).filter(x => x.qs.length), []);
  const [active, setActive] = useState<QGroup>(groups[0]?.g ?? 'projects');

  const scrollTo = (el: HTMLElement | null) => el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const jump = (g: QGroup) => setActive(g);
  /** A headline tile opens its question: switch to that group's tab, then bring the tile into view. */
  const openQuestion = (id: string) => {
    const g = CEO_QUESTIONS.find(q => q.id === id)?.group;
    if (g) setActive(g);
    requestAnimationFrame(() => scrollTo(document.getElementById(`ac-q-${id}`)));
  };

  return (
    <div className="ac-board" data-ac="board">
      <Headline {...ctx} onOpen={openQuestion} />
      <nav className="ac-tabs" role="tablist" aria-label={t('Question groups')} data-ac="jump">
        {groups.map(x => (
          <button key={x.g} type="button" role="tab" aria-selected={x.g === active} className="ac-tab" onClick={() => jump(x.g)} data-ac-jump={x.g}>
            {pick(GROUP_LABEL[x.g], ar)}
          </button>
        ))}
      </nav>
      {groups.map(x => (
        <section key={x.g} id={`ac-group-${x.g}`} className="ac-group" data-ac-group={x.g} hidden={x.g !== active} aria-label={pick(GROUP_LABEL[x.g], ar)}>
          <div className="ac-grid">
            {x.qs.map(q => <QuestionTile key={q.id} q={q} ctx={ctx} span={spanOf(x.g, q.id)} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

/** One question as a dashboard tile: title row, chart, and the reading notes behind ⓘ. */
function QuestionTile({ q, ctx, span }: { q: CeoQuestion; ctx: ChartCtx; span: number }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  const sep = ar ? '، ' : ', ';
  const show = showOf(q);
  const who = (q.who || []).map(w => pick(OWNER_LABEL[w], ar)).join(sep);
  const [open, setOpen] = useState(false);
  // The chart's "assumed" rule (AssumedKey) is portalled into this panel.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const infoId = `ac-info-${q.id}`;

  return (
    <section id={`ac-q-${q.id}`} className={`card ac-card${show === 'need' ? ' ac-need' : ''}${open ? ' is-info' : ''}${span >= 7 ? ' ac-wide' : ''}`}
      style={{ '--ac-span': span } as React.CSSProperties} data-ac-q={q.id} data-ac-show={show} data-ac-span={span}>
      <header className="ac-head">
        <h3 className="ac-q" data-ac-title>{pick(q.q, ar)}</h3>
        <span className="ac-badge" aria-hidden="true" title={t('Hatched and ≈ = assumed')}>≈</span>
        <button type="button" className="ac-info-btn" aria-expanded={open} aria-controls={infoId} onClick={() => setOpen(o => !o)}
          aria-label={open ? t('Close') : t('How to read this chart')} title={open ? t('Close') : t('How to read this chart')} data-ac-info={q.id}>
          {open ? <X size={15} /> : <Info size={15} />}
        </button>
      </header>
      <div className="ac-body">
        {show === 'chart' ? (
          <InfoSlot.Provider value={slot}>{CHARTS[q.id](ctx)}</InfoSlot.Provider>
        ) : (
          <div className="ac-need-box" data-ac-need>
            <span className="ac-need-tag"><CircleDashed size={14} aria-hidden="true" />{t('Data needed')}</span>
            <dl className="ac-need-dl">
              <dt>{t('What is missing')}</dt><dd>{pick(q.missing, ar)}</dd>
              {who && <><dt>{t('Who has it')}</dt><dd>{who}</dd></>}
            </dl>
          </div>
        )}
      </div>
      <div id={infoId} className="ac-info" hidden={!open} data-ac-info-panel>
        <span className="ac-id">{q.id}</span>
        <p className="ac-note" data-ac-note>{pick(q.note, ar)}</p>
        <div ref={setSlot} />
        {show === 'chart' && q.data === 'part' && q.missing && (
          <p className="ac-still" data-ac-still>
            {who ? t('Requested from {{who}}: {{what}}', { who, what: pick(q.missing, ar) }) : t('Requested: {{what}}', { what: pick(q.missing, ar) })}
          </p>
        )}
      </div>
    </section>
  );
}
