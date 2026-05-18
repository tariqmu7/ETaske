import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AppUser, Announcement } from '../types';
import { timeAgo } from '../utils';
import { Megaphone, Send, Trash2, Users } from 'lucide-react';

interface Props {
  appUser: AppUser;
  /** Already filtered to the user's department and sorted newest-first by App. */
  announcements: Announcement[];
  projectUsers: AppUser[];
}

export default function Announcements({ appUser, announcements, projectUsers }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const department = (appUser.department || '').trim();
  const hasDept = !!department && department !== 'None';

  const teammates = useMemo(
    () => projectUsers.filter(
      u => u.status === 'Approved' && (u.department || '').trim() === department
    ),
    [projectUsers, department]
  );

  // Mark every announcement I haven't seen (and didn't write) as read.
  const markedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    announcements.forEach(a => {
      if (
        a.authorId !== appUser.id &&
        !(a.readBy || []).includes(appUser.id) &&
        !markedRef.current.has(a.id)
      ) {
        markedRef.current.add(a.id);
        updateDoc(doc(db, 'announcements', a.id), {
          readBy: arrayUnion(appUser.id),
        }).catch(err => {
          markedRef.current.delete(a.id);
          console.warn('Announcement mark-read failed:', err?.code || err);
        });
      }
    });
  }, [announcements, appUser.id]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !hasDept || sending) return;
    setSending(true);
    setError('');
    try {
      await addDoc(collection(db, 'announcements'), {
        text: body,
        department,
        authorId: appUser.id,
        authorName: appUser.displayName,
        authorPhotoURL: appUser.photoURL || '',
        authorColor: appUser.userColor || '',
        readBy: [appUser.id],
        createdAt: serverTimestamp(),
      });
      setText('');
    } catch (err: any) {
      console.error('Send announcement failed:', err);
      setError('Could not send. Check your connection and permissions.');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (a: Announcement) => {
    if (!window.confirm('Delete this announcement for everyone?')) return;
    try {
      await deleteDoc(doc(db, 'announcements', a.id));
    } catch (err) {
      console.error('Delete announcement failed:', err);
      alert('Could not delete.');
    }
  };

  const canManage = (a: Announcement) =>
    a.authorId === appUser.id || appUser.role === 'Admin' || appUser.role === 'Manager';

  return (
    <div style={{ padding: '4px 0', minHeight: '60vh', maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 0, background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Megaphone className="w-5 h-5" style={{ color: '#fff' }} />
        </div>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            Announcements
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            {hasDept ? (
              <>
                <Users className="w-3.5 h-3.5" />
                Broadcast to <strong style={{ color: 'var(--text-secondary)' }}>{department}</strong>
                {teammates.length > 0 && ` · ${teammates.length} member${teammates.length === 1 ? '' : 's'}`}
              </>
            ) : (
              'You are not assigned to a department yet.'
            )}
          </p>
        </div>
      </div>

      {/* Composer */}
      {hasDept ? (
        <form onSubmit={handleSend} className="card" style={{ padding: 16, marginBottom: 24 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={`Share something with the ${department} team…`}
            rows={3}
            className="input"
            style={{ width: '100%', resize: 'vertical', fontSize: 14, lineHeight: 1.5 }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend(e as any);
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {error
                ? <span style={{ color: '#dc2626', fontWeight: 600 }}>{error}</span>
                : 'Ctrl/⌘ + Enter to send · everyone in your department is notified'}
            </span>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!text.trim() || sending}
            >
              <Send className="w-3.5 h-3.5" /> {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      ) : (
        <div className="card" style={{ padding: 20, marginBottom: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Ask an admin to set your department before you can post or receive announcements.
        </div>
      )}

      {/* Feed */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {announcements.length === 0 ? (
          <div className="card" style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Megaphone className="w-8 h-8" style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p style={{ fontSize: 14 }}>No announcements yet.</p>
            {hasDept && <p style={{ fontSize: 12, marginTop: 4 }}>Be the first to post to {department}.</p>}
          </div>
        ) : (
          announcements.map(a => {
            const seenCount = (a.readBy || []).length;
            const mine = a.authorId === appUser.id;
            return (
              <div key={a.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {a.authorPhotoURL ? (
                    <img
                      src={a.authorPhotoURL}
                      referrerPolicy="no-referrer"
                      alt=""
                      style={{ width: 36, height: 36, borderRadius: 0, objectFit: 'cover', flexShrink: 0 }}
                    />
                  ) : (
                    <div style={{
                      width: 36, height: 36, borderRadius: 0, flexShrink: 0,
                      background: a.authorColor || 'var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 800, fontSize: 14,
                    }}>
                      {a.authorName?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                        {mine ? 'You' : a.authorName}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {a.createdAt ? timeAgo(a.createdAt) : 'just now'}
                      </span>
                    </div>
                    <p style={{
                      fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55,
                      marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {a.text}
                    </p>
                    {mine && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Users className="w-3 h-3" />
                        Seen by {seenCount} of {teammates.length || seenCount}
                      </div>
                    )}
                  </div>
                  {canManage(a) && (
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      title="Delete announcement"
                      onClick={() => handleDelete(a)}
                    >
                      <Trash2 className="w-3.5 h-3.5" style={{ color: '#dc2626' }} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
