import React from 'react';
import {
  BarChart3, MailOpen, CheckSquare, FolderKanban, Archive,
  Megaphone, Mail, Users, AlertCircle, ArrowRight
} from 'lucide-react';
import { AppUser } from './types';
import { AppView } from './App';

interface Props {
  appUser: AppUser;
  onNavigate: (v: AppView) => void;
  dueSoonCount: number;
  announcementCount: number;
  unreadNotifications: number;
}

interface Tile {
  id: AppView;
  title: string;
  description: string;
  icon: React.ReactNode;
  gradient: string;
  badge?: number;
  show: boolean;
}

export default function HomeDashboard({ appUser, onNavigate, dueSoonCount, announcementCount, unreadNotifications }: Props) {
  const isManagerOrAdmin = appUser.role === 'Admin' || appUser.role === 'Manager';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = (appUser.displayName || '').split(' ')[0] || appUser.displayName;

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
      show: true,
    },
    {
      id: 'tasks',
      title: 'Tasks',
      description: 'Your active work, milestones and deadlines.',
      icon: <CheckSquare className="w-6 h-6" style={{ color: '#fff' }} />,
      gradient: 'linear-gradient(135deg, #16a34a, #14b8a6)',
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
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
