import React from 'react';
import { ChevronRight, Home } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppView } from '../App';

// A lightweight location indicator under the top nav. Its main job is to make
// the shared Correspondences ↔ Manager Inbox tab unambiguous (they live on one
// nav tab) and to give a one-click path back Home from any deep view.

// `label` is the English source text, which is also the i18next key — the trail
// is translated at render, not here.
interface Crumb { label: string; view?: AppView }

const TRAILS: Partial<Record<AppView, Crumb[]>> = {
  home: [],
  overview: [{ label: 'Overview' }],
  correspondences: [{ label: 'Correspondences' }],
  'manager-inbox': [{ label: 'Correspondences', view: 'correspondences' }, { label: 'Manager Inbox' }],
  tasks: [{ label: 'Tasks' }],
  projects: [{ label: 'Projects' }],
  opportunities: [{ label: 'Opportunities' }],
  'bid-analytics': [{ label: 'Opportunities', view: 'opportunities' }, { label: 'Bid Analytics' }],
  archive: [{ label: 'Archive' }],
  'due-soon': [{ label: 'Needs you today' }],
  announcements: [{ label: 'News' }],
  'outlook-feed': [{ label: 'Outlook' }],
  admin: [{ label: 'Users' }],
};

export default function Breadcrumbs({ view, onNavigate }: { view: AppView; onNavigate: (v: AppView) => void }) {
  const { t } = useTranslation();
  const trail = TRAILS[view] ?? [];
  if (view === 'home' || trail.length === 0) return null;

  return (
    <nav aria-label={t('Breadcrumb')} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16, fontSize: 13, flexWrap: 'wrap' }}>
      <button
        onClick={() => onNavigate('home')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: 13, padding: 0 }}
        title={t('Home')}
      >
        <Home className="w-4 h-4" /> {t('Home')}
      </button>
      {trail.map((crumb, i) => {
        const isLast = i === trail.length - 1;
        return (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            {crumb.view && !isLast ? (
              <button
                onClick={() => onNavigate(crumb.view!)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: 13, padding: 0 }}
              >
                {t(crumb.label)}
              </button>
            ) : (
              <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{t(crumb.label)}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
