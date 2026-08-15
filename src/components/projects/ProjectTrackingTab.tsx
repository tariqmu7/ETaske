import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { User } from 'firebase/auth';
import { AppUser, Project, ProjectUpdate, PROJECT_STATUS_OPTIONS, ProjectStatus } from '../../types';
import { getUserColor } from '../../utils';
import { useDisplayLabel } from '../../lib/displayLabel';
import { useFormat, DATE_MEDIUM } from '../../lib/format';
import { Activity, Send, Clock } from 'lucide-react';
import ListControls, { SortDir } from './ListControls';

interface Props {
  project: Project;
  user: User;
  appUser: AppUser;
}

export default function ProjectTrackingTab({ project, user, appUser }: Props) {
  const { t } = useTranslation();
  const dl = useDisplayLabel();
  const fmt = useFormat();
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<ProjectStatus>(project.status || 'Active');
  const [posting, setPosting] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    const q = query(collection(db, 'projectUpdates'), where('projectId', '==', project.id));
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectUpdate));
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setUpdates(rows);
    }, err => console.error('projectUpdates listener:', err));
    return () => unsub();
  }, [project.id]);

  // The filter is built from the statuses actually posted. The VALUE stays the
  // stored English word — only its label goes through the display layer.
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    updates.forEach(u => { if (u.status) set.add(u.status); });
    return [{ value: 'all', label: t('All statuses') }, ...Array.from(set).sort().map(v => ({ value: v, label: dl(v) }))];
  }, [updates, t, dl]);

  const visible = useMemo(() => {
    let rows = updates.slice();
    if (statusFilter !== 'all') rows = rows.filter(u => u.status === statusFilter);
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const r = sortKey === 'status'
        ? (a.status || '').localeCompare(b.status || '')
        : (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
      return r * dir;
    });
    return rows;
  }, [updates, statusFilter, sortKey, sortDir]);

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

  // A named-month timestamp, so it is Arabic under `ar` — hence no `.ltr-data`
  // on the spans that carry it.
  const when = (ts?: ProjectUpdate['createdAt']) =>
    ts ? fmt.dateTime(ts, { ...DATE_MEDIUM, hour: '2-digit', minute: '2-digit' }) : t('Just now');

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Current status / last update */}
      <div className="card stat-indigo" style={{ padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Activity className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{t('Current Status')}</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{dl(project.currentStatus || project.status)}</div>
        {project.lastUpdateText && (
          <p className={fmt.bidiFor(project.lastUpdateText)} style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '10px 0 0', lineHeight: 1.5 }}>{project.lastUpdateText}</p>
        )}
        {project.lastUpdateAt && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
            <Clock className="w-3.5 h-3.5" /> {t('Last updated {{date}}', { date: when(project.lastUpdateAt) })}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <select value={status} onChange={e => setStatus(e.target.value as ProjectStatus)} style={inputStyle}>
            {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{dl(s)}</option>)}
          </select>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={t('Post a status update…')}
          rows={2}
          style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="btn btn-primary" disabled={posting || !text.trim()} onClick={post}>
            <Send className="w-4 h-4" /> {posting ? t('Posting…') : t('Post update')}
          </button>
        </div>
      </div>

      {/* History */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px' }}>{t('History')}</h3>
        {updates.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>{t('No updates yet.')}</div>
        ) : (
          <>
          <ListControls
            filters={[
              { key: 'status', label: t('Status'), value: statusFilter, options: statusOptions, onChange: setStatusFilter },
            ]}
            sortOptions={[
              { value: 'date', label: t('Date posted') },
              { value: 'status', label: t('Status') },
            ]}
            sortValue={sortKey}
            onSortChange={setSortKey}
            sortDir={sortDir}
            onSortDirToggle={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            trailing={t('{{shown}} of {{total}}', { shown: visible.length, total: updates.length })}
          />
          {visible.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>{t('No updates match.')}</div>
          ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderInlineStart: '2px solid var(--border)', paddingInlineStart: 18, marginInlineStart: 6 }}>
            {visible.map(u => (
              <div key={u.id} style={{ position: 'relative', paddingBottom: 18 }}>
                <span style={{ position: 'absolute', insetInlineStart: -25, top: 4, width: 10, height: 10, borderRadius: '50%', background: u.authorColor || 'var(--accent)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                  {u.status && <span className="badge badge-inprogress">{dl(u.status)}</span>}
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{u.authorName}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{when(u.createdAt)}</span>
                </div>
                <p className={fmt.bidiFor(u.text)} style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{u.text}</p>
              </div>
            ))}
          </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '9px 11px', background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit',
};
