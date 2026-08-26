/**
 * First-run guidance for Home: the three steps work actually takes in this app.
 *
 * The boss's complaint was not that a screen was missing — it was that nothing
 * told him what the app *is*. Correspondence -> task -> archive is obvious once
 * you have used it and invisible before that, so this strip states it once, on
 * the landing page, and then gets out of the way permanently:
 *
 *  - it is dismissible, and the dismissal is remembered in localStorage;
 *  - it hides itself the moment the user has opened anything (`hasRecents`),
 *    because by then they have learned the flow by doing it.
 *
 * Each step is clickable and lands on the board it describes.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MailOpen, CheckSquare, Archive, X, ArrowRight } from 'lucide-react';
import { AppView } from '../App';

const KEY = 'etaske.howitworks.dismissed.v1';

export const isHowItWorksDismissed = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false; // storage disabled — show the hint rather than swallow it
  }
};

interface Props {
  /** False once the user has recent activity — they already know the flow. */
  enabled: boolean;
  onNavigate: (v: AppView) => void;
}

export default function HowItWorks({ enabled, onNavigate }: Props) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(isHowItWorksDismissed);

  if (!enabled || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* storage full / disabled — the hint just returns next session */
    }
  };

  const steps: { view: AppView; icon: React.ReactNode; title: string; body: string }[] = [
    {
      view: 'correspondences',
      icon: <MailOpen className="w-5 h-5" />,
      title: t('1. Log it'),
      body: t('Every incoming letter or request is recorded as a correspondence.'),
    },
    {
      view: 'tasks',
      icon: <CheckSquare className="w-5 h-5" />,
      title: t('2. Assign it'),
      body: t('A manager reviews it and turns it into a task with an owner and a deadline.'),
    },
    {
      view: 'archive',
      icon: <Archive className="w-5 h-5" />,
      title: t('3. Finish it'),
      body: t('Track milestones on the task; marking it Done files it in the archive.'),
    },
  ];

  return (
    <div
      style={{
        marginBottom: 24, padding: '14px 16px', background: 'var(--surface-2)',
        border: '1px solid var(--border)', position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>
          {t('How work flows here')}
        </h2>
        <button
          type="button"
          onClick={dismiss}
          title={t('Dismiss')}
          aria-label={t('Dismiss')}
          style={{ marginInlineStart: 'auto', background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="card-grid-sm">
        {steps.map((s, i) => (
          <button
            key={s.view}
            type="button"
            onClick={() => onNavigate(s.view)}
            className="card card-interactive"
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
              background: 'var(--surface)', border: '1px solid var(--border)',
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start',
            }}
          >
            <span style={{ color: 'var(--blue-600)', flexShrink: 0, display: 'flex', marginTop: 1 }}>{s.icon}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
                {s.title}
                {/* The arrow only reads as "and then" between steps, not after the last one. */}
                {i < steps.length - 1 && <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />}
              </span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>
                {s.body}
              </span>
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={dismiss}
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 12 }}
      >
        {t('Got it')}
      </button>
    </div>
  );
}
