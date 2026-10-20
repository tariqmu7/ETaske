import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { siteLines, soLines, type BdData } from '../../lib/bdControl';
import { Chips, Fields, MoreButton, SearchBox, useBdWords } from './shared';
import { AddButton, EditButton, EditedBadge } from './EditRecord';

/** A data issue on an AGIBA SO or site contract: the section to open and what to search. */
export interface AgibaFocus { kind: 'agibaSO' | 'agibaSite'; query: string }

/** Service orders listed before "Show all" (the AGIBA page holds ~56). */
const SO_FIRST = 10;

interface Props {
  data: BdData;
  today: string;
  focus?: AgibaFocus | null;
}

/**
 * AGIBA's site contracts and service orders, as two cards on the AGIBA client
 * page (queue A5 — they were two extra views of the Suppliers tab). Each card
 * has its own search and Add button; each row opens to everything on file with
 * an Edit button for managers. A data issue on one of them opens this page with
 * that card searched for the record and scrolled into view.
 */
export default function AgibaSections({ data, today, focus }: Props) {
  const w = useBdWords(data);
  const { t } = useTranslation();
  const { F } = w;
  const [siteQ, setSiteQ] = useState(focus?.kind === 'agibaSite' ? focus.query : '');
  const [soQ, setSoQ] = useState(focus?.kind === 'agibaSO' ? focus.query : '');
  const [soOpen, setSoOpen] = useState(focus?.kind !== 'agibaSO');
  const [soAll, setSoAll] = useState(false);
  const sites = useMemo(() => siteLines(data, today, siteQ), [data, today, siteQ]);
  const sos = useMemo(() => soLines(data, today, soOpen, soQ), [data, today, soOpen, soQ]);
  const openSOs = useMemo(() => soLines(data, today, true).length, [data, today]);
  const siteRef = useRef<HTMLElement>(null);
  const soRef = useRef<HTMLElement>(null);

  // After the page's own scroll-to-top, bring the card the data issue points at into view.
  useEffect(() => {
    const el = focus?.kind === 'agibaSO' ? soRef.current : focus?.kind === 'agibaSite' ? siteRef.current : null;
    if (!el) return;
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => el.scrollIntoView?.({ block: 'start' })); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [focus]);

  const val = (v: unknown) => (v == null || String(v).trim() === '' ? null : w.bidi(w.word(v)));
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? F.number(v, { maximumFractionDigits: 2 }) : null);
  const shownSOs = soAll ? sos : sos.slice(0, SO_FIRST);

  return (
    <>
      <section ref={siteRef} className="card bdc-card" data-bdc-client="sites" style={{ scrollMarginTop: 72 }}>
        <div className="bdc-head-row">
          <h2 className="bdc-h">{t('AGIBA site contracts')}</h2>
          <AddButton table="agibaSiteContracts" label={t('Add a site contract')} title={t('Add an AGIBA site contract')} />
        </div>
        <p className="bdc-cap">{t('Contracts signed for the AGIBA site, soonest end first')}</p>
        {(data.agibaSiteContracts.length > 3 || siteQ) && (
          <div className="bdc-tools">
            <SearchBox value={siteQ} onChange={setSiteQ} attr="sites" placeholder={t('Search a contract number, company or subject')} />
          </div>
        )}
        {data.agibaSiteContracts.length === 0
          ? <p className="bdc-empty" data-bdc-empty="sites">{t('No AGIBA site contract on file.')}</p>
          : sites.length === 0
            ? <p className="bdc-empty" data-bdc-empty="sites-list">{t('Nothing matches.')}</p>
            : sites.map(l => {
                const r = l.row;
                return (
                  <details key={r.id} className="bdc-details bdc-item-d" data-bdc-row="site" data-bdc-key={r.contractNo} open={sites.length === 1}>
                    <summary className="bdc-row bdc-row-line">
                      <span className="bdc-name">
                        <span><span dir="ltr">{r.contractNo}</span></span>
                        <span className="bdc-sub">{[r.company, r.status].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="bdc-line-when">
                        <EditedBadge row={r} />
                        {w.flag(l.flag)}
                        <span className="bdc-sub">{w.ends(r.currentEnd, l.days)}</span>
                      </span>
                    </summary>
                    <div className="bdc-item-body">
                      <div className="bdc-item-actions"><EditButton table="agibaSiteContracts" row={r} title={t('AGIBA site contract {{no}}', { no: r.contractNo })} /></div>
                      <Fields attr="site" items={[
                        [t('Subject'), val(r.subject)],
                        [t('Company'), val(r.company)],
                        [t('Requesting department'), val(r.requestingDept)],
                        [t('SR value'), n(r.srValue)],
                        [t('Contract value'), val(r.contractValueAsWritten)],
                        [t('Value note'), val(r.valueNote)],
                        [t('Original dates'), [w.date(r.start), w.date(r.originalEnd)].filter(Boolean).join(' → ') || null],
                        [t('Dates note'), val(r.startEndNote)],
                        [t('Method'), val(r.method)],
                        [t('Amendments'), val(r.amendments)],
                        [t('Latest amendment'), val(r.latestAmendment)],
                        [t('In charge'), val(r.inCharge)],
                        [t('Remarks'), val(r.remarks)],
                      ]} />
                    </div>
                  </details>
                );
              })}
      </section>

      <section ref={soRef} className="card bdc-card" data-bdc-client="sos" style={{ scrollMarginTop: 72 }}>
        <div className="bdc-head-row">
          <h2 className="bdc-h">{t('AGIBA service orders')}</h2>
          <AddButton table="agibaSOs" label={t('Add a service order')} title={t('Add an AGIBA service order')} />
        </div>
        {data.agibaSOs.length === 0
          ? <p className="bdc-empty" data-bdc-empty="sos">{t('No AGIBA service order on file.')}</p>
          : <>
              <div className="bdc-tools">
                <SearchBox value={soQ} onChange={q => { setSoAll(false); setSoQ(q); }} attr="sos" placeholder={t('Search an SO number, item, contractor or status')} />
              </div>
              <Chips attr="soopen" label={t('Status')} value={soOpen ? 'open' : 'all'} onChange={k => { setSoAll(false); setSoOpen(k === 'open'); }} options={[
                { key: 'open', label: t('Still open'), count: openSOs },
                { key: 'all', label: t('All'), count: data.agibaSOs.length },
              ]} />
              {sos.length === 0 && <p className="bdc-empty" data-bdc-empty="sos-list">{t('Nothing matches.')}</p>}
              {shownSOs.map(l => {
                const r = l.row;
                const so = String(r.so || r.id);
                return (
                  <details key={r.id} className="bdc-details bdc-item-d" data-bdc-row="so" data-bdc-key={so} open={sos.length === 1}>
                    <summary className="bdc-row bdc-row-line">
                      <span className="bdc-name">
                        <span><span dir="ltr">{so}</span>{r.item ? <> · {w.bidi(String(r.item))}</> : null}</span>
                        <span className="bdc-sub">{[r.contractor ? String(r.contractor) : t('No contractor named'), r.status ? w.word(r.status) : t('Status blank')].join(' · ')}</span>
                      </span>
                      <span className="bdc-line-when">
                        <EditedBadge row={r} />
                        {l.open
                          ? <span className={`bdc-pill bdc-pill-${l.days != null && l.days < 0 ? 'lo' : 'wait'}`} data-bdc-so="open">{t('Still open')}</span>
                          : <span className="bdc-pill bdc-pill-flat" data-bdc-so="closed">{t('Closed')}</span>}
                        <span className="bdc-sub">{w.ends(r.expiry, l.days)}</span>
                      </span>
                    </summary>
                    <div className="bdc-item-body">
                      <div className="bdc-item-actions"><EditButton table="agibaSOs" row={r} title={t('service order {{no}}', { no: so })} /></div>
                      <Fields attr="so" items={[
                        [t('Amount'), typeof r.amount === 'number' ? `${F.number(r.amount, { maximumFractionDigits: 0 })} ${String(r.currency || '')}`.trim() : null],
                        [t('Budget as written'), val(r.budgetAsWritten)],
                        [t('Budget note'), val(r.budgetNote)],
                        [t('Duration'), val(r.duration)],
                        [t('Start'), w.date(r.start)],
                        [t('SO / SR'), val(r.soSr)],
                        [t('Completion certificate'), val(r.completionCertificate)],
                        [t('In charge'), val(r.inCharge)],
                        [t('Remarks'), val(r.remarks)],
                      ]} />
                    </div>
                  </details>
                );
              })}
              {!soAll && <MoreButton shown={shownSOs.length} total={sos.length} onMore={() => setSoAll(true)} attr="sos" />}
            </>}
      </section>
    </>
  );
}
