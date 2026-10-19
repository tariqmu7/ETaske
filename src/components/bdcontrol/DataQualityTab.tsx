import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { issueRows, issueTarget, issuesByTable, type BdData, type IssueTarget } from '../../lib/bdControl';
import { BROWSE_FIRST, Chips, MoreButton, SearchBox, useBdWords } from './shared';

export interface QualityState { sheet: string; q: string }

interface Props {
  data: BdData;
  state: QualityState;
  onState: (s: QualityState) => void;
  /** Opens the record an issue points at (client page, supplier contract, AGIBA SO / site contract). */
  onTarget: (tg: Exclude<IssueTarget, null>) => void;
}

/**
 * Data quality tab (queue E6a): every gap and clash the loader found in the
 * Excel files, by sheet, with what to do. A row whose record the app can find
 * opens it.
 */
export default function DataQualityTab({ data, state, onState, onTarget }: Props) {
  const w = useBdWords(data);
  const { t } = useTranslation();
  const { F } = w;
  const [all, setAll] = useState(false);
  const set = (p: Partial<QualityState>) => { setAll(false); onState({ ...state, ...p }); };
  const sheets = useMemo(() => issuesByTable(data.dataIssues), [data.dataIssues]);
  const rows = useMemo(() => issueRows(data.dataIssues, state.sheet, state.q), [data.dataIssues, state.sheet, state.q]);
  const codes = useMemo(() => new Set(data.clients.map(c => c.code)), [data.clients]);
  const shown = all ? rows : rows.slice(0, BROWSE_FIRST);

  return (
    <section className="card bdc-card" data-bdc-tab="quality">
      <h2 className="bdc-h">{t('Data issues to fix')}</h2>
      <p className="bdc-cap">{t('Gaps and clashes the loader found in the Excel files · fix them in the Excel file, then reload')}</p>
      {data.dataIssues.length === 0
        ? <p className="bdc-empty" data-bdc-empty="quality">{t('No data issues — the files are clean.')}</p>
        : <>
            <div className="bdc-tools">
              <SearchBox value={state.q} onChange={q => set({ q })} placeholder={t('Search a record, issue or action')} attr="quality" />
            </div>
            <Chips attr="sheet" label={t('Sheet')} value={state.sheet} onChange={sheet => set({ sheet })} options={[
              { key: '', label: t('All sheets'), count: data.dataIssues.length },
              ...sheets.map(s => ({ key: s.table, label: s.table ? t(s.table) : t('Sheet not named'), count: s.count })),
            ]} />
            <p className="bdc-count" data-bdc-count="quality">{t('Showing {{n}} of {{total}}', { n: F.number(rows.length), total: F.number(data.dataIssues.length) })}</p>
            {rows.length === 0
              ? <p className="bdc-empty" data-bdc-empty="quality-list">{t('Nothing matches.')}</p>
              : <div className="bdc-list">
                  {shown.map(i => {
                    const tg = issueTarget(i, codes);
                    const body = (
                      <>
                        <span className="bdc-name bdc-name-wrap">
                          <span>{i.record ? w.bidi(String(i.record)) : t('Record not named')}<span className="bdc-sub-inline"> · {i.table ? t(String(i.table)) : t('Sheet not named')}</span></span>
                          <span className="bdc-issue">{i.issue}</span>
                          {i.whatToDo && <span className="bdc-sub">{t('To do: {{x}}', { x: i.whatToDo })}</span>}
                        </span>
                        {tg && <ChevronRight size={16} className="bdc-chev" aria-hidden />}
                      </>
                    );
                    return tg
                      ? <button key={i.id} type="button" className="bdc-row bdc-row-issue bdc-click" onClick={() => onTarget(tg)} data-bdc-row="dq" data-bdc-key={i.id}>{body}</button>
                      : <div key={i.id} className="bdc-row bdc-row-issue" data-bdc-row="dq" data-bdc-key={i.id}>{body}</div>;
                  })}
                </div>}
            {!all && <MoreButton shown={shown.length} total={rows.length} onMore={() => setAll(true)} attr="quality" />}
          </>}
    </section>
  );
}
