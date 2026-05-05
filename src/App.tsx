import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { AppUser } from './types';
import LoginScreen from './LoginScreen';
import PendingScreen from './PendingScreen';
import RejectedScreen from './RejectedScreen';
import AdminDashboard from './AdminDashboard';
import TaskDashboard from './TaskDashboard';
import UsernameSetupScreen from './UsernameSetupScreen';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [projectUsers, setProjectUsers] = useState<AppUser[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [currentHash, setCurrentHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const snap = await getDoc(userRef);
          
          if (!snap.exists()) {
            const isAdmin = currentUser.email === 'tarekmoh123@gmail.com';
            await setDoc(userRef, {
              displayName: currentUser.displayName || 'Unknown User',
              email: currentUser.email || '',
              photoURL: currentUser.photoURL || '',
              status: isAdmin ? 'Approved' : 'Pending',
              role: isAdmin ? 'Admin' : 'Member',
              lastSeen: serverTimestamp()
            });
          } else {
            const data = snap.data();
            const isAdmin = currentUser.email === 'tarekmoh123@gmail.com';
            await updateDoc(userRef, {
              displayName: currentUser.displayName || data.displayName || 'Unknown User',
              photoURL: currentUser.photoURL || data.photoURL || '',
              ...(isAdmin && data.role !== 'Admin' ? { role: 'Admin', status: 'Approved' } : {}),
              lastSeen: serverTimestamp()
            });
          }
        } catch (err) {
          console.error("Error setting up user:", err);
        }
      } else {
        setIsAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        setAppUser({ id: snap.id, ...snap.data() } as AppUser);
      }
      setIsAuthReady(true); // only mark ready once user data is loaded
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || !appUser || (appUser.status !== 'Approved' && appUser.role !== 'Admin')) return;
    
    // Only load all users if we are approved (or admin). Let everyone load them so they can be assigned tasks?
    // The rules say: `allow read: if isOwner(userId) || isAdmin() || isApproved()`
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      setProjectUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AppUser)));
    });
    return () => unsubscribe();
  }, [user, appUser]);

  const handleLogout = () => {
    signOut(auth);
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="animate-pulse text-neutral-400 font-medium">Loading Application...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (!appUser) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="animate-pulse text-neutral-400 font-medium">Loading Profile...</div>
      </div>
    );
  }

  if (appUser.displayName === 'Unknown User' || !appUser.displayName) {
    return (
      <UsernameSetupScreen 
        onSave={async (newName) => {
          const userRef = doc(db, 'users', user.uid);
          await updateDoc(userRef, { displayName: newName });
        }}
      />
    );
  }

  if (appUser.status === 'Pending') {
    return <PendingScreen />;
  }

  if (appUser.status === 'Rejected') {
    return <RejectedScreen />;
  }

  // If the user is an Admin, they can view either the Admin Dashboard or the App 
  // Let's just create a toggle for Admin or just show TaskDashboard by default, with Admin link, but wait: 
  // "create an admin page to approve each login, and assign it to teams"
  // For simplicity, if they are Admin, we could let them choose. But let's build it so AdminDashboard handles users, and maybe a nav bar to switch.
  
  if (appUser.role === 'Admin' && currentHash === '#admin') {
    return (
      <div className="min-h-screen bg-neutral-50">
        <header className="bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between sticky top-0">
          <div className="flex items-center gap-4">
            <h1 className="font-bold text-lg">Admin View</h1>
            <a href="#" className="text-blue-600 text-sm hover:underline">Go to Tasks</a>
          </div>
          <button onClick={handleLogout} className="text-sm font-medium text-neutral-500 hover:text-neutral-900">Logout</button>
        </header>
        <AdminDashboard users={projectUsers} />
      </div>
    );
  }

  return (
    <div>
      {appUser.role === 'Admin' && (
        <div className="bg-neutral-900 text-white text-xs font-semibold px-4 py-2 flex items-center justify-between">
          <span>Admin Controls</span>
          <a href="#admin" className="text-blue-300 hover:underline">Go to Admin Dashboard &rarr;</a>
        </div>
      )}
      <TaskDashboard 
        user={user} 
        appUser={appUser} 
        projectUsers={projectUsers} 
        onLogout={handleLogout} 
      />
    </div>
  );
}
