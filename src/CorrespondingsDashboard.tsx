/// <reference types="vite/client" />
import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy, deleteField
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { createNotification } from './lib/pushNotification';
import { User } from 'firebase/auth';
import {
  AppUser, Corresponding, CorrespondingStatus, Task,
  DEPARTMENT_OPTIONS, PROJECT_OPTIONS, PRIORITY_OPTIONS, OperationType, FirestoreErrorInfo,
  CATEGORY_OPTIONS, CorrespondingCategory
} from './types';
import { getNextSerialNumber } from './lib/counters';
import { consumePending, subscribeOpen } from './lib/deepLink';
import {
  Plus, Search, Filter, X, AlertCircle, MailOpen, ChevronDown, FileText,
  Paperclip, Calendar, Download, Trash2, Edit2, Clock, Building2, Tag, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { globalSearch, getUserColor, getGoogleDrivePreviewUrl, isOverdue, isDueSoon, openOrCopyPath } from './utils';
import { Copy, Check } from 'lucide-react';
import { AppView } from './App';
import DueSoonBanner from './components/DueSoonBanner';

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
}

export default function CorrespondingsDashboard({ user, appUser, projectUsers, onNavigate }: Props) {
  const [items, setItems] = useState<Corresponding[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Corresponding | null>(null);
  const [isViewing, setIsViewing] = useState(false);
  const [formData, setFormData] = useState(emptyForm());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
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

  const copyToClipboard = (path: string) => {
    navigator.clipboard.writeText(path);
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
      setError('Failed to load correspondences.');
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
    const map: Record<string, string | undefined> = {};
    projectUsers.forEach(u => { map[u.id] = u.department; });
    return map;
  }, [projectUsers]);

  const visibleItems = useMemo(() => {
    if (isAdmin) return items;
    return items.filter(i =>
      i.userId === user.uid ||
      (!!appUser.department && departmentByUserId[i.userId] === appUser.department)
    );
  }, [items, isAdmin, departmentByUserId, appUser.department, user.uid]);

  const dueSoonItems = useMemo(
    () => visibleItems.filter(i => i.status !== 'Closed' && isDueSoon(i.deadline)),
    [visibleItems]
  );

  // Load tasks for linking
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'tasks'), snap => {
      setTasks(snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Task)));
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    return visibleItems.filter(i => {
      if (search && !globalSearch(i, search)) return false;
      if (statusFilter !== 'All' && i.status !== statusFilter) return false;
      if (deptFilter !== 'All' && i.department !== deptFilter) return false;
      if (dateFilter && i.dateReceived !== dateFilter) return false;
      return true;
    });
  }, [visibleItems, search, statusFilter, deptFilter, dateFilter]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, deptFilter, dateFilter]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filtered.slice(startIndex, startIndex + itemsPerPage);
  }, [filtered, currentPage]);

  const stats = useMemo(() => ({
    total: visibleItems.length,
    unread: visibleItems.filter(i => i.status === 'Unread').length,
    assigned: visibleItems.filter(i => i.status === 'Assigned').length,
    closed: visibleItems.filter(i => i.status === 'Closed').length,
  }), [visibleItems]);

  const dynamicDepartments = useMemo(() => {
    return DEPARTMENT_OPTIONS;
  }, []);

  const dynamicSubCategories = useMemo(() => {
    if (formData.category === 'Project') return PROJECT_OPTIONS;
    return Array.from(new Set(visibleItems.filter(i => i.department === formData.department).map(i => i.subCategory).filter(Boolean))).sort();
  }, [visibleItems, formData.department, formData.category]);

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
    } else {
      setEditing(null);
      setFormData(emptyForm());
    }
    setIsModalOpen(true);
  };

  const closeModal = () => { setIsModalOpen(false); setEditing(null); };

  const set = (f: string, v: any) => setFormData(p => ({ ...p, [f]: v }));

  const handleOtherSelection = (field: string, value: string) => {
    if (value === 'Other...') {
      const custom = prompt(`Enter custom value for ${field}:`);
      if (custom) {
        set(field, custom);
      }
    } else {
      set(field, value);
    }
  };

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
      alert('Max file size is 10MB.'); 
      return; 
    }

    setIsUploading(true);
    try {
      const driveUrl = await uploadToGoogleDrive(file);
      setFormData(p => ({ ...p, attachedFile: driveUrl, attachedFileName: file.name }));
    } catch (err: any) {
      console.error('Upload error:', err);
      alert('Failed to upload to Google Drive: ' + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data: any = {
      ...formData,
      userId: user.uid,
      teamId: appUser.teamId || 'NONE',
      updatedAt: serverTimestamp(),
    };
    if (!formData.attachedFile && editing) {
      data.attachedFile = deleteField();
      data.attachedFileName = deleteField();
    }
    try {
      let docId = editing?.id;
      if (editing) {
        await updateDoc(doc(db, 'correspondences', editing.id), data);
      } else {
        const serial = await getNextSerialNumber('correspondences');
        const docRef = await addDoc(collection(db, 'correspondences'), { ...data, serialNumber: serial, createdAt: serverTimestamp() });
        docId = docRef.id;
      }

      // Notify managers/admins if an employee added or updated a correspondence
      if (appUser.role === 'Employee') {
        const managers = projectUsers.filter(u => u.role === 'Manager' || u.role === 'Admin');
        for (const manager of managers) {
          await createNotification({
            type: editing ? 'correspondence_updated' : 'correspondence_added',
            title: editing ? 'Correspondence Updated' : 'New Correspondence',
            message: `${appUser.displayName} ${editing ? 'updated' : 'added'} correspondence "${formData.subject}"`,
            forUserId: manager.id,
            read: false,
            relatedId: docId,
            createdAt: serverTimestamp(),
          }, projectUsers);
        }
      }

      // Reassignment logic: update linked task if exists
      if (editing && editing.convertedToTaskId && editing.assignedToId !== formData.assignedToId) {
        await updateDoc(doc(db, 'tasks', editing.convertedToTaskId), {
          assignedTo: formData.assignedTo,
          assignedToId: formData.assignedToId,
          updatedAt: serverTimestamp(),
        });

        // Notify new assignee
        if (formData.assignedToId) {
          await createNotification({
            type: 'task_assigned',
            title: 'Task Reassigned',
            message: `The task for "${formData.subject}" has been reassigned to you by ${appUser.displayName}`,
            forUserId: formData.assignedToId,
            read: false,
            relatedId: editing.convertedToTaskId,
            createdAt: serverTimestamp(),
          }, projectUsers);
        }
      }

      closeModal();
    } catch (err) {
      handleFirestoreError(err, editing ? OperationType.UPDATE : OperationType.CREATE, 'correspondences');
      setError('Failed to save.');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'correspondences', deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `correspondences/${deleteTarget.id}`);
      setError('Delete failed.');
    }
  };

  return (
    <div style={{ padding: '20px 0', minHeight: '60vh' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Correspondences
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Log incoming documents — managers will review and assign them as tasks.
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Total', value: stats.total, cls: 'stat-indigo' },
          { label: 'Unread', value: stats.unread, cls: 'stat-amber' },
          { label: 'Assigned', value: stats.assigned, cls: 'stat-sky' },
          { label: 'Closed', value: stats.closed, cls: 'stat-green' },
        ].map(s => (
          <div key={s.label} className={`card ${s.cls}`} style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>{s.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: 'var(--text-muted)' }} />
          <input
            className="input"
            style={{ paddingLeft: 40 }}
            placeholder="Search subject or sender…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
            {['Unread', 'Reviewing', 'Assigned', 'Closed'].map(s => <option key={s}>{s}</option>)}
          </select>

          <select className="input" style={{ width: 'auto' }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="All">All Departments</option>
            {DEPARTMENT_OPTIONS.filter(d => d !== 'None' && d !== 'Other...').map(d => <option key={d}>{d}</option>)}
          </select>
        </div>

        <button className="btn btn-primary" onClick={() => openModal()}>
          <Plus className="w-4 h-4" /> New Corresponding
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 0, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', fontSize: 14 }}>
          <AlertCircle className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}><X className="w-4 h-4" /></button>
        </div>
      )}

      <DueSoonBanner
        items={dueSoonItems.map(i => ({
          id: i.id,
          type: 'Correspondence' as const,
          title: i.subject,
          due: i.deadline,
          onClick: () => setSelectedCorrForDetails(i),
        }))}
      />

      {/* Items grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        <AnimatePresence>
          {filtered.slice((currentPage - 1) * 20, currentPage * 20).map(item => (
            <motion.div
              layout
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
               className="card card-interactive"
               style={{ 
                 padding: '24px', 
                 cursor: 'pointer',
                 borderLeft: isDueSoon(item.deadline) && item.status !== 'Closed' 
                   ? '4px solid #f97316' 
                   : `4px solid ${(() => {
                     const u = projectUsers.find(pu => pu.id === item.assignedToId);
                     return u?.userColor || getUserColor(item.assignedToId || item.userId || '');
                   })()}`,
                 backgroundColor: isDueSoon(item.deadline) && item.status !== 'Closed' ? '#fffcf9' : 'var(--surface)'
               }}
              onClick={() => setSelectedCorrForDetails(item)}
            >
              {/* Top row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span className={statusBadgeClass(item.status)}>{item.status}</span>
                  <span className={priorityBadgeClass(item.priority)}>{item.priority}</span>
                  {item.category && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', padding: '3px 10px',
                      borderRadius: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      background: item.category === 'Project' ? '#dbeafe' : item.category === 'External' ? '#dcfce7' : '#f3e8ff',
                      color: item.category === 'Project' ? '#1d4ed8' : item.category === 'External' ? '#15803d' : '#6d28d9',
                    }}>{item.category}</span>
                  )}
                   {item.actions && item.actions !== 'None' && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', padding: '3px 10px',
                      borderRadius: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                      textTransform: 'uppercase', background: '#fee2e2', color: '#dc2626',
                      border: '1px solid #fecaca'
                    }}>{item.actions}</span>
                  )}
                  {isOverdue(item.deadline) && item.status !== 'Closed' && (
                    <span className="badge badge-urgent">OVERDUE</span>
                  )}
                  {isDueSoon(item.deadline) && item.status !== 'Closed' && (
                    <span className="badge" style={{ background: '#f97316', color: '#fff' }}>DUE SOON</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={e => { e.stopPropagation(); openModal(item, false); }}
                    title="Edit"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="btn btn-danger btn-icon btn-sm"
                    onClick={e => { e.stopPropagation(); setDeleteTarget(item); }}
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                {item.serialNumber && (
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                    #{item.serialNumber}
                  </span>
                )}
                <h3 style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4 }}>{item.subject}</h3>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.body}</p>

              {/* Meta */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <Building2 className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
                  {item.department}{item.subCategory ? ` › ${item.subCategory}` : ''}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <MailOpen className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
                  From: {item.sentFrom}
                </div>
                {item.deadline && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#fbbf24' }}>
                    <Calendar className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
                    Deadline: {item.deadline}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {(() => {
                      const u = projectUsers.find(pu => pu.id === item.userId);
                      return u?.photoURL ? (
                        <img src={u.photoURL} className="avatar" style={{ width: 14, height: 14, objectFit: 'cover', opacity: 0.8 }} alt="" />
                      ) : (
                        <span style={{ width: 8, height: 8, borderRadius: 0, background: u?.userColor || getUserColor(item.userId), opacity: 0.6 }} />
                      );
                    })()}
                    Logged by {projectUsers.find(u => u.id === item.userId)?.displayName || 'Unknown'}
                  </span>
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
                      Assigned to: {item.assignedTo}
                    </span>
                  )}
                  <button 
                    className="btn btn-ghost btn-sm" 
                    style={{ marginLeft: 'auto', padding: '2px 8px', height: 'auto', minHeight: 'auto', fontSize: 10, fontWeight: 700 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCorrForDetails(item);
                    }}
                  >
                    FULL DETAILS
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Pagination Controls */}
      {Math.ceil(filtered.length / 20) > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 24, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
          <button 
            className="btn btn-ghost btn-sm" 
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => prev - 1)}
          >
            Previous
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {Array.from({ length: Math.ceil(filtered.length / 20) }, (_, i) => i + 1).map(p => (
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
            disabled={currentPage === Math.ceil(filtered.length / 20)}
            onClick={() => setCurrentPage(prev => prev + 1)}
          >
            Next
          </button>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">
            <MailOpen style={{ width: 28, height: 28 }} />
          </div>
          <p className="empty-state-title">No correspondences found</p>
          <p className="empty-state-sub">No items match your filters, or nothing has been logged yet.<br />Use the button above to add a new correspondence.</p>
        </div>
      )}

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
                        {isViewing ? 'View' : editing ? 'Editing' : 'New'}
                      </span>
                      {(editing || isViewing) && formData.serialNumber && (
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                          #{formData.serialNumber}
                        </span>
                      )}
                      {isViewing && formData.status && (
                        <span className={statusBadgeClass(formData.status)} style={{ fontSize: 11 }}>
                          {formData.status}
                        </span>
                      )}
                    </div>
                    <h2 style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                      {isViewing ? (formData.subject || 'Correspondence Details') : (editing ? 'Edit Correspondence' : 'New Correspondence')}
                    </h2>
                    {isViewing && formData.sentFrom && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>From: {formData.sentFrom}</div>
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
                    <label className="input-label">Subject</label>
                    {isViewing ? (
                      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4 }}>{formData.subject}</div>
                    ) : (
                      <input className="input" style={{ fontSize: 16, fontWeight: 600 }} value={formData.subject} onChange={e => set('subject', e.target.value)} placeholder="Correspondence subject…" />
                    )}
                  </div>
                  {/* Body */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="input-label">Body / Description</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{formData.body}</div>
                    ) : (
                      <textarea className="input" rows={3} value={formData.body} onChange={e => set('body', e.target.value)} placeholder="Describe the content of the correspondence…" />
                    )}
                  </div>
                  {/* Sent From */}
                  <div>
                    <label className="input-label">Sent From</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>{formData.sentFrom}</div>
                    ) : (
                      <input className="input" value={formData.sentFrom} onChange={e => set('sentFrom', e.target.value)} placeholder="Organization or person…" />
                    )}
                  </div>
                  {/* Category */}
                  <div>
                    <label className="input-label">Category</label>
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
                              <button
                                key={c} type="button"
                                onClick={() => isOther ? set('category', '') : set('category', c)}
                                style={{
                                  flex: '1 0 auto', padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 0, border: 'none', cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                  background: isActive ? 'var(--accent)' : 'transparent',
                                  color: isActive ? '#fff' : 'var(--text-muted)',
                                  transition: 'all 0.15s'
                                }}
                              >
                                {c}
                              </button>
                            );
                          })}
                        </div>
                        {!CATEGORY_OPTIONS.filter(c => c !== 'Other...').includes(formData.category) && (
                          <input
                            className="input"
                            placeholder="Type custom category..."
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
                    <label className="input-label">Priority</label>
                    {isViewing ? (
                      <span className={priorityBadgeClass(formData.priority)}>{formData.priority}</span>
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
                            {p}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  </div>{/* end grid: Core */}
                </div>{/* end section: Core */}

                {/* ── Section: Classification ── */}
                <div style={{ borderTop: '1px solid var(--border)', padding: '16px 24px 0', marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>Classification</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
                  {/* Department */}
                  <div>
                    <label className="input-label">Department</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{formData.department}</div>
                    ) : (
                      <>
                        <input
                          className="input"
                          list="corrDepartmentList"
                          placeholder="Select or type department..."
                          value={formData.department === 'None' ? '' : formData.department}
                          onChange={e => { set('department', e.target.value || 'None'); set('subCategory', 'None'); }}
                        />
                        <datalist id="corrDepartmentList">
                          {DEPARTMENT_OPTIONS.filter(d => d !== 'None' && d !== 'Other...').map(d => <option key={d} value={d} />)}
                        </datalist>
                      </>
                    )}
                  </div>
                  {/* Sub-category */}
                  <div>
                    <label className="input-label">Sub-Category / Project</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{formData.subCategory || 'None'}</div>
                    ) : (
                      <>
                        <input 
                          className="input" 
                          list="corrSubCategoryList"
                          placeholder="Search or type project..."
                          value={formData.subCategory} 
                          onChange={e => set('subCategory', e.target.value)} 
                        />
                        <datalist id="corrSubCategoryList">
                          {dynamicSubCategories.map(s => <option key={s} value={s} />)}
                        </datalist>
                      </>
                    )}
                  </div>
                  {/* Actions */}
                  <div>
                    <label className="input-label">Actions</label>
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
                          >{a}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  </div>{/* end grid: Classification */}
                </div>{/* end section: Classification */}

                {/* ── Section: Workflow ── */}
                <div style={{ borderTop: '1px solid var(--border)', padding: '16px 24px 0', marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>Workflow</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
                  {/* Date received */}
                  <div>
                    <label className="input-label">Date Received</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{formData.dateReceived}</div>
                    ) : (
                      <input className="input" type="date" value={formData.dateReceived} onChange={e => set('dateReceived', e.target.value)} />
                    )}
                  </div>
                  {/* Deadline */}
                  <div>
                    <label className="input-label">Deadline</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: formData.deadline ? '#fbbf24' : 'var(--text-muted)' }}>{formData.deadline || 'No deadline'}</div>
                    ) : (
                      <input className="input" type="date" value={formData.deadline} onChange={e => set('deadline', e.target.value)} />
                    )}
                  </div>
                  {/* Status */}
                  <div>
                    <label className="input-label">Status</label>
                    {isViewing ? (
                      <span className={statusBadgeClass(formData.status)}>{formData.status}</span>
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
                              {s}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className={statusBadgeClass(formData.status)}>{formData.status}</span>
                      )
                    )}
                  </div>
                  <div>
                    <label className="input-label">Assignee</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>
                        {formData.assignedTo || 'Unassigned'}
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
                        <option value="">— Unassigned —</option>
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
                    )}
                  </div>
                  </div>{/* end grid: Workflow */}
                </div>{/* end section: Workflow */}

                {/* ── Section: Files & Notes ── */}
                <div style={{ borderTop: '1px solid var(--border)', padding: '16px 24px 0', marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>Files & Notes</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                  {/* Shared Folder Paths */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <label className="input-label" style={{ marginBottom: 0 }}>Shared Folder Paths (Computer/Local)</label>
                      {!isViewing && (
                        <button 
                          type="button" 
                          className="btn btn-ghost btn-sm" 
                          onClick={() => set('filePaths', [...(formData.filePaths || []), ''])}
                          style={{ fontSize: 11 }}
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Path
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
                                title={path ? 'Click to open (web link) or copy this path' : undefined}
                                style={{ flex: 1, wordBreak: 'break-all', fontSize: 12, cursor: path ? 'pointer' : 'default', textDecoration: path ? 'underline' : 'none', textDecorationStyle: 'dotted' }}
                              >{path || 'Empty path'}</code>
                              <button 
                                type="button"
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => copyToClipboard(path)}
                                title="Copy Path"
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
                                  newPaths[idx] = e.target.value;
                                  set('filePaths', newPaths);
                                }} 
                                placeholder="e.g. \\SERVER\Documents\ProjectA" 
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
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No folder paths added.</p>
                      )}
                    </div>
                  </div>

                  {/* File */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="input-label">Attachment</label>
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
                                alt="Attachment" 
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
                                <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{formData.attachedFileName || 'Attached Image'}</span>
                                <a 
                                  href={formData.attachedFile} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="btn btn-sm"
                                  style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)' }}
                                >
                                  <Download className="w-3.5 h-3.5" /> Download
                                </a>
                              </div>
                            </div>
                          ) : (
                            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div style={{ width: 40, height: 40, borderRadius: 0, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                                <Paperclip className="w-5 h-5" />
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{formData.attachedFileName || 'Attachment'}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click to view or download</div>
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
                        <div style={{ fontSize: 14, color: 'var(--text-muted)', fontStyle: 'italic' }}>No attachment</div>
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
                          <span>{isUploading ? 'Uploading to Drive…' : 'Click to attach a file'}</span>
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
                                <img src={getGoogleDrivePreviewUrl(formData.attachedFile)} alt="Preview" style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 0, display: 'block' }} />
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {/* Notes */}
                  <div>
                    <label className="input-label">Manager Notes / Internal Comments</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', background: 'var(--surface-2)', padding: '12px 16px', borderRadius: 0, border: '1px solid var(--border)', fontStyle: 'italic', lineHeight: 1.6 }}>
                        {formData.notes || 'No notes available.'}
                      </div>
                    ) : (
                      <textarea className="input" rows={2} value={formData.notes} onChange={e => set('notes', e.target.value)} placeholder="Add internal notes or instructions…" />
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
                      <button type="button" className="btn btn-ghost" onClick={closeModal}>Close</button>
                      <button 
                        type="button" 
                        className="btn btn-primary" 
                        onClick={() => setIsViewing(false)}
                        style={{ gap: 8 }}
                      >
                        <Edit2 className="w-4 h-4" /> Edit Details
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                      <button type="submit" className="btn btn-primary" disabled={isUploading}>
                        {editing ? 'Save Changes' : 'Create Corresponding'}
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
                <h3 style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', marginBottom: 10 }}>Delete Corresponding?</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
                  "<strong style={{ color: 'var(--text-secondary)' }}>{deleteTarget.subject}</strong>" will be permanently deleted.
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
                  <button className="btn btn-danger" onClick={confirmDelete}>Delete</button>
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
              style={{ width: '100%', maxWidth: 700, maxHeight: '90vh', overflowY: 'auto', padding: 0, display: 'flex', flexDirection: 'column' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div style={{ padding: '24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'var(--surface-3)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    <span className={statusBadgeClass(selectedCorrForDetails.status)}>{selectedCorrForDetails.status}</span>
                    <span className={priorityBadgeClass(selectedCorrForDetails.priority)}>{selectedCorrForDetails.priority} Priority</span>
                    <span style={{ padding: '4px 12px', borderRadius: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: selectedCorrForDetails.category === 'Project' ? 'rgba(59,130,246,0.15)' : selectedCorrForDetails.category === 'External' ? 'rgba(34,197,94,0.15)' : 'rgba(139,92,246,0.15)',
                      color: selectedCorrForDetails.category === 'Project' ? '#3b82f6' : selectedCorrForDetails.category === 'External' ? '#22c55e' : '#8b5cf6',
                      display: 'flex', alignItems: 'center', gap: 4
                    }}>
                       {selectedCorrForDetails.category}
                    </span>
                  </div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0, lineHeight: 1.3 }}>{selectedCorrForDetails.subject}</h2>
                  {selectedCorrForDetails.serialNumber && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginTop: 4, letterSpacing: '0.02em' }}>
                      REF: {selectedCorrForDetails.serialNumber}
                    </div>
                  )}
                </div>
                <button 
                  onClick={() => setSelectedCorrForDetails(null)} 
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 16 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <X className="w-6 h-6 text-muted" />
                </button>
              </div>
              
              {/* Modal Body */}
              <div style={{ padding: '32px', flex: 1 }}>
                <div style={{ marginBottom: 32 }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                     <FileText className="w-4 h-4 text-primary" />
                     <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Correspondence Body</h3>
                   </div>
                   <div style={{ padding: '20px', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 0, color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                    {selectedCorrForDetails.body || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>No content provided.</span>}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 32 }}>
                  <div className="card-minimal" style={{ padding: '16px', background: 'var(--surface-3)', border: 'none' }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>Sent From</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                      <Building2 className="w-4 h-4 text-muted" />
                      {selectedCorrForDetails.sentFrom}
                    </div>
                    {selectedCorrForDetails.department && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginLeft: 24 }}>{selectedCorrForDetails.department}</div>
                    )}
                  </div>

                  <div className="card-minimal" style={{ padding: '16px', background: 'var(--surface-3)', border: 'none' }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>Dates</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Calendar className="w-4 h-4 text-muted" />
                        Received: {selectedCorrForDetails.dateReceived}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: isOverdue(selectedCorrForDetails.deadline) && selectedCorrForDetails.status !== 'Closed' ? '#dc2626' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Clock className="w-4 h-4 text-muted" />
                        Deadline: {selectedCorrForDetails.deadline || 'None'}
                      </div>
                    </div>
                  </div>

                  <div className="card-minimal" style={{ padding: '16px', background: 'var(--surface-3)', border: 'none' }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>Assignment</span>
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
                              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedCorrForDetails.assignedTo || 'Unassigned'}</div>
                              {selectedCorrForDetails.assignedAt && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Assigned Recently</div>
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
                      <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shared Folders / Links</h3>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {selectedCorrForDetails.filePaths.map((path, idx) => (
                        <div key={idx} style={{ padding: '10px 14px', background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span
                            onClick={() => openOrCopyPath(path)}
                            title="Click to open (web link) or copy this path"
                            style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                          >{path}</span>
                          <button
                            onClick={() => openOrCopyPath(path)}
                            title="Open (web link) or copy this path"
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '4px 8px', height: 'auto', minHeight: 'auto' }}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedCorrForDetails.attachedFile && (
                  <div style={{ marginBottom: 32 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Paperclip className="w-4 h-4 text-primary" />
                      <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Attachment</h3>
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
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedCorrForDetails.attachedFileName || 'View Attachment'}</div>
                        <div style={{ fontSize: 11, opacity: 0.8 }}>Click to open in new tab</div>
                      </div>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                )}

                {tasks.find(t => t.correspondingId === selectedCorrForDetails.id || t.id === selectedCorrForDetails.convertedToTaskId) && (
                   <button 
                    className="btn btn-primary w-full" 
                    style={{ marginTop: 8, gap: 10, height: 48 }}
                    onClick={() => {
                      const t = tasks.find(t => t.correspondingId === selectedCorrForDetails.id || t.id === selectedCorrForDetails.convertedToTaskId);
                      if (t) {
                        setSelectedCorrForDetails(null);
                        onNavigate('tasks'); // Corrected from 'Tasks' to match AppView type
                      }
                    }}
                   >
                     <Edit2 className="w-4 h-4" /> View Linked Task
                   </button>
                )}
                
                <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
                  <button 
                    className="btn btn-ghost w-full" 
                    onClick={() => {
                      setSelectedCorrForDetails(null);
                      openModal(selectedCorrForDetails, false);
                    }}
                  >
                    Edit Correspondence
                  </button>
                  <button className="btn btn-ghost w-full" onClick={() => setSelectedCorrForDetails(null)}>Close</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
