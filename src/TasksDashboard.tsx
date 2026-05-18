/// <reference types="vite/client" />
import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy, where, Timestamp
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { User } from 'firebase/auth';
import {
  AppUser, Task, TaskStatus, Milestone, MilestoneStatus, Corresponding,
  PRIORITY_OPTIONS, MILESTONE_STATUS_OPTIONS, OperationType,
  CATEGORY_OPTIONS, CorrespondingCategory, PROJECT_OPTIONS, DEPARTMENT_OPTIONS
} from './types';
import { getNextSerialNumber } from './lib/counters';
import {
  Plus, CheckSquare, Clock, AlertCircle, X, ChevronDown, ChevronRight, ChevronLeft,
  Flag, Target, Calendar, Link2, Edit2, Trash2, CheckCircle2,
  TrendingUp, ListTodo, Search, Filter, Layers, Tag, Archive, Paperclip, Download, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { globalSearch, getUserColor, getGoogleDrivePreviewUrl, isOverdue, isDueSoon, openOrCopyPath } from './utils';
import { Copy, Check } from 'lucide-react';
import DueSoonBanner from './components/DueSoonBanner';

function handleFirestoreError(e: unknown, op: OperationType, path: string | null) {
  console.error('Firestore:', { e, op, path });
}

function priorityBadge(p: string) {
  const map: Record<string, string> = { Urgent: 'badge-urgent', High: 'badge-high', Medium: 'badge-medium', Low: 'badge-low' };
  return `badge ${map[p] || 'badge-medium'}`;
}
function statusBadge(s: string) {
  const map: Record<string, string> = { 'In Progress': 'badge-inprogress', Done: 'badge-done', Pending: 'badge-pending', Archived: 'badge-archived' };
  return `badge ${map[s] || 'badge-pending'}`;
}
function msBadge(s: MilestoneStatus) {
  const map: Record<string, string> = { 'In Progress': 'badge-inprogress', Done: 'badge-done', Planned: 'badge-pending', Blocked: 'badge-urgent' };
  return `badge ${map[s] || 'badge-pending'}`;
}

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
}

