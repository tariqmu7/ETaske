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
import { globalSearch, getUserColor, isOverdue } from './utils';
import { useDisplayLabel } from './lib/displayLabel';
import { useFormat, DATE_SHORT } from './lib/format';
import {
  Plus, X, FolderKanban, Building2,
  Trash2, Edit2, ChevronRight, AlertCircle, ArrowLeft,
  Layers, ListChecks, MapPin, User as UserIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ProjectDetail from './ProjectDetail';
import GroupByBar, { GroupByOption } from './components/GroupByBar';
import BoardToolbar from './components/BoardToolbar';
import GroupGrid, { GroupCard } from './components/GroupGrid';
import CardMenu from './components/CardMenu';
import { buildGroups, byDueDateAsc, UNGROUPED } from './lib/grouping';
import type { AppView } from './App';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  /** Threaded to ProjectDetail's Linked tab so it can open a task / email. */
  onNavigate?: (v: AppView) => void;
}

function statusBadgeClass(s?: ProjectStatus) {
  switch (s) {
    case 'Active': return 'badge badge-inprogress';
    case 'On Hold': return 'badge badge-pending';
    case 'Completed': return 'badge badge-done';
    case 'Cancelled': return 'badge badge-closed';
    default: return 'badge';
  }
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

/** "Soonest end date first, undated last" — the optional in-bucket sort. */
const byEndDate = byDueDateAsc<Project>(p => p.endDate);

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
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'status' | 'end'>('recent');
  const [groupBy, setGroupBy] = useState<ProjectGroupBy>('status');
  /** `null` = the group grid is showing; a key = that bucket is drilled into. */
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [formData, setFormData] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

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

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { Active: 0, 'On Hold': 0, Completed: 0, Cancelled: 0 };
    projects.forEach(p => { if (p.status) counts[p.status] = (counts[p.status] || 0) + 1; });
    return counts;
  }, [projects]);

  const statusRank: Record<string, number> = { Active: 0, 'On Hold': 1, Completed: 2, Cancelled: 3 };

  const visible = useMemo(() => {
    const rows = projects.filter(p => {
      if (statusFilter !== 'All' && p.status !== statusFilter) return false;
      if (search && !globalSearch(p, search)) return false;
      return true;
    });
    rows.sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'status') return (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
      // Soonest-ending first. Rows the comparator calls equal keep the incoming
      // createdAt-desc order (the sort is stable), so undated projects still
      // read newest-first at the bottom.
      if (sortBy === 'end') return byEndDate(a, b);
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0); // recent
    });
    return rows;
  }, [projects, search, statusFilter, sortBy]);

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

  // What the list renders: the open bucket only. This board has no pager, so
  // unlike the tasks/correspondences boards there is nothing else to re-scope.
  const renderGroups = useMemo(
    () => (activeGroup ? [activeGroup] : []),
    [activeGroup],
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
    const late = rows.filter(p => p.status !== 'Completed' && p.status !== 'Cancelled' && isOverdue(p.endDate)).length;

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
  }), [groupedProjects, groupBy, projectUsers, dl, t]);

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
        project={selected}
        user={user}
        appUser={appUser}
        projectUsers={projectUsers}
        onBack={() => setSelectedId(null)}
        onEdit={() => openEdit(selected)}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 10, background: 'rgba(59,130,246,0.1)', color: 'var(--accent)' }}>
            <FolderKanban className="w-6 h-6" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{t('Projects')}</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {projects.length === 1
                ? t('{{count}} project', { count: 1 })
                : t('{{count}} projects', { count: projects.length })}
            </p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus className="w-4 h-4" /> {t('New Project')}
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fee2e2', color: '#991b1b', marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Summary stats */}
      {projects.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 18 }}>
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
                className="card"
                style={{ padding: '12px 14px', textAlign: 'start', cursor: 'pointer', border: active ? '1px solid var(--accent)' : '1px solid var(--border)', background: active ? 'rgba(59,130,246,0.08)' : 'var(--surface)' }}
              >
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginTop: 4 }}>{s.label}</div>
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
        groupBy={<GroupByBar<ProjectGroupBy> value={groupBy} onChange={setGroupBy} options={groupByOptions} />}
        activeFilterCount={(statusFilter !== 'All' ? 1 : 0) + (sortBy !== 'recent' ? 1 : 0)}
        onClearFilters={() => { setStatusFilter('All'); setSortBy('recent'); }}
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
              <option value="recent">{t('Most recent')}</option>
              <option value="name">{t('Name (A–Z)')}</option>
              <option value="status">{t('Status')}</option>
              <option value="end">{t('End date (soonest)')}</option>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* The only way back to the grid. */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setOpenGroup(null)}
            style={{ alignSelf: 'flex-start' }}
          >
            <ArrowLeft className="w-4 h-4" /> {t('All Groups')}
          </button>
          {renderGroups.map(group => (
          <div key={group.key}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, paddingInlineStart: 4 }}>
              <Layers className="w-4 h-4 text-accent" />
              {groupHeading(group)}
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginInlineStart: 'auto', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 0 }}>{group.items.length}</span>
            </h2>
            <div className="card-grid">
          <AnimatePresence>
            {group.items.map(p => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="card card-interactive"
                style={{ padding: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
                onClick={() => setSelectedId(p.id)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <span className={statusBadgeClass(p.status)}>{dl(p.status)}</span>
                  <CardMenu items={[
                    { label: t('Edit'), icon: <Edit2 className="w-3.5 h-3.5" />, onClick: () => openEdit(p) },
                    { label: t('Delete'), icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => setDeleteTarget(p), danger: true },
                  ]} />
                </div>

                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0, lineHeight: 1.3 }}>{p.name}</h3>
                  {p.serialNumber && (
                    <span className="ltr-data" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{p.serialNumber}</span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {p.client && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Building2 className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /> {p.client}{p.operator ? ` · ${p.operator}` : ''}</div>}
                </div>

                <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {p.lastUpdateAt ? t('Updated {{date}}', { date: fmt.date(p.lastUpdateAt, DATE_SHORT) }) : ''}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                    {t('Open')} <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
            </div>
          </div>
          ))}
        </div>
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
