import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// Cheatsheet shown when the user presses "?". Mirrors the shortcuts wired in
// src/hooks/useKeyboardNav.ts and the command palette.
const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'General',
    rows: [
      ['Ctrl / ⌘ + K', 'Open command palette'],
      ['/', 'Search (command palette)'],
      ['?', 'Show this help'],
      ['Esc', 'Close dialogs'],
    ],
  },
  {
    title: 'Go to (press g, then…)',
    rows: [
      ['g h', 'Home'],
      ['g t', 'Tasks'],
      ['g c', 'Correspondences'],
      ['g i', 'Manager Inbox'],
      ['g o', 'Overview'],
      ['g p', 'Projects'],
      ['g d', 'Due Soon'],
      ['g a', 'Archive'],
      ['g n', 'News'],
      ['g u', 'Users'],
    ],
  },
];

export default function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{ width: 'min(520px, 100%)', maxHeight: '80vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface-3)' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Keyboard shortcuts</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 20 }}>
          {GROUPS.map(group => (
            <div key={group.title}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>{group.title}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {group.rows.map(([keys, desc]) => (
                  <div key={keys} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{desc}</span>
                    <kbd style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', border: '1px solid var(--border)', background: 'var(--surface-2)', padding: '2px 8px', whiteSpace: 'nowrap' }}>{keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