export default function TasksDashboard({ user, appUser, projectUsers }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [correspondences, setCorrespondences] = useState<Corresponding[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [newMilestone, setNewMilestone] = useState<{ taskId: string; title: string; targetDate: string } | null>(null);
  const [editingStatus, setEditingStatus] = useState<{ taskId: string; status: TaskStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAddingMilestone, setIsAddingMilestone] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState('All');
  const [subCategoryFilter, setSubCategoryFilter] = useState('All');
  const [deptFilter, setDeptFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [newTask, setNewTask] = useState({
    taskName: '',
    description: '',
    priority: 'Medium' as Corresponding['priority'],
    dueDate: '',
    category: 'Project' as CorrespondingCategory,
    subCategory: 'None',
    department: 'None',
    assignedTo: appUser.displayName,
    assignedToId: user.uid,
    filePaths: [] as string[],
  });

  const handleOtherSelection = (field: string, value: string, isEditingForm = false) => {
    if (value === 'Other...') {
      const custom = prompt(`Enter custom value for ${field}:`);
      if (custom) {
        if (isEditingForm && editingTask) {
          setEditingTask({ ...editingTask, [field]: custom });
        } else {
          setNewTask({ ...newTask, [field]: custom });
        }
      }
    } else {
      if (isEditingForm && editingTask) {
        setEditingTask({ ...editingTask, [field]: value });
      } else {
        setNewTask({ ...newTask, [field]: value });
      }
    }
  };

  const isManagerOrAdmin = appUser.role === 'Admin' || appUser.role === 'Manager';

  const dynamicSubCategories = useMemo(() => {
    const fromTasks = Array.from(new Set(tasks.map(t => t.subCategory).filter(Boolean))).sort();
    return Array.from(new Set([...PROJECT_OPTIONS, ...fromTasks])).sort();
  }, [tasks]);

  // Tasks listener
  useEffect(() => {
    if (!appUser || appUser.status !== 'Approved') return;

    const isAdmin = appUser.role === 'Admin';
    const q = isAdmin
      ? query(collection(db, 'tasks'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'tasks'), where('teamId', '==', appUser.teamId || 'NONE'), orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'tasks');
      setError('Failed to load tasks. Check your connection.');
    });
    return () => unsub();
  }, [appUser]);

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

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (t.status === 'Archived') return false;
      if (view === 'mine' && t.assignedToId !== user.uid) return false;
      if (search && !globalSearch(t, search)) return false;
      if (statusFilter !== 'All' && t.status !== statusFilter) return false;
      if (categoryFilter !== 'All' && t.category !== categoryFilter) return false;
      if (isManagerOrAdmin && employeeFilter !== 'All' && t.assignedTo !== employeeFilter) return false;
      if (subCategoryFilter !== 'All' && t.subCategory !== subCategoryFilter) return false;
      if (deptFilter !== 'All' && t.department !== deptFilter) return false;
      if (dateFilter) {
        const createdDate = t.createdAt?.toDate?.()?.toISOString()?.split('T')[0];
        if (createdDate !== dateFilter) return false;
      }
      return true;
    });
  }, [tasks, view, search, statusFilter, categoryFilter, employeeFilter, subCategoryFilter, deptFilter, appUser.displayName, isManagerOrAdmin, dateFilter, user.uid]);

  // Reset page when filters change
  useEffect(() => {
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
  };

  const paginatedTasks = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filtered.slice(startIndex, startIndex + itemsPerPage);
  }, [filtered, currentPage]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);

  const groupedTasks = useMemo(() => {
    const groups: Record<string, Task[]> = {};
    paginatedTasks.forEach(t => {
      const cat = t.category || 'Uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    });
    return groups;
  }, [paginatedTasks]);

  const stats = useMemo(() => ({
    pending: tasks.filter(t => t.status === 'Pending' && (view === 'all' || t.assignedTo === appUser.displayName)).length,
    inProgress: tasks.filter(t => t.status === 'In Progress' && (view === 'all' || t.assignedTo === appUser.displayName)).length,
    done: tasks.filter(t => t.status === 'Done' && (view === 'all' || t.assignedTo === appUser.displayName)).length,
  }), [tasks, view, appUser.displayName]);

  const dueSoonTasks = useMemo(
    () => tasks.filter(t => t.status !== 'Done' && t.status !== 'Archived' && isDueSoon(t.dueDate)),
    [tasks]
  );

  const getMilestonesForTask = (taskId: string) => milestones.filter(m => m.taskId === taskId);

  // Open a specific task from anywhere (e.g. the Due Soon banner). The task may
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

    // With all filters cleared + "All Tasks", `filtered` is just the
    // non-archived tasks in listener order, so its page math is reproducible.
    const defaultFiltered = tasks.filter(t => t.status !== 'Archived');
    const idx = defaultFiltered.findIndex(t => t.id === taskId);
    setCurrentPage(idx >= 0 ? Math.floor(idx / itemsPerPage) + 1 : 1);

    setExpandedTask(taskId);

    requestAnimationFrame(() => {
      setTimeout(() => {
        document.getElementById(`task-${taskId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    });
  };

  const handleUpdateTask = async () => {
    if (!editingTask || !editingTask.taskName.trim()) return;
    try {
      await updateDoc(doc(db, 'tasks', editingTask.id), {
        taskName: editingTask.taskName.trim(),
        description: editingTask.description.trim(),
        priority: editingTask.priority,
        category: editingTask.category,
        subCategory: editingTask.subCategory,
        department: editingTask.department || null,
        dueDate: editingTask.dueDate || null,
        assignedTo: editingTask.assignedTo,
        assignedToId: editingTask.assignedToId,
        filePaths: editingTask.filePaths || [],
        updatedAt: serverTimestamp(),
      });

      const originalTask = tasks.find(t => t.id === editingTask.id);
      
      // Update linked correspondence if exists
      if (originalTask?.correspondingId) {
        await updateDoc(doc(db, 'correspondences', originalTask.correspondingId), {
          assignedTo: editingTask.assignedTo,
          assignedToId: editingTask.assignedToId,
          updatedAt: serverTimestamp(),
        });
      }

      if (originalTask && originalTask.assignedById && originalTask.assignedById !== user.uid) {
        await addDoc(collection(db, 'notifications'), {
          type: 'task_updated',
          title: 'Task Updated',
          message: `${appUser.displayName} updated the details of "${editingTask.taskName}".`,
          forUserId: originalTask.assignedById,
          read: false,
          relatedId: editingTask.id,
          createdAt: serverTimestamp(),
        });
      }

      // Notify new assignee if changed
      if (originalTask && originalTask.assignedToId !== editingTask.assignedToId) {
        await addDoc(collection(db, 'notifications'), {
          type: 'task_assigned',
          title: 'Task Reassigned',
          message: `Task "${editingTask.taskName}" has been reassigned to you by ${appUser.displayName}`,
          forUserId: editingTask.assignedToId,
          read: false,
          relatedId: editingTask.id,
          createdAt: serverTimestamp(),
        });
      }

      setEditingTask(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${editingTask.id}`);
      setError('Failed to update task.');
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, status: TaskStatus) => {
    try {
      const update: any = { status, updatedAt: serverTimestamp() };
      const task = tasks.find(t => t.id === taskId);

      // Perform the announced write first so a failed update never
      // produces a false "status updated" notification.
      await updateDoc(doc(db, 'tasks', taskId), update);

      if (status === 'Done' && task?.correspondingId) {
        await updateDoc(doc(db, 'correspondences', task.correspondingId), {
          status: 'Closed',
          updatedAt: serverTimestamp()
        });
      }

      if (task && task.assignedById && task.assignedById !== user.uid) {
        await addDoc(collection(db, 'notifications'), {
          type: 'task_status_updated',
          title: 'Task Status Updated',
          message: `${appUser.displayName} changed the status of "${task.taskName}" to ${status}.`,
          forUserId: task.assignedById,
          read: false,
          relatedId: taskId,
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
      setError('Failed to update status.');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `tasks/${taskId}`);
      setError('Failed to delete task.');
    }
  };

  const handleArchiveTask = async (taskId: string) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        status: 'Archived' as TaskStatus,
        archivedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
      setError('Failed to archive task.');
    }
  };

  const uploadToGoogleDrive = async (file: File): Promise<string> => {
    const scriptUrl = import.meta.env.VITE_GOOGLE_SCRIPT_URL;
    if (!scriptUrl) {
      throw new Error('Google Script URL not configured.');
    }

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

  const handleEditFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingTask) return;
    
    setIsUploading(true);
    try {
      const driveUrl = await uploadToGoogleDrive(file);
      setEditingTask({ ...editingTask, attachedFile: driveUrl, attachedFileName: file.name });
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleNewFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsUploading(true);
    try {
      const driveUrl = await uploadToGoogleDrive(file);
      setNewTask(p => ({ ...p, attachedFile: driveUrl, attachedFileName: file.name }));
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddMilestone = async () => {
    if (!newMilestone || !newMilestone.title.trim()) return;
    setIsAddingMilestone(true);
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

      if (task?.assignedById) {
        await addDoc(collection(db, 'notifications'), {
          type: 'milestone_added',
          title: 'Milestone Added',
          message: `${appUser.displayName} added milestone "${newMilestone.title}" to "${task.taskName}"`,
          forUserId: task.assignedById,
          read: false,
          relatedId: newMilestone.taskId,
          createdAt: serverTimestamp(),
        });
      }

      setNewMilestone(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'milestones');
      setError('Failed to add milestone.');
    } finally {
      setIsAddingMilestone(false);
    }
  };

  const handleCreateTask = async () => {
    if (!newTask.taskName.trim()) return;
    try {
      const serial = await getNextSerialNumber('tasks');
      await addDoc(collection(db, 'tasks'), {
        taskName: newTask.taskName.trim(),
        description: newTask.description.trim(),
        status: 'Pending',
        priority: newTask.priority,
        category: newTask.category,
        subCategory: newTask.subCategory,
        department: newTask.department,
        serialNumber: serial,
        assignedTo: newTask.assignedTo || appUser.displayName,
        assignedToId: newTask.assignedToId || user.uid,
        assignedBy: appUser.displayName,
        assignedById: user.uid,
        teamId: appUser.teamId || 'NONE',
        dueDate: newTask.dueDate || null,
        filePaths: newTask.filePaths || [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setIsAddingTask(false);
      setNewTask({ 
        taskName: '', 
        description: '', 
        priority: 'Medium', 
        dueDate: '', 
        category: 'Project', 
        subCategory: 'None', 
        department: 'None',
        assignedTo: appUser.displayName,
        assignedToId: user.uid,
        filePaths: [],
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'tasks');
      setError('Failed to create task.');
    }
  };

  const handleUpdateMilestoneStatus = async (milestoneId: string, status: MilestoneStatus) => {
    try {
      const update: any = { status, updatedAt: serverTimestamp() };
      if (status === 'Done') update.completedAt = serverTimestamp();
      await updateDoc(doc(db, 'milestones', milestoneId), update);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `milestones/${milestoneId}`);
    }
  };

  const handleDeleteMilestone = async (id: string) => {
    try { await deleteDoc(doc(db, 'milestones', id)); }
    catch (err) { handleFirestoreError(err, OperationType.DELETE, `milestones/${id}`); }
  };

  return (
    <div style={{ padding: '4px 0', minHeight: '60vh' }}>
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            Tasks
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Track your assigned tasks, organize your work, and add milestones to show progress.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsAddingTask(true)}>
          <Plus className="w-4 h-4" /> Add Task
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0, padding: 4, display: 'flex', gap: 4 }}>
          {(['mine', 'all'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '6px 16px', borderRadius: 0, fontSize: 13, fontWeight: 600,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: view === v ? 'var(--accent)' : 'transparent',
                color: view === v ? '#fff' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {v === 'mine' ? 'My Tasks' : 'All Tasks'}
            </button>
          ))}
        </div>

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
              {cat}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'var(--text-muted)' }} />
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Search tasks…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <input 
          type="date" 
          className="input" 
          style={{ width: 'auto' }} 
          value={dateFilter} 
          onChange={e => setDateFilter(e.target.value)}
          title="Filter by day"
        />
        {dateFilter && (
          <button className="btn btn-ghost btn-sm" onClick={() => setDateFilter('')}>
            Clear Date
          </button>
        )}

        <select className="input" style={{ width: 'auto' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          {['Pending', 'In Progress', 'Done'].map(s => <option key={s}>{s}</option>)}
        </select>

        <select className="input" style={{ width: 'auto' }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="All">All Departments</option>
          {DEPARTMENT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        
        {isManagerOrAdmin && view === 'all' && (
          <select className="input" style={{ width: 'auto' }} value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}>
            <option value="All">All Employees</option>
            {projectUsers.filter(u => u.role === 'Employee' || u.role === 'Manager').map(e => <option key={e.id} value={e.displayName}>{e.displayName}</option>)}
          </select>
        )}

        {subCategoryFilter !== 'All' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--accent-10)', color: 'var(--accent)', borderRadius: 0, fontSize: 12, fontWeight: 700 }}>
            Tag: {subCategoryFilter}
            <button onClick={() => setSubCategoryFilter('All')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', display: 'flex', alignItems: 'center' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 0, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, color: '#f87171', fontSize: 14 }}>
          <AlertCircle className="w-4 h-4" /> {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#f87171' }}><X className="w-4 h-4" /></button>
        </div>
      )}

      <DueSoonBanner
        items={dueSoonTasks.map(t => ({
          id: t.id,
          type: 'Task' as const,
          title: t.taskName,
          due: t.dueDate,
          onClick: () => handleOpenTask(t.id),
        }))}
      />

      <AnimatePresence>
        {isAddingTask && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden', marginBottom: 24 }}
          >
            <div className="card" style={{ padding: 24, border: '2px dashed var(--border)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus className="w-5 h-5 text-primary" /> Create New Task
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="label">Task Name</label>
                  <input className="input" value={newTask.taskName} onChange={e => setNewTask({ ...newTask, taskName: e.target.value })} placeholder="What needs to be done?" autoFocus />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="label">Description (Optional)</label>
                  <textarea className="input" value={newTask.description} onChange={e => setNewTask({ ...newTask, description: e.target.value })} rows={2} placeholder="Add details..." />
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select className="input" value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value })}>
                    {PRIORITY_OPTIONS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Due Date (Optional)</label>
                  <input type="date" className="input" value={newTask.dueDate} onChange={e => setNewTask({ ...newTask, dueDate: e.target.value })} />
                </div>
                <div>
                  <label className="label">Category</label>
                  <select className="input" value={newTask.category} onChange={e => handleOtherSelection('category', e.target.value)}>
                    {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Department</label>
                  <select className="input" value={newTask.department} onChange={e => handleOtherSelection('department', e.target.value)}>
                    {DEPARTMENT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Sub-Category / Project</label>
                  <input 
                    className="input" 
                    list="subCategoryList"
                    placeholder="Search or type project..."
                    value={newTask.subCategory} 
                    onChange={e => setNewTask({ ...newTask, subCategory: e.target.value })} 
                  />
                  <datalist id="subCategoryList">
                    {(newTask.category === 'Project' ? PROJECT_OPTIONS : dynamicSubCategories).map(s => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="label">Assignee</label>
                  <select 
                    className="input" 
                    value={newTask.assignedToId} 
                    onChange={e => {
                      const u = projectUsers.find(u => u.id === e.target.value);
                      if (u) setNewTask({ ...newTask, assignedToId: u.id, assignedTo: u.displayName });
                    }}
                  >
                    {projectUsers
                      .filter(u => 
                        u.id === user.uid || 
                        appUser.role === 'Admin' || 
                        (u.department === appUser.department && u.teamId === appUser.teamId)
                      )
                      .map(u => (
                        <option key={u.id} value={u.id}>{u.displayName} ({u.role})</option>
                      ))
                    }
                  </select>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="label">Attachment</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input type="file" onChange={handleNewFileUpload} style={{ fontSize: 12 }} />
                    {isUploading && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Uploading to Drive…</div>}
                    {(newTask as any).attachedFileName && (
                      <div style={{ fontSize: 12, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Paperclip className="w-3 h-3" /> {(newTask as any).attachedFileName}
                      </div>
                    )}
                  </div>
                </div>
                {/* Shared Folder Paths */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="label">Shared Folder Paths (Computer Paths)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {newTask.filePaths.map((path, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 8 }}>
                        <input 
                          className="input" 
                          placeholder="e.g. \\server\share\folder or C:\Documents\..." 
                          value={path}
                          onChange={e => {
                            const newPaths = [...newTask.filePaths];
                            newPaths[idx] = e.target.value;
                            setNewTask({ ...newTask, filePaths: newPaths });
                          }}
                        />
                        <button 
                          type="button" 
                          className="btn btn-danger btn-icon" 
                          onClick={() => {
                            const newPaths = newTask.filePaths.filter((_, i) => i !== idx);
                            setNewTask({ ...newTask, filePaths: newPaths });
                          }}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button 
                      type="button" 
                      className="btn btn-ghost btn-sm" 
                      style={{ width: 'fit-content', gap: 6 }}
                      onClick={() => setNewTask({ ...newTask, filePaths: [...newTask.filePaths, ''] })}
                    >
                      <Plus className="w-4 h-4" /> Add Path
                    </button>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <button className="btn btn-ghost" onClick={() => setIsAddingTask(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleCreateTask} disabled={!newTask.taskName.trim()}>Create Task</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {(Object.entries(groupedTasks) as [string, Task[]][]).map(([cat, catTasks]) => {
          return (
            <div key={cat}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
                <Layers className="w-4 h-4 text-accent" />
                {cat} Tasks
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 'auto', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 0 }}>{catTasks.length}</span>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <AnimatePresence>
                  {catTasks.map(task => {
                    const taskMilestones = getMilestonesForTask(task.id);
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
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="card"
                        style={{ 
                          overflow: 'hidden', 
                          borderLeft: isEditing ? '4px solid var(--accent)' : (isTaskDueSoon ? '4px solid #f97316' : `4px solid ${(() => {
                            const u = projectUsers.find(pu => pu.id === task.assignedToId);
                            return u?.userColor || getUserColor(task.assignedToId || task.assignedTo || '');
                          })()}`),
                          backgroundColor: isTaskDueSoon ? '#fffcf9' : (task.status === 'Done' ? 'var(--surface-2)' : 'var(--surface)'),
                          transition: 'background-color 0.2s ease'
                        }}
                      >
                        {isEditing ? (
                          <div style={{ padding: '24px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                              <h3 style={{ fontWeight: 800, fontSize: 16, margin: 0 }}>Editing Task</h3>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-ghost btn-sm" onClick={() => setEditingTask(null)}>Cancel</button>
                                <button className="btn btn-primary btn-sm" onClick={handleUpdateTask} disabled={!editingTask.taskName.trim()}>Save</button>
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                                <div style={{ gridColumn: 'span 2' }}>
                                  <label className="label">Task Name</label>
                                  <input className="input" value={editingTask.taskName} onChange={e => setEditingTask({ ...editingTask, taskName: e.target.value })} />
                                </div>
                                <div style={{ gridColumn: 'span 2' }}>
                                  <label className="label">Description</label>
                                  <textarea className="input" style={{ minHeight: 80 }} value={editingTask.description} onChange={e => setEditingTask({ ...editingTask, description: e.target.value })} />
                                </div>
                                <div>
                                  <label className="label">Priority</label>
                                  <select className="input" value={editingTask.priority} onChange={e => setEditingTask({ ...editingTask, priority: e.target.value as any })}>
                                    {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="label">Due Date</label>
                                  <input type="date" className="input" value={editingTask.dueDate || ''} onChange={e => setEditingTask({ ...editingTask, dueDate: e.target.value })} />
                                </div>
                                <div style={{ gridColumn: 'span 2' }}>
                                  <label className="label">Assignee</label>
                                  <select 
                                    className="input" 
                                    value={editingTask.assignedToId} 
                                    onChange={e => {
                                      const u = projectUsers.find(u => u.id === e.target.value);
                                      if (u) setEditingTask({ ...editingTask, assignedToId: u.id, assignedTo: u.displayName });
                                    }}
                                  >
                                    <option value="">— Select Assignee —</option>
                                    {projectUsers
                                      .filter(u => 
                                        u.id === user.uid || 
                                        appUser.role === 'Admin' || 
                                        (u.department === appUser.department && u.teamId === appUser.teamId)
                                      )
                                      .map(u => (
                                        <option key={u.id} value={u.id}>{u.displayName} ({u.role})</option>
                                      ))
                                    }
                                  </select>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, gridColumn: 'span 2' }}>
                                  <div>
                                    <label className="label">Category</label>
                                    <select className="input" value={editingTask.category} onChange={e => handleOtherSelection('category', e.target.value, true)}>
                                      {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="label">Department</label>
                                    <select className="input" value={editingTask.department} onChange={e => handleOtherSelection('department', e.target.value, true)}>
                                      {DEPARTMENT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                  </div>
                                  <div style={{ gridColumn: 'span 2' }}>
                                    <label className="label">Sub-Category / Project</label>
                                    <input 
                                      className="input" 
                                      list="editSubCategoryList"
                                      placeholder="Search or type project..."
                                      value={editingTask.subCategory} 
                                      onChange={e => setEditingTask({ ...editingTask, subCategory: e.target.value })} 
                                    />
                                    <datalist id="editSubCategoryList">
                                      {(editingTask.category === 'Project' ? PROJECT_OPTIONS : dynamicSubCategories).map(s => (
                                        <option key={s} value={s} />
                                      ))}
                                    </datalist>
                                  </div>
                                  <div style={{ gridColumn: 'span 2' }}>
                                    <label className="label">Attachment</label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      <input type="file" onChange={handleEditFileUpload} style={{ fontSize: 12 }} />
                                      {isUploading && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Uploading to Drive…</div>}
                                      {editingTask.attachedFileName && (
                                        <div style={{ fontSize: 12, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <Paperclip className="w-3 h-3" /> {editingTask.attachedFileName}
                                          <button 
                                            type="button" 
                                            onClick={() => setEditingTask({ ...editingTask, attachedFile: '', attachedFileName: '' })} 
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171' }}
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                </div>
                                {/* Shared Folder Paths */}
                                <div style={{ gridColumn: 'span 2' }}>
                                    <label className="label">Shared Folder Paths (Computer Paths)</label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                      {(editingTask.filePaths || []).map((path, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: 8 }}>
                                          <input 
                                            className="input" 
                                            placeholder="e.g. \\server\share\folder or C:\Documents\..." 
                                            value={path}
                                            onChange={e => {
                                              const newPaths = [...(editingTask.filePaths || [])];
                                              newPaths[idx] = e.target.value;
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
                                            <X className="w-4 h-4" />
                                          </button>
                                        </div>
                                      ))}
                                      <button 
                                        type="button" 
                                        className="btn btn-ghost btn-sm" 
                                        style={{ width: 'fit-content', gap: 6 }}
                                        onClick={() => setEditingTask({ ...editingTask, filePaths: [...(editingTask.filePaths || []), ''] })}
                                      >
                                        <Plus className="w-4 h-4" /> Add Path
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div
                              style={{ padding: '20px 24px', display: 'flex', gap: 16, cursor: 'pointer', alignItems: 'flex-start' }}
                              onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                            >
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  if (!canEdit) return;
                                  const next = task.status === 'Pending' ? 'In Progress' : task.status === 'In Progress' ? 'Done' : 'Pending';
                                  handleUpdateTaskStatus(task.id, next as TaskStatus);
                                }}
                                style={{ marginTop: 2, background: 'none', border: 'none', cursor: canEdit ? 'pointer' : 'default', padding: 0, flexShrink: 0 }}
                                title={canEdit ? 'Click to advance status' : ''}
                              >
                                {task.status === 'Done'
                                  ? <CheckCircle2 style={{ width: 22, height: 22, color: '#4ade80' }} />
                                  : task.status === 'In Progress'
                                  ? <Clock style={{ width: 22, height: 22, color: '#818cf8' }} />
                                  : <CheckSquare style={{ width: 22, height: 22, color: 'var(--text-muted)' }} />
                                }
                              </button>

                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                  {canEdit ? (
                                    <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', padding: 2, borderRadius: 0, border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                                      {(['Pending', 'In Progress', 'Done'] as TaskStatus[]).map(s => (
                                        <button
                                          key={s}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (task.status !== s) handleUpdateTaskStatus(task.id, s);
                                          }}
                                          style={{
                                            padding: '2px 10px',
                                            fontSize: 11,
                                            fontWeight: 700,
                                            borderRadius: 0,
                                            border: 'none',
                                            cursor: 'pointer',
                                            background: task.status === s ? (s === 'Done' ? '#dcfce7' : s === 'In Progress' ? '#e0e7ff' : '#fef3c7') : 'transparent',
                                            color: task.status === s ? (s === 'Done' ? '#166534' : s === 'In Progress' ? '#3730a3' : '#92400e') : 'var(--text-muted)',
                                            transition: 'all 0.15s'
                                          }}
                                        >
                                          {s}
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className={statusBadge(task.status)}>{task.status}</span>
                                  )}
                                  <span className={priorityBadge(task.priority)}>{task.priority}</span>
                                  {isTaskOverdue && <span className="badge badge-urgent" style={{ marginLeft: 8 }}>OVERDUE</span>}
                                  {isTaskDueSoon && <span className="badge" style={{ marginLeft: 8, background: '#f97316', color: '#fff' }}>DUE SOON</span>}
                                  
                                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                                    {task.status === 'Done' && (
                                      <button 
                                        className="btn btn-ghost" 
                                        style={{ padding: '2px 8px', height: 'auto', fontSize: 11, color: 'var(--text-muted)' }}
                                        onClick={e => {
                                          e.stopPropagation();
                                          handleArchiveTask(task.id);
                                        }}
                                        title="Archive Task"
                                      >
                                        <Archive className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button 
                                      className="btn btn-ghost" 
                                      style={{ padding: '2px 8px', height: 'auto', fontSize: 11 }}
                                      onClick={e => {
                                        e.stopPropagation();
                                        setEditingTask(task);
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button 
                                      className="btn btn-ghost text-red" 
                                      style={{ padding: '2px 8px', height: 'auto', fontSize: 11, color: '#ef4444' }}
                                      onClick={e => {
                                        e.stopPropagation();
                                        handleDeleteTask(task.id);
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                                {task.serialNumber && (
                                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 2 }}>
                                    #{task.serialNumber}
                                  </div>
                                )}
                                <h3 style={{ fontWeight: 700, fontSize: 15, color: task.status === 'Done' ? 'var(--text-muted)' : 'var(--text-primary)', marginBottom: 4 }}>
                                  {task.taskName}
                                </h3>
                                <p style={{ color: 'var(--text-muted)', fontSize: 13, display: '-webkit-box', WebkitLineClamp: isExpanded ? 999 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                  {task.description}
                                </p>

                                <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                                  {task.assignedTo && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)', fontWeight: 600 }}>
                                      {(() => {
                                        const u = projectUsers.find(pu => pu.id === task.assignedToId);
                                        return u?.photoURL ? (
                                          <img src={u.photoURL} className="avatar" style={{ width: 18, height: 18, objectFit: 'cover' }} alt="" />
                                        ) : (
                                          <span style={{ width: 10, height: 10, borderRadius: 0, background: u?.userColor || getUserColor(task.assignedToId || task.assignedTo) }} />
                                        );
                                      })()}
                                      {task.assignedTo}
                                    </span>
                                  )}
                                  {task.assignedBy && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      {(() => {
                                        const u = projectUsers.find(pu => pu.id === task.assignedById);
                                        return u?.photoURL ? (
                                          <img src={u.photoURL} className="avatar" style={{ width: 14, height: 14, objectFit: 'cover', opacity: 0.7 }} alt="" />
                                        ) : (
                                          <span style={{ width: 8, height: 8, borderRadius: 0, background: u?.userColor || getUserColor(task.assignedById || task.assignedBy), opacity: 0.6 }} />
                                        );
                                      })()}
                                      By {task.assignedBy}
                                    </span>
                                  )}
                                  {task.dueDate && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: isOverdue ? '#f87171' : undefined }}><Calendar className="w-3 h-3" /> {task.dueDate}</span>}
                                  {(task.correspondingSerialNumber || task.correspondingSubject) && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <Link2 className="w-3 h-3" /> 
                                      {(() => {
                                        const linkedCorr = correspondences.find(c => c.id === task.correspondingId);
                                        return task.correspondingSerialNumber 
                                          || (linkedCorr ? `REF: ${linkedCorr.serialNumber}` : task.correspondingSubject);
                                      })()}
                                    </span>
                                  )}
                                  {task.subCategory && (
                                    <span 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSubCategoryFilter(task.subCategory!);
                                      }}
                                      style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--accent)', fontWeight: 700 }}
                                      title="Click to filter by this tag"
                                    >
                                      <Tag className="w-3 h-3" /> {task.subCategory}
                                    </span>
                                  )}
                                </div>

                                {isExpanded && task.attachedFile && (
                                  <div style={{ marginTop: 24 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 12, textTransform: 'uppercase' }}>Attachment</div>
                                    <div style={{ 
                                      borderRadius: 0,                                     overflow: 'hidden', 
                                      border: '1px solid var(--border)',
                                      background: 'var(--surface-2)',
                                      boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
                                    }}>
                                      {(task.attachedFile.includes('image') || task.attachedFile.includes('google.com')) ? (
                                        <div style={{ position: 'relative', background: 'var(--surface-3)', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                              <img 
                                                src={getGoogleDrivePreviewUrl(task.attachedFile)} 
                                                alt="Attachment" 
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
                                                <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{task.attachedFileName || 'Attached Image'}</span>
                                                <a 
                                                  href={task.attachedFile} 
                                                  target="_blank" 
                                                  rel="noopener noreferrer" 
                                                  className="btn btn-sm"
                                                  style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)' }}
                                                >
                                                  <ExternalLink className="w-3.5 h-3.5" /> Full View
                                                </a>
                                              </div>
                                        </div>
                                      ) : (
                                        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
                                          <div style={{ width: 40, height: 40, borderRadius: 0, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                                            <Paperclip className="w-5 h-5" />
                                          </div>
                                          <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{task.attachedFileName || 'Attachment'}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click to view or download</div>
                                          </div>
                                          <a 
                                            href={task.attachedFile} 
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
                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 12, textTransform: 'uppercase' }}>Shared Folder Paths</div>
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
                                            onClick={(e) => { e.stopPropagation(); openOrCopyPath(path); }}
                                            title="Click to open (web link) or copy this path"
                                            style={{ fontSize: 13, flex: 1, wordBreak: 'break-all', color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                                          >{path}</code>
                                          <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            onClick={(e) => { e.stopPropagation(); openOrCopyPath(path); }}
                                          >
                                            Open / Copy
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {taskMilestones.length > 0 && (
                                  <div style={{ marginTop: 12 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Target className="w-3 h-3" /> {doneMilestones}/{taskMilestones.length} milestones</span>
                                      <span>{progress}%</span>
                                    </div>
                                    <div className="progress-bar">
                                      <div className="progress-fill" style={{ width: `${progress}%` }} />
                                    </div>
                                  </div>
                                )}
                              </div>

                              <ChevronRight style={{ width: 18, height: 18, color: 'var(--text-muted)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0, marginTop: 4 }} />
                            </div>

                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  style={{ overflow: 'hidden' }}
                                >
                                  <div className="task-expand" style={{ borderTop: '1px solid var(--border)', padding: '20px 24px', paddingLeft: 62 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                      <h4 style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                        <Target className="w-3.5 h-3.5" style={{ display: 'inline', marginRight: 6 }} />
                                        Milestones
                                      </h4>
                                      {canEdit && (
                                        <button
                                          className="btn btn-ghost btn-sm"
                                          onClick={() => setNewMilestone({ taskId: task.id, title: '', targetDate: '' })}
                                        >
                                          <Plus className="w-3.5 h-3.5" /> Add Milestone
                                        </button>
                                      )}
                                    </div>

                                    {newMilestone?.taskId === task.id && (
                                      <div className="ms-addform" style={{ background: 'var(--surface-2)', borderRadius: 0, padding: 16, marginBottom: 14, border: '1px solid var(--border)' }}>
                                        <div className="ms-addform-row" style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                                          <input
                                            className="input"
                                            placeholder="Milestone title…"
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
                                          <button className="btn btn-ghost btn-sm" onClick={() => setNewMilestone(null)}>Cancel</button>
                                          <button className="btn btn-primary btn-sm" onClick={handleAddMilestone} disabled={isAddingMilestone || !newMilestone.title.trim()}>
                                            {isAddingMilestone ? 'Adding…' : 'Add'}
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    {taskMilestones.length === 0 ? (
                                      <p style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>No milestones yet. Add one to track progress.</p>
                                    ) : (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }} className="milestone-line">
                                        {taskMilestones.map((ms, i) => (
                                          <div key={ms.id} className="ms-row" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', position: 'relative', paddingLeft: 28 }}>
                                            <div style={{
                                              position: 'absolute', left: 8, top: 6,
                                              width: 10, height: 10, borderRadius: 0,
                                              background: ms.status === 'Done' ? '#4ade80' : ms.status === 'In Progress' ? '#818cf8' : ms.status === 'Blocked' ? '#f87171' : 'var(--surface-3)',
                                              border: '2px solid var(--surface)',
                                              zIndex: 1,
                                            }} />
                                            <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 0, padding: '10px 14px', border: '1px solid var(--border)' }}>
                                              <div className="ms-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <span className="ms-title" style={{ fontWeight: 600, fontSize: 13, color: ms.status === 'Done' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: ms.status === 'Done' ? 'line-through' : 'none' }}>
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
                                                          padding: '2px 8px',
                                                          fontSize: 10,
                                                          fontWeight: 700,
                                                          borderRadius: 0,
                                                          border: 'none',
                                                          cursor: 'pointer',
                                                          background: ms.status === s ? (s === 'Done' ? '#dcfce7' : s === 'In Progress' ? '#e0e7ff' : s === 'Blocked' ? '#fee2e2' : '#f1f5f9') : 'transparent',
                                                          color: ms.status === s ? (s === 'Done' ? '#166534' : s === 'In Progress' ? '#3730a3' : s === 'Blocked' ? '#991b1b' : 'var(--text-primary)') : 'var(--text-muted)',
                                                          transition: 'all 0.15s'
                                                        }}
                                                      >
                                                        {s}
                                                      </button>
                                                    ))}
                                                  </div>
                                                  {canEdit && (
                                                    <button className="ms-del-btn" onClick={() => handleDeleteMilestone(ms.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
                                                      <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                              <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                                                <span>By {ms.addedBy}</span>
                                                {ms.targetDate && <span><Calendar className="w-3 h-3" style={{ display: 'inline', marginRight: 3 }} />{ms.targetDate}</span>}
                                              </div>
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
                                            {s === 'Done' ? <><CheckCircle2 className="w-3.5 h-3.5" /> Mark Done</> : <><TrendingUp className="w-3.5 h-3.5" /> Mark In Progress</>}
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

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 24, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
          <button 
            className="btn btn-ghost" 
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            style={{ borderRadius: 0 }}
          >
            <ChevronLeft className="w-4 h-4" /> Previous
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
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
          <CheckCircle2 style={{ width: 48, height: 48, margin: '0 auto 16px', opacity: 0.2 }} />
          <p style={{ fontSize: 16, fontWeight: 600 }}>No tasks found matching your filters.</p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={resetFilters}>Clear All Filters</button>
        </div>
      )}
    </div>
  );
}
