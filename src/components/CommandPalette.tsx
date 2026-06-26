import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import {
  Search, CheckSquare, MailOpen, FolderKanban, CornerDownLeft,
  ArrowUp, ArrowDown, Home, BarChart3, Archive, Megaphone, Mail, Users, AlertCircle,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { globalSearch } from '../utils';
import { requestOpen } from '../lib/deepLink';
import { recordRecent } from '../lib/recents';
import type { AppView } from '../App';
import type { AppUser } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (v: AppView) => void;
  appUser: AppUser;
}

type Hit =
  | { kind: 'nav'; id: AppView; label: string; sub: string; icon: React.ReactNode }
  | { kind: 'task'; id: string; label: string; sub: string; serial?: string; icon: React.ReactNode }
  | { kind: 'corresponding'; id: string; label: string; sub: string; serial?: string; icon: React.ReactNode }
  | { kind: 'project'; id: string; label: string; sub: string; serial?: string; icon: React.ReactNode };

const stripStats = (docs: any[]) => docs.filter(d => d.id !== '--stats--');

export default function CommandPalette({ open, onClose, onNavigate, appUser }: Props) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [tasks, setTasks] = useState<any[]>([]);
  const [corrs, setCorrs] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isManagerOrAdmin = appUser.role === 'Admin' || appUser.role === 'Manager';

  // Lazily snapshot the three searchable collections the first time the palette
  // is opened (a one-shot read, not a live listener — the dashboards already
  // own the live queries; this just powers cross-section search).
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const [t, c, p] = await Promise.all([
          getDocs(collection(db, 'tasks')),
          getDocs(collection(db, 'correspondences')),
          getDocs(collection(db, 'projects')),
        ]);
        if (cancelled) return;
        setTasks(stripStats(t.docs).map(d => ({ id: d.id, ...d.data() })));
        setCorrs(stripStats(c.docs).map(d => ({ id: d.id, ...d.data() })));
        setProjects(stripStats(p.docs).map(d => ({ id: d.id, ...d.data() })));
        setLoaded(true);
      } catch (err) {
        console.warn('Command palette load error:', err);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, loaded]);

  // Focus the input and reset state each time the palette opens.
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const navCommands: Hit[] = useMemo(() => ([
    { kind: 'nav', id: 'home', label: 'Home', sub: 'Go to dashboard', icon: <Home className="w-4 h-4" /> },
    ...(isManagerOrAdmin ? [{ kind: 'nav', id: 'overview', label: 'Overview', sub: 'Org analytics', icon: <BarChart3 className="w-4 h-4" /> } as Hit] : []),
    { kind: 'nav', id: 'correspondences', label: 'Correspondences', sub: 'Intake & review', icon: <MailOpen className="w-4 h-4" /> },
    { kind: 'nav', id: 'tasks', label: 'Tasks', sub: 'Work & milestones', icon: <CheckSquare className="w-4 h-4" /> },
    { kind: 'nav', id: 'projects', label: 'Projects', sub: 'Contracts & financials', icon: <FolderKanban className="w-4 h-4" /> },
    { kind: 'nav', id: 'due-soon', label: 'Due Soon', sub: 'Overdue & due in 48h', icon: <AlertCircle className="w-4 h-4" /> },
    { kind: 'nav', id: 'announcements', label: 'News', sub: 'Department announcements', icon: <Megaphone className="w-4 h-4" /> },
    { kind: 'nav', id: 'archive', label: 'Archive', sub: 'Closed records', icon: <Archive className="w-4 h-4" /> },
    { kind: 'nav', id: 'outlook-feed', label: 'Outlook', sub: 'Synced email feed', icon: <Mail className="w-4 h-4" /> },
    ...(appUser.role === 'Admin' ? [{ kind: 'nav', id: 'admin', label: 'Users', sub: 'Approve & manage roles', icon: <Users className="w-4 h-4" /> } as Hit] : []),
  ]), [isManagerOrAdmin, appUser.role]);

  const hits: Hit[] = useMemo(() => {
    const term = q.trim();
    if (!term) {
      // Empty query -> show jump-to-section commands only.
      return navCommands;
    }
    const navHits = navCommands.filter(n =>
      n.label.toLowerCase().includes(term.toLowerCase()));

    const taskHits: Hit[] = tasks
      .filter(t => globalSearch(t, term))
      .slice(0, 6)
      .map(t => ({
        kind: 'task', id: t.id, label: t.taskName || 'Untitled task', serial: t.serialNumber,
        sub: [t.serialNumber, t.assignedTo, t.status].filter(Boolean).join(' · '),
        icon: <CheckSquare className="w-4 h-4" />,
      }));

    const corrHits: Hit[] = corrs
      .filter(c => globalSearch(c, term))
      .slice(0, 6)
      .map(c => ({
        kind: 'corresponding', id: c.id, label: c.subject || 'Untitled', serial: c.serialNumber,
        sub: [c.serialNumber, c.sentFrom, c.status].filter(Boolean).join(' · '),
        icon: <MailOpen className="w-4 h-4" />,
      }));

    const projHits: Hit[] = projects
      .filter(p => globalSearch(p, term))
      .slice(0, 5)
      .map(p => ({
        kind: 'project', id: p.id, label: p.name || 'Untitled project', serial: p.serialNumber,
        sub: [p.serialNumber, p.client, p.status].filter(Boolean).join(' · '),
        icon: <FolderKanban className="w-4 h-4" />,
      }));

    return [...navHits, ...taskHits, ...corrHits, ...projHits];
  }, [q, tasks, corrs, projects, navCommands]);

  useEffect(() => { setActive(0); }, [q]);

  const choose = (hit: Hit | undefined) => {
    if (!hit) return;
    if (hit.kind === 'nav') {
      onNavigate(hit.id);
    } else if (hit.kind === 'task') {
      requestOpen({ type: 'task', id: hit.id, label: hit.label, serial: hit.serial });
      onNavigate('tasks');
    } else if (hit.kind === 'corresponding') {
      requestOpen({ type: 'corresponding', id: hit.id, label: hit.label, serial: hit.serial });
      onNavigate('correspondences');
    } else {
      recordRecent({ kind: 'project', id: hit.id, label: hit.label, serial: hit.serial });
      onNavigate('projects');
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(hits[active]); }
  };

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 'min(14vh, 120px)',
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 'min(620px, calc(100vw - 32px))', maxHeight: '70vh',
          background: 'var(--surface)', border: '1px solid var(--border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.32)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Search className="w-5 h-5" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tasks, correspondences, projects…"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 16, color: 'var(--text-primary)', fontFamily: 'inherit',
            }}
          />
          <kbd style={{ fontSize: 11, color: 'var(--text-muted)', border: '1px solid var(--border)', padding: '2px 6px', background: 'var(--surface-2)' }}>Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {!loaded && q && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
          )}
          {hits.length === 0 && loaded && (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No matches for “{q}”.
            </div>
          )}
          {hits.map((hit, i) => (
            <button
              key={`${hit.kind}-${hit.id}-${i}`}
              data-idx={i}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(hit)}
              style={{
                width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 16px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: i === active ? 'var(--blue-50)' : 'transparent',
                color: 'var(--text-primary)',
                borderLeft: `3px solid ${i === active ? 'var(--blue-600)' : 'transparent'}`,
              }}
            >
              <span style={{ color: i === active ? 'var(--blue-600)' : 'var(--text-muted)', flexShrink: 0, display: 'flex' }}>{hit.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hit.label}</span>
                {hit.sub && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hit.sub}</span>}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', flexShrink: 0 }}>
                {hit.kind === 'nav' ? 'Go' : hit.kind === 'corresponding' ? 'Corr' : hit.kind}
              </span>
            </button>
          ))}
        </div>

        {/* Footer hints */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowUp className="w-3 h-3" /><ArrowDown className="w-3 h-3" /> navigate</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CornerDownLeft className="w-3 h-3" /> open</span>
          <span style={{ marginLeft: 'auto' }}>Tip: press <kbd style={{ border: '1px solid var(--border)', padding: '1px 4px' }}>g</kbd> then a key to jump</span>
        </div>
      </div>
    </div>
  );
}
