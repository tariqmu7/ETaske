import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { contractCounts, contractLines, type BdData, type ContractFilter } from '../../lib/bdControl';
import { BROWSE_FIRST, Chips, MoreButton, SearchBox, useBdWords } from './shared';
import { AddButton, EditedBadge } from './EditRecord';

export interface ContractsState { filter: ContractFilter; q: string }

interface Props {
  data: BdData;
  today: string;
  state: ContractsState;
  onState: (s: ContractsState) => void;
  onClient: (code: string) => void;
}

const FILTER_LABEL: Record<ContractFilter, string> = {
  all: 'All lines', expired: 'Expired on paper', d90: 'Ends within 90 days', d180: 'Ends within 6 months', noDate: 'No end date',
};

/**
 * Contracts tab (queue E6a): every client contract line, the soonest expiry
 * first, with a search and expiry chips. A line opens its client's page.
 */
export default function ContractsTab({ data, today, state, onState, onClient }: Props) {
  const w = useBdWords(data);
  const { t } = useTranslation();
  const { F } = w;
  const [all, setAll] = useState(false);
  const counts = useMemo(() => contractCounts(data, today), [data, today]);
  const lines = useMemo(() => contractLines(data, today, state.filter, state.q), [data, today, state.filter, state.q]);
  const shown = all ? lines : lines.slice(0, BROWSE_FIRST);

  return (
    <section className="card bdc-card" data-bdc-tab="contracts">
      <h2 className="bdc-h">{t('Client contract lines')}</h2>
      <p className="bdc-cap">{t('From the CSA & O&M report · the soonest expiry first · open a line for everything on file for that client')}</p>
      <div className="bdc-tools">
        <SearchBox value={state.q} onChange={q => onState({ ...state, q })} placeholder={t('Search a client, contract type, status or comment')} attr="contracts" />
        <AddButton table="clientContracts" label={t('Add a contract line')} title={t('Add a client contract line')} />
      </div>
      <Chips attr="contracts" label={t('Show')} value={state.filter} onChange={filter => onState({ ...state, filter })}
        options={(Object.keys(FILTER_LABEL) as ContractFilter[]).map(k => ({ key: k, label: t(FILTER_LABEL[k]), count: counts[k] }))} />
      <p className="bdc-count" data-bdc-count="contracts">{t('Showing {{n}} of {{total}}', { n: F.number(lines.length), total: F.number(counts.all) })}</p>
      {lines.length === 0
        ? <p className="bdc-empty" data-bdc-empty="contracts">{t('No contract line matches.')}</p>
        : <div className="bdc-list">
            {shown.map(l => {
              const r = l.row;
              const c = w.clients.get(r.client);
              const value = typeof r.ceilingEgp === 'number' ? t('Ceiling {{v}}', { v: w.egpM(r.ceilingEgp) })
                : typeof r.monthlyValueEgp === 'number' ? t('{{v}} a month', { v: w.egp(r.monthlyValueEgp) })
                  : t('No ceiling or value on file');
              return (
                <button key={r.id} type="button" className="bdc-row bdc-row-line bdc-click" onClick={() => onClient(r.client)}
                  data-bdc-row="contract" data-bdc-key={r.id}>
                  <span className="bdc-name">
                    <span>{w.bidi(w.nameOf(r.client))}{r.contractType && <> · {w.bidi(String(r.contractType))}</>}</span>
                    <span className="bdc-sub">{[w.ar ? c?.name : c?.arabicName, r.status ? w.word(r.status) : t('Status blank'), value].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="bdc-line-when">
                    <EditedBadge row={r} />
                    {w.flag(l.flag)}
                    <span className="bdc-sub">{w.ends(r.expiryDate, l.days)}</span>
                  </span>
                  <ChevronRight size={16} className="bdc-chev" aria-hidden />
                </button>
              );
            })}
          </div>}
      {!all && <MoreButton shown={shown.length} total={lines.length} onMore={() => setAll(true)} attr="contracts" />}
    </section>
  );
}
