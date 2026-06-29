import React, { useState, useEffect, useCallback } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './lib/firebase';
import { User } from 'firebase/auth';
import { AppUser, TaskPriority, CorrespondingCategory } from './types';
import { getNextSerialNumber } from './lib/counters';
import {
  Mail, RefreshCw, Search, AlertCircle, Wifi, WifiOff, X,
  Plus, ChevronRight, Clock, Paperclip, CheckCircle2, Inbox,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const BRIDGE_URL = 'http://localhost:5111';
const BRIDGE_TOKEN = 'etaske-bridge-2f9a7c';
const bridgeHeaders = { 'X-Bridge-Token': BRIDGE_TOKEN };

interface OutlookEmail {
  id: string;
  subject: string;
  sender: string;
  sender_email: string;
  received_at: string;
  body_preview: string;
  body: string;
  is_read: boolean;
  importance: 'Low' | 'Normal' | 'High';
  has_attachments: boolean;
  attachment_names: string[];
  folder: string;
}

interface BridgeStatus {
  running: boolean;
  outlook_connected: boolean;
  email_count: number;
}

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
}

function importanceBadgeClass(imp: string) {
  if (imp === 'High') return 'badge badge-urgent';
  if (imp === 'Low') return 'badge badge-low';
  return 'badge badge-medium';
}

