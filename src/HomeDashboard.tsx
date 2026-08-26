import React, { useEffect, useState } from 'react';
import {
  BarChart3, MailOpen, CheckSquare, FolderKanban, Archive,
  Megaphone, Mail, Users, AlertCircle, ArrowRight, Clock, Plus, Target
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppUser } from './types';
import { AppView, NavCounts, AttentionItem } from './App';
import { fmtDate, DATE_SHORT } from './lib/format';
import { useLanguage } from './hooks/useLanguage';
import { getRecents, RecentItem } from './lib/recents';
import { requestOpen } from './lib/deepLink';
import HowItWorks from './components/HowItWorks';

interface Props {
  appUser: AppUser;
  onNavigate: (v: AppView) => void;
  dueSoonCount: number;
  announcementCount: number;
  unreadNotifications: number;
  navCounts: NavCounts;
  attention: AttentionItem[];
}

// Overdue first, then the 48h window, then the triage queue — the order the
// user should work them in. Ties break on the earlier deadline.
const REASON_RANK: Record<AttentionItem['reason'], number> = { overdue: 0, 'due-soon': 1, review: 2 };

// Home is a launcher, not a work queue: past a handful of rows the list stops
// telling you what to do next and becomes another board to scan.
const ATTENTION_LIMIT = 6;

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
      : kind === 'opportunity' ? <Target className="w-4 h-4" />
        : <FolderKanban className="w-4 h-4" />;

