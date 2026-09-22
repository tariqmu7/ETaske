import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Copy, Check, Mail } from 'lucide-react';
import {
  buildFollowUpLetter, mailtoUrl, toneFor,
  type FollowUpInfo, type FollowUpTone, type LetterLang,
} from '../lib/followUp';
import { copyToClipboard } from '../utils';

// The ready-made chaser (queue task B4). It shows ONE letter at a time — the
// language the user is going to send in — because a side-by-side pair invites
// pasting the wrong one. The text is editable: the app drafts, the person signs.
//
// Nothing here sends anything. "Open in email" fills a draft in the desk's own
// mail client and stops there, so no letter ever leaves in the user's name
// without them reading it.

const TONES: { value: FollowUpTone; label: string }[] = [
  { value: 'gentle', label: 'Polite reminder' },
  { value: 'firm', label: 'Firmer' },
  { value: 'final', label: 'Final notice' },
];

export default function FollowUpLetterModal({
  info,
  onClose,
}: {
  info: FollowUpInfo | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();

  // The app's own language is the likely sending language, but a letter to an
  // international client goes out in English whatever the UI is set to.
  const [lang, setLang] = useState<LetterLang>(i18n.language === 'ar' ? 'ar' : 'en');
  const [tone, setTone] = useState<FollowUpTone>(toneFor(info?.waitingDays));
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);

  const letter = useMemo(
    () => (info ? buildFollowUpLetter(info, lang, tone) : null),
    [info, lang, tone],
  );

  // A new record, a new tone or a new language throws the hand edits away —
  // silently keeping them would put yesterday's wording on today's letter.
  useEffect(() => {
    setDraft(letter ? letter.body : '');
    setCopied(false);
  }, [letter]);

  // Re-arm the tone whenever a different record opens the dialog.
  useEffect(() => {
    if (info) setTone(toneFor(info.waitingDays));
  }, [info]);

  useEffect(() => {
    if (!info) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [info, onClose]);

  if (!info || !letter) return null;

  const copy = async () => {
    const ok = await copyToClipboard(`${letter.subject}\n\n${draft}`);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const openInMail = () => {
    window.location.href = mailtoUrl({ ...letter, body: draft }, info.email);
  };

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 'min(640px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', border: '1px solid var(--border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface-3)',
        }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
              {t('Follow-up letter')}
            </h3>
            <p style={{
              margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {info.counterparty ? `${info.counterparty} · ` : ''}{info.subject}
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t('Close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tone + language */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '12px 18px', borderBottom: '1px solid var(--border)',
        }}>
          {TONES.map(option => (
            <button
              key={option.value}
              onClick={() => setTone(option.value)}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: '1px solid var(--border)',
                background: tone === option.value ? 'var(--accent)' : 'var(--surface-2)',
                color: tone === option.value ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {t(option.label)}
            </button>
          ))}
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 6 }}>
            {(['en', 'ar'] as LetterLang[]).map(code => (
              <button
                key={code}
                onClick={() => setLang(code)}
                style={{
                  padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid var(--border)',
                  background: lang === code ? 'var(--surface-3)' : 'var(--surface-2)',
                  color: lang === code ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {code === 'en' ? 'English' : 'العربية'}
              </button>
            ))}
          </div>
        </div>

        {/* The letter */}
        <div style={{ padding: 18, overflowY: 'auto', display: 'grid', gap: 10 }}>
          <div>
            <div style={{
              fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--text-muted)', marginBottom: 6,
            }}>
              {t('Subject line')}
            </div>
            <div
              dir={lang === 'ar' ? 'rtl' : 'ltr'}
              style={{
                fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                border: '1px solid var(--border)', background: 'var(--surface-2)', padding: '8px 12px',
              }}
            >
              {letter.subject}
            </div>
          </div>

          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            rows={14}
            style={{
              width: '100%', resize: 'vertical', fontSize: 13, lineHeight: 1.8,
              color: 'var(--text-primary)', background: 'var(--surface-2)',
              border: '1px solid var(--border)', padding: '12px 14px',
              fontFamily: 'inherit',
            }}
          />

          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {t('Read it, change what you want, then copy it or open it in your mail. Nothing is sent from here.')}
          </p>
        </div>

        {/* Actions */}
        <div style={{
          padding: '14px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface)',
          display: 'flex', gap: 10, flexShrink: 0,
        }}>
          <button className="btn btn-primary" style={{ gap: 8, height: 42, flex: 1 }} onClick={copy}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? t('Copied') : t('Copy letter')}
          </button>
          <button className="btn btn-ghost" style={{ gap: 8, height: 42, flex: 1 }} onClick={openInMail}>
            <Mail className="w-4 h-4" /> {t('Open in email')}
          </button>
          <button className="btn btn-ghost" style={{ height: 42 }} onClick={onClose}>{t('Close')}</button>
        </div>
      </div>
    </div>
  );
}
