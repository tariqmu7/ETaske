import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, onSnapshot, addDoc, updateDoc,
  doc, serverTimestamp, orderBy, Timestamp
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { createNotification } from './lib/pushNotification';
import { User } from 'firebase/auth';
import { AppUser, Corresponding, Task, PRIORITY_OPTIONS, OperationType } from './types';
import { getNextSerialNumber } from './lib/counters';
import {
  Inbox, UserCheck, Calendar, Building2,
  AlertCircle, X, Users, Search, Tag, FileText, Paperclip, Hash, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppView } from './App';
import { globalSearch, getUserColor } from './utils';

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

  // Department scoping (mirrors CorrespondingsDashboard): an Admin reviews
  // every correspondence; a Manager only reviews ones whose creator is in
  // their department (plus anything they logged themselves).
  const isAdmin = appUser.role === 'Admin';

  const departmentByUserId = useMemo(() => {
    const map = new Map<string, string | undefined>();
    projectUsers.forEach(u => { map.set(u.id, u.department); });
    return map;
  }, [projectUsers]);

  const visibleCorrespondences = useMemo(() => {
    if (isAdmin) return correspondences;
    return correspondences.filter(c =>
      c.userId === user.uid ||
      (!!appUser.department && departmentByUserId.get(c.userId) === appUser.department)
    );
  }, [correspondences, isAdmin, departmentByUserId, appUser.department, user.uid]);

  const targetUsers = useMemo(() => {
    return projectUsers.filter(u => 
      u.status === 'Approved' && 
      (
        u.id === user.uid || 
        appUser.role === 'Admin' || 
        (u.department === appUser.department && u.teamId === appUser.teamId)
      )
    );
  }, [projectUsers, appUser.department, appUser.teamId, appUser.role, user.uid]);

  const filtered = useMemo(() => {
    return visibleCorrespondences.filter(c => {
      if (search && !globalSearch(c, search)) return false;
      if (filter !== 'All' && c.status !== filter) return false;
      return true;
    });
  }, [visibleCorrespondences, search, filter]);

  const pendingCount = visibleCorrespondences.filter(c => c.status === 'Unread' || c.status === 'Reviewing').length;

  const stats = useMemo(() => ({
    pending: visibleCorrespondences.filter(c => c.status === 'Unread').length,
    reviewing: visibleCorrespondences.filter(c => c.status === 'Reviewing').length,
    tasksActive: tasks.filter(t => t.status === 'In Progress' || t.status === 'Pending').length,
    tasksDone: tasks.filter(t => t.status === 'Done').length,
  }), [visibleCorrespondences, tasks]);

  const handleAssign = async () => {
    if (!selectedCorr || !assigneeId) return;
    setIsAssigning(true);
    const employee = projectUsers.find(u => u.id === assigneeId);
    if (!employee) { setIsAssigning(false); return; }

    try {
      const isReassignment = selectedCorr.status === 'Assigned';

      // 1. Update corresponding
      await updateDoc(doc(db, 'correspondences', selectedCorr.id), {
        status: 'Assigned',
        assignedTo: employee.displayName,
        assignedToId: assigneeId,
        assignedAt: serverTimestamp(),
        notes: managerNote,
        updatedAt: serverTimestamp(),
      });

      let taskId = selectedCorr.convertedToTaskId;

      if (isReassignment && taskId) {
        // 2. Update existing task
        await updateDoc(doc(db, 'tasks', taskId), {
          assignedTo: employee.displayName,
          assignedToId: assigneeId,
          dueDate: dueDate || null,
          updatedAt: serverTimestamp(),
        });
      } else if (!isReassignment) {
        // 2. Create new task
        const serial = await getNextSerialNumber('tasks');
        const taskRef = await addDoc(collection(db, 'tasks'), {
          taskName: selectedCorr.subject,
          description: selectedCorr.body,
          priority: selectedCorr.priority,
          status: 'Pending',
          category: selectedCorr.category,
          subCategory: selectedCorr.subCategory || 'None',
          department: selectedCorr.department || 'None',
          serialNumber: serial,
          assignedTo: employee.displayName,
          assignedToId: assigneeId,
          assignedBy: appUser.displayName,
          assignedById: user.uid,
          dueDate: dueDate || selectedCorr.deadline || null,
          correspondingId: selectedCorr.id,
          correspondingSubject: selectedCorr.subject,
          correspondingSerialNumber: selectedCorr.serialNumber,
          attachedFile: selectedCorr.attachedFile || null,
          attachedFileName: selectedCorr.attachedFileName || null,
          statusUpdate: 'Not Started',
          notes: [],
          userId: user.uid,
          teamId: appUser.teamId || employee.teamId || 'NONE',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        taskId = taskRef.id;
        
        await updateDoc(doc(db, 'correspondences', selectedCorr.id), {
          convertedToTaskId: taskId,
        });
      }

      // 3. Create notification for employee
      await createNotification({
        type: 'task_assigned',
        title: isReassignment ? 'Task Reassigned' : 'New Task Assigned',
        message: `"${selectedCorr.subject}" has been ${isReassignment ? 'reassigned' : 'assigned'} to you by ${appUser.displayName}`,
        forUserId: assigneeId,
        read: false,
        relatedId: taskId,
        createdAt: serverTimestamp(),
      }, projectUsers);

      setSelectedCorr(null);
      setAssigneeId('');
      setDueDate('');
      setManagerNote('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'tasks');
      setError('Failed to update assignment. Check permissions.');
      setIsAssigning(false); // re-enable so the manager can retry
      return;
    }
    // Success: keep the button briefly disabled so the live snapshot
    // refreshes the inbox before it becomes interactive again.
    setTimeout(() => setIsAssigning(false), 800);
  };

  const openCorr = (corr: Corresponding) => {
    setSelectedCorr(corr);
    setAssigneeId(corr.assignedToId || '');
    setDueDate(corr.deadline || '');
    setManagerNote(corr.notes || '');
  };

  const closeModal = () => {
    setSelectedCorr(null);
    setAssigneeId('');
    setDueDate('');
    setManagerNote('');
  };

  return (
    <div style={{ padding: '4px 0', minHeight: '60vh' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 4 }}>
          Inbox
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
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 0, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, color: '#f87171', fontSize: 14 }}>
          <AlertCircle className="w-4 h-4" /> {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#f87171' }}><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="inbox-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, alignItems: 'start' }}>
      {/* Left: toolbar + card list */}
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

      {/* Card list */}
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
                style={{
                  padding: '18px 20px',
                  borderLeft: `4px solid ${(() => {
                    const u = projectUsers.find(pu => pu.id === task.assignedToId);
                    return u?.userColor || getUserColor(task.assignedToId || task.assignedTo || '');
                  })()}`
                }}
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
                    <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>#{task.serialNumber}</span>
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
                    borderColor: isNew ? 'rgba(245,158,11,0.3)' : undefined,
                    borderLeft: `4px solid ${(() => {
                      const u = projectUsers.find(pu => pu.id === corr.assignedToId);
                      return u?.userColor || getUserColor(corr.assignedToId || corr.userId || '');
                    })()}`
                  }}
                  onClick={() => openCorr(corr)}
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
                      <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>#{corr.serialNumber}</span>
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
      </div>{/* end left column */}

      {/* Right: team workload panel */}
      <div className="inbox-workload" style={{ position: 'sticky', top: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 16 }}>
            Team Workload
          </div>
          {targetUsers.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>No team members</p>
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
                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginTop: 2 }}>Active</div>
                      </div>
                      <div style={{ flex: 1, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', padding: '5px 8px', textAlign: 'center' }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: done > 0 ? '#4ade80' : 'var(--text-muted)', lineHeight: 1 }}>{done}</div>
                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginTop: 2 }}>Done</div>
                      </div>
                    </div>
                    {total > 0 && (
                      <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${donePercent}%`, background: 'linear-gradient(90deg,#22c55e,#4ade80)', borderRadius: 2, transition: 'width 0.4s ease' }} />
                      </div>
                    )}
                    {oldestActive && (
                      <div style={{ marginTop: 5, fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ opacity: 0.6 }}>Since</span>
                        <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{oldestActive.toLocaleDateString('en-GB')}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>{/* end grid */}

      {/* Detail modal */}
      <AnimatePresence>
        {selectedCorr && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 20,
            }}
            onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.18 }}
              className="card"
              style={{
                width: '100%', maxWidth: 640,
                maxHeight: '90vh', overflowY: 'auto',
                padding: 0,
                display: 'flex', flexDirection: 'column',
              }}
            >
              {/* Modal header */}
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span className={`badge ${selectedCorr.status === 'Unread' ? 'badge-pending' : selectedCorr.status === 'Reviewing' ? 'badge-review' : selectedCorr.status === 'Assigned' ? 'badge-assigned' : 'badge-closed'}`}>
                      {selectedCorr.status}
                    </span>
                    <span className={`badge ${selectedCorr.priority === 'Urgent' ? 'badge-urgent' : selectedCorr.priority === 'High' ? 'badge-high' : selectedCorr.priority === 'Medium' ? 'badge-medium' : 'badge-low'}`}>
                      {selectedCorr.priority}
                    </span>
                    {selectedCorr.serialNumber && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                        <Hash className="w-3 h-3" />{selectedCorr.serialNumber}
                      </span>
                    )}
                  </div>
                  <h2 style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', margin: 0, lineHeight: 1.3 }}>{selectedCorr.subject}</h2>
                </div>
                <button
                  onClick={closeModal}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, flexShrink: 0 }}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Meta row */}
              <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 12, color: 'var(--text-muted)' }}>
                {selectedCorr.department && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Building2 className="w-3.5 h-3.5" /> {selectedCorr.department}
                  </span>
                )}
                {selectedCorr.sentFrom && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag className="w-3.5 h-3.5" /> {selectedCorr.sentFrom}
                  </span>
                )}
                {selectedCorr.category && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileText className="w-3.5 h-3.5" /> {selectedCorr.category}{selectedCorr.subCategory && selectedCorr.subCategory !== 'None' ? ` › ${selectedCorr.subCategory}` : ''}
                  </span>
                )}
                {selectedCorr.dateReceived && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock className="w-3.5 h-3.5" /> {selectedCorr.dateReceived}
                  </span>
                )}
                {selectedCorr.deadline && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Calendar className="w-3.5 h-3.5" /> Deadline: {selectedCorr.deadline}
                  </span>
                )}
              </div>

              {/* Body */}
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 10 }}>Content</div>
                <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{selectedCorr.body}</p>
              </div>

              {/* Attachment */}
              {selectedCorr.attachedFile && (
                <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)' }}>
                  <a
                    href={selectedCorr.attachedFile}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
                  >
                    <Paperclip className="w-4 h-4" />
                    {selectedCorr.attachedFileName || 'View Attachment'}
                  </a>
                </div>
              )}

              {/* Already-assigned notice */}
              {selectedCorr.status === 'Assigned' && selectedCorr.assignedTo && (
                <div style={{ margin: '0 24px 0', marginTop: 20, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', padding: '10px 14px', fontSize: 12, color: 'var(--accent)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Users className="w-4 h-4" style={{ flexShrink: 0 }} />
                  Currently assigned to <strong>{selectedCorr.assignedTo}</strong>. Changing this will update the linked task.
                </div>
              )}

              {/* Assignment form */}
              <div style={{ padding: '20px 24px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 16 }}>
                  {selectedCorr.status === 'Assigned' ? 'Reassign Task' : 'Assign as Task'}
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label className="input-label">Assign to Employee *</label>
                  <select className="input" value={assigneeId} onChange={e => setAssigneeId(e.target.value)} required>
                    <option value="">— Select Recipient —</option>
                    {targetUsers.map(e => (
                      <option key={e.id} value={e.id}>{e.displayName} ({e.role})</option>
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

                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn" style={{ flex: 1 }} onClick={closeModal}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 2 }}
                    onClick={handleAssign}
                    disabled={!assigneeId || isAssigning}
                  >
                    {isAssigning ? (
                      <><span className="spinner" style={{ width: 16, height: 16 }} /> Processing…</>
                    ) : selectedCorr.status === 'Assigned' ? (
                      <><UserCheck className="w-4 h-4" /> Reassign Task</>
                    ) : (
                      <><UserCheck className="w-4 h-4" /> Assign as Task</>
                    )}
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
