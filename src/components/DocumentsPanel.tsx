import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, runTransaction, where } from 'firebase/firestore';
import {
  FileText, Mail, FileSignature, Receipt, ClipboardList, BarChart2, PenTool, File,
  Plus, Search, ExternalLink, Copy, Check, Pencil, Trash2, Upload, Loader2, FolderOpen, CheckSquare,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { subscribeVisibleTasks } from '../lib/taskVisibility';
import { requestOpen } from '../lib/deepLink';
import { uploadToDrive, MAX_UPLOAD_BYTES } from '../lib/driveUpload';
import { useFormat } from '../lib/format';
import {
  DOC_KINDS, DOC_DIRECTIONS, gatherDocuments, searchDocuments, highlightRanges, snippet, linkKind,
  validateDocument, buildDocument, addDocument, updateDocument, removeDocument, canChangeDocument,
  countByKind, SUMMARY_MAX,
  type DocKind, type DocDirection, type DocRow, type DocumentInput, type ProjectDocument, type DocProblem,
} from '../lib/projectDocuments';
import { AppUser, Project } from '../types';
import type { AppView } from '../App';
import { attachmentClick } from '../lib/driveFiles';

// ─── Shared bits (the project tab AND the department-wide Documents page) ────

export const KIND_ICON: Record<DocKind, React.ReactNode> = {
  letter: <Mail size={15} />,
  offer: <FileSignature size={15} />,
  minutes: <ClipboardList size={15} />,
  contract: <FileText size={15} />,
  invoice: <Receipt size={15} />,
  report: <BarChart2 size={15} />,
  drawing: <PenTool size={15} />,
  other: <File size={15} />,
};

/** Literal t() calls so the harness key audit can see every label. */
export function useDocLabels() {
  const { t } = useTranslation();
  return useMemo(() => ({
    kind: {
      letter: t('Letter'), offer: t('Offer'), minutes: t('Minutes'), contract: t('Contract'),
      invoice: t('Invoice / claim'), report: t('Report'), drawing: t('Drawing'), other: t('Other document'),
    } as Record<DocKind, string>,
    direction: {
      in: t('Received (incoming)'), out: t('Sent (outgoing)'), internal: t('Internal'),
    } as Record<DocDirection, string>,
  }), [t]);
}

/** Paints the query's words inside `text` (Arabic-aware — see highlightRanges). */
export function Marked({ text, q }: { text: string; q: string }) {
  const ranges = highlightRanges(text, q);
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(<mark key={i} style={{ background: 'rgba(245,158,11,0.3)', color: 'inherit', padding: 0 }}>{text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{ fontSize: 12, padding: '4px 8px' }}
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }
        catch { window.prompt(t('Copy this path:'), value); }
      }}
      title={value}
      data-docs="copy-path"
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? t('Copied') : t('Copy path')}
    </button>
  );
}

interface RowProps {
  row: DocRow;
  q: string;
  /** Shown on the department-wide page: which project the document is filed under. */
  showProject?: boolean;
  canEdit?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onNavigate?: (v: AppView) => void;
}

