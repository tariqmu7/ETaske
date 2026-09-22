import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat, fmtAgo, DATETIME_SHORT } from './lib/format';
import type { Language } from './i18n';
import type { TFunction } from 'i18next';
import { User } from 'firebase/auth';
import { AppUser, TaskPriority, CorrespondingCategory } from './types';
import { useKnownParties } from './hooks/useKnownParties';
import type { AppView } from './App';
import CreateTaskPanel from './components/CreateTaskPanel';
import { requestCreate } from './lib/createIntent';
import {
  loadMailLedger, markMailHandled, MAIL_LEDGER_KEY,
  type MailSuggestion, type MailHandledState, type SuggestionReason,
} from './lib/mailSuggest';
import {
  groupThreads, threadIndex, threadsAwaitingReply, threadsAwaitingTheirReply,
  threadSuggestions, WAIT_LEDGER_PREFIX, CHASE_LEDGER_PREFIX,
  type MailThread, type ThreadSuggestion,
} from './lib/mailThreads';
import FollowUpLetterModal from './components/FollowUpLetterModal';
import type { FollowUpInfo } from './lib/followUp';
import {
  Mail, RefreshCw, Search, AlertCircle, Wifi, WifiOff,
  Plus, Paperclip, Inbox, Send, Download,
  Sparkles, Check, X, Target, FileText, CheckSquare, CalendarClock, RotateCcw,
  MessageSquare, Clock, Reply,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BRIDGE_URL, bridgeHeaders } from './lib/outlookBridge';

// Shipped in public/downloads — Vite copies it into dist/ as-is, so the same
// relative path works on GitHub Pages (vite base is './').
const BRIDGE_DOWNLOAD_URL = 'downloads/ETaske-OutlookBridge.exe';

// Auto-pull (queue task B1). While this page is open and the tab is visible the
// inbox is re-read on its own, so a new mail turns into a suggestion without
// anybody pressing Refresh. Two minutes is plenty for a mailbox and keeps the
// localhost chatter invisible. The switch is remembered per browser.
const AUTO_SYNC_MS = 120000;
const AUTO_SYNC_KEY = 'etaske-outlook-autosync';

const readAutoSync = (): boolean => {
  try {
    return localStorage.getItem(AUTO_SYNC_KEY) !== 'off';
  } catch {
    return true; // storage blocked — auto-sync is the default
  }
};

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
  /** Accepting a bid/correspondence suggestion hands the form to that board. */
  onNavigate: (v: AppView) => void;
}

/** The icon + wording each suggested record type gets. */
const KIND_ICON: Record<MailSuggestion['kind'], React.ReactNode> = {
  opportunity: <Target size={13} />,
  corresponding: <FileText size={13} />,
  task: <CheckSquare size={13} />,
};

const KIND_LABEL: Record<MailSuggestion['kind'], string> = {
  opportunity: 'Create opportunity?',
  corresponding: 'Log as correspondence?',
  task: 'Create task?',
};

const CONFIDENCE_COLOR: Record<MailSuggestion['confidence'], string> = {
  high: '#22c55e',
  medium: '#f59e0b',
  low: '#94a3b8',
};

function importanceBadgeClass(imp: string) {
  if (imp === 'High') return 'badge badge-urgent';
  if (imp === 'Low') return 'badge badge-low';
  return 'badge badge-medium';
}

// Both helpers take the translator rather than calling a hook: they run outside
// the component (and inside a useMemo), so `t` has to be handed to them.
function formatRelativeTime(isoString: string, t: TFunction, lang: Language): string {
  if (!isoString) return '';
  return fmtAgo(isoString, lang, t);
}

/** Plain wording for one machine reason code (src/lib/mailSuggest.ts). */
function reasonText(r: SuggestionReason, t: TFunction): string {
  switch (r.code) {
    case 'tender-words':
    case 'letter-words':
      return t('mentions “{{word}}”', { word: r.value });
    case 'action-words':
      return t('asks for something to be done', { word: r.value });
    case 'known-client':
      return t('{{client}} is already on your boards', { client: r.value });
    case 'internal-sender':
      return t('from a colleague');
    case 'external-sender':
      return t('from outside the company');
    case 'deadline':
      return t('date in the mail: {{date}}', { date: r.value });
    case 'attachment':
      return t('has attachments');
    case 'high-importance':
      return t('marked high importance');
    default:
      return '';
  }
}

