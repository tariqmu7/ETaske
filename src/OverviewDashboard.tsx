import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, onSnapshot, orderBy, Timestamp
} from 'firebase/firestore';
import { db } from './lib/firebase';
import { User } from 'firebase/auth';
import {
  AppUser, Corresponding, Task, Milestone,
  CorrespondingCategory, CorrespondingStatus, TaskStatus, OperationType
} from './types';
import {
  BarChart3, MailOpen, CheckSquare, Clock, AlertCircle,
  ChevronDown, ChevronRight, Building2, Tag, Calendar,
  TrendingUp, Users, Layers, Search, Filter, ArrowRight,
  FolderOpen, Globe, Server, X, Flag, Target, Link2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { globalSearch, getUserColor } from './utils';

function handleFirestoreError(e: unknown, op: OperationType, path: string | null) {
  console.error('Overview Firestore:', { e, op, path });
}

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  Project:  { bg: '#dbeafe', text: '#1d4ed8', border: '#bfdbfe', icon: <Server className="w-4 h-4" /> },
  Internal: { bg: '#f3e8ff', text: '#6d28d9', border: '#e9d5ff', icon: <Layers className="w-4 h-4" /> },
  External: { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0', icon: <Globe className="w-4 h-4" /> },
};

const STATUS_ORDER: CorrespondingStatus[] = ['Unread', 'Reviewing', 'Assigned', 'Closed'];
const TASK_STATUS_ORDER: TaskStatus[] = ['Pending', 'In Progress', 'Done', 'Archived'];

function formatDate(d: Timestamp | string | undefined): string {
  if (!d) return '—';
  if (typeof d === 'string') return d;
  return d.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isOverdue(deadline?: string): boolean {
  if (!deadline) return false;
  return new Date(deadline) < new Date();
}

const priorityColor: Record<string, string> = {
  Urgent: '#dc2626', High: '#ea580c', Medium: '#d97706', Low: '#16a34a'
};

// ─── Mini stat card ───────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className="card" style={{ padding: '16px 20px', borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#0f172a' }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const CorrCard: React.FC<{ item: Corresponding; tasks: Task[]; milestones: Milestone[]; onTaskClick: (t: Task) => void }> = ({ item, tasks, milestones, onTaskClick }) => {
  const linkedTask = tasks.find(t => t.correspondingId === item.id || t.id === item.convertedToTaskId);
  const taskMilestones = linkedTask ? milestones.filter(m => m.taskId === linkedTask.id) : [];
  const overdue = isOverdue(item.deadline);

  return (
    <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', borderLeft: `4px solid ${getUserColor(item.assignedToId || item.userId || '')}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {item.serialNumber && (
            <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
              #{item.serialNumber}
            </span>
          )}
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.4 }}>{item.subject}</div>
        </div>
        <span style={{ padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: 'var(--surface-3)', color: 'var(--text-secondary)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          {item.status}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, flex: 1 }}>
        <p style={{ marginBottom: 4 }}><strong>From:</strong> {item.sentFrom}</p>
        <p style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.body}</p>
      </div>
      
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: priorityColor[item.priority] || 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          {item.priority} Priority
        </span>
        {overdue && (
          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: '#fee2e2', color: '#dc2626' }}>
            Overdue
          </span>
        )}
      </div>

      {item.assignedTo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: getUserColor(item.assignedToId || item.assignedTo) }} />
          Assigned: {item.assignedTo}
        </div>
      )}

      <div style={{ fontSize: 11, color: overdue ? '#dc2626' : 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{item.deadline ? `Due ${item.deadline}` : 'No deadline'}</span>
        {linkedTask && (
          <button 
            onClick={() => onTaskClick(linkedTask)}
            style={{ 
              background: 'none', border: 'none', padding: '2px 6px', borderRadius: 4, 
              color: '#16a34a', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, transition: 'all 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#dcfce7'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            ↳ Linked Task
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Main component ────────────────────────────────────────────────────────────
export default function OverviewDashboard({ user, appUser, projectUsers }: Props) {
  const [correspondences, setCorrespondences] = useState<Corresponding[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [dateFilter, setDateFilter] = useState('');

  // Load data
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(onSnapshot(
      query(collection(db, 'correspondences'), orderBy('createdAt', 'desc')),
      snap => { setCorrespondences(snap.docs.map(d => ({ id: d.id, ...d.data() } as Corresponding))); setLoading(false); },
      e => handleFirestoreError(e, OperationType.LIST, 'correspondences')
    ));

    unsubs.push(onSnapshot(
      query(collection(db, 'tasks'), orderBy('createdAt', 'desc')),
      snap => { setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task))); },
      e => handleFirestoreError(e, OperationType.LIST, 'tasks')
    ));

    unsubs.push(onSnapshot(
      query(collection(db, 'milestones'), orderBy('createdAt', 'asc')),
      snap => { setMilestones(snap.docs.map(d => ({ id: d.id, ...d.data() } as Milestone))); },
      e => handleFirestoreError(e, OperationType.LIST, 'milestones')
    ));

    return () => unsubs.forEach(u => u());
  }, []);

  // ─── Root Categories Stats ───────────────────────────────────────────────
  const categoryStats = useMemo(() => {
    const stats: Record<string, { total: number; tasks: number; overdue: number }> = {
      Project: { total: 0, tasks: 0, overdue: 0 },
      Internal: { total: 0, tasks: 0, overdue: 0 },
      External: { total: 0, tasks: 0, overdue: 0 }
    };
    correspondences.forEach(c => {
      const createdDate = c.createdAt?.toDate?.()?.toISOString()?.split('T')[0] || c.dateReceived;
      if (dateFilter && createdDate !== dateFilter) return;
      const cat = c.category || 'Internal';
      if (stats[cat]) {
        stats[cat].total++;
        if (isOverdue(c.deadline) && c.status !== 'Closed') stats[cat].overdue++;
      }
    });
    tasks.forEach(t => {
      const createdDate = t.createdAt?.toDate?.()?.toISOString()?.split('T')[0];
      if (dateFilter && createdDate !== dateFilter) return;
      if (t.correspondingId) {
        const c = correspondences.find(corr => corr.id === t.correspondingId);
        if (c && stats[c.category]) stats[c.category].tasks++;
      }
    });
    return stats;
  }, [correspondences, tasks]);

  // ─── Sub-Category Grouping for Selected Category ───────────────────────
  const subCategoryGroups = useMemo(() => {
    if (!selectedCategory) return new Map();
    
    const catCorrs = correspondences.filter(c => c.category === selectedCategory);
    if (search) {
      const q = search.toLowerCase();
      // Only apply search if provided
    }
    const map = new Map<string, { corrs: Corresponding[], tasks: Task[] }>();
    
    catCorrs.forEach(c => {
      if (search && !globalSearch(c, search)) return;
      const createdDate = c.createdAt?.toDate?.()?.toISOString()?.split('T')[0] || c.dateReceived;
      if (dateFilter && createdDate !== dateFilter) return;
      const sub = c.subCategory || 'General';
      if (!map.has(sub)) map.set(sub, { corrs: [], tasks: [] });
      map.get(sub)!.corrs.push(c);
    });
    
    tasks.forEach(t => {
      let isTaskInCat = false;
      let sub = 'General';

      if (t.category) {
        if (t.category === selectedCategory) {
          isTaskInCat = true;
          sub = t.subCategory || 'General';
        }
      } else if (t.correspondingId || t.id) {
        const c = correspondences.find(corr => corr.id === t.correspondingId || corr.convertedToTaskId === t.id);
        if (c && c.category === selectedCategory) {
          isTaskInCat = true;
          sub = c.subCategory || 'General';
        }
      }

      if (isTaskInCat) {
         if (search && !globalSearch(t, search)) return;
         if (!map.has(sub)) map.set(sub, { corrs: [], tasks: [] });
         if (!map.get(sub)!.tasks.find(ex => ex.id === t.id)) {
           map.get(sub)!.tasks.push(t);
         }
      }
    });

    return map;
  }, [selectedCategory, correspondences, tasks, search]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  // Task Card Component to be used inside sub-category view
  const TaskCard: React.FC<{ task: Task }> = ({ task }) => {
    const taskMilestones = milestones.filter(m => m.taskId === task.id);
    const done = taskMilestones.filter(m => m.status === 'Done').length;
    const progress = taskMilestones.length ? Math.round((done / taskMilestones.length) * 100) : 0;
    const ov = isOverdue(task.dueDate) && task.status !== 'Done' && task.status !== 'Archived';
    
    return (
      <div 
        className="card" 
        style={{ padding: '16px 18px', cursor: 'pointer', transition: 'transform 0.2s', borderLeft: '4px solid #3b82f6' }}
        onClick={() => setSelectedTask(task)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, marginRight: 8 }}>
            {task.serialNumber && (
              <span style={{ fontSize: 9, fontWeight: 800, color: '#64748b', letterSpacing: '0.04em' }}>
                #{task.serialNumber}
              </span>
            )}
            <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', lineHeight: 1.4 }}>{task.taskName}</div>
          </div>
          <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            background: task.status === 'Done' ? '#dcfce7' : task.status === 'In Progress' ? '#dbeafe' : '#f1f5f9',
            color: task.status === 'Done' ? '#15803d' : task.status === 'In Progress' ? '#1d4ed8' : '#475569',
          }}>{task.status}</span>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
          Assigned to: <span style={{fontWeight: 600, color: '#334155'}}>{task.assignedTo || '—'}</span> &nbsp;·&nbsp; Due: {task.dueDate || '—'}
          {ov && <span style={{ color: '#dc2626', marginLeft: 6 }}>⚠ Overdue</span>}
        </div>
        {taskMilestones.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span>Milestones: {done}/{taskMilestones.length}</span>
              <span>{progress}%</span>
            </div>
            <div style={{ height: 5, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: '#3b82f6', borderRadius: 999, transition: 'width 0.4s' }} />
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '4px 0', minHeight: '60vh', position: 'relative' }}>
      {/* Stats Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>Dashboard Overview</h1>
          <p style={{ color: '#64748b', fontSize: 14 }}>Real-time stats and task monitoring.</p>
        </div>
        
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
        </div>
      </div>

      {selectedCategory === null ? (
        /* ── Category Grid View ── */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginTop: 24 }}>
          {['Project', 'Internal', 'External'].map(cat => {
            const catStyle = CATEGORY_COLORS[cat] || CATEGORY_COLORS.Internal;
            const s = categoryStats[cat];
            return (
              <div 
                key={cat} 
                className="card" 
                style={{ cursor: 'pointer', transition: 'all 0.2s', overflow: 'hidden' }}
                onClick={() => setSelectedCategory(cat)}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-4px)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
              >
                <div style={{ padding: '24px', background: catStyle.bg, borderBottom: `1px solid ${catStyle.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ color: catStyle.text, padding: 12, background: 'rgba(255,255,255,0.5)', borderRadius: 12 }}>
                    {catStyle.icon}
                  </div>
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 800, color: catStyle.text, margin: 0 }}>{cat}</h2>
                    <span style={{ fontSize: 13, color: catStyle.text, opacity: 0.8, fontWeight: 600 }}>Category</span>
                  </div>
                </div>
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#64748b', fontSize: 14, fontWeight: 600 }}>Correspondences</span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{s.total}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#64748b', fontSize: 14, fontWeight: 600 }}>Related Tasks</span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{s.tasks}</span>
                  </div>
                  {s.overdue > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#fee2e2', borderRadius: 8 }}>
                      <span style={{ color: '#dc2626', fontSize: 14, fontWeight: 700 }}>Overdue Correspondences</span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: '#dc2626' }}>{s.overdue}</span>
                    </div>
                  )}
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', color: catStyle.text, fontSize: 14, fontWeight: 700, gap: 4 }}>
                    View Details <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Sub-Category View ── */
        <AnimatePresence>
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            {/* Back Button and Search */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 30, alignItems: 'center', flexWrap: 'wrap' }}>
              <button 
                onClick={() => setSelectedCategory(null)}
                className="btn btn-ghost"
                style={{ gap: 8, paddingLeft: 8 }}
              >
                <ArrowRight className="w-4 h-4" style={{ transform: 'rotate(180deg)' }} /> Back to Categories
              </button>
              
              <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 400 }}>
                <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: '#94a3b8' }} />
                <input
                  className="input"
                  style={{ paddingLeft: 36, fontSize: 13 }}
                  placeholder="Search tasks or correspondences…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Sub-categories */}
            {Array.from(subCategoryGroups.entries()).sort().map(([subCat, data]) => {
              if (data.corrs.length === 0 && data.tasks.length === 0) return null;
              return (
                <div key={subCat} style={{ marginBottom: 40 }}>
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FolderOpen className="w-5 h-5 text-primary" />
                    {subCat}
                  </h3>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
                    {/* Correspondences Column / Items */}
                    {data.corrs.map(item => (
                      <CorrCard key={`corr-${item.id}`} item={item} tasks={tasks} milestones={milestones} onTaskClick={setSelectedTask} />
                    ))}
                    
                    {/* Tasks Items */}
                    {data.tasks.map(task => (
                      <TaskCard key={`task-${task.id}`} task={task} />
                    ))}
                  </div>
                </div>
              );
            })}
            
            {subCategoryGroups.size === 0 && (
               <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
                 <BarChart3 style={{ width: 44, height: 44, margin: '0 auto 12px', opacity: 0.3 }} />
                 <p style={{ fontWeight: 600 }}>No data matches your criteria.</p>
               </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* ── Task Details Modal ── */}
      <AnimatePresence>
        {selectedTask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(4px)' }}
            onClick={() => setSelectedTask(null)}
          >
            <motion.div
              initial={{ y: 20, scale: 0.95 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 20, scale: 0.95 }}
              className="card"
              style={{ width: '100%', maxWidth: 650, maxHeight: '85vh', overflowY: 'auto', padding: 0, display: 'flex', flexDirection: 'column' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#f8fafc' }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: selectedTask.status === 'Done' ? '#dcfce7' : selectedTask.status === 'In Progress' ? '#dbeafe' : '#f1f5f9',
                      color: selectedTask.status === 'Done' ? '#15803d' : selectedTask.status === 'In Progress' ? '#1d4ed8' : '#475569',
                    }}>{selectedTask.status}</span>
                    <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: priorityColor[selectedTask.priority] ? `${priorityColor[selectedTask.priority]}20` : '#f1f5f9',
                      color: priorityColor[selectedTask.priority] || '#475569'
                    }}>{selectedTask.priority} Priority</span>
                  </div>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>{selectedTask.taskName}</h2>
                </div>
                <button 
                  onClick={() => setSelectedTask(null)} 
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <X className="w-5 h-5 text-muted" />
                </button>
              </div>
              
              {/* Modal Body */}
              <div style={{ padding: '24px', flex: 1 }}>
                <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.6, marginBottom: 24, whiteSpace: 'pre-wrap' }}>
                  {selectedTask.description || <span style={{ fontStyle: 'italic', color: '#94a3b8' }}>No description provided.</span>}
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24, padding: '16px', background: '#f8fafc', borderRadius: 12, border: '1px solid var(--border)' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Assigned To</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: getUserColor(selectedTask.assignedToId || selectedTask.assignedTo) }} />
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{selectedTask.assignedTo || 'Unassigned'}</span>
                    </div>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Assigned By</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}><Flag className="w-4 h-4 text-muted" /> {selectedTask.assignedBy || '—'}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Due Date</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: isOverdue(selectedTask.dueDate) && selectedTask.status !== 'Done' ? '#dc2626' : '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}><Calendar className="w-4 h-4" /> {selectedTask.dueDate || 'No deadline'}</span>
                  </div>
                  {selectedTask.correspondingSubject && (
                    <div>
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Linked Corresponding</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={selectedTask.correspondingSubject}><Link2 className="w-4 h-4 flex-shrink-0" /> {selectedTask.correspondingSubject}</span>
                    </div>
                  )}
                </div>

                {/* Milestones inside Modal */}
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Target className="w-4 h-4 text-primary" /> Milestones
                  </h4>
                  
                  {milestones.filter(m => m.taskId === selectedTask.id).length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed var(--border)', color: '#94a3b8', fontSize: 13 }}>
                      No milestones for this task.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {milestones.filter(m => m.taskId === selectedTask.id).map(ms => (
                        <div key={ms.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: ms.status === 'Done' ? '#dcfce7' : ms.status === 'In Progress' ? '#dbeafe' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                            {ms.status === 'Done' && <CheckSquare className="w-3.5 h-3.5 text-success" style={{ color: '#15803d' }} />}
                            {ms.status === 'In Progress' && <Clock className="w-3.5 h-3.5 text-primary" style={{ color: '#1d4ed8' }} />}
                            {ms.status !== 'Done' && ms.status !== 'In Progress' && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#94a3b8' }} />}
                          </div>
                          <div style={{ flex: 1, padding: '12px 16px', background: '#f8fafc', borderRadius: 10, border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                              <span style={{ fontWeight: 600, fontSize: 14, color: ms.status === 'Done' ? '#94a3b8' : '#0f172a', textDecoration: ms.status === 'Done' ? 'line-through' : 'none' }}>{ms.title}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: 'var(--surface)', color: 'var(--text-muted)' }}>{ms.status}</span>
                            </div>
                            <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 12 }}>
                              <span>Added by {ms.addedBy}</span>
                              {ms.targetDate && <span>Target: {ms.targetDate}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

