import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDashed } from 'lucide-react';
import { useFormat } from '../../lib/format';
import { endingSoon, moneyLastYear, owedByAge, pastEnd, pipelineByStage, projectGrowth, projectStatus, projectTotals } from '../../lib/analysisCenter';
import { CEO_QUESTIONS, OWNER_LABEL, pick } from '../../lib/ceoQuestions';
import { useBdWords } from './shared';
import type { ChartCtx } from './ProjectCharts';

/**
 * The first-screen headline strip (queue A3, decision D5): one number for each
 * of the CEO's top questions, in this order. A tile opens its question's card
 * further down. A question we have no figure for yet shows a dashed "waiting"
 * tile naming who the data was requested from — it fills in on its own once a
 * figure function is added below.
 */
export const HEADLINE_IDS = ['P1', 'P2', 'M9', 'M3', 'R1', 'R2', 'A3', 'G2'] as const;

/** Short tile labels (the full question is on the card). */
const TILE_LABEL: Record<string, string> = {
  P1: 'Projects', P2: 'Live projects', M9: 'Profit', M3: 'Owed to us',
  R1: 'Ending within 90 days', R2: 'Past their end date', A3: 'Projects grown in value', G2: 'Pipeline',
};

interface Fig { value: string; sub?: string; tone?: 'warn' }

export default function Headline({ data, today, bids }: ChartCtx) {
  const { t, i18n } = useTranslation();
  const F = useFormat();
  const { nameOf, egpM } = useBdWords(data);
  const ar = i18n.language === 'ar';
  const sep = ar ? '، ' : ', ';

  const figs = useMemo((): Record<string, Fig> => {
    const tot = projectTotals(data);
    const st = Object.fromEntries(projectStatus(data, today).map(x => [x.state, x.count]));
    const soon = endingSoon(data, today);
    const n30 = soon.windows.find(x => x.w === 'd30')!.lines.length;
    const n90 = n30 + soon.windows.find(x => x.w === 'd90')!.lines.length;
    const past = pastEnd(data, today).lines.length;
    const g = projectGrowth(data, Infinity);
    const top = g.rows[0];
    const ap = g.rows.some(r => r.assumed) ? '≈ ' : '';
    // M9 / M3 are assumed figures (queue A7a) — always "≈", same rules as their cards.
    const billed = moneyLastYear(data, today).rows.filter(r => r.invoicedEgp > 0);
    const profit = billed.reduce((a, r) => a + r.profitEgp, 0), losing = billed.filter(r => r.profitEgp < 0).length;
    const owed = owedByAge(data, today);
    const over90 = owed.bands.find(b => b.band === 'over90')!.egp;
    // G2 reads the app's own bid register (queue A7b); no tile figure while it loads or if the read failed.
    const pipe = Array.isArray(bids) ? pipelineByStage(bids) : null;
    return {
      ...(billed.length ? { M9: { value: `≈ ${egpM(profit)}`, sub: t('Losing money: {{n}}', { n: F.number(losing) }), tone: losing > 0 || profit < 0 ? 'warn' as const : undefined } } : {}),
      ...(owed.owedEgp > 0 ? { M3: { value: `≈ ${egpM(owed.owedEgp)}`, sub: t('Over 90 days: {{v}}', { v: `≈ ${egpM(over90)}` }) } } : {}),
      ...(pipe ? { G2: { value: F.number(pipe.open), sub: t('Value {{v}}', { v: egpM(pipe.valueEgp) }) } } : {}),
      P1: { value: F.number(tot.projects), sub: t('Amendments: {{n}}', { n: F.number(tot.amendments) }) },
      P2: { value: F.number(st.running + st.endingSoon), sub: t('Of {{n}} on file', { n: F.number(tot.projects) }) },
      R1: { value: F.number(n90), sub: t('Within 30 days: {{n}}', { n: F.number(n30) }), tone: n30 > 0 ? 'warn' : undefined },
      R2: { value: F.number(past), tone: past > 0 ? 'warn' : undefined },
      A3: {
        value: `${ap}${F.number(g.rows.length)}`,
        sub: top ? t('Biggest: {{pct}} · {{name}}', { pct: `${top.assumed ? '≈ ' : ''}+${F.number(top.value, { maximumFractionDigits: 0 })}%`, name: nameOf(top.client) }) : undefined,
      },
    };
  }, [data, today, bids, t, F, nameOf, egpM]);

  const go = (id: string) => document.getElementById(`ac-q-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

  return (
    <section className="ac-headline" data-ac="headline" aria-label={t('At a glance')}>
      <h2 className="ac-headline-h">{t('At a glance')}</h2>
      <div className="ac-headline-grid">
        {HEADLINE_IDS.map(id => {
          const f = figs[id];
          const q = CEO_QUESTIONS.find(x => x.id === id);
          const who = (q?.who || []).map(w => pick(OWNER_LABEL[w], ar)).join(sep);
          return (
            <button key={id} type="button" className={`ac-tile${f ? '' : ' ac-tile-wait'}${f?.tone === 'warn' ? ' ac-tile-warn' : ''}`}
              onClick={() => go(id)} title={q ? pick(q.q, ar) : undefined} data-ac-tile={id} data-ac-wait={f ? undefined : ''}>
              <span className="ac-tile-label">{t(TILE_LABEL[id])}</span>
              {f
                ? <b className="ac-tile-n" data-ac-value>{f.value}</b>
                : <span className="ac-tile-wait-tag"><CircleDashed size={13} aria-hidden="true" />{t('Data needed')}</span>}
              {f?.sub && <span className="ac-tile-sub" data-ac-sub>{f.sub}</span>}
              {!f && who && <span className="ac-tile-sub" data-ac-sub>{t('Requested from {{who}}', { who })}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
