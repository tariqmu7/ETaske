import React, { useState, useEffect } from 'react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { User } from 'firebase/auth';
import { AppUser, Project, ProjectUpdate, PROJECT_STATUS_OPTIONS, ProjectStatus } from '../../types';
import { getUserColor } from '../../utils';
import { Activity, Send, Clock } from 'lucide-react';

interface Props {
  project: Project;
  user: User;
  appUser: AppUser;
}

export default function ProjectTrackingTab({ project, user, appUser }: Props) {
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<ProjectStatus>(project.status || 'Active');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'projectUpdates'), where('projectId', '==', project.id));
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectUpdate));
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setUpdates(rows);
    }, err => console.error('projectUpdates listener:', err));
    return () => unsub();
  }, [project.id]);

  const post = async () => {
    if (!text.trim()) return;
    setPosting(true);
    try {
      await addDoc(collection(db, 'projectUpdates'), {
        projectId: project.id,
        status,
        text: text.trim(),
        authorId: user.uid,
        authorName: appUser.displayName || 'Unknown',
        authorColor: appUser.userColor || getUserColor(appUser.displayName || user.uid),
        createdAt: serverTimestamp(),
      });
      // Keep the project's summary fields in sync with the latest update.
      await updateDoc(doc(db, 'projects', project.id), {
        currentStatus: status,
        lastUpdateText: text.trim(),
        lastUpdateAt: serverTimestamp(),
        status,
        updatedAt: serverTimestamp(),
      });
      setText('');
    } catch (e) {
      console.error('post update failed:', e);
    } finally {
      setPosting(false);
    }
  };

  const fmt = (ts?: ProjectUpdate['createdAt']) =>
    ts ? new Date(ts.seconds * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Current status / last update */}
      <div className="card stat-indigo" style={{ padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Activity className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Current Status</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{project.currentStatus || project.status}</div>
        {project.lastUpdateText && (
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '10px 0 0', lineHeight: 1.5 }}>{project.lastUpdateText}</p>
        )}
        {project.lastUpdateAt && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
            <Clock className="w-3.5 h-3.5" /> Last updated {fmt(project.lastUpdateAt)}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <select value={status} onChange={e => setStatus(e.target.value as ProjectStatus)} style={inputStyle}>
            {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Post a status update…"
          rows={2}
          style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="btn btn-primary" disabled={posting || !text.trim()} onClick={post}>
            <Send className="w-4 h-4" /> {posting ? 'Posting…' : 'Post update'}
          </button>
        </div>
      </div>

      {/* History */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px' }}>History</h3>
        {updates.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>No updates yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderLeft: '2px solid var(--border)', paddingLeft: 18, marginLeft: 6 }}>
            {updates.map(u => (
              <div key={u.id} style={{ position: 'relative', paddingBottom: 18 }}>
                <span style={{ position: 'absolute', left: -25, top: 4, width: 10, height: 10, borderRadius: '50%', background: u.authorColor || 'var(--accent)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                  {u.status && <span className="badge badge-inprogress">{u.status}</span>}
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{u.authorName}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt(u.createdAt)}</span>
                </div>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{u.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '9px 11px', background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit',
};
