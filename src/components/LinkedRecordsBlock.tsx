// ─── "Linked records": the FORWARD view of a cross-record link ───────────────
//
// Queue task 6. A task (or a correspondence) knows which bid and which project
// it is attached to through the denormalized labels written by
// src/lib/recordLinks.ts. This paints them; it reads nothing from Firestore.
//
// ★ It reads the STORED labels, never the live opportunity/project document.
// That is what the labels are denormalized for: a row must never have to open
// another collection to say what it is linked to, and a label that has since
// been renamed is still the right answer for "what was this attached to".
//
// ★ Deliberately NOT clickable. `deepLink` has a type for an opportunity but
// none for a project (ProjectsDashboard opens a project from its own local
// state), so half the chips would navigate and half would not — which reads as
// a bug. Giving projects a deep-link type is its own task.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { RecordLinks } from '../types';
import { hasAnyLink } from '../lib/recordLinks';
import { Link2, Target, Briefcase } from 'lucide-react';

interface Props {
  links: RecordLinks;
  /** Inline chips (a row inside a card) instead of the titled block. */
  compact?: boolean;
}

export default function LinkedRecordsBlock({ links, compact }: Props) {
  const { t } = useTranslation();
  if (!hasAnyLink(links)) return null;

  const opp = links.opportunityId && (
    <span
      key="opp"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%',
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        padding: '3px 8px', fontSize: 11.5, color: 'var(--text-secondary)',
      }}
      title={t('Opportunity / Bid')}
    >
      <Target style={{ width: 12, height: 12, flexShrink: 0, color: 'var(--accent)' }} />
      {/* A serial is Latin data: bidi would drag its punctuation to the wrong
          end inside an Arabic line (the `.ltr-data` rule). */}
      {links.opportunitySerial && (
        <span className="ltr-data" style={{ fontWeight: 800 }}>{links.opportunitySerial}</span>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {links.opportunityTitle || t('Linked opportunity')}
      </span>
    </span>
  );

  const prj = links.projectId && (
    <span
      key="prj"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%',
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        padding: '3px 8px', fontSize: 11.5, color: 'var(--text-secondary)',
      }}
      title={t('Project record')}
    >
      <Briefcase style={{ width: 12, height: 12, flexShrink: 0, color: 'var(--accent)' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {links.projectName || t('Linked project')}
      </span>
    </span>
  );

  if (compact) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {opp}{prj}
      </span>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
        <Link2 style={{ width: 12, height: 12 }} />
        {t('Linked Records')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {opp}{prj}
      </div>
    </div>
  );
}
