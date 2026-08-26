/// <reference types="vite/client" />
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy, deleteField
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { subscribeVisibleTasks } from './lib/taskVisibility';
import { createNotification, notifyManagers } from './lib/pushNotification';
import { taskDetails, corrDetails } from './lib/notifyDetails';
import { User } from 'firebase/auth';
import {
  AppUser, Corresponding, CorrespondingStatus, Project, RecordLinks, Task, TaskNote,
  DEPARTMENT_OPTIONS, PROJECT_OPTIONS, PRIORITY_OPTIONS, OperationType, FirestoreErrorInfo,
  CATEGORY_OPTIONS, CorrespondingCategory
} from './types';
import {
  actorFrom, announceNewRecord, buildRecordLinks, hasAnyLink, linksOf,
  LinkSource, mirrorRecordEvent, newlyLinked, recordLinksPatch,
} from './lib/recordLinks';
import { getNextSerialNumber } from './lib/counters';
import { consumePending, subscribeOpen } from './lib/deepLink';
import {
  Plus, Filter, X, AlertCircle, MailOpen, ChevronDown, FileText,
  Paperclip, Calendar, Download, Trash2, Edit2, Clock, Building2, Tag, ExternalLink,
  UserPlus, Send, MessageSquare, Layers, ListChecks, MapPin, User as UserIcon, ArrowLeft
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { globalSearch, getUserColor, getGoogleDrivePreviewUrl, isOverdue, isDueSoon, openOrCopyPath, toUncPath } from './utils';
import { useDisplayLabel } from './lib/displayLabel';
import { useFormat } from './lib/format';
import { Copy, Check } from 'lucide-react';
import { AppView } from './App';
import ComboBox from './components/ComboBox';
import RecordLinkPicker from './components/RecordLinkPicker';
import GroupByBar, { GroupByOption } from './components/GroupByBar';
import BoardToolbar from './components/BoardToolbar';
import GroupGrid, { GroupCard } from './components/GroupGrid';
import { buildGroups, byDueDateAsc, UNGROUPED } from './lib/grouping';

function handleFirestoreError(error: unknown, op: OperationType, path: string | null) {
  console.error('Firestore Error:', { error, op, path, uid: auth.currentUser?.uid });
}

function statusBadgeClass(s: CorrespondingStatus) {
  switch (s) {
    case 'Unread': return 'badge badge-pending';
    case 'Reviewing': return 'badge badge-review';
    case 'Assigned': return 'badge badge-assigned';
    case 'Closed': return 'badge badge-closed';
    default: return 'badge';
  }
}

/**
 * The dimension the intake list is bucketed by (the same control the tasks board
 * grew first — see `components/GroupByBar.tsx`). `status` is the default because
 * the intake question is always "what still needs reading / reviewing / closing".
 *
 * **Sender and assignee are two options, not one.** They look interchangeable
 * but they are not: the default status filter here is `Unassigned`, so grouping
 * that view by assignee would put every visible row in a single "Unassigned"
 * bucket and say nothing. "Sent From" is what actually separates unassigned
 * intake; "Assignee" only earns its keep once the list is filtered to assigned
 * work.
 */
type CorrGroupBy = 'status' | 'category' | 'location' | 'sender' | 'user';

/** Bucket order for `groupBy === 'status'` — the intake workflow order. */
const CORR_STATUS_GROUP_ORDER: readonly CorrespondingStatus[] = ['Unread', 'Reviewing', 'Assigned', 'Closed'];

/**
 * Card accent per intake status. Literal hexes matching the four badge classes
 * the list already uses (`badge-pending` amber, `badge-review` blue,
 * `badge-assigned` violet, `badge-closed` grey) — the grid must not invent a
 * second palette for the same four words.
 */
const CORR_STATUS_ACCENT: Record<string, string> = {
  Unread: '#f59e0b',
  Reviewing: '#3b82f6',
  Assigned: '#8b5cf6',
  Closed: '#94a3b8',
};

/** Avatar glyph for the dimensions that have no person to show a face for. */
const CORR_GROUP_ICON: Partial<Record<CorrGroupBy, LucideIcon>> = {
  status: ListChecks,
  category: Tag,
  location: MapPin,
  sender: Send,
};

// Every history echo describes the correspondence the same way, wherever it is
// written from (the form, quick-assign, the ManagerInbox conversion).
const corrSource = (
  fields: { id: string; subject: string; serialNumber?: string; status?: string; assignedTo?: string; deadline?: string },
): LinkSource => ({
  kind: 'correspondence',
  id: fields.id,
  title: fields.subject,
  serialNumber: fields.serialNumber || undefined,
  status: fields.status,
  assignedTo: fields.assignedTo || undefined,
  dueDate: fields.deadline || undefined,
});

function priorityBadgeClass(p: string) {
  switch (p) {
    case 'Urgent': return 'badge badge-urgent';
    case 'High': return 'badge badge-high';
    case 'Medium': return 'badge badge-medium';
    case 'Low': return 'badge badge-low';
    default: return 'badge';
  }
}

const emptyForm = () => ({
  subject: '',
  body: '',
  sentFrom: '',
  department: 'None',
  subCategory: 'None',
  category: 'Internal' as CorrespondingCategory,
  priority: 'Medium' as Corresponding['priority'],
  dateReceived: new Date().toISOString().split('T')[0],
  deadline: '',
  actions: 'None',
  attachedFile: '',
  attachedFileName: '',
  serialNumber: '',
  notes: '',
  status: 'Unread' as CorrespondingStatus,
  assignedTo: '',
  assignedToId: '',
  filePaths: [] as string[],
});

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
  initialStatusFilter?: string;
}

