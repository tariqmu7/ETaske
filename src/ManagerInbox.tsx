import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, onSnapshot, addDoc, updateDoc,
  doc, serverTimestamp, orderBy, where, Timestamp
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { User } from 'firebase/auth';
import { AppUser, Corresponding, Task, PRIORITY_OPTIONS, OperationType } from './types';
import { getNextSerialNumber } from './lib/counters';
import {
  Inbox, UserCheck, ArrowRight, Bell, Clock, Calendar, Building2,
  AlertCircle, X, CheckCircle2, Users, Filter, Search, ChevronDown, Tag
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppView } from './App';
import { globalSearch } from './utils';

function handleFirestoreError(error: unknown, op: OperationType, path: string | null) {
  console.error('Firestore Error:', { error, op, path, uid: auth.currentUser?.uid });
}

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

export default function ManagerInbox({ user, appUser, projectUsers, onNavigate }: Props) {
  const [correspondences, setCorrespondences] = useState<Corresponding[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedCorr, setSelectedCorr] = useState<Corresponding | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [managerNote, setManagerNote] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('Unread');
  const [error, setError] = useState<string | null>(null);

  // Load unassigned correspondences
  useEffect(() => {
    if (!appUser || appUser.status !== 'Approved') return;
    
    const q = query(collection(db, 'correspondences'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setCorrespondences(snap.docs.map(d => ({ id: d.id, ...d.data() } as Corresponding)));
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'correspondences');
      setError('Connection to correspondences failed. Please refresh.');
    });
    return () => unsub();
  }, [appUser.status]);

  // Load tasks for overview
  useEffect(() => {
    if (!appUser || appUser.status !== 'Approved') return;

    const q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'tasks');
    });
    return () => unsub();
  }, [appUser.status]);

  const employees = projectUsers.filter(u => u.role === 'Employee' && u.status === 'Approved');

  const filtered = useMemo(() => {
    return correspondences.filter(c => {
      if (search && !globalSearch(c, search)) return false;
      if (filter !== 'All' && c.status !== filter) return false;
      return true;
    });
  }, [correspondences, search, filter]);

  const pendingCount = correspondences.filter(c => c.status === 'Unread' || c.status === 'Reviewing').length;

  const stats = useMemo(() => ({
    pending: correspondences.filter(c => c.status === 'Unread').length,
    reviewing: correspondences.filter(c => c.status === 'Reviewing').length,
    tasksActive: tasks.filter(t => t.status === 'In Progress' || t.status === 'Pending').length,
    tasksDone: tasks.filter(t => t.status === 'Done').length,
  }), [correspondences, tasks]);

  const handleAssign = async () => {
    if (!selectedCorr || !assigneeId) return;
    setIsAssigning(true);
    const employee = projectUsers.find(u => u.id === assigneeId);
    if (!employee) { setIsAssigning(false); return; }

    try {
      // 1. Mark corresponding as assigned
      await updateDoc(doc(db, 'correspondences', selectedCorr.id), {
        status: 'Assigned',
        assignedTo: employee.displayName,
        assignedToId: assigneeId,
        assignedAt: serverTimestamp(),
        notes: managerNote,
        updatedAt: serverTimestamp(),
      });

      // 2. Create a task from this corresponding
      const serial = await getNextSerialNumber('tasks');
      const taskRef = await addDoc(collection(db, 'tasks'), {
        taskName: selectedCorr.subject,
        description: selectedCorr.body,
        priority: selectedCorr.priority,
        status: 'Pending',
        category: selectedCorr.category,
        subCategory: selectedCorr.subCategory || '',
        department: selectedCorr.department || '',
        serialNumber: serial,
        assignedTo: employee.displayName,
        assignedToId: assigneeId,
        assignedBy: appUser.displayName,
        assignedById: user.uid,
        dueDate: dueDate || selectedCorr.deadline || null,
        correspondingId: selectedCorr.id,
        correspondingSubject: selectedCorr.subject,
        statusUpdate: 'Not Started',
        notes: [],
        userId: user.uid,
        teamId: appUser.teamId || employee.teamId || 'NONE',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 3. Update corresponding with taskId
      await updateDoc(doc(db, 'correspondences', selectedCorr.id), {
        convertedToTaskId: taskRef.id,
      });

      // 4. Create notification for employee
      await addDoc(collection(db, 'notifications'), {
        type: 'task_assigned',
        title: 'New Task Assigned',
        message: `"${selectedCorr.subject}" has been assigned to you by ${appUser.displayName}`,
        forUserId: assigneeId,
        read: false,
        relatedId: taskRef.id,
        createdAt: serverTimestamp(),
      });

      setSelectedCorr(null);
      setAssigneeId('');
      setDueDate('');
      setManagerNote('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'tasks');
      setError('Failed to assign task. Check permissions.');
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div style={{ padding: '4px 0', minHeight: '60vh' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Manager Inbox
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Review incoming correspondences and assign them to employees as tasks.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 32 }}>
        {[
          { label: 'Unread', value: stats.pending, cls: 'stat-amber' },
          { label: 'Reviewing', value: stats.reviewing, cls: 'stat-sky' },
          { label: 'Active Tasks', value: stats.tasksActive, cls: 'stat-indigo' },
          { label: 'Tasks Done', value: stats.tasksDone, cls: 'stat-green' },
        ].map(s => (
          <div 
            key={s.label} 
            className={`card ${s.cls} card-interactive`} 
            style={{ padding: '20px 24px', borderColor: filter === s.label ? 'var(--accent)' : undefined, opacity: filter === s.label ? 1 : 0.8 }}
            onClick={() => setFilter(s.label)}
          >
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, color: '#f87171', fontSize: 14 }}>
          <AlertCircle className="w-4 h-4" /> {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#f87171' }}><X className="w-4 h-4" /></button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
        {/* Left: Correspondence list */}
        <div>
          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'var(--text-muted)' }} />
              <input className="input" style={{ paddingLeft: 36 }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="input" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="All">All</option>
              <option value="Unread">Unread</option>
              <option value="Reviewing">Reviewing</option>
              <option value="Assigned">Assigned</option>
              <option value="Closed">Closed</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AnimatePresence>
              {(filter === 'Active Tasks' || filter === 'Tasks Done') ? (
                tasks.filter(t => {
                  if (search && !globalSearch(t, search)) return false;
                  if (filter === 'Active Tasks') return t.status === 'In Progress' || t.status === 'Pending';
                  if (filter === 'Tasks Done') return t.status === 'Done';
                  return true;
                }).map(task => (
                  <motion.div
                    key={task.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="card"
                    style={{ padding: '18px 20px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span className={`badge ${task.status === 'Done' ? 'badge-done' : task.status === 'In Progress' ? 'badge-inprogress' : 'badge-pending'}`}>
                        {task.status}
                      </span>
                      <span className={`badge ${task.priority === 'Urgent' ? 'badge-urgent' : task.priority === 'High' ? 'badge-high' : task.priority === 'Medium' ? 'badge-medium' : 'badge-low'}`}>
                        {task.priority}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                      {task.serialNumber && (
                        <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                          #{task.serialNumber}
                        </span>
                      )}
                      <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', margin: 0 }}>{task.taskName}</h3>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 10 }}>{task.description}</p>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
                      {task.assignedTo && <span style={{ color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: 4 }}><UserCheck className="w-3 h-3" /> {task.assignedTo}</span>}
                      {task.dueDate && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar className="w-3 h-3" /> {task.dueDate}</span>}
                    </div>
                  </motion.div>
                ))
              ) : (
                filtered.map(corr => {
                  const isSelected = selectedCorr?.id === corr.id;
                  const isNew = corr.status === 'Unread';
                  return (
                    <motion.div
                      key={corr.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="card card-interactive"
                      style={{
                        padding: '18px 20px',
                        borderColor: isSelected ? 'var(--accent)' : isNew ? 'rgba(245,158,11,0.3)' : undefined,
                        background: isSelected ? 'rgba(99,102,241,0.08)' : undefined,
                      }}
                      onClick={() => { setSelectedCorr(corr); setAssigneeId(corr.assignedToId || ''); setDueDate(corr.deadline || ''); setManagerNote(corr.notes || ''); }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <span className={`badge ${corr.status === 'Unread' ? 'badge-pending' : corr.status === 'Reviewing' ? 'badge-review' : corr.status === 'Assigned' ? 'badge-assigned' : 'badge-closed'}`}>
                            {corr.status}
                          </span>
                          <span className={`badge ${corr.priority === 'Urgent' ? 'badge-urgent' : corr.priority === 'High' ? 'badge-high' : corr.priority === 'Medium' ? 'badge-medium' : 'badge-low'}`}>
                            {corr.priority}
                          </span>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{corr.dateReceived}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                        {corr.serialNumber && (
                          <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                            #{corr.serialNumber}
                          </span>
                        )}
                        <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', margin: 0 }}>{corr.subject}</h3>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 10 }}>{corr.body}</p>
                      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Building2 className="w-3 h-3" /> {corr.department}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Tag className="w-3 h-3" /> {corr.sentFrom}</span>
                        {corr.assignedTo && <span style={{ color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: 4 }}><UserCheck className="w-3 h-3" /> {corr.assignedTo}</span>}
                      </div>
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
            {((filter === 'Active Tasks' || filter === 'Tasks Done') ? tasks.filter(t => (filter === 'Active Tasks' ? (t.status === 'In Progress' || t.status === 'Pending') : t.status === 'Done')).length : filtered.length) === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                <Inbox style={{ width: 40, height: 40, margin: '0 auto 12px', opacity: 0.3 }} />
                <p style={{ fontSize: 14, fontWeight: 600 }}>All caught up!</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Assignment panel */}
        <div style={{ position: 'sticky', top: 24 }}>
          <div className="card" style={{ padding: 24 }}>
            {selectedCorr ? (
              <>
                <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)', marginBottom: 4 }}>Assign to Employee</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Assigning will create a task linked to this correspondence.</p>

                <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '14px 16px', marginBottom: 20, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Corresponding</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>{selectedCorr.subject}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedCorr.department} › {selectedCorr.sentFrom}</div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label className="input-label">Assign to Employee *</label>
                  <select className="input" value={assigneeId} onChange={e => setAssigneeId(e.target.value)} required>
                    <option value="">— Select Employee —</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>{e.displayName} ({e.department || 'No dept'})</option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label className="input-label">Due Date</label>
                  <input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label className="input-label">Manager Note (optional)</label>
                  <textarea className="input" rows={3} value={managerNote} onChange={e => setManagerNote(e.target.value)} placeholder="Instructions or context for the employee…" />
                </div>

                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={handleAssign}
                  disabled={!assigneeId || isAssigning}
                >
                  {isAssigning ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Assigning…</> : <><UserCheck className="w-4 h-4" /> Assign as Task</>}
                </button>

                {selectedCorr.status === 'Assigned' && (
                  <div style={{ marginTop: 12, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#4ade80', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <CheckCircle2 className="w-4 h-4" />
                    Already assigned to {selectedCorr.assignedTo}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                <Users style={{ width: 40, height: 40, margin: '0 auto 12px', opacity: 0.3 }} />
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Select a Corresponding</p>
                <p style={{ fontSize: 12 }}>Click any item on the left to assign it to an employee.</p>
              </div>
            )}
          </div>

          {/* Employee workload */}
          {employees.length > 0 && (
            <div className="card" style={{ padding: 20, marginTop: 16 }}>
              <h4 style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Employee Workload</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {employees.slice(0, 6).map(emp => {
                  const activeTasks = tasks.filter(t => t.assignedToId === emp.id && t.status !== 'Done' && t.status !== 'Archived').length;
                  return (
                    <div key={emp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {emp.photoURL
                          ? <img src={emp.photoURL} referrerPolicy="no-referrer" className="avatar" style={{ width: 28, height: 28 }} alt="" />
                          : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>{emp.displayName?.[0]}</div>
                        }
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{emp.displayName}</span>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                        background: activeTasks >= 5 ? 'rgba(239,68,68,0.15)' : activeTasks >= 3 ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
                        color: activeTasks >= 5 ? '#f87171' : activeTasks >= 3 ? '#fbbf24' : '#4ade80',
                      }}>
                        {activeTasks} task{activeTasks !== 1 ? 's' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
