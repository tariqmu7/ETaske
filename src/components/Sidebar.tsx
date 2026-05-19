import React, { useState, useRef, useEffect } from 'react';
import {
  Inbox, CheckSquare, Archive,
  LogOut, MailOpen, Users, Briefcase, BarChart3, Bell, CheckCircle2, AlertCircle, Megaphone,
  Download, BellOff, BellRing
} from 'lucide-react';
import { AppUser, AppNotification } from '../types';
import { AppView } from '../App';
import { db } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { requestOpen } from '../lib/deepLink';
import { usePWA } from '../hooks/usePWA';

interface Props {
  appUser: AppUser;
  activeView: AppView;
  onNavigate: (v: AppView) => void;
  notifications: AppNotification[];
  dueSoonCount: number;
  announcementCount: number;
  onLogout: () => void;
  pwa: ReturnType<typeof usePWA>;
}

export default function TopNav({ appUser, activeView, onNavigate, notifications, dueSoonCount, announcementCount, onLogout, pwa }: Props) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!showUserMenu) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUserMenu]);

  const handleClearAll = () => {
    const unread = notifications.filter(n => !n.read);
    unread.forEach(n => {
      updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(console.error);
    });
  };

  const handleNotificationClick = (n: AppNotification) => {
    if (!n.read) {
      updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(console.error);
    }
    setShowNotifications(false);

    // A task/milestone notification points at a task doc; any "correspond*"
    // notification points at a correspondence doc. relatedId is that doc id.
    const isTask = n.type.includes('task') || n.type.includes('milestone');
    const isCorr = n.type.includes('correspond');

    // Ask the target dashboard to open the specific record (deep-link bus,
    // src/lib/deepLink.ts). The dashboard picks this up when it mounts or, if
    // already mounted, reacts live.
    if (n.relatedId) {
      if (isTask) requestOpen({ type: 'task', id: n.relatedId });
      else if (isCorr) requestOpen({ type: 'corresponding', id: n.relatedId });
    }

    if (n.link) {
      if (n.link === '#tasks') onNavigate('tasks');
      else if (n.link === '#correspondences') onNavigate('correspondences');
      else if (n.link === '#manager-inbox') onNavigate('manager-inbox');
      else if (n.link === '#archive') onNavigate('archive');
      else if (n.link === '#overview') onNavigate('overview');
    } else {
      if (isTask) onNavigate('tasks');
      else if (isCorr) onNavigate('correspondences');
    }
  };

  const isManagerOrAdmin = appUser.role === 'Admin' || appUser.role === 'Manager';

  const navItems: { id: AppView; label: string; icon: React.ReactNode; badge?: number; show: boolean }[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <BarChart3 className="w-4 h-4" />,
      show: isManagerOrAdmin,
    },
    {
      id: 'correspondences',
      label: 'Correspondences',
      icon: <MailOpen className="w-4 h-4" />,
      show: true,
    },
    {
      id: 'manager-inbox',
      label: 'Inbox',
      icon: <Inbox className="w-4 h-4" />,
      show: true,
    },
    {
      id: 'tasks',
      label: 'Tasks',
      icon: <CheckSquare className="w-4 h-4" />,
      show: true,
    },
    {
      id: 'archive',
      label: 'Archive',
      icon: <Archive className="w-4 h-4" />,
      show: true,
    },
    {
      id: 'admin',
      label: 'Users',
      icon: <Users className="w-4 h-4" />,
      show: appUser.role === 'Admin',
    },
  ];

  return (
    <header className="topnav">
      {/* Logo */}
      <div className="topnav-logo">
        <div className="topnav-logo-icon">
          <Briefcase className="w-4 h-4" style={{ color: '#fff' }} />
        </div>
        <span className="topnav-brand">ETaske</span>
      </div>

      {/* Nav tabs */}
      <nav className="topnav-tabs">
        {navItems.filter(i => i.show).map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`nav-tab${activeView === item.id ? ' active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span className="tab-badge">
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* User + logout */}
      <div className="topnav-user" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* Install PWA */}
        {pwa.canInstall && (
          <button
            className="btn btn-ghost btn-icon"
            onClick={pwa.promptInstall}
            title="Add to Home Screen"
          >
            <Download className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}

        {/* Enable / notifications granted indicator */}
        {pwa.notificationPermission !== 'granted' && !pwa.canInstall && (
          <button
            className="btn btn-ghost btn-icon"
            onClick={pwa.enableNotifications}
            title={pwa.isIOS && !pwa.isInstalled ? 'Install app first to enable notifications' : 'Enable push notifications'}
          >
            <BellOff className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}
        {pwa.notificationPermission === 'granted' && (
          <span title="Push notifications enabled">
            <BellRing className="w-5 h-5" style={{ color: '#22c55e' }} />
          </span>
        )}

        {/* Announcements */}
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => onNavigate('announcements')}
          title="Announcements"
          style={{ position: 'relative', color: activeView === 'announcements' ? 'var(--accent)' : undefined }}
        >
          <Megaphone className="w-5 h-5" style={{ color: activeView === 'announcements' ? 'var(--accent)' : 'var(--text-secondary)' }} />
          {announcementCount > 0 && (
            <span style={{
              position: 'absolute', top: 0, right: 0, background: 'var(--accent)', color: 'white',
              fontSize: 10, fontWeight: 800, padding: '2px 5px', borderRadius: 0,
              transform: 'translate(25%, -25%)'
            }}>
              {announcementCount > 9 ? '9+' : announcementCount}
            </span>
          )}
        </button>

        {/* Due Soon Alert */}
        {dueSoonCount > 0 && (
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => onNavigate('due-soon')}
            title={`${dueSoonCount} items due soon — view list`}
            style={{ position: 'relative' }}
          >
            <AlertCircle className="w-5 h-5" style={{ color: '#f97316' }} />
            <span style={{
              position: 'absolute', top: 0, right: 0, background: '#f97316', color: 'white',
              fontSize: 10, fontWeight: 800, padding: '2px 5px', borderRadius: 0,
              transform: 'translate(25%, -25%)'
            }}>
              {dueSoonCount}
            </span>
          </button>
        )}

        {/* Notifications Bell */}
        <div style={{ position: 'relative' }}>
          <button 
            className="btn btn-ghost btn-icon" 
            onClick={() => setShowNotifications(!showNotifications)}
            title="Notifications"
            style={{ position: 'relative' }}
          >
            <Bell className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 0, right: 0, background: '#ef4444', color: 'white',
                fontSize: 10, fontWeight: 800, padding: '2px 5px', borderRadius: 0,
                transform: 'translate(25%, -25%)'
              }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="notif-dropdown">
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)' }}>
                <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Notifications</h3>
                {unreadCount > 0 && (
                  <button onClick={handleClearAll} style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
                    Mark all read
                  </button>
                )}
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {notifications.length === 0 ? (
                  <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No notifications yet.
                  </div>
                ) : (
                  notifications.slice(0, 20).map(n => (
                    <div key={n.id} 
                      onClick={() => handleNotificationClick(n)}
                      className="notif-item"
                      style={{ 
                        padding: '12px 16px', borderBottom: '1px solid var(--border)', 
                        background: n.read ? '#fff' : 'rgba(99,102,241,0.05)',
                        display: 'flex', gap: 12, alignItems: 'flex-start',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ marginTop: 2 }}>
                        {n.read ? <CheckCircle2 className="w-4 h-4 text-success" /> : <div style={{ width: 8, height: 8, borderRadius: 0, background: 'var(--accent)', marginTop: 4 }} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: n.read ? 600 : 800, color: 'var(--text-primary)', marginBottom: 2 }}>{n.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{n.message}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                          {n.createdAt ? new Date(n.createdAt.seconds * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Avatar + user dropdown */}
        <div ref={userMenuRef} style={{ position: 'relative' }}>
          {appUser.photoURL ? (
            <img
              src={appUser.photoURL}
              alt={appUser.displayName}
              className="topnav-avatar"
              referrerPolicy="no-referrer"
              title={`${appUser.displayName} · ${appUser.role}`}
              onClick={() => setShowUserMenu(v => !v)}
            />
          ) : (
            <div
              className="topnav-avatar-placeholder"
              title={`${appUser.displayName} · ${appUser.role}`}
              style={{ background: appUser.userColor || undefined }}
              onClick={() => setShowUserMenu(v => !v)}
            >
              {appUser.displayName?.[0]?.toUpperCase() || 'U'}
            </div>
          )}

          {showUserMenu && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 10px)', right: 0,
              background: '#fff', border: '1px solid var(--border)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
              minWidth: 220, zIndex: 2000,
            }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', background: 'var(--blue-50)' }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{appUser.displayName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{appUser.email}</div>
                <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', padding: '2px 8px', background: 'var(--blue-600)', color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {appUser.role}
                </div>
              </div>
              <div style={{ padding: '6px 8px' }}>
                <button
                  onClick={() => { setShowUserMenu(false); onLogout(); }}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

    </header>
  );
}
