import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, serverTimestamp, updateDoc, query, where, orderBy } from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { AppUser, AppNotification, Announcement } from './types';
import LoginScreen from './LoginScreen';
import PendingScreen from './PendingScreen';
import RejectedScreen from './RejectedScreen';
import UsernameSetupScreen from './UsernameSetupScreen';
import TopNav from './components/Sidebar';
import CorrespondingsDashboard from './CorrespondingsDashboard';
import ManagerInbox from './ManagerInbox';
import TasksDashboard from './TasksDashboard';
import ArchiveDashboard from './ArchiveDashboard';
import AdminDashboard from './AdminDashboard';
import OverviewDashboard from './OverviewDashboard';
import DueSoonDashboard from './DueSoonDashboard';
import OutlookFeed from './OutlookFeed';
import ChatBox from './components/ChatBox';
import IdleResyncBanner from './components/IdleResyncBanner';
import Announcements from './components/Announcements';
import {
  BarChart3, MailOpen, Inbox, CheckSquare, Archive, Users, Megaphone, Mail, MoreHorizontal, X
} from 'lucide-react';
import { usePWA } from './hooks/usePWA';
import { isOverdue, isDueSoon } from './utils';
import { useTheme } from './hooks/useTheme';
import { onForegroundMessage } from './lib/fcm';