export default function HomeDashboard({ appUser, onNavigate, dueSoonCount, announcementCount, unreadNotifications, navCounts, attention }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const isManagerOrAdmin = appUser.role === 'Admin' || appUser.role === 'Manager';
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
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

  const ranked = [...attention].sort((a, b) =>
    (REASON_RANK[a.reason] - REASON_RANK[b.reason]) || (a.due || '').localeCompare(b.due || ''));
  const shown = ranked.slice(0, ATTENTION_LIMIT);

  const openAttention = (item: AttentionItem) => {
    requestOpen({ type: item.kind, id: item.id, label: item.label, serial: item.serial });
    onNavigate(item.kind === 'task' ? 'tasks' : 'correspondences');
  };

  const reasonStyle = (reason: AttentionItem['reason']) =>
    reason === 'overdue' ? { label: t('Overdue'), color: 'var(--danger)', bg: 'rgba(239,68,68,0.12)' }
      : reason === 'due-soon' ? { label: t('Due Soon'), color: '#ea580c', bg: 'rgba(249,115,22,0.12)' }
        : { label: t('Awaiting review'), color: 'var(--blue-600)', bg: 'var(--surface-2)' };

  const openRecent = (r: RecentItem) => {
    if (r.kind === 'task') { requestOpen({ type: 'task', id: r.id, label: r.label, serial: r.serial }); onNavigate('tasks'); }
    else if (r.kind === 'corresponding') { requestOpen({ type: 'corresponding', id: r.id, label: r.label, serial: r.serial }); onNavigate('correspondences'); }
    else if (r.kind === 'opportunity') { requestOpen({ type: 'opportunity', id: r.id, label: r.label, serial: r.serial }); onNavigate('opportunities'); }
    else onNavigate('projects');
  };

  const tiles: Tile[] = [
    {
      id: 'overview',
      title: t('Overview'),
      description: t('Org analytics, workload and progress at a glance.'),
      icon: <BarChart3 className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #2563eb, #14b8a6)',
      show: isManagerOrAdmin,
    },
    {
      id: 'correspondences',
      title: t('Correspondences'),
      description: isManagerOrAdmin
        ? t('Triage incoming letters, then review and assign them as tasks.')
        : t('Incoming letters and requests waiting to be triaged.'),
      icon: <MailOpen className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #6366f1, #2563eb)',
      stat: isManagerOrAdmin
        ? (navCounts.corrNeedsReview > 0 ? t('{{count}} awaiting review', { count: navCounts.corrNeedsReview }) : t('Inbox clear'))
        : (navCounts.corrUnread > 0 ? t('{{count}} new', { count: navCounts.corrUnread }) : t('Nothing new')),
      show: true,
    },
    {
      id: 'tasks',
      title: t('Tasks'),
      description: t('Your active work, milestones and deadlines.'),
      icon: <CheckSquare className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #16a34a, #14b8a6)',
      stat: navCounts.myActiveTasks > 0 ? t('{{count}} active', { count: navCounts.myActiveTasks }) : t('None assigned'),
      show: true,
    },
    {
      id: 'projects',
      title: t('Projects'),
      description: t('Contracts, financials and tracking by project.'),
      icon: <FolderKanban className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
      show: true,
    },
    {
      id: 'opportunities',
      title: t('Opportunities'),
      description: t('Tenders and bids — pipeline, deadlines and win rate.'),
      icon: <Target className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #7c3aed, #db2777)',
      // The badge counts bids at their submission deadline, not the whole
      // pipeline — a deadline is the only thing here that can be missed.
      badge: navCounts.bidsDueSoon,
      // Singular/plural is two explicit keys, not an i18next plural suffix:
      // Arabic has six plural forms and the ar file is typed key-for-key
      // against en, so a suffix set would break that parity guarantee.
      stat: navCounts.bidsDueSoon > 0
        ? t(navCounts.bidsDueSoon > 1 ? '{{count}} deadlines within 7 days' : '{{count}} deadline within 7 days', { count: navCounts.bidsDueSoon })
        : navCounts.openBids > 0 ? t('{{count}} open', { count: navCounts.openBids }) : t('No open bids'),
      show: true,
    },
    {
      id: 'due-soon',
      title: t('Due Soon'),
      description: t('Items due within 48 hours or already overdue.'),
      icon: <AlertCircle className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #f97316, #ef4444)',
      badge: dueSoonCount,
      stat: dueSoonCount > 0 ? t('{{count}} need attention', { count: dueSoonCount }) : t('All on track'),
      show: true,
    },
    {
      id: 'announcements',
      title: t('News'),
      description: t('Department announcements and updates.'),
      icon: <Megaphone className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #f59e0b, #f97316)',
      badge: announcementCount,
      show: true,
    },
    {
      id: 'archive',
      title: t('Archive'),
      description: t('Closed and completed records.'),
      icon: <Archive className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #64748b, #334155)',
      show: true,
    },
    {
      id: 'outlook-feed',
      title: t('Outlook'),
      description: t('Synced email feed for the team.'),
      icon: <Mail className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #0891b2, #0ea5e9)',
      show: true,
    },
    {
      id: 'admin',
      title: t('Users'),
      description: t('Approve members and manage roles.'),
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
          {/* One key, not "greeting + comma + name": the comma itself differs
              (Arabic uses ، and it must sit on the correct side of the name). */}
          {t('{{greeting}}, {{name}}', { greeting, name: firstName })}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 6 }}>
          {dueSoonCount > 0
            ? t(dueSoonCount > 1 ? 'You have {{count}} items due soon' : 'You have {{count}} item due soon', { count: dueSoonCount })
            : t('You’re all caught up. Pick a section to get started.')}
          {unreadNotifications > 0 && ` · ${t(unreadNotifications > 1 ? '{{count}} unread notifications' : '{{count}} unread notification', { count: unreadNotifications })}`}
        </p>
      </div>

      {/* First-run guidance — the three steps work takes here. Hidden for
          anyone who has already opened a record, and dismissible for good. */}
      <HowItWorks enabled={recents.length === 0} onNavigate={onNavigate} />

      {/* Needs you today — the records actually waiting on this user. */}
      {shown.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <h2 style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>{t('Needs you today')}</h2>
            </div>
            {ranked.length > shown.length && (
              <button
                onClick={() => onNavigate('due-soon')}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--blue-600)' }}
              >
                {t('See all {{count}}', { count: ranked.length })}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shown.map(item => {
              const r = reasonStyle(item.reason);
              return (
                <button
                  key={`${item.kind}-${item.id}`}
                  onClick={() => openAttention(item)}
                  className="card card-interactive"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start', width: '100%' }}
                >
                  <span style={{ color: r.color, flexShrink: 0, display: 'flex' }}>{recentIcon(item.kind)}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                    {item.serial && <span className="ltr-data" style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{item.serial}</span>}
                  </span>
                  {item.due && (
                    <span className="ltr-data" style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtDate(item.due, lang, DATE_SHORT)}</span>
                  )}
                  <span style={{ fontSize: 11, fontWeight: 800, color: r.color, background: r.bg, padding: '3px 8px', flexShrink: 0 }}>{r.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick actions — emphasised when there's nothing pressing to do. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
        <button
          onClick={() => onNavigate('correspondences')}
          className="btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: 'var(--blue-600)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}
        >
          <Plus className="w-4 h-4" /> {t('New correspondence')}
        </button>
        <button
          onClick={() => onNavigate('tasks')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}
        >
          <CheckSquare className="w-4 h-4" /> {t('View my tasks')}
        </button>
        {dueSoonCount > 0 && (
          <button
            onClick={() => onNavigate('due-soon')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: 'rgba(249,115,22,0.1)', color: '#ea580c', border: '1px solid rgba(249,115,22,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13 }}
          >
            <AlertCircle className="w-4 h-4" /> {t('Review {{count}} due soon', { count: dueSoonCount })}
          </button>
        )}
      </div>

      {/* Jump back in — recently opened records */}
      {recents.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Clock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <h2 style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>{t('Jump back in')}</h2>
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {recents.map(r => (
              <button
                key={`${r.kind}-${r.id}`}
                onClick={() => openRecent(r)}
                className="card card-interactive"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, maxWidth: 260, textAlign: 'start' }}
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
      <div className="card-grid-sm">
        {visible.map(tile => (
          <button
            key={tile.id}
            onClick={() => onNavigate(tile.id)}
            className="card card-interactive"
            style={{
              textAlign: 'start',
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
