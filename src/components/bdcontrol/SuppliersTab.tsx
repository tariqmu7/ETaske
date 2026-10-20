import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AGIBA_CLIENT, SUPPLIER_FILTERS, supplierCounts, supplierLines,
  type BdData, type SupplierFilter,
} from '../../lib/bdControl';
import { BROWSE_FIRST, Chips, Fields, MoreButton, SearchBox, useBdWords } from './shared';
import { AddButton, EditButton, EditedBadge } from './EditRecord';

export interface SuppliersState { filter: SupplierFilter; q: string }

interface Props {
  data: BdData;
  today: string;
  state: SuppliersState;
  onState: (s: SuppliersState) => void;
  onClient: (code: string) => void;
}

const FILTER_LABEL: Record<SupplierFilter, string> = {
  live: 'Running', soon: 'Ends within 90 days', past: 'Running past their date', ended: 'Completed, cancelled or on hold', all: 'All',
};

/**
 * Suppliers tab (queue E6a): supplier contracts with their amendments. Each row
 * opens to everything on file. A search typed here (or handed over from a data
 * issue / client page) filters the list on contract number, contractor, client
 * and subject. Managers can edit a supplier contract from its open row (E6b).
 * AGIBA site contracts and service orders moved to the AGIBA client page in
 * queue A5; a link here leads there.
 */
export default function SuppliersTab({ data, today, state, onState, onClient }: Props) {
  const w = useBdWords(data);
  const { t } = useTranslation();
  const { F } = w;
  const [all, setAll] = useState(false);
  const set = (p: Partial<SuppliersState>) => { setAll(false); onState({ ...state, ...p }); };
  const counts = useMemo(() => supplierCounts(data, today), [data, today]);
  const sup = useMemo(() => supplierLines(data, today, state.filter, state.q), [data, today, state.filter, state.q]);
  const agiba = data.agibaSiteContracts.length + data.agibaSOs.length;

  const val = (v: unknown) => (v == null || String(v).trim() === '' ? null : w.bidi(w.word(v)));
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? F.number(v, { maximumFractionDigits: 2 }) : null);
  const list = sup;
  const cut = <T,>(xs: T[]) => (all ? xs : xs.slice(0, BROWSE_FIRST));

  return (
    <section className="card bdc-card" data-bdc-tab="suppliers">
      <h2 className="bdc-h">{t('Supplier contracts')}</h2>
      {agiba > 0 && (
        <p className="bdc-cap">
          <button type="button" className="bdc-link" onClick={() => onClient(AGIBA_CLIENT)} data-bdc="to-agiba">
            {t('AGIBA site contracts and service orders are on the AGIBA page')}
          </button>
        </p>
      )}
      <div className="bdc-tools">
        <SearchBox value={state.q} onChange={q => set({ q })} attr="suppliers" placeholder={t('Search a contract number, contractor, client or subject')} />
        <AddButton table="supplierContracts" label={t('Add a supplier contract')} title={t('Add a supplier contract')} />
      </div>
      <Chips attr="supfilter" label={t('Status')} value={state.filter} onChange={filter => set({ filter })}
        options={SUPPLIER_FILTERS.map(k => ({ key: k, label: t(FILTER_LABEL[k]), count: counts[k] }))} />
      <p className="bdc-count" data-bdc-count="suppliers">{t('Showing {{n}}', { n: F.number(list.length) })}</p>

      {list.length === 0 && <p className="bdc-empty" data-bdc-empty="suppliers-list">{t('Nothing matches.')}</p>}

      {cut(sup).map(l => {
        const r = l.row;
        return (
          <details key={r.id} className="bdc-details bdc-item-d" data-bdc-row="supplier" data-bdc-key={r.contractNo} open={sup.length === 1}>
            <summary className="bdc-row bdc-row-line">
              <span className="bdc-name">
                <span><span dir="ltr">{r.contractNo}</span>{r.contractor && <> · {w.bidi(String(r.contractor))}</>}</span>
                <span className="bdc-sub">{[r.client ? w.nameOf(String(r.client)) : t('No client named'),
                  l.egp ? (typeof r.currentValueEgp === 'number' ? w.egpM(r.currentValueEgp) : null) : String(r.valueCurrencyNote),
                  r.status ? w.word(r.status) : t('Status blank')].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="bdc-line-when">
                <EditedBadge row={r} />
                {l.live && l.flag !== 'Ended' ? w.flag(l.flag) : w.flag('Ended')}
                <span className="bdc-sub">{w.ends(r.currentEnd, l.days)}</span>
              </span>
            </summary>
            <div className="bdc-item-body">
              <div className="bdc-item-actions"><EditButton table="supplierContracts" row={r} title={t('supplier contract {{no}}', { no: r.contractNo })} /></div>
              <Fields attr="supplier" items={[
                [t('Subject'), val(r.subject)],
                [t('Client'), r.client ? <button type="button" className="bdc-link" onClick={() => onClient(String(r.client))}>{w.bidi(w.nameOf(String(r.client)))}</button> : null],
                [t('Project'), val(r.project)],
                [t('Cost type'), val(r.costType)],
                [t('Requesting department'), val(r.requestingDept)],
                [t('Method'), val(r.method)],
                [t('Approved budget'), w.egp(r.approvedBudgetEgp)],
                [t('Original value'), w.egp(r.originalValueEgp)],
                [t('Current value'), l.egp ? w.egp(r.currentValueEgp) : val(r.valueCurrencyNote)],
                [t('Growth since signing'), l.growthPct != null ? w.pct(l.growthPct) : null],
                [t('Original dates'), [w.date(r.originalStart), w.date(r.originalEnd)].filter(Boolean).join(' → ') || null],
                [t('Latest amendment'), val(r.latestAmendment)],
                [t('Contract admin'), val(r.admin)],
                [t('Remarks'), val(r.remarks)],
              ]} />
              <h3 className="bdc-h3">{t('Amendments: {{n}}', { n: F.number(l.amendments.length) })}</h3>
              {l.amendments.length > 0 && (
                <div className="bdc-scroll">
                  <table className="bdc-table bdc-table-sm" data-bdc="amendments">
                    <thead><tr>
                      <th scope="col">#</th><th scope="col">{t('Type')}</th><th scope="col">{t('New end')}</th>
                      <th scope="col" className="bdc-numcol">{t('Change')}</th><th scope="col" className="bdc-numcol">{t('Value after')}</th><th scope="col">{t('Status')}</th>
                    </tr></thead>
                    <tbody>
                      {l.amendments.map(a => (
                        <tr key={a.id} data-bdc-row="amendment">
                          <td>{n(a.amendmentNo) ?? '—'}</td>
                          <td>{w.word(a.type) || '—'}</td>
                          <td>{w.date(a.newEnd) || '—'}</td>
                          <td className="bdc-numcol">{typeof a.variationValueEgp === 'number' ? F.number(a.variationValueEgp, { maximumFractionDigits: 0 })
                            : typeof a.variationPct === 'number' ? `${F.number(a.variationPct, { maximumFractionDigits: 1 })}%` : '—'}</td>
                          <td className="bdc-numcol">{typeof a.valueAfterEgp === 'number' ? F.number(a.valueAfterEgp, { maximumFractionDigits: 0 }) : '—'}</td>
                          <td>{w.word(a.status) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </details>
        );
      })}

      {!all && <MoreButton shown={Math.min(list.length, BROWSE_FIRST)} total={list.length} onMore={() => setAll(true)} attr="suppliers" />}
    </section>
  );
}
