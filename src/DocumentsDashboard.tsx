import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { FolderOpen, Search, X } from 'lucide-react';
import { db } from './lib/firebase';
import { subscribeVisibleTasks } from './lib/taskVisibility';
import {
  DOC_KINDS, DOC_DIRECTIONS, gatherDocuments, searchDocuments, countByKind,
  type DocKind, type DocDirection,
} from './lib/projectDocuments';
import { DocumentRow, useDocLabels } from './components/DocumentsPanel';
import { AppUser } from './types';
import type { AppView } from './App';

interface Props {
  user: User;
  appUser: AppUser;
  onNavigate: (v: AppView) => void;
}

const rows = (snap: any) => snap.docs.filter((d: any) => d.id !== '--stats--').map((d: any) => ({ id: d.id, ...d.data() }));

const PAGE = 40;

/**
 * Documents (queue task D4) — one search box over every document of every
 * project: what was filed on each project's Documents tab, the letters linked
 * to a project and the files on project tasks. Arabic or English, spelling-
 * insensitive (أ/ا, ة/ه, ى/ي, harakat, ٣/3, «ال»). A row opens its file, its
 * letter / task, or its project's Documents tab. Nothing is written here —
 * filing happens on the project page, where the document belongs.
 */
export default function DocumentsDashboard({ user, onNavigate }: Props) {
  const { t } = useTranslation();
  const L = useDocLabels();
  const [projects, setProjects] = useState<any[] | null>(null);
  const [letters, setLetters] = useState<any[] | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<DocKind | 'all'>('all');
  const [projectId, setProjectId] = useState<string>('all');
  const [direction, setDirection] = useState<DocDirection | 'all'>('all');
  const [shown, setShown] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'projects'), s => setProjects(rows(s)),
      err => { console.warn('Documents — projects listener:', err.code); setProjects([]); });
    const u2 = onSnapshot(collection(db, 'correspondences'), s => setLetters(rows(s)),
      err => { console.warn('Documents — correspondences listener:', err.code); setLetters([]); });
    const u3 = subscribeVisibleTasks(user.uid, list => setTasks(list), () => setTasks([]));
    inputRef.current?.focus();
    return () => { u1(); u2(); u3(); };
  }, [user.uid]);

  useEffect(() => setShown(PAGE), [q, kind, projectId, direction]);

  const loaded = !!(projects && letters);
  const all = useMemo(
    () => (loaded ? gatherDocuments({ projects: projects!, letters: letters!, tasks }) : []),
    [loaded, projects, letters, tasks],
  );
  const hits = useMemo(() => searchDocuments(all, q, { kind, projectId, direction }), [all, q, kind, projectId, direction]);
  const counts = useMemo(() => countByKind(all), [all]);
  const projectOptions = useMemo(() => {
    const withDocs = new Map<string, { name: string; n: number }>();
    for (const r of all) {
      const cur = withDocs.get(r.projectId);
      withDocs.set(r.projectId, { name: r.projectName, n: (cur?.n || 0) + 1 });
    }
    return [...withDocs.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [all]);
  const filtered = q.trim() !== '' || kind !== 'all' || projectId !== 'all' || direction !== 'all';

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px' }} data-testid="documents-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <FolderOpen className="w-6 h-6" style={{ color: 'var(--accent)' }} />
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{t('Documents')}</h1>
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.55 }}>
        {t('Every letter, offer and set of minutes filed against a project, plus the letters and task files linked to one. Search any word in them — Arabic or English.')}
      </p>

      <div className="card" style={{ padding: 12, display: 'grid', gap: 10, marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <Search size={17} style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            className="input"
            style={{ paddingInlineStart: 38, paddingInlineEnd: 36, width: '100%', fontSize: 15 }}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t('Search any word — e.g. minutes AGIBA, extension, claim 3')}
            data-docs="search"
          />
          {q && (
            <button type="button" className="btn btn-ghost btn-icon" aria-label={t('Clear')} onClick={() => setQ('')}
              style={{ position: 'absolute', insetInlineEnd: 4, top: '50%', transform: 'translateY(-50%)' }}>
              <X size={15} />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="input" style={{ flex: '1 1 170px', maxWidth: 320 }} value={kind} onChange={e => setKind(e.target.value as DocKind | 'all')} data-docs="kind-filter">
            <option value="all">{t('All types')}</option>
            {DOC_KINDS.filter(k => counts[k] > 0).map(k => <option key={k} value={k}>{L.kind[k]} ({counts[k]})</option>)}
          </select>
          <select className="input" style={{ flex: '1 1 170px', maxWidth: 320 }} value={projectId} onChange={e => setProjectId(e.target.value)} data-docs="project-filter">
            <option value="all">{t('All projects')}</option>
            {projectOptions.map(([id, p]) => <option key={id} value={id}>{p.name} ({p.n})</option>)}
          </select>
          <select className="input" style={{ flex: '1 1 170px', maxWidth: 320 }} value={direction} onChange={e => setDirection(e.target.value as DocDirection | 'all')} data-docs="direction-filter">
            <option value="all">{t('Incoming and outgoing')}</option>
            {DOC_DIRECTIONS.map(d => <option key={d} value={d}>{L.direction[d]}</option>)}
          </select>
        </div>
      </div>

      {!loaded ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {[0, 1, 2].map(i => <div key={i} className="card skeleton" style={{ height: 90 }} />)}
        </div>
      ) : all.length === 0 ? (
        <div className="card" style={{ padding: 20, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6 }} data-docs="empty">
          {t('No documents yet. Open a project and use its Documents tab to file letters, offers and minutes.')}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 10 }} data-docs="count">
            {filtered
              ? t('Found: {{count}}', { count: hits.length })
              : t('{{count}} documents across {{projects}} projects', { count: all.length, projects: projectOptions.length })}
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {hits.slice(0, shown).map(({ row }) => (
              <DocumentRow key={row.key} row={row} q={q} showProject onNavigate={onNavigate} />
            ))}
          </div>
          {hits.length === 0 && (
            <div style={{ fontSize: 13.5, color: 'var(--text-muted)', padding: '8px 0' }} data-docs="none">{t('No document matches this search.')}</div>
          )}
          {hits.length > shown && (
            <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setShown(s => s + PAGE)} data-docs="more">
              {t('Show {{count}} more', { count: Math.min(PAGE, hits.length - shown) })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
