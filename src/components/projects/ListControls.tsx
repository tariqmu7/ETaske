import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ListFilter, X } from 'lucide-react';

export type SortDir = 'asc' | 'desc';

export interface FilterDef {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}

interface Props {
  filters?: FilterDef[];
  sortOptions: { value: string; label: string }[];
  sortValue: string;
  onSortChange: (v: string) => void;
  sortDir: SortDir;
  onSortDirToggle: () => void;
  /** Shown on the far right, e.g. a result count. */
  trailing?: React.ReactNode;
}

/** A filter is "active" when it's set to anything other than its first
 *  (all-pass) option, so we can highlight it and offer a one-tap reset. */
const isActive = (f: FilterDef) => f.options.length > 0 && f.value !== f.options[0].value;

/**
 * Compact filter + sort toolbar shared across the project detail tabs.
 * Flat / CSS-variable idiom: contained bar, custom-chevron selects, active
 * highlighting and a clear-all shortcut.
 */
export default function ListControls({
  filters = [], sortOptions, sortValue, onSortChange, sortDir, onSortDirToggle, trailing,
}: Props) {
  const { t } = useTranslation();
  const activeCount = filters.filter(isActive).length;
  const clearAll = () => filters.forEach(f => { if (isActive(f)) f.onChange(f.options[0].value); });

  // Filter labels and option labels arrive already translated from the tab that
  // owns them — they name that tab's data ("Validity", "All types"), not this
  // toolbar. Only the toolbar's own chrome is translated here.
  return (
    <div className="list-controls">
      <div
        className="lc-rail"
        title={activeCount
          ? (activeCount === 1
              ? t('{{count}} filter active', { count: 1 })
              : t('{{count}} filters active', { count: activeCount }))
          : t('Filter & sort')}
      >
        <ListFilter className="w-4 h-4" />
      </div>

      {filters.map(f => (
        <label key={f.key} className="lc-field">
          <span className="lc-label">{f.label}</span>
          <select
            value={f.value}
            onChange={e => f.onChange(e.target.value)}
            className={`lc-select${isActive(f) ? ' is-active' : ''}`}
          >
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}

      <label className="lc-field">
        <span className="lc-label">{t('Sort by')}</span>
        <div className="lc-sortgroup">
          <select value={sortValue} onChange={e => onSortChange(e.target.value)} className="lc-select">
            {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            type="button"
            className="lc-sortdir"
            onClick={onSortDirToggle}
            aria-label={sortDir === 'asc'
              ? t('Sorted ascending — switch to descending')
              : t('Sorted descending — switch to ascending')}
            title={sortDir === 'asc' ? t('Ascending') : t('Descending')}
          >
            {sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
          </button>
        </div>
      </label>

      {activeCount > 0 && (
        <button type="button" className="lc-clear" onClick={clearAll} title={t('Reset filters')}>
          <X className="w-3.5 h-3.5" /> {t('Clear')}
        </button>
      )}

      {trailing != null && <div className="lc-count">{trailing}</div>}
    </div>
  );
}
