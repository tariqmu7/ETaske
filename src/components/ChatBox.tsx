import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, query, where, orderBy, onSnapshot, 
  addDoc, serverTimestamp, Timestamp, limit,
  updateDoc, doc 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AppUser, ChatMessage } from '../types';
import { 
  MessageSquare, Send, X, Search, User as UserIcon, 
  ChevronLeft, Minus, Maximize2 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ChatBoxProps {
  currentUser: AppUser;
  allUsers: AppUser[];
}

export default function ChatBox({ currentUser, allUsers }: ChatBoxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadMessages, setUnreadMessages] = useState<ChatMessage[]>([]);
  const [showNotification, setShowNotification] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const otherUsers = allUsers.filter(u => u.id !== currentUser.id && u.status === 'Approved');
  const filteredUsers = otherUsers.filter(u => 
    u.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage)));
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

  // Mark messages as read when viewing them
  const markingRef = useRef(new Set<string>());
  useEffect(() => {
    if (isOpen && selectedUser) {
      const unreadFromThisUser = unreadMessages.filter(m => m.senderId === selectedUser.id && !markingRef.current.has(m.id));
      unreadFromThisUser.forEach(async (msg) => {
        markingRef.current.add(msg.id);
        try {
          await updateDoc(doc(db, 'messages', msg.id), { read: true });
        } catch (err) {
          console.warn("Error marking as read:", err);
          markingRef.current.delete(msg.id);
        }
      });
    }
  }, [isOpen, selectedUser, unreadMessages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedUser) return;

    const participants = [currentUser.id, selectedUser.id].sort();
    const messageData = {
      senderId: currentUser.id,
      receiverId: selectedUser.id,
      text: newMessage.trim(),
      createdAt: serverTimestamp(),
      participants: participants,
      read: false
    };

    setNewMessage('');
    try {
      await addDoc(collection(db, 'messages'), messageData);
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

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
              background: '#ffffff',
              borderRadius: 16,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              marginBottom: 16
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
                        <div style={{ fontSize: 10, opacity: 0.8 }}>Active Now</div>
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
            <div style={{ flex: 1, overflowY: 'auto', background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
              {!selectedUser ? (
                /* User List */
                <div style={{ padding: 16 }}>
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
                        border: '1px solid #e2e8f0',
                        fontSize: 14,
                        outline: 'none'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {filteredUsers.length > 0 ? (
                      filteredUsers.map(u => {
                        const userUnreadCount = unreadMessages.filter(m => m.senderId === u.id).length;
                        return (
                          <button
                            key={u.id}
                            onClick={() => setSelectedUser(u)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              padding: 12,
                              borderRadius: 12,
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              textAlign: 'left',
                              width: '100%',
                              transition: 'background 0.2s',
                              position: 'relative'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{ position: 'relative' }}>
                              {u.photoURL ? (
                                <img src={u.photoURL} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                              ) : (
                                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
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
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>{u.displayName}</div>
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
                              <div style={{ fontSize: 12, color: '#64748b' }}>{u.role}</div>
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
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16 }}>
                  <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {messages.length === 0 ? (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', textAlign: 'center' }}>
                        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                          <MessageSquare size={32} />
                        </div>
                        <p style={{ fontSize: 14 }}>No messages yet.<br/>Start the conversation!</p>
                        <p style={{ fontSize: 11, marginTop: 8 }}>Messages are kept for 7 days.</p>
                      </div>
                    ) : (
                      messages.map((msg, idx) => {
                        const isMine = msg.senderId === currentUser.id;
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
                              color: isMine ? '#ffffff' : '#1e293b',
                              fontSize: 14,
                              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                              border: isMine ? 'none' : '1px solid #e2e8f0'
                            }}>
                              {msg.text}
                            </div>
                            <span style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                              {msg.createdAt?.toDate()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input */}
                  <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: 8 }}>
                    <input 
                      type="text" 
                      placeholder="Type a message..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '10px 14px',
                        borderRadius: 20,
                        border: '1px solid #e2e8f0',
                        fontSize: 14,
                        outline: 'none',
                        background: '#ffffff'
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!newMessage.trim()}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: newMessage.trim() ? 'var(--blue-600)' : '#e2e8f0',
                        color: '#ffffff',
                        border: 'none',
                        cursor: newMessage.trim() ? 'pointer' : 'default',
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
              )}
            </div>
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
                setSelectedUser(sender);
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
              {unreadMessages[0].text}
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