export type AppView = 'correspondences' | 'manager-inbox' | 'tasks' | 'archive' | 'admin' | 'overview' | 'announcements' | 'due-soon' | 'outlook-feed';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [projectUsers, setProjectUsers] = useState<AppUser[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeView, setActiveView] = useState<AppView>('tasks');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [dueSoonCount, setDueSoonCount] = useState(0);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  const pwa = usePWA(user?.uid ?? null);
  const theme = useTheme();

  // Register SW + listen for foreground FCM messages once user is approved
  useEffect(() => {
    if (!appUser || appUser.status !== 'Approved') return;
    return onForegroundMessage((payload: any) => {
      const title = payload?.notification?.title ?? 'ETaske';
      const body = payload?.notification?.body ?? '';
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/favicon.png' });
      }
    });
  }, [appUser]);

  // Auth setup
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const snap = await getDoc(userRef);
          const isAdmin = currentUser.email === 'tarekmoh123@gmail.com';
          if (!snap.exists()) {
            await setDoc(userRef, {
              displayName: currentUser.displayName || 'Unknown User',
              email: currentUser.email || '',
              photoURL: currentUser.photoURL || '',
              status: isAdmin ? 'Approved' : 'Pending',
              role: isAdmin ? 'Admin' : 'Employee',
              lastSeen: serverTimestamp(),
            });
          } else {
            await updateDoc(userRef, {
              // Stored name wins: a user's custom name (set in UsernameSetupScreen)
              // must not be reverted to their auth-provider name on every login.
              displayName: snap.data().displayName || currentUser.displayName || 'Unknown User',
              photoURL: currentUser.photoURL || snap.data().photoURL || '',
              ...(isAdmin && snap.data().role !== 'Admin' ? { role: 'Admin', status: 'Approved' } : {}),
              lastSeen: serverTimestamp(),
            });
          }
        } catch (err) { console.error('User setup error:', err); }
      } else {
        setIsAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Live user profile
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) setAppUser({ id: snap.id, ...snap.data() } as AppUser);
        setIsAuthReady(true);
      },
      (err) => {
        console.error('User profile listener error:', err.code);
        setIsAuthReady(true); // Still mark ready so we don't hang on spinner
      }
    );
    return () => unsub();
  }, [user]);

  // All approved users (for assignment UI)
  useEffect(() => {
    if (!user || !appUser || appUser.status !== 'Approved') return;
    const unsub = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        setProjectUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as AppUser)));
      },
      (err) => console.warn('Users listener error:', err.code)
    );
    return () => unsub();
  }, [user, appUser]);

  // Notifications for current user
  useEffect(() => {
    if (!user || !appUser || appUser.status !== 'Approved') return;

    const q = query(
      collection(db, 'notifications'),
      where('forUserId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    let isInitialLoad = true;

    const unsub = onSnapshot(
      q,
      (snap) => {
        setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() } as AppNotification)));

        if (!isInitialLoad && "Notification" in window && Notification.permission === "granted") {
          snap.docChanges().forEach(change => {
            if (change.type === 'added') {
              const data = change.doc.data() as AppNotification;
              if (!data.read) {
                new Notification(data.title, { body: data.message });
              }
            }
          });
        }
        isInitialLoad = false;
      },
      (err) => console.warn('Notifications listener error:', err.code)
    );
    return () => unsub();
  }, [user, appUser]);

  // Alerting system: items due within 48h
  useEffect(() => {
    if (!user || !appUser || appUser.status !== 'Approved') return;
    
    let taskCount = 0;
    let corrCount = 0;

    const checkDueSoon = (items: any[], dateField: string) => {
      return items.filter(item => {
        if (['Done', 'Closed', 'Archived'].includes(item.status)) return false;
        const dateValue = dateField === 'dueDate' ? item.dueDate : item.deadline;
        return isOverdue(dateValue) || isDueSoon(dateValue);
      }).length;
    };

    const unsubT = onSnapshot(collection(db, 'tasks'), snap => {
      taskCount = checkDueSoon(snap.docs.filter(d => d.id !== '--stats--').map(d => d.data()), 'dueDate');
      setDueSoonCount(taskCount + corrCount);
    });

    const unsubC = onSnapshot(collection(db, 'correspondences'), snap => {
      corrCount = checkDueSoon(snap.docs.filter(d => d.id !== '--stats--').map(d => d.data()), 'deadline');
      setDueSoonCount(taskCount + corrCount);
    });

    return () => {
      unsubT();
      unsubC();
    };
  }, [user, appUser]);

  // Presence heartbeat: keep our own lastSeen fresh while the tab is open so
  // other users get an accurate "last seen" in chat. Rules allow a self-update
  // that doesn't touch role/status, so this needs no rule change.
  useEffect(() => {
    if (!user || !appUser || appUser.status !== 'Approved') return;
    const ref = doc(db, 'users', user.uid);
    const beat = () => {
      if (document.visibilityState === 'visible') {
        updateDoc(ref, { lastSeen: serverTimestamp() }).catch(() => {});
      }
    };
    beat();
    const interval = setInterval(beat, 60_000);
    document.addEventListener('visibilitychange', beat);
    window.addEventListener('focus', beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', beat);
      window.removeEventListener('focus', beat);
    };
  }, [user, appUser?.status]);

  // Department announcements (single equality filter -> no composite index;
  // sorted client-side). Empty/None department -> no feed.
  useEffect(() => {
    if (!user || !appUser || appUser.status !== 'Approved') return;
    const dept = (appUser.department || '').trim();
    if (!dept || dept === 'None') {
      setAnnouncements([]);
      return;
    }
    const q = query(collection(db, 'announcements'), where('department', '==', dept));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as Announcement));
        rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setAnnouncements(rows);
      },
      (err) => console.warn('Announcements listener error:', err.code)
    );
    return () => unsub();
  }, [user, appUser?.status, appUser?.department]);

  // Default view by role
  useEffect(() => {
    if (!appUser) return;
    if (appUser.role === 'Manager' || appUser.role === 'Admin') {
      setActiveView('overview');
    } else {
      setActiveView('tasks');
    }
  }, [appUser?.role]);

  const handleLogout = () => signOut(auth);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="spinner" style={{ width: 32, height: 32 }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{'Loading ETaske…'}</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;
  if (!appUser) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
      <div className="spinner" />
    </div>
  );

  if (appUser.displayName === 'Unknown User' || !appUser.displayName) {
    return (
      <UsernameSetupScreen
        onSave={async (name, phone) => {
          await updateDoc(doc(db, 'users', user.uid), { displayName: name, phoneNumber: phone });
        }}
      />
    );
  }

  if (appUser.status === 'Pending') return <PendingScreen />;
  if (appUser.status === 'Rejected') return <RejectedScreen />;

  const unreadAnnouncements = announcements.filter(a => {
    if (a.authorId === appUser.id || (a.readBy || []).includes(appUser.id)) return false;
    const rids = a.recipientIds || [];
    return rids.length === 0 || rids.includes(appUser.id); // targeted -> only recipients
  }).length;

  const sharedProps = { user, appUser, projectUsers };

  return (
    <div className="app-shell">
      <TopNav
        appUser={appUser}
        activeView={activeView}
        onNavigate={setActiveView}
        notifications={notifications}
        dueSoonCount={dueSoonCount}
        announcementCount={unreadAnnouncements}
        onLogout={handleLogout}
        pwa={pwa}
        isDark={theme.isDark}
        onToggleTheme={theme.toggle}
      />
      <main className="main-content">
        {activeView === 'overview' && (appUser.role === 'Admin' || appUser.role === 'Manager') && (
          <OverviewDashboard user={user} appUser={appUser} projectUsers={projectUsers} />
        )}
        {activeView === 'correspondences' && (
          <CorrespondingsDashboard user={user} appUser={appUser} projectUsers={projectUsers} onNavigate={setActiveView} />
        )}
        {activeView === 'manager-inbox' && (
          <ManagerInbox user={user} appUser={appUser} projectUsers={projectUsers} onNavigate={setActiveView} />
        )}
        {activeView === 'tasks' && (
          <TasksDashboard user={user} appUser={appUser} projectUsers={projectUsers} />
        )}
        {activeView === 'archive' && (
          <ArchiveDashboard user={user} appUser={appUser} projectUsers={projectUsers} />
        )}
        {activeView === 'due-soon' && (
          <DueSoonDashboard user={user} appUser={appUser} projectUsers={projectUsers} onNavigate={setActiveView} />
        )}
        {activeView === 'announcements' && (
          <Announcements
            appUser={appUser}
            announcements={announcements}
            projectUsers={projectUsers}
          />
        )}
        {activeView === 'admin' && (appUser.role === 'Admin') && (
          <AdminDashboard users={projectUsers} />
        )}
        {activeView === 'outlook-feed' && (
          <OutlookFeed user={user} appUser={appUser} projectUsers={projectUsers} />
        )}
      </main>

      {/* Mobile Bottom Navigation — limited to core tabs, plus a More menu. */}
      <nav className="bottom-nav">
        {([
          { id: 'tasks',           label: 'Tasks',           icon: <CheckSquare />, show: true },
          { id: 'correspondences', label: 'Letters',         icon: <MailOpen />,    show: true },
          { id: 'manager-inbox',   label: 'Inbox',           icon: <Inbox />,       show: true },
        ] as { id: AppView; label: string; icon: React.ReactNode; show: boolean }[])
          .filter(item => item.show)
          .map(item => (
            <button
              key={item.id}
              className={`bottom-tab${activeView === item.id && !showMoreMenu ? ' active' : ''}`}
              onClick={() => { setActiveView(item.id); setShowMoreMenu(false); }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
          <button
            className={`bottom-tab${showMoreMenu ? ' active' : ''}`}
            onClick={() => setShowMoreMenu(!showMoreMenu)}
          >
            <MoreHorizontal />
            <span>{'More'}</span>
          </button>
      </nav>

      {/* More Menu Bottom Sheet */}
      {showMoreMenu && (
        <>
          <div 
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 90 }}
            onClick={() => setShowMoreMenu(false)}
          />
          <div style={{
            position: 'fixed', bottom: 'calc(var(--bottomnav-h) + var(--safe-area-bottom))', left: 0, right: 0,
            background: 'var(--surface)', borderRadius: '16px 16px 0 0', borderTop: '1px solid var(--border)',
            padding: 16, zIndex: 95, boxShadow: '0 -4px 20px rgba(0,0,0,0.12)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{'More Options'}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowMoreMenu(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {([
                { id: 'overview',        label: 'Overview',        icon: <BarChart3 />,   show: appUser.role === 'Admin' || appUser.role === 'Manager' },
                { id: 'announcements',   label: 'News',            icon: <Megaphone />,   show: true },
                { id: 'archive',         label: 'Archive',         icon: <Archive />,     show: true },
                { id: 'outlook-feed',    label: 'Outlook',         icon: <Mail />,        show: true },
                { id: 'admin',           label: 'Users',           icon: <Users />,       show: appUser.role === 'Admin' },
              ] as { id: AppView; label: string; icon: React.ReactNode; show: boolean }[])
                .filter(item => item.show)
                .map(item => (
                  <button
                    key={item.id}
                    onClick={() => { setActiveView(item.id); setShowMoreMenu(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: 12,
                      background: activeView === item.id ? 'var(--blue-50)' : 'var(--surface-2)',
                      border: '1px solid var(--border)', borderRadius: 8,
                      color: activeView === item.id ? 'var(--blue-600)' : 'var(--text-primary)',
                      fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer'
                    }}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
            </div>
          </div>
        </>
      )}

      {/* Real-time Chat */}
      <ChatBox currentUser={appUser} allUsers={projectUsers} onNavigate={setActiveView} />

      {/* Soft re-sync after a long idle gap (no hard reload) */}
      <IdleResyncBanner />
    </div>
  );
}
