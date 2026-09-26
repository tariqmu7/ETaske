/// <reference types="vite/client" />
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy, where, Timestamp
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { createNotification, notifyManagers } from './lib/pushNotification';
import { taskDetails } from './lib/notifyDetails';
import { User } from 'firebase/auth';
import {
  AppUser, Task, TaskStatus, Milestone, MilestoneStatus, Corresponding, Project, RecordLinks,
  PRIORITY_OPTIONS, MILESTONE_STATUS_OPTIONS, OperationType,
  CATEGORY_OPTIONS, CorrespondingCategory, PROJECT_OPTIONS, DEPARTMENT_OPTIONS,
  NotificationType
} from './types';
import {
  linksOf, newlyLinked, recordLinksPatch, hasAnyLink, mirrorRecordEvent, actorFrom, LinkSource,
} from './lib/recordLinks';
import { getNextSerialNumber } from './lib/counters';
import { subscribeVisibleTasks } from './lib/taskVisibility';
import { consumePending, subscribeOpen } from './lib/deepLink';
import {
  Plus, Clock, AlertCircle, X, ChevronDown, ChevronUp, ChevronRight, ChevronLeft,
  Flag, Target, Calendar, Link2, Edit2, Trash2, CheckCircle2,
  TrendingUp, ListTodo, Filter, Layers, Tag, Archive, Paperclip, Download, ExternalLink,
  Users, Lock, Globe, MapPin, Briefcase, ListChecks, User as UserIcon, LayoutList, Columns3
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { globalSearch, getUserColor, isOverdue, isDueSoon, openOrCopyPath } from './utils';
import { useDisplayLabel } from './lib/displayLabel';
import { useFormat } from './lib/format';
import { Copy, Check } from 'lucide-react';
import ComboBox from './components/ComboBox';
import CreateTaskPanel, { PrivacyToggle, CollaboratorPicker } from './components/CreateTaskPanel';
import RecordLinkPicker from './components/RecordLinkPicker';
import LinkedRecordsBlock from './components/LinkedRecordsBlock';
import GroupByBar, { GroupByOption } from './components/GroupByBar';
import BoardToolbar from './components/BoardToolbar';
import GroupGrid, { GroupCard } from './components/GroupGrid';
import GroupTabs, { GroupTab } from './components/GroupTabs';
import TaskBoard from './components/TaskBoard';
import { buildGroups, UNGROUPED } from './lib/grouping';
import { byTaskUrgency, foldFinished, localToday } from './lib/taskOrder';
import { uploadToDrive } from './lib/driveUpload';
import { attachmentClick } from './lib/driveFiles';
import DriveImage from './components/DriveImage';

function handleFirestoreError(e: unknown, op: OperationType, path: string | null) {
  console.error('Firestore:', { e, op, path });
}

// How a task describes itself in a linked bid's / project's history. One place,
// so "Task TK000123 …" reads the same whichever event wrote it.
const taskSource = (task: Task, status?: TaskStatus): LinkSource => ({
  kind: 'task',
  id: task.id,
  title: task.taskName,
  serialNumber: task.serialNumber,
  status: status || task.status,
  assignedTo: task.assignedTo,
  dueDate: task.dueDate || undefined,
});

function priorityBadge(p: string) {
  const map: Record<string, string> = { Urgent: 'badge-urgent', High: 'badge-high', Medium: 'badge-medium', Low: 'badge-low' };
  return `badge ${map[p] || 'badge-medium'}`;
}

function msBadge(s: MilestoneStatus) {
  const map: Record<string, string> = { 'In Progress': 'badge-inprogress', Done: 'badge-done', Planned: 'badge-pending', Blocked: 'badge-urgent' };
  return `badge ${map[s] || 'badge-pending'}`;
}

/**
 * The dimension the list is bucketed by. `status` is the default: the board's
 * job is "what is pending / being worked on / finished", which is why it
 * replaced the old Project/Internal/External split — that split survives as a
 * *filter* (the button row), where it always belonged.
 */
type TaskGroupBy = 'status' | 'project' | 'location' | 'user';

/** Bucket order for `groupBy === 'status'` — the workflow order, not alphabetical. */
const STATUS_GROUP_ORDER: readonly TaskStatus[] = ['Pending', 'In Progress', 'Done'];

/**
 * Card accent per status. Literal hexes, not CSS vars, because these are the
 * same three colours the status icons in the list already use (`#4ade80` for
 * Done) — the grid must not invent a second palette for the same three words.
 */
const STATUS_ACCENT: Record<string, string> = {
  Pending: '#94a3b8',
  'In Progress': '#3b82f6',
  Done: '#4ade80',
};

/** localStorage key for the "show finished tasks" choice (T2). */
const SHOW_FINISHED_KEY = 'etaske:tasks:showDone';

/** localStorage key for the List / Board choice (T4): 'list' | 'board'. */
const LAYOUT_KEY = 'etaske:tasks:layout';

/** Avatar glyph for the dimensions that have no person to show a face for. */
const GROUP_ICON: Partial<Record<TaskGroupBy, LucideIcon>> = {
  status: ListChecks,
  project: Briefcase,
  location: MapPin,
};

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  initialStatusFilter?: string;
  initialView?: 'mine' | 'all';
}

