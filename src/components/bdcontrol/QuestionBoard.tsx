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
 * Analysis center Overview, laid out as a dashboard (queue B1, Tariq: "no text
 * unrelated to the charts", modelled on a Power BI report): the headline tiles
 * on top, then one tab per question group, each a grid of same-height chart
 * tiles. A tile carries only its question as title; how to read it, the rule
 * behind any assumed (hatched, ≈) figure and who the real data was requested
 * from sit behind the ⓘ button. Every group stays rendered (the inactive ones
 * `hidden`) so a tab keeps its state. Figures come from the live rows only.
 */
export default function QuestionBoard(ctx: ChartCtx) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';

  const groups = useMemo(() => QUESTION_GROUPS.map(g => {
    const qs = questionsIn(g).filter(q => showOf(q));
    // Answered questions first, grey boxes after them.
    return { g, qs: [...qs.filter(q => showOf(q) === 'chart'), ...qs.filter(q => showOf(q) === 'need')] };
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
            {x.qs.map(q => <QuestionTile key={q.id} q={q} ctx={ctx} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

/** One question as a dashboard tile: title row, chart, and the reading notes behind ⓘ. */
function QuestionTile({ q, ctx }: { q: CeoQuestion; ctx: ChartCtx }) {
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
    <section id={`ac-q-${q.id}`} className={`card ac-card${show === 'need' ? ' ac-need' : ''}${open ? ' is-info' : ''}`} data-ac-q={q.id} data-ac-show={show}>
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
