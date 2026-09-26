/// <reference types="vite/client" />
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy,
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { User } from 'firebase/auth';
import {
  AppUser, Project, ProjectStatus, PROJECT_STATUS_OPTIONS,
} from './types';
import { getNextSerialNumber } from './lib/counters';
import { buildChecklist, templatesFor, localToday, checklistProgress } from './lib/checklists';
import { globalSearch, getUserColor } from './utils';
import { useDisplayLabel } from './lib/displayLabel';
import { useFormat, DATE_SHORT } from './lib/format';
import {
  Plus, X, FolderKanban, Building2, Calendar,
  Trash2, Edit2, AlertCircle, Check, ChevronDown, ChevronUp,
  Layers, ListChecks, MapPin, User as UserIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ProjectDetail from './ProjectDetail';
import GroupByBar, { GroupByOption } from './components/GroupByBar';
import BoardToolbar from './components/BoardToolbar';
import GroupGrid, { GroupCard } from './components/GroupGrid';
import GroupTabs, { GroupTab } from './components/GroupTabs';
import { byTaskUrgency, foldFinished, type OrderableTask } from './lib/taskOrder';
import { buildGroups, UNGROUPED } from './lib/grouping';
import type { AppView } from './App';
import { consumePending, subscribeOpen, takeConsumedTab } from './lib/deepLink';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  /** Threaded to ProjectDetail's Linked tab so it can open a task / email. */
  onNavigate?: (v: AppView) => void;
}

/**
 * The dimension the project grid is bucketed by (the same control the tasks and
 * correspondences boards grew first — see `components/GroupByBar.tsx`).
 *
 * `location` is the odd one out in a good way: on the other two boards it has to
 * be resolved through a linked project, but a Project OWNS its location field,
 * so this board needs no extra listener.
 *
 * `owner` is the project's creator (`userId`), which is the only person a
 * project stores — there is no assignee on this record.
 */
type ProjectGroupBy = 'status' | 'client' | 'location' | 'owner';

/**
 * Bucket order for `groupBy === 'status'`. `PROJECT_STATUS_OPTIONS` is already
 * written in lifecycle order, so it is reused rather than restated — the filter
 * select and the buckets can never drift apart.
 */
const PROJECT_STATUS_GROUP_ORDER: readonly ProjectStatus[] = PROJECT_STATUS_OPTIONS;

/**
 * Card accent per project status — the SAME four literals the summary tiles at
 * the top of this board already use, so a status never reads as one colour in
 * the tile row and another on the group card.
 */
const PROJECT_STATUS_ACCENT: Record<string, string> = {
  Active: '#3b82f6',
  'On Hold': '#f59e0b',
  Completed: '#16a34a',
  Cancelled: '#94a3b8',
};

/** Avatar glyph for the dimensions that have no person to show a face for. */
const PROJECT_GROUP_ICON: Partial<Record<ProjectGroupBy, LucideIcon>> = {
  status: ListChecks,
  client: Building2,
  location: MapPin,
};

/** localStorage key for the "show finished projects" choice (Tidy T5c). */
const SHOW_FINISHED_KEY = 'etaske:projects:showFinished';

/** An end date this close (days) paints the row orange. */
const ENDING_SOON_DAYS = 30;

/**
 * Completed or Cancelled = finished: folded away like a Done task. A running
 * project (Active / On Hold) is LATE once its end date has passed.
 */