export default function TasksDashboard({ user, appUser, projectUsers, initialStatusFilter, initialView }: Props) {
  const { t } = useTranslation();
  // Task 6: `label` paints a stored English enum value in the active language;
  // the value written to Firestore is untouched. `fmt` is the Intl layer.
  const label = useDisplayLabel();
  const fmt = useFormat();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [correspondences, setCorrespondences] = useState<Corresponding[]>([]);
  // Projects are read for ONE reason: a task carries no location of its own
  // (see src/types.ts — `location` lives on Project), so "group by location"
  // has to resolve it through `task.projectId`.
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [pendingOpenTaskId, setPendingOpenTaskId] = useState<string | null>(null);
  // Set while a specific task is being opened from outside the list (deep link,
  // Due Soon banner). It bypasses the employee grid, which would otherwise
  // replace the very list the task lives in. Cleared when that task collapses.
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter || 'All');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [view, setView] = useState<'mine' | 'all'>(initialView || 'mine');
  const [milestoneSort, setMilestoneSort] = useState<'asc' | 'desc'>('asc');
  const [newMilestone, setNewMilestone] = useState<{ taskId: string; title: string; targetDate: string } | null>(null);
  const [editingMilestone, setEditingMilestone] = useState<{ id: string; taskId: string; title: string; targetDate: string } | null>(null);
  const [isSavingMilestone, setIsSavingMilestone] = useState(false);
  const [editingStatus, setEditingStatus] = useState<{ taskId: string; status: TaskStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAddingMilestone, setIsAddingMilestone] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  // The edit form's cross-record links (queue task 4). Kept beside the task
  // rather than inside it: what the form writes is a PATCH built by
  // `recordLinksPatch`, because a link the user removed has to be actively
  // cleared — an omitted key would silently keep the old one.
  const [editLinks, setEditLinks] = useState<RecordLinks>({});
  const editingTaskId = editingTask?.id || null;
  useEffect(() => {
    setEditLinks(linksOf(tasks.find(tk => tk.id === editingTaskId) || undefined));
    // Only when a DIFFERENT task is opened — a live snapshot must not overwrite
    // a link the user is in the middle of changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTaskId]);
  const [showAdvancedEdit, setShowAdvancedEdit] = useState(false);
  const [isDragOverEdit, setIsDragOverEdit] = useState(false);
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
  // The status label's menu on a slim row (one open at a time, like the "···").
  const [openStatusMenu, setOpenStatusMenu] = useState<string | null>(null);
  // When a milestone is updated on a task whose due date is already
  // alerting (overdue / due soon), prompt the user to keep, extend, or
  // pick a new due date.
  const [dueDatePrompt, setDueDatePrompt] = useState<{ task: Task; milestoneTitle: string } | null>(null);
  const [promptDueDate, setPromptDueDate] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('All');
  const [subCategoryFilter, setSubCategoryFilter] = useState('All');
  const [groupBy, setGroupBy] = useState<TaskGroupBy>('status');
  // Which group card is open. `null` = the grid itself is showing. Grouping is
  // ALWAYS a grid of cards now (Tariq, 2026-08-26) — the task list is what a
  // card drills into, so this doubles as "grid or list?".
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  // Slim rows (T1) are ~50px, so a page holds more of them than the old cards.
  const itemsPerPage = 30;
  // Finished tasks fold behind "Show N finished" (Tidy Tasks T2). One choice
  // for the whole board, remembered per browser.
  const [showFinished, setShowFinished] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOW_FINISHED_KEY) === '1'; } catch { return false; }
  });
  const toggleShowFinished = () => setShowFinished(prev => {
    const next = !prev;
    try { localStorage.setItem(SHOW_FINISHED_KEY, next ? '1' : '0'); } catch { /* private window */ }
    return next;
  });

  // List or Board (Tidy Tasks T4), remembered per browser. `chooseLayout` is
  // the user's own pick and is saved; a deep link switches to the list for
  // that one visit without overwriting the saved choice.
  const [layout, setLayout] = useState<'list' | 'board'>(() => {
    try { return localStorage.getItem(LAYOUT_KEY) === 'board' ? 'board' : 'list'; } catch { return 'list'; }
  });
  const chooseLayout = (next: 'list' | 'board') => {
    setLayout(next);
    setFocusedTaskId(null);
    try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* private window */ }
  };

  const isManagerOrAdmin = appUser.role === 'Admin' || appUser.role === 'Manager';

  const dynamicSubCategories = useMemo(() => {
    const fromTasks = Array.from(new Set(tasks.map(t => t.subCategory).filter(Boolean))).sort();
    return Array.from(new Set([...PROJECT_OPTIONS, ...fromTasks])).sort();
  }, [tasks]);

  // Departments typed into earlier tasks become suggestions, so a value added
  // once through the combobox is offered from then on.
  const dynamicDepartments = useMemo(() => {
    const fromTasks = tasks.map(t => t.department).filter(Boolean) as string[];
    return Array.from(new Set([...DEPARTMENT_OPTIONS, ...fromTasks]))
      .filter(d => d && d !== 'None' && d !== 'Other...')
      .sort();
  }, [tasks]);

  // 'Other...' was only a trigger for a browser prompt(); the combobox creates
  // values inline, so it is no longer offered as a category.
  const categoryOptions = useMemo(
    () => CATEGORY_OPTIONS.filter(c => c !== 'Other...'),
    []
  );

  // Tasks listener — reads the public-OR-mine union so private tasks owned by
  // other users are never requested (see src/lib/taskVisibility.ts). Sorted
  // client-side below (the union is returned unsorted).
  useEffect(() => {
    if (!appUser || appUser.status !== 'Approved') return;

    const unsub = subscribeVisibleTasks(user.uid, rows => {
      const sorted = [...rows].sort(
        (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
      );
      setTasks(sorted);
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'tasks');
      setError(t('Failed to load tasks. Check your connection.'));
    });
    return () => unsub();
  }, [appUser, user.uid]);

  // Milestones listener
  useEffect(() => {
    if (!appUser || appUser.status !== 'Approved') return;

    const q = query(collection(db, 'milestones'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setMilestones(snap.docs.map(d => ({ id: d.id, ...d.data() } as Milestone)));
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'milestones');
    });
    return () => unsub();
  }, [appUser.status]);
  
  // Correspondences listener for fallback serial numbers
  useEffect(() => {
    if (!appUser || appUser.status !== 'Approved') return;
    const unsub = onSnapshot(collection(db, 'correspondences'), snap => {
      setCorrespondences(snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Corresponding)));
    });
    return () => unsub();
  }, [appUser.status]);

  // Projects listener — only feeds the location lookup below. A failure is not
  // surfaced to the user: it costs the location grouping its labels, nothing
  // else, and the task list itself is unaffected.
  useEffect(() => {
    if (!appUser || appUser.status !== 'Approved') return;
    const unsub = onSnapshot(collection(db, 'projects'), snap => {
      setProjects(snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Project)));
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'projects');
    });
    return () => unsub();
  }, [appUser.status]);

  const projectLocationById = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach(p => { if (p.location?.trim()) map.set(p.id, p.location.trim()); });
    return map;
  }, [projects]);

  // Apply incoming filter/view when navigated here from another view (e.g. Overview stat cards)
  useEffect(() => {
    if (initialStatusFilter) setStatusFilter(initialStatusFilter);
    if (initialView) setView(initialView);
  }, [initialStatusFilter, initialView]);

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (t.status === 'Archived') return false;
      if (view === 'mine' && t.assignedToId !== user.uid && !(t.collaboratorIds || []).includes(user.uid)) return false;
      if (search && !globalSearch(t, search)) return false;
      if (statusFilter === 'Active') { if (t.status === 'Done') return false; }
      else if (statusFilter === 'Overdue') { if (t.status === 'Done' || !isOverdue(t.dueDate)) return false; }
      else if (statusFilter !== 'All' && t.status !== statusFilter) return false;
      if (categoryFilter !== 'All' && t.category !== categoryFilter) return false;
      if (employeeFilter !== 'All' && t.assignedTo !== employeeFilter) return false;
      if (subCategoryFilter !== 'All' && t.subCategory !== subCategoryFilter) return false;
      if (deptFilter !== 'All' && t.department !== deptFilter) return false;
      if (dateFilter) {
        const createdDate = t.createdAt?.toDate?.()?.toISOString()?.split('T')[0];
        if (createdDate !== dateFilter) return false;
      }
      return true;
    });
  }, [tasks, view, search, statusFilter, categoryFilter, employeeFilter, subCategoryFilter, deptFilter, appUser.displayName, isManagerOrAdmin, dateFilter, user.uid]);

  // Reset page when filters change — except when handleOpenTask changed them
  // itself, since it already computed the page holding the target task.
  const skipPageResetRef = useRef(false);
  useEffect(() => {
    if (skipPageResetRef.current) {
      skipPageResetRef.current = false;
      return;
    }
    setCurrentPage(1);
  }, [search, statusFilter, categoryFilter, employeeFilter, subCategoryFilter, deptFilter, dateFilter, view]);

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('All');
    setCategoryFilter('All');
    setEmployeeFilter('All');
    setSubCategoryFilter('All');
    setDeptFilter('All');
    setDateFilter('');
    setView('mine');
    setFocusedTaskId(null);
    setOpenGroup(null);
  };

  // Empty-state copy has to tell three different stories, and the old single
  // "no tasks match your filters" line told the wrong one twice: a board that
  // has never held a task (first run), a "My Tasks" scope with nothing assigned
  // to this user, and filters that genuinely hide everything.
  const hasActiveFilter = search.trim() !== '' || statusFilter !== 'All' || categoryFilter !== 'All'
    || employeeFilter !== 'All' || subCategoryFilter !== 'All' || deptFilter !== 'All' || dateFilter !== '';

  const renderEmpty = (icon: React.ReactNode) => {
    if (tasks.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon">{icon}</div>
          <p className="empty-state-title">{t('No tasks yet')}</p>
          <p className="empty-state-sub">{t('A task is the work itself. Managers create one from a correspondence, or you can add one directly.')}</p>
          <button className="btn btn-ghost btn-sm" onClick={() => setIsAddingTask(true)}>{t('Add Task')}</button>
        </div>
      );
    }
    if (!hasActiveFilter && view === 'mine') {
      return (
        <div className="empty-state">
          <div className="empty-state-icon">{icon}</div>
          <p className="empty-state-title">{t('Nothing assigned to you')}</p>
          <p className="empty-state-sub">{t('You have no open tasks. Switch to All Tasks to see what the rest of the team is working on.')}</p>
          <button className="btn btn-ghost btn-sm" onClick={() => setView('all')}>{t('All Tasks')}</button>
        </div>
      );
    }
    return (
      <div className="empty-state">
        <div className="empty-state-icon">{icon}</div>
        <p className="empty-state-title">{t('No tasks found')}</p>
        <p className="empty-state-sub">{t('No tasks match your current filters.')}<br />{t('Try clearing them or create a new task.')}</p>
        <button className="btn btn-ghost btn-sm" onClick={resetFilters}>{t('Clear All Filters')}</button>
      </div>
    );
  };

  // What a task's group key is, per dimension. Returning an empty string sends
  // the task to the trailing "no value" bucket (`UNGROUPED`).
  const groupKeyOf = useMemo(() => {
    switch (groupBy) {
      case 'status':
        return (t: Task) => t.status;
      // `projectName` is the real projects/{id} link; `subCategory` is the older
      // free-text project string the task form has always written. Both are live
      // (see src/types.ts) so the link wins and the free text is the fallback —
      // otherwise every pre-link task would read "No project".
      case 'project':
        return (t: Task) => t.projectName || (t.subCategory !== 'None' ? t.subCategory : '');
      case 'location':
        return (t: Task) => (t.projectId ? projectLocationById.get(t.projectId) : '');
      case 'user':
        return (t: Task) => t.assignedTo;
    }
  }, [groupBy, projectLocationById]);

  // Buckets over EVERY filtered task, not just the current page. The grid puts
  // a count on each card, and a count taken from one page of 20 would be a lie
  // ("3 tasks" on a card holding 40). Pagination moved below, onto whatever
  // list is actually being shown.
  //
  // Urgent first (T2): late → due within 3 days → later → no date, finished
  // last (see lib/taskOrder.ts). Sorted once here; `buildGroups` keeps the
  // incoming order inside each bucket, so every list below inherits it.
  const today = localToday();
  const ordered = useMemo(
    () => [...filtered].sort(byTaskUrgency<Task>(today)),
    [filtered, today],
  );
  const groupedTasks = useMemo(
    () => buildGroups(ordered, groupKeyOf, {
      order: groupBy === 'status' ? STATUS_GROUP_ORDER : undefined,
    }),
    [ordered, groupKeyOf, groupBy],
  );

  // The open bucket, re-resolved from `groupedTasks` every render: a filter (or
  // someone else's edit landing over the listener) can empty the bucket the
  // user drilled into, and then `find` returns undefined and we fall back to
  // the grid instead of showing a blank list.
  const activeGroup = useMemo(
    () => (openGroup ? groupedTasks.find(g => g.key === openGroup) : undefined),
    [openGroup, groupedTasks],
  );

  // Switching dimension re-buckets everything, so the key that was open no
  // longer means anything — go back to the grid.
  useEffect(() => { setOpenGroup(null); }, [groupBy]);

  // Opening/closing a card swaps the list under the pager, so page 3 of the old
  // list must not survive into the new one.
  useEffect(() => { setCurrentPage(1); }, [openGroup]);

  // A deep link (`handleOpenTask`) targets one task, so it has to bypass the
  // grid entirely — otherwise the shared task is hidden behind a card.
  const showGroupGrid = !focusedTaskId && !activeGroup;

  // Finished work is folded away unless asked for. The task the user has open
  // (or was sent to by a link) stays, even when it is Done.
  const fullList = activeGroup ? activeGroup.items : ordered;
  const fold = useMemo(
    () => foldFinished(fullList, showFinished, [expandedTask, focusedTaskId]),
    [fullList, showFinished, expandedTask, focusedTaskId],
  );
  const listSource = fold.visible;
  const finishedInList = useMemo(() => fullList.filter(tk => tk.status === 'Done').length, [fullList]);

  const paginatedTasks = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return listSource.slice(startIndex, startIndex + itemsPerPage);
  }, [listSource, currentPage]);

  const totalPages = Math.ceil(listSource.length / itemsPerPage);

  // Hiding finished work can leave the pager past its last page.
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  // Header for one bucket. Each dimension gets its own phrasing because a single
  // "{{x}} Tasks" template reads wrong for half of them ("Ahmed Tasks").
  const groupHeading = (group: { key: string; value: string }) => {
    if (group.key === UNGROUPED) {
      switch (groupBy) {
        case 'project': return t('No project');
        case 'location': return t('No location');
        case 'user': return t('Unassigned');
        default: return t('Uncategorized');
      }
    }
    const name = label(group.value);
    switch (groupBy) {
      case 'project': return t('Project: {{name}}', { name });
      case 'location': return t('Location: {{name}}', { name });
      case 'user': return t('Assigned to {{name}}', { name });
      default: return t('{{category}} Tasks', { category: name });
    }
  };

  // The card title is the group's NAME on its own — the "Assigned to …" /
  // "Project: …" framing above belongs on a section header, not under a
  // 44px avatar that already says who this is.
  const groupTitle = (group: { key: string; value: string }) =>
    group.key === UNGROUPED ? groupHeading(group) : label(group.value);

  // What the grid draws. One card per bucket, carrying the count plus the small
  // status breakdown — that breakdown is the whole point of the card: it says
  // what is inside before you open it.
  const groupCards = useMemo<GroupCard[]>(() => groupedTasks.map(group => {
    const items = group.items;
    const pending = items.filter(tk => tk.status === 'Pending').length;
    const inProgress = items.filter(tk => tk.status === 'In Progress').length;
    const done = items.filter(tk => tk.status === 'Done').length;
    const overdue = items.filter(tk => tk.status !== 'Done' && isOverdue(tk.dueDate)).length;

    // Resolve the person through a task's `assignedToId`, not by matching the
    // display name against the directory — the bucket key is a name, and two
    // people can share one.
    const assigneeId = groupBy === 'user' ? items.find(tk => tk.assignedToId)?.assignedToId : undefined;
    const assignee = assigneeId ? projectUsers.find(pu => pu.id === assigneeId) : undefined;
    const title = groupTitle(group);

    return {
      key: group.key,
      title,
      subtitle: groupBy === 'user' && assignee?.role ? label(assignee.role) : undefined,
      accent: groupBy === 'status'
        ? STATUS_ACCENT[group.value] || 'var(--accent)'
        : groupBy === 'user'
          ? (assignee?.userColor || getUserColor(assigneeId || group.value || group.key))
          : getUserColor(group.key),
      photoURL: groupBy === 'user' ? assignee?.photoURL : undefined,
      // A person gets an initial; a project/location/status gets the dimension's
      // icon, so the card still reads as "a thing of this kind".
      initial: groupBy === 'user' ? title.charAt(0).toUpperCase() : undefined,
      icon: groupBy === 'user' ? undefined : GROUP_ICON[groupBy],
      count: items.length,
      countLabel: items.length === 1 ? t('task') : t('tasks'),
      badge: overdue > 0 ? `${overdue} ${t('OVERDUE')}` : undefined,
      // Grouping BY status already puts the status in the title, so repeating
      // the same three chips under it would be pure noise.
      stats: groupBy === 'status' ? undefined : [
        { label: t('Pending'), value: pending, tone: 'neutral' as const },
        { label: t('Active'), value: inProgress, tone: 'info' as const },
        { label: t('Done'), value: done, tone: 'success' as const },
      ],
    };
  }), [groupedTasks, groupBy, projectUsers, label, t]);

  // Per-bucket totals over EVERY filtered task (finished ones too, folded or
  // not) — what the group tabs and the section headers above the rows report,
  // so neither shows one page's worth as if it were the whole group.
  const groupTally = useMemo(() => {
    const m = new Map<string, { open: number; late: number; done: number }>();
    for (const g of groupedTasks) {
      const done = g.items.filter(tk => tk.status === 'Done').length;
      const late = g.items.filter(tk => tk.status !== 'Done' && isOverdue(tk.dueDate)).length;
      m.set(g.key, { open: g.items.length - done, late, done });
    }
    return m;
  }, [groupedTasks]);

  const groupTabs = useMemo<GroupTab[]>(() => groupedTasks.map(g => ({
    key: g.key,
    label: groupTitle(g),
    count: g.items.length,
    late: groupTally.get(g.key)?.late || 0,
  })), [groupedTasks, groupTally, groupBy, label, t]);

  // What the LIST renders. Drilled in = the open bucket, one page of it. Not
  // drilled in = the deep-link case, where the page is re-bucketed as before.
  const renderGroups = useMemo(() => {
    if (activeGroup) return [{ key: activeGroup.key, value: activeGroup.value, items: paginatedTasks }];
    return buildGroups(paginatedTasks, groupKeyOf, {
      order: groupBy === 'status' ? STATUS_GROUP_ORDER : undefined,
    });
  }, [activeGroup, paginatedTasks, groupKeyOf, groupBy]);

  const stats = useMemo(() => ({
    pending: tasks.filter(t => t.status === 'Pending' && (view === 'all' || t.assignedTo === appUser.displayName)).length,
    inProgress: tasks.filter(t => t.status === 'In Progress' && (view === 'all' || t.assignedTo === appUser.displayName)).length,
    done: tasks.filter(t => t.status === 'Done' && (view === 'all' || t.assignedTo === appUser.displayName)).length,
  }), [tasks, view, appUser.displayName]);

  const groupByOptions = useMemo<GroupByOption<TaskGroupBy>[]>(() => [
    { key: 'status', label: t('Status'), icon: ListChecks },
    { key: 'project', label: t('Project'), icon: Briefcase },
    { key: 'location', label: t('Location'), icon: MapPin },
    { key: 'user', label: t('Assignee'), icon: UserIcon },
  ], [t]);

  const getMilestonesForTask = (taskId: string) => milestones.filter(m => m.taskId === taskId);

  // Open a specific task from anywhere (e.g. the "Needs you today" feed). The task may
  // be hidden behind the "My Tasks" view, an active filter, or another page, so
  // clear everything that could hide it, jump to its page, expand it, and
  // scroll it into view once rendered.
  const handleOpenTask = (taskId: string) => {
    setSearch('');
    setStatusFilter('All');
    setCategoryFilter('All');
    setEmployeeFilter('All');
    setSubCategoryFilter('All');
    setDeptFilter('All');
    setDateFilter('');
    setView('all');
    // Grouping normally renders the card grid instead of the list, which would
    // hide the task we are opening. `focusedTaskId` forces the list; clearing
    // `openGroup` matters just as much, because a still-open bucket would keep
    // narrowing the list (and break the page math computed just below).
    setOpenGroup(null);
    setFocusedTaskId(taskId);
    // The open task lives in the list — the board has no room for its panel.
    setLayout('list');

    // With all filters cleared + "All Tasks", the list is every non-archived
    // task in board order with finished work folded (the target always stays),
    // so its page math is reproducible here.
    const defaultList = foldFinished(
      tasks.filter(t => t.status !== 'Archived').sort(byTaskUrgency<Task>(localToday())),
      showFinished,
      [taskId],
    ).visible;
    const idx = defaultList.findIndex(t => t.id === taskId);
    skipPageResetRef.current = true;
    setCurrentPage(idx >= 0 ? Math.floor(idx / itemsPerPage) + 1 : 1);

    setExpandedTask(taskId);

    requestAnimationFrame(() => {
      setTimeout(() => {
        document.getElementById(`task-${taskId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    });
  };

  // Deep-link: a task shared in chat (src/lib/deepLink.ts). The request may
  // arrive before this view is mounted or before `tasks` has loaded, so we
  // stash the id and act on it once the matching task is in the list.
  useEffect(() => {
    const initial = consumePending('task');
    if (initial) setPendingOpenTaskId(initial);
    return subscribeOpen(ref => {
      if (ref.type === 'task') setPendingOpenTaskId(ref.id);
    });
  }, []);

  useEffect(() => {
    if (!pendingOpenTaskId) return;
    if (!tasks.some(t => t.id === pendingOpenTaskId)) return; // wait for data
    handleOpenTask(pendingOpenTaskId);
    setPendingOpenTaskId(null);
  }, [pendingOpenTaskId, tasks]);

  const handleUpdateTask = async () => {
    if (!editingTask || !editingTask.taskName.trim()) return;
    // Read BEFORE the write: the listener may have already replaced the row in
    // `tasks` by the time the awaited update resolves, and the link diff has to
    // compare against what was stored when the form opened.
    const priorLinks = linksOf(tasks.find(tk => tk.id === editingTask.id) || undefined);
    try {
      await updateDoc(doc(db, 'tasks', editingTask.id), {
        // One write, not two: the link patch rides along with the rest of the
        // form (see `recordLinksPatch` — a dropped side is a deleteField()).
        ...recordLinksPatch(editLinks),
        taskName: editingTask.taskName.trim(),
        description: editingTask.description.trim(),
        priority: editingTask.priority,
        category: editingTask.category,
        subCategory: editingTask.subCategory,
        department: editingTask.department || null,
        dueDate: editingTask.dueDate || null,
        assignedTo: editingTask.assignedTo,
        assignedToId: editingTask.assignedToId,
        collaboratorIds: editingTask.collaboratorIds || [],
        collaborators: (editingTask.collaboratorIds || []).map(id => projectUsers.find(u => u.id === id)?.displayName || ''),
        filePaths: editingTask.filePaths || [],
        isPrivate: !!editingTask.isPrivate,
        updatedAt: serverTimestamp(),
      });

      const originalTask = tasks.find(t => t.id === editingTask.id);

      // A record the task was JUST attached to hears about it. A save that left
      // the links untouched posts nothing (`newlyLinked`) — re-saving a form is
      // not an event.
      const freshLinks = newlyLinked(priorLinks, editLinks);
      if (hasAnyLink(freshLinks)) {
        await mirrorRecordEvent(
          freshLinks,
          taskSource(editingTask),
          actorFrom(user.uid, appUser),
          'linked',
        );
      }

      // Notify collaborators newly added in this edit.
      const prevCollabs = originalTask?.collaboratorIds || [];
      const addedCollabs = (editingTask.collaboratorIds || []).filter(id => !prevCollabs.includes(id) && id !== user.uid);
      for (const cid of addedCollabs) {
        await createNotification({
          type: 'task_assigned',
          title: 'Added as Collaborator',
          message: taskDetails(
            `${appUser.displayName} added you as a collaborator on "${editingTask.taskName}".`,
            editingTask,
          ),
          forUserId: cid,
          read: false,
          relatedId: editingTask.id,
          createdAt: serverTimestamp(),
        }, projectUsers);
      }
      
      // Update linked correspondence if exists
      if (originalTask?.correspondingId) {
        await updateDoc(doc(db, 'correspondences', originalTask.correspondingId), {
          assignedTo: editingTask.assignedTo,
          assignedToId: editingTask.assignedToId,
          updatedAt: serverTimestamp(),
        });
      }

      const updatedBody = taskDetails(
        `${appUser.displayName} updated the details of "${editingTask.taskName}".`,
        editingTask,
      );

      if (originalTask && originalTask.assignedById && originalTask.assignedById !== user.uid) {
        await createNotification({
          type: 'task_updated',
          title: 'Task Updated',
          message: updatedBody,
          forUserId: originalTask.assignedById,
          read: false,
          relatedId: editingTask.id,
          createdAt: serverTimestamp(),
        }, projectUsers);
      }

      // Keep the wider management team in the loop. Private tasks are owner-only
      // by design (see taskVisibility.ts), so they never fan out.
      if (!editingTask.isPrivate) {
        await notifyManagers({
          type: 'task_updated',
          title: 'Task Updated',
          message: updatedBody,
          read: false,
          relatedId: editingTask.id,
          createdAt: serverTimestamp(),
        }, projectUsers, {
          actorId: user.uid,
          excludeIds: [originalTask?.assignedById],
        });
      }

      // Notify new assignee if changed
      if (originalTask && originalTask.assignedToId !== editingTask.assignedToId) {
        await createNotification({
          type: 'task_assigned',
          title: 'Task Reassigned',
          message: taskDetails(
            `Task "${editingTask.taskName}" has been reassigned to you by ${appUser.displayName}`,
            editingTask,
          ),
          forUserId: editingTask.assignedToId,
          read: false,
          relatedId: editingTask.id,
          createdAt: serverTimestamp(),
        }, projectUsers);
      }

      setEditingTask(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${editingTask.id}`);
      setError(t('Failed to update task.'));
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, status: TaskStatus) => {
    try {
      const update: any = { status, updatedAt: serverTimestamp() };
      const task = tasks.find(t => t.id === taskId);

      // Perform the announced write first so a failed update never
      // produces a false "status updated" notification.
      await updateDoc(doc(db, 'tasks', taskId), update);

      // The linked bid / project hear about the move. `completed` reads
      // differently from a plain status change, which is the whole point of
      // echoing it — a bid owner scanning history wants the finished line.
      if (task && hasAnyLink(linksOf(task))) {
        await mirrorRecordEvent(
          linksOf(task),
          taskSource(task, status),
          actorFrom(user.uid, appUser),
          status === 'Done' ? 'completed' : 'status',
        );
      }

      if (status === 'Done' && task?.correspondingId) {
        await updateDoc(doc(db, 'correspondences', task.correspondingId), {
          status: 'Closed',
          updatedAt: serverTimestamp()
        });
      }

      if (task) {
        const isDone = status === 'Done';
        const body = taskDetails(
          `${appUser.displayName} changed the status of "${task.taskName}" to ${status}.`,
          { ...task, status },
        );
        const payload = {
          type: (isDone ? 'task_done' : 'task_status_updated') as NotificationType,
          title: isDone ? 'Task Completed' : 'Task Status Updated',
          message: body,
          read: false,
          relatedId: taskId,
        };

        if (task.assignedById && task.assignedById !== user.uid) {
          await createNotification({
            ...payload,
            forUserId: task.assignedById,
            createdAt: serverTimestamp(),
          }, projectUsers);
        }

        if (!task.isPrivate) {
          await notifyManagers({ ...payload, createdAt: serverTimestamp() }, projectUsers, {
            actorId: user.uid,
            excludeIds: [task.assignedById],
          });
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
      setError(t('Failed to update status.'));
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm(t('Are you sure you want to delete this task?'))) return;
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `tasks/${taskId}`);
      setError(t('Failed to delete task.'));
    }
  };

  const handleArchiveTask = async (taskId: string) => {
    try {
      const task = tasks.find(t => t.id === taskId);
      await updateDoc(doc(db, 'tasks', taskId), {
        status: 'Archived' as TaskStatus,
        archivedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      if (task?.correspondingId) {
        await updateDoc(doc(db, 'correspondences', task.correspondingId), {
          status: 'Closed',
          updatedAt: serverTimestamp()
        });
      }
      // Archiving is a status move like any other, so the linked records hear
      // about it too — otherwise a bid's history would just stop mid-story.
      if (task && hasAnyLink(linksOf(task))) {
        await mirrorRecordEvent(
          linksOf(task),
          taskSource(task, 'Archived'),
          actorFrom(user.uid, appUser),
          'status',
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
      setError(t('Failed to archive task.'));
    }
  };


  const handleEditFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingTask) return;
    
    setIsUploading(true);
    try {
      const driveUrl = await uploadToDrive(file);
      setEditingTask({ ...editingTask, attachedFile: driveUrl, attachedFileName: file.name });
    } catch (err: any) {
      alert(t('Upload failed: {{message}}', { message: err.message }));
    } finally {
      setIsUploading(false);
    }
  };

  // Shared by add / edit / status-change: if the milestone's parent
  // task is still open and its due date is already alerting (overdue or
  // due soon), open the keep/extend/reset prompt.
  const maybePromptDueDate = (task: Task | undefined, milestoneTitle: string) => {
    if (
      task &&
      task.status !== 'Done' &&
      task.status !== 'Archived' &&
      (isOverdue(task.dueDate) || isDueSoon(task.dueDate))
    ) {
      setPromptDueDate(task.dueDate || '');
      setDueDatePrompt({ task, milestoneTitle });
    }
  };

  const handleAddMilestone = async () => {
    if (!newMilestone || !newMilestone.title.trim()) return;
    setIsAddingMilestone(true);
    const title = newMilestone.title.trim();
    try {
      const task = tasks.find(t => t.id === newMilestone.taskId);
      await addDoc(collection(db, 'milestones'), {
        taskId: newMilestone.taskId,
        title: newMilestone.title.trim(),
        status: 'Planned' as MilestoneStatus,
        targetDate: newMilestone.targetDate || null,
        addedBy: appUser.displayName,
        addedById: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (task) {
        const payload = {
          type: 'milestone_added' as NotificationType,
          title: 'Milestone Added',
          message: taskDetails(
            `${appUser.displayName} added milestone "${title}" to "${task.taskName}"`,
            task,
          ),
          read: false,
          relatedId: newMilestone.taskId,
        };

        if (task.assignedById && task.assignedById !== user.uid) {
          await createNotification({
            ...payload,
            forUserId: task.assignedById,
            createdAt: serverTimestamp(),
          }, projectUsers);
        }

        if (!task.isPrivate) {
          await notifyManagers({ ...payload, createdAt: serverTimestamp() }, projectUsers, {
            actorId: user.uid,
            excludeIds: [task.assignedById],
          });
        }
      }

      setNewMilestone(null);
      maybePromptDueDate(task, title);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'milestones');
      setError(t('Failed to add milestone.'));
    } finally {
      setIsAddingMilestone(false);
    }
  };

  const handleUpdateMilestoneStatus = async (milestoneId: string, status: MilestoneStatus) => {
    try {
      const update: any = { status, updatedAt: serverTimestamp() };
      if (status === 'Done') update.completedAt = serverTimestamp();
      await updateDoc(doc(db, 'milestones', milestoneId), update);

      const ms = milestones.find(m => m.id === milestoneId);
      const task = ms ? tasks.find(t => t.id === ms.taskId) : undefined;
      maybePromptDueDate(task, ms?.title || '');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `milestones/${milestoneId}`);
    }
  };

  const handleUpdateMilestone = async () => {
    if (!editingMilestone || !editingMilestone.title.trim()) return;
    setIsSavingMilestone(true);
    const title = editingMilestone.title.trim();
    try {
      await updateDoc(doc(db, 'milestones', editingMilestone.id), {
        title,
        targetDate: editingMilestone.targetDate || null,
        updatedAt: serverTimestamp(),
      });
      const task = tasks.find(t => t.id === editingMilestone.taskId);
      setEditingMilestone(null);
      maybePromptDueDate(task, title);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `milestones/${editingMilestone.id}`);
      setError(t('Failed to update milestone.'));
    } finally {
      setIsSavingMilestone(false);
    }
  };

  // Local-time YYYY-MM-DD `days` from today. Built by hand (not
  // toISOString) so it doesn't shift a day for users behind UTC — same
  // reasoning as parseDeadline in utils.ts.
  const plusDaysISO = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const resolveDueDatePrompt = async (choice: 'keep' | 'extend' | 'custom') => {
    if (!dueDatePrompt) return;
    if (choice === 'keep') { setDueDatePrompt(null); return; }

    const newDue = choice === 'extend' ? plusDaysISO(3) : promptDueDate;
    if (!newDue) return;

    const { task } = dueDatePrompt;
    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        dueDate: newDue,
        updatedAt: serverTimestamp(),
      });

      if (task.assignedById && task.assignedById !== user.uid) {
        await createNotification({
          type: 'task_updated',
          title: 'Due Date Changed',
          message: taskDetails(
            `${appUser.displayName} moved the due date of "${task.taskName}" to ${newDue}.`,
            { ...task, dueDate: newDue },
          ),
          forUserId: task.assignedById,
          read: false,
          relatedId: task.id,
          createdAt: serverTimestamp(),
        }, projectUsers);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}`);
      setError(t('Failed to update due date.'));
    } finally {
      setDueDatePrompt(null);
    }
  };

  const handleDeleteMilestone = async (id: string) => {
    try { await deleteDoc(doc(db, 'milestones', id)); }
    catch (err) { handleFirestoreError(err, OperationType.DELETE, `milestones/${id}`); }
  };

  return (
    <div style={{ padding: '4px 0', minHeight: '60vh' }}>
      <div className="board-head" style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="board-head-title" style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            {t('Tasks')}
          </h1>
          <p className="board-head-desc" style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {t('Track your assigned tasks')}
          </p>
        </div>
        <button className="btn btn-primary board-head-action" onClick={() => setIsAddingTask(true)} aria-label={t('Add Task')} title={t('Add Task')}>
          <Plus className="w-4 h-4" /> <span className="board-head-label">{t('Add Task')}</span>
        </button>
      </div>

      {/* One toolbar row: the My/All scope (a scope, not a filter — it stays
          visible), search, Group by, and every remaining filter folded into
          `Filters`. The header above keeps exactly one action — Add Task. */}
      <BoardToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t('Search tasks…')}
        scope={
          <div className="board-toolbar-scope" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0, padding: 4, display: 'flex', gap: 4, flexShrink: 0 }}>
            {(['mine', 'all'] as const).map(v => (
              <button
                key={v}
                onClick={() => { setView(v); setFocusedTaskId(null); }}
                aria-pressed={view === v}
                style={{
                  padding: '6px 16px', borderRadius: 0, fontSize: 13, fontWeight: 600,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                  background: view === v ? 'var(--accent)' : 'transparent',
                  color: view === v ? '#fff' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}
              >
                {v === 'mine' ? t('My Tasks') : t('All Tasks')}
              </button>
            ))}
          </div>
        }
        compact
        groupBy={
          <>
            {/* The board is already split by status, so Group by only means
                something in the list. */}
            {layout === 'list' && <GroupByBar<TaskGroupBy> compact value={groupBy} onChange={setGroupBy} options={groupByOptions} />}
            <div className="task-layout-switch" role="group" aria-label={t('Task layout')}>
              {([['list', LayoutList, t('List')], ['board', Columns3, t('Board')]] as const).map(([key, Icon, text]) => (
                <button
                  key={key}
                  type="button"
                  data-layout={key}
                  aria-pressed={layout === key}
                  title={key === 'list' ? t('Show as a list') : t('Show as a board')}
                  onClick={() => chooseLayout(key)}
                >
                  <Icon style={{ width: 15, height: 15, flexShrink: 0 }} />
                  <span className="task-layout-label">{text}</span>
                </button>
              ))}
            </div>
          </>
        }
        activeFilterCount={
          (categoryFilter !== 'All' ? 1 : 0) + (dateFilter ? 1 : 0) + (statusFilter !== 'All' ? 1 : 0) +
          (deptFilter !== 'All' ? 1 : 0) + (employeeFilter !== 'All' ? 1 : 0) + (subCategoryFilter !== 'All' ? 1 : 0)
        }
        onClearFilters={resetFilters}
        filters={
          <>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0, padding: 4, display: 'flex', gap: 4 }}>
              {['All', 'Project', 'Internal', 'External'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  style={{
                    padding: '6px 12px', borderRadius: 0, fontSize: 13, fontWeight: 600,
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    background: categoryFilter === cat ? 'var(--accent)' : 'transparent',
                    color: categoryFilter === cat ? '#fff' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}
                >
                  {cat === 'All' ? t('All') : label(cat)}
                </button>
              ))}
            </div>

            <input
              type="date"
              className="input"
              style={{ width: 'auto' }}
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              title={t('Filter by day')}
            />

            <select className="input" style={{ width: 'auto' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="All">{t('All Statuses')}</option>
              <option value="Active">{t('Active')}</option>
              <option value="Overdue">{t('Overdue')}</option>
              {['Pending', 'In Progress', 'Done'].map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>

            <select className="input" style={{ width: 'auto' }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              <option value="All">{t('All Departments')}</option>
              {DEPARTMENT_OPTIONS.map(d => <option key={d} value={d}>{label(d)}</option>)}
            </select>

            {isManagerOrAdmin && view === 'all' && (
              <select className="input" style={{ width: 'auto' }} value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}>
                <option value="All">{t('All Employees')}</option>
                {projectUsers.filter(u => u.role === 'Employee' || u.role === 'Manager').map(e => <option key={e.id} value={e.displayName}>{e.displayName}</option>)}
              </select>
            )}

            {subCategoryFilter !== 'All' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--accent-10)', color: 'var(--accent)', borderRadius: 0, fontSize: 12, fontWeight: 700 }}>
                {t('Tag:')} {subCategoryFilter}
                <button onClick={() => setSubCategoryFilter('All')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', display: 'flex', alignItems: 'center' }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </>
        }
      />

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 0, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, color: '#f87171', fontSize: 14 }}>
          <AlertCircle className="w-4 h-4" /> {error}
          <button onClick={() => setError(null)} style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#f87171' }}><X className="w-4 h-4" /></button>
        </div>
      )}

      <CreateTaskPanel
        open={isAddingTask}
        onClose={() => setIsAddingTask(false)}
        user={user}
        appUser={appUser}
        projectUsers={projectUsers}
        tasks={tasks}
      />

      {layout === 'board' ? (
        <TaskBoard
          tasks={ordered}
          projectUsers={projectUsers}
          progressOf={taskId => {
            const ms = getMilestonesForTask(taskId);
            return { done: ms.filter(m => m.status === 'Done').length, total: ms.length };
          }}
          onMove={handleUpdateTaskStatus}
          onOpen={handleOpenTask}
          empty={renderEmpty(<Columns3 style={{ width: 28, height: 28 }} />)}
        />
      ) : showGroupGrid ? (
        // Grouping IS the grid: one card per bucket, and the list only appears
        // once a card is opened. `groupCards` is built from every filtered task,
        // so the counts on the cards are the real totals, not one page of them.
        <GroupGrid
          cards={groupCards}
          onSelect={setOpenGroup}
          empty={renderEmpty(<Users style={{ width: 28, height: 28 }} />)}
        />
      ) : (
      <>
      {/* Group tabs (T3): the first goes back to the grid — from a drilled-in
          card, or from the deep link that skipped the grid — and every other
          group is one tap away, with its size and its late count. */}
      <GroupTabs
        tabs={groupTabs}
        active={activeGroup ? activeGroup.key : null}
        onSelect={key => { setFocusedTaskId(null); setOpenGroup(key); }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {renderGroups.map(group => {
          const catTasks = group.items;
          return (
            <div key={group.key}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingInlineStart: 4 }}>
                <Layers className="w-4 h-4 text-accent" />
                {groupHeading(group)}
                {(() => {
                  // The whole group's numbers, not this page's: open · late · finished.
                  const tally = groupTally.get(group.key);
                  if (!tally) return null;
                  return (
                    <span className="group-head-counts" data-group-counts>
                      <span className="group-head-chip">{t('Open: {{count}}', { count: tally.open })}</span>
                      {tally.late > 0 && <span className="group-head-chip group-head-chip--late">{t('Late: {{count}}', { count: tally.late })}</span>}
                      {tally.done > 0 && <span className="group-head-chip group-head-chip--done">{t('Finished: {{count}}', { count: tally.done })}</span>}
                    </span>
                  );
                })()}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <AnimatePresence>
                  {catTasks.map(task => {
                    let taskMilestones = getMilestonesForTask(task.id);
                    if (milestoneSort === 'desc') {
                      taskMilestones = [...taskMilestones].reverse();
                    }
                    const doneMilestones = taskMilestones.filter(m => m.status === 'Done').length;
                    const progress = taskMilestones.length > 0 ? Math.round((doneMilestones / taskMilestones.length) * 100) : 0;
                    const isExpanded = expandedTask === task.id;
                    const isTaskOverdue = isOverdue(task.dueDate) && task.status !== 'Done';
                    const isTaskDueSoon = isDueSoon(task.dueDate) && task.status !== 'Done';
                    const canEdit = true;
                    const isEditing = editingTask?.id === task.id;

                    return (
                      <motion.div
                        key={task.id}
                        id={`task-${task.id}`}
                        exit={{ opacity: 0 }}
                        className="card"
                        style={{
                          // Slim rows (Tidy Tasks T1): ONE accent colour. No
                          // per-person stripe any more — the edge only speaks
                          // when something needs attention (late / due soon)
                          // or while the task is being edited.
                          position: 'relative',
                          zIndex: (openActionMenu === task.id || openStatusMenu === task.id) ? 5 : undefined,
                          borderInlineStart: isEditing ? '3px solid var(--accent)'
                            : isTaskOverdue ? '3px solid #ef4444'
                            : isTaskDueSoon ? '3px solid #f97316' : undefined,
                          backgroundColor: task.status === 'Done' ? 'var(--surface-2)' : 'var(--surface)',
                          transition: 'background-color 0.2s ease'
                        }}
                      >
                        {(
                          <>
                            <div
                              className="task-row"
                              data-task-row
                              onClick={() => {
                                setExpandedTask(isExpanded ? null : task.id);
                                if (isExpanded && focusedTaskId === task.id) setFocusedTaskId(null);
                              }}
                            >
                              <div className="task-row-main">
                                {task.serialNumber && (
                                  <span className="task-row-serial ltr-data">#{task.serialNumber}</span>
                                )}
                                {/* dir="auto": an Arabic title lines up on the right of its cell. */}
                                <h3
                                  dir="auto"
                                  className="task-row-title"
                                  title={task.taskName}
                                  style={{ color: task.status === 'Done' ? 'var(--text-muted)' : 'var(--text-primary)' }}
                                >
                                  {task.taskName}
                                </h3>
                                {task.isPrivate && (
                                  <span title={t('Private — only you can see this task')} style={{ display: 'inline-flex', color: 'var(--text-muted)', flexShrink: 0 }}>
                                    <Lock style={{ width: 12, height: 12 }} />
                                  </span>
                                )}
                              </div>

                              <div className="task-row-meta">
                                <span className="task-row-owner" title={task.assignedTo || t('Unassigned')}>
                                  {(() => {
                                    const u = projectUsers.find(pu => pu.id === task.assignedToId);
                                    const name = task.assignedTo || '';
                                    return u?.photoURL ? (
                                      <img src={u.photoURL} className="avatar" style={{ width: 18, height: 18, objectFit: 'cover', flexShrink: 0 }} alt="" />
                                    ) : (
                                      <span className="task-row-initial" aria-hidden>{(name.trim()[0] || '?').toUpperCase()}</span>
                                    );
                                  })()}
                                  <span className="task-row-ellipsis">{task.assignedTo || t('Unassigned')}</span>
                                </span>

                                <span
                                  className="task-row-due"
                                  title={isTaskOverdue ? t('OVERDUE') : isTaskDueSoon ? t('DUE SOON') : undefined}
                                  style={{ color: isTaskOverdue ? '#ef4444' : isTaskDueSoon ? '#ea580c' : 'var(--text-muted)', fontWeight: (isTaskOverdue || isTaskDueSoon) ? 700 : 500 }}
                                >
                                  {task.dueDate ? (
                                    <>
                                      {isTaskOverdue ? <AlertCircle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
                                      <span className="ltr-data">{task.dueDate}</span>
                                    </>
                                  ) : <span aria-hidden>—</span>}
                                </span>

                                <span
                                  className="task-row-progress"
                                  title={taskMilestones.length ? t('{{done}}/{{total}} milestones', { done: doneMilestones, total: taskMilestones.length }) : undefined}
                                >
                                  {taskMilestones.length > 0 && (
                                    <>
                                      <span className="task-row-bar"><span style={{ width: `${progress}%` }} /></span>
                                      <span className="ltr-data">{doneMilestones}/{taskMilestones.length}</span>
                                    </>
                                  )}
                                </span>

                                {/* ONE status label; click → menu. Replaces the
                                    Pending / In Progress / Done pill trio. */}
                                <div className="task-row-status" style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    className="task-status-label"
                                    data-status={task.status}
                                    aria-haspopup="menu"
                                    aria-expanded={openStatusMenu === task.id}
                                    title={t('Change status')}
                                    disabled={!canEdit}
                                    onClick={() => { setOpenActionMenu(null); setOpenStatusMenu(openStatusMenu === task.id ? null : task.id); }}
                                  >
                                    {task.status === 'Done'
                                      ? <CheckCircle2 style={{ width: 12, height: 12, flexShrink: 0 }} />
                                      : <span className="task-status-dot" />}
                                    <span>{label(task.status)}</span>
                                    {canEdit && <ChevronDown style={{ width: 12, height: 12, opacity: 0.7, flexShrink: 0 }} />}
                                  </button>
                                  <AnimatePresence>
                                    {openStatusMenu === task.id && (
                                      <>
                                        <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpenStatusMenu(null)} />
                                        <motion.div
                                          role="menu"
                                          initial={{ opacity: 0, y: -6, scale: 0.96 }}
                                          animate={{ opacity: 1, y: 0, scale: 1 }}
                                          exit={{ opacity: 0, y: -6, scale: 0.96 }}
                                          transition={{ duration: 0.12 }}
                                          style={{
                                            position: 'absolute', top: '100%', insetInlineEnd: 0, marginTop: 4,
                                            background: 'var(--surface)',
                                            border: '1px solid var(--border-md)',
                                            boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
                                            zIndex: 100,
                                            minWidth: 148,
                                            overflow: 'hidden',
                                          }}
                                        >
                                          {STATUS_GROUP_ORDER.map(s => (
                                            <button
                                              key={s}
                                              type="button"
                                              role="menuitemradio"
                                              aria-checked={task.status === s}
                                              data-status-option={s}
                                              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: task.status === s ? 700 : 500, color: 'var(--text-primary)', textAlign: 'start' }}
                                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                                              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                              onClick={() => {
                                                setOpenStatusMenu(null);
                                                if (task.status !== s) handleUpdateTaskStatus(task.id, s);
                                              }}
                                            >
                                              <Check style={{ width: 14, height: 14, flexShrink: 0, color: 'var(--accent)', visibility: task.status === s ? 'visible' : 'hidden' }} />
                                              {label(s)}
                                            </button>
                                          ))}
                                        </motion.div>
                                      </>
                                    )}
                                  </AnimatePresence>
                                </div>
                              </div>

                              <div className="task-row-actions">
                                  <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                                    <button
                                      className="btn btn-ghost btn-icon"
                                      style={{ padding: '4px 8px', height: 'auto', fontSize: 16, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-muted)', lineHeight: 1 }}
                                      onClick={e => { e.stopPropagation(); setOpenStatusMenu(null); setOpenActionMenu(openActionMenu === task.id ? null : task.id); }}
                                      title={t('Task actions')}
                                    >
                                      ···
                                    </button>
                                    <AnimatePresence>
                                      {openActionMenu === task.id && (
                                        <>
                                          <div
                                            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                                            onClick={() => setOpenActionMenu(null)}
                                          />
                                          <motion.div
                                            initial={{ opacity: 0, y: -6, scale: 0.96 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -6, scale: 0.96 }}
                                            transition={{ duration: 0.12 }}
                                            style={{
                                              position: 'absolute', top: '100%', insetInlineEnd: 0, marginTop: 4,
                                              background: 'var(--surface)',
                                              border: '1px solid var(--border-md)',
                                              boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
                                              zIndex: 100,
                                              minWidth: 148,
                                              overflow: 'hidden',
                                            }}
                                          >
                                            <button
                                              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', textAlign: 'start' }}
                                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                                              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                              onClick={() => { setOpenActionMenu(null); setShowAdvancedEdit(false); setEditingTask(task); }}
                                            >
                                              <Edit2 style={{ width: 14, height: 14, color: 'var(--text-muted)', flexShrink: 0 }} />
                                              {t('Edit Task')}
                                            </button>
                                            {task.status === 'Done' && (
                                              <button
                                                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', textAlign: 'start' }}
                                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                                onClick={() => { setOpenActionMenu(null); handleArchiveTask(task.id); }}
                                              >
                                                <Archive style={{ width: 14, height: 14, color: 'var(--text-muted)', flexShrink: 0 }} />
                                                {t('Archive')}
                                              </button>
                                            )}
                                            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                                            <button
                                              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#dc2626', textAlign: 'start' }}
                                              onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                                              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                              onClick={() => { setOpenActionMenu(null); handleDeleteTask(task.id); }}
                                            >
                                              <Trash2 style={{ width: 14, height: 14, flexShrink: 0 }} />
                                              {t('Delete')}
                                            </button>
                                          </motion.div>
                                        </>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                <ChevronRight className="task-row-chevron" style={{ width: 16, height: 16, color: 'var(--text-muted)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
                              </div>
                            </div>

                            <AnimatePresence>
                              {isExpanded && (
<motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  style={{ overflow: 'hidden' }}
                                >
                                  <div className="task-expand" style={{ borderTop: '1px solid var(--border)', padding: '16px 20px' }}>
                                    {/* Everything the slim row leaves out opens here —
                                        moved, not deleted. */}
                                    <div className="task-row-details" style={{ marginBottom: 20 }}>
                                      {task.description && (
                                        <p dir="auto" style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>
                                          {task.description}
                                        </p>
                                      )}
                                      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
                                        <span className={priorityBadge(task.priority)}>{label(task.priority)}</span>
                                  {task.isPrivate && (
                                    <span
                                      className="badge"
                                      style={{ background: 'var(--surface-3, #e2e8f0)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                      title={t('Private — only you can see this task')}
                                    >
                                      <Lock style={{ width: 11, height: 11 }} /> {t('Private')}
                                    </span>
                                  )}
                                  {isExpanded && task.assignedBy && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      {(() => {
                                        const u = projectUsers.find(pu => pu.id === task.assignedById);
                                        return u?.photoURL ? (
                                          <img src={u.photoURL} className="avatar" style={{ width: 14, height: 14, objectFit: 'cover', opacity: 0.7 }} alt="" />
                                        ) : (
                                          <span style={{ width: 8, height: 8, borderRadius: 0, background: u?.userColor || getUserColor(task.assignedById || task.assignedBy), opacity: 0.6 }} />
                                        );
                                      })()}
                                      {t('By')}{task.assignedBy}
                                    </span>
                                  )}
                                  {isExpanded && !!(task.collaboratorIds && task.collaboratorIds.length) && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={t('Collaborators: {{names}}', { names: (task.collaborators || []).filter(Boolean).join(', ') })}>
                                      <Users style={{ width: 12, height: 12 }} />
                                      <span style={{ display: 'flex', alignItems: 'center' }}>
                                        {task.collaboratorIds.slice(0, 4).map((cid, i) => {
                                          const cu = projectUsers.find(pu => pu.id === cid);
                                          return cu?.photoURL ? (
                                            <img key={cid} src={cu.photoURL} className="avatar" style={{ width: 16, height: 16, objectFit: 'cover', marginInlineStart: i ? -5 : 0, border: '1.5px solid var(--surface-1)' }} alt="" />
                                          ) : (
                                            <span key={cid} style={{ width: 12, height: 12, borderRadius: 0, background: cu?.userColor || getUserColor(cid), marginInlineStart: i ? -3 : 0 }} />
                                          );
                                        })}
                                      </span>
                                      {task.collaboratorIds.length > 4 && <span>+{task.collaboratorIds.length - 4}</span>}
                                    </span>
                                  )}
                                  {task.dueDate && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: isOverdue ? '#f87171' : undefined }}><Calendar className="w-3 h-3" /> <span className="ltr-data">{task.dueDate}</span></span>}
                                  {isExpanded && task.createdAt && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }} title={t('Creation date')}><Clock className="w-3 h-3" /> <span className="ltr-data">{fmt.date(task.createdAt)}</span></span>}
                                  {isExpanded && (task.correspondingSerialNumber || task.correspondingSubject) && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <Link2 className="w-3 h-3" /> 
                                      {(() => {
                                        const linkedCorr = correspondences.find(c => c.id === task.correspondingId);
                                        // A serial is Latin data and must not be
                                        // reordered by bidi; a subject is prose
                                        // and follows the paragraph direction.
                                        const serial = task.correspondingSerialNumber
                                          || (linkedCorr ? `REF: ${linkedCorr.serialNumber}` : '');
                                        return serial
                                          ? <span className="ltr-data">{serial}</span>
                                          : task.correspondingSubject;
                                      })()}
                                    </span>
                                  )}
                                  {isExpanded && task.subCategory && (
                                    <span 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSubCategoryFilter(task.subCategory!);
                                      }}
                                      style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--accent)', fontWeight: 700 }}
                                      title={t('Click to filter by this tag')}
                                    >
                                      <Tag className="w-3 h-3" /> {task.subCategory}
                                    </span>
                                  )}
                                      </div>
                                {isExpanded && <LinkedRecordsBlock links={linksOf(task)} />}

                                {isExpanded && task.attachedFile && (
                                  <div style={{ marginTop: 24 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 12, textTransform: 'uppercase' }}>{t('Attachment')}</div>
                                    <div style={{ 
                                      borderRadius: 0,                                     overflow: 'hidden', 
                                      border: '1px solid var(--border)',
                                      background: 'var(--surface-2)',
                                      boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
                                    }}>
                                      {(task.attachedFile.includes('image') || task.attachedFile.includes('google.com')) ? (
                                        <div style={{ position: 'relative', background: 'var(--surface-3)', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                              <DriveImage 
                                                url={task.attachedFile} 
                                                alt={t('Attachment')} 
                                                style={{ width: '100%', maxHeight: 500, objectFit: 'contain', display: 'block', margin: '0 auto' }} 
                                                onLoad={(e) => (e.target as HTMLImageElement).style.opacity = '1'}
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                  (e.target as HTMLImageElement).parentElement!.style.height = '120px';
                                                }}
                                              />
                                              <div style={{ 
                                                position: 'absolute', 
                                                bottom: 0, 
                                                left: 0, 
                                                right: 0, 
                                                padding: '16px 20px', 
                                                background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)', 
                                                display: 'flex', 
                                                justifyContent: 'space-between', 
                                                alignItems: 'center',
                                                backdropFilter: 'blur(4px)'
                                              }}>
                                                <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{task.attachedFileName || t('Attached Image')}</span>
                                                <a 
                                                  href={task.attachedFile} onClick={attachmentClick(task.attachedFile, task.attachedFileName)} 
                                                  target="_blank" 
                                                  rel="noopener noreferrer" 
                                                  className="btn btn-sm"
                                                  style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)' }}
                                                >
                                                  <ExternalLink className="w-3.5 h-3.5" /> {t('Full View')}
                                                </a>
                                              </div>
                                        </div>
                                      ) : (
                                        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
                                          <div style={{ width: 40, height: 40, borderRadius: 0, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                                            <Paperclip className="w-5 h-5" />
                                          </div>
                                          <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{task.attachedFileName || t('Attachment')}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Click to view or download')}</div>
                                          </div>
                                          <a 
                                            href={task.attachedFile} onClick={attachmentClick(task.attachedFile, task.attachedFileName)} 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            className="btn btn-ghost btn-sm"
                                          >
                                            <Download className="w-4 h-4" />
                                          </a>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Shared Folder Paths Display */}
                                {isExpanded && task.filePaths && task.filePaths.length > 0 && (
                                  <div style={{ marginTop: 24 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 12, textTransform: 'uppercase' }}>{t('Shared Folders / Links')}</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      {task.filePaths.map((path, idx) => (
                                        <div key={idx} style={{ 
                                          display: 'flex', 
                                          alignItems: 'center', 
                                          gap: 12, 
                                          padding: '8px 12px', 
                                          background: 'var(--surface-2)', 
                                          border: '1px solid var(--border)',
                                          borderRadius: 0
                                        }}>
                                          <ExternalLink className="w-4 h-4 text-muted" />
                                          <code
                                            className="ltr-data"
                                            onClick={(e) => { e.stopPropagation(); openOrCopyPath(path); }}
                                            title={t('Click to open (web link) or copy this path')}
                                            style={{ fontSize: 13, flex: 1, wordBreak: 'break-all', color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                                          >{path}</code>
                                          <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            onClick={(e) => { e.stopPropagation(); openOrCopyPath(path); }}
                                          >
                                            {t('Open / Copy')}
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <h4 style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                                          <Target className="w-3.5 h-3.5" style={{ display: 'inline', marginInlineEnd: 6 }} />
                                          {t('Milestones')}
                                        </h4>
                                        <select 
                                          value={milestoneSort}
                                          onChange={e => setMilestoneSort(e.target.value as 'asc' | 'desc')}
                                          style={{
                                            fontSize: 11,
                                            padding: '2px 6px',
                                            background: 'var(--surface-2)',
                                            border: '1px solid var(--border)',
                                            color: 'var(--text-muted)',
                                            outline: 'none',
                                            cursor: 'pointer',
                                            borderRadius: 4
                                          }}
                                          onClick={e => e.stopPropagation()}
                                        >
                                          <option value="asc">{t('Oldest First')}</option>
                                          <option value="desc">{t('Newest First')}</option>
                                        </select>
                                      </div>
                                      {canEdit && (
                                        <button
                                          className="btn btn-ghost btn-sm"
                                          onClick={() => setNewMilestone({ taskId: task.id, title: '', targetDate: '' })}
                                        >
                                          <Plus className="w-3.5 h-3.5" /> {t('Add Milestone')}
                                        </button>
                                      )}
                                    </div>

                                    {newMilestone?.taskId === task.id && (
                                      <div className="ms-addform" style={{ background: 'var(--surface-2)', borderRadius: 0, padding: 16, marginBottom: 14, border: '1px solid var(--border)' }}>
                                        <div className="ms-addform-row" style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                                          <input
                                            className="input"
                                            placeholder={t('Milestone title…')}
                                            value={newMilestone.title}
                                            onChange={e => setNewMilestone(p => p ? { ...p, title: e.target.value } : p)}
                                            autoFocus
                                          />
                                          <input
                                            className="input"
                                            type="date"
                                            value={newMilestone.targetDate}
                                            onChange={e => setNewMilestone(p => p ? { ...p, targetDate: e.target.value } : p)}
                                            style={{ width: 160, flexShrink: 0 }}
                                          />
                                        </div>
                                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                          <button className="btn btn-ghost btn-sm" onClick={() => setNewMilestone(null)}>{t('Cancel')}</button>
                                          <button className="btn btn-primary btn-sm" onClick={handleAddMilestone} disabled={isAddingMilestone || !newMilestone.title.trim()}>
                                            {isAddingMilestone ? t('Adding…') : t('Add')}
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    {taskMilestones.length === 0 ? (
                                      <p style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>{t('No milestones yet')}</p>
                                    ) : (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }} className="milestone-line">
                                        {taskMilestones.map((ms, i) => (
                                          <div key={ms.id} className="ms-row" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', position: 'relative', paddingInlineStart: 28 }}>
                                            <div style={{
                                              position: 'absolute', insetInlineStart: 8, top: 6,
                                              width: 10, height: 10, borderRadius: 0,
                                              background: ms.status === 'Done' ? '#4ade80' : ms.status === 'In Progress' ? '#818cf8' : ms.status === 'Blocked' ? '#f87171' : 'var(--surface-3)',
                                              border: '2px solid var(--surface)',
                                              zIndex: 1,
                                            }} />
                                            <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 0, padding: '10px 14px', border: '1px solid var(--border)' }}>
                                              {editingMilestone?.id === ms.id ? (
                                                <div className="ms-addform-row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                                                  <input
                                                    className="input"
                                                    style={{ flex: 1, minWidth: 160 }}
                                                    value={editingMilestone.title}
                                                    onChange={e => setEditingMilestone(p => p ? { ...p, title: e.target.value } : p)}
                                                    placeholder={t('Milestone title…')}
                                                    autoFocus
                                                  />
                                                  <input
                                                    className="input"
                                                    type="date"
                                                    style={{ width: 160, flexShrink: 0 }}
                                                    value={editingMilestone.targetDate}
                                                    onChange={e => setEditingMilestone(p => p ? { ...p, targetDate: e.target.value } : p)}
                                                  />
                                                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingMilestone(null)}>{t('Cancel')}</button>
                                                  <button className="btn btn-primary btn-sm" onClick={handleUpdateMilestone} disabled={isSavingMilestone || !editingMilestone.title.trim()}>
                                                    {isSavingMilestone ? t('Saving…') : t('Save')}
                                                  </button>
                                                </div>
                                              ) : (
                                              <>
                                              <div className="ms-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                                <span className="ms-title" style={{ fontWeight: 600, fontSize: 13, color: ms.status === 'Done' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: ms.status === 'Done' ? 'line-through' : 'none', wordBreak: 'break-word', overflowWrap: 'break-word', minWidth: 0, flex: 1 }}>
                                                  {ms.title}
                                                </span>
                                                <div className="ms-card-ctrls" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                  <div className="ms-status-seg" style={{ display: 'flex', gap: 4, background: 'var(--surface-3)', padding: 2, borderRadius: 0, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                                                    {MILESTONE_STATUS_OPTIONS.map(s => (
                                                      <button
                                                        key={s}
                                                        className="ms-status-btn"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          if (ms.status !== s) handleUpdateMilestoneStatus(ms.id, s as MilestoneStatus);
                                                        }}
                                                        style={{
                                                          padding: '2px 6px',
                                                          fontSize: 10,
                                                          fontWeight: 700,
                                                          borderRadius: 0,
                                                          border: 'none',
                                                          cursor: 'pointer',
                                                          whiteSpace: 'nowrap',
                                                          background: ms.status === s ? (s === 'Done' ? 'var(--green-100)' : s === 'In Progress' ? 'var(--blue-50)' : s === 'Blocked' ? 'rgba(239,68,68,0.15)' : 'var(--surface)') : 'transparent',
                                                          color: ms.status === s ? (s === 'Done' ? 'var(--green-400)' : s === 'In Progress' ? 'var(--blue-400)' : s === 'Blocked' ? '#f87171' : 'var(--text-primary)') : 'var(--text-muted)',
                                                          transition: 'all 0.15s'
                                                        }}
                                                      >
                                                        {label(s)}
                                                      </button>
                                                    ))}
                                                  </div>
                                                  {canEdit && (
                                                    <>
                                                      <button className="ms-del-btn" onClick={() => setEditingMilestone({ id: ms.id, taskId: ms.taskId, title: ms.title, targetDate: ms.targetDate || '' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
                                                        <Edit2 className="w-3.5 h-3.5" />
                                                      </button>
                                                      <button className="ms-del-btn" onClick={() => handleDeleteMilestone(ms.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                      </button>
                                                    </>
                                                  )}
                                                </div>
                                              </div>
                                              <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                                                <span>{t('By')}{ms.addedBy}</span>
                                                {ms.targetDate && <span><Calendar className="w-3 h-3" style={{ display: 'inline', marginInlineEnd: 3 }} /><span className="ltr-data">{ms.targetDate}</span></span>}
                                              </div>
                                              </>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {canEdit && task.status !== 'Done' && (
                                      <div className="ms-task-actions" style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                                        {(['In Progress', 'Done'] as TaskStatus[]).map(s => (
                                          <button
                                            key={s}
                                            className={`btn btn-sm ${s === 'Done' ? 'btn-success' : 'btn-ghost'}`}
                                            onClick={() => handleUpdateTaskStatus(task.id, s)}
                                          >
                                            {s === 'Done'
                                              ? <><CheckCircle2 className="w-3.5 h-3.5" /> {t('Mark Done')}</>
                                              : <><TrendingUp className="w-3.5 h-3.5" /> {t('Mark In Progress')}</>}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
               </div>
             </div>
           );
         })}
       </div>

      {/* Finished work sits behind this one button (T2) — below the list, so
          open work is what the page leads with. */}
      {(fold.hidden > 0 || (showFinished && finishedInList > 0 && finishedInList < fullList.length)) && (
        <button
          type="button"
          className="btn btn-ghost btn-sm task-finished-toggle"
          data-finished-toggle={showFinished ? 'hide' : 'show'}
          aria-expanded={showFinished}
          onClick={toggleShowFinished}
        >
          {showFinished ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {showFinished ? t('Hide finished') : t('Show {{count}} finished', { count: fold.hidden })}
        </button>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 24, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
          <button 
            className="btn btn-ghost" 
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            style={{ borderRadius: 0 }}
          >
            <ChevronLeft className="w-4 h-4" /> {t('Previous')}
          </button>
          
          <div style={{ display: 'flex', gap: 6 }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <button
                key={page}
                className={`btn btn-sm ${currentPage === page ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setCurrentPage(page)}
                style={{ borderRadius: 0, minWidth: 32 }}
              >
                {page}
              </button>
            ))}
          </div>

          <button 
            className="btn btn-ghost" 
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            style={{ borderRadius: 0 }}
          >
            {t('Next')}<ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {filtered.length === 0 && renderEmpty(<CheckCircle2 style={{ width: 28, height: 28 }} />)}
      </>
      )}

      {/* ── Edit Task slide-over ── */}
      <AnimatePresence>
        {editingTask && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setEditingTask(null)}
              style={{
                position: 'fixed', inset: 0,
                background: 'rgba(15,23,42,0.4)',
                backdropFilter: 'blur(2px)',
                zIndex: 1500,
              }}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              style={{
                position: 'fixed', top: 0, insetInlineEnd: 0, bottom: 0,
                width: '100%', maxWidth: 480,
                background: 'var(--surface)',
                borderInlineStart: '1px solid var(--border-md)',
                boxShadow: '-8px 0 40px rgba(15,23,42,0.12)',
                zIndex: 1501,
                display: 'flex', flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Header */}
              <div style={{
                padding: '20px 24px',
                borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexShrink: 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, background: 'var(--surface-3)',
                    border: '1.5px solid var(--border-md)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Edit2 style={{ width: 14, height: 14, color: 'var(--text-secondary)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{t('Edit Task')}</div>
                    {editingTask.serialNumber && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}><span className="ltr-data">#{editingTask.serialNumber}</span></div>
                    )}
                  </div>
                </div>
                <button className="btn btn-ghost btn-icon" onClick={() => setEditingTask(null)}>
                  <X style={{ width: 16, height: 16 }} />
                </button>
              </div>

              {/* Body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

                <div style={{ marginBottom: 20 }}>
                  <label className="input-label">
                    {t('Task Name')}<span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    className="input"
                    style={{ fontSize: 16, fontWeight: 500, padding: '12px 14px' }}
                    value={editingTask.taskName}
                    onChange={e => setEditingTask({ ...editingTask, taskName: e.target.value })}
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && editingTask.taskName.trim() && handleUpdateTask()}
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label className="input-label">{t('Description')}<span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{t('(optional)')}</span></label>
                  <textarea
                    className="input"
                    value={editingTask.description}
                    onChange={e => setEditingTask({ ...editingTask, description: e.target.value })}
                    rows={3}
                    style={{ resize: 'vertical', minHeight: 72 }}
                  />
                </div>

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{t('When & Urgency')}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                  <div>
                    <label className="input-label">{t('Priority')}</label>
                    <select className="input" value={editingTask.priority} onChange={e => setEditingTask({ ...editingTask, priority: e.target.value as any })}>
                      {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{label(p)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="input-label">{t('Due Date')}<span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{t('(optional)')}</span></label>
                    <input type="date" className="input" value={editingTask.dueDate || ''} onChange={e => setEditingTask({ ...editingTask, dueDate: e.target.value })} />
                  </div>
                </div>

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{t('Who')}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label className="input-label">{t('Assignee')}</label>
                  <select
                    className="input"
                    value={editingTask.assignedToId}
                    onChange={e => {
                      const u = projectUsers.find(u => u.id === e.target.value);
                      if (u) setEditingTask({ ...editingTask, assignedToId: u.id, assignedTo: u.displayName });
                    }}
                  >
                    <option value="">{t('— Select Assignee —')}</option>
                    {projectUsers
                      .filter(u =>
                        u.id === user.uid ||
                        appUser.role === 'Admin' ||
                        (u.department === appUser.department && u.teamId === appUser.teamId)
                      )
                      .map(u => (
                        <option key={u.id} value={u.id}>{u.displayName} ({label(u.role)})</option>
                      ))
                    }
                  </select>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label className="input-label">{t('Collaborators')} <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{t('(optional)')}</span></label>
                  <CollaboratorPicker
                    users={projectUsers.filter(u =>
                      appUser.role === 'Admin' ||
                      (u.department === appUser.department && u.teamId === appUser.teamId)
                    )}
                    ownerId={editingTask.assignedToId}
                    selectedIds={editingTask.collaboratorIds || []}
                    onChange={ids => setEditingTask({ ...editingTask, collaboratorIds: ids })}
                  />
                </div>

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{t('Visibility')}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <PrivacyToggle
                    isPrivate={!!editingTask.isPrivate}
                    onChange={v => setEditingTask({ ...editingTask, isPrivate: v })}
                  />
                </div>

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{t('Classification')}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                  <div>
                    <label className="input-label">{t('Category')}</label>
                    <ComboBox
                      value={editingTask.category}
                      onChange={v => setEditingTask({ ...editingTask, category: (v || 'Project') as CorrespondingCategory })}
                      options={categoryOptions}
                      placeholder={t('Select or add a category…')}
                      clearable={false}
                      listLabel={t('Categories')}
                    />
                  </div>
                  <div>
                    <label className="input-label">{t('Department')}</label>
                    <ComboBox
                      value={editingTask.department}
                      onChange={v => setEditingTask({ ...editingTask, department: v || 'None' })}
                      options={dynamicDepartments}
                      placeholder={t('Select or add a department…')}
                      emptyValue="None"
                      listLabel={t('Departments')}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="input-label">{t('Sub-Category / Project')}</label>
                    <ComboBox
                      value={editingTask.subCategory}
                      onChange={v => setEditingTask({ ...editingTask, subCategory: v || 'None' })}
                      options={editingTask.category === 'Project' ? PROJECT_OPTIONS : dynamicSubCategories}
                      placeholder={t('Select or add a project…')}
                      emptyValue="None"
                      listLabel={t('Projects')}
                    />
                  </div>
                </div>

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{t('Linked Records')}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <RecordLinkPicker value={editLinks} onChange={setEditLinks} active={!!editingTask} />
                </div>

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{t('Attachment')}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  {editingTask.attachedFileName ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--border-md)' }}>
                      <Paperclip style={{ width: 14, height: 14, color: 'var(--blue-600)', flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--blue-600)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editingTask.attachedFileName}</span>
                      <button
                        type="button"
                        onClick={() => setEditingTask({ ...editingTask, attachedFile: '', attachedFileName: '' })}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 2, flexShrink: 0 }}
                        title={t('Remove attachment')}
                      >
                        <X style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                  ) : (
                    <label
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        gap: 8, padding: '20px 16px',
                        border: `2px dashed ${isDragOverEdit ? 'var(--blue-500)' : 'var(--border-md)'}`,
                        background: isDragOverEdit ? 'rgba(59,130,246,0.05)' : 'var(--surface-2)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onDragOver={e => { e.preventDefault(); setIsDragOverEdit(true); }}
                      onDragLeave={() => setIsDragOverEdit(false)}
                      onDrop={e => {
                        e.preventDefault(); setIsDragOverEdit(false);
                        if (e.dataTransfer.files?.[0]) handleEditFileUpload({ target: { files: e.dataTransfer.files } } as any);
                      }}
                    >
                      <input type="file" onChange={handleEditFileUpload} style={{ display: 'none' }} />
                      {isUploading ? (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Uploading to Drive...')}</div>
                      ) : (
                        <>
                          <Paperclip style={{ width: 20, height: 20, color: 'var(--text-muted)' }} />
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('Drop file or click to upload')}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t('Uploads to Google Drive')}</div>
                          </div>
                        </>
                      )}
                    </label>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvancedEdit(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: 12,
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                  }}
                >
                  <ChevronRight style={{ width: 12, height: 12, transform: showAdvancedEdit ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                  {t('Advanced')}
                  <div style={{ flex: 1, height: 1, background: 'var(--border)', marginInlineStart: 4 }} />
                </button>

                <AnimatePresence>
                  {showAdvancedEdit && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div style={{ marginBottom: 20 }}>
                        <label className="input-label">{t('Shared Folder Paths (Computer Paths)')}</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                          {(editingTask.filePaths || []).map((path, idx) => (
                            <div key={idx} style={{ display: 'flex', gap: 8 }}>
                              <input
                                className="input"
                                placeholder={`\\\\server\\share\\folder or C:\\Documents\\...`}
                                value={path}
                                onChange={e => {
                                  const newPaths = [...(editingTask.filePaths || [])];
                                  newPaths[idx] = e.target.value.replace(/["']/g, '');
                                  setEditingTask({ ...editingTask, filePaths: newPaths });
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn-danger btn-icon"
                                onClick={() => {
                                  const newPaths = (editingTask.filePaths || []).filter((_, i) => i !== idx);
                                  setEditingTask({ ...editingTask, filePaths: newPaths });
                                }}
                              >
                                <X style={{ width: 14, height: 14 }} />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ width: 'fit-content', gap: 6 }}
                            onClick={() => setEditingTask({ ...editingTask, filePaths: [...(editingTask.filePaths || []), ''] })}
                          >
                            <Plus style={{ width: 14, height: 14 }} /> {t('Add Path')}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

              </div>

              {/* Footer */}
              <div style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--border)',
                display: 'flex', gap: 12, justifyContent: 'flex-end',
                flexShrink: 0, background: 'var(--surface)',
              }}>
                <button className="btn btn-ghost" onClick={() => setEditingTask(null)}>{t('Cancel')}</button>
                <button
                  className="btn btn-primary"
                  onClick={handleUpdateTask}
                  disabled={!editingTask.taskName.trim()}
                  style={{ minWidth: 120 }}
                >
                  {t('Save Changes')}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Due-date prompt after a milestone update on an alerting task ── */}
      <AnimatePresence>
        {dueDatePrompt && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDueDatePrompt(null)}
          >
            <motion.div
              className="modal"
              style={{ maxWidth: 460 }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ padding: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <AlertCircle className="w-5 h-5" style={{ color: '#f97316' }} />
                  <h3 style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', margin: 0 }}>{t('Update the due date?')}</h3>
                </div>
                {/* The task name is its own bold line rather than an inline
                    <strong> inside the sentence: Arabic reorders the clause, so
                    a mid-sentence emphasis span cannot be translated safely. */}
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                  {dueDatePrompt.task.taskName}
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>
                  {t('This task is {{state}} (due {{due}}).', {
                    state: isOverdue(dueDatePrompt.task.dueDate) ? t('overdue') : t('due soon'),
                    due: dueDatePrompt.task.dueDate || '—',
                  })}{' '}
                  {t('You just updated the milestone “{{milestone}}”. Choose how to handle the due date:', {
                    milestone: dueDatePrompt.milestoneTitle,
                  })}
                </p>

                <div style={{ marginBottom: 20 }}>
                  <label className="label">{t('New due date')}</label>
                  <input
                    type="date"
                    className="input"
                    value={promptDueDate}
                    onChange={e => setPromptDueDate(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => resolveDueDatePrompt('custom')}
                    disabled={!promptDueDate || promptDueDate === dueDatePrompt.task.dueDate}
                  >
                    <Calendar className="w-4 h-4" /> {t('Change to selected date')}
                  </button>
                  <button className="btn btn-ghost" onClick={() => resolveDueDatePrompt('extend')}>
                    <Clock className="w-4 h-4" /> {t('Extend automatically — 3 days from today ({{date}})', { date: plusDaysISO(3) })}
                  </button>
                  <button className="btn btn-ghost" onClick={() => resolveDueDatePrompt('keep')}>
                    {t('Keep current due date')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
