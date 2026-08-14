import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { User } from 'firebase/auth';
import { AppUser, TaskPriority, CorrespondingCategory } from './types';
import CreateTaskPanel from './components/CreateTaskPanel';
import {
  Mail, RefreshCw, Search, AlertCircle, Wifi, WifiOff,
  Plus, Paperclip, Inbox, Send, Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const BRIDGE_URL = 'http://localhost:5111';
const BRIDGE_TOKEN = 'etaske-bridge-2f9a7c';
const bridgeHeaders = { 'X-Bridge-Token': BRIDGE_TOKEN };
// Shipped in public/downloads — Vite copies it into dist/ as-is, so the same
// relative path works on GitHub Pages (vite base is './').
const BRIDGE_DOWNLOAD_URL = 'downloads/ETaske-OutlookBridge.exe';

// Outlook default folder names, as the bridge expects them in ?folder=
type MailFolder = 'Inbox' | 'Sent Items';

interface OutlookEmail {
  id: string;
  subject: string;
  sender: string;
  sender_email: string;
  recipients?: string[];
  to?: string;
  direction?: 'sent' | 'received';
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
  sent_count?: number;
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

// Who the email is "with": the sender for incoming mail, the recipients for sent mail.
function counterparty(email: OutlookEmail): string {
  if (email.direction === 'sent') return email.to || (email.recipients || []).join('; ') || '(no recipient)';
  return email.sender || '(unknown sender)';
}

export default function OutlookFeed({ user, appUser, projectUsers }: Props) {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [folder, setFolder] = useState<MailFolder>('Inbox');
  const [emails, setEmails] = useState<OutlookEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<OutlookEmail | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [creatingFrom, setCreatingFrom] = useState<OutlookEmail | null>(null);

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

  const fetchEmails = useCallback(async (searchQuery = '', mailFolder: MailFolder = 'Inbox') => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '60', folder: mailFolder });
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
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  // Debounced — also re-runs when the user switches between Inbox and Sent.
  useEffect(() => {
    const t = setTimeout(() => fetchEmails(search, folder), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [search, folder, fetchEmails]);

  // ── Create task ───────────────────────────────────────────────────────────

  const openCreateTask = (email: OutlookEmail) => {
    setCreatingFrom(email);
    setShowCreateTask(true);
  };

  // Seeds the shared create-task form. Everything else about that form — its
  // fields, layout and the notifications it fires — is the Tasks dashboard's.
  const taskPrefill = useMemo(() => creatingFrom ? {
    taskName: creatingFrom.subject,
    description: `${creatingFrom.direction === 'sent'
      ? `To: ${counterparty(creatingFrom)}`
      : `From: ${creatingFrom.sender} <${creatingFrom.sender_email}>`}

${creatingFrom.body_preview}`,
    priority: (creatingFrom.importance === 'High' ? 'High' : 'Medium') as TaskPriority,
    category: 'Internal' as CorrespondingCategory,
    department: appUser.department || 'None',
  } : undefined, [creatingFrom, appUser.department]);


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
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>Read local Outlook inbox &amp; sent mail · create tasks instantly</p>
        </div>

        <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
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

          <a
            href={BRIDGE_DOWNLOAD_URL}
            download="ETaske-OutlookBridge.exe"
            title="Download the ETaske Outlook Bridge for Windows"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 13,
              textDecoration: 'none',
            }}
          >
            <Download size={14} />
            Bridge for Windows
          </a>

          <button
            onClick={() => { checkStatus(); fetchEmails(search, folder); }}
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
              <ol style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>
                <li>Download <strong>ETaske-OutlookBridge.exe</strong> with the button below</li>
                <li>Double-click it — a small status window will appear. Keep it open.</li>
                <li>Come back here and click <strong>Refresh</strong></li>
              </ol>
              <a
                href={BRIDGE_DOWNLOAD_URL}
                download="ETaske-OutlookBridge.exe"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 14,
                  padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: 'var(--accent)', color: '#fff', textDecoration: 'none',
                }}
              >
                <Download size={15} /> Download Bridge for Windows
              </a>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '8px 0 0' }}>
                Windows only · requires Outlook installed · ~22 MB. Windows SmartScreen may warn on
                first run — choose “More info → Run anyway”.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Folder tabs — Inbox / Sent */}
      {connected && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {([
            { id: 'Inbox' as MailFolder, label: 'Inbox', icon: <Inbox size={14} />, count: status?.email_count },
            { id: 'Sent Items' as MailFolder, label: 'Sent', icon: <Send size={14} />, count: status?.sent_count },
          ]).map(tab => {
            const active = folder === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setSelectedEmail(null); setFolder(tab.id); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--accent)' : 'var(--surface-2)',
                  color: active ? '#fff' : 'var(--text-2)',
                }}
              >
                {tab.icon}
                {tab.label}
                {typeof tab.count === 'number' && (
                  <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 500 }}>{tab.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Search bar */}
      {connected && (
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <Search size={16} style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={folder === 'Sent Items' ? 'Search subject, recipient…' : 'Search subject, sender…'}
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
          {folder === 'Sent Items' ? <Send size={14} color="var(--text-3)" /> : <Inbox size={14} color="var(--text-3)" />}
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {folder === 'Sent Items'
              ? `${status.sent_count ?? 0} emails in sent items`
              : `${status.email_count} emails in inbox`} · showing {emails.length}
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
          {emails.map(email => {
            const isSent = email.direction === 'sent';
            const party = counterparty(email);
            return (
            <div
              key={email.id}
              onClick={() => setSelectedEmail(selectedEmail?.id === email.id ? null : email)}
              style={{
                padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                background: selectedEmail?.id === email.id ? 'var(--surface-3)' : 'var(--surface-2)',
                border: `1px solid ${selectedEmail?.id === email.id ? 'var(--accent)' : 'var(--border)'}`,
                borderInlineStart: isSent || email.is_read ? undefined : '3px solid var(--accent)',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                {/* Avatar */}
                <div style={{
                  width: 36, height: 36, borderRadius: 18, flexShrink: 0,
                  background: `hsl(${Math.abs((party.charCodeAt(0) || 63) * 37) % 360},55%,55%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 700, fontSize: 14,
                }}>
                  {isSent ? <Send size={15} /> : (party[0] || '?').toUpperCase()}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{
                      fontWeight: isSent || email.is_read ? 500 : 700,
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
                    <span style={{
                      fontSize: 13, color: 'var(--text-3)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420,
                    }}>
                      {isSent ? `To: ${party}` : party}
                    </span>
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
                      <div style={{ display: 'flex', gap: 24, marginBottom: 10, fontSize: 13, color: 'var(--text-3)', flexWrap: 'wrap' }}>
                        {isSent ? (
                          <span><strong style={{ color: 'var(--text-2)' }}>To:</strong> {party}</span>
                        ) : (
                          <span><strong style={{ color: 'var(--text-2)' }}>From:</strong> {email.sender} {email.sender_email ? `<${email.sender_email}>` : ''}</span>
                        )}
                        <span>
                          <strong style={{ color: 'var(--text-2)' }}>{isSent ? 'Sent:' : 'Received:'}</strong>{' '}
                          {email.received_at ? new Date(email.received_at).toLocaleString() : '—'}
                        </span>
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
            );
          })}
        </div>
      )}

      {/* Create Task — the same panel the Tasks dashboard uses, prefilled from the email */}
      <CreateTaskPanel
        open={showCreateTask && !!creatingFrom}
        onClose={() => setShowCreateTask(false)}
        user={user}
        appUser={appUser}
        projectUsers={projectUsers}
        prefill={taskPrefill}
        extraFields={creatingFrom ? { correspondingSubject: creatingFrom.subject } : undefined}
        headerIcon={<Mail size={16} color="#fff" />}
        headerIconBackground="linear-gradient(135deg,#0078d4,#005a9e)"
        headerTitle="Create Task from Email"
        headerSubtitle={creatingFrom ? counterparty(creatingFrom) : undefined}
        sourceStrip={creatingFrom ? (
          <div style={{ padding: '12px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Source email</p>
            <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{creatingFrom.subject}</p>
          </div>
        ) : undefined}
      />
    </div>
  );
}
