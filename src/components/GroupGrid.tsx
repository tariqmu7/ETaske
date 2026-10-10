/**
 * The grid a board paints when "Group by (X)" is active.
 *
 * ── Why a grid and not stacked sections ──────────────────────────────────────
 * The first cut of "Group by" rendered every bucket as a section on one long
 * page. Tariq's follow-up ask (2026-08-26) is the opposite shape: **the group
 * IS the card**. Picking a dimension shows one card per bucket — its name plus
 * a small summary of what is inside — and the records only appear after the
 * user clicks a card. So the grid is not a display option, it is *the* group
 * view; the list is what a bucket drills into.
 *
 * ── What this component is not ───────────────────────────────────────────────
 * It is pure presentation, exactly like `GroupByBar`. It does not bucket
 * anything (that stays `lib/grouping.ts`), owns no state, and knows nothing
 * about tasks / correspondences / projects / opportunities. The caller turns
 * its `RecordGroup[]` into `GroupCard[]` — which is also where it decides what
 * "small info" means for its own records — and keeps the "which group is open"
 * state itself.
 *
 * ── Labels ───────────────────────────────────────────────────────────────────
 * Every string on a card arrives ALREADY TRANSLATED, same contract as
 * `GroupByBar`: grouping keys are the stored value, translation is a projection
 * the caller applies at render time (`lib/displayLabel.ts`).
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Colour role for one chip in a card's footer strip. */
export type StatTone = 'neutral' | 'info' | 'success' | 'warn';

const TONE: Record<StatTone, { background: string; color: string }> = {
  neutral: { background: 'var(--surface-2)', color: 'var(--text-muted)' },
  info: { background: 'var(--blue-50)', color: 'var(--blue-400)' },
  success: { background: 'var(--green-100)', color: 'var(--green-400)' },
  warn: { background: 'var(--surface-warn-strong)', color: 'var(--surface-warn-text)' },
};

export interface GroupCardStat {
  /** Already translated. */
  label: string;
  value: number | string;
  tone?: StatTone;
}

export interface GroupCard {
  /** The bucket key from `buildGroups` — also the React key and what `onSelect` returns. */
  key: string;
  /** Already translated. The group's name, on its own — no "Assigned to …" framing. */
  title: string;
  /** Already translated. One line of context under the title (a role, a client, a stage). */
  subtitle?: string;
  /** Left border colour. Callers pass `getUserColor(key)` when nothing better exists. */
  accent?: string;
  /** Avatar image; falls back to `initial`, then to `icon`. */
  photoURL?: string;
  /** Single letter drawn in an `accent`-filled square when there is no photo. */
  initial?: string;
  /** Used when neither `photoURL` nor `initial` is given (dimensions with no person). */
  icon?: LucideIcon;
  /** The headline number — how many records are in the bucket. */
  count: number;
  /** Already translated, and already singular/plural-correct for `count`. */
  countLabel: string;
  /** Already translated. An attention badge (overdue, at-risk) shown beside the count. */
  badge?: string;
  /** Badge class from index.css, e.g. `badge-urgent`. Defaults to `badge-urgent`. */
  badgeClass?: string;
  /** The footer strip — the "small info about the info inside". Keep it to 2–4. */
  stats?: GroupCardStat[];
}

interface Props {
  cards: readonly GroupCard[];
  onSelect: (key: string) => void;
  /** Rendered instead of the grid when there are no cards. */
  empty?: React.ReactNode;
}

export default function GroupGrid({ cards, onSelect, empty }: Props) {
  if (cards.length === 0) return <>{empty ?? null}</>;

  return (
    // `.group-grid` (index.css) overrides `.card-grid-sm`: up to 4 compact cards a
    // row, 1 on a phone. The old class stays because the harnesses look for it.
    <div className="card-grid-sm group-grid">
      {cards.map(card => {
        const accent = card.accent || 'var(--accent)';
        const Icon = card.icon;
        const shown = (card.stats || []).filter(st => st.value !== 0 && st.value !== '0');
        return (
          <button
            key={card.key}
            onClick={() => onSelect(card.key)}
            className="card group-card"
            // A board's KPI strip is made of `button.card`s too, so the class
            // alone cannot identify a group card. This attribute is how the
            // harnesses tell the two apart (and it carries the bucket key).
            data-group-card={card.key}
            style={{ borderInlineStart: `4px solid ${accent}` }}
          >
            {/* One header row: face/icon · name + context · the count · chevron.
                The count used to sit on its own 30px line, which made every card
                ~180px tall and mostly empty (Tariq 2026-10-10: "too much white"). */}
            <div className="group-card-head">
              {card.photoURL ? (
                <img src={card.photoURL} className="avatar group-card-face" style={{ objectFit: 'cover' }} alt="" />
              ) : card.initial ? (
                <span className="group-card-face" style={{ background: accent, color: '#fff', fontSize: 15, fontWeight: 800 }}>
                  {card.initial}
                </span>
              ) : Icon ? (
                <span className="group-card-face" style={{ background: 'var(--surface-2)', color: accent }}>
                  <Icon style={{ width: 18, height: 18 }} />
                </span>
              ) : null}
              {/* `minWidth: 0` lets the ellipsis actually engage inside the flex row. */}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="group-card-title">{card.title}</div>
                {card.subtitle && <div className="group-card-sub">{card.subtitle}</div>}
              </div>
              <div className="group-card-count">
                <span className="group-card-num">{card.count}</span>
                <span className="group-card-unit">{card.countLabel}</span>
              </div>
              <ChevronRight className="group-card-chevron" />
            </div>

            {/* Only the chips that say something: "0 Won · 0 Lost" on every card
                was most of the noise. A card with nothing to report shows none. */}
            {(card.badge || shown.length > 0) && (
              <div className="group-card-stats">
                {card.badge && <span className={`badge ${card.badgeClass || 'badge-urgent'}`}>{card.badge}</span>}
                {shown.map(s => (
                  <span key={s.label} className="group-card-chip" style={TONE[s.tone || 'neutral']}>
                    {s.value} {s.label}
                  </span>
                ))}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
