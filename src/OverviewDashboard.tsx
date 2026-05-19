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
  FolderOpen, Globe, Server, X, Flag, Target, Link2,
  Paperclip, ExternalLink, FileText, Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { globalSearch, getUserColor, isOverdue, isDueSoon, openOrCopyPath } from './utils';

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
  return d.toDate().toLocaleDateString('en-GB');
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

const CorrCard: React.FC<{ 
  item: Corresponding; 
  tasks: Task[]; 
  milestones: Milestone[]; 
  onTaskClick: (t: Task) => void; 
  onCorrClick: (c: Corresponding) => void;
  projectUsers: AppUser[] 
}> = ({ item, tasks, milestones, onTaskClick, onCorrClick, projectUsers }) => {
  const linkedTask = tasks.find(t => t.correspondingId === item.id || t.id === item.convertedToTaskId);
  const overdue = isOverdue(item.deadline);

  return (
    <div 
      className="card" 
      onClick={() => onCorrClick(item)}
      style={{ 
        padding: '16px', 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%', 
        position: 'relative', 
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
        borderLeft: `4px solid ${(() => {
          const u = projectUsers.find(pu => pu.id === item.assignedToId);
          return u?.userColor || getUserColor(item.assignedToId || item.userId || '');
        })()}` 
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {item.serialNumber && (
            <span style={{ fontSize: 9, fontWeight: 800, color: '#64748b', letterSpacing: '0.04em' }}>
              #{item.serialNumber}
            </span>
          )}
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', lineHeight: 1.4 }}>{item.subject}</div>
        </div>
        <span style={{ padding: '3px 8px', borderRadius: 0, fontSize: 10, fontWeight: 700, background: '#f1f5f9', color: '#475569', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          {item.status}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, flex: 1 }}>
        <p style={{ marginBottom: 4 }}><strong>From:</strong> {item.sentFrom}</p>
        <p style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.body}</p>
      </div>
      
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ padding: '2px 8px', borderRadius: 0, fontSize: 10, fontWeight: 700, color: priorityColor[item.priority] || '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          {item.priority} Priority
        </span>
        {overdue && item.status !== 'Closed' && (
          <span style={{ padding: '2px 8px', borderRadius: 0, fontSize: 10, fontWeight: 700, background: '#fee2e2', color: '#dc2626' }}>
            Overdue
          </span>
        )}
      </div>

      {item.assignedTo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569', fontWeight: 600, marginBottom: 12 }}>
          {(() => {
            const u = projectUsers.find(pu => pu.id === item.assignedToId);
            return u?.photoURL ? (
              <img src={u.photoURL} className="avatar" style={{ width: 14, height: 14, objectFit: 'cover' }} alt="" />
            ) : (
              <span style={{ width: 8, height: 8, borderRadius: 0, background: u?.userColor || getUserColor(item.assignedToId || item.assignedTo) }} />
            );
          })()}
          Assigned: {item.assignedTo}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: overdue ? '#dc2626' : '#94a3b8' }}>
          {item.deadline ? `Due ${item.deadline}` : 'No deadline'}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {linkedTask && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onTaskClick(linkedTask);
              }}
              className="btn btn-ghost btn-sm"
              style={{ padding: '2px 6px', height: 'auto', fontSize: 9, fontWeight: 800, color: '#16a34a' }}
            >
              LINKED TASK
            </button>
          )}
          <button 
            className="btn btn-ghost btn-sm" 
            style={{ padding: '2px 8px', height: 'auto', fontSize: 10, fontWeight: 800 }}
            onClick={(e) => { e.stopPropagation(); onCorrClick(item); }}
          >
            FULL DETAILS
          </button>
        </div>
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
  const [selectedCorr, setSelectedCorr] = useState<Corresponding | null>(null);
  const [dateFilter, setDateFilter] = useState('');
  const [viewTab, setViewTab] = useState<'Correspondences' | 'Tasks'>('Correspondences');

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

  // ─── Top-level summary stats ──────────────────────────────────────────
  const summaryStats = useMemo(() => {
    const totalCorrs = correspondences.filter(c => c.id !== '--stats--').length;
    const openCorrs = correspondences.filter(c => c.status !== 'Closed' && c.id !== '--stats--').length;
    const activeTasks = tasks.filter(t => t.status !== 'Archived' && t.status !== 'Done').length;
    const doneTasks = tasks.filter(t => t.status === 'Done').length;
    const totalTasks = tasks.filter(t => t.status !== 'Archived').length;
    const overdue = [
      ...correspondences.filter(c => c.status !== 'Closed' && isOverdue(c.deadline)),
      ...tasks.filter(t => t.status !== 'Done' && t.status !== 'Archived' && isOverdue(t.dueDate)),
    ].length;
    const rate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    return { totalCorrs, openCorrs, activeTasks, doneTasks, overdue, rate };
  }, [correspondences, tasks]);

  // ─── Due Soon Alerts ───────────────────────────────────────────────────
  const dueSoonItems = useMemo(() => {
    const corrs = correspondences
      .filter(c => c.status !== 'Closed' && isDueSoon(c.deadline))
      .map(c => ({ ...c, type: 'Correspondence' as const }));
    
    const tks = tasks
      .filter(t => t.status !== 'Done' && t.status !== 'Archived' && isDueSoon(t.dueDate))
      .map(t => ({ ...t, type: 'Task' as const }));

    return [...corrs, ...tks].sort((a, b) => {
      const dateA = new Date((a as any).deadline || (a as any).dueDate || 0);
      const dateB = new Date((b as any).deadline || (b as any).dueDate || 0);
      return dateA.getTime() - dateB.getTime();
    });
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
        style={{ 
          padding: '16px 18px', 
          cursor: 'pointer', 
          transition: 'transform 0.2s, box-shadow 0.2s', 
          borderLeft: `4px solid ${(() => {
            const u = projectUsers.find(pu => pu.id === task.assignedToId);
            return u?.userColor || getUserColor(task.assignedToId || task.assignedTo || '');
          })()}` 
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }}
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
          <span style={{ padding: '3px 9px', borderRadius: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            background: task.status === 'Done' ? '#dcfce7' : task.status === 'In Progress' ? '#dbeafe' : '#f1f5f9',
            color: task.status === 'Done' ? '#15803d' : task.status === 'In Progress' ? '#1d4ed8' : '#475569',
          }}>{task.status}</span>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Assigned to: 
            {(() => {
              const u = projectUsers.find(pu => pu.id === task.assignedToId);
              return (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, color: '#334155' }}>
                  {u?.photoURL ? (
                    <img src={u.photoURL} className="avatar" style={{ width: 14, height: 14, objectFit: 'cover' }} alt="" />
                  ) : (
                    <span style={{ width: 8, height: 8, borderRadius: 0, background: u?.userColor || getUserColor(task.assignedToId || task.assignedTo) }} />
                  )}
                  {task.assignedTo || '—'}
                </span>
              );
            })()}
          </span>
          &nbsp;·&nbsp; Due: {task.dueDate || '—'}
          {ov && <span style={{ color: '#dc2626', marginLeft: 6 }}>⚠ Overdue</span>}
        </div>
        {taskMilestones.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span>Milestones: {done}/{taskMilestones.length}</span>
              <span>{progress}%</span>
            </div>
            <div style={{ height: 5, background: '#f1f5f9', borderRadius: 0, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: '#3b82f6', borderRadius: 0, transition: 'width 0.4s' }} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
          <button 
            className="btn btn-ghost btn-sm" 
            style={{ padding: '2px 8px', height: 'auto', fontSize: 10, fontWeight: 800 }}
            onClick={(e) => { e.stopPropagation(); setSelectedTask(task); }}
          >
            FULL DETAILS
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '4px 0', minHeight: '60vh', position: 'relative' }}>
      {/* Stats Header */}
      <div className="ov-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="ov-title" style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>Dashboard Overview</h1>
          <p className="ov-subtitle" style={{ color: '#64748b', fontSize: 14 }}>Real-time stats and task monitoring.</p>
        </div>

        <div className="ov-datefilter" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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

      {/* ── Summary Stat Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
        <StatCard label="Correspondences" value={summaryStats.totalCorrs} sub={`${summaryStats.openCorrs} open`} color="var(--blue-600)" />
        <StatCard label="Active Tasks" value={summaryStats.activeTasks} sub={`${summaryStats.doneTasks} done`} color="var(--green-600)" />
        <StatCard label="Overdue" value={summaryStats.overdue} sub="need attention" color="#ef4444" />
        <StatCard label="Completion" value={`${summaryStats.rate}%`} sub="tasks done" color="var(--teal-500)" />
      </div>

      {/* ── Due Soon Alerts Section ── */}
      {dueSoonItems.length > 0 && selectedCategory === null && (
        <motion.div
          className="ov-duesoon"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ marginBottom: 32, background: '#fff7ed', border: '1px solid #ffedd5', padding: '20px', borderRadius: 0 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <div style={{ background: '#f97316', padding: 6, borderRadius: 0 }}>
              <AlertCircle className="w-4 h-4" style={{ color: '#fff' }} />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#9a3412', margin: 0 }}>Due Soon (Within 48h)</h2>
              <p style={{ fontSize: 12, color: '#c2410c', margin: 0 }}>Items that require immediate attention.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            {dueSoonItems.slice(0, 4).map((item: any) => (
              <div 
                key={`${item.type}-${item.id}`} 
                className="card"
                style={{ 
                  padding: '12px 16px', 
                  background: '#fff', 
                  borderLeft: `4px solid #f97316`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  if (item.type === 'Task') {
                    setSelectedTask(item);
                  } else {
                    setSelectedCorr(item);
                  }
                }}
              >
                <div style={{ flex: 1, marginRight: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', marginBottom: 2 }}>{item.type}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', lineHeight: 1.3 }}>{item.subject || item.taskName}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Due: {item.deadline || item.dueDate}</div>
                </div>
                <ArrowRight className="w-4 h-4" style={{ color: '#94a3b8' }} />
              </div>
            ))}
            {dueSoonItems.length > 4 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#9a3412', background: 'rgba(249, 115, 22, 0.05)', padding: 12 }}>
                + {dueSoonItems.length - 4} more items due soon
              </div>
            )}
          </div>
        </motion.div>
      )}

      {selectedCategory === null ? (
        /* ── Category Grid View ── */
        <div className="ov-cat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginTop: 24 }}>
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
                <div className="cat-card-head" style={{ padding: '24px', background: `linear-gradient(135deg, ${catStyle.bg}, #fff)`, borderBottom: `2px solid ${catStyle.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ color: '#fff', padding: 10, background: catStyle.text, borderRadius: 0, boxShadow: `0 4px 12px ${catStyle.border}` }}>
                    {catStyle.icon}
                  </div>
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 800, color: catStyle.text, margin: 0 }}>{cat}</h2>
                    <span style={{ fontSize: 13, color: catStyle.text, opacity: 0.8, fontWeight: 600 }}>Category</span>
                  </div>
                </div>
                <div className="cat-card-body" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div 
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '8px', margin: '-8px', borderRadius: 0, transition: 'background 0.2s' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCategory(cat);
                      setViewTab('Correspondences');
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ color: '#64748b', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <MailOpen className="w-4 h-4" /> Correspondences
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{s.total}</span>
                  </div>
                  <div 
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '8px', margin: '-8px', borderRadius: 0, transition: 'background 0.2s' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCategory(cat);
                      setViewTab('Tasks');
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ color: '#64748b', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CheckSquare className="w-4 h-4" /> Related Tasks
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{s.tasks}</span>
                  </div>
                  {s.overdue > 0 && (
                    <div 
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#fee2e2', borderRadius: 0, cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCategory(cat);
                        setViewTab('Correspondences');
                      }}
                    >
                      <span style={{ color: '#dc2626', fontSize: 14, fontWeight: 700 }}>Overdue Correspondences</span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: '#dc2626' }}>{s.overdue}</span>
                    </div>
                  )}
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', color: catStyle.text, fontSize: 14, fontWeight: 700, gap: 4 }}>
                    View Full Details <ArrowRight className="w-4 h-4" />
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
              
              <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 300 }}>
                <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: '#94a3b8' }} />
                <input
                  className="input"
                  style={{ paddingLeft: 36, fontSize: 13 }}
                  placeholder="Search…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', background: '#f1f5f9', padding: 4, borderRadius: 0 }}>
                <button 
                  onClick={() => setViewTab('Correspondences')}
                  style={{ 
                    padding: '6px 16px', borderRadius: 0, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: viewTab === 'Correspondences' ? '#fff' : 'transparent',
                    color: viewTab === 'Correspondences' ? '#0f172a' : '#64748b',
                    boxShadow: viewTab === 'Correspondences' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap'
                  }}
                >
                  Correspondences ({Array.from(subCategoryGroups.values()).reduce((acc, curr: any) => acc + curr.corrs.length, 0)})
                </button>
                <button 
                  onClick={() => setViewTab('Tasks')}
                  style={{ 
                    padding: '6px 16px', borderRadius: 0, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: viewTab === 'Tasks' ? '#fff' : 'transparent',
                    color: viewTab === 'Tasks' ? '#0f172a' : '#64748b',
                    boxShadow: viewTab === 'Tasks' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap'
                  }}
                >
                  Tasks ({Array.from(subCategoryGroups.values()).reduce((acc, curr: any) => acc + curr.tasks.length, 0)})
                </button>
              </div>
            </div>

            {/* Sub-categories */}
            {Array.from(subCategoryGroups.entries()).sort().map(([subCat, data]) => {
              const hasContent = viewTab === 'Correspondences' ? data.corrs.length > 0 : data.tasks.length > 0;
              if (!hasContent) return null;
              
              return (
                <div key={subCat} style={{ marginBottom: 32 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: '#475569', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
                    <FolderOpen className="w-4 h-4 text-primary" style={{ opacity: 0.7 }} />
                    {subCat}
                  </h3>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                    {viewTab === 'Correspondences' ? (
                      data.corrs.map(item => (
                        <CorrCard 
                          key={`corr-${item.id}`} 
                          item={item} 
                          tasks={tasks} 
                          milestones={milestones} 
                          onTaskClick={setSelectedTask} 
                          onCorrClick={setSelectedCorr}
                          projectUsers={projectUsers} 
                        />
                      ))
                    ) : (
                      data.tasks.map(task => (
                        <TaskCard key={`task-${task.id}`} task={task} />
                      ))
                    )}
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
                    <span style={{ padding: '3px 10px', borderRadius: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: selectedTask.status === 'Done' ? '#dcfce7' : selectedTask.status === 'In Progress' ? '#dbeafe' : '#f1f5f9',
                      color: selectedTask.status === 'Done' ? '#15803d' : selectedTask.status === 'In Progress' ? '#1d4ed8' : '#475569',
                    }}>{selectedTask.status}</span>
                    <span style={{ padding: '3px 10px', borderRadius: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: priorityColor[selectedTask.priority] ? `${priorityColor[selectedTask.priority]}20` : '#f1f5f9',
                      color: priorityColor[selectedTask.priority] || '#475569'
                    }}>{selectedTask.priority} Priority</span>
                  </div>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>{selectedTask.taskName}</h2>
                </div>
                  <button 
                   onClick={() => setSelectedTask(null)} 
                   style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24, padding: '16px', background: '#f8fafc', borderRadius: 0, border: '1px solid var(--border)' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Assigned To</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      {(() => {
                        const u = projectUsers.find(pu => pu.id === selectedTask.assignedToId);
                        return u?.photoURL ? (
                          <img src={u.photoURL} className="avatar" style={{ width: 18, height: 18, objectFit: 'cover' }} alt="" />
                        ) : (
                          <span style={{ width: 10, height: 10, borderRadius: 0, background: u?.userColor || getUserColor(selectedTask.assignedToId || selectedTask.assignedTo) }} />
                        );
                      })()}
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{selectedTask.assignedTo || 'Unassigned'}</span>
                    </div>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Assigned By</span>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {(() => {
                        const u = projectUsers.find(pu => pu.id === selectedTask.assignedById);
                        return u?.photoURL ? (
                          <img src={u.photoURL} className="avatar" style={{ width: 16, height: 16, objectFit: 'cover', opacity: 0.8 }} alt="" />
                        ) : (
                          <span style={{ width: 8, height: 8, borderRadius: 0, background: u?.userColor || getUserColor(selectedTask.assignedById || selectedTask.assignedBy), opacity: 0.6 }} />
                        );
                      })()}
                      {selectedTask.assignedBy || '—'}
                    </div>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Due Date</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: isOverdue(selectedTask.dueDate) && selectedTask.status !== 'Done' ? '#dc2626' : '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}><Calendar className="w-4 h-4" /> {selectedTask.dueDate || 'No deadline'}</span>
                  </div>
                  {(selectedTask.correspondingSerialNumber || selectedTask.correspondingSubject) && (
                    <div>
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Linked Corresponding</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={selectedTask.correspondingSubject}>
                        <Link2 className="w-4 h-4 flex-shrink-0" /> 
                        {(() => {
                          const linkedCorr = correspondences.find(c => c.id === selectedTask.correspondingId);
                          return selectedTask.correspondingSerialNumber 
                            || (linkedCorr ? `REF: ${linkedCorr.serialNumber}` : selectedTask.correspondingSubject);
                        })()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Milestones inside Modal */}
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Target className="w-4 h-4 text-primary" /> Milestones
                  </h4>
                  
                  {milestones.filter(m => m.taskId === selectedTask.id).length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', background: '#f8fafc', borderRadius: 0, border: '1px dashed var(--border)', color: '#94a3b8', fontSize: 13 }}>
                      No milestones for this task.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {milestones.filter(m => m.taskId === selectedTask.id).map(ms => (
                        <div key={ms.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          <div style={{ width: 24, height: 24, borderRadius: 0, background: ms.status === 'Done' ? '#dcfce7' : ms.status === 'In Progress' ? '#dbeafe' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                            {ms.status === 'Done' && <CheckSquare className="w-3.5 h-3.5 text-success" style={{ color: '#15803d' }} />}
                            {ms.status === 'In Progress' && <Clock className="w-3.5 h-3.5 text-primary" style={{ color: '#1d4ed8' }} />}
                            {ms.status !== 'Done' && ms.status !== 'In Progress' && <div style={{ width: 6, height: 6, borderRadius: 0, background: '#94a3b8' }} />}
                          </div>
                          <div style={{ flex: 1, padding: '12px 16px', background: '#f8fafc', borderRadius: 0, border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                              <span style={{ fontWeight: 600, fontSize: 14, color: ms.status === 'Done' ? '#94a3b8' : '#0f172a', textDecoration: ms.status === 'Done' ? 'line-through' : 'none' }}>{ms.title}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 0, background: 'var(--surface)', color: 'var(--text-muted)' }}>{ms.status}</span>
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
      
      {/* ── Correspondence Details Modal ── */}
      <AnimatePresence>
        {selectedCorr && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(4px)' }}
            onClick={() => setSelectedCorr(null)}
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
              <div style={{ padding: '24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#f8fafc' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    <span style={{ padding: '4px 12px', borderRadius: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: 'var(--surface-3)',
                      color: 'var(--text-secondary)',
                    }}>{selectedCorr.status}</span>
                    <span style={{ padding: '4px 12px', borderRadius: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: priorityColor[selectedCorr.priority] ? `${priorityColor[selectedCorr.priority]}20` : '#f1f5f9',
                      color: priorityColor[selectedCorr.priority] || '#475569'
                    }}>{selectedCorr.priority} Priority</span>
                    <span style={{ padding: '4px 12px', borderRadius: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: CATEGORY_COLORS[selectedCorr.category]?.bg || '#f1f5f9',
                      color: CATEGORY_COLORS[selectedCorr.category]?.text || '#475569',
                      display: 'flex', alignItems: 'center', gap: 4
                    }}>
                      {CATEGORY_COLORS[selectedCorr.category]?.icon} {selectedCorr.category}
                    </span>
                  </div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, lineHeight: 1.3 }}>{selectedCorr.subject}</h2>
                  {selectedCorr.serialNumber && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginTop: 4, letterSpacing: '0.02em' }}>
                      REF: {selectedCorr.serialNumber}
                    </div>
                  )}
                </div>
                <button 
                  onClick={() => setSelectedCorr(null)} 
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
                     <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Correspondence Body</h3>
                   </div>
                   <div style={{ padding: '20px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 0, color: '#334155', fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                    {selectedCorr.body || <span style={{ fontStyle: 'italic', color: '#94a3b8' }}>No content provided.</span>}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 32 }}>
                  <div className="card-minimal" style={{ padding: '16px', background: '#f1f5f9', border: 'none' }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>Sent From</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                      <Building2 className="w-4 h-4 text-muted" />
                      {selectedCorr.sentFrom}
                    </div>
                    {selectedCorr.department && (
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, marginLeft: 24 }}>{selectedCorr.department}</div>
                    )}
                  </div>

                  <div className="card-minimal" style={{ padding: '16px', background: '#f1f5f9', border: 'none' }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>Dates</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Calendar className="w-4 h-4 text-muted" />
                        Received: {selectedCorr.dateReceived}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: isOverdue(selectedCorr.deadline) && selectedCorr.status !== 'Closed' ? '#dc2626' : '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Flag className="w-4 h-4 text-muted" />
                        Deadline: {selectedCorr.deadline || 'None'}
                      </div>
                    </div>
                  </div>

                  <div className="card-minimal" style={{ padding: '16px', background: '#f1f5f9', border: 'none' }}>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>Assignment</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {(() => {
                        const u = projectUsers.find(pu => pu.id === selectedCorr.assignedToId);
                        return (
                          <>
                            {u?.photoURL ? (
                              <img src={u.photoURL} className="avatar" style={{ width: 24, height: 24, objectFit: 'cover' }} alt="" />
                            ) : (
                              <div style={{ width: 24, height: 24, borderRadius: 0, background: u?.userColor || getUserColor(selectedCorr.assignedToId || ''), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                                {selectedCorr.assignedTo?.[0] || '?'}
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{selectedCorr.assignedTo || 'Unassigned'}</div>
                              {selectedCorr.assignedAt && (
                                <div style={{ fontSize: 11, color: '#64748b' }}>Assigned {formatDate(selectedCorr.assignedAt)}</div>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {(selectedCorr.filePaths && selectedCorr.filePaths.length > 0) && (
                  <div style={{ marginBottom: 32 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Link2 className="w-4 h-4 text-primary" />
                      <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shared Folders / Links</h3>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {selectedCorr.filePaths.map((path, idx) => (
                        <div key={idx} style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span
                            onClick={() => openOrCopyPath(path)}
                            title="Click to open (web link) or copy this path"
                            style={{ fontSize: 13, color: '#334155', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                          >{path}</span>
                          <button
                            onClick={() => openOrCopyPath(path)}
                            title="Open (web link) or copy this path"
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '4px 8px', height: 'auto' }}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedCorr.attachedFile && (
                  <div style={{ marginBottom: 32 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Paperclip className="w-4 h-4 text-primary" />
                      <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Attachment</h3>
                    </div>
                    <a 
                      href={selectedCorr.attachedFile} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ 
                        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: '#eff6ff', 
                        border: '1px solid #bfdbfe', borderRadius: 0, color: '#1e40af', textDecoration: 'none',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#dbeafe'}
                      onMouseLeave={e => e.currentTarget.style.background = '#eff6ff'}
                    >
                      <div style={{ background: '#fff', padding: 8, borderRadius: 0 }}>
                        <FileText className="w-5 h-5" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedCorr.attachedFileName || 'View Attachment'}</div>
                        <div style={{ fontSize: 11, opacity: 0.8 }}>Click to open in new tab</div>
                      </div>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                )}

                {selectedCorr.notes && (
                  <div style={{ marginBottom: 32 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Briefcase className="w-4 h-4 text-primary" />
                      <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Internal Notes</h3>
                    </div>
                    <div style={{ padding: '16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 0, color: '#92400e', fontSize: 14, fontStyle: 'italic' }}>
                      "{selectedCorr.notes}"
                    </div>
                  </div>
                )}
                
                {tasks.find(t => t.correspondingId === selectedCorr.id || t.id === selectedCorr.convertedToTaskId) && (
                   <button 
                    className="btn btn-primary w-full" 
                    style={{ marginTop: 8, gap: 10, height: 48 }}
                    onClick={() => {
                      const t = tasks.find(t => t.correspondingId === selectedCorr.id || t.id === selectedCorr.convertedToTaskId);
                      if (t) {
                        setSelectedCorr(null);
                        setSelectedTask(t);
                      }
                    }}
                   >
                     <Target className="w-4 h-4" /> View Linked Task
                   </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

