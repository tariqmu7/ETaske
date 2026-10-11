import React from 'react';
import { useTranslation } from 'react-i18next';
import { Opportunity, isOpportunityOpen } from '../../types';
import { useDisplayLabel } from '../../lib/displayLabel';
import { useFormat } from '../../lib/format';
import { Hourglass, ArrowRightCircle, MessageSquare, Plus, AlertTriangle } from 'lucide-react';
import { STAGE_COLORS, daysUntil } from './opportunityUi';

// Queue O2 — the bid page for the CEO: where it stands, what it is waiting for,
// the next step and the last word on it, in one card above the tabs. Every
// value is read from the opportunity itself (the mirror of the latest
// follow-up, convention 1), so this card never reads the child collection.

/** A last update older than this many days is flagged as stale (open bids only). */
export const STALE_UPDATE_DAYS = 30;

interface Props {
  opportunity: Opportunity;
  /** Opens the update form on the Follow-ups tab. */
  onAddUpdate: () => void;
}

export default function OpportunityGlance({ opportunity: o, onAddUpdate }: Props) {
  const { t } = useTranslation();
  const dl = useDisplayLabel();
  const fmt = useFormat();

  const open = isOpportunityOpen(o.stage);
  const stageColor = STAGE_COLORS[o.stage] || 'var(--border)';
  const lastAt = o.lastFollowUpAt?.seconds ? o.lastFollowUpAt.seconds * 1000 : null;
  const lastAge = lastAt === null ? null : Math.floor((Date.now() - lastAt) / 86_400_000);
  const stale = open && lastAge !== null && lastAge >= STALE_UPDATE_DAYS;

  const nextIn = daysUntil(o.nextActionDate);
  const nextLate = open && nextIn !== null && nextIn < 0;
  const nextSoon = open && nextIn !== null && nextIn >= 0 && nextIn <= 3;
  const nextColor = nextLate ? '#dc2626' : nextSoon ? '#f59e0b' : 'var(--text-secondary)';

  const dLeft = daysUntil(o.submissionDeadline);
  const deadlineNote = open && dLeft !== null
    ? (dLeft < 0 ? t('{{count}}d past deadline', { count: Math.abs(dLeft) })
      : dLeft === 0 ? t('Due today') : t('{{count}}d to deadline', { count: dLeft }))
    : null;

  return (
    <section className="card" data-glance style={{ padding: 20, marginBottom: 18 }}>
      {/* Status line */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--label)', margin: 0 }}>
            {t('At a glance')}
          </h2>
          <span data-glance-status style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: stageColor, flex: '0 0 auto' }} />
            {dl(o.stage)}
            {deadlineNote && <span style={{ fontWeight: 600, color: dLeft !== null && dLeft < 0 ? '#dc2626' : 'var(--text-secondary)' }}>· {deadlineNote}</span>}
          </span>
        </div>
        <button className="btn btn-ghost btn-sm" data-glance-add onClick={onAddUpdate}>
          <Plus className="w-3.5 h-3.5" /> {t('Add an update')}
        </button>
      </div>

      {/* Last update — the first thing read */}
      <div data-glance-last style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderInlineStart: `3px solid ${stale ? '#f59e0b' : 'var(--accent)'}`, padding: '12px 14px' }}>
        <TileLabel icon={<MessageSquare className="w-3.5 h-3.5" />}>{t('Last update')}</TileLabel>
        {o.lastFollowUpText ? (
          <p dir="auto" style={{ fontSize: 15, color: 'var(--text-primary)', margin: '4px 0 0', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{o.lastFollowUpText}</p>
        ) : (
          <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('No update yet.')}</p>
        )}
        {lastAt !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: stale ? '#b45309' : 'var(--text-muted)', fontWeight: stale ? 700 : 500 }}>
            {stale && <AlertTriangle className="w-3.5 h-3.5" />}
            <span>{fmt.date(lastAt)}</span>
            {stale && <span data-glance-stale>· {t('No update for {{count}} days', { count: lastAge as number })}</span>}
          </div>
        )}
      </div>

      {/* Waiting for · Next step */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 12 }}>
        <div data-glance-waiting style={tileStyle}>
          <TileLabel icon={<Hourglass className="w-3.5 h-3.5" />}>{t('Waiting for')}</TileLabel>
          <Value text={o.waitingFor} empty={t('Nothing recorded')} />
        </div>
        <div data-glance-next style={tileStyle}>
          <TileLabel icon={<ArrowRightCircle className="w-3.5 h-3.5" />}>{t('Next step')}</TileLabel>
          <Value text={o.nextStep} empty={o.nextActionDate ? '' : t('Nothing recorded')} />
          {o.nextActionDate && (
            <div data-glance-next-date data-late={nextLate ? '1' : undefined} style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: nextColor }}>
              {fmt.date(o.nextActionDate)}
              {open && nextIn !== null && ` · ${nextIn < 0 ? t('{{count}}d overdue', { count: Math.abs(nextIn) })
                : nextIn === 0 ? t('today') : t('in {{count}}d', { count: nextIn })}`}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const tileStyle: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '12px 14px', minWidth: 0,
};

function TileLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--label)' }}>
      {icon}{children}
    </div>
  );
}

function Value({ text, empty }: { text?: string; empty: string }) {
  if (text && text.trim()) {
    return <p dir="auto" style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-primary)', margin: '4px 0 0', lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</p>;
  }
  if (!empty) return null;
  return <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '4px 0 0' }}>{empty}</p>;
}
