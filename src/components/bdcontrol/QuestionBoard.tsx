import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDashed } from 'lucide-react';
import { useFormat } from '../../lib/format';
import {
  GROUP_LABEL, OWNER_LABEL, QUESTION_GROUPS, pick, questionsIn, type CeoQuestion, type QGroup,
} from '../../lib/ceoQuestions';
import { PROJECT_CHARTS, type ChartCtx } from './ProjectCharts';

/** Every question chart built so far, by question id. */
const CHARTS: Record<string, (c: ChartCtx) => React.ReactElement> = { ...PROJECT_CHARTS };

/** How a question shows today: its chart, a grey "data needed" box, or not yet (chart still to be built). */
export type QShow = 'chart' | 'need' | null;
export const showOf = (q: CeoQuestion): QShow => (CHARTS[q.id] ? 'chart' : q.data === 'missing' ? 'need' : null);

/**
 * Analysis center Overview (queue A1): the CEO's questions (lib/ceoQuestions.ts)
 * in their 8 groups. Each card is titled by its question and carries a fixed
 * note on how to read it. A question whose data we do not hold yet is a grey
 * "data needed" box naming what is missing and who has it — so the page is
 * also BD's data to-do list. Figures come from the live rows only.
 */
export default function QuestionBoard(ctx: ChartCtx) {
  const { t, i18n } = useTranslation();
  const F = useFormat();
  const ar = i18n.language === 'ar';
  const sep = ar ? '، ' : ', ';

  const groups = useMemo(() => QUESTION_GROUPS.map(g => {
    const qs = questionsIn(g).filter(q => showOf(q));
    return { g, qs, charts: qs.filter(q => showOf(q) === 'chart').length, needs: qs.filter(q => showOf(q) === 'need').length };
  }).filter(x => x.qs.length), []);
  const answered = groups.reduce((a, x) => a + x.charts, 0);
  const waiting = groups.reduce((a, x) => a + x.needs, 0);

  const jump = (g: QGroup) => document.getElementById(`ac-group-${g}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

  const card = (q: CeoQuestion) => {
    const show = showOf(q);
    const who = (q.who || []).map(w => pick(OWNER_LABEL[w], ar)).join(sep);
    return (
      <section key={q.id} id={`ac-q-${q.id}`} className={`card ac-card${show === 'need' ? ' ac-need' : ''}`} data-ac-q={q.id} data-ac-show={show}>
        <header className="ac-head">
          <span className="ac-id" aria-hidden="true">{q.id}</span>
          <h3 className="ac-q" data-ac-title>{pick(q.q, ar)}</h3>
        </header>
        <p className="ac-note" data-ac-note>{pick(q.note, ar)}</p>
        {show === 'chart' ? (
          <>
            {CHARTS[q.id](ctx)}
            {q.data === 'part' && q.missing && (
              <p className="ac-still" data-ac-still>
                {t('Still to collect: {{what}}', { what: pick(q.missing, ar) })}{who && <> · {t('Who has it: {{who}}', { who })}</>}
              </p>
            )}
          </>
        ) : (
          <div className="ac-need-box" data-ac-need>
            <span className="ac-need-tag"><CircleDashed size={14} aria-hidden="true" />{t('Data needed')}</span>
            <dl className="ac-need-dl">
              <dt>{t('What is missing')}</dt><dd>{pick(q.missing, ar)}</dd>
              {who && <><dt>{t('Who has it')}</dt><dd>{who}</dd></>}
            </dl>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="ac-board" data-ac="board">
      <p className="ac-summary" data-ac="summary">
        {t('{{a}} questions answered from today’s data · {{w}} waiting for data from other departments', { a: F.number(answered), w: F.number(waiting) })}
      </p>
      <nav className="bdc-chips ac-jump" aria-label={t('Question groups')} data-ac="jump">
        {groups.map(x => (
          <button key={x.g} type="button" className="bdc-chip" onClick={() => jump(x.g)} data-ac-jump={x.g}>
            {pick(GROUP_LABEL[x.g], ar)}<span className="bdc-chip-n">{F.number(x.qs.length)}</span>
          </button>
        ))}
      </nav>
      {groups.map((x, i) => (
        <section key={x.g} id={`ac-group-${x.g}`} className="ac-group" data-ac-group={x.g}>
          <h2 className="ac-group-h">
            <span className="ac-group-no">{F.number(QUESTION_GROUPS.indexOf(x.g) + 1)}</span>
            {pick(GROUP_LABEL[x.g], ar)}
            <span className="ac-group-sub">
              {t('Answered: {{a}} · data needed: {{w}}', { a: F.number(x.charts), w: F.number(x.needs) })}
            </span>
          </h2>
          <div className="ac-grid" data-ac-order={i}>
            {/* Answered questions first, grey boxes after them. */}
            {[...x.qs.filter(q => showOf(q) === 'chart'), ...x.qs.filter(q => showOf(q) === 'need')].map(card)}
          </div>
        </section>
      ))}
    </div>
  );
}
