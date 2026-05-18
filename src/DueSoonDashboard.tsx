import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './lib/firebase';
import { User } from 'firebase/auth';
import { AppUser, Task, Corresponding } from './types';
import { AppView } from './App';
import { isDueSoon, isOverdue } from './utils';
import { requestOpen } from './lib/deepLink';
import { AlertCircle, ArrowRight, Clock } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

type Row = {
  id: string;
  kind: 'Task' | 'Correspondence';
  title: string;
  due: string;
  assignedTo?: string;
  overdue: boolean;
};

const CLOSED = ['Done', 'Closed', 'Archived'];

/**
 * "Due Soon" page — a single place listing every task and correspondence due
 * within 48h (plus anything already overdue and still open). Clicking a row
 * deep-links into the originating dashboard and opens that exact record
 * (src/lib/deepLink.ts). Reached from the orange alert icon in the top nav.
 */
export default function DueSoonDashboard({ onNavigate }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [corrs, setCorrs] = useState<Corresponding[]>([]);

  useEffect(() => {
    const unsubT = onSnapshot(collection(db, 'tasks'), snap => {
      setTasks(snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Task)));
    });
    const unsubC = onSnapshot(collection(db, 'correspondences'), snap => {
      setCorrs(snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Corresponding)));
    });
    return () => { unsubT(); unsubC(); };
  }, []);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];

    tasks.forEach(t => {
      if (CLOSED.includes(t.status)) return;
      if (!t.dueDate) return;
      const overdue = isOverdue(t.dueDate);
      if (!overdue && !isDueSoon(t.dueDate)) return;
      out.push({
        id: t.id, kind: 'Task', title: t.taskName, due: t.dueDate,
        assignedTo: t.assignedTo, overdue,
      });
    });

    corrs.forEach(c => {
      if (CLOSED.includes(c.status)) return;
      if (!c.deadline) return;
      const overdue = isOverdue(c.deadline);
      if (!overdue && !isDueSoon(c.deadline)) return;
      out.push({
        id: c.id, kind: 'Correspondence', title: c.subject, due: c.deadline,
        assignedTo: c.assignedTo, overdue,
      });
    });

    // Soonest (and most overdue) first.
    return out.sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());
  }, [tasks, corrs]);

  const open = (r: Row) => {
    if (r.kind === 'Task') {
      requestOpen({ type: 'task', id: r.id });
      onNavigate('tasks');
    } else {
      requestOpen({ type: 'corresponding', id: r.id });
      onNavigate('correspondences');
    }
  };

  const fmt = (s: string) => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const overdueCount = rows.filter(r => r.overdue).length;

  return (
    <div style={{ padding: '24px 0', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ background: '#f97316', padding: 8, borderRadius: 0 }}>
          <AlertCircle className="w-5 h-5" style={{ color: '#fff' }} />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Due Soon</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 24px' }}>
        Tasks and correspondences due within 48 hours{overdueCount > 0 ? `, including ${overdueCount} already overdue` : ''}. Click any item to open it.
      </p>

      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 16px', color: 'var(--text-muted)' }}>
          <Clock className="w-8 h-8" style={{ margin: '0 auto 12px', opacity: 0.4 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)' }}>Nothing due soon</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>You're all caught up.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => (
            <motion.div
              key={`${r.kind}-${r.id}`}
              className="card"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => open(r)}
              style={{
                padding: '14px 18px', background: '#fff', cursor: 'pointer',
                borderLeft: `4px solid ${r.overdue ? '#ef4444' : '#f97316'}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
                    color: r.kind === 'Task' ? '#6366f1' : '#0ea5e9',
                  }}>{r.kind}</span>
                  {r.overdue && (
                    <span style={{
                      fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
                      color: '#fff', background: '#ef4444', padding: '1px 6px',
                    }}>Overdue</span>
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{r.title}</div>
                <div style={{ fontSize: 12, color: r.overdue ? '#dc2626' : '#64748b', marginTop: 3 }}>
                  Due: {fmt(r.due)}{r.assignedTo ? ` · ${r.assignedTo}` : ''}
                </div>
              </div>
              <ArrowRight className="w-4 h-4" style={{ color: '#94a3b8', flexShrink: 0 }} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
