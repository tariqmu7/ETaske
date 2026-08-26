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
    // `.card-grid-sm` (index.css) keeps the old 240px floor but caps the row at
    // 3 cards, so a bucket card always has room to show its stats strip.
    <div className="card-grid-sm">
      {cards.map(card => {
        const accent = card.accent || 'var(--accent)';
        const Icon = card.icon;
        return (
          <button
            key={card.key}
            onClick={() => onSelect(card.key)}
            className="card"
            // A board's KPI strip is made of `button.card`s too, so the class
            // alone cannot identify a group card. This attribute is how the
            // harnesses tell the two apart (and it carries the bucket key).
            data-group-card={card.key}
            style={{
              textAlign: 'start', cursor: 'pointer', padding: 20, borderInlineStart: `4px solid ${accent}`,
              display: 'flex', flexDirection: 'column', gap: 16, fontFamily: 'inherit',
              background: 'var(--surface)', transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(15,23,42,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {card.photoURL ? (
                <img src={card.photoURL} className="avatar" style={{ width: 44, height: 44, objectFit: 'cover', flexShrink: 0 }} alt="" />
              ) : card.initial ? (
                <span style={{ width: 44, height: 44, flexShrink: 0, background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800 }}>
                  {card.initial}
                </span>
              ) : Icon ? (
                <span style={{ width: 44, height: 44, flexShrink: 0, background: 'var(--surface-2)', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon style={{ width: 20, height: 20 }} />
                </span>
              ) : null}
              {/* `minWidth: 0` lets the ellipsis actually engage inside the flex row. */}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {card.title}
                </div>
                {card.subtitle && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {card.subtitle}
                  </div>
                )}
              </div>
              <ChevronRight style={{ width: 18, height: 18, color: 'var(--text-muted)', flexShrink: 0 }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{card.count}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{card.countLabel}</span>
              {card.badge && (
                <span className={`badge ${card.badgeClass || 'badge-urgent'}`} style={{ marginInlineStart: 'auto' }}>{card.badge}</span>
              )}
            </div>

            {card.stats && card.stats.length > 0 && (
              <div style={{ display: 'flex', gap: 6, fontSize: 11, fontWeight: 700 }}>
                {card.stats.map(s => (
                  <span
                    key={s.label}
                    style={{ flex: 1, textAlign: 'center', padding: '6px 4px', ...TONE[s.tone || 'neutral'] }}
                  >
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
