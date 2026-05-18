import React, { useState } from 'react';
import {
  Inbox, CheckSquare, Archive,
  LogOut, MailOpen, Users, Briefcase, BarChart3, Bell, CheckCircle2, AlertCircle
} from 'lucide-react';
import { AppUser, AppNotification } from '../types';
import { AppView } from '../App';
import { db } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

interface Props {
  appUser: AppUser;
  activeView: AppView;
  onNavigate: (v: AppView) => void;
   notifications: AppNotification[];
   dueSoonCount: number;
   onLogout: () => void;
 }

export default function TopNav({ appUser, activeView, onNavigate, notifications, dueSoonCount, onLogout }: Props) {
  const [showNotifications, setShowNotifications] = useState(false);
  const unreadCount = notifications.filter(n => !n.read).length;

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

    if (n.link) {
      if (n.link === '#tasks') onNavigate('tasks');
      else if (n.link === '#correspondences') onNavigate('correspondences');
      else if (n.link === '#manager-inbox') onNavigate('manager-inbox');
      else if (n.link === '#archive') onNavigate('archive');
      else if (n.link === '#overview') onNavigate('overview');
    } else {
      if (n.type.includes('task') || n.type.includes('milestone')) onNavigate('tasks');
      else if (n.type.includes('corresponding')) onNavigate('correspondences');
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
        {/* Due Soon Alert */}
        {dueSoonCount > 0 && (
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => onNavigate(isManagerOrAdmin ? 'overview' : 'tasks')}
            title={`${dueSoonCount} items due soon`}
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

        {/* Avatar */}
        {appUser.photoURL ? (
          <img
            src={appUser.photoURL}
            alt={appUser.displayName}
            className="topnav-avatar"
            referrerPolicy="no-referrer"
            title={`${appUser.displayName} · ${appUser.role}`}
          />
        ) : (
          <div
            className="topnav-avatar-placeholder"
            title={`${appUser.displayName} · ${appUser.role}`}
            style={{ background: appUser.userColor || undefined }}
          >
            {appUser.displayName?.[0]?.toUpperCase() || 'U'}
          </div>
        )}

        <button onClick={onLogout} className="logout-btn" title="Sign Out">
          <LogOut className="w-3.5 h-3.5" />
          <span className="logout-label">Sign Out</span>
        </button>
      </div>

    </header>
  );
}
