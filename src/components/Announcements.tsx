import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { pushAnnouncement } from '../lib/pushNotification';
import { AppUser, Announcement } from '../types';
import { timeAgo } from '../utils';
import { Megaphone, Send, Trash2, Users } from 'lucide-react';

interface Props {
  appUser: AppUser;
  /** Already filtered to the user's department and sorted newest-first by App. */
  announcements: Announcement[];
  projectUsers: AppUser[];
}

function SeenByBadge({ seenCount, reach, readByIds, userById }: {
  seenCount: number;
  reach: number;
  readByIds: string[];
  userById: Map<string, AppUser>;
}) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const seenUsers = readByIds.map(id => userById.get(id)).filter(Boolean) as AppUser[];

  return (
    <div
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'default' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <Users className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Seen by {seenCount} of {reach}
      </span>
      {show && seenUsers.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: 0,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '8px 10px',
          minWidth: 180,
          width: 'max-content',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          pointerEvents: 'none',
          zIndex: 9999,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
            Seen by
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {seenUsers.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                {u.photoURL ? (
                  <img
                    src={u.photoURL}
                    referrerPolicy="no-referrer"
                    alt=""
                    style={{ width: 18, height: 18, borderRadius: 0, objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <div style={{
                    width: 18, height: 18, flexShrink: 0,
                    background: u.userColor || 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 800, fontSize: 10,
                  }}>
                    {u.displayName?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {u.displayName || u.email}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Announcements({ appUser, announcements, projectUsers }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // Selected recipient uids. Empty => broadcast to the whole department.
  const [recipientIds, setRecipientIds] = useState<string[]>([]);

  const department = (appUser.department || '').trim();
  const hasDept = !!department && department !== 'None';

  const teammates = useMemo(
    () => projectUsers.filter(
      u => u.status === 'Approved' && (u.department || '').trim() === department
    ),
    [projectUsers, department]
  );

  // Teammates I can target (everyone in the dept except me).
  const selectable = useMemo(
    () => teammates.filter(u => u.id !== appUser.id),
    [teammates, appUser.id]
  );

  const userById = useMemo(() => {
    const m = new Map<string, AppUser>();
    projectUsers.forEach(u => m.set(u.id, u));
    return m;
  }, [projectUsers]);

  const toggleRecipient = (id: string) =>
    setRecipientIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

  const targeted = recipientIds.length > 0;

  // Only show targeted announcements to the author or a listed recipient.
  // (A manager/admin still sees ones they authored; per-record reach is
  // intentionally client-side, consistent with department scoping.)
  const visible = useMemo(
    () => announcements.filter(a => {
      const rids = a.recipientIds || [];
      if (rids.length === 0) return true;                 // dept-wide
      return a.authorId === appUser.id || rids.includes(appUser.id);
    }),
    [announcements, appUser.id]
  );

  // Mark every announcement I haven't seen (and didn't write) as read.
  const markedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    visible.forEach(a => {
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
  }, [visible, appUser.id]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !hasDept || sending) return;
    setSending(true);
    setError('');
    try {
      // Only send valid, still-in-department recipient uids.
      const validRecipients = recipientIds.filter(id =>
        selectable.some(u => u.id === id)
      );
      await addDoc(collection(db, 'announcements'), {
        text: body,
        department,
        recipientIds: validRecipients,
        authorId: appUser.id,
        authorName: appUser.displayName,
        authorPhotoURL: appUser.photoURL || '',
        authorColor: appUser.userColor || '',
        readBy: [appUser.id],
        createdAt: serverTimestamp(),
      });

      // Push notification to recipients (fire-and-forget)
      const targets = validRecipients.length > 0
        ? selectable.filter(u => validRecipients.includes(u.id) && u.id !== appUser.id)
        : selectable.filter(u => u.id !== appUser.id);
      pushAnnouncement(targets, appUser.displayName, body);

      setText('');
      setRecipientIds([]);
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
          {/* Recipient picker — none selected = whole department */}
          {selectable.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <Users className="w-3.5 h-3.5" />
                {targeted
                  ? `Sending to ${recipientIds.length} selected`
                  : `Everyone in ${department}`}
                {targeted && (
                  <button
                    type="button"
                    onClick={() => setRecipientIds([])}
                    style={{
                      marginLeft: 4, fontSize: 11, fontWeight: 600, padding: 0,
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--accent)', textTransform: 'none', letterSpacing: 0,
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {selectable.map(u => {
                  const on = recipientIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleRecipient(u.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '5px 10px', fontSize: 12, fontWeight: 600,
                        cursor: 'pointer',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                        background: on ? 'var(--accent)' : 'var(--surface-2)',
                        color: on ? '#fff' : 'var(--text-secondary)',
                      }}
                    >
                      <span style={{
                        width: 18, height: 18, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: on ? 'rgba(255,255,255,0.25)' : (u.userColor || 'var(--accent)'),
                        color: '#fff', fontSize: 10, fontWeight: 800,
                      }}>
                        {u.displayName?.[0]?.toUpperCase() || '?'}
                      </span>
                      {u.displayName}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {error
                ? <span style={{ color: '#dc2626', fontWeight: 600 }}>{error}</span>
                : targeted
                  ? 'Ctrl/⌘ + Enter to send · only selected members are notified'
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
        {visible.length === 0 ? (
          <div className="card" style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Megaphone className="w-8 h-8" style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p style={{ fontSize: 14 }}>No announcements yet.</p>
            {hasDept && <p style={{ fontSize: 12, marginTop: 4 }}>Be the first to post to {department}.</p>}
          </div>
        ) : (
          visible.map(a => {
            const rids = a.recipientIds || [];
            const isTargeted = rids.length > 0;
            const seenCount = (a.readBy || []).length;
            const reach = isTargeted ? rids.length + 1 : (teammates.length || seenCount);
            const mine = a.authorId === appUser.id;
            const recipientUsers = rids
              .map(id => userById.get(id))
              .filter(Boolean) as AppUser[];
            return (
              <div key={a.id} className="card" style={{ padding: 16, overflow: 'visible' }}>
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
                      <div style={{ marginTop: 8 }}>
                        <SeenByBadge
                          seenCount={seenCount}
                          reach={reach}
                          readByIds={a.readBy || []}
                          userById={userById}
                        />
                      </div>
                    )}
                    {isTargeted && (
                      <div style={{
                        marginTop: 14, paddingTop: 14,
                        borderTop: '1px solid var(--border)',
                      }}>
                        <div style={{
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                          letterSpacing: '0.04em', color: 'var(--text-muted)',
                          marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                          <Users className="w-3 h-3" />
                          {mine ? 'Sent to' : 'Sent to you'}
                        </div>
                        {recipientUsers.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                            {recipientUsers.map(u => (
                              <span
                                key={u.id}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 8,
                                  padding: '5px 12px 5px 5px', fontSize: 12, fontWeight: 600,
                                  background: 'var(--surface-2)',
                                  color: 'var(--text-secondary)',
                                  border: '1px solid var(--border)',
                                }}
                              >
                                {u.photoURL ? (
                                  <img
                                    src={u.photoURL}
                                    referrerPolicy="no-referrer"
                                    alt=""
                                    style={{ width: 22, height: 22, objectFit: 'cover', flexShrink: 0 }}
                                  />
                                ) : (
                                  <span style={{
                                    width: 22, height: 22, flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: u.userColor || 'var(--accent)',
                                    color: '#fff', fontSize: 10, fontWeight: 800,
                                  }}>
                                    {u.displayName?.[0]?.toUpperCase() || '?'}
                                  </span>
                                )}
                                {u.displayName}
                              </span>
                            ))}
                          </div>
                        )}
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
