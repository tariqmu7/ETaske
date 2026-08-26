import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

export type CardMenuItem = {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
};

/**
 * The "···" menu on a record card.
 *
 * UX task 5: a card carries ONE visible action (opening the record). Edit,
 * delete and anything else live behind this, so two boards' cards stopped
 * competing with themselves. Presentation only — the caller owns the actions.
 */
export default function CardMenu({ items, title }: { items: CardMenuItem[]; title?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!items.length) return null;

  return (
    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button
        className="btn btn-ghost btn-icon btn-sm"
        style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-muted)', lineHeight: 1 }}
        title={title || t('More actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        ···
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'absolute', top: '100%', insetInlineEnd: 0, marginTop: 4,
                background: 'var(--surface)',
                border: '1px solid var(--border-md)',
                boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
                zIndex: 100,
                minWidth: 148,
                overflow: 'hidden',
              }}
            >
              {items.map(item => (
                <button
                  key={item.label}
                  role="menuitem"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px',
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                    color: item.danger ? '#dc2626' : 'var(--text-primary)', textAlign: 'start',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = item.danger ? '#fef2f2' : 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  onClick={() => { setOpen(false); item.onClick(); }}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
