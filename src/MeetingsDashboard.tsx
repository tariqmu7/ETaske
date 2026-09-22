import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { User } from 'firebase/auth';
import {
  addDoc, collection, deleteDoc, deleteField, doc, onSnapshot, runTransaction, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import {
  Users2, Plus, ArrowLeft, ArrowUp, ArrowDown, Trash2, Copy, Check, Mail, Sparkles, ListChecks,
  ClipboardList, CheckSquare, FileText, Save, Info, CalendarClock, FolderOpen,
} from 'lucide-react';
import { db } from './lib/firebase';
import { subscribeVisibleTasks } from './lib/taskVisibility';
import { requestOpen } from './lib/deepLink';
import { getNextSerialNumber } from './lib/counters';
import { createNotification } from './lib/pushNotification';
import { taskDetails } from './lib/notifyDetails';
import { announceNewRecord, actorFrom, hasAnyLink } from './lib/recordLinks';
import { useFormat, DATE_MEDIUM } from './lib/format';
import { useDisplayLabel } from './lib/displayLabel';
import { copyToClipboard } from './utils';
import {
  buildDocument, addDocument, updateDocument, SUMMARY_MAX, type ProjectDocument,
} from './lib/projectDocuments';
import {
  validateMeeting, meetingFields, meetingStage, hasMinutes, listMeetings, canEditMeeting, canDeleteMeeting, isMyMeeting,
  actionState, actionSummary, readyActions, actionTaskFields, actionsFromNotes, minutesText,
  suggestAgenda, buildInvitation, buildMinutes, meetingMailto, meetingHash, meetingFromHash,
  newItemId, isoDay, MAX_AGENDA, MAX_ACTIONS,
  type Meeting, type AgendaItem, type ActionPoint, type AgendaSuggestion, type MeetingLang, type MeetingProblem,
  type ActionState, type MeetingRef,
} from './lib/meetings';
import RecordLinkPicker from './components/RecordLinkPicker';
import { AppUser, RecordLinks, TaskPriority, PRIORITY_OPTIONS } from './types';
import type { AppView } from './App';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

const rows = (snap: any) => snap.docs.filter((d: any) => d.id !== '--stats--').map((d: any) => ({ id: d.id, ...d.data() }));

/** yyyy-mm-dd → a local Date (new Date('yyyy-mm-dd') would be UTC midnight). */
const localDate = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Keys a save must REMOVE when the draft no longer has them (updateDoc merges). */
const OPTIONAL_KEYS = [
  'time', 'place', 'guests', 'client', 'notes', 'minutesDocId',
  'opportunityId', 'opportunitySerial', 'opportunityTitle', 'projectId', 'projectName',
] as const;

const PROBLEM_TEXT: Record<MeetingProblem, string> = {
  title: 'Give the meeting a title.',
  date: 'The date is not valid.',
  time: 'The time is not valid.',
};

type Tab = 'agenda' | 'minutes' | 'actions';

const chip = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px', minHeight: 36, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
  background: active ? 'var(--blue-600)' : 'var(--surface)', color: active ? '#fff' : 'var(--text-secondary)',
  border: `1px solid ${active ? 'var(--blue-600)' : 'var(--border)'}`,
});

const small: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', minHeight: 32, cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 12, fontWeight: 600, background: 'var(--surface)', color: 'var(--blue-600)', border: '1px solid var(--border)',
};

const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 };

/**
 * Meetings (queue task D5) — agenda before, minutes after, action points that
 * land on the Tasks board. `#/meetings` lists them; `#/meetings?id=<id>` opens
 * one. The thinking (suggestions, reading action points out of the notes, the
 * letters) is in `lib/meetings.ts`, pure and harness-covered.
 *
 * Writes: the meeting doc (`meetings`), one task per action point (same shape
 * as the Tasks board's own form) and — when the meeting belongs to a project —
 * the minutes filed on that project's Documents tab.
 */
