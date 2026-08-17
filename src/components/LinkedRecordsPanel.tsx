// ─── "Linked records": the REVERSE view of a cross-record link ───────────────
//
// Queue task 6. `LinkedRecordsBlock` answers "what is this task attached to?";
// this answers the other direction — "what is attached to this bid / project?"
// — and is the surface the whole cross-linking queue was built for: an email
// logged against a bid, or a task opened on a project, is now findable FROM
// that bid or project instead of only from the record that carries the link.
//
// ★ Tasks are read through `subscribeVisibleTasks`, NOT a
// `where('opportunityId','==',id)` query — the same rule OpportunityTasksTab is
// written against: rules are guards, not row filters, so a query that could
// surface someone else's PRIVATE task is rejected outright. Correspondences are
// readable by every Approved member, so those are a plain collection listener
// filtered client-side; both sets are tiny and neither needs an index.
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'firebase/auth';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AppUser, Corresponding, Task } from '../types';
import { subscribeVisibleTasks } from '../lib/taskVisibility';
import { requestOpen } from '../lib/deepLink';
import { isOverdue } from '../utils';
import { useDisplayLabel } from '../lib/displayLabel';
import { useFormat } from '../lib/format';
import type { AppView } from '../App';
import {
  Link2, Mail, CheckSquare, ChevronRight, Loader2, CalendarClock, User as UserIcon,
} from 'lucide-react';

interface Props {
  /** Which record is being looked at from. */
  target: 'opportunity' | 'project';
  targetId: string;
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate?: (v: AppView) => void;
  /**
   * The opportunity page already has a whole Tasks tab (queue task 3), so its
   * copy of this panel shows the correspondences only and points at that tab
   * rather than listing the same rows twice.
   */
  includeTasks?: boolean;
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    'In Progress': 'badge-inprogress', Done: 'badge-done', Pending: 'badge-pending',
    Archived: 'badge-archived', Closed: 'badge-done', Assigned: 'badge-inprogress',
    Reviewing: 'badge-pending', Unread: 'badge-urgent',
  };
  return `badge ${map[s] || 'badge-pending'}`;
}

const DONE = (t: Task) => t.status === 'Done' || t.status === 'Archived';

