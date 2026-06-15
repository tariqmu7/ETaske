/// <reference types="vite/client" />
import React, { useState, useEffect, useMemo } from 'react';
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
import { globalSearch } from './utils';
import {
  Plus, Search, X, FolderKanban, Building2, Hash, Calendar,
  Trash2, Edit2, ChevronRight, AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ProjectDetail from './ProjectDetail';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
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

export default function ProjectsDashboard({ user, appUser, projectUsers }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [formData, setFormData] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setProjects(snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Project)));
      setLoading(false);
    }, err => {
      console.error('Projects listener error:', err, { uid: auth.currentUser?.uid });
      setError('Failed to load projects.');
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const visible = useMemo(() => {
    return projects.filter(p => {
      if (statusFilter !== 'All' && p.status !== statusFilter) return false;
      if (search && !globalSearch(p, search)) return false;
      return true;
    });
  }, [projects, search, statusFilter]);

  const selected = useMemo(() => projects.find(p => p.id === selectedId) || null, [projects, selectedId]);

  const openCreate = () => {
    setEditing(null);
    setFormData(emptyForm());
    setIsModalOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditing(p);
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
    if (!formData.name.trim()) { setError('Project name is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateDoc(doc(db, 'projects', editing.id), {
          ...formData,
          updatedAt: serverTimestamp(),
        });
      } else {
        const serialNumber = await getNextSerialNumber('projects');
        await addDoc(collection(db, 'projects'), {
          ...formData,
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
      setError('Failed to save project.');
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
      setError('Failed to delete project.');
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
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Projects</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus className="w-4 h-4" /> New Project
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fee2e2', color: '#991b1b', marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search className="w-4 h-4" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search projects…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 12px 10px 36px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit' }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit' }}
        >
          <option value="All">All statuses</option>
          {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {[0, 1, 2].map(i => <div key={i} className="card skeleton" style={{ height: 170 }} />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><FolderKanban className="w-8 h-8" /></div>
          <div className="empty-state-title">No projects yet</div>
          <div className="empty-state-sub">Create your first project to start tracking contracts, financials and updates.</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openCreate}>
            <Plus className="w-4 h-4" /> New Project
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          <AnimatePresence>
            {visible.map(p => (
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
                  <span className={statusBadgeClass(p.status)}>{p.status}</span>
                  <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-icon btn-sm" title="Edit" onClick={() => openEdit(p)}>
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" title="Delete" onClick={() => setDeleteTarget(p)}>
                      <Trash2 className="w-4 h-4" style={{ color: '#dc2626' }} />
                    </button>
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0, lineHeight: 1.3 }}>{p.name}</h3>
                  {p.serialNumber && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{p.serialNumber}</span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {p.client && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Building2 className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /> {p.client}{p.operator ? ` · ${p.operator}` : ''}</div>}
                  {p.code && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Hash className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /> {p.code}</div>}
                  {p.currentStatus && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Calendar className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /> {p.currentStatus}</div>}
                </div>

                <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {p.lastUpdateAt ? `Updated ${new Date(p.lastUpdateAt.seconds * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : ''}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                    Open <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Create / Edit modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                {editing ? 'Edit Project' : 'New Project'}
              </h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}><X className="w-5 h-5" /></button>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              <Field label="Project name *">
                <input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="proj-input" placeholder="e.g. Meleiha Gas Plant O&M Contract" />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Contract / Code"><input value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value })} className="proj-input" placeholder="4600002981" /></Field>
                <Field label="Status">
                  <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value as ProjectStatus })} className="proj-input">
                    {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Client"><input value={formData.client} onChange={e => setFormData({ ...formData, client: e.target.value })} className="proj-input" placeholder="AGIBA" /></Field>
                <Field label="Operator"><input value={formData.operator} onChange={e => setFormData({ ...formData, operator: e.target.value })} className="proj-input" placeholder="EPROM" /></Field>
              </div>
              <Field label="Location"><input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} className="proj-input" /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Start date"><input type="date" value={formData.startDate} onChange={e => setFormData({ ...formData, startDate: e.target.value })} className="proj-input" /></Field>
                <Field label="End date"><input type="date" value={formData.endDate} onChange={e => setFormData({ ...formData, endDate: e.target.value })} className="proj-input" /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Issue date"><input type="date" value={formData.issueDate} onChange={e => setFormData({ ...formData, issueDate: e.target.value })} className="proj-input" /></Field>
                <Field label="Rev."><input value={formData.rev} onChange={e => setFormData({ ...formData, rev: e.target.value })} className="proj-input" placeholder="0" /></Field>
              </div>
              <Field label="Description"><textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className="proj-input" rows={3} /></Field>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : (editing ? 'Save changes' : 'Create project')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>Delete project?</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 20px' }}>
              "{deleteTarget.name}" will be removed. Its contracts, financials and updates are not auto-deleted.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
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
