/**
 * The "Group by (X)" segmented control.
 *
 * Shared across the dashboards (tasks first, then correspondences / projects /
 * opportunities) so the interaction and the look stay identical. It is a pure
 * presentation component — it owns no state and knows nothing about the records:
 * the caller keeps the `groupBy` state and does the bucketing with
 * `lib/grouping.ts`.
 *
 * Option labels arrive ALREADY TRANSLATED. The keys stay English identifiers the
 * caller switches on, so a translated UI never changes what the code branches
 * on — the same split `lib/displayLabel.ts` draws between stored and shown.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface GroupByOption<K extends string> {
  key: K;
  /** Already translated by the caller. */
  label: string;
  icon?: LucideIcon;
}

interface Props<K extends string> {
  value: K;
  onChange: (next: K) => void;
  options: readonly GroupByOption<K>[];
  /**
   * One small dropdown instead of the button strip, on every screen size — for
   * a board whose toolbar must stay on ONE row (Tasks, queue T3). The strip
   * alone is ~450 px and pushed Filters onto a second line.
   */
  compact?: boolean;
}

export default function GroupByBar<K extends string>({ value, onChange, options, compact }: Props<K>) {
  const { t } = useTranslation();

  if (compact) {
    // A <label>, not a <div>: the phone rule `.board-toolbar > div:has(> .input)`
    // stretches the search box to a full row and must not catch this one.
    return (
      <label className="groupby-compact" title={t('Group by')}>
        <span className="groupby-compact-caption">{t('Group by')}</span>
        <span className="groupby-compact-field">
          <Layers className="groupby-compact-icon" aria-hidden />
          <select
            className="input"
            aria-label={t('Group by')}
            value={value}
            onChange={e => onChange(e.target.value as K)}
          >
            {options.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
          </select>
        </span>
      </label>
    );
  }

  return (
    // `flexWrap` + the scrollable strip below are what keep a 390px phone from
    // scrolling the whole document sideways: the caption drops to its own line
    // first, and only then does the strip scroll inside itself.
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', maxWidth: '100%', minWidth: 0 }}>
      <span
        style={{
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700,
          color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
        }}
      >
        <Layers style={{ width: 13, height: 13 }} /> {t('Group by')}
      </span>
      <div
        className="groupby-strip"
        role="group"
        aria-label={t('Group by')}
        // `minWidth: 0` is load-bearing — without it a flex item refuses to
        // shrink below its content width and `overflowX` never engages.
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0,
          padding: 4, display: 'flex', gap: 4,
          maxWidth: '100%', minWidth: 0, overflowX: 'auto',
        }}
      >
        {options.map(opt => {
          const Icon = opt.icon;
          const active = opt.key === value;
          return (
            <button
              key={opt.key}
              onClick={() => onChange(opt.key)}
              aria-pressed={active}
              title={opt.label}
              style={{
                padding: '6px 12px', borderRadius: 0, fontSize: 13, fontWeight: 600,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 6,
                flexShrink: 0, whiteSpace: 'nowrap',
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#fff' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {Icon && <Icon style={{ width: 13, height: 13 }} />}
              {opt.label}
            </button>
          );
        })}
      </div>
      {/* On a phone the strip above was cut mid-word with nothing to say it
          scrolls; the same choice as a native select shows the current value
          and every option (index.css swaps the two below 769 px). */}
      <select
        className="groupby-select input"
        aria-label={t('Group by')}
        value={value}
        onChange={e => onChange(e.target.value as K)}
      >
        {options.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
      </select>
    </div>
  );
}