export default function MeetingsDashboard({ user, appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const isManager = appUser.role === 'Admin' || appUser.role === 'Manager';

  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [bids, setBids] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [letters, setLetters] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(() => meetingFromHash(window.location.hash));
  const [mineOnly, setMineOnly] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const unsubM = onSnapshot(collection(db, 'meetings'), s => setMeetings(rows(s) as Meeting[]),
      err => { console.warn('Meetings — listener:', err.code); setMeetings([]); });
    // Privacy-aware: only the tasks this person may read (public + own).
    const unsubT = subscribeVisibleTasks(user.uid, list => setTasks(list), () => setTasks([]));
    return () => { unsubM(); unsubT(); };
  }, [user.uid]);

  // The boards a suggestion is read from — only once a meeting is open.
  const open = !!selected;
  useEffect(() => {
    if (!open) return;
    const sub = (name: string, set: (v: any[]) => void) => onSnapshot(collection(db, name), s => set(rows(s)),
      err => { console.warn(`Meetings — ${name} listener:`, err.code); set([]); });
    const u1 = sub('opportunities', setBids);
    const u2 = sub('projects', setProjects);
    const u3 = sub('correspondences', setLetters);
    return () => { u1(); u2(); u3(); };
  }, [open]);

  // `#/meetings?id=…` ⇄ the open meeting, so Back/Forward and links work.
  useEffect(() => {
    const onHash = () => setSelected(meetingFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const select = (id: string | null) => {
    window.location.hash = meetingHash(id).slice(1);
    setSelected(id);
  };

  const today = isoDay(new Date());
  const tasksById = useMemo(() => new Map(tasks.map(x => [x.id, x])), [tasks]);
  const current = selected && meetings ? meetings.find(m => m.id === selected) || null : null;

  if (selected && meetings && !current) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }} data-meet="page">
        <button type="button" className="btn btn-ghost" data-meet="back" onClick={() => select(null)}><ArrowLeft size={15} /> {t('All meetings')}</button>
        <p role="alert" style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 16 }}>{t('This meeting no longer exists.')}</p>
      </div>
    );
  }

  if (current) {
    return (
      <MeetingEditor
        key={current.id}
        meeting={current}
        meetings={meetings || []}
        user={user}
        appUser={appUser}
        projectUsers={projectUsers}
        isManager={isManager}
        tasks={tasks}
        tasksById={tasksById}
        bids={bids}
        projects={projects}
        letters={letters}
        today={today}
        onBack={() => select(null)}
        onNavigate={onNavigate}
      />
    );
  }

  const visible = (meetings || []).filter(m => !mineOnly || isMyMeeting(m, user.uid));
  const lists = listMeetings(visible, today);

  const section = (key: 'upcoming' | 'needsMinutes' | 'done', title: string, hint: string, list: Meeting[]) => (
    <section className="card" data-meet={`section-${key}`} style={{ padding: 16, minWidth: 0 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', gap: 8, alignItems: 'baseline' }}>
        {title} <span className="ltr-data" style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700 }}>{list.length}</span>
      </h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 12px' }}>{hint}</p>
      {list.length === 0 ? (
        <p data-meet="empty" style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('None.')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map(m => {
            const sum = actionSummary(m.actions || [], tasksById, today);
            const stage = meetingStage(m, today);
            const sub = [
              m.time ? `${fmt.date(localDate(m.date), DATE_MEDIUM)} · ${m.time}` : fmt.date(localDate(m.date), DATE_MEDIUM),
              m.opportunityTitle || m.projectName || m.client || '',
              (m.attendeeIds || []).length ? t('{{count}} attending', { count: (m.attendeeIds || []).length }) : '',
            ].filter(Boolean);
            return (
              <li key={m.id} data-meet="row" data-id={m.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => select(m.id)}
                  style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit', minWidth: 0 }}
                >
                  <CalendarClock size={16} style={{ color: 'var(--blue-600)', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span dir="auto" style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sub.map((part, i) => <React.Fragment key={i}>{i > 0 && ' · '}<bdi>{part}</bdi></React.Fragment>)}
                    </span>
                  </span>
                  {stage === 'today' && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', background: 'var(--blue-600)', color: '#fff', whiteSpace: 'nowrap' }}>{t('Today')}</span>}
                  {sum.total > 0 && (
                    <span data-meet="row-actions" style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', border: '1px solid var(--border)', color: sum.late ? 'var(--danger)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {t('{{done}}/{{total}} actions done', { done: sum.done, total: sum.total })}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }} data-meet="page">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            <Users2 size={22} style={{ color: 'var(--blue-600)' }} /> {t('Meetings')}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            {t('Agenda before, minutes after — and every action point becomes a task.')}
          </p>
        </div>
        {!creating && (
          <button type="button" className="btn btn-primary" data-meet="new" onClick={() => setCreating(true)} style={{ minHeight: 40 }}>
            <Plus size={16} /> {t('New meeting')}
          </button>
        )}
      </div>

      {creating && (
        <NewMeetingForm
          user={user}
          appUser={appUser}
          today={today}
          onCancel={() => setCreating(false)}
          onCreated={id => { setCreating(false); select(id); }}
        />
      )}

      <div role="group" aria-label={t('Whose meetings')} style={{ display: 'flex', marginBottom: 16 }}>
        <button type="button" data-meet="scope-mine" aria-pressed={mineOnly} onClick={() => setMineOnly(true)} style={chip(mineOnly)}>{t('Mine')}</button>
        <button type="button" data-meet="scope-all" aria-pressed={!mineOnly} onClick={() => setMineOnly(false)} style={chip(!mineOnly)}>{t('Everyone')}</button>
      </div>

      {!meetings ? (
        <p role="status" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('Loading...')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {section('upcoming', t('Today and coming up'), t('Prepare the agenda and send the invitation.'), lists.upcoming)}
          {section('needsMinutes', t('Minutes still to write'), t('Held, but nothing has been written down yet.'), lists.needsMinutes)}
          {section('done', t('Earlier meetings'), t('Minutes written — see which action points are done.'), lists.done)}
        </div>
      )}
    </div>
  );
}

// ── New meeting ──────────────────────────────────────────────────────────────

function NewMeetingForm({ user, appUser, today, onCancel, onCreated }: {
  user: User; appUser: AppUser; today: string; onCancel: () => void; onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [problem, setProblem] = useState<MeetingProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = validateMeeting({ title, date, time });
    setProblem(p);
    if (p || busy) return;
    setBusy(true);
    setError('');
    try {
      const ref = await addDoc(collection(db, 'meetings'), {
        ...meetingFields({
          title, date, time, attendeeIds: [user.uid], agenda: [], actions: [],
          createdById: user.uid, createdBy: appUser.displayName,
        }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onCreated(ref.id);
    } catch (err) {
      console.error('Meetings — create failed:', err);
      setError(t('Could not save the meeting. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" data-meet="new-form" onSubmit={create} style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', alignItems: 'end' }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={label} htmlFor="meet-new-title">{t('Meeting title')}</label>
        <input id="meet-new-title" className="input" dir="auto" data-meet="new-title" autoFocus value={title} onChange={e => setTitle(e.target.value)}
          placeholder={t('e.g. Weekly BD meeting, or AGIBA pricing review')} style={{ width: '100%', fontFamily: 'inherit' }} />
      </div>
      <div>
        <label style={label} htmlFor="meet-new-date">{t('Date')}</label>
        <input id="meet-new-date" type="date" className="input" data-meet="new-date" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%' }} />
      </div>
      <div>
        <label style={label} htmlFor="meet-new-time">{t('Time (optional)')}</label>
        <input id="meet-new-time" type="time" className="input" data-meet="new-time" value={time} onChange={e => setTime(e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary" data-meet="create" disabled={busy} style={{ minHeight: 40 }}>{busy ? t('Saving…') : t('Create')}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} style={{ minHeight: 40 }}>{t('Cancel')}</button>
      </div>
      {(problem || error) && (
        <p role="alert" data-meet="problem" style={{ gridColumn: '1 / -1', margin: 0, fontSize: 13, color: 'var(--danger)' }}>
          {problem ? t(PROBLEM_TEXT[problem]) : error}
        </p>
      )}
    </form>
  );
}

// ── One meeting ──────────────────────────────────────────────────────────────

function suggestionText(t: TFunction, s: AgendaSuggestion, dateText: (d: string) => string, dl: (v?: string | null) => string): string {
  const parts: string[] = [];
  switch (s.source) {
    case 'carry': parts.push(t('From the last meeting: {{what}}', { what: s.title })); break;
    case 'bid-deadline':
      parts.push(s.days !== undefined && s.days < 0
        ? t('Bid “{{title}}”: submission date passed on {{date}}', { title: s.title, date: dateText(s.date!) })
        : t('Bid “{{title}}”: submission on {{date}}', { title: s.title, date: dateText(s.date!) }));
      break;
    case 'bid-decision': parts.push(t('Bid “{{title}}”: awaiting the client’s decision', { title: s.title })); break;
    case 'late-task': parts.push(t('Late task: {{title}}', { title: s.title })); break;
    case 'open-task': parts.push(t('Open task: {{title}}', { title: s.title })); break;
    case 'letter': parts.push(t('Open letter: {{title}}', { title: s.title })); break;
    case 'step': parts.push(t('Step “{{title}}” on {{on}}', { title: dl(s.title), on: s.on || '' })); break;
  }
  if (s.owner) parts.push(s.source === 'letter' ? t('From: {{name}}', { name: s.owner }) : s.owner);
  if (s.date && s.source !== 'bid-deadline') {
    parts.push(s.days !== undefined && s.days < 0 ? t('Was due {{date}}', { date: dateText(s.date) }) : t('Due {{date}}', { date: dateText(s.date) }));
  }
  return parts.join(' — ');
}

const REF_VIEW: Record<MeetingRef['type'], AppView> = {
  task: 'tasks', corresponding: 'correspondences', opportunity: 'opportunities', project: 'projects',
};

interface EditorProps {
  meeting: Meeting;
  meetings: Meeting[];
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  isManager: boolean;
  tasks: any[];
  tasksById: Map<string, any>;
  bids: any[];
  projects: any[];
  letters: any[];
  today: string;
  onBack: () => void;
  onNavigate: (v: AppView) => void;
}

function MeetingEditor({
  meeting, meetings, user, appUser, projectUsers, isManager, tasks, tasksById, bids, projects, letters, today, onBack, onNavigate,
}: EditorProps) {
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const dl = useDisplayLabel();
  const canEdit = canEditMeeting(meeting, user.uid, isManager);

  const [draft, setDraft] = useState<Meeting>(meeting);
  const stored = useMemo(() => JSON.stringify(meetingFields(meeting)), [meeting]);
  const dirty = JSON.stringify(meetingFields(draft)) !== stored;
  // Someone else saved while this page was open and nothing is typed here: take theirs.
  useEffect(() => { if (!dirty) setDraft(meeting); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stored]);

  // Before it (or on the day, until something is written): the agenda. After it: the minutes.
  const [tab, setTab] = useState<Tab>(() => {
    const stage = meetingStage(meeting, today);
    return stage === 'upcoming' || (stage === 'today' && !hasMinutes(meeting)) ? 'agenda' : 'minutes';
  });
  const [lang, setLang] = useState<MeetingLang>(i18n.language === 'ar' ? 'ar' : 'en');
  const [newItem, setNewItem] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [problem, setProblem] = useState<MeetingProblem | null>(null);

  const set = (patch: Partial<Meeting>) => { setDraft(d => ({ ...d, ...patch })); setNotice(''); };
  const setItem = (id: string, patch: Partial<AgendaItem>) => set({ agenda: draft.agenda.map(a => (a.id === id ? { ...a, ...patch } : a)) });
  const setAction = (id: string, patch: Partial<ActionPoint>) => set({ actions: draft.actions.map(a => (a.id === id ? { ...a, ...patch } : a)) });

  const names = useMemo(() => Object.fromEntries(projectUsers.map(u => [u.id, u.displayName])), [projectUsers]);
  const people = useMemo(() => {
    const on = new Set(draft.attendeeIds || []);
    return projectUsers
      .filter(u => u.status === 'Approved' || on.has(u.id))
      .sort((a, b) => Number(on.has(b.id)) - Number(on.has(a.id)) || a.displayName.localeCompare(b.displayName));
  }, [projectUsers, draft.attendeeIds]);
  const clients = useMemo(
    () => [...new Set([...bids, ...projects].map(r => (r.client || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [bids, projects],
  );
  const dateText = (d: string) => fmt.date(localDate(d), DATE_MEDIUM);

  const suggestions = useMemo(
    () => suggestAgenda({ meeting: draft, meetings, tasks, letters, bids, projects, userNames: names }, today),
    [draft, meetings, tasks, letters, bids, projects, names, today],
  );

  // ── Writes ──
  const save = async (next: Meeting = draft): Promise<boolean> => {
    const p = validateMeeting(next);
    setProblem(p);
    if (p) return false;
    setBusy(b => b || 'save');
    setError('');
    try {
      const { id: _id, ...rest } = next;
      const fields = meetingFields(rest);
      const patch: Record<string, unknown> = { ...fields, updatedAt: serverTimestamp() };
      for (const k of OPTIONAL_KEYS) if (!(k in fields)) patch[k] = deleteField();
      await updateDoc(doc(db, 'meetings', meeting.id), patch);
      setDraft(next);
      return true;
    } catch (err) {
      console.error('Meetings — save failed:', err);
      setError(t('Could not save the meeting. Check your connection and try again.'));
      return false;
    } finally {
      setBusy(b => (b === 'save' ? null : b));
    }
  };

  const remove = async () => {
    if (!window.confirm(t('Delete the meeting “{{title}}”? Tasks already created from it stay on the Tasks board.', { title: meeting.title }))) return;
    try {
      await deleteDoc(doc(db, 'meetings', meeting.id));
      onBack();
    } catch (err) {
      console.error('Meetings — delete failed:', err);
      setError(t('Could not delete the meeting.'));
    }
  };

  const addAgenda = (text: string, from?: AgendaSuggestion) => {
    const v = text.trim();
    if (!v || draft.agenda.length >= MAX_AGENDA) return;
    set({ agenda: [...draft.agenda, { id: newItemId('ag'), text: v, key: from?.key, source: from?.source, ref: from?.ref }] });
  };
  const moveAgenda = (i: number, by: number) => {
    const list = [...draft.agenda];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ agenda: list });
  };

  const findActions = () => {
    const found = actionsFromNotes(
      minutesText(draft),
      { me: { id: user.uid, name: appUser.displayName }, people: people.map(u => ({ id: u.id, name: u.displayName })), today: new Date() },
      draft.actions,
    );
    const room = Math.max(0, MAX_ACTIONS - draft.actions.length);
    set({ actions: [...draft.actions, ...found.slice(0, room)] });
    setNotice(found.length ? t('Found {{count}} action points in the notes — check the owner and date of each.', { count: found.length }) : t('No new action points found in the notes. Add them by hand below.'));
    if (found.length) setTab('actions');
  };

  const createTasks = async () => {
    const ready = readyActions(draft.actions);
    if (!ready.length || busy) return;
    if (!(await save())) return;
    setBusy('tasks');
    setError('');
    let next = draft.actions;
    let made = 0;
    const links: RecordLinks = {
      opportunityId: draft.opportunityId, opportunitySerial: draft.opportunitySerial, opportunityTitle: draft.opportunityTitle,
      projectId: draft.projectId, projectName: draft.projectName,
    };
    try {
      for (const a of ready) {
        const fields = actionTaskFields(a, draft, {
          uid: user.uid, name: appUser.displayName, teamId: appUser.teamId, department: (appUser as any).department,
        }, lang);
        const serial = await getNextSerialNumber('tasks');
        const ref = await addDoc(collection(db, 'tasks'), { ...fields, serialNumber: serial, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        next = next.map(x => (x.id === a.id ? { ...x, taskId: ref.id, taskSerial: serial } : x));
        made++;
        // The rest is best-effort: the task exists either way.
        const assignee = String(fields.assignedToId);
        if (assignee !== user.uid) {
          createNotification({
            type: 'task_assigned',
            title: 'New Task Assigned',
            message: taskDetails(`${appUser.displayName} assigned you the task "${fields.taskName}" from the meeting "${draft.title}".`, {
              taskName: String(fields.taskName), serialNumber: serial, priority: a.priority, status: 'Pending', dueDate: a.due, assignedTo: String(fields.assignedTo),
            }),
            forUserId: assignee,
            read: false,
            relatedId: ref.id,
            createdAt: serverTimestamp(),
          }, projectUsers).catch(e => console.warn('Meetings — notify failed:', e));
        }
        if (hasAnyLink(links)) {
          announceNewRecord(links, {
            kind: 'task', id: ref.id, title: String(fields.taskName), serialNumber: serial, status: 'Pending',
            assignedTo: String(fields.assignedTo), dueDate: a.due,
          }, actorFrom(user.uid, appUser)).catch(e => console.warn('Meetings — link echo failed:', e));
        }
      }
    } catch (err) {
      console.error('Meetings — task create failed:', err);
      setError(t('Some tasks could not be created. The ones that were are kept; try again for the rest.'));
    } finally {
      // Always record the tasks that DO exist, so none is ever made twice.
      if (made) await save({ ...draft, actions: next });
      setBusy(null);
      if (made) setNotice(t('{{count}} tasks created on the Tasks board.', { count: made }));
    }
  };

  const minutes = buildMinutes(draft, { names, from: appUser.displayName }, lang);
  const invitation = buildInvitation(draft, { names, from: appUser.displayName }, lang);
  const emails = (draft.attendeeIds || []).map(id => projectUsers.find(u => u.id === id)?.email || '').filter(e => e && e !== user.email);

  const fileMinutes = async () => {
    if (!draft.projectId || busy) return;
    if (!(await save())) return;
    setBusy('file');
    setError('');
    const input = {
      kind: 'minutes' as const,
      title: minutes.subject,
      date: draft.date,
      direction: 'internal' as const,
      summary: minutes.body.slice(0, SUMMARY_MAX),
    };
    let docId = draft.minutesDocId;
    try {
      await runTransaction(db, async tx => {
        const ref = doc(db, 'projects', draft.projectId!);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('project gone');
        const cur = Array.isArray(snap.data().documents) ? (snap.data().documents as ProjectDocument[]) : [];
        if (docId && cur.some(d => d.id === docId)) {
          tx.update(ref, { documents: updateDocument(cur, docId, input) });
        } else {
          const d = buildDocument(input, { uid: user.uid, name: appUser.displayName });
          docId = d.id;
          tx.update(ref, { documents: addDocument(cur, d) });
        }
      });
      await save({ ...draft, minutesDocId: docId });
      setNotice(t('The minutes are filed on the project’s Documents tab.'));
    } catch (err) {
      console.error('Meetings — filing failed:', err);
      setError(t('Could not file the minutes on the project. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (what: string, text: string) => {
    if (await copyToClipboard(text)) { setCopied(what); setTimeout(() => setCopied(c => (c === what ? null : c)), 2000); }
  };

  const openRef = (ref: MeetingRef, labelText: string) => {
    if (ref.type !== 'project') requestOpen({ type: ref.type, id: ref.id, label: labelText, serial: ref.serial });
    else requestOpen({ type: 'project', id: ref.id, label: labelText });
    onNavigate(REF_VIEW[ref.type]);
  };

  const back = () => {
    if (dirty && !window.confirm(t('Leave without saving your changes?'))) return;
    onBack();
  };

  const stateChip = (s: ActionState, a: ActionPoint) => {
    const map: Record<ActionState, { text: string; color: string }> = {
      draft: { text: t('Not a task yet'), color: 'var(--text-muted)' },
      open: { text: t('Still open'), color: 'var(--blue-600)' },
      late: { text: t('Late'), color: 'var(--danger)' },
      done: { text: t('Done'), color: 'var(--success, #15803d)' },
      gone: { text: t('Task not visible'), color: 'var(--text-muted)' },
    };
    const v = map[s];
    return (
      <span data-meet="action-state" data-state={s} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 700, color: v.color }}>
        {a.taskSerial && <span className="ltr-data">{a.taskSerial}</span>}
        {v.text}
      </span>
    );
  };

  const langToggle = (
    <div role="group" aria-label={t('Language of the text')} style={{ display: 'flex' }}>
      <button type="button" data-meet="lang-ar" aria-pressed={lang === 'ar'} onClick={() => setLang('ar')} style={chip(lang === 'ar')}>عربي</button>
      <button type="button" data-meet="lang-en" aria-pressed={lang === 'en'} onClick={() => setLang('en')} style={chip(lang === 'en')}>EN</button>
    </div>
  );

  const letterBox = (what: 'invite' | 'minutes', letter: { subject: string; body: string }) => (
    <div data-meet={`${what}-box`} style={{ border: '1px solid var(--border)', background: 'var(--surface-2)', padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{what === 'invite' ? t('Invitation with the agenda') : t('Draft minutes')}</strong>
        {langToggle}
      </div>
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'} data-meet={`${what}-subject`} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{letter.subject}</div>
      <textarea
        readOnly
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        data-meet={`${what}-text`}
        value={letter.body}
        rows={Math.min(18, letter.body.split('\n').length + 1)}
        className="input"
        style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" style={small} data-meet={`${what}-copy`} onClick={() => copy(what, `${letter.subject}\n\n${letter.body}`)}>
          {copied === what ? <><Check size={13} /> {t('Copied')}</> : <><Copy size={13} /> {t('Copy')}</>}
        </button>
        <a style={{ ...small, textDecoration: 'none' }} data-meet={`${what}-mail`} href={meetingMailto(letter, emails)}>
          <Mail size={13} /> {t('Open in email')}
        </a>
        {what === 'minutes' && draft.projectId && canEdit && (
          <button type="button" style={small} data-meet="file-minutes" disabled={!!busy} onClick={fileMinutes}>
            <FolderOpen size={13} /> {draft.minutesDocId ? t('Update the copy on the project') : t('File on the project')}
          </button>
        )}
      </div>
    </div>
  );

  const sum = actionSummary(draft.actions, tasksById, today);
  const ready = readyActions(draft.actions).length;
  const ro = !canEdit;

  const tabs: { id: Tab; text: string; icon: React.ReactNode }[] = [
    { id: 'agenda', text: t('1. Agenda (before)'), icon: <ClipboardList size={15} /> },
    { id: 'minutes', text: t('2. Minutes (after)'), icon: <FileText size={15} /> },
    { id: 'actions', text: sum.total ? t('3. Action points ({{count}})', { count: sum.total }) : t('3. Action points'), icon: <CheckSquare size={15} /> },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px 96px' }} data-meet="editor" data-id={meeting.id}>
      <button type="button" className="btn btn-ghost" data-meet="back" onClick={back} style={{ marginBottom: 8 }}>
        <ArrowLeft size={15} /> {t('All meetings')}
      </button>

      {/* Details */}
      <section className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <input
          className="input" dir="auto" data-meet="title" value={draft.title} readOnly={ro}
          onChange={e => set({ title: e.target.value })} aria-label={t('Meeting title')}
          style={{ width: '100%', fontFamily: 'inherit', fontSize: 20, fontWeight: 800 }}
        />
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))' }}>
          <div>
            <label style={label} htmlFor="meet-date">{t('Date')}</label>
            <input id="meet-date" type="date" className="input" data-meet="date" value={draft.date} readOnly={ro} onChange={e => set({ date: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={label} htmlFor="meet-time">{t('Time (optional)')}</label>
            <input id="meet-time" type="time" className="input" data-meet="time" value={draft.time || ''} readOnly={ro} onChange={e => set({ time: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={label} htmlFor="meet-place">{t('Place or link')}</label>
            <input id="meet-place" className="input" dir="auto" data-meet="place" value={draft.place || ''} readOnly={ro} onChange={e => set({ place: e.target.value })} placeholder={t('Room, site, or a Teams link')} style={{ width: '100%', fontFamily: 'inherit' }} />
          </div>
          <div>
            <label style={label} htmlFor="meet-client">{t('Client')}</label>
            <input id="meet-client" className="input" dir="auto" list="meet-clients" data-meet="client" value={draft.client || ''} readOnly={ro} onChange={e => set({ client: e.target.value })} placeholder={t('Optional')} style={{ width: '100%', fontFamily: 'inherit' }} />
            <datalist id="meet-clients">{clients.map(c => <option key={c} value={c} />)}</datalist>
          </div>
        </div>

        <div>
          <span style={label}>{t('Attending')}</span>
          <div data-meet="attendees" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {people.map(u => {
              const on = (draft.attendeeIds || []).includes(u.id);
              return (
                <button
                  key={u.id} type="button" disabled={ro} data-meet="attendee" data-uid={u.id} aria-pressed={on}
                  onClick={() => set({ attendeeIds: on ? draft.attendeeIds.filter(x => x !== u.id) : [...(draft.attendeeIds || []), u.id] })}
                  style={{ ...chip(on), minHeight: 32, padding: '4px 10px', fontSize: 12 }}
                >
                  <bdi>{u.displayName}</bdi>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label style={label} htmlFor="meet-guests">{t('Guests from outside (optional)')}</label>
          <input id="meet-guests" className="input" dir="auto" data-meet="guests" value={draft.guests || ''} readOnly={ro} onChange={e => set({ guests: e.target.value })} placeholder={t('e.g. two engineers from the client')} style={{ width: '100%', fontFamily: 'inherit' }} />
        </div>
        {!ro && (
          <RecordLinkPicker
            value={{ opportunityId: draft.opportunityId, opportunitySerial: draft.opportunitySerial, opportunityTitle: draft.opportunityTitle, projectId: draft.projectId, projectName: draft.projectName }}
            onChange={l => set({ ...l })}
            hint={t('Link the meeting to a bid or a project: the agenda suggests its open work, and the tasks from it are linked too.')}
          />
        )}
        {ro && (
          <p style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {t('Only the people attending, whoever set it up, and managers can change this meeting.')}
          </p>
        )}
      </section>

      {/* Steps */}
      <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: 0, margin: '16px 0 12px' }}>
        {tabs.map(x => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} data-meet={`tab-${x.id}`} onClick={() => setTab(x.id)}
            style={{ ...chip(tab === x.id), display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40 }}>
            {x.icon}{x.text}
          </button>
        ))}
      </div>

      {notice && <p role="status" data-meet="notice" style={{ fontSize: 13, color: 'var(--blue-600)', margin: '0 0 12px', fontWeight: 600 }}>{notice}</p>}
      {error && <p role="alert" data-meet="error" style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 12px' }}>{error}</p>}
      {problem && <p role="alert" data-meet="problem" style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 12px' }}>{t(PROBLEM_TEXT[problem])}</p>}

      {tab === 'agenda' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <section className="card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 10px', color: 'var(--text-primary)' }}>{t('Agenda')}</h2>
            {draft.agenda.length === 0 && <p data-meet="agenda-empty" style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>{t('No items yet. Add your own, or take them from the suggestions below.')}</p>}
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
              {draft.agenda.map((a, i) => (
                <li key={a.id} data-meet="agenda-item" data-key={a.key || ''} style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                  <span className="ltr-data" style={{ width: 22, flexShrink: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>{i + 1}.</span>
                  <input className="input" dir="auto" value={a.text} readOnly={ro} onChange={e => setItem(a.id, { text: e.target.value })} aria-label={t('Agenda item')} style={{ flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 13 }} />
                  {a.ref && (
                    <button type="button" style={small} title={t('Open')} aria-label={t('Open')} onClick={() => openRef(a.ref!, a.text)}><FileText size={13} /></button>
                  )}
                  {!ro && <>
                    <button type="button" style={small} aria-label={t('Move up')} disabled={i === 0} onClick={() => moveAgenda(i, -1)}><ArrowUp size={13} /></button>
                    <button type="button" style={small} aria-label={t('Move down')} disabled={i === draft.agenda.length - 1} onClick={() => moveAgenda(i, 1)}><ArrowDown size={13} /></button>
                    <button type="button" style={{ ...small, color: 'var(--danger)' }} aria-label={t('Remove')} data-meet="agenda-remove" onClick={() => set({ agenda: draft.agenda.filter(x => x.id !== a.id) })}><Trash2 size={13} /></button>
                  </>}
                </li>
              ))}
            </ol>
            {!ro && (
              <form onSubmit={e => { e.preventDefault(); addAgenda(newItem); setNewItem(''); }} style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <input className="input" dir="auto" data-meet="agenda-new" value={newItem} onChange={e => setNewItem(e.target.value)} placeholder={t('Add an agenda item')} aria-label={t('Add an agenda item')} style={{ flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 13 }} />
                <button type="submit" className="btn btn-primary" data-meet="agenda-add" style={{ minHeight: 36 }}><Plus size={14} /> {t('Add')}</button>
              </form>
            )}
          </section>

          {!ro && (
            <section className="card" data-meet="suggestions" style={{ padding: 16 }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                <Sparkles size={16} style={{ color: 'var(--blue-600)' }} /> {t('Suggested from the boards')}
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
                {t('Unfinished action points from the last meeting, deadlines on the linked bid or client, late tasks of the people attending, open letters and checklist steps due soon.')}
              </p>
              {suggestions.length === 0 ? (
                <p data-meet="suggest-none" style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('Nothing to suggest. Link a bid, project or client, or add the people attending.')}</p>
              ) : (
                <>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {suggestions.map(s => {
                      const text = suggestionText(t, s, dateText, dl);
                      return (
                        <li key={s.key} data-meet="suggestion" data-key={s.key} data-source={s.source} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '6px 8px', minWidth: 0 }}>
                          <span dir="auto" style={{ flex: 1, minWidth: 0, fontSize: 13, color: s.days !== undefined && s.days < 0 ? 'var(--danger)' : 'var(--text-primary)', overflowWrap: 'anywhere' }}>{text}</span>
                          <button type="button" style={small} data-meet="suggest-add" onClick={() => addAgenda(text, s)}><Plus size={13} /> {t('Add')}</button>
                        </li>
                      );
                    })}
                  </ul>
                  <button type="button" style={{ ...small, marginTop: 8 }} data-meet="suggest-all"
                    onClick={() => set({ agenda: [...draft.agenda, ...suggestions.slice(0, Math.max(0, MAX_AGENDA - draft.agenda.length)).map(s => ({ id: newItemId('ag'), text: suggestionText(t, s, dateText, dl), key: s.key, source: s.source, ref: s.ref }))] })}>
                    <ListChecks size={13} /> {t('Add all {{count}}', { count: suggestions.length })}
                  </button>
                </>
              )}
            </section>
          )}

          {letterBox('invite', invitation)}
        </div>
      )}

      {tab === 'minutes' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {draft.agenda.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('There is no agenda — write everything under “Other notes”, or add agenda items first.')}</p>
          )}
          {draft.agenda.map((a, i) => (
            <section key={a.id} className="card" data-meet="minutes-item" style={{ padding: 14, display: 'grid', gap: 8 }}>
              <h3 dir="auto" style={{ fontSize: 14, fontWeight: 800, margin: 0, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}><span className="ltr-data">{i + 1}.</span> {a.text}</h3>
              <div>
                <label style={label} htmlFor={`n-${a.id}`}>{t('What was said')}</label>
                <textarea id={`n-${a.id}`} className="input" dir="auto" rows={3} data-meet="item-notes" value={a.notes || ''} readOnly={ro}
                  onChange={e => setItem(a.id, { notes: e.target.value })}
                  placeholder={t('One point per line. Write “Mona to send the offer by Thursday” and it can become a task.')}
                  style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }} />
              </div>
              <div>
                <label style={label} htmlFor={`d-${a.id}`}>{t('Decision')}</label>
                <input id={`d-${a.id}`} className="input" dir="auto" data-meet="item-decision" value={a.decision || ''} readOnly={ro}
                  onChange={e => setItem(a.id, { decision: e.target.value })} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }} />
              </div>
            </section>
          ))}
          <section className="card" style={{ padding: 14 }}>
            <label style={{ ...label, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }} htmlFor="meet-notes">{t('Other notes')}</label>
            <textarea id="meet-notes" className="input" dir="auto" rows={4} data-meet="notes" value={draft.notes || ''} readOnly={ro}
              onChange={e => set({ notes: e.target.value })} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }} />
          </section>
          {!ro && (
            <div>
              <button type="button" className="btn btn-primary" data-meet="find-actions" onClick={findActions} style={{ minHeight: 40 }}>
                <Sparkles size={15} /> {t('Find action points in the notes')}
              </button>
            </div>
          )}
          {letterBox('minutes', minutes)}
        </div>
      )}

      {tab === 'actions' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <section className="card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{t('Action points')}</h2>
            <p data-meet="actions-summary" style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 12px' }}>
              {sum.total === 0
                ? t('Nothing yet. Add them by hand, or write the minutes and press “Find action points in the notes”.')
                : t('{{created}} of {{total}} are tasks · {{done}} done · {{late}} late', { created: sum.created, total: sum.total, done: sum.done, late: sum.late })}
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {draft.actions.map(a => {
                const st = actionState(a, tasksById, today);
                const locked = ro || !!a.taskId;
                return (
                  <li key={a.id} data-meet="action" data-id={a.id} data-state={st} style={{ border: '1px solid var(--border)', background: 'var(--surface-2)', padding: 10, display: 'grid', gap: 8, minWidth: 0 }}>
                    <input className="input" dir="auto" data-meet="action-text" value={a.text} readOnly={locked} onChange={e => setAction(a.id, { text: e.target.value })}
                      aria-label={t('Action point')} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }} />
                    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', alignItems: 'end' }}>
                      <div>
                        <label style={label}>{t('Owner')}</label>
                        <select className="input" data-meet="action-owner" value={a.ownerId || ''} disabled={locked}
                          onChange={e => setAction(a.id, { ownerId: e.target.value || undefined, ownerName: names[e.target.value] || undefined })}
                          style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}>
                          <option value="">{t('Not set (me)')}</option>
                          {people.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={label}>{t('Due date')}</label>
                        <input type="date" className="input" data-meet="action-due" value={a.due || ''} readOnly={locked} onChange={e => setAction(a.id, { due: e.target.value || undefined })} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <label style={label}>{t('Priority')}</label>
                        <select className="input" data-meet="action-priority" value={a.priority} disabled={locked} onChange={e => setAction(a.id, { priority: e.target.value as TaskPriority })} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}>
                          {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{t(p)}</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', minHeight: 36 }}>
                        {a.taskId && st !== 'gone'
                          ? <button type="button" style={{ ...small, border: 'none', background: 'none', padding: 0 }} data-meet="open-task" onClick={() => openRef({ type: 'task', id: a.taskId!, serial: a.taskSerial }, a.text)}>{stateChip(st, a)}</button>
                          : stateChip(st, a)}
                        {!locked && (
                          <button type="button" style={{ ...small, color: 'var(--danger)' }} aria-label={t('Remove')} data-meet="action-remove" onClick={() => set({ actions: draft.actions.filter(x => x.id !== a.id) })}><Trash2 size={13} /></button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {!ro && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                <button type="button" style={small} data-meet="action-add" disabled={draft.actions.length >= MAX_ACTIONS}
                  onClick={() => set({ actions: [...draft.actions, { id: newItemId('ap'), text: '', priority: 'Medium' }] })}>
                  <Plus size={13} /> {t('Add an action point')}
                </button>
                <button type="button" className="btn btn-primary" data-meet="create-tasks" disabled={!ready || !!busy} onClick={createTasks} style={{ minHeight: 40 }}>
                  <CheckSquare size={15} /> {busy === 'tasks' ? t('Creating tasks…') : ready === 1 ? t('Create 1 task') : t('Create {{count}} tasks', { count: ready })}
                </button>
              </div>
            )}
            <p style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5 }}>
              <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              {t('Each task goes to its owner on the Tasks board, public, linked to this meeting’s bid or project. An action point without an owner becomes your task.')}
            </p>
          </section>
          {letterBox('minutes', minutes)}
        </div>
      )}

      {/* Save bar */}
      {!ro && (
        <div data-meet="save-bar" style={{ position: 'sticky', bottom: 'calc(var(--bottomnav-h, 0px) + 8px)', marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
          <span data-meet="dirty" style={{ fontSize: 12, fontWeight: 600, color: dirty ? 'var(--surface-warn-text)' : 'var(--text-muted)' }}>
            {dirty ? t('Unsaved changes') : t('All changes saved')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {canDeleteMeeting(meeting, user.uid, isManager) && (
              <button type="button" className="btn btn-ghost" data-meet="delete" onClick={remove} style={{ minHeight: 40, color: 'var(--danger)' }}><Trash2 size={15} /> {t('Delete')}</button>
            )}
            <button type="button" className="btn btn-primary" data-meet="save" disabled={!dirty || !!busy} onClick={() => save().then(okd => okd && setNotice(t('Saved.')))} style={{ minHeight: 40 }}>
              <Save size={15} /> {busy === 'save' ? t('Saving…') : t('Save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
