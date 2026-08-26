/**
 * The shared board toolbar — one row per board, under a header that carries a
 * single primary action.
 *
 * Every board used to spray its controls across the header and a wrapping
 * filter bar: create + export + analytics next to the title, then search, two
 * segmented strips, a date picker and up to four selects all competing on one
 * line. This collapses that into: scope (if the board has one) · search ·
 * Group by · a `Filters` disclosure · secondary actions. The rarely-touched
 * selects live inside the disclosure, so the default view of a board is one
 * calm row.
 *
 * It is a pure presentation component — every control it renders is passed in
 * by the caller, which keeps owning the filter state. `activeFilterCount` is
 * the caller's own count of non-default filters: it is the only thing that
 * makes a *collapsed* panel honest, because a filter you cannot see is
 * otherwise indistinguishable from no filter at all.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  search: string;
  onSearch: (next: string) => void;
  searchPlaceholder: string;
  /** Always-visible scope switch (e.g. My Tasks / All Tasks). */
  scope?: React.ReactNode;
  /** The `GroupByBar` element. */
  groupBy?: React.ReactNode;
  /** Controls that live inside the collapsible panel. */
  filters?: React.ReactNode;
  /** How many of those filters are away from their default. */
  activeFilterCount?: number;
  onClearFilters?: () => void;
  /** Ghost actions that are not the board's primary action (Export, Analytics…). */
  secondary?: React.ReactNode;
}

export default function BoardToolbar({
  search, onSearch, searchPlaceholder,
  scope, groupBy, filters, activeFilterCount = 0, onClearFilters, secondary,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        className="board-toolbar"
        style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', maxWidth: '100%', minWidth: 0 }}
      >
        {scope}

        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          {/* The icon sits at `insetInlineStart`, so the room made for it must be
              logical too — a physical padding-left leaves the text under the
              icon in RTL. */}
          <Search
            className="w-4 h-4"
            style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
          />
          <input
            className="input"
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={e => onSearch(e.target.value)}
            style={{ width: '100%', paddingInlineStart: 36 }}
          />
        </div>

        {groupBy}

        {filters && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            title={t('Filters')}
            style={{ flexShrink: 0 }}
          >
            <SlidersHorizontal className="w-4 h-4" />
            {t('Filters')}
            {activeFilterCount > 0 && (
              <span
                style={{
                  minWidth: 18, padding: '0 5px', background: 'var(--accent)', color: '#fff',
                  fontSize: 11, fontWeight: 800, lineHeight: '18px', textAlign: 'center',
                }}
              >
                {activeFilterCount}
              </span>
            )}
            <Chevron className="w-3.5 h-3.5" />
          </button>
        )}

        {secondary}
      </div>

      {filters && open && (
        <div
          style={{
            marginTop: 12, padding: '12px 14px', background: 'var(--surface-2)',
            border: '1px solid var(--border)', display: 'flex', gap: 12,
            flexWrap: 'wrap', alignItems: 'center',
          }}
        >
          {filters}
          {activeFilterCount > 0 && onClearFilters && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClearFilters} style={{ marginInlineStart: 'auto' }}>
              {t('Clear all')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