// Who the email is "with": the sender for incoming mail, the recipients for sent mail.
function counterparty(email: OutlookEmail, t: TFunction): string {
  if (email.direction === 'sent') return email.to || (email.recipients || []).join('; ') || t('(no recipient)');
  return email.sender || t('(unknown sender)');
}

export default function OutlookFeed({ user, appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [folder, setFolder] = useState<MailFolder>('Inbox');
  const [emails, setEmails] = useState<OutlookEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<OutlookEmail | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [creatingFrom, setCreatingFrom] = useState<OutlookEmail | null>(null);
  // ── Suggestions (queue task B1) ─────────────────────────────────────────
  const [autoSync, setAutoSync] = useState(readAutoSync);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [handled, setHandled] = useState<Record<string, MailHandledState>>(() => loadMailLedger());
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  // ── Threads + the "nobody replied" flag (queue task B2) ─────────────────
  // The list on screen is filtered by folder and search; these two are the
  // unfiltered copies the thread grouping needs.
  const [inboxMail, setInboxMail] = useState<OutlookEmail[]>([]);
  const [sentMail, setSentMail] = useState<OutlookEmail[]>([]);
  const [waitingOpen, setWaitingOpen] = useState(true);
  const [chasing, setChasing] = useState(false);
  // ── Ready-made follow-up letters (queue task B4) ────────────────────────
  const [noAnswerOpen, setNoAnswerOpen] = useState(true);
  const [letterFor, setLetterFor] = useState<FollowUpInfo | null>(null);

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
      const rows: OutlookEmail[] = await res.json();
      setEmails(rows);
      // Keep the unfiltered folder for the thread grouping (queue task B2):
      // a search narrows what is on screen, it must not narrow the threads.
      if (!searchQuery) {
        if (mailFolder === 'Inbox') setInboxMail(rows);
        else setSentMail(rows);
      }
      setLastSync(new Date().toISOString());
    } catch (e: any) {
      setError(e.message || t('Failed to fetch emails'));
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Sent Items in the background (queue task B2). "Nobody replied" can only be
  // answered by what WE sent, so the sent folder is read even while the user is
  // looking at the inbox. It never touches `emails` — only the thread grouping.
  const fetchSent = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '60', folder: 'Sent Items' });
      const res = await fetch(`${BRIDGE_URL}/emails?${params}`, { headers: bridgeHeaders, signal: AbortSignal.timeout(10000), targetAddressSpace: 'loopback' } as RequestInit);
      if (res.ok) setSentMail(await res.json());
    } catch {
      /* the flag simply stays quiet until the bridge answers */
    }
  }, []);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  useEffect(() => {
    if (status?.outlook_connected) fetchSent();
  }, [status?.outlook_connected, fetchSent]);

  // Debounced — also re-runs when the user switches between Inbox and Sent.
  useEffect(() => {
    const t = setTimeout(() => fetchEmails(search, folder), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [search, folder, fetchEmails]);

  // ── Auto-pull (queue task B1) ─────────────────────────────────────────────

  // The interval must not be torn down and rebuilt every time `fetchEmails`
  // gets a new identity, so it calls through a ref instead of depending on it.
  const fetchRef = useRef(fetchEmails);
  fetchRef.current = fetchEmails;
  const sentRef = useRef(fetchSent);
  sentRef.current = fetchSent;

  useEffect(() => {
    if (!autoSync) return;
    const id = setInterval(() => {
      // Skip a tick rather than pile up work: nothing to read in a background
      // tab, nothing to suggest from Sent Items, and a search is already being
      // re-run by the debounced effect above.
      if (document.hidden) return;
      if (!status?.outlook_connected) return;
      if (folder !== 'Inbox' || search) return;
      fetchRef.current('', 'Inbox');
      sentRef.current(); // keeps the "nobody replied" flag honest
    }, AUTO_SYNC_MS);
    return () => clearInterval(id);
  }, [autoSync, folder, search, status?.outlook_connected]);

  const toggleAutoSync = () => {
    setAutoSync(prev => {
      const next = !prev;
      try { localStorage.setItem(AUTO_SYNC_KEY, next ? 'on' : 'off'); } catch { /* private mode */ }
      return next;
    });
  };

  // ── What the boards already know about clients ────────────────────────────
  // The suggestion engine matches a sender or a subject against these, so an
  // AGIBA mail can say "AGIBA — already on your boards" and point at the record.
  // Shared with the one-box capture on Home (src/hooks/useKnownParties.ts).
  const { parties } = useKnownParties();

  // ── The suggestion queue ──────────────────────────────────────────────────

  const ownDomain = (appUser.email || user.email || '').split('@')[1] || '';

  // Inbox and Sent are grouped together (queue task B2): one reply chain = one
  // thread = one suggested record, and a chain nobody answered can be spotted.
  const threads = useMemo(
    () => groupThreads([...inboxMail, ...sentMail]),
    [inboxMail, sentMail],
  );

  /** Which thread each message on screen belongs to — for the list badges. */
  const byMessage = useMemo(() => threadIndex(threads), [threads]);

  const suggestions = useMemo(
    () => threadSuggestions(threads, { ownDomain, parties, handled }),
    [threads, ownDomain, parties, handled],
  );

  /** Threads that came in and have had no answer for two working days. */
  const waiting = useMemo(() => threadsAwaitingReply(threads, handled), [threads, handled]);

  /** The mirror (queue task B4): WE wrote last and they have gone quiet. */
  const noAnswer = useMemo(() => threadsAwaitingTheirReply(threads, handled), [threads, handled]);

  // Rows waved away on either chase list live in the same ledger under a
  // prefix, so they must not be counted as "emails already dealt with".
  const handledCount = useMemo(
    () => Object.keys(handled).filter(
      k => !k.startsWith(WAIT_LEDGER_PREFIX) && !k.startsWith(CHASE_LEDGER_PREFIX),
    ).length,
    [handled],
  );

  // ── Create task ───────────────────────────────────────────────────────────

  const openCreateTask = (email: OutlookEmail, asFollowUp = false) => {
    setChasing(asFollowUp);
    setCreatingFrom(email);
    setShowCreateTask(true);
  };

  /** Turn an unanswered thread into a follow-up task (queue task B2). */
  const chaseThread = (th: MailThread) => {
    const head = th.lastIncoming;
    const email = head && (inboxMail.find(e => e.id === head.id) || emails.find(e => e.id === head.id));
    if (email) openCreateTask(email, true);
  };

  /** Stop flagging one thread — it stays quiet until "Show them again". */
  const dismissWaiting = (th: MailThread) => {
    setHandled(markMailHandled(WAIT_LEDGER_PREFIX + th.key, 'dismissed', handled));
  };

  /**
   * Draft the reminder for a thread they have not answered (queue task B4).
   * The letter is written from OUR last message — that is the one they owe a
   * reply to — and is signed by whoever is looking at the screen.
   */
  const draftLetter = (th: MailThread) => {
    const ours = th.lastOutgoing;
    setLetterFor({
      subject: th.title,
      counterparty: th.counterparty || undefined,
      email: th.lastIncoming?.sender_email || undefined,
      ourName: appUser.displayName || undefined,
      lastContact: ours?.received_at ? fmt.date(ours.received_at) : undefined,
      waitingDays: th.theirWaitingDays,
    });
  };

  /** Stop offering a letter for one thread. */
  const dismissNoAnswer = (th: MailThread) => {
    setHandled(markMailHandled(CHASE_LEDGER_PREFIX + th.key, 'dismissed', handled));
  };

  /**
   * Accept a suggestion. A task opens the panel this page already owns; a bid or
   * a correspondence is handed to its own board prefilled (src/lib/createIntent)
   * because that is where the form, the serial and the links live. Nothing is
   * written to Firestore here — the user still presses Save over there.
   */
  const acceptSuggestion = (s: ThreadSuggestion) => {
    const email = inboxMail.find(e => e.id === s.emailId) || emails.find(e => e.id === s.emailId);
    // Filed under the THREAD key, not the message id: settling one mail settles
    // the whole chain, so the next reply in it does not offer a second record.
    setHandled(markMailHandled(s.threadKey, 'accepted', handled));

    if (s.kind === 'task') {
      if (email) openCreateTask(email);
      return;
    }
    if (s.kind === 'opportunity') {
      requestCreate({
        type: 'opportunity',
        prefill: {
          title: s.title,
          client: s.client,
          tenderNumber: s.tenderNumber,
          submissionDeadline: s.deadline,
          scope: email?.body_preview?.slice(0, 600),
        },
      });
      onNavigate('opportunities');
      return;
    }
    requestCreate({
      type: 'corresponding',
      prefill: {
        subject: s.title,
        body: email?.body_preview || '',
        sentFrom: email ? `${email.sender}${email.sender_email ? ` <${email.sender_email}>` : ''}` : s.client,
        category: s.category,
        priority: s.priority,
        deadline: s.deadline,
        dateReceived: email?.received_at ? email.received_at.slice(0, 10) : undefined,
      },
    });
    onNavigate('correspondences');
  };

  const dismissSuggestion = (s: ThreadSuggestion) => {
    setHandled(markMailHandled(s.threadKey, 'dismissed', handled));
  };

  const resetSuggestions = () => {
    try { localStorage.removeItem(MAIL_LEDGER_KEY); } catch { /* private mode */ }
    setHandled({});
  };

  // Seeds the shared create-task form. Everything else about that form — its
  // fields, layout and the notifications it fires — is the Tasks dashboard's.
  const taskPrefill = useMemo(() => creatingFrom ? {
    taskName: chasing
      ? t('Follow up: {{subject}}', { subject: creatingFrom.subject })
      : creatingFrom.subject,
    description: `${creatingFrom.direction === 'sent'
      ? `${t('To:')}${counterparty(creatingFrom, t)}`
      : `${t('From:')}${creatingFrom.sender} <${creatingFrom.sender_email}>`}

${creatingFrom.body_preview}`,
    priority: (chasing || creatingFrom.importance === 'High' ? 'High' : 'Medium') as TaskPriority,
    category: 'Internal' as CorrespondingCategory,
    department: appUser.department || 'None',
  } : undefined, [creatingFrom, appUser.department, chasing, t]);


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
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>{t('Outlook Feed')}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>{t('Read local Outlook inbox & sent mail · create tasks instantly')}</p>
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
              ? <><Wifi size={13} color="#22c55e" /><span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>{t('Bridge connected')}</span></>
              : <><WifiOff size={13} color="#ef4444" /><span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>{t('Bridge offline')}</span></>
            }
          </div>

          <a
            href={BRIDGE_DOWNLOAD_URL}
            download="ETaske-OutlookBridge.exe"
            title={t('Download the ETaske Outlook Bridge for Windows')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 13,
              textDecoration: 'none',
            }}
          >
            <Download size={14} />
            {t('Bridge for Windows')}
          </a>

          {/* Auto-sync switch — the whole point of B1 is that nobody has to
              press Refresh, but a user who wants the page quiet can say so. */}
          <button
            onClick={toggleAutoSync}
            title={autoSync
              ? t('Checking Outlook by itself every 2 minutes')
              : t('Automatic checking is off — use Refresh')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${autoSync ? 'var(--accent)' : 'var(--border)'}`,
              background: autoSync ? 'rgba(59,130,246,0.10)' : 'var(--surface-2)',
              color: autoSync ? 'var(--accent)' : 'var(--text-3)',
            }}
          >
            <Sparkles size={14} />
            {autoSync ? t('Auto-sync on') : t('Auto-sync off')}
          </button>

          <button
            onClick={() => { checkStatus(); fetchEmails(search, folder); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 13,
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {t('Refresh')}
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
                {t('ETaske Outlook Bridge is not running')}
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 10px' }}>
                {t('To read your Outlook emails here, run the local bridge tool on this PC first.')}
              </p>
              {/* The <strong> spans were mid-sentence emphasis, which Arabic
                  reorders — each step is now one whole translatable line. */}
              <ol style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>
                <li>{t('Download ETaske-OutlookBridge.exe with the button below')}</li>
                <li>{t('Double-click it — a small status window will appear. Keep it open.')}</li>
                <li>{t('Come back here and click Refresh')}</li>
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
                <Download size={15} /> {t('Download Bridge for Windows')}
              </a>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '8px 0 0' }}>
                {t('Windows only · requires Outlook installed · ~22 MB.')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Waiting for a reply — threads nobody answered (queue task B2).
          Only shown on the Inbox: it is about incoming mail. */}
      {connected && waiting.length > 0 && folder === 'Inbox' && (
        <div style={{
          marginBottom: 20, borderRadius: 12, overflow: 'hidden',
          border: '1px solid rgba(245,158,11,0.35)', background: 'var(--surface-2)',
        }}>
          <button
            onClick={() => setWaitingOpen(o => !o)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'start',
              padding: '12px 16px', border: 'none', cursor: 'pointer',
              background: 'rgba(245,158,11,0.12)',
            }}
          >
            <Clock size={16} color="#f59e0b" />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
              {t('Waiting for a reply')}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 700, color: '#fff', background: '#f59e0b',
              borderRadius: 10, padding: '1px 8px',
            }}>
              {waiting.length}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginInlineStart: 'auto' }}>
              {waitingOpen ? t('Hide') : t('Show')}
            </span>
          </button>

          {waitingOpen && (
            <div style={{ padding: '4px 10px 10px' }}>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '8px 6px 10px', lineHeight: 1.6 }}>
                {t('Nothing has gone back to these yet. Weekends do not count.')}
              </p>

              {waiting.map(th => (
                <div
                  key={th.key}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '12px 14px', marginBottom: 6, borderRadius: 10,
                    background: 'var(--surface-1)', border: '1px solid var(--border)',
                  }}
                >
                  <Clock size={15} color="#f59e0b" style={{ flexShrink: 0, marginTop: 3 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-1)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {th.title}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>
                        {t('No reply for {{count}} working days', { count: th.waitingDays })}
                      </span>
                      {th.counterparty && (
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{th.counterparty}</span>
                      )}
                      {th.count > 1 && (
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                          {t('{{count}} messages in this thread', { count: th.count })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => chaseThread(th)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                        border: 'none', background: '#f59e0b', color: '#fff', cursor: 'pointer',
                      }}
                    >
                      <Reply size={12} /> {t('Follow up')}
                    </button>
                    <button
                      onClick={() => dismissWaiting(th)}
                      title={t('Stop flagging this one')}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 30, borderRadius: 7, cursor: 'pointer',
                        border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-3)',
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* They have not replied — chains where WE wrote last (queue task B4).
          The mirror of the panel above: that one is our debt, this one is
          theirs, and this is the one a ready-made letter is written for. */}
      {connected && noAnswer.length > 0 && folder === 'Inbox' && (
        <div style={{
          marginBottom: 20, borderRadius: 12, overflow: 'hidden',
          border: '1px solid rgba(99,102,241,0.35)', background: 'var(--surface-2)',
        }}>
          <button
            onClick={() => setNoAnswerOpen(o => !o)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'start',
              padding: '12px 16px', border: 'none', cursor: 'pointer',
              background: 'rgba(99,102,241,0.12)',
            }}
          >
            <Send size={16} color="#6366f1" />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
              {t('They have not replied')}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 700, color: '#fff', background: '#6366f1',
              borderRadius: 10, padding: '1px 8px',
            }}>
              {noAnswer.length}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginInlineStart: 'auto' }}>
              {noAnswerOpen ? t('Hide') : t('Show')}
            </span>
          </button>

          {noAnswerOpen && (
            <div style={{ padding: '4px 10px 10px' }}>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '8px 6px 10px', lineHeight: 1.6 }}>
                {t('You wrote last and nothing has come back. Weekends do not count.')}
              </p>

              {noAnswer.map(th => (
                <div
                  key={th.key}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '12px 14px', marginBottom: 6, borderRadius: 10,
                    background: 'var(--surface-1)', border: '1px solid var(--border)',
                  }}
                >
                  <Send size={15} color="#6366f1" style={{ flexShrink: 0, marginTop: 3 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-1)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {th.title}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#6366f1' }}>
                        {t('No answer for {{count}} working days', { count: th.theirWaitingDays })}
                      </span>
                      {th.counterparty && (
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{th.counterparty}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => draftLetter(th)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                        border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer',
                      }}
                    >
                      <FileText size={12} /> {t('Reminder letter')}
                    </button>
                    <button
                      onClick={() => dismissNoAnswer(th)}
                      title={t('Stop flagging this one')}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 30, borderRadius: 7, cursor: 'pointer',
                        border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-3)',
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Suggested records — the auto-pull's output (queue task B1), now one
          card per THREAD rather than per message (queue task B2). */}
      {connected && (suggestions.length > 0 || handledCount > 0) && folder === 'Inbox' && (
        <div style={{
          marginBottom: 20, borderRadius: 12, overflow: 'hidden',
          border: '1px solid var(--border)', background: 'var(--surface-2)',
        }}>
          <button
            onClick={() => setSuggestionsOpen(o => !o)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'start',
              padding: '12px 16px', border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, rgba(139,92,246,0.10), rgba(59,130,246,0.08))',
            }}
          >
            <Sparkles size={16} color="var(--accent)" />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
              {t('Suggested records')}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 700, color: '#fff', background: 'var(--accent)',
              borderRadius: 10, padding: '1px 8px',
            }}>
              {suggestions.length}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginInlineStart: 'auto' }}>
              {suggestionsOpen ? t('Hide') : t('Show')}
            </span>
          </button>

          {suggestionsOpen && (
            <div style={{ padding: '4px 10px 10px' }}>
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '8px 6px 10px', lineHeight: 1.6 }}>
                {t('New mail is read automatically and matched against your clients. Accept opens a form already filled in — nothing is saved until you press Save.')}
                {' '}
                {t('A reply chain is offered once — the newest message speaks for the whole thread.')}
              </p>

              {suggestions.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 6px 10px' }}>
                  {t('Nothing new to suggest right now.')}
                </p>
              )}

              {suggestions.map(s => (
                <div
                  key={s.emailId}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '12px 14px', marginBottom: 6, borderRadius: 10,
                    background: 'var(--surface-1)', border: '1px solid var(--border)',
                  }}
                >
                  <span
                    title={t(s.confidence === 'high' ? 'Strong match' : s.confidence === 'medium' ? 'Likely' : 'Best guess')}
                    style={{
                      width: 8, height: 8, borderRadius: 4, marginTop: 7, flexShrink: 0,
                      background: CONFIDENCE_COLOR[s.confidence],
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        color: 'var(--accent)', border: '1px solid var(--accent)',
                      }}>
                        {KIND_ICON[s.kind]} {t(KIND_LABEL[s.kind])}
                      </span>
                      {s.client && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{s.client}</span>
                      )}
                      {s.deadline && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
                          <CalendarClock size={12} />
                          <span className={fmt.bidi(DATETIME_SHORT)}>{fmt.date(s.deadline)}</span>
                        </span>
                      )}
                      {s.threadCount > 1 && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-3)' }}>
                          <MessageSquare size={12} />
                          {t('{{count}} in this thread', { count: s.threadCount })}
                        </span>
                      )}
                    </div>
                    <p style={{
                      margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-1)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {s.title}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                      {s.reasons.map(r => reasonText(r, t)).filter(Boolean).join(' · ')}
                      {s.tenderNumber ? ` · ${t('Tender no. {{number}}', { number: s.tenderNumber })}` : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => acceptSuggestion(s)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                        border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                      }}
                    >
                      <Check size={12} /> {t('Accept')}
                    </button>
                    <button
                      onClick={() => dismissSuggestion(s)}
                      title={t('Not this one')}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 30, borderRadius: 7, cursor: 'pointer',
                        border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-3)',
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}

              {handledCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', fontSize: 12, color: 'var(--text-3)' }}>
                  <span>{t('{{count}} emails already dealt with', { count: handledCount })}</span>
                  <button
                    onClick={resetSuggestions}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 9px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                      border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)',
                    }}
                  >
                    <RotateCcw size={11} /> {t('Show them again')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Folder tabs — Inbox / Sent */}
      {connected && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {([
            // `id` is the Outlook folder name the bridge expects; `label` is the
            // i18next key.
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
                {t(tab.label)}
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
            placeholder={folder === 'Sent Items' ? t('Search subject, recipient…') : t('Search subject, sender…')}
            style={{
              width: '100%', boxSizing: 'border-box',
              // Logical padding — the icon is at `insetInlineStart`.
              paddingBlock: 10, paddingInlineStart: 38, paddingInlineEnd: 12, borderRadius: 10,
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
              ? t('{{count}} emails in sent items · showing {{shown}}', { count: status.sent_count ?? 0, shown: emails.length })
              : t('{{count}} emails in inbox · showing {{shown}}', { count: status.email_count, shown: emails.length })}
          </span>
          {lastSync && (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              · {t('last checked {{ago}}', { ago: formatRelativeTime(lastSync, t, fmt.lang) })}
            </span>
          )}
        </div>
      )}

      {/* Email list */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-3)' }}>
          <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
          <p style={{ margin: 0 }}>{t('Loading emails…')}</p>
        </div>
      )}

      {!loading && error && (
        <div style={{ textAlign: 'center', padding: 48, color: '#ef4444' }}>
          <AlertCircle size={32} style={{ marginBottom: 12 }} />
          <p style={{ margin: 0, fontWeight: 600 }}>{t('Could not load emails')}</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-3)' }}>{error}</p>
        </div>
      )}

      {!loading && !error && connected && emails.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-3)' }}>
          <Mail size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
          <p style={{ margin: 0 }}>{t('No emails found')}</p>
        </div>
      )}

      {!loading && emails.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {emails.map(email => {
            const isSent = email.direction === 'sent';
            const party = counterparty(email, t);
            // The chain this message sits in (queue task B2) — undefined while
            // the unfiltered copies are still loading.
            const th = byMessage[email.id];
            const flagged = !!th && th.overdue && th.lastIncoming?.id === email.id;
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
                      {formatRelativeTime(email.received_at, t, fmt.lang)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 13, color: 'var(--text-3)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420,
                    }}>
                      {isSent ? `${t('To:')}${party}` : party}
                    </span>
                    {email.importance !== 'Normal' && (
                      <span className={importanceBadgeClass(email.importance)} style={{ fontSize: 10 }}>
                        {email.importance}
                      </span>
                    )}
                    {th && th.count > 1 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                        <MessageSquare size={11} />
                        {t('{{count}} in this thread', { count: th.count })}
                      </span>
                    )}
                    {flagged && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 11, fontWeight: 600, color: '#f59e0b',
                        background: 'rgba(245,158,11,0.12)', borderRadius: 6, padding: '1px 7px',
                      }}>
                        <Clock size={11} />
                        {t('No reply for {{count}} working days', { count: th.waitingDays })}
                      </span>
                    )}
                    {email.has_attachments && <Paperclip size={12} color="var(--text-3)" />}
                  </div>
                </div>

                <button
                  onClick={e => { e.stopPropagation(); openCreateTask(email); }}
                  title={t('Create task from this email')}
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
                  <Plus size={12} /> {t('Task')}
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
                          <span><strong style={{ color: 'var(--text-2)' }}>{t('To:')}</strong> {party}</span>
                        ) : (
                          <span><strong style={{ color: 'var(--text-2)' }}>{t('From:')}</strong> {email.sender} {email.sender_email ? `<${email.sender_email}>` : ''}</span>
                        )}
                        <span>
                          <strong style={{ color: 'var(--text-2)' }}>{isSent ? t('Sent:') : t('Received:')}</strong>{' '}
                          <span className={fmt.bidi(DATETIME_SHORT)}>{email.received_at ? fmt.dateTime(email.received_at) : '—'}</span>
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
                        <Plus size={14} /> {t('Create Task from this Email')}
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

      {/* Create Task — the same panel the Tasks dashboard uses, prefilled from the
          email. Queue task 5: NO `linkPrefill` on purpose — an Outlook message is
          not a stored record, so there is nothing to inherit from; the panel's own
          link picker is what lets the user attach the new task to a bid/project,
          and it writes the link + the history entry itself. */}
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
        headerTitle={t('Create Task from Email')}
        headerSubtitle={creatingFrom ? counterparty(creatingFrom, t) : undefined}
        sourceStrip={creatingFrom ? (
          <div style={{ padding: '12px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{t('Source email')}</p>
            <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{creatingFrom.subject}</p>
          </div>
        ) : undefined}
      />

      {/* The ready-made chaser (queue task B4) — drafted here, sent by the user. */}
      <FollowUpLetterModal info={letterFor} onClose={() => setLetterFor(null)} />
    </div>
  );
}
