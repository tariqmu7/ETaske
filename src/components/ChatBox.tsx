import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, serverTimestamp, Timestamp, limit,
  updateDoc, doc
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { subscribeVisibleTasks } from '../lib/taskVisibility';
import { AppUser, ChatMessage, Task, Corresponding } from '../types';
import { timeAgo, globalSearch } from '../utils';
import { requestOpen } from '../lib/deepLink';
import { AppView } from '../App';
import {
  MessageSquare, Send, X, Search, User as UserIcon,
  ChevronLeft, Minus, Check, CheckCheck, Smile, Link2,
  CheckSquare, FileText
} from 'lucide-react';

// Online if the user's lastSeen heartbeat is within the last 2 minutes.
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const presenceOf = (u?: AppUser | null) => {
  const ms = u?.lastSeen?.toDate?.()?.getTime?.();
  if (!ms) return { online: false, label: 'Offline' };
  if (Date.now() - ms < ONLINE_WINDOW_MS) return { online: true, label: 'Active now' };
  return { online: false, label: `Last seen ${timeAgo(ms)}` };
};
import { motion, AnimatePresence } from 'motion/react';

// Curated emoji set — kept inline (no extra dependency) per the project's
// "no component library" convention.
const EMOJIS = [
  '😀','😄','😁','😉','😊','🙂','😍','😘','😎','🤩',
  '🤔','😅','😂','🤣','😭','😢','😡','😴','🤝','🙏',
  '👍','👎','👏','🙌','💪','✅','❌','⚠️','🔥','⭐',
  '🎉','🎯','📌','📎','📅','⏰','💡','📝','🚀','❤️',
];

const CONVO_KEY = (uid: string) => `etaske:convoActivity:${uid}`;
const tsToMs = (t?: Timestamp | null) => t?.toDate?.()?.getTime?.() ?? 0;

interface ChatBoxProps {
  currentUser: AppUser;
  allUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

export default function ChatBox({ currentUser, allUsers, onNavigate }: ChatBoxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadMessages, setUnreadMessages] = useState<ChatMessage[]>([]);
  const [showNotification, setShowNotification] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Emoji + share-attachment UI state
  const [showEmoji, setShowEmoji] = useState(false);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [shareTab, setShareTab] = useState<'task' | 'corresponding'>('task');
  const [shareSearch, setShareSearch] = useState('');
  const [shareTasks, setShareTasks] = useState<Task[]>([]);
  const [shareCorr, setShareCorr] = useState<Corresponding[]>([]);
  const [pendingAttach, setPendingAttach] = useState<
    { refType: 'task' | 'corresponding'; refId: string; refLabel: string; refSerial: string } | null
  >(null);

  // Per-conversation last-activity map (peerId -> ms), persisted so the most
  // recently active chats stay at the top across reloads.
  const [convoActivity, setConvoActivity] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(CONVO_KEY(currentUser.id));
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const bumpActivity = (peerId: string, ms: number) => {
    if (!peerId || !ms) return;
    setConvoActivity(prev => {
      if ((prev[peerId] || 0) >= ms) return prev;
      const next = { ...prev, [peerId]: ms };
      try { localStorage.setItem(CONVO_KEY(currentUser.id), JSON.stringify(next)); } catch { /* ignore quota */ }
      return next;
    });
  };