const isFinishedProject = (p: Project) => p.status === 'Completed' || p.status === 'Cancelled';
const daysToEnd = (p: Project, today: string): number | null => {
  const end = (p.endDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const [y, m, d] = end.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
};
const isLateProject = (p: Project, today: string) => {
  if (isFinishedProject(p)) return false;
  const d = daysToEnd(p, today);
  return d !== null && d < 0;
};

/**
 * A project seen through the Tasks board's reading order (lib/taskOrder.ts):
 * past its end date → ending soonest → no end date, finished last.
 */
const asOrderable = (p: Project): OrderableTask => ({
  status: isFinishedProject(p) ? 'Done' : p.status,
  dueDate: isFinishedProject(p) ? undefined : p.endDate,
});

const emptyForm = () => ({
  name: '',
  code: '',
  client: '',
  operator: '',
  description: '',
  location: '',
  status: 'Active' as ProjectStatus,
  issueDate: '',
  rev: '',
  startDate: '',
  endDate: '',
});

export default function ProjectsDashboard({ user, appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const dl = useDisplayLabel();
  const fmt = useFormat();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  // Default = the Tasks board's order (Tidy T5c): late first, then the soonest
  // end date, undated, finished last.
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'status' | 'end'>('end');
  const [groupBy, setGroupBy] = useState<ProjectGroupBy>('status');
  /** `null` = the group grid is showing; a key = that bucket is drilled into. */
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [formData, setFormData] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Queue C3 — the standard checklist a NEW project starts with ('none' = empty).
  // Kept out of formData on purpose: handleSave spreads formData into the doc.
  const [checklistKey, setChecklistKey] = useState<string>('contract');
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  // Completed / Cancelled sit behind one "Show N finished" button — one
  // board-wide choice, remembered on this device (Tidy T5c).
  const [showFinished, setShowFinished] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOW_FINISHED_KEY) === '1'; } catch { return false; }
  });
  const toggleShowFinished = () => setShowFinished(v => {
    try { localStorage.setItem(SHOW_FINISHED_KEY, v ? '0' : '1'); } catch { /* private window */ }
    return !v;
  });
  const today = localToday();

  useEffect(() => {
    const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setProjects(snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Project)));
      setLoading(false);
    }, err => {
      console.error('Projects listener error:', err, { uid: auth.currentUser?.uid });
      setError(t('Failed to load projects.'));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Deep link — the client file (queue D1) or a command-palette hit opens one
  // project. Same two-step as OpportunitiesDashboard: park the id until the
  // snapshot carrying it has arrived, so a cold load still lands on the project.
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  // Queue D4: a link may also name the tab to land on (the Documents page does).
  const [openTab, setOpenTab] = useState<string | null>(null);
  useEffect(() => {
    const initial = consumePending('project');
    if (initial) { setPendingOpenId(initial); setOpenTab(takeConsumedTab()); }
    return subscribeOpen(ref => {
      if (ref.type === 'project') { setPendingOpenId(ref.id); setOpenTab(ref.tab ?? null); }
    });
  }, []);
  useEffect(() => {
    if (!pendingOpenId) return;
    if (projects.some(p => p.id === pendingOpenId)) setSelectedId(pendingOpenId);
    // Still loading — wait; once loaded and absent the project is gone.
    else if (loading) return;
    setPendingOpenId(null);
  }, [pendingOpenId, projects, loading]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { Active: 0, 'On Hold': 0, Completed: 0, Cancelled: 0 };
    projects.forEach(p => { if (p.status) counts[p.status] = (counts[p.status] || 0) + 1; });
    return counts;
  }, [projects]);

  const statusRank: Record<string, number> = { Active: 0, 'On Hold': 1, Completed: 2, Cancelled: 3 };
  const urgency = useMemo(() => byTaskUrgency<OrderableTask>(today), [today]);

  const visible = useMemo(() => {
    const rows = projects.filter(p => {
      if (statusFilter !== 'All' && p.status !== statusFilter) return false;
      if (search && !globalSearch(p, search)) return false;
      return true;
    });
    rows.sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'status') return (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
      // Late first, then soonest-ending, undated, finished last. Rows the
      // comparator calls equal keep the incoming createdAt-desc order (the sort
      // is stable), so undated projects still read newest-first.
      if (sortBy === 'end') return urgency(asOrderable(a), asOrderable(b));
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0); // recent
    });
    return rows;
  }, [projects, search, statusFilter, sortBy, urgency]);

  const isFiltering = search.trim() !== '' || statusFilter !== 'All';

  // A project stores only `userId` (its creator), so the owner buckets are keyed
  // by the resolved display name — an opaque uid would sort the buckets into a
  // meaningless order and print as a uid in the heading.
  const ownerNameById = useMemo(() => {
    const map = new Map<string, string>();
    projectUsers.forEach(u => { if (u.displayName) map.set(u.id, u.displayName); });
    return map;
  }, [projectUsers]);

  // What a project's group key is, per dimension. An empty string sends the row
  // to the trailing "no value" bucket (`UNGROUPED`).
  const groupKeyOf = useMemo(() => {
    switch (groupBy) {
      case 'status': return (p: Project) => p.status;
      case 'client': return (p: Project) => p.client;
      case 'location': return (p: Project) => p.location;
      case 'owner': return (p: Project) => ownerNameById.get(p.userId);
    }
  }, [groupBy, ownerNameById]);

  // Buckets over the already-sorted list. No `sort` is passed on purpose: unlike
  // the tasks and correspondences boards, this one has its own sort control, and
  // forcing an order here would make that select dead inside every bucket.
  const groupedProjects = useMemo(
    () => buildGroups(visible, groupKeyOf, {
      order: groupBy === 'status' ? PROJECT_STATUS_GROUP_ORDER : undefined,
    }),
    [visible, groupKeyOf, groupBy],
  );

  // The open bucket, re-resolved from `groupedProjects` every render: a filter
  // (or someone else's edit arriving over the listener) can empty the bucket the
  // user drilled into, and then `find` returns undefined and we fall back to the
  // grid instead of painting a blank section.
  const activeGroup = useMemo(
    () => (openGroup ? groupedProjects.find(g => g.key === openGroup) : undefined),
    [openGroup, groupedProjects],
  );

  // Switching dimension re-buckets everything, so the key that was open no
  // longer means anything.
  useEffect(() => { setOpenGroup(null); }, [groupBy]);

  // Grouping IS the grid: no open card means no project cards at all. There is
  // no deep-link bypass to build here — a selected project returns the
  // full-page `ProjectDetail` above, before any of this renders.
  const showGroupGrid = !activeGroup;

  // Finished projects are folded away unless asked for. A bucket holding
  // nothing but finished projects (the Completed group) shows them anyway —
  // see `foldFinished`.
  const fullList = activeGroup ? activeGroup.items : visible;
  const fold = useMemo(
    () => foldFinished(fullList, showFinished, [], isFinishedProject),
    [fullList, showFinished],
  );
  const finishedInList = useMemo(() => fullList.filter(isFinishedProject).length, [fullList]);

  // What the list renders: the open bucket only. This board has no pager, so
  // unlike the tasks/correspondences boards there is nothing else to re-scope.
  const renderGroups = useMemo(
    () => (activeGroup ? [{ key: activeGroup.key, value: activeGroup.value, items: fold.visible }] : []),
    [activeGroup, fold.visible],
  );

  // Header for one bucket. Each dimension gets its own phrasing because a single
  // "{{x}} Projects" template reads wrong for half of them ("Ahmed Projects").
  const groupHeading = (group: { key: string; value: string }) => {
    if (group.key === UNGROUPED) {
      switch (groupBy) {
        case 'client': return t('No client');
        case 'location': return t('No location');
        case 'owner': return t('No owner');
        default: return t('Uncategorized');
      }
    }
    const name = dl(group.value);
    switch (groupBy) {
      case 'client': return t('Client: {{name}}', { name });
      case 'location': return t('Location: {{name}}', { name });
      case 'owner': return t('Owner: {{name}}', { name });
      default: return t('{{status}} Projects', { status: name });
    }
  };

  // The card title is the group's NAME on its own — the "Client: …" / "Owner: …"
  // framing belongs on the drilled-in section header, not under a 44px avatar
  // that already says whose card this is.
  const groupTitle = (group: { key: string; value: string }) =>
    group.key === UNGROUPED ? groupHeading(group) : dl(group.value);

  // What the grid draws. One card per bucket: the count, plus the small status
  // breakdown that is the whole point of the card — it says what is inside
  // before you open it. Cancelled gets no chip of its own; three chips is what
  // fits a 240px card, and Active / On Hold / Completed are the states a
  // portfolio read actually turns on.
  const groupCards = useMemo<GroupCard[]>(() => groupedProjects.map(group => {
    const rows = group.items;
    const active = rows.filter(p => p.status === 'Active').length;
    const onHold = rows.filter(p => p.status === 'On Hold').length;
    const completed = rows.filter(p => p.status === 'Completed').length;
    // "Late" = the end date has passed on a project still meant to be running.
    // A Completed or Cancelled project is not late, it is finished.
    const late = rows.filter(p => isLateProject(p, today)).length;

    // Resolve the owner through a project's `userId`, not by matching the
    // bucket key against the directory — the key is a display name, and two
    // people can share one.
    const isPerson = groupBy === 'owner';
    const ownerId = isPerson ? rows.find(p => p.userId)?.userId : undefined;
    const owner = ownerId ? projectUsers.find(pu => pu.id === ownerId) : undefined;
    const title = groupTitle(group);

    return {
      key: group.key,
      title,
      subtitle: isPerson && owner?.role ? dl(owner.role) : undefined,
      accent: groupBy === 'status'
        ? PROJECT_STATUS_ACCENT[group.value] || 'var(--accent)'
        : isPerson
          ? (owner?.userColor || getUserColor(ownerId || group.value || group.key))
          : getUserColor(group.key),
      photoURL: isPerson ? owner?.photoURL : undefined,
      // A person gets an initial; a status/client/location gets the dimension's
      // icon, so the card still reads as "a thing of this kind".
      initial: isPerson ? title.charAt(0).toUpperCase() : undefined,
      icon: isPerson ? undefined : PROJECT_GROUP_ICON[groupBy],
      count: rows.length,
      countLabel: rows.length === 1 ? t('project') : t('projects'),
      badge: late > 0 ? `${late} ${t('OVERDUE')}` : undefined,
      // Grouping BY status already puts the status in the title, so repeating
      // the same chips under it would be pure noise.
      stats: groupBy === 'status' ? undefined : [
        { label: dl('Active'), value: active, tone: 'info' as const },
        { label: dl('On Hold'), value: onHold, tone: 'warn' as const },
        { label: dl('Completed'), value: completed, tone: 'success' as const },
      ],
    };
  }), [groupedProjects, groupBy, projectUsers, dl, t, today]);

  // Per-bucket totals over EVERY filtered project (finished ones too, folded
  // or not) — what the group tabs and the section header report.
  const groupTally = useMemo(() => {
    const m = new Map<string, { open: number; late: number; finished: number }>();
    for (const g of groupedProjects) {
      const finished = g.items.filter(isFinishedProject).length;
      m.set(g.key, { open: g.items.length - finished, late: g.items.filter(p => isLateProject(p, today)).length, finished });
    }
    return m;
  }, [groupedProjects, today]);

  const groupTabs = useMemo<GroupTab[]>(() => groupedProjects.map(g => ({
    key: g.key,
    label: groupTitle(g),
    count: g.items.length,
    late: groupTally.get(g.key)?.late || 0,
  })), [groupedProjects, groupTally, groupBy, dl, t]);

  const groupByOptions = useMemo<GroupByOption<ProjectGroupBy>[]>(() => [
    { key: 'status', label: t('Status'), icon: ListChecks },
    { key: 'client', label: t('Client'), icon: Building2 },
    { key: 'location', label: t('Location'), icon: MapPin },
    { key: 'owner', label: t('Owner'), icon: UserIcon },
  ], [t]);

  const selected = useMemo(() => projects.find(p => p.id === selectedId) || null, [projects, selectedId]);

  const openCreate = () => {
    setEditing(null);
    setFormData(emptyForm());
    setChecklistKey('contract');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditing(p);
    setFormError(null);
    setFormData({
      name: p.name || '',
      code: p.code || '',
      client: p.client || '',
      operator: p.operator || '',
      description: p.description || '',
      location: p.location || '',
      status: p.status || 'Active',
      issueDate: p.issueDate || '',
      rev: p.rev || '',
      startDate: p.startDate || '',
      endDate: p.endDate || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    const name = formData.name.trim();
    if (!name) { setFormError(t('Project name is required.')); return; }
    if (formData.startDate && formData.endDate && formData.endDate < formData.startDate) {
      setFormError(t('End date cannot be before the start date.'));
      return;
    }
    // Trim every text field so stray whitespace never reaches Firestore.
    const cleaned = Object.fromEntries(
      Object.entries(formData).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    ) as typeof formData;
    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      if (editing) {
        await updateDoc(doc(db, 'projects', editing.id), {
          ...cleaned,
          updatedAt: serverTimestamp(),
        });
      } else {
        const serialNumber = await getNextSerialNumber('projects');
        await addDoc(collection(db, 'projects'), {
          ...cleaned,
          // Written once, at birth; afterwards the Checklist tab owns it.
          checklist: buildChecklist(checklistKey, cleaned.startDate, localToday()),
          serialNumber,
          userId: user.uid,
          teamId: appUser.teamId || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setIsModalOpen(false);
      setEditing(null);
    } catch (e) {
      console.error('Save project failed:', e);
      setFormError(t('Failed to save project. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'projects', deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      console.error('Delete project failed:', e);
      setError(t('Failed to delete project.'));
    }
  };

  // ── Full-page detail view ──────────────────────────────────────────────────
  if (selected) {
    return (
      <ProjectDetail
        key={`${selected.id}:${openTab || ''}`}
        project={selected}
        user={user}
        appUser={appUser}
        projectUsers={projectUsers}
        initialTab={openTab || undefined}
        onBack={() => { setSelectedId(null); setOpenTab(null); }}
        onEdit={() => openEdit(selected)}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div className="board-page" style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div className="board-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="board-head-icon" style={{ padding: 10, background: 'rgba(59,130,246,0.1)', color: 'var(--accent)' }}>
            <FolderKanban className="w-6 h-6" />
          </div>
          <div>
            <h1 className="board-head-title" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{t('Projects')}</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {projects.length === 1
                ? t('{{count}} project', { count: 1 })
                : t('{{count}} projects', { count: projects.length })}
            </p>
          </div>
        </div>
        <button className="btn btn-primary board-head-action" onClick={openCreate} aria-label={t('New Project')} title={t('New Project')}>
          <Plus className="w-4 h-4" /> <span className="board-head-label">{t('New Project')}</span>
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fee2e2', color: '#991b1b', marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Summary stats */}
      {projects.length > 0 && (
        <div className="board-kpis board-kpis--three" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 18 }}>
          {/* The four status tiles are labelled through the display layer, so the
              tile and the badge on the card below can never disagree. "Total" is
              the only one that is UI copy rather than a stored value. */}
          {[
            { label: t('Total'), value: projects.length, filter: 'All' as const, color: 'var(--text-primary)' },
            { label: dl('Active'), value: statusCounts['Active'], filter: 'Active', color: '#3b82f6' },
            { label: dl('On Hold'), value: statusCounts['On Hold'], filter: 'On Hold', color: '#f59e0b' },
            { label: dl('Completed'), value: statusCounts['Completed'], filter: 'Completed', color: '#16a34a' },
            { label: dl('Cancelled'), value: statusCounts['Cancelled'], filter: 'Cancelled', color: '#94a3b8' },
          ].map(s => {
            const active = statusFilter === s.filter;
            return (
              <button
                key={s.filter}
                onClick={() => setStatusFilter(active && s.filter !== 'All' ? 'All' : s.filter)}
                className="card board-kpi"
                style={{ padding: '12px 14px', textAlign: 'start', cursor: 'pointer', border: active ? '1px solid var(--accent)' : '1px solid var(--border)', background: active ? 'rgba(59,130,246,0.08)' : 'var(--surface)' }}
              >
                <div className="board-kpi-value" style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div className="board-kpi-label" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginTop: 4 }}>{s.label}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* One toolbar row: search + Group by + the rest folded into `Filters`.
          The header above it keeps exactly one action — New Project. */}
      <BoardToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t('Search projects…')}
        compact
        groupBy={<GroupByBar<ProjectGroupBy> compact value={groupBy} onChange={setGroupBy} options={groupByOptions} />}
        activeFilterCount={(statusFilter !== 'All' ? 1 : 0) + (sortBy !== 'end' ? 1 : 0)}
        onClearFilters={() => { setStatusFilter('All'); setSortBy('end'); }}
        filters={
          <>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit' }}
            >
              <option value="All">{t('All statuses')}</option>
              {/* An <option> with no `value` takes its TEXT as its value, which would
                  write the Arabic label into the filter state — every one carries an
                  explicit English value. */}
              {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{dl(s)}</option>)}
            </select>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
              style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit' }}
              title={t('Sort projects')}
            >
              <option value="end">{t('End date (soonest)')}</option>
              <option value="recent">{t('Most recent')}</option>
              <option value="name">{t('Name (A–Z)')}</option>
              <option value="status">{t('Status')}</option>
            </select>
          </>
        }
      />

      {/* Grid */}
      {loading ? (
        <div className="card-grid">
          {[0, 1, 2].map(i => <div key={i} className="card skeleton" style={{ height: 170 }} />)}
        </div>
      ) : showGroupGrid ? (
        // Grouping IS the grid: one card per bucket, and the project cards only
        // appear once a card is opened. `groupCards` is built from every visible
        // project, so the counts are the real totals.
        <GroupGrid
          cards={groupCards}
          onSelect={setOpenGroup}
          empty={
            <div className="empty-state">
              <div className="empty-state-icon"><FolderKanban className="w-8 h-8" /></div>
              <div className="empty-state-title">{isFiltering ? t('No matching projects') : t('No projects yet')}</div>
              <div className="empty-state-sub">
                {isFiltering
                  ? t('No projects match your search or filter. Try clearing them.')
                  : t('Create your first project to start tracking contracts, financials and updates.')}
              </div>
              {isFiltering ? (
                <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => { setSearch(''); setStatusFilter('All'); }}>
                  {t('Clear filters')}
                </button>
              ) : (
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openCreate}>
                  <Plus className="w-4 h-4" /> {t('New Project')}
                </button>
              )}
            </div>
          }
        />
      ) : (
        <>
        {/* Group tabs (Tidy T5c): the first goes back to the grid, every other
            group is one tap away with its size and its late count. */}
        <GroupTabs
          tabs={groupTabs}
          active={activeGroup ? activeGroup.key : null}
          onSelect={setOpenGroup}
        />
        {/* `proj-list` is a size container: when the list is too narrow for one
            line, the rows fold to two (see index.css). */}
        <div className="proj-list" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {renderGroups.map(group => (
          <div key={group.key}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingInlineStart: 4 }}>
              <Layers className="w-4 h-4 text-accent" />
              {groupHeading(group)}
              {(() => {
                // The whole group's numbers, finished ones included: open · late · ended.
                const tally = groupTally.get(group.key);
                if (!tally) return null;
                return (
                  <span className="group-head-counts" data-group-counts>
                    <span className="group-head-chip">{t('Open: {{count}}', { count: tally.open })}</span>
                    {tally.late > 0 && <span className="group-head-chip group-head-chip--late">{t('Late: {{count}}', { count: tally.late })}</span>}
                    {tally.finished > 0 && <span className="group-head-chip group-head-chip--done">{t('Ended: {{count}}', { count: tally.finished })}</span>}
                  </span>
                );
              })()}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AnimatePresence>
            {group.items.map(p => {
              // Slim rows (Tidy T5c): ONE line per project — serial, name,
              // client, owner, end date, checklist, status. Code, location and
              // the rest live on the project page a click away.
              const finished = isFinishedProject(p);
              const dLeft = finished ? null : daysToEnd(p, today);
              const late = isLateProject(p, today);
              const soon = !late && dLeft !== null && dLeft <= ENDING_SOON_DAYS;
              // Read off the project itself (settled rule 1) — no extra query per row.
              const steps = !finished ? checklistProgress(p.checklist, today) : null;
              const owner = p.userId ? projectUsers.find(pu => pu.id === p.userId) : undefined;
              const ownerName = owner?.displayName || '';
              const color = PROJECT_STATUS_ACCENT[p.status];
              return (
                <motion.div
                  key={p.id}
                  exit={{ opacity: 0 }}
                  className="card card-interactive"
                  style={{
                    // The edge only speaks when something needs attention.
                    borderInlineStart: late ? '3px solid #ef4444' : soon ? '3px solid #f97316' : undefined,
                    backgroundColor: finished ? 'var(--surface-2)' : 'var(--surface)',
                  }}
                >
                  <div className="task-row proj-row" data-proj-row={p.id} onClick={() => setSelectedId(p.id)}>
                    <div className="task-row-main">
                      {p.serialNumber && <span className="task-row-serial ltr-data">{p.serialNumber}</span>}
                      {/* dir="auto": an Arabic name lines up on the right of its cell. */}
                      <h3 dir="auto" className="task-row-title" title={p.name} style={{ color: finished ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                        {p.name}
                      </h3>
                    </div>

                    <div className="task-row-meta">
                      <span className="task-row-from" title={p.client ? `${p.client}${p.operator ? ` · ${p.operator}` : ''}` : undefined}>
                        <Building2 className="w-3 h-3" style={{ flexShrink: 0 }} aria-hidden />
                        <span className="task-row-ellipsis" dir="auto">{p.client || '—'}</span>
                      </span>

                      {/* Grouped by owner, every row would repeat the group's name. */}
                      {groupBy !== 'owner' && (
                        <span className="task-row-owner" title={ownerName || undefined}>
                          {ownerName ? (
                            <>
                              {owner?.photoURL
                                ? <img src={owner.photoURL} className="avatar" style={{ width: 18, height: 18, objectFit: 'cover', flexShrink: 0 }} alt="" />
                                : <span className="task-row-initial" aria-hidden>{(ownerName.trim()[0] || '?').toUpperCase()}</span>}
                              <span className="task-row-ellipsis">{ownerName}</span>
                            </>
                          ) : <span className="task-row-ellipsis" style={{ color: 'var(--text-muted)' }}>—</span>}
                        </span>
                      )}

                      <span
                        className="task-row-due"
                        data-proj-end
                        title={p.endDate ? `${t('End date')}: ${p.endDate}` : undefined}
                        style={{ color: late ? '#ef4444' : soon ? '#ea580c' : 'var(--text-muted)', fontWeight: (late || soon) ? 700 : 500 }}
                      >
                        {p.endDate ? (
                          <>
                            {late ? <AlertCircle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
                            <span className="ltr-data">{p.endDate}</span>
                          </>
                        ) : <span aria-hidden>—</span>}
                      </span>

                      <span
                        className="task-row-progress proj-row-steps"
                        title={steps && steps.late > 0 ? (steps.late === 1 ? t('{{count}} step overdue', { count: 1 }) : t('{{count}} steps overdue', { count: steps.late })) : undefined}
                        style={steps && steps.late > 0 ? { color: '#dc2626', fontWeight: 700 } : undefined}
                      >
                        {steps && steps.total > 0 && (
                          <>
                            <ListChecks className="w-3 h-3" style={{ flexShrink: 0 }} aria-hidden />
                            <span data-testid="proj-card-checklist">{t('{{done}}/{{total}} steps', { done: steps.done, total: steps.total })}</span>
                          </>
                        )}
                      </span>

                      <span className="proj-row-updated">
                        {p.lastUpdateAt ? t('Updated {{date}}', { date: fmt.date(p.lastUpdateAt, DATE_SHORT) }) : ''}
                      </span>

                      <span className="task-row-status">
                        <span className="task-status-label" data-proj-status={p.status} style={finished || !color ? undefined : { color, borderColor: color }}>
                          {finished
                            ? <Check style={{ width: 12, height: 12, flexShrink: 0 }} />
                            : <span className="task-status-dot" style={{ background: 'currentColor' }} />}
                          <span>{dl(p.status)}</span>
                        </span>
                      </span>
                    </div>

                    <div className="task-row-actions" onClick={e => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openEdit(p)} title={t('Edit')} aria-label={t('Edit')}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button className="btn btn-ghost btn-icon btn-sm corr-row-delete" onClick={() => setDeleteTarget(p)} title={t('Delete')} aria-label={t('Delete')}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
            </div>
          </div>
          ))}
        </div>

        {/* Finished projects sit behind this one button — below the list, so
            running work is what the page leads with. */}
        {(fold.hidden > 0 || (showFinished && finishedInList > 0 && finishedInList < fullList.length)) && (
          <button
            type="button"
            className="btn btn-ghost btn-sm task-finished-toggle"
            data-finished-toggle={showFinished ? 'hide' : 'show'}
            aria-expanded={showFinished}
            onClick={toggleShowFinished}
          >
            {showFinished ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showFinished ? t('Hide finished projects') : t('Show {{count}} finished projects', { count: fold.hidden })}
          </button>
        )}
        </>
      )}

      {/* Create / Edit modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 560, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                {editing ? t('Edit Project') : t('New Project')}
              </h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}><X className="w-5 h-5" /></button>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              <Field label={t('Project name *')}>
                <input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="proj-input" placeholder={t('e.g. Meleiha Gas Plant O&M Contract')} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label={t('Contract / Code')}><input value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value })} className="proj-input" placeholder="4600002981" /></Field>
                <Field label={t('Status')}>
                  <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value as ProjectStatus })} className="proj-input">
                    {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{dl(s)}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label={t('Client')}><input value={formData.client} onChange={e => setFormData({ ...formData, client: e.target.value })} className="proj-input" placeholder="AGIBA" /></Field>
                <Field label={t('Operator')}><input value={formData.operator} onChange={e => setFormData({ ...formData, operator: e.target.value })} className="proj-input" placeholder="EPROM" /></Field>
              </div>
              <Field label={t('Location')}><input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} className="proj-input" /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label={t('Start date')}><input type="date" value={formData.startDate} onChange={e => setFormData({ ...formData, startDate: e.target.value })} className="proj-input" /></Field>
                <Field label={t('End date')}><input type="date" value={formData.endDate} onChange={e => setFormData({ ...formData, endDate: e.target.value })} className="proj-input" /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label={t('Issue date')}><input type="date" value={formData.issueDate} onChange={e => setFormData({ ...formData, issueDate: e.target.value })} className="proj-input" /></Field>
                <Field label={t('Rev.')}><input value={formData.rev} onChange={e => setFormData({ ...formData, rev: e.target.value })} className="proj-input" placeholder="0" /></Field>
              </div>
              <Field label={t('Description')}><textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className="proj-input" rows={3} /></Field>

              {!editing && (
                <Field label={t('Starting checklist')}>
                  <select value={checklistKey} onChange={e => setChecklistKey(e.target.value)} className="proj-input" data-testid="proj-checklist-template">
                    {templatesFor('project').map(tp => (
                      <option key={tp.key} value={tp.key}>{t('{{name}} — {{count}} steps', { name: t(tp.label), count: tp.steps.length })}</option>
                    ))}
                    <option value="none">{t('No checklist')}</option>
                  </select>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {formData.startDate
                      ? t('Each step is dated from the start date. You can edit them later on the Checklist tab.')
                      : t('Add the start date and each step gets its own date.')}
                  </span>
                </Field>
              )}
            </div>

            {formError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: '#fee2e2', color: '#991b1b', marginTop: 16, fontSize: 13, fontWeight: 600 }}>
                <AlertCircle className="w-4 h-4" style={{ flexShrink: 0 }} /> {formError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>{t('Cancel')}</button>
              <button className="btn btn-primary" disabled={saving || !formData.name.trim()} onClick={handleSave}>{saving ? t('Saving…') : (editing ? t('Save changes') : t('Create project'))}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 420, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{t('Delete project?')}</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 20px' }}>
              {t('"{{name}}" will be removed. Its contracts, financials and updates are not auto-deleted.', { name: deleteTarget.name })}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={handleDelete}>{t('Delete')}</button>
            </div>
          </div>
        </div>
      )}

      <style>{`.proj-input { width:100%; padding:9px 11px; background:var(--surface); border:1px solid var(--border); color:var(--text-primary); font-size:14px; font-family:inherit; }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}
