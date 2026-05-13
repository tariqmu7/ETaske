/// <reference types="vite/client" />
import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy, where, deleteField
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { User } from 'firebase/auth';
import {
  AppUser, Corresponding, CorrespondingStatus,
  DEPARTMENT_OPTIONS, PROJECT_OPTIONS, PRIORITY_OPTIONS, OperationType, FirestoreErrorInfo,
  CATEGORY_OPTIONS, CorrespondingCategory
} from './types';
import { getNextSerialNumber } from './lib/counters';
import {
  Plus, Search, Filter, X, AlertCircle, MailOpen, ChevronDown,
  Paperclip, Calendar, Download, Trash2, Edit2, Clock, Building2, Tag
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { globalSearch, getUserColor, getGoogleDrivePreviewUrl } from './utils';
import { AppView } from './App';

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

  // Firestore listener
  useEffect(() => {
    const isManager = appUser.role === 'Admin' || appUser.role === 'Manager';
    const q = isManager
      ? query(collection(db, 'correspondences'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'correspondences'), where('teamId', '==', appUser.teamId || 'NONE'), orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as Corresponding)));
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'correspondences');
      setError('Failed to load correspondences.');
    });
    return () => unsub();
  }, [appUser]);

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (search && !globalSearch(i, search)) return false;
      if (statusFilter !== 'All' && i.status !== statusFilter) return false;
      if (deptFilter !== 'All' && i.department !== deptFilter) return false;
      if (dateFilter && i.dateReceived !== dateFilter) return false;
      return true;
    });
  }, [items, search, statusFilter, deptFilter, dateFilter]);

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
    total: items.length,
    unread: items.filter(i => i.status === 'Unread').length,
    assigned: items.filter(i => i.status === 'Assigned').length,
    closed: items.filter(i => i.status === 'Closed').length,
  }), [items]);

  const dynamicDepartments = useMemo(() => {
    return DEPARTMENT_OPTIONS;
  }, []);

  const dynamicSubCategories = useMemo(() => {
    if (formData.category === 'Project') return PROJECT_OPTIONS;
    return Array.from(new Set(items.filter(i => i.department === formData.department).map(i => i.subCategory).filter(Boolean))).sort();
  }, [items, formData.department, formData.category]);

  const openModal = (item?: Corresponding, viewing = false) => {
    setIsViewing(viewing);
    if (item) {
      setEditing(item);
      setFormData({
        subject: item.subject, body: item.body, sentFrom: item.sentFrom,
        department: item.department, subCategory: item.subCategory || '',
        category: item.category || 'Internal',
        priority: item.priority, dateReceived: item.dateReceived, deadline: item.deadline || '',
        attachedFile: item.attachedFile || '', attachedFileName: item.attachedFileName || '',
        serialNumber: item.serialNumber || '', notes: item.notes || '', status: item.status,
        assignedTo: item.assignedTo || '', assignedToId: item.assignedToId || '',
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
          await addDoc(collection(db, 'notifications'), {
            type: editing ? 'correspondence_updated' : 'correspondence_added',
            title: editing ? 'Correspondence Updated' : 'New Correspondence',
            message: `${appUser.displayName} ${editing ? 'updated' : 'added'} correspondence "${formData.subject}"`,
            forUserId: manager.id,
            read: false,
            relatedId: docId,
            createdAt: serverTimestamp(),
          });
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
          await addDoc(collection(db, 'notifications'), {
            type: 'task_assigned',
            title: 'Task Reassigned',
            message: `The task for "${formData.subject}" has been reassigned to you by ${appUser.displayName}`,
            forUserId: formData.assignedToId,
            read: false,
            relatedId: editing.convertedToTaskId,
            createdAt: serverTimestamp(),
          });
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
            {DEPARTMENT_OPTIONS.map(d => <option key={d}>{d}</option>)}
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
                borderLeft: `4px solid ${(() => {
                  const u = projectUsers.find(pu => pu.id === item.assignedToId);
                  return u?.userColor || getUserColor(item.assignedToId || item.userId || '');
                })()}`
              }}
              onClick={() => openModal(item, true)}
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
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap', marginTop: 12 }}>
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
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
          <MailOpen style={{ width: 48, height: 48, margin: '0 auto 16px', opacity: 0.3 }} />
          <p style={{ fontSize: 15, fontWeight: 600 }}>No correspondences found</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>Log a new incoming document to get started.</p>
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeModal}>
            <motion.div className="modal" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} onClick={e => e.stopPropagation()}>
              {/* Modal header */}
              <div style={{ padding: '24px 28px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontWeight: 800, fontSize: 20, color: 'var(--text-primary)' }}>
                  {isViewing ? 'Correspondence Details' : (editing ? 'Edit Corresponding' : 'New Corresponding')}
                </h2>
                <button className="btn btn-ghost btn-icon" onClick={closeModal}><X className="w-4 h-4" /></button>
              </div>

              <form onSubmit={handleSubmit} style={{ padding: '20px 28px 28px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24 }}>
                  {/* Subject */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="input-label">Subject</label>
                    {isViewing ? (
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{formData.subject}</div>
                    ) : (
                      <input className="input" value={formData.subject} onChange={e => set('subject', e.target.value)} placeholder="Correspondence subject…" />
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
                      <div style={{ display: 'flex', gap: 4, background: 'var(--surface-3)', padding: 2, borderRadius: 0, border: '1px solid var(--border)', width: 'fit-content' }}>
                        {CATEGORY_OPTIONS.map(c => (
                          <button
                            key={c} type="button"
                            onClick={() => handleOtherSelection('category', c)}
                            style={{
                              padding: '4px 12px', fontSize: 13, fontWeight: 600, borderRadius: 0, border: 'none', cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              background: formData.category === c ? 'var(--accent)' : 'transparent',
                              color: formData.category === c ? '#fff' : 'var(--text-muted)',
                              transition: 'all 0.15s'
                            }}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Priority */}
                  <div>
                    <label className="input-label">Priority</label>
                    {isViewing ? (
                      <span className={priorityBadgeClass(formData.priority)}>{formData.priority}</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, background: 'var(--surface-3)', padding: 2, borderRadius: 0, border: '1px solid var(--border)', width: 'fit-content', flexWrap: 'wrap' }}>
                        {PRIORITY_OPTIONS.map(p => (
                          <button
                            key={p} type="button"
                            onClick={() => set('priority', p)}
                            style={{
                              padding: '4px 12px', fontSize: 13, fontWeight: 600, borderRadius: 0, border: 'none', cursor: 'pointer',
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
                  {/* Department */}
                  <div>
                    <label className="input-label">Department</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{formData.department}</div>
                    ) : (
                      <select className="input" value={formData.department} onChange={e => { handleOtherSelection('department', e.target.value); set('subCategory', 'None'); }}>
                        {DEPARTMENT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
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
                    {isViewing ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', padding: '4px 12px',
                        borderRadius: 0, fontSize: 12, fontWeight: 700,
                        background: '#fee2e2', color: '#dc2626',
                        border: '1px solid #fecaca'
                      }}>{formData.actions}</span>
                    ) : (
                      <select className="input" value={formData.actions} onChange={e => set('actions', e.target.value)}>
                        {['None', 'For info', 'SR for approval', 'Action needed'].map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    )}
                  </div>
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
                        <div style={{ display: 'flex', gap: 4, background: 'var(--surface-3)', padding: 2, borderRadius: 0, border: '1px solid var(--border)', width: 'fit-content', flexWrap: 'wrap' }}>
                          {(['Unread','Reviewing','Assigned','Closed'] as CorrespondingStatus[]).map(s => (
                            <button
                              key={s} type="button"
                              onClick={() => set('status', s)}
                              style={{
                                padding: '4px 12px', fontSize: 13, fontWeight: 600, borderRadius: 0, border: 'none', cursor: 'pointer',
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
                        <input type="file" onChange={handleFileUpload} style={{ color: 'var(--text-secondary)', fontSize: 13 }} />
                        {isUploading && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>Uploading to Drive…</div>}
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
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="input-label">Manager Notes / Internal Comments</label>
                    {isViewing ? (
                      <div style={{ fontSize: 14, color: 'var(--text-secondary)', background: 'var(--surface-2)', padding: '12px 16px', borderRadius: 0, border: '1px solid var(--border)', fontStyle: 'italic' }}>
                        {formData.notes || 'No notes available.'}
                      </div>
                    ) : (
                      <textarea className="input" rows={2} value={formData.notes} onChange={e => set('notes', e.target.value)} placeholder="Add internal notes or instructions…" />
                    )}
                  </div>
                  {/* Serial Number */}
                  {isViewing && formData.serialNumber && (
                    <div>
                      <label className="input-label">Serial Number</label>
                      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 800 }}>#{formData.serialNumber}</div>
                    </div>
                  )}
                </div>

                <div style={{ 
                  display: 'flex', 
                  gap: 10, 
                  marginTop: 32, 
                  justifyContent: 'flex-end', 
                  borderTop: '1px solid var(--border)', 
                  padding: '20px 28px',
                  background: 'var(--surface)',
                  position: 'sticky',
                  bottom: 0,
                  margin: '0 -28px -28px',
                  paddingBottom: 'calc(20px + var(--safe-area-bottom))',
                  zIndex: 10
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
    </div>
  );
}
