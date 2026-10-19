import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SO_SOON_DAYS, agibaSos, amendmentGrowth, awaitedData, changesByClient, issuesByTable, millions, periodDate, supplierCost,
  type BdData, type SoItem, type SupplierGroup,
} from '../../lib/bdControl';
import { useFormat, DATE_MEDIUM } from '../../lib/format';

interface Props { data: BdData; today: string }

/** Long lists start short. */
const FIRST = 8;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * BD control Overview charts 7–12 (queue E5c): supplier cost, amendment growth,
 * AGIBA service orders, what changed between two CSA reports, data issues per
 * sheet and the "awaiting data" panel. Rendered inside the same grid as charts
 * 3–6; every figure from lib/bdControl.ts. Status, type and sheet names from the
 * files are translated when the app knows them and shown as written otherwise.
 */
export default function OverviewMoreCharts({ data, today }: Props) {
  const { t, i18n } = useTranslation();
  const F = useFormat();
  const ar = i18n.language === 'ar';
  const sep = ar ? '، ' : ', ';

  const sc = useMemo(() => supplierCost(data), [data]);
  const ag = useMemo(() => amendmentGrowth(data), [data]);
  const so = useMemo(() => agibaSos(data, today), [data, today]);
  const ch = useMemo(() => changesByClient(data.changes), [data.changes]);
  const iss = useMemo(() => issuesByTable(data.dataIssues), [data.dataIssues]);
  const aw = useMemo(() => awaitedData(data.meta), [data.meta]);

  const [allSupClients, setAllSupClients] = useState(false);
  const [allContractors, setAllContractors] = useState(false);

  const names = useMemo(() => new Map(data.clients.map(c => [c.code, c.arabicName || ''])), [data.clients]);
  const nameOf = (code: string) => (ar && names.get(code)) || code;
  const pct = (v: number | null) => v == null ? '—'
    : `${v > 0.05 ? '+' : v < -0.05 ? '−' : ''}${F.number(Math.abs(v), { minimumFractionDigits: 0, maximumFractionDigits: v !== 0 && Math.abs(v) < 10 ? 1 : 0 })}%`;
  const egpM = (egp: number) => t('{{value}} m EGP', { value: F.number(millions(egp), { maximumFractionDigits: 1 }) });
  /** A value from the files: a known word is translated, anything else shown as written. */
  const word = (v: string, blank: string) => (v ? t(v) : t(blank));
  const bidi = (s: string) => <span className={F.bidiFor(s)}>{s}</span>;

  const section = (title: string, attr: string, sub: string | null, body: React.ReactNode) => (
    <section className="card bdc-card" data-bdc={attr}>
      <h2 className="bdc-h">{title}</h2>
      {sub && <p className="bdc-cap">{sub}</p>}
      {body}
    </section>
  );
  const more = (attr: string, all: boolean, set: (f: (v: boolean) => boolean) => void, count: number) => count > FIRST && (
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => set(v => !v)} data-bdc-more={attr} style={{ marginTop: 6 }}>
      {all ? t('Show fewer') : t('Show all {{count}}', { count })}
    </button>
  );
  const bar = (value: number, max: number, cls = '') => (
    <span className="bdc-track"><span className={`bdc-fill${cls ? ' ' + cls : ''}`} style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} /></span>
  );

  // 7 — supplier cost
  const supRow = (g: SupplierGroup, kind: 'client' | 'costType', max: number) => {
    const label = kind === 'client' ? (g.key ? nameOf(g.key) : t('No client named')) : word(g.key, 'No cost type');
    return (
      <div key={g.key} className="bdc-row" data-bdc-row={kind === 'client' ? 'supclient' : 'costtype'} data-bdc-key={g.key}>
        <span className="bdc-name">
          {bidi(label)}
          <span className="bdc-sub">{t('Contracts: {{n}}', { n: F.number(g.count) })}</span>
        </span>
        {bar(g.currentEgp, max, 'bdc-fill-supplier')}
        <span className="bdc-num" data-bdc-value>{egpM(g.currentEgp)}</span>
      </div>
    );
  };
  const supMax = Math.max(1, ...sc.byClient.map(g => g.currentEgp));
  const ctMax = Math.max(1, ...sc.byCostType.map(g => g.currentEgp));
  const chart7 = section(t('What supplier contracts cost'), 'suppliers', t('Live supplier contracts, current value in EGP'), sc.live === 0
    ? <p className="bdc-empty" data-bdc-empty="suppliers">{t('No live supplier contract on file.')}</p>
    : <>
        <div className="bdc-figs" data-bdc="supfigs">
          <span><b data-bdc-fig="current">{egpM(sc.currentEgp)}</b>{t('today')}</span>
          <span><b data-bdc-fig="original">{egpM(sc.originalEgp)}</b>{t('when signed')}</span>
          <span><b data-bdc-fig="growth" className={sc.growthPct != null && sc.growthPct > 0 ? 'bdc-red' : undefined}>{pct(sc.growthPct)}</b>{t('growth through amendments')}</span>
        </div>
        <h3 className="bdc-h3">{t('By cost type')}</h3>
        <div className="bdc-list">{sc.byCostType.map(g => supRow(g, 'costType', ctMax))}</div>
        <h3 className="bdc-h3">{t('By client')}</h3>
        <div className="bdc-list">{(allSupClients ? sc.byClient : sc.byClient.slice(0, FIRST)).map(g => supRow(g, 'client', supMax))}</div>
        {more('supclient', allSupClients, setAllSupClients, sc.byClient.length)}
        <p className="bdc-foot" data-bdc-foot="suppliers">
          {t('Growth counts only the {{n}} contracts with both values on file.', { n: F.number(sc.linesWithBoth) })}
          {sc.otherCurrency > 0 && <> {t('In another currency, left out: {{n}}', { n: F.number(sc.otherCurrency) })}</>}
        </p>
      </>);

  // 8 — amendment growth
  const agMax = Math.max(1, ...ag.rows.map(r => r.growthPct));
  const chart8 = section(t('Biggest growth through amendments'), 'growth', t('Live supplier contracts, today’s value against the value when signed'), ag.rows.length === 0
    ? <p className="bdc-empty" data-bdc-empty="growth">{t('No live supplier contract has both an original and a current value.')}</p>
    : <>
        <div className="bdc-list">
          {ag.rows.map(r => (
            <div key={r.id} className="bdc-row" data-bdc-row="growth" data-bdc-key={r.contractNo}>
              <span className="bdc-name">
                <span><span dir="ltr">{r.contractNo}</span>{r.contractor && <> · {bidi(r.contractor)}</>}</span>
                <span className="bdc-sub">
                  {t('{{from}} → {{to}} · amendments: {{n}}', { from: egpM(r.originalEgp), to: egpM(r.currentEgp), n: F.number(r.amendments) })}
                  {r.client && <> · {nameOf(r.client)}</>}
                </span>
              </span>
              {bar(Math.max(0, r.growthPct), agMax, r.growthPct >= 100 ? 'bdc-fill-lo' : r.growthPct >= 25 ? 'bdc-fill-mid' : 'bdc-fill-base')}
              <span className={`bdc-gap ${r.growthPct >= 100 ? 'bdc-gap-lo' : r.growthPct >= 25 ? 'bdc-gap-mid' : 'bdc-gap-flat'}`} data-bdc-value>{pct(r.growthPct)}</span>
            </div>
          ))}
        </div>
        {ag.types.length > 0 && (
          <p className="bdc-foot" data-bdc-foot="types">
            {t('Amendments on live contracts: {{n}}', { n: F.number(ag.amendments) })} — {ag.types.map(x => `${word(x.type, 'Type not given')} ${F.number(x.count)}`).join(sep)}
          </p>
        )}
        <ul className="bdc-legend">
          <li><span className="bdc-key bdc-fill-lo" aria-hidden />{t('Doubled or more')}</li>
          <li><span className="bdc-key bdc-fill-mid" aria-hidden />{t('Up 25% to 100%')}</li>
          <li><span className="bdc-key bdc-fill-base" aria-hidden />{t('Up less than 25%')}</li>
        </ul>
      </>);

  // 9 — AGIBA service orders
  const stMax = Math.max(1, ...so.byStatus.map(s => s.count));
  const coMax = Math.max(1, ...so.byContractor.map(c => c.count));
  const soLine = (x: SoItem, kind: 'soon' | 'past') => (
    <div key={x.id} className="bdc-row bdc-row-dated" data-bdc-row={kind === 'soon' ? 'sosoon' : 'sopast'} data-bdc-key={x.so}>
      <span className="bdc-name">
        <span><span dir="ltr">{x.so}</span>{x.contractor && <> · {bidi(x.contractor)}</>}</span>
        <span className="bdc-sub">{[x.item, word(x.status, 'Status blank')].filter(Boolean).join(' · ')}</span>
      </span>
      <span className={`bdc-when${kind === 'past' ? ' bdc-red' : ''}`}>
        {kind === 'soon'
          ? (x.days === 0 ? t('Ends today') : t('Ends {{date}} · days remaining: {{days}}', { date: F.date(x.expiry, DATE_MEDIUM), days: F.number(x.days) }))
          : t('Ended {{date}} · {{n}} days ago', { date: F.date(x.expiry, DATE_MEDIUM), n: F.number(-(x.days as number)) })}
      </span>
    </div>
  );
  const chart9 = section(t('AGIBA service orders'), 'agiba', t('Meleiha site · open = not completed or cancelled'), so.total === 0
    ? <p className="bdc-empty" data-bdc-empty="agiba">{t('No AGIBA service order on file.')}</p>
    : <>
        <div className="bdc-figs">
          <span><b data-bdc-fig="sototal">{F.number(so.total)}</b>{t('service orders')}</span>
          <span><b data-bdc-fig="soopen">{F.number(so.open)}</b>{t('still open')}</span>
          <span><b data-bdc-fig="sopast" className={so.past.length ? 'bdc-red' : undefined}>{F.number(so.past.length)}</b>{t('open past their date')}</span>
        </div>
        <h3 className="bdc-h3">{t('By status')}</h3>
        <div className="bdc-list">
          {so.byStatus.map(s => (
            <div key={s.status} className="bdc-row" data-bdc-row="sostatus" data-bdc-key={s.status}>
              <span className="bdc-name">{bidi(word(s.status, 'Status blank'))}</span>
              {bar(s.count, stMax, 'bdc-fill-agibaSite')}
              <span className="bdc-num" data-bdc-value>{F.number(s.count)}</span>
            </div>
          ))}
        </div>
        <h3 className="bdc-h3">{t('By contractor')}</h3>
        <div className="bdc-list">
          {(allContractors ? so.byContractor : so.byContractor.slice(0, FIRST)).map(c => (
            <div key={c.contractor} className="bdc-row" data-bdc-row="socontractor" data-bdc-key={c.contractor}>
              <span className="bdc-name">
                {bidi(c.contractor || t('No contractor named'))}
                <span className="bdc-sub">{t('Open: {{n}} · {{value}}', { n: F.number(c.open), value: egpM(c.egp) })}</span>
              </span>
              {bar(c.count, coMax, 'bdc-fill-agibaSite')}
              <span className="bdc-num" data-bdc-value>{F.number(c.count)}</span>
            </div>
          ))}
        </div>
        {more('socontractor', allContractors, setAllContractors, so.byContractor.length)}
        <h3 className="bdc-h3">{t('Open, ending within {{n}} days', { n: F.number(SO_SOON_DAYS) })}</h3>
        {so.soon.length === 0
          ? <p className="bdc-empty" data-bdc-empty="sosoon">{t('None.')}</p>
          : <div className="bdc-list">{so.soon.map(x => soLine(x, 'soon'))}</div>}
        {so.past.length > 0 && <>
          <h3 className="bdc-h3 bdc-red">{t('Open but past their date — close or extend')}</h3>
          <div className="bdc-list">{so.past.map(x => soLine(x, 'past'))}</div>
        </>}
        {so.otherCurrency > 0 && <p className="bdc-foot" data-bdc-foot="socur">{t('Amounts in another currency are left out of the EGP figures: {{n}}', { n: F.number(so.otherCurrency) })}</p>}
      </>);

  // 10 — what changed between two CSA reports
  const period = (k: string | null) => (k && periodDate(k) ? F.date(periodDate(k), { month: 'long', year: 'numeric' }) : '—');
  const val = (v: unknown) => {
    if (v == null || v === '') return <span className="bdc-blank">{t('blank')}</span>;
    if (typeof v === 'number') return F.number(v, { maximumFractionDigits: 1 });
    const s = String(v);
    return ISO_DAY.test(s) ? F.date(s, DATE_MEDIUM) : bidi(s);
  };
  const chMax = Math.max(1, ...ch.clients.map(c => c.changes.length));
  const chart10 = section(t('What changed between the two CSA reports'), 'changes',
    ch.from && ch.to ? t('{{from}} → {{to}} · changes per client, open a row for the detail', { from: period(ch.from), to: period(ch.to) }) : null,
    ch.total === 0
      ? <p className="bdc-empty" data-bdc-empty="changes">{t('No changes between reports on file.')}</p>
      : <div className="bdc-list">
          {ch.clients.map(c => (
            <details key={c.client} className="bdc-details" data-bdc-row="change" data-bdc-key={c.client}>
              <summary className="bdc-row">
                <span className="bdc-name">
                  {bidi(c.client ? nameOf(c.client) : t('No client named'))}
                  <span className="bdc-sub">{c.fields.map(f => t(f)).join(sep)}</span>
                </span>
                {bar(c.changes.length, chMax)}
                <span className="bdc-num" data-bdc-value>{F.number(c.changes.length)}</span>
              </summary>
              <ul className="bdc-changes">
                {c.changes.map(x => (
                  <li key={x.id} data-bdc-change={x.field}>
                    <span className="bdc-change-what">{[x.type, t(x.field)].filter(Boolean).join(' · ')}</span>
                    <span className="bdc-change-vals">{val(x.from)} <span className="bdc-arrow">→</span> {val(x.to)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>);

  // 11 — data issues per sheet
  const isMax = Math.max(1, ...iss.map(x => x.count));
  const chart11 = section(t('Data issues by sheet'), 'issues', t('Gaps and clashes the loader found in the Excel files'), iss.length === 0
    ? <p className="bdc-empty" data-bdc-empty="issues">{t('No data issues — the files are clean.')}</p>
    : <div className="bdc-list">
        {iss.map(x => (
          <div key={x.table} className="bdc-row" data-bdc-row="issue" data-bdc-key={x.table}>
            <span className="bdc-name">
              {bidi(word(x.table, 'Sheet not named'))}
              <span className="bdc-sub">{t('Records affected: {{n}}', { n: F.number(x.records) })}</span>
            </span>
            {bar(x.count, isMax, 'bdc-fill-issue')}
            <span className="bdc-num" data-bdc-value>{F.number(x.count)}</span>
          </div>
        ))}
      </div>);

  // 12 — awaiting data
  const chart12 = section(t('Awaiting data'), 'awaited',
    aw.items.length ? t('From the department data-request pack · received: {{n}} of {{total}}', { n: F.number(aw.received), total: F.number(aw.items.length) }) : null,
    aw.items.length === 0
      ? <p className="bdc-empty" data-bdc-empty="awaited">{aw.listed ? t('Nothing is awaited: every measure has arrived.') : t('No list of awaited data on file.')}</p>
      : <>
          <ul className="bdc-await">
            {aw.items.map(a => (
              <li key={a.measure} data-bdc-row="awaited" data-bdc-key={a.measure} data-bdc-received={a.received ? 'yes' : 'no'}>
                <span className="bdc-name">
                  <span className="bdc-wrap">{t(a.measure)}</span>
                  {a.form && <span className="bdc-sub">{t(a.form)}</span>}
                </span>
                <span className={`bdc-pill ${a.received ? 'bdc-pill-ok' : 'bdc-pill-wait'}`}>{a.received ? t('Received') : t('Not received')}</span>
              </li>
            ))}
          </ul>
          {aw.received < aw.items.length && (
            <p className="bdc-foot">{t('Margin, cash and profit per contract stay off this page until these arrive.')}</p>
          )}
        </>);

  return (
    <>
      {chart7}
      {chart8}
      {chart9}
      {chart10}
      {chart11}
      {chart12}
    </>
  );
}