export default function CorrespondingsDashboard({ user, appUser, projectUsers, onNavigate, initialStatusFilter }: Props) {
  const { t } = useTranslation();
  // Task 6: stored English enum values are PAINTED in the active language;
  // what is written to Firestore is unchanged. See lib/displayLabel.ts.
  const label = useDisplayLabel();
  const fmt = useFormat();
  const [items, setItems] = useState<Corresponding[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Corresponding | null>(null);
  const [isViewing, setIsViewing] = useState(false);
  const [formData, setFormData] = useState(emptyForm());
  // The link block is kept OUT of `formData`: it is written through
  // `buildRecordLinks`/`recordLinksPatch`, never as plain form fields, and a
  // dropped link has to become `deleteField()` rather than an empty string.
  const [formLinks, setFormLinks] = useState<RecordLinks>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter || 'Unassigned');

  // Apply an incoming filter when navigated here from another view (e.g. Overview stat cards)
  useEffect(() => {
    if (initialStatusFilter) setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);
  const [deptFilter, setDeptFilter] = useState<string>('All');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Corresponding | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [selectedCorrForDetails, setSelectedCorrForDetails] = useState<Corresponding | null>(null);
  const [pendingOpenCorrId, setPendingOpenCorrId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [groupBy, setGroupBy] = useState<CorrGroupBy>('status');
  // `null` = the card grid is showing. A key = that bucket is drilled into and
  // the list below is scoped (and paginated) to it.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // Projects are read for ONE reason: a correspondence carries no location of
  // its own (src/types.ts — `location` lives on Project), so "group by location"
  // has to resolve it through the record link `projectId`.
  const [projects, setProjects] = useState<Project[]>([]);
  // Inline quick-assign drafts for unassigned cards, keyed by correspondence id
  const [assignDraft, setAssignDraft] = useState<Record<string, { toId: string; comment: string }>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const setDraft = (id: string, patch: Partial<{ toId: string; comment: string }>) =>
    setAssignDraft(p => ({ ...p, [id]: { toId: '', comment: '', ...p[id], ...patch } }));

  const copyToClipboard = (path: string) => {
    navigator.clipboard.writeText(toUncPath(path));
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  // Firestore listener. Every approved user may read the whole collection
  // (firestore.rules: `allow read: if isApproved()`); department visibility is
  // applied client-side in `visibleItems` since the creator's department lives
  // on their user profile, not on the correspondence doc.
  useEffect(() => {
    const q = query(collection(db, 'correspondences'), orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Corresponding)));
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'correspondences');
      setError(t('Failed to load correspondences.'));
    });
    return () => unsub();
  }, [appUser]);

  // Deep-link: a correspondence shared in chat (src/lib/deepLink.ts). Stash the
  // id until it has loaded, then open its detail modal.
  useEffect(() => {
    const initial = consumePending('corresponding');
    if (initial) setPendingOpenCorrId(initial);
    return subscribeOpen(ref => {
      if (ref.type === 'corresponding') setPendingOpenCorrId(ref.id);
    });
  }, []);

  useEffect(() => {
    if (!pendingOpenCorrId) return;
    const found = items.find(i => i.id === pendingOpenCorrId);
    if (!found) return; // wait for data
    setSelectedCorrForDetails(found);
    setPendingOpenCorrId(null);
  }, [pendingOpenCorrId, items]);

  // Department scoping: an Admin sees every correspondence. A Manager or
  // Employee only sees correspondences whose *creator* is in the same
  // department as them (plus anything they logged themselves, so a user never
  // loses sight of their own entries even if their department is unset).
  const isAdmin = appUser.role === 'Admin';

  const departmentByUserId = useMemo(() => {
    const map = new Map<string, string | undefined>();
    projectUsers.forEach(u => { map.set(u.id, u.department); });
    return map;
  }, [projectUsers]);

  const visibleItems = useMemo(() => {
    if (isAdmin) return items;
    return items.filter(i =>
      i.userId === user.uid ||
      (!!appUser.department && departmentByUserId.get(i.userId) === appUser.department)
    );
  }, [items, isAdmin, departmentByUserId, appUser.department, user.uid]);

  // Load tasks for linking (privacy-aware: public + own only)
  useEffect(() => {
    const unsub = subscribeVisibleTasks(user.uid, rows => setTasks(rows));
    return () => unsub();
  }, [user.uid]);

  // Projects listener — only feeds the location lookup below. A failure is not
  // surfaced to the user: it costs the location grouping its labels, nothing
  // else, and the intake list itself is unaffected.
  useEffect(() => {
    if (appUser.status !== 'Approved') return;
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

  const filtered = useMemo(() => {
    return visibleItems.filter(i => {
      if (search && !globalSearch(i, search)) return false;
      if (statusFilter === 'Open') { if (i.status === 'Closed') return false; }
      else if (statusFilter === 'NeedsReview') { if (i.status !== 'Unread' && i.status !== 'Reviewing') return false; }
      else if (statusFilter === 'Unassigned') { if (i.assignedToId || i.status === 'Closed') return false; }
      else if (statusFilter !== 'All' && i.status !== statusFilter) return false;
      if (deptFilter !== 'All' && i.department !== deptFilter) return false;
      if (dateFilter && i.dateReceived !== dateFilter) return false;
      return true;
    });
  }, [visibleItems, search, statusFilter, deptFilter, dateFilter]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, deptFilter, dateFilter]);

  // What a correspondence's group key is, per dimension. An empty string sends
  // the row to the trailing "no value" bucket (`UNGROUPED`).
  const groupKeyOf = useMemo(() => {
    switch (groupBy) {
      case 'status':
        return (i: Corresponding) => i.status;
      // `category` is free text (`CorrespondingCategory = string`) with the
      // CATEGORY_OPTIONS as suggestions, so the buckets are whatever was typed —
      // alphabetical, no fixed order.
      case 'category':
        return (i: Corresponding) => i.category;
      case 'location':
        return (i: Corresponding) => (i.projectId ? projectLocationById.get(i.projectId) : '');
      case 'sender':
        return (i: Corresponding) => i.sentFrom;
      case 'user':
        return (i: Corresponding) => i.assignedTo;
    }
  }, [groupBy, projectLocationById]);

  // Buckets over EVERY filtered correspondence, not just the current page: each
  // card carries a count, and a count taken from one page of 20 would be a lie
  // ("3 correspondences" on a card holding 40). Pagination moved below, onto
  // whatever list is actually on screen.
  //
  // Sorted soonest-deadline-first inside each bucket (undated last; equal dates
  // keep newest-created-first — the listener orders createdAt desc and
  // `buildGroups` sorts stably).
  const groupedItems = useMemo(
    () => buildGroups(filtered, groupKeyOf, {
      order: groupBy === 'status' ? CORR_STATUS_GROUP_ORDER : undefined,
      sort: byDueDateAsc<Corresponding>(i => i.deadline),
    }),
    [filtered, groupKeyOf, groupBy],
  );

  // The open bucket, re-resolved from `groupedItems` every render: a filter (or
  // someone else's edit arriving over the listener) can empty the bucket the
  // user drilled into, and then `find` returns undefined and we fall back to the
  // grid instead of painting a blank list.
  const activeGroup = useMemo(
    () => (openGroup ? groupedItems.find(g => g.key === openGroup) : undefined),
    [openGroup, groupedItems],
  );

  // Switching dimension re-buckets everything, so the key that was open no
  // longer means anything.
  useEffect(() => { setOpenGroup(null); }, [groupBy]);

  // Opening/closing a card swaps the list under the pager, so page 3 of the old
  // list must not survive into the new one.
  useEffect(() => { setCurrentPage(1); }, [openGroup]);

  // Grouping IS the grid: no open card means no list at all. Unlike the tasks
  // board there is no deep-link bypass to build — a shared correspondence opens
  // the detail modal, which sits above the grid.
  const showGroupGrid = !activeGroup;

  const listSource = activeGroup ? activeGroup.items : filtered;
  const totalPages = Math.ceil(listSource.length / itemsPerPage);
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return listSource.slice(startIndex, startIndex + itemsPerPage);
  }, [listSource, currentPage]);

  // What the list renders: the open bucket, one page of it.
  const renderGroups = useMemo(
    () => (activeGroup ? [{ key: activeGroup.key, value: activeGroup.value, items: paginatedItems }] : []),
    [activeGroup, paginatedItems],
  );

  // Header for one bucket. Each dimension gets its own phrasing because one
  // template reads wrong for half of them ("Ahmed Correspondences").
  const groupHeading = (group: { key: string; value: string }) => {
    if (group.key === UNGROUPED) {
      switch (groupBy) {
        case 'location': return t('No location');
        case 'sender': return t('No sender');
        case 'user': return t('Unassigned');
        default: return t('Uncategorized');
      }
    }
    const name = label(group.value);
    switch (groupBy) {
      case 'category': return t('Category: {{name}}', { name });
      case 'location': return t('Location: {{name}}', { name });
      case 'sender': return t('From {{name}}', { name });
      case 'user': return t('Assigned to {{name}}', { name });
      default: return t('{{status}} Correspondences', { status: name });
    }
  };

  // The card title is the group's NAME on its own — the "From …" / "Assigned to
  // …" framing belongs on the drilled-in section header, not under a 44px avatar
  // that already says who this is.
  const groupTitle = (group: { key: string; value: string }) =>
    group.key === UNGROUPED ? groupHeading(group) : label(group.value);

  // What the grid draws. One card per bucket: the count, plus the small status
  // breakdown that is the whole point of the card — it says what is inside
  // before you open it. Reviewing gets no chip of its own; three chips is what
  // fits a 240px card, and Unread/Assigned/Closed are the states an intake
  // decision actually turns on.
  const groupCards = useMemo<GroupCard[]>(() => groupedItems.map(group => {
    const rows = group.items;
    const unread = rows.filter(i => i.status === 'Unread').length;
    const assigned = rows.filter(i => i.status === 'Assigned').length;
    const closed = rows.filter(i => i.status === 'Closed').length;
    const overdue = rows.filter(i => i.status !== 'Closed' && isOverdue(i.deadline)).length;

    // Resolve the person through `assignedToId`, not by matching the display
    // name against the directory — the bucket key is a name, and two people can
    // share one.
    const isPerson = groupBy === 'user';
    const assigneeId = isPerson ? rows.find(i => i.assignedToId)?.assignedToId : undefined;
    const assignee = assigneeId ? projectUsers.find(pu => pu.id === assigneeId) : undefined;
    const title = groupTitle(group);

    return {
      key: group.key,
      title,
      subtitle: isPerson && assignee?.role ? label(assignee.role) : undefined,
      accent: groupBy === 'status'
        ? CORR_STATUS_ACCENT[group.value] || 'var(--accent)'
        : isPerson
          ? (assignee?.userColor || getUserColor(assigneeId || group.value || group.key))
          : getUserColor(group.key),
      photoURL: isPerson ? assignee?.photoURL : undefined,
      // A person gets an initial; a status/category/location/sender gets the
      // dimension's icon, so the card still reads as "a thing of this kind".
      initial: isPerson ? title.charAt(0).toUpperCase() : undefined,
      icon: isPerson ? undefined : CORR_GROUP_ICON[groupBy],
      count: rows.length,
      countLabel: rows.length === 1 ? t('correspondence') : t('correspondences'),
      badge: overdue > 0 ? `${overdue} ${t('OVERDUE')}` : undefined,
      // Grouping BY status already puts the status in the title, so repeating
      // the same chips under it would be pure noise.
      stats: groupBy === 'status' ? undefined : [
        { label: t('Unread'), value: unread, tone: 'neutral' as const },
        { label: t('Assigned'), value: assigned, tone: 'info' as const },
        { label: t('Closed'), value: closed, tone: 'success' as const },
      ],
    };
  }), [groupedItems, groupBy, projectUsers, label, t]);

  const groupByOptions = useMemo<GroupByOption<CorrGroupBy>[]>(() => [
    { key: 'status', label: t('Status'), icon: ListChecks },
    { key: 'category', label: t('Category'), icon: Tag },
    { key: 'location', label: t('Location'), icon: MapPin },
    { key: 'sender', label: t('Sent From'), icon: Send },
    { key: 'user', label: t('Assignee'), icon: UserIcon },
  ], [t]);

  const stats = useMemo(() => ({
    total: visibleItems.length,
    unread: visibleItems.filter(i => i.status === 'Unread').length,
    unassigned: visibleItems.filter(i => !i.assignedToId && i.status !== 'Closed').length,
    needsReview: visibleItems.filter(i => i.status === 'Unread' || i.status === 'Reviewing').length,
    assigned: visibleItems.filter(i => i.status === 'Assigned').length,
    closed: visibleItems.filter(i => i.status === 'Closed').length,
  }), [visibleItems]);

  // Managers/Admins get the review + team-workload affordances; everyone else
  // sees the plain intake list.
  const isManager = appUser.role === 'Admin' || appUser.role === 'Manager';

  // Team members this manager can hand work to (mirrors the assignee dropdown).
  const targetUsers = useMemo(() => {
    return projectUsers.filter(u =>
      u.status === 'Approved' &&
      (u.id === user.uid || isAdmin || (u.department === appUser.department && u.teamId === appUser.teamId))
    );
  }, [projectUsers, isAdmin, appUser.department, appUser.teamId, user.uid]);

  const dynamicSubCategories = useMemo(() => {
    if (formData.category === 'Project') return PROJECT_OPTIONS;
    return Array.from(new Set(visibleItems.filter(i => i.department === formData.department).map(i => i.subCategory).filter(Boolean))).sort();
  }, [visibleItems, formData.department, formData.category]);

  // Departments already used on correspondences become suggestions, so a value
  // added once through the combobox is offered from then on.
  const dynamicDepartments = useMemo(() => {
    const used = visibleItems.map(i => i.department).filter(Boolean) as string[];
    return Array.from(new Set([...DEPARTMENT_OPTIONS, ...used]))
      .filter(d => d && d !== 'None' && d !== 'Other...')
      .sort();
  }, [visibleItems]);

  const openModal = (item?: Corresponding, viewing = false) => {
    setIsViewing(viewing);
    if (item) {
      setEditing(item);
      setFormData({
        subject: item.subject, body: item.body, sentFrom: item.sentFrom,
        department: item.department, subCategory: item.subCategory || '',
        category: item.category || 'Internal',
        priority: item.priority, dateReceived: item.dateReceived, deadline: item.deadline || '',
        actions: item.actions || 'None',
        attachedFile: item.attachedFile || '', attachedFileName: item.attachedFileName || '',
        serialNumber: item.serialNumber || '', notes: item.notes || '', status: item.status,
        assignedTo: item.assignedTo || '', assignedToId: item.assignedToId || '',
        filePaths: item.filePaths || [],
      });
      setFormLinks(linksOf(item));
    } else {
      setEditing(null);
      setFormData(emptyForm());
      setFormLinks({});
    }
    setIsModalOpen(true);
  };

  const closeModal = () => { setIsModalOpen(false); setEditing(null); };

  const set = (f: string, v: any) => setFormData(p => ({ ...p, [f]: v }));

  const uploadToGoogleDrive = async (file: File): Promise<string> => {
    const scriptUrl = import.meta.env.VITE_GOOGLE_SCRIPT_URL;
    if (!scriptUrl) {
      throw new Error('Google Script URL (VITE_GOOGLE_SCRIPT_URL) is not configured in environment variables.');
    }

    // Read file as base64
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const response = await fetch(scriptUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: import.meta.env.VITE_GOOGLE_SCRIPT_SECRET,
        filename: file.name,
        mimeType: file.type,
        base64: base64
      })
    });

    if (!response.ok) throw new Error('Network response was not ok');
    const result = await response.json();
    if (result.status === 'success') return result.url;
    throw new Error(result.message || 'Upload failed');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Google Drive can handle larger files, but let's keep a reasonable limit
    if (file.size > 10 * 1024 * 1024) {
      alert(t('Max file size is 10MB.'));
      return;
    }

    setIsUploading(true);
    try {
      const driveUrl = await uploadToGoogleDrive(file);
      setFormData(p => ({ ...p, attachedFile: driveUrl, attachedFileName: file.name }));
    } catch (err: any) {
      console.error('Upload error:', err);
      alert(t('Failed to upload to Google Drive: {{message}}', { message: err.message }));
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data: any = {
      ...formData,
      // On a CREATE the picked links are embedded as-is (absent keys mean "no
      // link"); on an UPDATE they must go through `recordLinksPatch`, because a
      // link the user removed has to be written as `deleteField()`.
      ...(editing ? recordLinksPatch(formLinks) : formLinks),
      userId: user.uid,
      teamId: appUser.teamId || 'NONE',
      updatedAt: serverTimestamp(),
    };
    if (!formData.attachedFile && editing) {
      data.attachedFile = deleteField();
      data.attachedFileName = deleteField();
    }
    // Read BEFORE the awaited write: the live snapshot may already have replaced
    // the row by the time the mirror decides what is newly linked.
    const priorLinks = editing ? linksOf(editing) : {};
    const statusChanged = !!editing && editing.status !== formData.status;
    const actor = actorFrom(user.uid, appUser);
    try {
      let docId = editing?.id;
      let corrSerial = formData.serialNumber;
      if (editing) {
        await updateDoc(doc(db, 'correspondences', editing.id), data);
      } else {
        corrSerial = await getNextSerialNumber('correspondences');
        const docRef = await addDoc(collection(db, 'correspondences'), { ...data, serialNumber: corrSerial, createdAt: serverTimestamp() });
        docId = docRef.id;
      }

      // Echo into the linked bid / project. Best-effort by design (see
      // lib/recordLinks.ts) — the correspondence is already saved either way.
      const source = corrSource({
        id: docId!, subject: formData.subject, serialNumber: corrSerial,
        status: formData.status, assignedTo: formData.assignedTo, deadline: formData.deadline,
      });
      const freshLinks = newlyLinked(priorLinks, formLinks);
      if (!editing) {
        if (hasAnyLink(formLinks)) await announceNewRecord(formLinks, source, actor);
      } else if (hasAnyLink(freshLinks)) {
        // A newly attached target is told it was attached — not that the status
        // moved, and never twice for the same target (`newlyLinked`).
        await mirrorRecordEvent(freshLinks, source, actor, 'linked');
      } else if (statusChanged && hasAnyLink(formLinks)) {
        await mirrorRecordEvent(
          formLinks, source, actor,
          formData.status === 'Closed' ? 'completed' : 'status',
        );
      }

      // Every manager/admin sees intake activity, whoever logged it — the actor
      // is skipped so a manager doesn't get pinged for their own entry.
      await notifyManagers({
        type: editing ? 'correspondence_updated' : 'correspondence_added',
        title: editing ? 'Correspondence Updated' : 'New Correspondence',
        message: corrDetails(
          `${appUser.displayName} ${editing ? 'updated' : 'added'} correspondence "${formData.subject}"`,
          { ...formData, serialNumber: corrSerial },
        ),
        read: false,
        relatedId: docId,
        createdAt: serverTimestamp(),
      }, projectUsers, { actorId: user.uid });

      // Auto-create task when assignee is set and no linked task exists yet
      const hasLinkedTask = editing?.convertedToTaskId;

      if (formData.assignedToId && !hasLinkedTask) {
        // Create a new task from this correspondence
        const taskSerial = await getNextSerialNumber('tasks');
        const taskRef = await addDoc(collection(db, 'tasks'), {
          taskName: formData.subject,
          description: formData.body,
          priority: formData.priority,
          status: 'Pending',
          category: formData.category,
          subCategory: formData.subCategory || 'None',
          department: formData.department || 'None',
          serialNumber: taskSerial,
          assignedTo: formData.assignedTo,
          assignedToId: formData.assignedToId,
          assignedBy: appUser.displayName,
          assignedById: user.uid,
          dueDate: formData.deadline || null,
          correspondingId: docId,
          correspondingSubject: formData.subject,
          correspondingSerialNumber: corrSerial,
          // The task inherits the correspondence's links: the email and the work
          // it produced belong to the same bid / project.
          ...formLinks,
          attachedFile: formData.attachedFile || null,
          attachedFileName: formData.attachedFileName || null,
          filePaths: formData.filePaths?.length ? formData.filePaths : [],
          statusUpdate: 'Not Started',
          notes: [],
          isPrivate: false,
          userId: user.uid,
          teamId: appUser.teamId || 'NONE',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        // Link task back to the correspondence and mark as Assigned
        await updateDoc(doc(db, 'correspondences', docId!), {
          convertedToTaskId: taskRef.id,
          status: 'Assigned',
          assignedAt: serverTimestamp(),
        });

        // The task is a record of its own, so it gets its own history line.
        if (hasAnyLink(formLinks)) {
          await announceNewRecord(formLinks, {
            kind: 'task', id: taskRef.id, title: formData.subject, serialNumber: taskSerial,
            status: 'Pending', assignedTo: formData.assignedTo, dueDate: formData.deadline || undefined,
          }, actor);
        }

        // Notify assignee (skip if self-assigned)
        if (formData.assignedToId !== user.uid) {
          await createNotification({
            type: 'task_assigned',
            title: 'New Task Assigned',
            message: taskDetails(
              `"${formData.subject}" has been assigned to you by ${appUser.displayName}`,
              {
                taskName: formData.subject,
                description: formData.body,
                serialNumber: taskSerial,
                priority: formData.priority,
                status: 'Pending',
                dueDate: formData.deadline || undefined,
                assignedTo: formData.assignedTo,
              },
            ),
            forUserId: formData.assignedToId,
            read: false,
            relatedId: taskRef.id,
            createdAt: serverTimestamp(),
          }, projectUsers);
        }
      } else if (hasLinkedTask && editing!.assignedToId !== formData.assignedToId) {
        // Reassignment: update the existing linked task
        await updateDoc(doc(db, 'tasks', editing!.convertedToTaskId!), {
          assignedTo: formData.assignedTo,
          assignedToId: formData.assignedToId,
          updatedAt: serverTimestamp(),
        });

        // Notify new assignee (skip if self-assigned)
        if (formData.assignedToId && formData.assignedToId !== user.uid) {
          await createNotification({
            type: 'task_assigned',
            title: 'Task Reassigned',
            message: taskDetails(
              `The task for "${formData.subject}" has been reassigned to you by ${appUser.displayName}`,
              {
                taskName: formData.subject,
                description: formData.body,
                priority: formData.priority,
                dueDate: formData.deadline || undefined,
                assignedTo: formData.assignedTo,
              },
            ),
            forUserId: formData.assignedToId,
            read: false,
            relatedId: editing!.convertedToTaskId,
            createdAt: serverTimestamp(),
          }, projectUsers);
        }
      }

      closeModal();
    } catch (err) {
      handleFirestoreError(err, editing ? OperationType.UPDATE : OperationType.CREATE, 'correspondences');
      setError(t('Failed to save.'));
    }
  };

  // Inline quick-assign straight from an unassigned card: spins up a linked task,
  // attaches the manager's comment as the first task note, marks the
  // correspondence Assigned, and notifies the assignee — mirrors the modal flow.
  const quickAssign = async (item: Corresponding) => {
    const draft = assignDraft[item.id];
    if (!draft?.toId) return;
    const assignee = projectUsers.find(u => u.id === draft.toId);
    if (!assignee) return;
    setAssigningId(item.id);
    try {
      const comment = draft.comment.trim();
      const taskSerial = await getNextSerialNumber('tasks');
      const noteArr: TaskNote[] = comment ? [{
        id: `${Date.now()}`,
        text: comment,
        isCompleted: false,
        addedBy: appUser.displayName,
        addedAt: new Date().toISOString(),
      }] : [];

      const taskRef = await addDoc(collection(db, 'tasks'), {
        taskName: item.subject,
        description: item.body,
        priority: item.priority,
        status: 'Pending',
        category: item.category || 'Internal',
        subCategory: item.subCategory || 'None',
        department: item.department || 'None',
        serialNumber: taskSerial,
        assignedTo: assignee.displayName,
        assignedToId: assignee.id,
        assignedBy: appUser.displayName,
        assignedById: user.uid,
        dueDate: item.deadline || null,
        correspondingId: item.id,
        correspondingSubject: item.subject,
        correspondingSerialNumber: item.serialNumber || '',
        // Same inheritance as the modal flow above.
        ...linksOf(item),
        attachedFile: item.attachedFile || null,
        attachedFileName: item.attachedFileName || null,
        filePaths: item.filePaths?.length ? item.filePaths : [],
        statusUpdate: 'Not Started',
        notes: noteArr,
        isPrivate: false,
        userId: user.uid,
        teamId: appUser.teamId || 'NONE',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'correspondences', item.id), {
        convertedToTaskId: taskRef.id,
        assignedTo: assignee.displayName,
        assignedToId: assignee.id,
        status: 'Assigned',
        assignedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(comment ? { notes: comment } : {}),
      });

      const quickLinks = linksOf(item);
      if (hasAnyLink(quickLinks)) {
        await announceNewRecord(quickLinks, {
          kind: 'task', id: taskRef.id, title: item.subject, serialNumber: taskSerial,
          status: 'Pending', assignedTo: assignee.displayName, dueDate: item.deadline || undefined,
        }, actorFrom(user.uid, appUser), comment || undefined);
      }

      const assignedBody = taskDetails(
        comment
          ? `"${item.subject}" assigned to you by ${appUser.displayName}: ${comment}`
          : `"${item.subject}" has been assigned to you by ${appUser.displayName}`,
        {
          taskName: item.subject,
          description: item.body,
          serialNumber: taskSerial,
          priority: item.priority,
          status: 'Pending',
          dueDate: item.deadline,
          assignedTo: assignee.displayName,
        },
      );

      await notifyManagers({
        type: 'task_assigned',
        title: 'Task Assigned',
        message: taskDetails(
          `${appUser.displayName} assigned "${item.subject}" to ${assignee.displayName}.`,
          {
            taskName: item.subject,
            description: item.body,
            serialNumber: taskSerial,
            priority: item.priority,
            status: 'Pending',
            dueDate: item.deadline,
            assignedTo: assignee.displayName,
          },
        ),
        read: false,
        relatedId: taskRef.id,
        createdAt: serverTimestamp(),
      }, projectUsers, { actorId: user.uid, excludeIds: [assignee.id] });

      if (assignee.id !== user.uid) {
        await createNotification({
          type: 'task_assigned',
          title: 'New Task Assigned',
          message: assignedBody,
          forUserId: assignee.id,
          read: false,
          relatedId: taskRef.id,
          createdAt: serverTimestamp(),
        }, projectUsers);
      }

      setAssignDraft(p => { const n = { ...p }; delete n[item.id]; return n; });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `correspondences/${item.id}`);
      setError(t('Failed to assign.'));
    } finally {
      setAssigningId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'correspondences', deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `correspondences/${deleteTarget.id}`);
      setError(t('Delete failed.'));
    }
  };

  return (
    <div style={{ padding: '20px 0', minHeight: '60vh' }}>
      {/* Header — exactly one action: New Correspondence. */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            {t('Correspondences')}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {isManager
              ? t('Log, review, and assign incoming documents as tasks — all in one place.')
              : t('Log incoming documents — managers will review and assign them as tasks.')}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => openModal()}>
          <Plus className="w-4 h-4" /> {t('New Correspondence')}
        </button>
      </div>

      {/* Segmented status filter (doubles as the stats row) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 24 }}>
        {[
          { key: 'Unassigned',  label: 'Unassigned',   value: stats.unassigned,  cls: 'stat-red' },
          { key: 'All',         label: 'Total',        value: stats.total,       cls: 'stat-indigo' },
          { key: 'Assigned',    label: 'Assigned',     value: stats.assigned,    cls: 'stat-sky' },
          { key: 'Closed',      label: 'Closed',       value: stats.closed,      cls: 'stat-green' },
        ].map(s => {
          const active = statusFilter === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatusFilter(s.key)}
              className={`card ${s.cls} card-interactive`}
              aria-pressed={active}
              style={{
                padding: '20px 24px', textAlign: 'start', cursor: 'pointer',
                fontFamily: 'inherit',
                borderColor: active ? 'var(--accent)' : undefined,
                boxShadow: active ? '0 0 0 1px var(--accent) inset' : undefined,
                opacity: active || statusFilter === 'All' ? 1 : 0.7,
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: active ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{t(s.label)}</div>
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 0, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', fontSize: 14 }}>
          <AlertCircle className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Unified layout: list (left) + team workload panel (right, managers only) */}
      <div className="inbox-grid" style={{ display: 'grid', gridTemplateColumns: isManager ? '1fr 300px' : '1fr', gap: 24, alignItems: 'start' }}>
      <div style={{ minWidth: 0 }}>
      {/* One toolbar row: search + Group by + the date/department filters folded
          into `Filters`. The create button now lives in the header. */}
      <BoardToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t('Search subject or sender…')}
        groupBy={<GroupByBar<CorrGroupBy> value={groupBy} onChange={setGroupBy} options={groupByOptions} />}
        activeFilterCount={(dateFilter ? 1 : 0) + (deptFilter !== 'All' ? 1 : 0)}
        onClearFilters={() => { setDateFilter(''); setDeptFilter('All'); }}
        filters={
          <>
            <input
              type="date"
              className="input"
              style={{ width: 'auto' }}
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              title={t('Filter by day')}
            />
            <select className="input" style={{ width: 'auto' }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              <option value="All">{t('All Departments')}</option>
              {DEPARTMENT_OPTIONS.filter(d => d !== 'None' && d !== 'Other...').map(d => <option key={d} value={d}>{label(d)}</option>)}
            </select>
          </>
        }
      />

      {showGroupGrid ? (
        // Grouping IS the grid: one card per bucket, and the list only appears
        // once a card is opened. `groupCards` is built from every filtered
        // correspondence, so the counts are the real totals, not one page.
        <GroupGrid
          cards={groupCards}
          onSelect={setOpenGroup}
          empty={
            <div className="empty-state">
              <div className="empty-state-icon">
                <MailOpen style={{ width: 28, height: 28 }} />
              </div>
              {/* A board that has never held a record is not a board whose
                  filters hide everything — the old copy told the first-run user
                  to clear filters they had never set. */}
              {visibleItems.length === 0 ? (
                <>
                  <p className="empty-state-title">{t('No correspondences yet')}</p>
                  <p className="empty-state-sub">{t('Every piece of work starts here: log an incoming letter, then a manager reviews it and assigns it as a task.')}</p>
                  <button className="btn btn-ghost btn-sm" onClick={() => openModal()}>{t('New Correspondence')}</button>
                </>
              ) : (
                <>
                  <p className="empty-state-title">{t('No correspondences found')}</p>
                  <p className="empty-state-sub">{t('No items match your filters')}<br />{t('Use the button above to add a new correspondence.')}</p>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setStatusFilter('All'); setDeptFilter('All'); setDateFilter(''); }}>{t('Clear All Filters')}</button>
                </>
              )}
            </div>
          }
        />
      ) : (
      <>
      {/* The only way back to the grid. */}
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setOpenGroup(null)}
        style={{ marginBottom: 16 }}
      >
        <ArrowLeft className="w-4 h-4" /> {t('All Groups')}
      </button>
      {/* Items list, scoped to the open bucket */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {renderGroups.map(group => (
        <div key={group.key}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, paddingInlineStart: 4 }}>
            <Layers className="w-4 h-4 text-accent" />
            {groupHeading(group)}
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginInlineStart: 'auto', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 0 }}>{group.items.length}</span>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <AnimatePresence>
          {group.items.map(item => {
            // Unassigned cards are rendered "full" (whole body + links + an inline
            // quick-assign panel) and are NOT clickable — everything is on the card.
            const isUnassignedCard = !item.assignedToId && item.status !== 'Closed';
            const draft = assignDraft[item.id] || { toId: '', comment: '' };
            return (
            <motion.div
              layout
              key={item.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
               className={isUnassignedCard ? 'card' : 'card card-interactive'}
               style={{
                 padding: '14px 18px',
                 cursor: isUnassignedCard ? 'default' : 'pointer',
                 display: 'flex',
                 alignItems: isUnassignedCard ? 'flex-start' : 'center',
                 gap: 16,
                 borderInlineStart: isDueSoon(item.deadline) && item.status !== 'Closed'
                   ? '4px solid #f97316'
                   : `4px solid ${(() => {
                     const u = projectUsers.find(pu => pu.id === item.assignedToId);
                     return u?.userColor || getUserColor(item.assignedToId || item.userId || '');
                   })()}`,
                 backgroundColor: isDueSoon(item.deadline) && item.status !== 'Closed' ? 'var(--surface-warn)' : 'var(--surface)'
               }}
              onClick={isUnassignedCard ? undefined : () => setSelectedCorrForDetails(item)}
            >
              {/* Main column */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Title row: serial + subject + badges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  {item.serialNumber && (
                    <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em', flexShrink: 0 }} className="ltr-data">
                      #{item.serialNumber}
                    </span>
                  )}
                  <h3 style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{item.subject}</h3>
                  <span className={statusBadgeClass(item.status)}>{label(item.status)}</span>
                  {isUnassignedCard && <span className={priorityBadgeClass(item.priority)}>{label(item.priority)}</span>}
                  {isUnassignedCard && item.category && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', padding: '3px 10px',
                      borderRadius: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      background: item.category === 'Project' ? '#dbeafe' : item.category === 'External' ? '#dcfce7' : '#f3e8ff',
                      color: item.category === 'Project' ? '#1d4ed8' : item.category === 'External' ? '#15803d' : '#6d28d9',
                    }} className={fmt.bidiFor(label(item.category))}>{label(item.category)}</span>
                  )}
                  {isUnassignedCard && item.actions && item.actions !== 'None' && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', padding: '3px 10px',
                      borderRadius: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                      textTransform: 'uppercase', background: '#fee2e2', color: '#dc2626',
                      border: '1px solid #fecaca'
                    }}>{label(item.actions)}</span>
                  )}
                  {!item.assignedToId && item.status !== 'Closed' && (
                    <span className="badge" style={{ background: '#f43f5e', color: '#fff' }}>{t('UNASSIGNED')}</span>
                  )}
                  {isOverdue(item.deadline) && item.status !== 'Closed' && (
                    <span className="badge badge-urgent">{t('OVERDUE')}</span>
                  )}
                  {isDueSoon(item.deadline) && item.status !== 'Closed' && (
                    <span className="badge" style={{ background: '#f97316', color: '#fff' }}>{t('DUE SOON')}</span>
                  )}
                </div>

                {/* Body — full on unassigned cards, one-line snippet elsewhere */}
                {isUnassignedCard && item.body && (
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 8px', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{item.body}</p>
                )}

                {/* Meta line */}
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
                  {isUnassignedCard && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Building2 className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
                      {item.department}{item.subCategory ? ` › ${item.subCategory}` : ''}
                    </span>
                  )}
                  {isUnassignedCard && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MailOpen className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
                      {t('From:')} {item.sentFrom}
                    </span>
                  )}
                  {item.deadline && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fbbf24' }}>
                      <Calendar className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
                      {item.deadline}
                    </span>
                  )}
                  {isUnassignedCard && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {(() => {
                        const u = projectUsers.find(pu => pu.id === item.userId);
                        return u?.photoURL ? (
                          <img src={u.photoURL} className="avatar" style={{ width: 14, height: 14, objectFit: 'cover', opacity: 0.8 }} alt="" />
                        ) : (
                          <span style={{ width: 8, height: 8, borderRadius: 0, background: u?.userColor || getUserColor(item.userId), opacity: 0.6 }} />
                        );
                      })()}
                      {projectUsers.find(u => u.id === item.userId)?.displayName || t('Unknown')}
                    </span>
                  )}
                  {item.assignedTo && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)', fontWeight: 600 }}>
                      {(() => {
                        const u = projectUsers.find(pu => pu.id === item.assignedToId);
                        return u?.photoURL ? (
                          <img src={u.photoURL} className="avatar" style={{ width: 18, height: 18, objectFit: 'cover' }} alt="" />
                        ) : (
                          <span style={{ width: 10, height: 10, borderRadius: 0, background: u?.userColor || getUserColor(item.assignedToId || item.assignedTo) }} />
                        );
                      })()}
                      <span className="dir-arrow">→</span> {item.assignedTo}
                    </span>
                  )}
                </div>

                {/* ── Full info shown inline on unassigned cards ── */}
                {isUnassignedCard && (
                  <>
                    {/* Shared folders / links — fully expanded, no need to open the card */}
                    {item.filePaths && item.filePaths.length > 0 && (
                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <ExternalLink className="w-3.5 h-3.5" /> {t('Shared Folders / Links')}
                        </div>
                        {item.filePaths.map((path, idx) => {
                          const friendlyName = path.split(/[/\\]/).filter(Boolean).pop() || path;
                          const isUrl = path.startsWith('http://') || path.startsWith('https://');
                          return (
                            <div key={idx} style={{ padding: '8px 12px', background: 'var(--surface-3)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span
                                  onClick={() => openOrCopyPath(path)}
                                  title={isUrl ? path : t('Click to copy path: {{path}}', { path })}
                                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                >{friendlyName}</span>
                                {!isUrl && (
                                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</span>
                                )}
                              </div>
                              <button
                                onClick={() => openOrCopyPath(path)}
                                title={t('Open (web link) or copy this path')}
                                className="btn btn-ghost btn-sm"
                                style={{ padding: '4px 8px', height: 'auto', minHeight: 'auto', flexShrink: 0 }}
                              >
                                {copiedPath === path ? <Check className="w-3.5 h-3.5 text-green" /> : <ExternalLink className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Attachment link */}
                    {item.attachedFile && (
                      <a
                        href={item.attachedFile}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--blue-50)', border: '1px solid var(--blue-200)', color: 'var(--blue-400)', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}
                      >
                        <Paperclip className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.attachedFileName || t('View attachment')}</span>
                        <ExternalLink className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
                      </a>
                    )}

                    {/* Quick assign — pick an employee, add a comment, hand it off */}
                    {isManager && (
                      <div style={{ marginTop: 14, padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <UserPlus className="w-3.5 h-3.5" /> {t('Quick Assign')}
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          <select
                            className="input"
                            style={{ flex: '1 1 180px', minWidth: 160 }}
                            value={draft.toId}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setDraft(item.id, { toId: e.target.value })}
                          >
                            <option value="">— {t('Select employee')} —</option>
                            {targetUsers.map(u => (
                              <option key={u.id} value={u.id}>{u.displayName} ({label(u.role)})</option>
                            ))}
                          </select>
                          <div style={{ position: 'relative', flex: '2 1 220px', minWidth: 180 }}>
                            <MessageSquare style={{ position: 'absolute', insetInlineStart: 10, top: 12, width: 14, height: 14, color: 'var(--text-muted)' }} />
                            <textarea
                              className="input"
                              style={{ paddingInlineStart: 32, minHeight: 38, resize: 'vertical' }}
                              rows={1}
                              placeholder={t('Add a comment for them…')}
                              value={draft.comment}
                              onChange={e => setDraft(item.id, { comment: e.target.value })}
                            />
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={!draft.toId || assigningId === item.id}
                            onClick={() => quickAssign(item)}
                            style={{ gap: 6, flexShrink: 0 }}
                          >
                            <Send className="w-3.5 h-3.5" />
                            {assigningId === item.id ? t('Assigning…') : t('Assign')}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={e => { e.stopPropagation(); openModal(item, false); }}
                  title={t('Edit')}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  className="btn btn-danger btn-icon btn-sm"
                  onClick={e => { e.stopPropagation(); setDeleteTarget(item); }}
                  title={t('Delete')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
            );
          })}
        </AnimatePresence>
          </div>
        </div>
        ))}
      </div>

      {/* Pagination Controls — over the open bucket, not the whole list */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 24, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
          <button 
            className="btn btn-ghost btn-sm" 
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => prev - 1)}
          >
            {t('Previous Page')}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                className={`btn btn-sm ${currentPage === p ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setCurrentPage(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <button 
            className="btn btn-ghost btn-sm" 
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(prev => prev + 1)}
          >
            {t('Next Page')}
          </button>
        </div>
      )}

      </>
      )}
      </div>{/* end left column */}

      {/* Right: team workload panel (managers/admins only) */}
      {isManager && (
        <div className="inbox-workload" style={{ position: 'sticky', top: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 16 }}>
              {t('Team Workload')}
            </div>
            {targetUsers.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>{t('No team members')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[...targetUsers].sort((a, b) => {
                  const aActive = tasks.filter(t => t.assignedToId === a.id && (t.status === 'In Progress' || t.status === 'Pending')).length;
                  const bActive = tasks.filter(t => t.assignedToId === b.id && (t.status === 'In Progress' || t.status === 'Pending')).length;
                  if (bActive !== aActive) return bActive - aActive;
                  const aDone = tasks.filter(t => t.assignedToId === a.id && (t.status === 'Done' || t.status === 'Archived')).length;
                  const bDone = tasks.filter(t => t.assignedToId === b.id && (t.status === 'Done' || t.status === 'Archived')).length;
                  return bDone - aDone;
                }).slice(0, 12).map(emp => {
                  const activeTasks = tasks.filter(t => t.assignedToId === emp.id && (t.status === 'In Progress' || t.status === 'Pending'));
                  const inProgress = activeTasks.length;
                  const done = tasks.filter(t => t.assignedToId === emp.id && (t.status === 'Done' || t.status === 'Archived')).length;
                  const total = inProgress + done;
                  const donePercent = total > 0 ? Math.round((done / total) * 100) : 0;
                  const oldestActive = activeTasks.reduce<Date | null>((oldest, t) => {
                    if (!t.createdAt) return oldest;
                    const d = t.createdAt.toDate();
                    return !oldest || d < oldest ? d : oldest;
                  }, null);
                  return (
                    <div key={emp.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        {emp.photoURL
                          ? <img src={emp.photoURL} referrerPolicy="no-referrer" className="avatar" style={{ width: 26, height: 26, objectFit: 'cover', flexShrink: 0 }} alt="" />
                          : <div style={{ width: 26, height: 26, borderRadius: 0, background: emp.userColor || 'linear-gradient(135deg,#6366f1,#818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                              {emp.displayName?.[0]?.toUpperCase()}
                            </div>
                        }
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.displayName}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <div style={{ flex: 1, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', padding: '5px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: inProgress > 0 ? '#fbbf24' : 'var(--text-muted)', lineHeight: 1 }}>{inProgress}</div>
                          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginTop: 2 }}>{t('Active')}</div>
                        </div>
                        <div style={{ flex: 1, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', padding: '5px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: done > 0 ? '#4ade80' : 'var(--text-muted)', lineHeight: 1 }}>{done}</div>
                          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginTop: 2 }}>{t('Done')}</div>
                        </div>
                      </div>
                      {total > 0 && (
                        <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${donePercent}%`, background: 'linear-gradient(90deg,#22c55e,#4ade80)', borderRadius: 2, transition: 'width 0.4s ease' }} />
                        </div>
                      )}
                      {oldestActive && (
                        <div style={{ marginTop: 5, fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ opacity: 0.6 }}>{t('Since')}</span>
                          <span className="ltr-data" style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{fmt.date(oldestActive)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      </div>{/* end inbox-grid */}

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeModal}>
            <motion.div className="modal" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} onClick={e => e.stopPropagation()}>
              {/* Modal header */}
              <div style={{
                borderBottom: '1px solid var(--border)',
                background: isViewing ? 'var(--surface-2)' : 'var(--surface)',
              }}>
                {/* Accent strip */}
                <div style={{ height: 4, background: isViewing ? 'var(--accent)' : editing ? '#f59e0b' : 'var(--green-500)' }} />
                <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                        padding: '2px 8px',
                        background: isViewing ? 'var(--blue-100)' : editing ? '#fef3c7' : '#dcfce7',
                        color: isViewing ? 'var(--blue-700)' : editing ? '#92400e' : '#15803d',
                      }}>
                        {isViewing ? t('View') : editing ? t('Editing') : t('New')}
                      </span>
                      {(editing || isViewing) && formData.serialNumber && (
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em' }} className="ltr-data">
                          #{formData.serialNumber}
                        </span>
                      )}
                      {isViewing && formData.status && (
                        <span className={statusBadgeClass(formData.status)} style={{ fontSize: 11 }}>
                          {label(formData.status)}
                        </span>
                      )}
                    </div>
                    <h2 style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                      {isViewing ? (formData.subject || t('Correspondence Details')) : (editing ? t('Edit Correspondence') : t('New Correspondence'))}
                    </h2>
                    {isViewing && formData.sentFrom && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>{t('From:')}{formData.sentFrom}</div>
                    )}
                  </div>
                  <button className="btn btn-ghost btn-icon" onClick={closeModal} style={{ flexShrink: 0, marginTop: 2 }}><X className="w-4 h-4" /></button>
                </div>
              </div>

              <form onSubmit={handleSubmit} style={{ padding: '0 0 0' }}>
                {/* ── Section: Core ── */}
                <div style={{ padding: '20px 24px 0' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
                  {/* Subject */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="input-label">{t('Subject')}</label>
                    {isViewing ? (
                      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4 }}>{formData.subject}</div>
                    ) : (
                      <input className="input" style={{ fontSize: 16, fontWeight: 600 }} value={formData.subject} onChange={e => set('subject', e.target.value)} placeholder={t('Correspondence subject…')} />
                    )}
                  </div>
                  {/* Body */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="input-label">{t('Body / Description')}</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{formData.body}</div>
                    ) : (
                      <textarea className="input" rows={3} value={formData.body} onChange={e => set('body', e.target.value)} placeholder={t('Describe the content of the correspondence…')} />
                    )}
                  </div>
                  {/* Sent From */}
                  <div>
                    <label className="input-label">{t('Sent From')}</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>{formData.sentFrom}</div>
                    ) : (
                      <input className="input" value={formData.sentFrom} onChange={e => set('sentFrom', e.target.value)} placeholder={t('Organization or person…')} />
                    )}
                  </div>
                  {/* Category */}
                  <div>
                    <label className="input-label">{t('Category')}</label>
                    {isViewing ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', padding: '4px 12px',
                        borderRadius: 0, fontSize: 12, fontWeight: 700,
                        background: formData.category === 'Project' ? '#dbeafe' : formData.category === 'External' ? '#dcfce7' : '#f3e8ff',
                        color: formData.category === 'Project' ? '#1d4ed8' : formData.category === 'External' ? '#15803d' : '#6d28d9',
                      }}>{formData.category}</span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: 'var(--surface-3)', padding: 2, borderRadius: 0, border: '1px solid var(--border)', width: '100%' }}>
                          {CATEGORY_OPTIONS.map(c => {
                            const isOther = c === 'Other...';
                            const isActive = isOther
                              ? !CATEGORY_OPTIONS.filter(x => x !== 'Other...').includes(formData.category)
                              : formData.category === c;
                            return (
                              // ★ Found by LOOKING at the RTL screenshot: the
                              // enum values are Latin and "Other..." ends in
                              // bidi-NEUTRAL dots, so in an RTL container they
                              // were painted as "...Other". Every chip that
                              // shows a raw enum value needs the isolation.
                              <button
                                key={c} type="button"
                                className={fmt.bidiFor(label(c))}
                                onClick={() => isOther ? set('category', '') : set('category', c)}
                                style={{
                                  flex: '1 0 auto', padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 0, border: 'none', cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                  background: isActive ? 'var(--accent)' : 'transparent',
                                  color: isActive ? '#fff' : 'var(--text-muted)',
                                  transition: 'all 0.15s'
                                }}
                              >
                                {label(c)}
                              </button>
                            );
                          })}
                        </div>
                        {!CATEGORY_OPTIONS.filter(c => c !== 'Other...').includes(formData.category) && (
                          <input
                            className="input"
                            placeholder={t('Type custom category…')}
                            value={formData.category}
                            onChange={e => set('category', e.target.value)}
                            autoFocus
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {/* Priority */}
                  <div>
                    <label className="input-label">{t('Priority')}</label>
                    {isViewing ? (
                      <span className={priorityBadgeClass(formData.priority)}>{label(formData.priority)}</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: 'var(--surface-3)', padding: 2, borderRadius: 0, border: '1px solid var(--border)', width: '100%' }}>
                        {PRIORITY_OPTIONS.map(p => (
                          <button
                            key={p} type="button"
                            onClick={() => set('priority', p)}
                            style={{
                              flex: '1 0 auto', padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 0, border: 'none', cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              background: formData.priority === p ? (p === 'Urgent' ? '#ef4444' : p === 'High' ? '#f97316' : p === 'Medium' ? '#3b82f6' : '#64748b') : 'transparent',
                              color: formData.priority === p ? '#fff' : 'var(--text-muted)',
                              transition: 'all 0.15s'
                            }}
                          >
                            {label(p)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  </div>{/* end grid: Core */}
                </div>{/* end section: Core */}

                {/* ── Section: Classification ── */}
                <div style={{ borderTop: '1px solid var(--border)', padding: '16px 24px 0', marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>{t('Classification')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
                  {/* Department */}
                  <div>
                    <label className="input-label">{t('Department')}</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{formData.department}</div>
                    ) : (
                      <ComboBox
                        value={formData.department}
                        onChange={v => { set('department', v || 'None'); set('subCategory', 'None'); }}
                        options={dynamicDepartments}
                        placeholder={t('Select or add a department…')}
                        emptyValue="None"
                        listLabel={t('Departments')}
                      />
                    )}
                  </div>
                  {/* Sub-category */}
                  <div>
                    <label className="input-label">{t('Sub-Category / Project')}</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{formData.subCategory || 'None'}</div>
                    ) : (
                      <ComboBox
                        value={formData.subCategory}
                        onChange={v => set('subCategory', v || 'None')}
                        options={dynamicSubCategories}
                        placeholder={t('Select or add a project…')}
                        emptyValue="None"
                        listLabel={t('Projects')}
                      />
                    )}
                  </div>
                  {/* Actions */}
                  <div>
                    <label className="input-label">{t('Actions')}</label>
                    {isViewing ? (() => {
                      const actionStyles: Record<string, {bg: string; color: string; border: string}> = {
                        'None':            { bg: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border)' },
                        'For info':        { bg: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe' },
                        'SR for approval': { bg: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' },
                        'Action needed':   { bg: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' },
                      };
                      const s = actionStyles[formData.actions] ?? actionStyles['None'];
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 0, fontSize: 12, fontWeight: 700, ...s }}>
                          {formData.actions}
                        </span>
                      );
                    })() : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: 'var(--surface-3)', padding: 2, border: '1px solid var(--border)', width: '100%' }}>
                        {(['None', 'For info', 'SR for approval', 'Action needed'] as const).map(a => (
                          <button
                            key={a} type="button"
                            onClick={() => set('actions', a)}
                            style={{
                              flex: '1 0 auto', padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 0, border: 'none', cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              background: formData.actions === a ? (a === 'Action needed' ? '#ef4444' : a === 'SR for approval' ? '#f59e0b' : a === 'For info' ? 'var(--accent)' : '#64748b') : 'transparent',
                              color: formData.actions === a ? '#fff' : 'var(--text-muted)',
                              transition: 'all 0.15s'
                            }}
                          >{label(a)}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  </div>{/* end grid: Classification */}
                </div>{/* end section: Classification */}

                {/* ── Section: Workflow ── */}
                <div style={{ borderTop: '1px solid var(--border)', padding: '16px 24px 0', marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>{t('Workflow')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
                  {/* Date received */}
                  <div>
                    <label className="input-label">{t('Date Received')}</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{formData.dateReceived}</div>
                    ) : (
                      <input className="input" type="date" value={formData.dateReceived} onChange={e => set('dateReceived', e.target.value)} />
                    )}
                  </div>
                  {/* Deadline */}
                  <div>
                    <label className="input-label">{t('Deadline')}</label>
                    {isViewing ? (
                      <div className="ltr-data" style={{ fontSize: 14, color: formData.deadline ? '#fbbf24' : 'var(--text-muted)' }}>{formData.deadline || t('No deadline')}</div>
                    ) : (
                      <input className="input" type="date" value={formData.deadline} onChange={e => set('deadline', e.target.value)} />
                    )}
                  </div>
                  {/* Status */}
                  <div>
                    <label className="input-label">{t('Status')}</label>
                    {isViewing ? (
                      <span className={statusBadgeClass(formData.status)}>{label(formData.status)}</span>
                    ) : (
                      (appUser.role === 'Admin' || appUser.role === 'Manager') ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: 'var(--surface-3)', padding: 2, borderRadius: 0, border: '1px solid var(--border)', width: '100%' }}>
                          {(['Unread','Reviewing','Assigned','Closed'] as CorrespondingStatus[]).map(s => (
                            <button
                              key={s} type="button"
                              onClick={() => set('status', s)}
                              style={{
                                flex: '1 0 auto', padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 0, border: 'none', cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                background: formData.status === s ? 'var(--accent)' : 'transparent',
                                color: formData.status === s ? '#fff' : 'var(--text-muted)',
                                transition: 'all 0.15s'
                              }}
                            >
                              {label(s)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className={statusBadgeClass(formData.status)}>{label(formData.status)}</span>
                      )
                    )}
                  </div>
                  <div>
                    <label className="input-label">{t('Assignee')}</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>
                        {formData.assignedTo || t('Unassigned')}
                      </div>
                    ) : (
                      <select 
                        className="input" 
                        value={formData.assignedToId} 
                        onChange={e => {
                          const u = projectUsers.find(u => u.id === e.target.value);
                          set('assignedToId', e.target.value);
                          set('assignedTo', u?.displayName || '');
                          if (e.target.value && formData.status === 'Unread') {
                            set('status', 'Assigned');
                          }
                        }}
                      >
                        <option value="">{t('— Unassigned —')}</option>
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
                    )}
                  </div>
                  </div>{/* end grid: Workflow */}
                </div>{/* end section: Workflow */}

                {/* ── Section: Linked records (queue task 5) ── */}
                <div style={{ borderTop: '1px solid var(--border)', padding: '16px 24px 0', marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>{t('Linked Records')}</div>
                  {isViewing ? (
                    <div style={{ display: 'grid', gap: 8, fontSize: 13, color: 'var(--text-primary)' }}>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>{t('Opportunity / Bid')}: </span>
                        {formLinks.opportunityId ? (
                          <>
                            {formLinks.opportunitySerial && <span className="ltr-data" style={{ fontWeight: 700 }}>{formLinks.opportunitySerial}</span>}
                            {formLinks.opportunitySerial && ' — '}
                            {formLinks.opportunityTitle || t('Linked opportunity')}
                          </>
                        ) : t('Not linked to a bid')}
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>{t('Project record')}: </span>
                        {formLinks.projectId ? (formLinks.projectName || t('Linked project')) : t('Not linked to a project')}
                      </div>
                    </div>
                  ) : (
                    <RecordLinkPicker
                      value={formLinks}
                      onChange={setFormLinks}
                      active={isModalOpen}
                      hint={t('This correspondence — and the task it is assigned as — is echoed into the history of whatever it is linked to.')}
                    />
                  )}
                </div>{/* end section: Linked Records */}

                {/* ── Section: Files & Notes ── */}
                <div style={{ borderTop: '1px solid var(--border)', padding: '16px 24px 0', marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>{t('Files & Notes')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                  {/* Shared Folder Paths */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <label className="input-label" style={{ marginBottom: 0 }}>{t('Shared Folder Paths (Computer/Local)')}</label>
                      {!isViewing && (
                        <button 
                          type="button" 
                          className="btn btn-ghost btn-sm" 
                          onClick={() => set('filePaths', [...(formData.filePaths || []), ''])}
                          style={{ fontSize: 11 }}
                        >
                          <Plus className="w-3.5 h-3.5" /> {t('Add Path')}
                        </button>
                      )}
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {(formData.filePaths || []).map((path, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: 8 }}>
                          {isViewing ? (
                            <div style={{ 
                              flex: 1, 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: 10, 
                              padding: '8px 12px', 
                              background: 'var(--surface-3)', 
                              border: '1px solid var(--border)',
                              borderRadius: 0,
                              fontSize: 13
                            }}>
                              <Clock className="w-3.5 h-3.5 text-muted" />
                              <code
                                onClick={() => path && openOrCopyPath(path)}
                                title={path ? t('Click to open (web link) or copy this path') : undefined}
                                style={{ flex: 1, wordBreak: 'break-all', fontSize: 12, cursor: path ? 'pointer' : 'default', textDecoration: path ? 'underline' : 'none', textDecorationStyle: 'dotted' }}
                              >{path || t('Empty path')}</code>
                              <button 
                                type="button"
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => copyToClipboard(path)}
                                title={t('Copy Path')}
                              >
                                {copiedPath === path ? <Check className="w-3.5 h-3.5 text-green" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          ) : (
                            <>
                              <input 
                                className="input" 
                                style={{ flex: 1, fontSize: 13, fontFamily: 'monospace' }} 
                                value={path} 
                                onChange={e => {
                                  const newPaths = [...formData.filePaths];
                                  newPaths[idx] = e.target.value.replace(/["']/g, '');
                                  set('filePaths', newPaths);
                                }} 
                                placeholder={t('Shared folder path example')}
                              />
                              <button 
                                type="button" 
                                className="btn btn-ghost btn-icon" 
                                onClick={() => {
                                  const newPaths = formData.filePaths.filter((_, i) => i !== idx);
                                  set('filePaths', newPaths);
                                }}
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                      {(formData.filePaths || []).length === 0 && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('No folder paths added.')}</p>
                      )}
                    </div>
                  </div>

                  {/* File */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="input-label">{t('Attachment')}</label>
                    {isViewing ? (
                      formData.attachedFile ? (
                        <div style={{ 
                          marginTop: 12, 
                          borderRadius: 0, 
                          overflow: 'hidden', 
                          border: '1px solid var(--border)',
                          background: 'var(--surface-2)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
                        }}>
                          {(formData.attachedFile.includes('image') || formData.attachedFile.includes('google.com')) ? (
                            <div style={{ position: 'relative', background: 'var(--surface-3)', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                              <img 
                                src={getGoogleDrivePreviewUrl(formData.attachedFile)} 
                                alt={t('Attachment')} 
                                style={{ width: '100%', maxHeight: 500, objectFit: 'contain', display: 'block', margin: '0 auto' }} 
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
                                <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{formData.attachedFileName || t('Attached Image')}</span>
                                <a 
                                  href={formData.attachedFile} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="btn btn-sm"
                                  style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)' }}
                                >
                                  <Download className="w-3.5 h-3.5" /> {t('Download')}
                                </a>
                              </div>
                            </div>
                          ) : (
                            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div style={{ width: 40, height: 40, borderRadius: 0, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                                <Paperclip className="w-5 h-5" />
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{formData.attachedFileName || t('Attachment')}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Click to view or download')}</div>
                              </div>
                              <a 
                                href={formData.attachedFile} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="btn btn-ghost btn-sm"
                              >
                                <Download className="w-4 h-4" />
                              </a>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: 14, color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('No attachment')}</div>
                      )
                    ) : (
                      <>
                        <label style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '12px 16px',
                          border: '2px dashed var(--border-md)',
                          background: 'var(--surface-2)',
                          cursor: 'pointer',
                          fontSize: 13, color: 'var(--text-muted)',
                          transition: 'border-color 0.2s',
                        }}>
                          <Paperclip className="w-4 h-4" style={{ flexShrink: 0 }} />
                          <span>{isUploading ? t('Uploading to Drive...') : t('Click to attach a file')}</span>
                          <input type="file" onChange={handleFileUpload} style={{ display: 'none' }} />
                        </label>
                        {formData.attachedFileName && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ fontSize: 12, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                              <Paperclip className="w-3 h-3" /> {formData.attachedFileName}
                              <button type="button" onClick={() => setFormData(p => ({ ...p, attachedFile: '', attachedFileName: '' }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171' }}><X className="w-3 h-3" /></button>
                            </div>
                            {formData.attachedFile && (formData.attachedFile.includes('image') || formData.attachedFile.includes('google.com')) && (
                              <div style={{ borderRadius: 0, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-2)', padding: 8 }}>
                                <img src={getGoogleDrivePreviewUrl(formData.attachedFile)} alt={t('Preview')} style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 0, display: 'block' }} />
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {/* Notes */}
                  <div>
                    <label className="input-label">{t('Manager Notes / Internal Comments')}</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', background: 'var(--surface-2)', padding: '12px 16px', borderRadius: 0, border: '1px solid var(--border)', fontStyle: 'italic', lineHeight: 1.6 }}>
                        {formData.notes || t('No notes available.')}
                      </div>
                    ) : (
                      <textarea className="input" rows={2} value={formData.notes} onChange={e => set('notes', e.target.value)} placeholder={t('Add internal notes or instructions…')} />
                    )}
                  </div>

                  </div>{/* end flex: Files */}
                </div>{/* end section: Files */}

                {/* ── Sticky footer ── */}
                <div style={{
                  display: 'flex',
                  gap: 10,
                  justifyContent: 'flex-end',
                  borderTop: '1px solid var(--border)',
                  padding: '16px 24px',
                  background: 'var(--surface)',
                  position: 'sticky',
                  bottom: 0,
                  paddingBottom: 'calc(16px + var(--safe-area-bottom))',
                  zIndex: 10,
                  marginTop: 16,
                }}>
                  {isViewing ? (
                    <>
                      <button type="button" className="btn btn-ghost" onClick={closeModal}>{t('Close')}</button>
                      <button 
                        type="button" 
                        className="btn btn-primary" 
                        onClick={() => setIsViewing(false)}
                        style={{ gap: 8 }}
                      >
                        <Edit2 className="w-4 h-4" /> {t('Edit Details')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn btn-ghost" onClick={closeModal}>{t('Cancel')}</button>
                      <button type="submit" className="btn btn-primary" disabled={isUploading}>
                        {editing ? t('Save Changes') : t('Create Corresponding')}
                      </button>
                    </>
                  )}
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeleteTarget(null)}>
            <motion.div className="modal" style={{ maxWidth: 420 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: 28 }}>
                <h3 style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', marginBottom: 10 }}>{t('Delete Corresponding?')}</h3>
                {/* The subject is lifted OUT of the sentence: Arabic reorders the
                    clause, and a mid-sentence <strong> cannot be translated
                    without <Trans>. */}
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                  {deleteTarget.subject}
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
                  {t('This item will be permanently deleted.')}
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>{t('Cancel')}</button>
                  <button className="btn btn-danger" onClick={confirmDelete}>{t('Delete')}</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Correspondence Details Modal (Premium) ── */}
      <AnimatePresence>
        {selectedCorrForDetails && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(4px)' }}
            onClick={() => setSelectedCorrForDetails(null)}
          >
            <motion.div
              initial={{ y: 20, scale: 0.95 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 20, scale: 0.95 }}
              className="card"
              style={{ width: '100%', maxWidth: 700, maxHeight: '90vh', padding: 0, display: 'flex', flexDirection: 'column' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div style={{ padding: '24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'var(--surface)', flexShrink: 0 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    <span className={statusBadgeClass(selectedCorrForDetails.status)}>{label(selectedCorrForDetails.status)}</span>
                    {/* The word around the value must sit on the correct side of
                        it in either script, so this stays ONE interpolated key.
                        The value itself now goes through the task-6 label. */}
                    <span className={priorityBadgeClass(selectedCorrForDetails.priority)}>{t('Priority: {{priority}}', { priority: label(selectedCorrForDetails.priority) })}</span>
                    <span style={{ padding: '4px 12px', borderRadius: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: selectedCorrForDetails.category === 'Project' ? 'rgba(59,130,246,0.15)' : selectedCorrForDetails.category === 'External' ? 'rgba(34,197,94,0.15)' : 'rgba(139,92,246,0.15)',
                      color: selectedCorrForDetails.category === 'Project' ? '#3b82f6' : selectedCorrForDetails.category === 'External' ? '#22c55e' : '#8b5cf6',
                      display: 'flex', alignItems: 'center', gap: 4
                    }}>
                       {selectedCorrForDetails.category}
                    </span>
                  </div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary, #0f172a)', margin: 0, lineHeight: 1.3 }}>{selectedCorrForDetails.subject}</h2>
                  {selectedCorrForDetails.serialNumber && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary, #334155)', marginTop: 4, letterSpacing: '0.02em' }}>
                      {t('REF:')}<span className="ltr-data">{selectedCorrForDetails.serialNumber}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedCorrForDetails(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 10, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginInlineStart: 16, minWidth: 44, minHeight: 44 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <X className="w-5 h-5" style={{ color: 'var(--text-primary)' }} />
                </button>
              </div>
              
              {/* Modal Body */}
              <div style={{ padding: '32px', flex: 1, overflowY: 'auto' }}>
                <div style={{ marginBottom: 32 }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                     <FileText className="w-4 h-4 text-primary" />
                     <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('Correspondence Body')}</h3>
                   </div>
                   <div style={{ padding: '20px', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 0, color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                    {selectedCorrForDetails.body || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>{t('No content provided.')}</span>}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 32 }}>
                  <div className="card-minimal" style={{ padding: '16px', background: 'var(--surface-3)', border: 'none' }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>{t('Sent From')}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                      <Building2 className="w-4 h-4" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                      <span>{selectedCorrForDetails.sentFrom || '—'}</span>
                    </div>
                    {selectedCorrForDetails.department && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, marginInlineStart: 24 }}>{selectedCorrForDetails.department}</div>
                    )}
                  </div>

                  <div className="card-minimal" style={{ padding: '16px', background: 'var(--surface-3)', border: 'none' }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>{t('Dates')}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Calendar className="w-4 h-4" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                        {t('Received:')}<span className="ltr-data">{selectedCorrForDetails.dateReceived || '—'}</span>
                      </div>
                      {selectedCorrForDetails.deadline ? (
                        <div style={{ fontSize: 13, fontWeight: 600, color: isOverdue(selectedCorrForDetails.deadline) && selectedCorrForDetails.status !== 'Closed' ? '#dc2626' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Clock className="w-4 h-4" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                          {t('Deadline:')}<span className="ltr-data">{selectedCorrForDetails.deadline}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="card-minimal" style={{ padding: '16px', background: 'var(--surface-3)', border: 'none' }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>{t('Assignment')}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {(() => {
                        const u = projectUsers.find(pu => pu.id === selectedCorrForDetails.assignedToId);
                        return (
                          <>
                            {u?.photoURL ? (
                              <img src={u.photoURL} className="avatar" style={{ width: 24, height: 24, objectFit: 'cover' }} alt="" />
                            ) : (
                              <div style={{ width: 24, height: 24, borderRadius: 0, background: u?.userColor || getUserColor(selectedCorrForDetails.assignedToId || ''), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                                {selectedCorrForDetails.assignedTo?.[0] || '?'}
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedCorrForDetails.assignedTo || t('Unassigned')}</div>
                              {selectedCorrForDetails.assignedAt && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  {t('Assigned on {{date}}', {
                                    date: typeof selectedCorrForDetails.assignedAt === 'string'
                                      ? selectedCorrForDetails.assignedAt
                                      : fmt.date(selectedCorrForDetails.assignedAt),
                                  })}
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {(selectedCorrForDetails.filePaths && selectedCorrForDetails.filePaths.length > 0) && (
                  <div style={{ marginBottom: 32 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <ExternalLink className="w-4 h-4 text-primary" />
                      <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('Shared Folders / Links')}</h3>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {selectedCorrForDetails.filePaths.map((path, idx) => {
                        const friendlyName = path.split(/[/\\]/).filter(Boolean).pop() || path;
                        const isUrl = path.startsWith('http://') || path.startsWith('https://');
                        return (
                          <div key={idx} style={{ padding: '10px 14px', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span
                                onClick={() => openOrCopyPath(path)}
                                title={isUrl ? path : t('Click to copy path: {{path}}', { path })}
                                style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              >{friendlyName}</span>
                              {!isUrl && (
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</span>
                              )}
                            </div>
                            <button
                              onClick={() => openOrCopyPath(path)}
                              title={t('Open (web link) or copy this path')}
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '4px 8px', height: 'auto', minHeight: 'auto', flexShrink: 0 }}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedCorrForDetails.attachedFile && (
                  <div style={{ marginBottom: 32 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Paperclip className="w-4 h-4 text-primary" />
                      <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('Attachment')}</h3>
                    </div>
                    <a 
                      href={selectedCorrForDetails.attachedFile} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ 
                        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'var(--blue-50)',
                        border: '1px solid var(--blue-200)', borderRadius: 0, color: 'var(--blue-400)', textDecoration: 'none',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#dbeafe'}
                      onMouseLeave={e => e.currentTarget.style.background = '#eff6ff'}
                    >
                      <div style={{ background: 'var(--surface)', padding: 8, borderRadius: 0 }}>
                        <FileText className="w-5 h-5" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedCorrForDetails.attachedFileName || t('View attachment')}</div>
                        <div style={{ fontSize: 11, opacity: 0.8 }}>{t('Click to open in new tab')}</div>
                      </div>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                )}

              </div>

              {/* Sticky Footer Actions */}
              <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', gap: 10, flexShrink: 0 }}>
                {tasks.find(t => t.correspondingId === selectedCorrForDetails.id || t.id === selectedCorrForDetails.convertedToTaskId) && (
                  <button
                    className="btn btn-primary"
                    style={{ gap: 8, height: 44, flex: 1 }}
                    onClick={() => {
                      const t = tasks.find(t => t.correspondingId === selectedCorrForDetails.id || t.id === selectedCorrForDetails.convertedToTaskId);
                      if (t) {
                        setSelectedCorrForDetails(null);
                        onNavigate('tasks');
                      }
                    }}
                  >
                    <Edit2 className="w-4 h-4" /> {t('View Linked Task')}
                  </button>
                )}
                <button
                  className="btn btn-ghost"
                  style={{ height: 44, flex: 1 }}
                  onClick={() => {
                    setSelectedCorrForDetails(null);
                    openModal(selectedCorrForDetails, false);
                  }}
                >
                  {t('Edit')}
                </button>
                <button className="btn btn-ghost" style={{ height: 44 }} onClick={() => setSelectedCorrForDetails(null)}>{t('Close')}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