  // Re-render every 30s so "Active now" decays to "Last seen …" even when no
  // new snapshot arrives (the other user simply stopped heart-beating).
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => setNowTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, [isOpen]);

  const otherUsers = allUsers.filter(u => u.id !== currentUser.id && u.status === 'Approved');
  // Always read presence from the live users list, not the stale click-time copy.
  const liveSelectedUser = selectedUser
    ? allUsers.find(u => u.id === selectedUser.id) || selectedUser
    : null;
  const presence = presenceOf(liveSelectedUser);
  // Index of my most recent message — only it carries the seen/sent receipt.
  let lastMineIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].senderId === currentUser.id) { lastMineIdx = i; break; }
  }

  // Unread count per peer (drives both the badge and the ordering).
  const unreadByUser = useMemo(() => {
    const m: Record<string, number> = {};
    unreadMessages.forEach(msg => { m[msg.senderId] = (m[msg.senderId] || 0) + 1; });
    return m;
  }, [unreadMessages]);

  // Unread first, then most-recently-active conversations, then the rest A→Z.
  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return otherUsers
      .filter(u =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const ua = unreadByUser[a.id] || 0;
        const ub = unreadByUser[b.id] || 0;
        if ((ua > 0) !== (ub > 0)) return ua > 0 ? -1 : 1;
        const la = convoActivity[a.id] || 0;
        const lb = convoActivity[b.id] || 0;
        if (la !== lb) return lb - la;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [otherUsers, searchQuery, unreadByUser, convoActivity]);

  // Scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen && selectedUser) {
      scrollToBottom();
    }
  }, [messages, isOpen, selectedUser]);

  // Listen to messages
  useEffect(() => {
    if (!selectedUser) {
      setMessages([]);
      return;
    }

    const participants = [currentUser.id, selectedUser.id].sort();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const q = query(
      collection(db, 'messages'),
      where('participants', '==', participants),
      where('createdAt', '>=', Timestamp.fromDate(oneWeekAgo)),
      orderBy('createdAt', 'asc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
      setMessages(rows);
      // Keep the open conversation at the top of the list (covers messages I
      // sent too, not just ones I received).
      const last = rows[rows.length - 1];
      if (last) bumpActivity(selectedUser.id, tsToMs(last.createdAt) || Date.now());
    });

    return () => unsub();
  }, [selectedUser, currentUser.id]);

  // Listen for ALL unread messages for this user
  const lastNotifIdRef = useRef<string | null>(null);
  const isOpenRef = useRef(isOpen);
  const selectedUserRef = useRef(selectedUser);
  isOpenRef.current = isOpen;
  selectedUserRef.current = selectedUser;

  useEffect(() => {
    const q = query(
      collection(db, 'messages'),
      where('receiverId', '==', currentUser.id),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsub = onSnapshot(q, (snap) => {
      const allMessages = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
      const unread = allMessages.filter(m => m.read === false);
      setUnreadMessages(unread);

      // Recency: bubble up whoever messaged me most recently.
      allMessages.forEach(m => bumpActivity(m.senderId, tsToMs(m.createdAt)));

      if (unread.length > 0) {
        const latest = unread[0];
        if (latest.id !== lastNotifIdRef.current && (!isOpenRef.current || selectedUserRef.current?.id !== latest.senderId)) {
          lastNotifIdRef.current = latest.id;
          setShowNotification(true);
          setTimeout(() => setShowNotification(false), 5000);
        }
      }
    }, (error) => {
      console.warn("Unread messages listener error:", error.code || error.message);
    });

    return () => unsub();
  }, [currentUser.id]);

  // Share picker data — only subscribed while the picker is open.
  // Privacy-aware: only tasks this user may share (public + own).
  useEffect(() => {
    if (!sharePickerOpen) return;
    const unsubT = subscribeVisibleTasks(currentUser.id,
      rows => setShareTasks(rows),
      err => console.warn('Share picker tasks error:', err?.code));
    const unsubC = onSnapshot(collection(db, 'correspondences'), snap => {
      setShareCorr(snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Corresponding)));
    }, err => console.warn('Share picker correspondences error:', err.code));
    return () => { unsubT(); unsubC(); };
  }, [sharePickerOpen, currentUser.id]);

  // Mark messages as read when viewing them
  const markingRef = useRef(new Set<string>());
  useEffect(() => {
    if (isOpen && selectedUser) {
      const unreadFromThisUser = unreadMessages.filter(m => m.senderId === selectedUser.id && !markingRef.current.has(m.id));
      unreadFromThisUser.forEach(async (msg) => {
        markingRef.current.add(msg.id);
        try {
          await updateDoc(doc(db, 'messages', msg.id), { read: true, readAt: serverTimestamp() });
        } catch (err) {
          console.warn("Error marking as read:", err);
          markingRef.current.delete(msg.id);
        }
      });
    }
  }, [isOpen, selectedUser, unreadMessages]);

  const openConversation = (u: AppUser) => {
    setSelectedUser(u);
    setShowEmoji(false);
    setSharePickerOpen(false);
    bumpActivity(u.id, Date.now());
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (el && typeof el.selectionStart === 'number') {
      const start = el.selectionStart;
      const end = el.selectionEnd ?? start;
      setNewMessage(prev => prev.slice(0, start) + emoji + prev.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        const caret = start + emoji.length;
        el.setSelectionRange(caret, caret);
      });
    } else {
      setNewMessage(prev => prev + emoji);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !pendingAttach) || !selectedUser) return;

    const participants = [currentUser.id, selectedUser.id].sort();
    const messageData: Record<string, unknown> = {
      senderId: currentUser.id,
      receiverId: selectedUser.id,
      text: newMessage.trim(),
      createdAt: serverTimestamp(),
      participants: participants,
      read: false,
    };
    if (pendingAttach) {
      messageData.refType = pendingAttach.refType;
      messageData.refId = pendingAttach.refId;
      messageData.refLabel = pendingAttach.refLabel;
      messageData.refSerial = pendingAttach.refSerial;
    }

    setNewMessage('');
    setPendingAttach(null);
    setShowEmoji(false);
    bumpActivity(selectedUser.id, Date.now());
    try {
      await addDoc(collection(db, 'messages'), messageData);
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  // Jump to the shared task/correspondence: switch view, hand the id to the
  // target dashboard, and minimise the chat so it isn't covering the item.
  const openRef = (msg: ChatMessage) => {
    if (!msg.refType || !msg.refId) return;
    requestOpen({ type: msg.refType, id: msg.refId });
    onNavigate(msg.refType === 'task' ? 'tasks' : 'correspondences');
    setIsOpen(false);
  };

  const previewText = (m: ChatMessage) =>
    m.text?.trim()
      ? m.text
      : m.refType === 'task'
        ? `📎 Shared task ${m.refSerial || ''}`.trim()
        : m.refType === 'corresponding'
          ? `📎 Shared correspondence ${m.refSerial || ''}`.trim()
          : '';

  const shareList = shareTab === 'task'
    ? shareTasks
        .filter(t => t.status !== 'Archived')
        .filter(t => !shareSearch || globalSearch(t, shareSearch))
        .slice(0, 50)
    : shareCorr
        .filter(c => !shareSearch || globalSearch(c, shareSearch))
        .slice(0, 50);

  return (
    <div className="chat-fab-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="chat-panel"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            style={{
              width: 360,
              height: 500,
              background: 'var(--surface)',
              borderRadius: 16,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              marginBottom: 16,
              position: 'relative'
            }}
          >
            {/* Header */}
            <div style={{
              padding: '16px',
              background: 'var(--blue-600)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {selectedUser ? (
                  <>
                    <button
                      onClick={() => setSelectedUser(null)}
                      style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', padding: 4 }}
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {selectedUser.photoURL ? (
                        <img src={selectedUser.photoURL} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                      ) : (
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <UserIcon size={16} />
                        </div>
                      )}
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedUser.displayName}</div>
                        <div style={{ fontSize: 10, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{
                            width: 7, height: 7, borderRadius: '50%',
                            background: presence.online ? '#22c55e' : 'rgba(255,255,255,0.5)',
                            display: 'inline-block', flexShrink: 0,
                          }} />
                          {presence.label}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <MessageSquare size={20} />
                    <span style={{ fontWeight: 700 }}>Messages</span>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setIsOpen(false)}
                  style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', padding: 4 }}
                >
                  <Minus size={18} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'hidden', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {!selectedUser ? (
                /* User List */
                <div style={{ padding: 16, overflowY: 'auto', flex: 1, minHeight: 0 }}>
                  <div style={{ position: 'relative', marginBottom: 16 }}>
                    <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} size={16} />
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px 10px 40px',
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text-primary)',
                        fontSize: 14,
                        outline: 'none'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {filteredUsers.length > 0 ? (
                      filteredUsers.map(u => {
                        const userUnreadCount = unreadByUser[u.id] || 0;
                        return (
                          <button
                            key={u.id}
                            onClick={() => openConversation(u)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              padding: 12,
                              borderRadius: 12,
                              border: 'none',
                              background: userUnreadCount > 0 ? 'var(--blue-50)' : 'transparent',
                              cursor: 'pointer',
                              textAlign: 'left',
                              width: '100%',
                              transition: 'background 0.2s',
                              position: 'relative'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                            onMouseLeave={e => e.currentTarget.style.background = userUnreadCount > 0 ? 'var(--blue-50)' : 'transparent'}
                          >
                            <div style={{ position: 'relative' }}>
                              {u.photoURL ? (
                                <img src={u.photoURL} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                              ) : (
                                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                                  <UserIcon size={20} />
                                </div>
                              )}
                              {userUnreadCount > 0 && (
                                <div style={{
                                  position: 'absolute',
                                  top: -2,
                                  right: -2,
                                  width: 12,
                                  height: 12,
                                  background: '#ef4444',
                                  borderRadius: '50%',
                                  border: '2px solid #ffffff'
                                }} />
                              )}
                              {presenceOf(u).online && (
                                <div style={{
                                  position: 'absolute',
                                  bottom: 0,
                                  right: 0,
                                  width: 11,
                                  height: 11,
                                  background: '#22c55e',
                                  borderRadius: '50%',
                                  border: '2px solid #ffffff'
                                }} />
                              )}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontWeight: userUnreadCount > 0 ? 700 : 600, fontSize: 14, color: 'var(--text-primary)' }}>{u.displayName}</div>
                                {userUnreadCount > 0 && (
                                  <span style={{
                                    background: '#ef4444',
                                    color: '#ffffff',
                                    fontSize: 10,
                                    padding: '2px 6px',
                                    borderRadius: 10,
                                    fontWeight: 700
                                  }}>
                                    {userUnreadCount}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {u.role} · {presenceOf(u).label}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8', fontSize: 14 }}>
                        No users found
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Chat Messages */
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, minHeight: 0 }}>
                  <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
                    {messages.length === 0 ? (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center' }}>
                        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                          <MessageSquare size={32} />
                        </div>
                        <p style={{ fontSize: 14 }}>No messages yet.<br/>Start the conversation!</p>
                        <p style={{ fontSize: 11, marginTop: 8 }}>Messages are kept for 7 days.</p>
                      </div>
                    ) : (
                      messages.map((msg, idx) => {
                        const isMine = msg.senderId === currentUser.id;
                        const hasRef = !!(msg.refType && msg.refId);
                        return (
                          <div
                            key={msg.id}
                            style={{
                              alignSelf: isMine ? 'flex-end' : 'flex-start',
                              maxWidth: '80%',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: isMine ? 'flex-end' : 'flex-start'
                            }}
                          >
                            <div style={{
                              padding: '10px 14px',
                              borderRadius: isMine ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                              background: isMine ? 'var(--blue-600)' : 'var(--surface-3)',
                              color: isMine ? '#ffffff' : 'var(--text-primary)',
                              fontSize: 14,
                              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                              border: isMine ? 'none' : '1px solid var(--border)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: hasRef && msg.text?.trim() ? 8 : 0
                            }}>
                              {msg.text?.trim() && <span dir="auto" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</span>}
                              {hasRef && (
                                <button
                                  onClick={() => openRef(msg)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    padding: '8px 10px',
                                    borderRadius: 10,
                                    border: isMine ? '1px solid rgba(255,255,255,0.35)' : '1px solid var(--border)',
                                    background: isMine ? 'rgba(255,255,255,0.15)' : 'var(--surface)',
                                    color: isMine ? '#ffffff' : 'var(--text-primary)',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    width: '100%'
                                  }}
                                >
                                  {msg.refType === 'task'
                                    ? <CheckSquare size={16} style={{ flexShrink: 0 }} />
                                    : <FileText size={16} style={{ flexShrink: 0 }} />}
                                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                                      {msg.refType === 'task' ? 'Task' : 'Correspondence'}{msg.refSerial ? ` · ${msg.refSerial}` : ''}
                                    </span>
                                    <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {msg.refLabel || 'Open'}
                                    </span>
                                  </span>
                                </button>
                              )}
                            </div>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                              {msg.createdAt?.toDate()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {isMine && idx === lastMineIdx && (
                                msg.read ? (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--blue-600)', fontWeight: 600 }}>
                                    <CheckCheck size={13} />
                                    Seen{msg.readAt ? ` ${msg.readAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                                  </span>
                                ) : (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Check size={13} />
                                    Sent
                                  </span>
                                )
                              )}
                            </span>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Pending shared reference chip */}
                  {pendingAttach && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', marginBottom: 8,
                      background: 'var(--blue-50)', border: '1px solid var(--blue-200)',
                      borderRadius: 10, fontSize: 12, color: 'var(--text-primary)'
                    }}>
                      {pendingAttach.refType === 'task'
                        ? <CheckSquare size={14} style={{ flexShrink: 0 }} />
                        : <FileText size={14} style={{ flexShrink: 0 }} />}
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pendingAttach.refSerial ? `${pendingAttach.refSerial} · ` : ''}{pendingAttach.refLabel}
                      </span>
                      <button
                        onClick={() => setPendingAttach(null)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex' }}
                        aria-label="Remove attachment"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}


                  {/* Input row (relative so the emoji popover anchors to it) */}
                  <div style={{ position: 'relative' }}>
                  {showEmoji && (
                    <div style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 0,
                      right: 0,
                      marginBottom: 8,
                      display: 'grid',
                      gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
                      gap: 2,
                      padding: 8,
                      maxHeight: 200,
                      overflowY: 'auto',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                      zIndex: 6
                    }}>
                      {EMOJIS.map(em => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => insertEmoji(em)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 4, borderRadius: 6, lineHeight: 1 }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  )}
                  <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => { setShowEmoji(s => !s); setSharePickerOpen(false); }}
                      title="Emoji"
                      style={{
                        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                        background: showEmoji ? 'var(--blue-50)' : 'var(--surface-3)',
                        color: 'var(--text-secondary)', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}
                    >
                      <Smile size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSharePickerOpen(true); setShowEmoji(false); }}
                      title="Share a task or correspondence"
                      style={{
                        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                        background: sharePickerOpen ? 'var(--blue-50)' : 'var(--surface-3)',
                        color: 'var(--text-secondary)', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}
                    >
                      <Link2 size={18} />
                    </button>
                    <textarea
                      ref={inputRef as any}
                      dir="auto"
                      placeholder="Type a message..."
                      value={newMessage}
                      onChange={(e) => {
                        setNewMessage(e.target.value);
                        e.target.style.height = '40px';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (newMessage.trim() || pendingAttach) {
                            handleSendMessage(e as any);
                            if (inputRef.current) (inputRef.current as any).style.height = '40px';
                          }
                        }
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '10px 14px',
                        borderRadius: 20,
                        border: '1px solid var(--border)',
                        fontSize: 14,
                        outline: 'none',
                        background: 'var(--surface)',
                        color: 'var(--text-primary)',
                        resize: 'none',
                        minHeight: 40,
                        maxHeight: 120,
                        lineHeight: '20px',
                        fontFamily: 'inherit',
                        overflowY: 'auto'
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!newMessage.trim() && !pendingAttach}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background: (newMessage.trim() || pendingAttach) ? 'var(--blue-600)' : '#e2e8f0',
                        color: '#ffffff',
                        border: 'none',
                        cursor: (newMessage.trim() || pendingAttach) ? 'pointer' : 'default',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s'
                      }}
                    >
                      <Send size={18} />
                    </button>
                  </form>
                  </div>
                </div>
              )}
            </div>

            {/* Share picker overlay */}
            <AnimatePresence>
              {sharePickerOpen && selectedUser && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'var(--surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    zIndex: 5
                  }}
                >
                  <div style={{
                    padding: '14px 16px', background: 'var(--blue-600)', color: '#ffffff',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                  }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>Share a reference</span>
                    <button
                      onClick={() => { setSharePickerOpen(false); setShareSearch(''); }}
                      style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', padding: 4 }}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', padding: 12, gap: 8 }}>
                    {(['task', 'corresponding'] as const).map(tab => (
                      <button
                        key={tab}
                        onClick={() => setShareTab(tab)}
                        style={{
                          flex: 1, padding: '8px 0', borderRadius: 10, fontSize: 13, fontWeight: 600,
                          border: '1px solid var(--border)', cursor: 'pointer',
                          background: shareTab === tab ? 'var(--blue-600)' : 'var(--surface)',
                          color: shareTab === tab ? '#ffffff' : 'var(--text-secondary)'
                        }}
                      >
                        {tab === 'task' ? 'Tasks' : 'Correspondences'}
                      </button>
                    ))}
                  </div>
                  <div style={{ position: 'relative', padding: '0 12px 12px' }}>
                    <Search style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
                    <input
                      type="text"
                      autoFocus
                      placeholder={`Search ${shareTab === 'task' ? 'tasks' : 'correspondences'}...`}
                      value={shareSearch}
                      onChange={e => setShareSearch(e.target.value)}
                      style={{
                        width: '100%', padding: '10px 12px 10px 40px', borderRadius: 12,
                        border: '1px solid var(--border)', fontSize: 14, outline: 'none',
                        background: 'var(--surface)', color: 'var(--text-primary)'
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {shareList.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: 14 }}>
                        Nothing to show
                      </div>
                    ) : (
                      shareList.map((it: Task | Corresponding) => {
                        const isTask = shareTab === 'task';
                        const label = isTask ? (it as Task).taskName : (it as Corresponding).subject;
                        const serial = it.serialNumber || '';
                        return (
                          <button
                            key={it.id}
                            onClick={() => {
                              setPendingAttach({
                                refType: isTask ? 'task' : 'corresponding',
                                refId: it.id,
                                refLabel: label || '(untitled)',
                                refSerial: serial,
                              });
                              setSharePickerOpen(false);
                              setShareSearch('');
                            }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10, padding: 12,
                              borderRadius: 10, border: '1px solid #e2e8f0', background: '#ffffff',
                              cursor: 'pointer', textAlign: 'left', width: '100%'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={e => e.currentTarget.style.background = '#ffffff'}
                          >
                            {isTask
                              ? <CheckSquare size={16} style={{ flexShrink: 0, color: 'var(--blue-600)' }} />
                              : <FileText size={16} style={{ flexShrink: 0, color: 'var(--blue-600)' }} />}
                            <div style={{ minWidth: 0 }}>
                              {serial && <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>{serial}</div>}
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {label || '(untitled)'}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showNotification && unreadMessages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10, x: -10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => {
              const latest = unreadMessages[0];
              const sender = allUsers.find(u => u.id === latest.senderId);
              if (sender) {
                openConversation(sender);
                setIsOpen(true);
                setShowNotification(false);
              }
            }}
            style={{
              position: 'absolute',
              bottom: '110%',
              right: 0,
              background: '#ffffff',
              padding: '14px 18px',
              borderRadius: '16px 16px 2px 16px',
              boxShadow: '0 10px 25px -3px rgba(0, 0, 0, 0.15), 0 4px 6px -2px rgba(0, 0, 0, 0.08)',
              border: '1px solid #e2e8f0',
              cursor: 'pointer',
              width: 300,
              minWidth: 260,
              zIndex: 1001,
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--blue-600)' }}>New Message</span>
              <button
                onClick={(e) => { e.stopPropagation(); setShowNotification(false); }}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 600 }}>
              {allUsers.find(u => u.id === unreadMessages[0].senderId)?.displayName || 'Someone'}
            </div>
            <div style={{
              fontSize: 13,
              color: '#64748b',
              wordBreak: 'break-word',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical' as const,
              lineHeight: '1.4'
            }}>
              {previewText(unreadMessages[0])}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => {
          setIsOpen(!isOpen);
          setShowNotification(false);
        }}
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--blue-600)',
          color: '#ffffff',
          border: 'none',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}
      >
        {isOpen ? <X size={24} /> : <MessageSquare size={24} />}
        {!isOpen && unreadMessages.length > 0 && (
          <div style={{
            position: 'absolute',
            top: -4,
            right: -4,
            background: '#ef4444',
            color: '#ffffff',
            borderRadius: '50%',
            width: 22,
            height: 22,
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #ffffff',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            {unreadMessages.length}
          </div>
        )}
      </motion.button>
    </div>
  );
}
