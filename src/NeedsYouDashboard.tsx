import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat, DATE_MEDIUM } from './lib/format';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './lib/firebase';
import { subscribeVisibleTasks } from './lib/taskVisibility';
import { User } from 'firebase/auth';
import { AppUser, Task, Corresponding } from './types';
import { AppView } from './App';
import { isDueSoon, isOverdue } from './utils';
import { requestOpen } from './lib/deepLink';
import {
  AlertCircle, ArrowRight, Clock, CheckSquare, MailOpen,
  X, Calendar, Flag, Building2, FileText, ExternalLink, ChevronUp, ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDisplayLabel } from './lib/displayLabel';
import { getUserColor } from './utils';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

type Kind = 'Task' | 'Correspondence';
type Reason = 'overdue' | 'due-soon' | 'review';
type Tab = 'due' | 'today' | 'yesterday' | 'week';

type Row = {
  id: string;
  kind: Kind;
  title: string;
  serial?: string;
  due?: string;          // deadline / dueDate
  from?: string;         // correspondence sender
  assignedTo?: string;
  reason?: Reason;       // due tab only
  ts?: number;           // feed tabs: createdAt millis, for ordering
};

const CLOSED = ['Done', 'Closed', 'Archived'];

// Overdue first, then the 48h window, then the triage queue — the order the
// user should work them in.
const REASON_RANK: Record<Reason, number> = { overdue: 0, 'due-soon': 1, review: 2 };

/** Local YYYY-MM-DD (lexicographically comparable, no timezone drift). */
const dayKey = (d: Date) => d.toLocaleDateString('en-CA');
const daysAgoKey = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKey(d);
};

/**
 * "Needs you today" — the one feed of everything wanting this user's
 * attention. Four tabs:
 *
 *   Due Soon & Overdue — the deadline queue (plus the manager triage queue)
 *   Today / Yesterday / This Week — what was created in that window
 *
 * This page is the ONLY place any of that is rendered: the Home attention
 * list, the per-board `DueSoonBanner` and the Overview "New Today" + "Due Soon"
 * sections were all folded in here, so there is one answer to "what needs me?"
 * instead of five copies drifting apart. Clicking a row deep-links into the
 * originating dashboard and opens that exact record (src/lib/deepLink.ts).
 * Reached from Home, the top-nav alert icon, the command palette, and `g d`.
 */
