/**
 * The row of group tabs a board shows once a group is open (Tidy Tasks T3).
 *
 * It replaces the lone "← All Groups" box, which only ever went back: the
 * first tab still returns to the grid, and every other group is one tap away
 * with its size — and how much of it is late — on the tab itself. On a phone
 * the row scrolls sideways inside itself; the page never does.
 *
 * Pure presentation, same contract as `GroupByBar` / `GroupGrid`: labels come
 * in already translated, the caller owns which group is open.
 */
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid } from 'lucide-react';

export interface GroupTab {
  key: string;
  /** Already translated. */
  label: string;
  count: number;
  /** Late items in the group; drawn in red when above zero. */
  late?: number;
}

interface Props {
  tabs: readonly GroupTab[];
  /** The open group's key; null = none (e.g. a deep link skipped the grid). */
  active: string | null;
  /** `null` = back to the grid of all groups. */
  onSelect: (key: string | null) => void;
}

export default function GroupTabs({ tabs, active, onSelect }: Props) {
  const { t } = useTranslation();
  const strip = useRef<HTMLDivElement>(null);

  // The open tab may sit past the edge on a phone — bring it into view.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (el && strip.current) {
      const s = strip.current.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.left < s.left || r.right > s.right) strip.current.scrollLeft += (r.left - s.left) - 12;
    }
  }, [active]);

  return (
    <nav className="group-tabs" data-group-tabs aria-label={t('Group by')}>
      <div ref={strip} className="group-tabs-strip">
        <button type="button" className="group-tab group-tab-all" data-group-tab="" onClick={() => onSelect(null)}>
          <LayoutGrid aria-hidden style={{ width: 14, height: 14 }} />
          {t('All Groups')}
        </button>
        {tabs.map(tab => {
          const on = tab.key === active;
          const late = tab.late || 0;
          return (
            <button
              key={tab.key}
              type="button"
              className="group-tab"
              data-group-tab={tab.key}
              aria-current={on ? 'true' : undefined}
              onClick={() => onSelect(tab.key)}
              title={late > 0 ? `${tab.label} · ${t('Late: {{count}}', { count: late })}` : tab.label}
            >
              <span className="group-tab-label" dir="auto">{tab.label}</span>
              <span className="group-tab-count">{tab.count}</span>
              {late > 0 && (
                <span className="group-tab-late" aria-label={t('Late: {{count}}', { count: late })}>{late}</span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
