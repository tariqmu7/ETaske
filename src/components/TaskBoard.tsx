/**
 * The Tasks page's Board view (Tidy Tasks T4): three columns — Pending ·
 * In Progress · Done — and a card moves between them by drag and drop.
 *
 * Dragging is a mouse convenience only. Every card also carries a "Move to"
 * button with a small menu, so a keyboard user and a phone (where HTML5 drag
 * does not fire on touch) move a card the same way the list's status label
 * does. Both paths end in the caller's `onMove`, i.e. the list's own
 * `handleUpdateTaskStatus` — same write, same notifications, same rules.
 *
 * The card opens the task in the list (where milestones, files and edits
 * live); the board itself only shows, sorts and moves.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Calendar, ArrowRightLeft, Check } from 'lucide-react';
import type { AppUser, Task, TaskStatus } from '../types';
import { useDisplayLabel } from '../lib/displayLabel';
import { isOverdue, isDueSoon } from '../utils';
import { BOARD_STATUSES, boardColumns, columnOf, dropStatus, type BoardStatus } from '../lib/taskBoard';

interface Props {
  /** The board's filtered tasks, already in urgency order. */
  tasks: Task[];
  projectUsers: AppUser[];
  progressOf: (taskId: string) => { done: number; total: number };
  onMove: (taskId: string, status: TaskStatus) => void;
  onOpen: (taskId: string) => void;
  /** Shown instead of the columns when the filters leave nothing at all. */
  empty: React.ReactNode;
}

const DRAG_TYPE = 'text/plain';

