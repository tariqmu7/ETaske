import React, { useEffect, useState } from 'react';
import {
  BarChart3, MailOpen, CheckSquare, FolderKanban, Archive,
  Megaphone, Mail, Users, AlertCircle, ArrowRight, Clock, Plus
} from 'lucide-react';
import { AppUser } from './types';
import { AppView, NavCounts } from './App';
import { getRecents, RecentItem } from './lib/recents';
import { requestOpen } from './lib/deepLink';

interface Props {
  appUser: AppUser;
  onNavigate: (v: AppView) => void;
  dueSoonCount: number;
  announcementCount: number;
  unreadNotifications: number;
  navCounts: NavCounts;
}

interface Tile {
  id: AppView;
  title: string;
  description: string;
  icon: React.ReactNode;
  gradient: string;
  badge?: number;
  stat?: string;     // live one-liner, e.g. "3 awaiting review"
  show: boolean;
}

const recentIcon = (kind: RecentItem['kind']) =>
  kind === 'task' ? <CheckSquare className="w-4 h-4" />
    : kind === 'corresponding' ? <MailOpen className="w-4 h-4" />
      : <FolderKanban className="w-4 h-4" />;

export default function HomeDashboard({ appUser, onNavigate, dueSoonCount, announcementCount, unreadNotifications, navCounts }: Props) {
  const isManagerOrAdmin = appUser.role === 'Admin' || appUser.role === 'Manager';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = (appUser.displayName || '').split(' ')[0] || appUser.displayName;

  // "Jump back in" — recently opened records, kept fresh via the recents bus.
  const [recents, setRecents] = useState<RecentItem[]>(() => getRecents());
  useEffect(() => {
    const refresh = () => setRecents(getRecents());
    window.addEventListener('etaske:recents', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('etaske:recents', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const openRecent = (r: RecentItem) => {
    if (r.kind === 'task') { requestOpen({ type: 'task', id: r.id, label: r.label, serial: r.serial }); onNavigate('tasks'); }
    else if (r.kind === 'corresponding') { requestOpen({ type: 'corresponding', id: r.id, label: r.label, serial: r.serial }); onNavigate('correspondences'); }
    else onNavigate('projects');
  };

  const tiles: Tile[] = [
    {
      id: 'overview',
      title: 'Overview',
      description: 'Org analytics, workload and progress at a glance.',
      icon: <BarChart3 className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #2563eb, #14b8a6)',
      show: isManagerOrAdmin,
    },
    {
      id: 'correspondences',
      title: 'Correspondences',
      description: isManagerOrAdmin
        ? 'Triage incoming letters, then review and assign them as tasks.'
        : 'Incoming letters and requests waiting to be triaged.',
      icon: <MailOpen className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #6366f1, #2563eb)',
      stat: isManagerOrAdmin
        ? (navCounts.corrNeedsReview > 0 ? `${navCounts.corrNeedsReview} awaiting review` : 'Inbox clear')
        : (navCounts.corrUnread > 0 ? `${navCounts.corrUnread} new` : 'Nothing new'),
      show: true,
    },
    {
      id: 'tasks',
      title: 'Tasks',
      description: 'Your active work, milestones and deadlines.',
      icon: <CheckSquare className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #16a34a, #14b8a6)',
      stat: navCounts.myActiveTasks > 0 ? `${navCounts.myActiveTasks} active` : 'None assigned',
      show: true,
    },
    {
      id: 'projects',
      title: 'Projects',
      description: 'Contracts, financials and tracking by project.',
      icon: <FolderKanban className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
      show: true,
    },
    {
      id: 'due-soon',
      title: 'Due Soon',
      description: 'Items due within 48 hours or already overdue.',
      icon: <AlertCircle className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #f97316, #ef4444)',
      badge: dueSoonCount,
      stat: dueSoonCount > 0 ? `${dueSoonCount} need attention` : 'All on track',
      show: true,
    },
    {
      id: 'announcements',
      title: 'News',
      description: 'Department announcements and updates.',
      icon: <Megaphone className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #f59e0b, #f97316)',
      badge: announcementCount,
      show: true,
    },
    {
      id: 'archive',
      title: 'Archive',
      description: 'Closed and completed records.',
      icon: <Archive className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #64748b, #334155)',
      show: true,
    },
    {
      id: 'outlook-feed',
      title: 'Outlook',
      description: 'Synced email feed for the team.',
      icon: <Mail className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #0891b2, #0ea5e9)',
      show: true,
    },
    {
      id: 'admin',
      title: 'Users',
      description: 'Approve members and manage roles.',
      icon: <Users className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #db2777, #8b5cf6)',
      show: appUser.role === 'Admin',
    },
  ];

  const visible = tiles.filter(t => t.show);

  return (
    <div>
      {/* Greeting header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
          {greeting}, {firstName}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 6 }}>
          {dueSoonCount > 0
            ? `You have ${dueSoonCount} item${dueSoonCount > 1 ? 's' : ''} due soon`
            : 'You’re all caught up. Pick a section to get started.'}
          {unreadNotifications > 0 && ` · ${unreadNotifications} unread notification${unreadNotifications > 1 ? 's' : ''}`}
        </p>
      </div>

      {/* Quick actions — emphasised when there's nothing pressing to do. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
        <button
          onClick={() => onNavigate('correspondences')}
          className="btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: 'var(--blue-600)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}
        >
          <Plus className="w-4 h-4" /> New correspondence
        </button>
        <button
          onClick={() => onNavigate('tasks')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}
        >
          <CheckSquare className="w-4 h-4" /> View my tasks
        </button>
        {dueSoonCount > 0 && (
          <button
            onClick={() => onNavigate('due-soon')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: 'rgba(249,115,22,0.1)', color: '#ea580c', border: '1px solid rgba(249,115,22,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}
          >
            <AlertCircle className="w-4 h-4" /> Review {dueSoonCount} due soon
          </button>
        )}
      </div>

      {/* Jump back in — recently opened records */}
      {recents.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Clock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <h2 style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>Jump back in</h2>
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {recents.map(r => (
              <button
                key={`${r.kind}-${r.id}`}
                onClick={() => openRecent(r)}
                className="card card-interactive"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, maxWidth: 260, textAlign: 'left' }}
              >
                <span style={{ color: 'var(--blue-600)', flexShrink: 0, display: 'flex' }}>{recentIcon(r.kind)}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                  {r.serial && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{r.serial}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Card grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 16,
      }}>
        {visible.map(tile => (
          <button
            key={tile.id}
            onClick={() => onNavigate(tile.id)}
            className="card card-interactive"
            style={{
              textAlign: 'left',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              background: 'var(--surface)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{
                width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: tile.gradient, flexShrink: 0,
              }}>
                {tile.icon}
              </div>
              {tile.badge !== undefined && tile.badge > 0 && (
                <span style={{
                  background: 'var(--danger)', color: '#fff', fontSize: 12, fontWeight: 800,
                  padding: '3px 9px', minWidth: 24, textAlign: 'center',
                }}>
                  {tile.badge > 99 ? '99+' : tile.badge}
                </span>
              )}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  {tile.title}
                </h3>
                <ArrowRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.45 }}>
                {tile.description}
              </p>
              {tile.stat && (
                <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '3px 9px' }}>
                  {tile.stat}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