export function DocumentRow({ row, q, showProject, canEdit, onEdit, onRemove, onNavigate }: RowProps) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const L = useDocLabels();
  const lk = linkKind(row.link);
  const body = snippet(row.summary, q);
  const openRecord = () => {
    if (!onNavigate) return;
    if (row.source === 'letter') { requestOpen({ type: 'corresponding', id: row.recordId, label: row.title, serial: row.refNo }); onNavigate('correspondences'); }
    if (row.source === 'task') { requestOpen({ type: 'task', id: row.recordId, label: row.title, serial: row.refNo }); onNavigate('tasks'); }
  };
  const openProject = () => {
    if (!onNavigate) return;
    requestOpen({ type: 'project', id: row.projectId, label: row.projectName, tab: 'documents' });
    onNavigate('projects');
  };

  return (
    <div className="card" style={{ padding: '12px 14px', display: 'grid', gap: 6 }} data-docs="row" data-key={row.key}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }}>{KIND_ICON[row.kind]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={fmt.bidiFor(row.title)} style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', overflowWrap: 'anywhere' }} data-docs="title">
            <Marked text={row.title} q={q} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{L.kind[row.kind]}</span>
            {row.direction && <span>{L.direction[row.direction]}</span>}
            {row.date && <span className="ltr-data">{fmt.date(row.date)}</span>}
            {row.refNo && <span className="ltr-data"><Marked text={row.refNo} q={q} /></span>}
            {row.party && <span className={fmt.bidiFor(row.party)}><Marked text={row.party} q={q} /></span>}
            {row.source === 'letter' && <span>{t('From the Correspondences board')}</span>}
            {row.source === 'task' && <span>{t('Attached to a task')}</span>}
            {row.source === 'filed' && row.addedBy && <span>{t('Filed by {{name}}', { name: row.addedBy })}</span>}
          </div>
        </div>
      </div>

      {showProject && (
        <button type="button" onClick={openProject} data-docs="project-link"
          style={{ justifySelf: 'start', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color: 'var(--blue-600)', textAlign: 'start' }}>
          <FolderOpen size={13} style={{ verticalAlign: '-2px' }} /> <span className={fmt.bidiFor(row.projectName)}><Marked text={row.projectName} q={q} /></span>
          {row.client && <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}> · {row.client}</span>}
        </button>
      )}

      {body && (
        <p className={fmt.bidiFor(body)} style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }} data-docs="snippet">
          <Marked text={body} q={q} />
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {lk === 'url' && (
          <a className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px' }} href={row.link} onClick={attachmentClick(row.link, row.fileName)} target="_blank" rel="noopener noreferrer" data-docs="open-file">
            <ExternalLink size={13} /> {row.fileName ? <span className="bidi-isolate" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.fileName}</span> : t('Open file')}
          </a>
        )}
        {lk === 'path' && <><span className="ltr-data" style={{ fontSize: 11.5, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{row.link}</span><CopyButton value={row.link!} /></>}
        {(row.paths || []).map(p => (
          <React.Fragment key={p}>
            <span className="ltr-data" style={{ fontSize: 11.5, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}><Marked text={p} q={q} /></span>
            <CopyButton value={p} />
          </React.Fragment>
        ))}
        {row.source === 'letter' && onNavigate && (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px' }} onClick={openRecord} data-docs="open-record">
            <Mail size={13} /> {t('Open the letter')}
          </button>
        )}
        {row.source === 'task' && onNavigate && (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px' }} onClick={openRecord} data-docs="open-record">
            <CheckSquare size={13} /> {t('Open the task')}
          </button>
        )}
        {canEdit && onEdit && (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px', marginInlineStart: 'auto' }} onClick={onEdit} data-docs="edit">
            <Pencil size={13} /> {t('Edit')}
          </button>
        )}
        {canEdit && onRemove && (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px', color: '#dc2626', ...(onEdit ? {} : { marginInlineStart: 'auto' }) }} onClick={onRemove} data-docs="remove">
            <Trash2 size={13} /> {t('Remove')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── The form ────────────────────────────────────────────────────────────────

const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const EMPTY: DocumentInput = { kind: 'letter', title: '', date: '', direction: undefined, refNo: '', party: '', summary: '', link: '', fileName: '' };

function DocumentForm({ initial, busy, onSave, onCancel }: {
  initial: DocumentInput;
  busy: boolean;
  onSave: (input: DocumentInput) => Promise<DocProblem | null>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const L = useDocLabels();
  const [f, setF] = useState<DocumentInput>(initial);
  const [problem, setProblem] = useState<DocProblem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const set = <K extends keyof DocumentInput>(k: K, v: DocumentInput[K]) => setF(p => ({ ...p, [k]: v }));

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    if (file.size > MAX_UPLOAD_BYTES) { setUploadError(t('Max file size is 10MB.')); return; }
    setUploading(true);
    try {
      const url = await uploadToDrive(file);
      setF(p => ({ ...p, link: url, fileName: file.name, title: p.title || file.name.replace(/\.[^.]+$/, '') }));
    } catch (err: any) {
      console.error('document upload failed:', err);
      setUploadError(t('The file could not be uploaded. Paste a link or a folder path instead.'));
    } finally {
      setUploading(false);
    }
  };

  const MESSAGE: Record<DocProblem, string> = {
    title: t('Give the document a title.'),
    kind: t('Choose what kind of document it is.'),
    date: t('The date is not valid.'),
    link: t('The link must start with https:// or be a folder path on the file server.'),
    full: t('This project already holds the most documents one project can keep.'),
  };
  const lk = linkKind(f.link);

  return (
    <form
      className="card"
      style={{ padding: 16, display: 'grid', gap: 12 }}
      data-docs="form"
      onSubmit={async e => { e.preventDefault(); setProblem(await onSave(f)); }}
    >
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="input-label">{t('Type')}</span>
          <select className="input" value={f.kind} onChange={e => set('kind', e.target.value as DocKind)} data-docs="kind">
            {DOC_KINDS.map(k => <option key={k} value={k}>{L.kind[k]}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="input-label">{t('Date on the document')}</span>
          <input className="input" type="date" value={f.date || ''} onChange={e => set('date', e.target.value)} data-docs="date" />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="input-label">{t('Incoming or outgoing')}</span>
          <select className="input" value={f.direction || ''} onChange={e => set('direction', (e.target.value || undefined) as DocDirection | undefined)} data-docs="direction">
            <option value="">—</option>
            {DOC_DIRECTIONS.map(d => <option key={d} value={d}>{L.direction[d]}</option>)}
          </select>
        </label>
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="input-label">{t('Title')} *</span>
        <input className="input" value={f.title} onChange={e => set('title', e.target.value)} placeholder={t('e.g. Request to extend the contract by 30 days')} data-docs="title-input" />
      </label>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="input-label">{t('Reference number')}</span>
          <input className="input" value={f.refNo || ''} onChange={e => set('refNo', e.target.value)} placeholder="EPROM/BD/2026/118" data-docs="ref" />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="input-label">{t('From / to')}</span>
          <input className="input" value={f.party || ''} onChange={e => set('party', e.target.value)} placeholder={t('Company or person')} data-docs="party" />
        </label>
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="input-label">{t('Link or folder path')}</span>
        <input className="input ltr-data" dir="ltr" value={f.link || ''} onChange={e => set('link', e.target.value)} placeholder="https://…  ·  \\eprom-fs01\Commercial\…" data-docs="link" />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-muted)' }}>
        <label className="btn btn-ghost" style={{ fontSize: 12.5, cursor: uploading ? 'wait' : 'pointer' }}>
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? t('Uploading to Drive...') : t('Or upload a file')}
          <input type="file" style={{ display: 'none' }} onChange={onFile} disabled={uploading} data-docs="upload" />
        </label>
        {f.fileName && lk === 'url' && <span className="bidi-isolate">{f.fileName}</span>}
        {uploadError && <span style={{ color: '#dc2626', fontWeight: 600 }}>{uploadError}</span>}
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="input-label">{t('Text or main points')}</span>
        <textarea className="input" rows={4} maxLength={SUMMARY_MAX} value={f.summary || ''} onChange={e => set('summary', e.target.value)} placeholder={t('Paste the text of the letter or write its main points — the search reads this.')} data-docs="summary" style={{ resize: 'vertical', fontFamily: 'inherit' }} />
      </label>
      {problem && <div style={{ padding: '8px 12px', background: '#fee2e2', color: '#991b1b', fontSize: 13, fontWeight: 600 }} data-docs="problem">{MESSAGE[problem]}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('Cancel')}</button>
        <button type="submit" className="btn btn-primary" disabled={busy || uploading} data-docs="save">{t('Save')}</button>
      </div>
    </form>
  );
}

// ─── The project tab ─────────────────────────────────────────────────────────

interface PanelProps {
  project: Project;
  user: User;
  appUser: AppUser;
  onNavigate?: (v: AppView) => void;
}

/**
 * Documents tab of a project page (queue D4): everything filed against the
 * project, the letters linked to it and the files on its tasks, in one list
 * with one Arabic-aware search box. Filing / editing / removing goes through a
 * transaction on the project's `documents` array — the same re-read-then-change
 * pattern as the checklist, so two people filing at once never lose an entry.
 */
export default function ProjectDocumentsPanel({ project, user, appUser, onNavigate }: PanelProps) {
  const { t } = useTranslation();
  const L = useDocLabels();
  const [letters, setLetters] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<DocKind | 'all'>('all');
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'correspondences'), where('projectId', '==', project.id)),
      s => setLetters(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => { console.warn('Documents — letters listener:', err.code); setLetters([]); });
    // Privacy-aware: a private task's file stays private.
    const u2 = subscribeVisibleTasks(user.uid, list => setTasks(list.filter(x => x.projectId === project.id)), () => setTasks([]));
    return () => { u1(); u2(); };
  }, [project.id, user.uid]);

  const filed = useMemo(() => (Array.isArray(project.documents) ? project.documents : []), [project.documents]);
  const rows = useMemo(
    () => gatherDocuments({ projects: [{ id: project.id, name: project.name, client: project.client, documents: filed }], letters, tasks }),
    [project.id, project.name, project.client, filed, letters, tasks],
  );
  const hits = useMemo(() => searchDocuments(rows, q, { kind }), [rows, q, kind]);
  const counts = useMemo(() => countByKind(rows), [rows]);

  const mutate = async (fn: (cur: ProjectDocument[]) => ProjectDocument[]) => {
    setBusy(true);
    setError(null);
    try {
      await runTransaction(db, async tx => {
        const ref = doc(db, 'projects', project.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('project gone');
        const cur = Array.isArray(snap.data().documents) ? (snap.data().documents as ProjectDocument[]) : [];
        // No updatedAt bump on purpose: filing a paper is not a change to the
        // project itself, and updatedAt drives the project's "last touched".
        tx.update(ref, { documents: fn(cur) });
      });
      return true;
    } catch (e) {
      console.error('documents update failed:', e);
      setError(t('Failed to save the document. Please try again.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (input: DocumentInput): Promise<DocProblem | null> => {
    const isNew = editing === 'new';
    const problem = validateDocument(input, filed.length, isNew);
    if (problem) return problem;
    const done = isNew
      ? await mutate(cur => addDocument(cur, buildDocument(input, { uid: user.uid, name: appUser.displayName })))
      : await mutate(cur => updateDocument(cur, editing as string, input));
    if (done) setEditing(null);
    return null;
  };

  const remove = async (id: string, title: string) => {
    if (!window.confirm(t('Remove "{{title}}" from this project? The file itself is not deleted.', { title }))) return;
    await mutate(cur => removeDocument(cur, id));
  };

  const editingDoc = editing && editing !== 'new' ? filed.find(d => d.id === editing) : null;
  const initial: DocumentInput = editingDoc
    ? { ...EMPTY, ...editingDoc }
    : { ...EMPTY, date: today() };

  return (
    <div style={{ display: 'grid', gap: 14 }} data-testid="documents-panel">
      {error && <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#991b1b', fontSize: 13, fontWeight: 600 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
          <Search size={15} style={{ position: 'absolute', insetInlineStart: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" style={{ paddingInlineStart: 32, width: '100%' }} value={q} onChange={e => setQ(e.target.value)}
            placeholder={t('Search this project’s documents — Arabic or English')} data-docs="search" />
        </div>
        <select className="input" style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value as DocKind | 'all')} data-docs="kind-filter">
          <option value="all">{t('All types')} ({rows.length})</option>
          {DOC_KINDS.filter(k => counts[k] > 0).map(k => <option key={k} value={k}>{L.kind[k]} ({counts[k]})</option>)}
        </select>
        {editing !== 'new' && (
          <button className="btn btn-primary" onClick={() => setEditing('new')} data-docs="add">
            <Plus size={15} /> {t('File a document')}
          </button>
        )}
      </div>

      {editing === 'new' && (
        <DocumentForm key="new" initial={initial} busy={busy} onSave={save} onCancel={() => setEditing(null)} />
      )}

      {rows.length === 0 && editing !== 'new' ? (
        <div className="card" style={{ padding: 20, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6 }} data-docs="empty">
          {t('No documents on this project yet. File its letters, offers and minutes here — with a link or a folder path — and they can be found later by searching any word in them.')}
        </div>
      ) : (
        <>
          {(q || kind !== 'all') && (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 700 }} data-docs="count">
              {t('Found: {{count}}', { count: hits.length })}
            </div>
          )}
          {hits.map(({ row }) => (
            editing === row.recordId && row.source === 'filed' ? (
              <DocumentForm key={row.key} initial={initial} busy={busy} onSave={save} onCancel={() => setEditing(null)} />
            ) : (
              <DocumentRow
                key={row.key}
                row={row}
                q={q}
                canEdit={row.source === 'filed' && canChangeDocument(row, user.uid, appUser.role)}
                onEdit={() => setEditing(row.recordId)}
                onRemove={() => remove(row.recordId, row.title)}
                onNavigate={onNavigate}
              />
            )
          ))}
          {hits.length === 0 && rows.length > 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }} data-docs="none">{t('No document matches this search.')}</div>
          )}
        </>
      )}
    </div>
  );
}