export default function TaskBoard({ tasks, projectUsers, progressOf, onMove, onOpen, empty }: Props) {
  const { t } = useTranslation();
  const label = useDisplayLabel();
  const [showAllDone, setShowAllDone] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<BoardStatus | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const cols = useMemo(() => boardColumns(tasks, { showAllDone }), [tasks, showAllDone]);
  const byId = useMemo(() => new Map(tasks.map(tk => [tk.id, tk])), [tasks]);

  if (tasks.length === 0) return <>{empty}</>;

  const move = (taskId: string, target: BoardStatus) => {
    const task = byId.get(taskId);
    if (!task) return;
    const next = dropStatus(task.status, target);
    if (next) onMove(taskId, next);
  };

  const columnItems = (s: BoardStatus) => s === 'Pending' ? cols.pending : s === 'In Progress' ? cols.inProgress : cols.done;
  const columnCount = (s: BoardStatus) => s === 'Done' ? cols.doneTotal : columnItems(s).length;

  const renderCard = (task: Task) => {
    const open = task.status !== 'Done';
    const late = open && isOverdue(task.dueDate);
    const soon = open && !late && isDueSoon(task.dueDate);
    const { done, total } = progressOf(task.id);
    const owner = projectUsers.find(pu => pu.id === task.assignedToId);
    const name = task.assignedTo || '';
    const here = columnOf(task.status);

    return (
      <div
        key={task.id}
        className={`task-card${dragId === task.id ? ' is-dragging' : ''}`}
        data-board-card={task.id}
        data-late={late ? '1' : undefined}
        data-soon={soon ? '1' : undefined}
        draggable
        onDragStart={e => {
          e.dataTransfer.setData(DRAG_TYPE, task.id);
          e.dataTransfer.effectAllowed = 'move';
          setDragId(task.id);
          setMenuFor(null);
        }}
        onDragEnd={() => { setDragId(null); setOverCol(null); }}
        onClick={() => onOpen(task.id)}
      >
        <button
          type="button"
          className="task-card-open"
          onClick={e => { e.stopPropagation(); onOpen(task.id); }}
        >
          {task.serialNumber && <span className="task-row-serial ltr-data">#{task.serialNumber}</span>}
          <span dir="auto" className="task-card-title">{task.taskName}</span>
        </button>

        <div className="task-card-meta">
          <span className="task-card-owner" title={name || t('Unassigned')}>
            {owner?.photoURL
              ? <img src={owner.photoURL} className="avatar" style={{ width: 18, height: 18, objectFit: 'cover', flexShrink: 0 }} alt="" />
              : <span className="task-row-initial" aria-hidden>{(name.trim()[0] || '?').toUpperCase()}</span>}
            <span className="task-row-ellipsis">{name || t('Unassigned')}</span>
          </span>

          {task.dueDate && (
            <span
              className="task-card-due"
              title={late ? t('OVERDUE') : soon ? t('DUE SOON') : undefined}
            >
              {late ? <AlertCircle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
              <span className="ltr-data">{task.dueDate}</span>
            </span>
          )}

          {total > 0 && (
            <span className="task-card-progress" title={t('{{done}}/{{total}} milestones', { done, total })}>
              <span className="task-row-bar"><span style={{ width: `${Math.round((done / total) * 100)}%` }} /></span>
              <span className="ltr-data">{done}/{total}</span>
            </span>
          )}

          <span className="task-card-move" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="task-card-move-btn"
              aria-haspopup="menu"
              aria-expanded={menuFor === task.id}
              aria-label={t('Move to')}
              title={t('Move to')}
              data-move-for={task.id}
              onClick={() => setMenuFor(menuFor === task.id ? null : task.id)}
            >
              <ArrowRightLeft style={{ width: 14, height: 14 }} />
            </button>
            {menuFor === task.id && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setMenuFor(null)} />
                <div
                  role="menu"
                  className="task-card-menu"
                  onKeyDown={e => { if (e.key === 'Escape') setMenuFor(null); }}
                >
                  {BOARD_STATUSES.map(s => (
                    <button
                      key={s}
                      type="button"
                      role="menuitemradio"
                      aria-checked={here === s}
                      data-move-option={s}
                      autoFocus={here !== s && s === BOARD_STATUSES.find(x => x !== here)}
                      onClick={() => { setMenuFor(null); move(task.id, s); }}
                    >
                      <Check style={{ width: 14, height: 14, flexShrink: 0, color: 'var(--accent)', visibility: here === s ? 'visible' : 'hidden' }} />
                      {label(s)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="task-board" data-task-board>
      {BOARD_STATUSES.map(s => {
        const items = columnItems(s);
        const late = s === 'Done' ? 0 : items.filter(tk => isOverdue(tk.dueDate)).length;
        return (
          <section
            key={s}
            className={`task-board-col${overCol === s ? ' is-over' : ''}`}
            data-board-col={s}
            aria-label={label(s)}
            onDragOver={e => {
              if (!dragId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overCol !== s) setOverCol(s);
            }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol(prev => (prev === s ? null : prev));
            }}
            onDrop={e => {
              e.preventDefault();
              const id = e.dataTransfer.getData(DRAG_TYPE) || dragId;
              setDragId(null);
              setOverCol(null);
              if (id) move(id, s);
            }}
          >
            <header className="task-board-head" data-status={s}>
              <span className="task-board-dot" aria-hidden />
              <span className="task-board-name">{label(s)}</span>
              <span className="task-board-count ltr-data" data-col-count>{columnCount(s)}</span>
              {late > 0 && <span className="group-head-chip group-head-chip--late">{t('Late: {{count}}', { count: late })}</span>}
            </header>

            <div className="task-board-list">
              {items.map(renderCard)}
              {items.length === 0 && (
                <p className="task-board-empty">{dragId ? t('Drop a task here') : t('No tasks here')}</p>
              )}
            </div>

            {s === 'Done' && (cols.doneHidden > 0 || (showAllDone && cols.doneTotal > 5)) && (
              <button
                type="button"
                className="btn btn-ghost btn-sm task-finished-toggle"
                data-done-toggle={showAllDone ? 'fewer' : 'all'}
                onClick={() => setShowAllDone(v => !v)}
              >
                {showAllDone ? t('Show fewer') : t('Show all {{count}}', { count: cols.doneTotal })}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
