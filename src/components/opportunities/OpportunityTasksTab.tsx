// ─── The "Tasks" tab on an opportunity ───────────────────────────────────────
//
// Two halves of the same idea (queue task 3):
//   • CREATE a task FROM the bid — the shared CreateTaskPanel, opened with the
//     opportunity's link block as its `linkPrefill` (locked, since changing the
//     bid on the bid's own page would move the task off the screen the user is
//     standing on), so the task is born linked instead of being attached
//     afterwards. Queue task 4 moved BOTH the link write and the follow-up
//     entry into the panel itself — one entry point per history echo, or a task
//     created here would be announced twice. This file only reports the result.
//   • LIST the tasks already linked to it, and jump into one.
//
// ★ Reads go through `subscribeVisibleTasks`, NOT a
// `where('opportunityId','==',id)` query. Rules are guards, not row filters: a
// query that could surface someone else's PRIVATE task is rejected outright
// (see src/lib/taskVisibility.ts). The linked set is tiny, so filtering the
// visible tasks client-side costs nothing and needs no composite index.
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'firebase/auth';
import { AppUser, Opportunity, Task } from '../../types';
import { subscribeVisibleTasks } from '../../lib/taskVisibility';
import { buildRecordLinks, MirrorResult } from '../../lib/recordLinks';
import { requestOpen } from '../../lib/deepLink';
import { isOverdue } from '../../utils';
import { useDisplayLabel } from '../../lib/displayLabel';
import { useFormat } from '../../lib/format';
import CreateTaskPanel, { NewTaskDraft } from '../CreateTaskPanel';
import type { AppView } from '../../App';
import {
  Plus, CheckSquare, Target, CalendarClock, User as UserIcon, ChevronRight, Loader2,
} from 'lucide-react';

interface Props {
  opportunity: Opportunity;
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate?: (v: AppView) => void;
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    'In Progress': 'badge-inprogress', Done: 'badge-done',
    Pending: 'badge-pending', Archived: 'badge-archived',
  };
  return `badge ${map[s] || 'badge-pending'}`;
}

const DONE = (t: Task) => t.status === 'Done' || t.status === 'Archived';

export default function OpportunityTasksTab({ opportunity, user, appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const label = useDisplayLabel();
  const fmt = useFormat();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (appUser.status !== 'Approved') return;
    return subscribeVisibleTasks(user.uid, rows => { setTasks(rows); setError(null); }, err => {
      console.error('opportunity tasks listener:', err);
      setTasks([]);
      setError(t('Failed to load the linked tasks.'));
    });
  }, [user.uid, appUser.status, t]);

  const linked = useMemo(() => {
    const rows = (tasks || []).filter(x => x.opportunityId === opportunity.id);
    // Open work first, then the nearest due date; undated tasks sink to the end
    // of their group rather than pretending to be due today.
    return rows.sort((a, b) => {
      if (DONE(a) !== DONE(b)) return DONE(a) ? 1 : -1;
      return (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31');
    });
  }, [tasks, opportunity.id]);

  const openCount = linked.filter(x => !DONE(x)).length;
  const overdueCount = linked.filter(x => !DONE(x) && isOverdue(x.dueDate)).length;

  const links = useMemo(
    () => buildRecordLinks({ id: opportunity.id, title: opportunity.title, serialNumber: opportunity.serialNumber }),
    [opportunity.id, opportunity.title, opportunity.serialNumber],
  );

  // A past submission deadline is not a due date — prefilling one would create
  // a task that is overdue the moment it is saved.
  const prefill = useMemo(() => {
    const d = opportunity.submissionDeadline;
    return d && !isOverdue(d) ? { dueDate: d } : {};
  }, [opportunity.submissionDeadline]);

  // The new task carries the bid identity in its LINK FIELDS, not in copied
  // text — nothing about the bid is duplicated into the name or description.
  // The panel writes the link and the follow-up; this only reports a miss,
  // since the echo is best-effort and the task IS created and linked either way.
  const onCreated = (_taskId: string, _draft: NewTaskDraft, mirror?: MirrorResult) => {
    setNote(mirror && !mirror.opportunity
      ? t('The task was created and linked, but its entry could not be added to this bid’s history.')
      : null);
  };

  const open = (task: Task) => {
    requestOpen({ type: 'task', id: task.id, label: task.taskName, serial: task.serialNumber });
    onNavigate?.('tasks');
  };

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {error && (
        <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#991b1b', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}
      {note && (
        <div style={{ padding: '10px 14px', background: '#fef3c7', color: '#92400e', fontSize: 13, fontWeight: 600 }}>
          {note}
        </div>
      )}

      {/* Header: what this tab is, and the one action it offers */}
      <div className="card" style={{ padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <CheckSquare className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              {t('Work on this bid')}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {tasks === null
              ? t('Loading linked tasks…')
              : linked.length === 0
                ? t('No task is linked to this bid yet.')
                : t('{{open}} open · {{total}} linked in total', { open: openCount, total: linked.length })}
            {overdueCount > 0 && (
              <span style={{ color: '#dc2626', fontWeight: 700 }}>
                {' · '}{t('{{count}} overdue', { count: overdueCount })}
              </span>
            )}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4" /> {t('New task for this bid')}
        </button>
      </div>

      {/* The linked tasks */}
      {tasks === null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)', padding: '10px 2px' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> {t('Loading linked tasks…')}
        </div>
      ) : linked.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Target style={{ width: 28, height: 28 }} /></div>
          <p className="empty-state-title">{t('Nothing is being worked on for this bid')}</p>
          <p className="empty-state-sub">
            {t('A task created here is linked to the bid, and its progress is echoed into this bid’s history.')}
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" /> {t('New task for this bid')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {linked.map(task => {
            const late = !DONE(task) && isOverdue(task.dueDate);
            const owner = projectUsers.find(u => u.id === task.assignedToId);
            return (
              <button
                key={task.id}
                onClick={() => open(task)}
                className="card"
                style={{
                  padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
                  width: '100%', textAlign: 'start', cursor: 'pointer', font: 'inherit',
                  borderInlineStart: `3px solid ${late ? '#dc2626' : DONE(task) ? 'var(--green-400)' : 'var(--accent)'}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    {task.serialNumber && (
                      <span className="ltr-data" style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-muted)' }}>
                        {task.serialNumber}
                      </span>
                    )}
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>{task.taskName}</span>
                    <span className={statusBadge(task.status)}>{label(task.status)}</span>
                    {late && <span className="badge badge-urgent">{t('OVERDUE')}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
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
                </div>
                <ChevronRight className="w-4 h-4 dir-arrow" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}

      <CreateTaskPanel
        open={creating}
        onClose={() => setCreating(false)}
        user={user}
        appUser={appUser}
        projectUsers={projectUsers}
        tasks={tasks || undefined}
        prefill={prefill}
        linkPrefill={links}
        lockOpportunity
        headerIcon={<Target style={{ width: 16, height: 16, color: '#fff' }} />}
        headerTitle={t('New task for this bid')}
        headerSubtitle={opportunity.serialNumber
          ? t('Linked to {{serial}}', { serial: opportunity.serialNumber })
          : t('Linked to this opportunity')}
        sourceStrip={(
          <div style={{ padding: '12px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{t('Linked opportunity')}</p>
            <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{opportunity.title}</p>
          </div>
        )}
        onCreated={onCreated}
      />
    </div>
  );
}
