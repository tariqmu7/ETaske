import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, ChevronRight } from 'lucide-react';
import { AGIBA_CLIENT, BENCHMARK_CLIENT, clientProfile, rateGrid, soLines, type BdData } from '../../lib/bdControl';
import { Fields, GRADE_SHORT, useBdWords, useMasonry } from './shared';
import { AddButton, EditButton, EditedBadge } from './EditRecord';
import AgibaSections, { type AgibaFocus } from './AgibaSections';

interface Props {
  data: BdData;
  today: string;
  code: string;
  onBack: () => void;
  onSupplier: (contractNo: string) => void;
  /** AGIBA page only: the site contract / SO a data issue points at. */
  focus?: AgibaFocus | null;
}

/**
 * The client page (queue E6a): one client's contract lines, day-rates against
 * ANOPC, supplier contracts, what changed between the two CSA reports and the
 * data issues that touch it. Reached from the Contracts tab, the Pricing grid,
 * the Overview ceiling / reprice charts and the Data quality list. Lines and
 * day-rates carry an Edit button for managers (E6b), and both sections an Add
 * button that opens the form with this client filled in (E6c). The AGIBA page
 * also holds AGIBA's site contracts and service orders (queue A5).
 */
export default function ClientPage({ data, today, code, onBack, onSupplier, focus }: Props) {
  const w = useBdWords(data);
  const packed = useMasonry<HTMLDivElement>();
  const { t } = useTranslation();
  const { F } = w;
  const grid = useMemo(() => rateGrid(data.dayRates), [data.dayRates]);
  const p = useMemo(() => clientProfile(data, code, today, grid), [data, code, today, grid]);
  const Back = w.ar ? ArrowRight : ArrowLeft;
  const other = p.client ? (w.ar ? p.client.name : p.client.arabicName) : null;
  const val = (v: unknown) => (v == null || v === '' ? null : w.bidi(w.word(v)));
  const rateRow = useMemo(() => new Map(data.dayRates.filter(r => r.client === code).map(r => [r.grade, r])), [data.dayRates, code]);
  const gradeName = (g: string) => (GRADE_SHORT[g] ? t(GRADE_SHORT[g]) : g);
  const agiba = code === AGIBA_CLIENT;
  const openSOs = useMemo(() => (agiba ? soLines(data, today, true).length : 0), [agiba, data, today]);

  const section = (title: string, attr: string, body: React.ReactNode, sub?: string, action?: React.ReactNode) => (
    <section className="card bdc-card" data-bdc-client={attr}>
      {action ? <div className="bdc-head-row"><h2 className="bdc-h">{title}</h2>{action}</div> : <h2 className="bdc-h">{title}</h2>}
      {sub && <p className="bdc-cap">{sub}</p>}
      {body}
    </section>
  );

  return (
    <div data-bdc-tab="client" data-bdc-code={code}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} data-bdc="back" style={{ marginBottom: 8 }}>
        <Back size={15} /> {t('All contract lines')}
      </button>
      <section className="card bdc-card" data-bdc-client="head">
        <h2 className="bdc-title">{w.bidi(w.nameOf(code))}</h2>
        {(other || (w.ar && code !== w.nameOf(code))) && (
          <p className="bdc-cap" style={{ marginBottom: 6 }}>{[w.ar ? code : null, other].filter(Boolean).join(' · ')}</p>
        )}
        <div className="bdc-figs" data-bdc="clientfigs">
          <span><b data-bdc-fig="lines">{F.number(p.lines.length)}</b>{t('contract lines')}</span>
          {p.ceilingEgp > 0 && <span><b data-bdc-fig="ceiling">{w.egpM(p.ceilingEgp)}</b>{t('total ceiling')}</span>}
          {p.monthlyEgp > 0 && <span><b data-bdc-fig="monthly">{w.egp(p.monthlyEgp)}</b>{t('a month')}</span>}
          <span><b data-bdc-fig="suppliers">{F.number(p.liveSuppliers)}</b>{t('live supplier contracts')}</span>
          {agiba && data.agibaSiteContracts.length > 0 && <span><b data-bdc-fig="sites">{F.number(data.agibaSiteContracts.length)}</b>{t('site contracts')}</span>}
          {agiba && data.agibaSOs.length > 0 && <span><b data-bdc-fig="sos">{F.number(openSOs)}</b>{t('service orders still open')}</span>}
          {p.avgGap != null && code !== BENCHMARK_CLIENT && (
            <span><b data-bdc-fig="gap" className={`bdc-gap-${w.gapTone(p.avgGap)}`}>{w.pct(p.avgGap)}</b>{t('day-rates against {{name}}', { name: w.nameOf(BENCHMARK_CLIENT) })}</span>
          )}
          {p.issues.length > 0 && <span><b data-bdc-fig="issues">{F.number(p.issues.length)}</b>{t('data issues')}</span>}
        </div>
      </section>

      <div ref={packed} className="bdc-grid">
        {section(t('Contract lines'), 'lines', p.lines.length === 0
          ? <p className="bdc-empty">{t('No client line on file')}</p>
          : <div className="bdc-stackl">
              {p.lines.map(l => (
                <div key={l.row.id} className="bdc-item" data-bdc-row="clientline" data-bdc-key={l.row.id}>
                  <div className="bdc-item-head">
                    <b>{l.row.contractType ? w.bidi(String(l.row.contractType)) : t('Type not given')}</b>
                    <span className="bdc-item-tags">
                      <EditedBadge row={l.row} />
                      {w.flag(l.flag)}
                      <EditButton table="clientContracts" row={l.row} title={[w.nameOf(code), l.row.contractType].filter(Boolean).join(' · ')} />
                    </span>
                  </div>
                  <Fields attr="clientline" items={[
                    [t('Expiry'), w.ends(l.row.expiryDate, l.days)],
                    [t('Status'), l.row.status ? w.word(l.row.status) : t('Status blank')],
                    [t('Ceiling'), typeof l.row.ceilingEgp === 'number' ? w.egp(l.row.ceilingEgp) : null],
                    [t('Monthly value'), typeof l.row.monthlyValueEgp === 'number' ? w.egp(l.row.monthlyValueEgp) : null],
                    [t('Value basis'), val(l.row.valueBasis)],
                    [t('Amendment'), val(l.row.amendment)],
                    [t('Comments'), val(l.row.comments)],
                  ]} />
                </div>
              ))}
            </div>, undefined,
          <AddButton table="clientContracts" label={t('Add a line')} title={t('Add a contract line for {{client}}', { client: w.nameOf(code) })} preset={{ client: code }} />)}

        {agiba && <AgibaSections data={data} today={today} focus={focus} />}

        {section(t('Day-rates'), 'rates', p.rates.length === 0
          ? <p className="bdc-empty" data-bdc-empty="clientrates">{t('This client has no column on the day-rate sheet.')}</p>
          : <div className="bdc-list">
              {p.rates.map(r => (
                <div key={r.grade} className="bdc-row bdc-row-dated" data-bdc-row="clientrate" data-bdc-key={r.grade}>
                  <span className="bdc-name"><span>{gradeName(r.grade)}</span></span>
                  <span className="bdc-line-when">
                    <span className="bdc-num">{F.number(r.rate, { maximumFractionDigits: 1 })}</span>
                    {code !== BENCHMARK_CLIENT && <span className={`bdc-gap bdc-gap-${w.gapTone(r.gap)}`} data-bdc-gap>{w.pct(r.gap)}</span>}
                    {rateRow.get(r.grade) && <>
                      <EditedBadge row={rateRow.get(r.grade)!} />
                      <EditButton table="dayRates" row={rateRow.get(r.grade)!} title={t('{{client}} day rate · {{grade}}', { client: w.nameOf(code), grade: gradeName(r.grade) })} />
                    </>}
                  </span>
                </div>
              ))}
            </div>,
          code === BENCHMARK_CLIENT ? t('EGP per man-day · this is the benchmark client')
            : t('EGP per man-day · gap against {{name}}', { name: w.nameOf(BENCHMARK_CLIENT) }),
          <AddButton table="dayRates" label={t('Add a day rate')} title={t('Add a day rate for {{client}}', { client: w.nameOf(code) })} preset={{ client: code }} />)}

        {section(t('Supplier contracts'), 'suppliers', p.suppliers.length === 0
          ? <p className="bdc-empty" data-bdc-empty="clientsuppliers">{t('No supplier contract is booked to this client.')}</p>
          : <>
              {p.liveSupplierEgp > 0 && <p className="bdc-cap">{t('Live, in EGP: {{v}}', { v: w.egpM(p.liveSupplierEgp) })}</p>}
              <div className="bdc-list">
                {p.suppliers.map(s => (
                  <button key={s.row.id} type="button" className="bdc-row bdc-row-line bdc-click" onClick={() => onSupplier(s.row.contractNo)}
                    data-bdc-row="clientsupplier" data-bdc-key={s.row.contractNo}>
                    <span className="bdc-name">
                      <span><span dir="ltr">{s.row.contractNo}</span>{s.row.contractor && <> · {w.bidi(String(s.row.contractor))}</>}</span>
                      <span className="bdc-sub">{[s.row.status ? w.word(s.row.status) : t('Status blank'),
                        s.egp ? (typeof s.row.currentValueEgp === 'number' ? w.egpM(s.row.currentValueEgp) : null) : String(s.row.valueCurrencyNote)]
                        .filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="bdc-line-when">{s.live ? w.flag(s.flag) : w.flag('Ended')}</span>
                    <ChevronRight size={16} className="bdc-chev" aria-hidden />
                  </button>
                ))}
              </div>
            </>)}

        {p.changes.length > 0 && section(t('What changed between the two CSA reports'), 'changes',
          <ul className="bdc-changes" style={{ borderBottom: 0, paddingInlineStart: 0 }}>
            {p.changes.map(c => (
              <li key={c.id} data-bdc-row="clientchange" style={{ paddingInlineStart: 0 }}>
                <span className="bdc-change-what">{[c.type, c.field ? t(c.field) : t('(whole line)')].filter(Boolean).join(' · ')}</span>
                <span className="bdc-change-vals">
                  {c.from == null || c.from === '' ? <span className="bdc-blank">{t('blank')}</span> : w.bidi(String(w.date(c.from) || c.from))}
                  {' '}<span className="bdc-arrow">→</span>{' '}
                  {c.to == null || c.to === '' ? <span className="bdc-blank">{t('blank')}</span> : w.bidi(String(w.date(c.to) || c.to))}
                </span>
              </li>
            ))}
          </ul>)}

        {p.issues.length > 0 && section(t('Data issues'), 'issues',
          <ul className="bdc-issues">
            {p.issues.map(i => (
              <li key={i.id} data-bdc-row="clientissue">
                <span className="bdc-change-what">{[w.word(i.table), i.record].filter(Boolean).join(' · ')}</span>
                <span>{i.issue}</span>
                {i.whatToDo && <span className="bdc-sub" style={{ whiteSpace: 'normal' }}>{t('To do: {{x}}', { x: i.whatToDo })}</span>}
              </li>
            ))}
          </ul>)}
      </div>
    </div>
  );
}
