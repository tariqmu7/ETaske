import React from 'react';
import { ArrowDown, ArrowUp, ListFilter } from 'lucide-react';

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

/**
 * Compact filter + sort toolbar shared across the project detail tabs.
 * Matches the inline-style / CSS-variable idiom used elsewhere in the app.
 */
export default function ListControls({
  filters = [], sortOptions, sortValue, onSortChange, sortDir, onSortDirToggle, trailing,
}: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <ListFilter className="w-4 h-4" style={{ color: 'var(--text-muted)', marginBottom: 8, flexShrink: 0 }} />

      {filters.map(f => (
        <label key={f.key} style={field}>
          <span style={fieldLabel}>{f.label}</span>
          <select value={f.value} onChange={e => f.onChange(e.target.value)} style={ctrl}>
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}

      <label style={field}>
        <span style={fieldLabel}>Sort by</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <select value={sortValue} onChange={e => onSortChange(e.target.value)} style={ctrl}>
            {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            onClick={onSortDirToggle}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            style={{ border: '1px solid var(--border)' }}
          >
            {sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
          </button>
        </div>
      </label>

      {trailing != null && <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, color: 'var(--text-muted)' }}>{trailing}</div>}
    </div>
  );
}

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const ctrl: React.CSSProperties = { padding: '7px 9px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit' };