export default function LinkedRecordsPanel({
  target, targetId, user, appUser, projectUsers, onNavigate, includeTasks = true,
}: Props) {
  const { t } = useTranslation();
  const label = useDisplayLabel();
  const fmt = useFormat();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [corrs, setCorrs] = useState<Corresponding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!includeTasks || appUser.status !== 'Approved') return;
    return subscribeVisibleTasks(user.uid, rows => setTasks(rows), err => {
      console.error('linked records / tasks listener:', err);
      setTasks([]);
      setError(t('Failed to load the linked records.'));
    });
  }, [user.uid, appUser.status, includeTasks, t]);

  useEffect(() => {
    if (appUser.status !== 'Approved') return;
    return onSnapshot(query(collection(db, 'correspondences')), snap => {
      setCorrs(snap.docs
        .filter(d => d.id !== '--stats--')
        .map(d => ({ id: d.id, ...(d.data() as Corresponding) })));
    }, err => {
      console.error('linked records / correspondences listener:', err);
      setCorrs([]);
      setError(t('Failed to load the linked records.'));
    });
  }, [appUser.status, t]);

  const matches = (rec: { opportunityId?: string; projectId?: string }) =>
    (target === 'opportunity' ? rec.opportunityId : rec.projectId) === targetId;

  const linkedTasks = useMemo(() => (tasks || []).filter(matches).sort((a, b) => {
    if (DONE(a) !== DONE(b)) return DONE(a) ? 1 : -1;
    return (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31');
  }), [tasks, target, targetId]);

  // Newest first: a correspondence is a dated event, not a piece of open work.
  const linkedCorrs = useMemo(() => (corrs || []).filter(matches).sort(
    (a, b) => (b.dateReceived || '').localeCompare(a.dateReceived || ''),
  ), [corrs, target, targetId]);

  const openTask = (task: Task) => {
    requestOpen({ type: 'task', id: task.id, label: task.taskName, serial: task.serialNumber });
    onNavigate?.('tasks');
  };
  const openCorr = (c: Corresponding) => {
    requestOpen({ type: 'corresponding', id: c.id, label: c.subject, serial: c.serialNumber });
    onNavigate?.('correspondences');
  };

  const loading = (includeTasks && tasks === null) || corrs === null;
  const total = linkedTasks.length + linkedCorrs.length;

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Link2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: 0 }}>
          {t('Linked Records')}
        </h3>
      </div>
      {/* ★ No numeric summary line here: the group titles already carry
          "Correspondences (N)" / "Tasks (N)", and a second "1 correspondences ·
          1 tasks" sentence was both ungrammatical at 1 and a bidi hazard — two
          Latin-digit runs separated by a neutral "·" inside an Arabic line get
          reordered. Counts are painted once, inside their own heading. */}
      {(loading || total === 0) && (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 14px' }}>
          {loading
            ? t('Loading linked records…')
            : target === 'opportunity'
              ? t('No correspondence or task is linked to this bid yet.')
              : t('No correspondence or task is linked to this project yet.')}
        </p>
      )}

      {error && (
        <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#991b1b', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> {t('Loading linked records…')}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {linkedCorrs.length > 0 && (
            <div>
              <GroupTitle icon={<Mail className="w-3.5 h-3.5" />}>
                {t('Correspondences ({{count}})', { count: linkedCorrs.length })}
              </GroupTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {linkedCorrs.map(c => (
                  <RowButton key={c.id} onClick={() => openCorr(c)} accent="var(--accent)">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                      {c.serialNumber && <span className="ltr-data" style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-muted)' }}>{c.serialNumber}</span>}
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{c.subject}</span>
                      <span className={statusBadge(c.status)}>{label(c.status)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.sentFrom && <span>{t('From:')}{c.sentFrom}</span>}
                      {c.dateReceived && <span className="ltr-data">{fmt.date(c.dateReceived)}</span>}
                    </div>
                  </RowButton>
                ))}
              </div>
            </div>
          )}

          {includeTasks && linkedTasks.length > 0 && (
            <div>
              <GroupTitle icon={<CheckSquare className="w-3.5 h-3.5" />}>
                {t('Tasks ({{count}})', { count: linkedTasks.length })}
              </GroupTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {linkedTasks.map(task => {
                  const late = !DONE(task) && isOverdue(task.dueDate);
                  const owner = projectUsers.find(u => u.id === task.assignedToId);
                  return (
                    <RowButton
                      key={task.id}
                      onClick={() => openTask(task)}
                      accent={late ? '#dc2626' : DONE(task) ? 'var(--green-400)' : 'var(--accent)'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                        {task.serialNumber && <span className="ltr-data" style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-muted)' }}>{task.serialNumber}</span>}
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{task.taskName}</span>
                        <span className={statusBadge(task.status)}>{label(task.status)}</span>
                        {late && <span className="badge badge-urgent">{t('OVERDUE')}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <UserIcon className="w-3.5 h-3.5" />
                          {owner?.displayName || task.assignedTo || t('Unassigned')}
                        </span>
                        {task.dueDate && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: late ? '#dc2626' : undefined, fontWeight: late ? 700 : 400 }}>
                            <CalendarClock className="w-3.5 h-3.5" />
                            {t('Due {{date}}', { date: fmt.date(task.dueDate) })}
                          </span>
                        )}
                      </div>
                    </RowButton>
                  );
                })}
              </div>
            </div>
          )}

          {!includeTasks && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              {t('Tasks linked to this bid are listed on its Tasks tab.')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GroupTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
      {icon}{children}
    </div>
  );
}

function RowButton({ onClick, accent, children }: { onClick: () => void; accent: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'start',
        padding: '11px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)',
        borderInlineStart: `3px solid ${accent}`, cursor: 'pointer', font: 'inherit',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      <ChevronRight className="w-4 h-4 dir-arrow" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
    </button>
  );
}