function formatRelativeTime(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function OutlookFeed({ user, appUser, projectUsers }: Props) {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [emails, setEmails] = useState<OutlookEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<OutlookEmail | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [creatingFrom, setCreatingFrom] = useState<OutlookEmail | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskSaved, setTaskSaved] = useState(false);

  const [newTask, setNewTask] = useState({
    taskName: '',
    description: '',
    priority: 'Medium' as TaskPriority,
    dueDate: '',
    category: 'Internal' as CorrespondingCategory,
    department: appUser.department || 'None',
    assignedTo: appUser.displayName,
    assignedToId: user.uid,
  });

  // ── Bridge communication ──────────────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/status`, { headers: bridgeHeaders, signal: AbortSignal.timeout(3000), targetAddressSpace: 'loopback' } as RequestInit);
      if (res.ok) setStatus(await res.json());
      else setStatus(null);
    } catch {
      setStatus(null);
    }
  }, []);

  const fetchEmails = useCallback(async (searchQuery = '') => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '60' });
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`${BRIDGE_URL}/emails?${params}`, { headers: bridgeHeaders, signal: AbortSignal.timeout(10000), targetAddressSpace: 'loopback' } as RequestInit);
      if (!res.ok) throw new Error(`Bridge returned ${res.status}`);
      setEmails(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to fetch emails');
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
    fetchEmails();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, [checkStatus, fetchEmails]);

  useEffect(() => {
    const t = setTimeout(() => fetchEmails(search), 400);
    return () => clearTimeout(t);
  }, [search, fetchEmails]);

  // ── Create task ───────────────────────────────────────────────────────────

  const openCreateTask = (email: OutlookEmail) => {
    setCreatingFrom(email);
    setNewTask({
      taskName: email.subject,
      description: `From: ${email.sender} <${email.sender_email}>\n\n${email.body_preview}`,
      priority: email.importance === 'High' ? 'High' : 'Medium',
      dueDate: '',
      category: 'Internal',
      department: appUser.department || 'None',
      assignedTo: appUser.displayName,
      assignedToId: user.uid,
    });
    setTaskSaved(false);
    setShowCreateTask(true);
  };

  const handleSaveTask = async () => {
    if (!newTask.taskName.trim() || !creatingFrom) return;
    setTaskSaving(true);
    try {
      const serial = await getNextSerialNumber('tasks');
      await addDoc(collection(db, 'tasks'), {
        taskName: newTask.taskName.trim(),
        description: newTask.description.trim(),
        status: 'Pending',
        priority: newTask.priority,
        category: newTask.category,
        department: newTask.department,
        subCategory: 'None',
        serialNumber: serial,
        assignedTo: newTask.assignedTo,
        assignedToId: newTask.assignedToId,
        assignedBy: appUser.displayName,
        assignedById: user.uid,
        teamId: appUser.teamId || 'NONE',
        dueDate: newTask.dueDate || null,
        filePaths: [],
        isPrivate: false,
        // Traceability back to the email
        correspondingSubject: creatingFrom.subject,
        userId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setTaskSaved(true);
      setTimeout(() => setShowCreateTask(false), 1200);
    } catch (e) {
      console.error(e);
    } finally {
      setTaskSaving(false);
    }
  };

  const assignableUsers = projectUsers.filter(
    u => u.status === 'Approved' && (appUser.role === 'Admin' || appUser.role === 'Manager' || u.id === user.uid)
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const connected = status?.outlook_connected ?? false;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-1)', padding: '24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: 'linear-gradient(135deg, #0078d4 0%, #005a9e 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Mail size={20} color="#fff" />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>Outlook Feed</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>Read local Outlook emails · create tasks instantly</p>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Connection badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 20,
            background: connected ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${connected ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          }}>
            {connected
              ? <><Wifi size={13} color="#22c55e" /><span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>Bridge connected</span></>
              : <><WifiOff size={13} color="#ef4444" /><span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>Bridge offline</span></>
            }
          </div>

          <button
            onClick={() => { checkStatus(); fetchEmails(search); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 13,
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Not connected notice */}
      {!connected && (
        <div style={{
          padding: '20px 24px', borderRadius: 12,
          background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
          marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertCircle size={20} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontWeight: 600, color: 'var(--text-1)', margin: '0 0 6px' }}>
                ETaske Outlook Bridge is not running
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 10px' }}>
                To read your Outlook emails here, run the local bridge tool on this PC first.
              </p>
              <ol style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                <li>Download <strong>ETaske-OutlookBridge.exe</strong> from your IT admin (or build it from <code>outlook_bridge/</code>)</li>
                <li>Double-click it — a console window will appear</li>
                <li>Come back here and click <strong>Refresh</strong></li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Search bar */}
      {connected && (
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search subject, sender…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px 10px 38px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--surface-2)',
              color: 'var(--text-1)', fontSize: 14, outline: 'none',
            }}
          />
        </div>
      )}

      {/* Stats bar */}
      {connected && status && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          <Inbox size={14} color="var(--text-3)" />
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {status.email_count} emails in inbox · showing {emails.length}
          </span>
        </div>
      )}

      {/* Email list */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-3)' }}>
          <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
          <p style={{ margin: 0 }}>Loading emails…</p>
        </div>
      )}

      {!loading && error && (
        <div style={{ textAlign: 'center', padding: 48, color: '#ef4444' }}>
          <AlertCircle size={32} style={{ marginBottom: 12 }} />
          <p style={{ margin: 0, fontWeight: 600 }}>Could not load emails</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-3)' }}>{error}</p>
        </div>
      )}

      {!loading && !error && connected && emails.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-3)' }}>
          <Mail size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
          <p style={{ margin: 0 }}>No emails found</p>
        </div>
      )}

      {!loading && emails.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {emails.map(email => (
            <div
              key={email.id}
              onClick={() => setSelectedEmail(selectedEmail?.id === email.id ? null : email)}
              style={{
                padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                background: selectedEmail?.id === email.id ? 'var(--surface-3)' : 'var(--surface-2)',
                border: `1px solid ${selectedEmail?.id === email.id ? 'var(--accent)' : 'var(--border)'}`,
                borderLeft: email.is_read ? undefined : '3px solid var(--accent)',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                {/* Avatar */}
                <div style={{
                  width: 36, height: 36, borderRadius: 18, flexShrink: 0,
                  background: `hsl(${Math.abs(email.sender.charCodeAt(0) * 37) % 360},55%,55%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 700, fontSize: 14,
                }}>
                  {(email.sender[0] || '?').toUpperCase()}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{
                      fontWeight: email.is_read ? 500 : 700,
                      color: 'var(--text-1)', fontSize: 14, flex: 1,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {email.subject}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>
                      {formatRelativeTime(email.received_at)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{email.sender}</span>
                    {email.importance !== 'Normal' && (
                      <span className={importanceBadgeClass(email.importance)} style={{ fontSize: 10 }}>
                        {email.importance}
                      </span>
                    )}
                    {email.has_attachments && <Paperclip size={12} color="var(--text-3)" />}
                  </div>
                </div>

                <button
                  onClick={e => { e.stopPropagation(); openCreateTask(email); }}
                  title="Create task from this email"
                  style={{
                    flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                    padding: '5px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                    border: '1px solid var(--accent)', background: 'transparent',
                    color: 'var(--accent)', cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
                    (e.currentTarget as HTMLButtonElement).style.color = '#fff';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
                  }}
                >
                  <Plus size={12} /> Task
                </button>
              </div>

              {/* Expanded body preview */}
              <AnimatePresence>
                {selectedEmail?.id === email.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{
                      marginTop: 14, paddingTop: 14,
                      borderTop: '1px solid var(--border)',
                    }}>
                      <div style={{ display: 'flex', gap: 24, marginBottom: 10, fontSize: 13, color: 'var(--text-3)' }}>
                        <span><strong style={{ color: 'var(--text-2)' }}>From:</strong> {email.sender} {email.sender_email ? `<${email.sender_email}>` : ''}</span>
                        <span><strong style={{ color: 'var(--text-2)' }}>Received:</strong> {email.received_at ? new Date(email.received_at).toLocaleString() : '—'}</span>
                      </div>
                      <p style={{
                        fontSize: 13, color: 'var(--text-2)', margin: 0,
                        whiteSpace: 'pre-wrap', lineHeight: 1.6,
                        maxHeight: 200, overflow: 'auto',
                        background: 'var(--surface-1)', padding: 12, borderRadius: 8,
                      }}>
                        {email.body_preview}
                      </p>
                      {email.has_attachments && (
                        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {email.attachment_names.map((name, i) => (
                            <span key={i} style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              fontSize: 12, color: 'var(--text-2)', background: 'var(--surface-1)',
                              padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)',
                            }}>
                              <Paperclip size={11} /> {name}
                            </span>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={() => openCreateTask(email)}
                        style={{
                          marginTop: 14, display: 'flex', alignItems: 'center', gap: 6,
                          padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                          background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer',
                        }}
                      >
                        <Plus size={14} /> Create Task from this Email
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}

      {/* Create Task slide-over */}
      <AnimatePresence>
        {showCreateTask && creatingFrom && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowCreateTask(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, backdropFilter: 'blur(2px)' }}
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
                background: 'var(--surface-2)', zIndex: 1001,
                display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 40px rgba(0,0,0,0.25)',
              }}
            >
              {/* Panel header */}
              <div style={{
                padding: '20px 24px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 9,
                  background: 'linear-gradient(135deg,#0078d4,#005a9e)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Mail size={17} color="#fff" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: 'var(--text-1)' }}>Create Task from Email</p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {creatingFrom.sender}
                  </p>
                </div>
                <button
                  onClick={() => setShowCreateTask(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Email source strip */}
              <div style={{ padding: '12px 24px', background: 'var(--surface-1)', borderBottom: '1px solid var(--border)' }}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>Source email</p>
                <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>{creatingFrom.subject}</p>
              </div>

              {/* Form */}
              <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Task name */}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
                    Task Name <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    autoFocus
                    value={newTask.taskName}
                    onChange={e => setNewTask(t => ({ ...t, taskName: e.target.value }))}
                    placeholder="What needs to be done?"
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                      borderRadius: 9, border: '1px solid var(--border)',
                      background: 'var(--surface-1)', color: 'var(--text-1)', fontSize: 14, outline: 'none',
                    }}
                  />
                </div>

                {/* Description */}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Description</label>
                  <textarea
                    value={newTask.description}
                    onChange={e => setNewTask(t => ({ ...t, description: e.target.value }))}
                    rows={5}
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                      borderRadius: 9, border: '1px solid var(--border)',
                      background: 'var(--surface-1)', color: 'var(--text-1)', fontSize: 13,
                      outline: 'none', resize: 'vertical',
                    }}
                  />
                </div>

                {/* Priority + Due date row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Priority</label>
                    <select
                      value={newTask.priority}
                      onChange={e => setNewTask(t => ({ ...t, priority: e.target.value as TaskPriority }))}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 9,
                        border: '1px solid var(--border)', background: 'var(--surface-1)',
                        color: 'var(--text-1)', fontSize: 14, outline: 'none',
                      }}
                    >
                      <option>Low</option>
                      <option>Medium</option>
                      <option>High</option>
                      <option>Urgent</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Due Date</label>
                    <input
                      type="date"
                      value={newTask.dueDate}
                      onChange={e => setNewTask(t => ({ ...t, dueDate: e.target.value }))}
                      style={{
                        width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9,
                        border: '1px solid var(--border)', background: 'var(--surface-1)',
                        color: 'var(--text-1)', fontSize: 14, outline: 'none',
                      }}
                    />
                  </div>
                </div>

                {/* Assign to */}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Assign To</label>
                  <select
                    value={newTask.assignedToId}
                    onChange={e => {
                      const u = assignableUsers.find(u => u.id === e.target.value);
                      if (u) setNewTask(t => ({ ...t, assignedToId: u.id, assignedTo: u.displayName }));
                    }}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 9,
                      border: '1px solid var(--border)', background: 'var(--surface-1)',
                      color: 'var(--text-1)', fontSize: 14, outline: 'none',
                    }}
                  >
                    {assignableUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.displayName} ({u.role})</option>
                    ))}
                  </select>
                </div>

                {/* Category */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Category</label>
                    <select
                      value={newTask.category}
                      onChange={e => setNewTask(t => ({ ...t, category: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 9,
                        border: '1px solid var(--border)', background: 'var(--surface-1)',
                        color: 'var(--text-1)', fontSize: 14, outline: 'none',
                      }}
                    >
                      <option>Internal</option>
                      <option>External</option>
                      <option>Project</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Department</label>
                    <input
                      value={newTask.department}
                      onChange={e => setNewTask(t => ({ ...t, department: e.target.value }))}
                      placeholder="Department"
                      style={{
                        width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9,
                        border: '1px solid var(--border)', background: 'var(--surface-1)',
                        color: 'var(--text-1)', fontSize: 14, outline: 'none',
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{
                padding: '16px 24px', borderTop: '1px solid var(--border)',
                display: 'flex', gap: 10,
              }}>
                <button
                  onClick={() => setShowCreateTask(false)}
                  style={{
                    flex: 1, padding: '11px', borderRadius: 9, fontSize: 14, fontWeight: 600,
                    border: '1px solid var(--border)', background: 'var(--surface-1)',
                    color: 'var(--text-2)', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTask}
                  disabled={!newTask.taskName.trim() || taskSaving || taskSaved}
                  style={{
                    flex: 2, padding: '11px', borderRadius: 9, fontSize: 14, fontWeight: 700,
                    border: 'none',
                    background: taskSaved
                      ? '#22c55e'
                      : (!newTask.taskName.trim() || taskSaving)
                        ? 'var(--surface-3)'
                        : 'var(--accent)',
                    color: taskSaved || (!newTask.taskName.trim() || taskSaving) ? (taskSaved ? '#fff' : 'var(--text-3)') : '#fff',
                    cursor: !newTask.taskName.trim() || taskSaving || taskSaved ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    transition: 'background 0.2s',
                  }}
                >
                  {taskSaved
                    ? <><CheckCircle2 size={16} /> Saved!</>
                    : taskSaving
                      ? 'Saving…'
                      : <><Plus size={15} /> Create Task</>
                  }
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