export default function NeedsYouDashboard({ user, appUser, onNavigate }: Props) {
  const { t } = useTranslation();
  const f = useFormat();
  const dl = useDisplayLabel();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [corrs, setCorrs] = useState<Corresponding[]>([]);
  const [tab, setTab] = useState<Tab>('due');
  // Clicking a row opens the record RIGHT HERE as a modal instead of
  // deep-linking away to its board — the whole point of this page is to work a
  // queue, and bouncing to Tasks/Correspondences for every item meant walking
  // back each time. Closing returns to the list with the tab and scroll intact;
  // the modal still offers "Open in <board>" for the full editable view.
  const [preview, setPreview] = useState<Row | null>(null);

  const isManager = appUser.role === 'Admin' || appUser.role === 'Manager';

  useEffect(() => {
    // Privacy-aware: only tasks this user may read (public + own).
    const unsubT = subscribeVisibleTasks(user.uid, rows => setTasks(rows));
    const unsubC = onSnapshot(collection(db, 'correspondences'), snap => {
      setCorrs(snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Corresponding)));
    });
    return () => { unsubT(); unsubC(); };
  }, [user.uid]);

  const dueRows = useMemo<Row[]>(() => {
    // A record is mine if I own it or collaborate on it. Employees are shown
    // only their own deadlines — someone else's due date is exactly the noise
    // this page exists to cut. Managers/admins are the oversight layer and get
    // the whole visible board.
    const isMine = (r: { assignedToId?: string; collaboratorIds?: string[] }) =>
      r.assignedToId === user.uid || (r.collaboratorIds || []).includes(user.uid);
    const mine = <T extends { assignedToId?: string; collaboratorIds?: string[] }>(rows: T[]) =>
      isManager ? rows : rows.filter(isMine);

    const out: Row[] = [];

    mine(tasks).forEach(tk => {
      if (CLOSED.includes(tk.status) || !tk.dueDate) return;
      const overdue = isOverdue(tk.dueDate);
      if (!overdue && !isDueSoon(tk.dueDate)) return;
      out.push({
        id: tk.id, kind: 'Task', title: tk.taskName, serial: tk.serialNumber,
        due: tk.dueDate, assignedTo: tk.assignedTo,
        reason: overdue ? 'overdue' : 'due-soon',
      });
    });

    const dueCorrIds = new Set<string>();
    mine(corrs).forEach(c => {
      if (CLOSED.includes(c.status) || !c.deadline) return;
      const overdue = isOverdue(c.deadline);
      if (!overdue && !isDueSoon(c.deadline)) return;
      dueCorrIds.add(c.id);
      out.push({
        id: c.id, kind: 'Correspondence', title: c.subject, serial: c.serialNumber,
        due: c.deadline, from: c.sentFrom, assignedTo: c.assignedTo,
        reason: overdue ? 'overdue' : 'due-soon',
      });
    });

    // The triage queue — only for the people who actually triage. A record that
    // is both due and unreviewed keeps its deadline reason: a date can be
    // missed, a queue cannot.
    if (isManager) {
      corrs.forEach(c => {
        if (!['Unread', 'Reviewing'].includes(c.status) || dueCorrIds.has(c.id)) return;
        out.push({
          id: c.id, kind: 'Correspondence', title: c.subject, serial: c.serialNumber,
          due: c.deadline, from: c.sentFrom, assignedTo: c.assignedTo, reason: 'review',
        });
      });
    }

    return out.sort((a, b) =>
      (REASON_RANK[a.reason!] - REASON_RANK[b.reason!]) ||
      (new Date(a.due || 0).getTime() - new Date(b.due || 0).getTime()));
  }, [tasks, corrs, isManager, user.uid]);

  // ─── The recency feed ──────────────────────────────────────────────────────
  // Everything created inside the window, newest first. `dateReceived` is the
  // fallback for correspondences imported without a server timestamp.
  const todayStr = dayKey(new Date());
  const yesterdayStr = daysAgoKey(1);
  const weekStartStr = daysAgoKey(6);   // rolling last 7 days, inclusive of today

  const feed = useMemo(() => {
    const dayOf = (x: any): string =>
      x.createdAt?.toDate?.()?.toLocaleDateString('en-CA') || x.dateReceived || '';

    const rows: (Row & { day: string })[] = [
      ...tasks.map(tk => ({
        id: tk.id, kind: 'Task' as const, title: tk.taskName, serial: tk.serialNumber,
        due: tk.dueDate, assignedTo: tk.assignedTo,
        ts: tk.createdAt?.toDate?.()?.getTime() || 0, day: dayOf(tk),
      })),
      ...corrs.map(c => ({
        id: c.id, kind: 'Correspondence' as const, title: c.subject, serial: c.serialNumber,
        due: c.deadline, from: c.sentFrom, assignedTo: c.assignedTo,
        ts: c.createdAt?.toDate?.()?.getTime() || 0, day: dayOf(c),
      })),
    ].filter(r => r.day).sort((a, b) => b.ts - a.ts);

    // YYYY-MM-DD strings compare correctly lexicographically.
    return {
      today: rows.filter(r => r.day === todayStr),
      yesterday: rows.filter(r => r.day === yesterdayStr),
      week: rows.filter(r => r.day >= weekStartStr && r.day <= todayStr),
    };
  }, [tasks, corrs, todayStr, yesterdayStr, weekStartStr]);

  const counts: Record<Tab, number> = {
    due: dueRows.length,
    today: feed.today.length,
    yesterday: feed.yesterday.length,
    week: feed.week.length,
  };

  // The rows the active tab is showing — also what the modal steps through.
  const rowsForTab: Row[] = tab === 'due' ? dueRows : feed[tab];

  const open = (r: Row) => setPreview(r);

  /** Leave the page for the record's own board (full edit view). */
  const openInBoard = (r: Row) => {
    setPreview(null);
    if (r.kind === 'Task') {
      requestOpen({ type: 'task', id: r.id, label: r.title, serial: r.serial });
      onNavigate('tasks');
    } else {
      requestOpen({ type: 'corresponding', id: r.id, label: r.title, serial: r.serial });
      onNavigate('correspondences');
    }
  };

  // Step to the previous/next row of the current tab without closing — so a
  // queue can be worked straight through.
  const step = (delta: number) => {
    if (!preview) return;
    const i = rowsForTab.findIndex(r => r.kind === preview.kind && r.id === preview.id);
    const next = rowsForTab[i + delta];
    if (i !== -1 && next) setPreview(next);
  };

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setPreview(null); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The live record behind the previewed row (so edits made elsewhere show up).
  const previewTask = preview?.kind === 'Task' ? tasks.find(x => x.id === preview.id) : undefined;
  const previewCorr = preview?.kind === 'Correspondence' ? corrs.find(x => x.id === preview.id) : undefined;

  const fmtDue = (s?: string) => {
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : f.dateTime(d, { ...DATE_MEDIUM, hour: '2-digit', minute: '2-digit' });
  };

  const reasonStyle = (reason: Reason) =>
    reason === 'overdue' ? { label: t('Overdue'), color: '#ef4444' }
      : reason === 'due-soon' ? { label: t('Due Soon'), color: '#f97316' }
        : { label: t('Awaiting review'), color: 'var(--blue-600)' };

  const TABS: [Tab, string][] = [
    ['due', t('Due Soon & Overdue')],
    ['today', t('Today')],
    ['yesterday', t('Yesterday')],
    ['week', t('This Week')],
  ];

  const RowCard = ({ r }: { r: Row }) => {
    const isTask = r.kind === 'Task';
    const accent = r.reason ? reasonStyle(r.reason).color : (isTask ? '#16a34a' : '#3b82f6');
    // On the feed tabs an already-blown deadline still has to be visible.
    const overdue = !r.reason && !!r.due && isOverdue(r.due);
    return (
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={() => open(r)}
        style={{
          padding: '14px 18px', background: 'var(--surface)', cursor: 'pointer',
          borderInlineStart: `4px solid ${accent}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
              color: isTask ? '#16a34a' : '#3b82f6',
            }}>
              {isTask ? <CheckSquare className="w-3.5 h-3.5" /> : <MailOpen className="w-3.5 h-3.5" />}
              {t(r.kind)}
            </span>
            {r.serial && <span className="ltr-data" style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>#{r.serial}</span>}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{r.title}</div>
          <div style={{ fontSize: 12, color: (r.reason === 'overdue' || overdue) ? '#f87171' : 'var(--text-muted)', marginTop: 3 }}>
            {r.due
              ? <>{t('Due:')}<span className="ltr-data">{fmtDue(r.due)}</span></>
              : r.from
                ? <>{t('From:')}<span className={f.bidiFor(r.from)}>{r.from}</span></>
                : null}
            {r.assignedTo ? ` · ${r.assignedTo}` : ''}
          </div>
        </div>
        {r.reason && (
          <span style={{ fontSize: 11, fontWeight: 800, color: reasonStyle(r.reason).color, flexShrink: 0 }}>
            {reasonStyle(r.reason).label}
          </span>
        )}
        <ArrowRight className="w-4 h-4" style={{ color: '#94a3b8', flexShrink: 0 }} />
      </motion.div>
    );
  };

  const Empty = ({ text }: { text: string }) => (
    <div style={{ textAlign: 'center', padding: '64px 16px', color: 'var(--text-muted)' }}>
      <Clock className="w-8 h-8" style={{ margin: '0 auto 12px', opacity: 0.4 }} />
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)' }}>{text}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{t("You're all caught up.")}</div>
    </div>
  );

  const List = ({ rows }: { rows: Row[] }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map(r => <RowCard key={`${r.kind}-${r.id}`} r={r} />)}
    </div>
  );

  return (
    <div style={{ padding: '24px 0', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ background: '#f97316', padding: 8, borderRadius: 0 }}>
          <AlertCircle className="w-5 h-5" style={{ color: '#fff' }} />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{t('Needs you today')}</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>
        {t('Everything waiting on you, plus what has just come in.')}
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 24 }}>
        {TABS.map(([key, label]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '7px 14px', fontSize: 12, fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: '0.04em',
                fontFamily: 'inherit', cursor: 'pointer', borderRadius: 0,
                border: '1px solid var(--border)',
                background: active ? 'var(--accent)' : 'var(--surface-3)',
                color: active ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {label}
              <span style={{
                fontSize: 11, fontWeight: 800, padding: '1px 7px',
                background: active ? 'rgba(255,255,255,0.22)' : 'var(--surface)',
                color: active ? '#fff' : 'var(--text-muted)',
              }}>{counts[key]}</span>
            </button>
          );
        })}
      </div>

      {tab === 'due' && (
        dueRows.length === 0
          ? <Empty text={t('Nothing due soon')} />
          : <List rows={dueRows} />
      )}
      {tab === 'today' && (
        feed.today.length === 0
          ? <Empty text={t('Nothing new yet today.')} />
          : <List rows={feed.today} />
      )}
      {tab === 'yesterday' && (
        feed.yesterday.length === 0
          ? <Empty text={t('Nothing was created yesterday.')} />
          : <List rows={feed.yesterday} />
      )}
      {tab === 'week' && (
        feed.week.length === 0
          ? <Empty text={t('Nothing was created this week.')} />
          : <List rows={feed.week} />
      )}

      {/* ── Record preview ──────────────────────────────────────────────────
          Read-only detail of the clicked row. Closing drops straight back on
          the list (same tab, same scroll) and ↑/↓ walk the queue, so a user
          never has to navigate back to this page between records. */}
      <AnimatePresence>
        {preview && (() => {
          const isTask = preview.kind === 'Task';
          const rec: any = isTask ? previewTask : previewCorr;
          const idx = rowsForTab.findIndex(r => r.kind === preview.kind && r.id === preview.id);
          const title = rec ? (isTask ? rec.taskName : rec.subject) : preview.title;
          const due = isTask ? rec?.dueDate : rec?.deadline;
          const accent = isTask ? '#16a34a' : '#3b82f6';
          const atStart = idx <= 0;
          const atEnd = idx === -1 || idx >= rowsForTab.length - 1;
          const label = {
            fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase' as const, letterSpacing: '0.05em',
            display: 'block', marginBottom: 4,
          };
          const Field = ({ head, children }: { head: string; children: React.ReactNode }) => (
            <div style={{ minWidth: 0 }}>
              <span style={label}>{head}</span>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
            </div>
          );
          return (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setPreview(null)}
              style={{
                position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(15, 23, 42, 0.6)',
                backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 20,
              }}
            >
              <motion.div
                initial={{ y: 20, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: 0.96 }}
                className="card"
                onClick={e => e.stopPropagation()}
                style={{
                  width: '100%', maxWidth: 640, maxHeight: '88vh', padding: 0,
                  display: 'flex', flexDirection: 'column', overflow: 'hidden',
                  borderInlineStart: `4px solid ${accent}`,
                }}
              >
                {/* Header */}
                <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 800,
                        textTransform: 'uppercase', letterSpacing: '0.04em', color: accent,
                      }}>
                        {isTask ? <CheckSquare className="w-3.5 h-3.5" /> : <MailOpen className="w-3.5 h-3.5" />}
                        {t(preview.kind)}
                      </span>
                      {preview.serial && <span className="ltr-data" style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>#{preview.serial}</span>}
                      {rec?.status && (
                        <span style={{ padding: '2px 9px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>{dl(rec.status)}</span>
                      )}
                      {rec?.priority && (
                        <span style={{ padding: '2px 9px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>{dl(rec.priority)}</span>
                      )}
                      {preview.reason && (
                        <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: reasonStyle(preview.reason).color }}>{reasonStyle(preview.reason).label}</span>
                      )}
                    </div>
                    <h2 className={f.bidiFor(title)} style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0, lineHeight: 1.3 }}>{title}</h2>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    <button
                      onClick={() => step(-1)} disabled={atStart} title={t('Previous')}
                      style={{ background: 'none', border: 'none', padding: 4, cursor: atStart ? 'default' : 'pointer', opacity: atStart ? 0.3 : 1 }}
                    ><ChevronUp className="w-4 h-4 text-muted" /></button>
                    <button
                      onClick={() => step(1)} disabled={atEnd} title={t('Next')}
                      style={{ background: 'none', border: 'none', padding: 4, cursor: atEnd ? 'default' : 'pointer', opacity: atEnd ? 0.3 : 1 }}
                    ><ChevronDown className="w-4 h-4 text-muted" /></button>
                    <button
                      onClick={() => setPreview(null)} title={t('Close')}
                      style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', marginInlineStart: 4 }}
                    ><X className="w-5 h-5 text-muted" /></button>
                  </div>
                </div>

                {/* Body */}
                <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
                  {!rec ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('Loading...')}</div>
                  ) : (
                    <>
                      <span style={label}>{isTask ? t('Description') : t('Correspondence Body')}</span>
                      <div
                        className={f.bidiFor(isTask ? rec.description : rec.body)}
                        style={{ padding: 14, background: 'var(--surface-3)', border: '1px solid var(--border)', fontSize: 14, lineHeight: 1.65, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', marginBottom: 20 }}
                      >
                        {(isTask ? rec.description : rec.body)
                          || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>{t('No description provided.')}</span>}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, padding: 16, background: 'var(--surface-3)', border: '1px solid var(--border)' }}>
                        <Field head={t('Assigned To')}>
                          <span style={{ width: 10, height: 10, flexShrink: 0, background: getUserColor(rec.assignedToId || rec.assignedTo) }} />
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.assignedTo || t('Unassigned')}</span>
                        </Field>
                        <Field head={t('Due Date')}>
                          <Calendar className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                          <span className="ltr-data" style={{ color: due && isOverdue(due) ? '#dc2626' : 'inherit' }}>{due ? fmtDue(due) : t('No deadline')}</span>
                        </Field>
                        {!isTask && (
                          <Field head={t('Sent From')}>
                            <Building2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                            <span className={f.bidiFor(rec.sentFrom)}>{rec.sentFrom || '—'}</span>
                          </Field>
                        )}
                        {!isTask && rec.dateReceived && (
                          <Field head={t('Date Received')}>
                            <Flag className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                            <span className="ltr-data">{rec.dateReceived}</span>
                          </Field>
                        )}
                        {rec.category && <Field head={t('Category')}><span>{dl(rec.category)}</span></Field>}
                        {rec.department && <Field head={t('Department')}><span>{dl(rec.department)}</span></Field>}
                      </div>
                    </>
                  )}
                </div>

                {/* Footer */}
                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'var(--surface)' }}>
                  <span className="ltr-data" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                    {idx >= 0 ? `${idx + 1} / ${rowsForTab.length}` : ''}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setPreview(null)}
                      style={{ padding: '8px 14px', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface-3)', color: 'var(--text-secondary)' }}
                    >{t('Close')}</button>
                    <button
                      onClick={() => openInBoard(preview)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff' }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      {isTask ? t('Open in Tasks') : t('Open in Correspondences')}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
