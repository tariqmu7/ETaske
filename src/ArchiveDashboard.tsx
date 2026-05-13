import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, onSnapshot, updateDoc,
  doc, serverTimestamp, orderBy, where
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { User } from 'firebase/auth';
import { AppUser, Task, Milestone, OperationType } from './types';
import {
  Archive, Search, Filter, ChevronDown, CheckCircle2, Calendar,
  Link2, Target, X, AlertCircle, Eye, TrendingUp, Paperclip, Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { globalSearch, getGoogleDrivePreviewUrl } from './utils';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
}

export default function ArchiveDashboard({ user, appUser, projectUsers }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [search, setSearch] = useState('');
  const [viewingTask, setViewingTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const isAdmin = appUser.role === 'Admin' || appUser.role === 'Manager';
    const q = isAdmin
      ? query(collection(db, 'tasks'), where('status', 'in', ['Done', 'Archived']), orderBy('updatedAt', 'desc'))
      : query(collection(db, 'tasks'), where('teamId', '==', appUser.teamId || 'NONE'), where('status', 'in', ['Done', 'Archived']), orderBy('updatedAt', 'desc'));

    const unsub = onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
    }, err => { console.error(err); setError('Failed to load archive.'); });
    return () => unsub();
  }, [appUser]);

  useEffect(() => {
    const q = query(collection(db, 'milestones'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setMilestones(snap.docs.map(d => ({ id: d.id, ...d.data() } as Milestone)));
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (search && !globalSearch(t, search)) return false;
      return true;
    });
  }, [tasks, search]);

  const getTaskMilestones = (taskId: string) => milestones.filter(m => m.taskId === taskId);

  const handleArchive = async (taskId: string) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), { status: 'Archived', archivedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setViewingTask(null);
    } catch (err) {
      console.error(err);
      setError('Failed to archive.');
    }
  };

  return (
    <div style={{ padding: '4px 0', minHeight: '60vh' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Archive
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Completed tasks with full corresponding history and milestone records.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Completed Tasks', value: tasks.length, cls: 'stat-green' },
          { label: 'Total Milestones', value: milestones.filter(m => tasks.some(t => t.id === m.taskId)).length, cls: 'stat-indigo' },
          { label: 'With Corresponding', value: tasks.filter(t => t.correspondingId).length, cls: 'stat-sky' },
        ].map(s => (
          <div key={s.label} className={`card ${s.cls}`} style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)' }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 24, maxWidth: 400 }}>
        <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'var(--text-muted)' }} />
        <input className="input" style={{ paddingLeft: 36 }} placeholder="Search archived tasks…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, color: '#f87171', fontSize: 14 }}>
          <AlertCircle className="w-4 h-4" /> {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#f87171' }}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        <AnimatePresence>
          {filtered.map(task => {
            const taskMilestones = getTaskMilestones(task.id);
            const done = taskMilestones.filter(m => m.status === 'Done').length;
            return (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="card"
                style={{ padding: 24 }}
              >
                {/* Status badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span className={`badge ${task.status === 'Archived' ? 'badge-archived' : 'badge-done'}`}>
                    {task.status === 'Archived' ? <Archive className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />} {task.status}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{task.updatedAt?.toDate?.()?.toLocaleDateString?.() || ''}</span>
                </div>

                <h3 style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 6 }}>{task.taskName}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{task.description}</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
                  {task.assignedTo && <span>👤 {task.assignedTo}</span>}
                  {task.assignedBy && <span>📋 Assigned by {task.assignedBy}</span>}
                  {task.correspondingSubject && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Link2 className="w-3 h-3" /> {task.correspondingSubject}
                    </span>
                  )}
                  {task.attachedFile && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--accent)', marginTop: 4 }}>
                      <Paperclip className="w-3 h-3" />
                      <a href={task.attachedFile} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>
                        {task.attachedFileName || 'Attachment'}
                      </a>
                    </div>
                  )}
                </div>

                {/* Milestones summary */}
                {taskMilestones.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      <span><Target className="w-3 h-3" style={{ display: 'inline', marginRight: 4 }} />{done}/{taskMilestones.length} milestones</span>
                      <span>{Math.round((done / taskMilestones.length) * 100)}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${Math.round((done / taskMilestones.length) * 100)}%` }} />
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setViewingTask(task)}>
                    <Eye className="w-3.5 h-3.5" /> View Details
                  </button>
                  {task.status === 'Done' && (
                    <button className="btn btn-sm" style={{ background: 'rgba(100,116,139,0.15)', color: '#94a3b8', border: '1px solid rgba(100,116,139,0.2)' }} onClick={() => handleArchive(task.id)} title="Archive Task">
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
          <Archive style={{ width: 48, height: 48, margin: '0 auto 16px', opacity: 0.3 }} />
          <p style={{ fontSize: 15, fontWeight: 600 }}>Archive is empty</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>Completed tasks will appear here.</p>
        </div>
      )}

      {/* Detail modal */}
      <AnimatePresence>
        {viewingTask && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setViewingTask(null)}>
            <motion.div className="modal" style={{ maxWidth: 600 }} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '24px 28px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)' }}>Task Details</h2>
                <button className="btn btn-ghost btn-icon" onClick={() => setViewingTask(null)}><X className="w-4 h-4" /></button>
              </div>
              <div style={{ padding: '20px 28px 28px' }}>
                <h3 style={{ fontWeight: 800, fontSize: 20, color: 'var(--text-primary)', marginBottom: 12 }}>{viewingTask.taskName}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>{viewingTask.description}</p>

                {viewingTask.correspondingSubject && (
                  <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Source Corresponding</div>
                    <div style={{ fontSize: 14, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Link2 className="w-4 h-4" /> {viewingTask.correspondingSubject}
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
                  {[
                    { label: 'Assigned To', value: viewingTask.assignedTo },
                    { label: 'Assigned By', value: viewingTask.assignedBy },
                    { label: 'Priority', value: viewingTask.priority },
                    { label: 'Due Date', value: viewingTask.dueDate },
                  ].filter(i => i.value).map(i => (
                    <div key={i.label} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{i.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{i.value}</div>
                    </div>
                  ))}
                </div>

                {viewingTask.attachedFile && (
                  <div style={{ 
                    marginBottom: 24, 
                    borderRadius: 16, 
                    overflow: 'hidden', 
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
                  }}>
                    {(viewingTask.attachedFile.includes('image') || viewingTask.attachedFile.includes('google.com')) ? (
                      <div style={{ position: 'relative', background: 'var(--surface-3)', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        <img 
                          src={getGoogleDrivePreviewUrl(viewingTask.attachedFile)} 
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
                          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{viewingTask.attachedFileName || 'Attached Image'}</span>
                          <a 
                            href={viewingTask.attachedFile} 
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
                        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                          <Paperclip className="w-5 h-5" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{viewingTask.attachedFileName || 'Attachment'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click to view or download</div>
                        </div>
                        <a 
                          href={viewingTask.attachedFile} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="btn btn-ghost btn-sm"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* Milestone history */}
                {getTaskMilestones(viewingTask.id).length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>Milestone History</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {getTaskMilestones(viewingTask.id).map(ms => (
                        <div key={ms.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-2)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border)' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: ms.status === 'Done' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: ms.status === 'Done' ? 'line-through' : 'none' }}>{ms.title}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>By {ms.addedBy}{ms.targetDate ? ` · ${ms.targetDate}` : ''}</div>
                          </div>
                          <span className={`badge ${ms.status === 'Done' ? 'badge-done' : ms.status === 'In Progress' ? 'badge-inprogress' : ms.status === 'Blocked' ? 'badge-urgent' : 'badge-pending'}`}>{ms.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
