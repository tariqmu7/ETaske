import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../lib/firebase';
import { createNotification, notifyManagers } from '../lib/pushNotification';
import { taskDetails } from '../lib/notifyDetails';
import { getNextSerialNumber } from '../lib/counters';
import { subscribeVisibleTasks } from '../lib/taskVisibility';
import {
  AppUser, Task, Corresponding, CorrespondingCategory,
  PRIORITY_OPTIONS, CATEGORY_OPTIONS, PROJECT_OPTIONS, DEPARTMENT_OPTIONS,
} from '../types';
import { Plus, X, Paperclip, ChevronRight, Users, Lock, Globe, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getUserColor } from '../utils';
import ComboBox from './ComboBox';

// Public / Private segmented control. Private tasks are visible & editable only
// to their owner (the assignee) — enforced in firestore.rules.
export function PrivacyToggle({ isPrivate, onChange }: { isPrivate: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const opts: { value: boolean; label: string; icon: React.ReactNode; hint: string }[] = [
    { value: false, label: t('Public'), icon: <Globe style={{ width: 14, height: 14 }} />, hint: t('Everyone on the board can see it') },
    { value: true, label: t('Private'), icon: <Lock style={{ width: 14, height: 14 }} />, hint: t('Only you can see it') },
  ];
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {opts.map(o => {
          const active = o.value === isPrivate;
          return (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => onChange(o.value)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '10px 12px', cursor: 'pointer',
                border: `1.5px solid ${active ? 'var(--blue-500)' : 'var(--border-md)'}`,
                background: active ? 'rgba(59,130,246,0.08)' : 'var(--surface-2)',
                color: active ? 'var(--blue-600)' : 'var(--text-secondary)',
                fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
              }}
            >
              {o.icon}{o.label}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        {isPrivate ? <Lock style={{ width: 12, height: 12 }} /> : <Globe style={{ width: 12, height: 12 }} />}
        {isPrivate
          ? t('Only you can view or edit this task — not managers or admins.')
          : t('Visible to everyone on the shared board.')}
      </div>
    </div>
  );
}

// Multi-select for adding co-workers to a task. The primary owner (assignee)
// is excluded — they can't also be a collaborator. Mirrors the assignee select's
// department/role visibility filter.
export function CollaboratorPicker({
  users, selectedIds, ownerId, onChange,
}: {
  users: AppUser[];
  selectedIds: string[];
  ownerId?: string;
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const available = users.filter(u => u.id !== ownerId);
  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };
  if (available.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('No other team members available.')}</div>;
  }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {available.map(u => {
          const active = selectedIds.includes(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', cursor: 'pointer',
                border: `1.5px solid ${active ? 'var(--blue-500)' : 'var(--border-md)'}`,
                background: active ? 'rgba(59,130,246,0.08)' : 'var(--surface-2)',
                color: active ? 'var(--blue-600)' : 'var(--text-secondary)',
                fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 0, background: u.userColor || getUserColor(u.id) }} />
              {u.displayName}
              {active && <Check style={{ width: 12, height: 12 }} />}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Users style={{ width: 12, height: 12 }} />
        {selectedIds.length
          ? t(
              selectedIds.length === 1
                ? '{{count}} collaborator — they can view and edit this task.'
                : '{{count}} collaborators — they can view and edit this task.',
              { count: selectedIds.length },
            )
          : t('Add co-workers so this task is shared with and editable by them.')}
      </div>
    </div>
  );
}

export interface NewTaskDraft {
  taskName: string;
  description: string;
  priority: Corresponding['priority'];
  dueDate: string;
  category: CorrespondingCategory;
  subCategory: string;
  department: string;
  assignedTo: string;
  assignedToId: string;
  collaboratorIds: string[];
  filePaths: string[];
  isPrivate: boolean;
  attachedFile?: string;
  attachedFileName?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  /**
   * Source for the "learned" department / sub-category suggestions. Callers
   * that already hold a live task list (TasksDashboard) pass it so no extra
   * listeners are opened; otherwise the panel subscribes itself while open.
   */
  tasks?: Task[];
  /** Field values to seed the form with each time the panel opens. */
  prefill?: Partial<NewTaskDraft>;
  /** Extra fields merged into the created task doc (e.g. traceability links). */
  extraFields?: Record<string, any>;
  /** Optional header overrides — the form itself is unchanged. */
  headerIcon?: React.ReactNode;
  headerIconBackground?: string;
  headerTitle?: string;
  headerSubtitle?: string;
  /** Rendered between the header and the form (e.g. the source email strip). */
  sourceStrip?: React.ReactNode;
  /**
   * Fired after the task doc is written. The draft is handed back so a caller
   * can mirror what was actually chosen in the form (ManagerInbox writes the
   * assignee back onto the correspondence).
   */
  onCreated?: (taskId: string, draft: NewTaskDraft) => void;
}

function emptyDraft(user: User, appUser: AppUser): NewTaskDraft {
  return {
    taskName: '',
    description: '',
    priority: 'Medium',
    dueDate: '',
    category: 'Project',
    subCategory: 'None',
    department: 'None',
    assignedTo: appUser.displayName,
    assignedToId: user.uid,
    collaboratorIds: [],
    filePaths: [],
    isPrivate: false,
  };
}

/**
 * The single Create-Task form. Rendered as a right-hand slide-over and shared by
 * every entry point (Tasks dashboard, Outlook feed) so the fields, layout and
 * write/notification behaviour stay identical everywhere.
 */
export default function CreateTaskPanel({
  open, onClose, user, appUser, projectUsers,
  tasks: tasksProp, prefill, extraFields,
  headerIcon, headerIconBackground, headerTitle, headerSubtitle, sourceStrip,
  onCreated,
}: Props) {
  const { t } = useTranslation();
  const [newTask, setNewTask] = useState<NewTaskDraft>(() => ({ ...emptyDraft(user, appUser), ...prefill }));
  const [showAdvancedCreate, setShowAdvancedCreate] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Own task listener only when the caller has none to hand (Outlook feed), so
  // the suggestion lists match the ones on the Tasks dashboard either way.
  const [ownTasks, setOwnTasks] = useState<Task[]>([]);
  useEffect(() => {
    if (tasksProp || !open || appUser.status !== 'Approved') return;
    return subscribeVisibleTasks(user.uid, setOwnTasks, () => setOwnTasks([]));
  }, [tasksProp, open, user.uid, appUser.status]);
  const tasks = tasksProp ?? ownTasks;

  // Seed the form every time the panel opens.
  const prefillKey = JSON.stringify(prefill ?? {});
  useEffect(() => {
    if (!open) return;
    setNewTask({ ...emptyDraft(user, appUser), ...prefill });
    setShowAdvancedCreate(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillKey]);

  const dynamicSubCategories = useMemo(() => {
    const fromTasks = Array.from(new Set(tasks.map(t => t.subCategory).filter(Boolean))).sort();
    return Array.from(new Set([...PROJECT_OPTIONS, ...fromTasks])).sort();
  }, [tasks]);

  // Departments typed into earlier tasks become suggestions, so a value added
  // once through the combobox is offered from then on.
  const dynamicDepartments = useMemo(() => {
    const fromTasks = tasks.map(t => t.department).filter(Boolean) as string[];
    return Array.from(new Set([...DEPARTMENT_OPTIONS, ...fromTasks]))
      .filter(d => d && d !== 'None' && d !== 'Other...')
      .sort();
  }, [tasks]);

  // 'Other...' was only a trigger for a browser prompt(); the combobox creates
  // values inline, so it is no longer offered as a category.
  const categoryOptions = useMemo(() => CATEGORY_OPTIONS.filter(c => c !== 'Other...'), []);

  const uploadToGoogleDrive = async (file: File): Promise<string> => {
    const scriptUrl = import.meta.env.VITE_GOOGLE_SCRIPT_URL;
    if (!scriptUrl) {
      throw new Error('Google Script URL not configured.');
    }

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const response = await fetch(scriptUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: import.meta.env.VITE_GOOGLE_SCRIPT_SECRET,
        filename: file.name,
        mimeType: file.type,
        base64: base64
      })
    });

    if (!response.ok) throw new Error('Network response was not ok');
    const result = await response.json();
    if (result.status === 'success') return result.url;
    throw new Error(result.message || 'Upload failed');
  };

  const handleNewFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const driveUrl = await uploadToGoogleDrive(file);
      setNewTask(p => ({ ...p, attachedFile: driveUrl, attachedFileName: file.name }));
    } catch (err: any) {
      alert(t('Upload failed: {{message}}', { message: err.message }));
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreateTask = async () => {
    if (!newTask.taskName.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const serial = await getNextSerialNumber('tasks');
      const taskRef = await addDoc(collection(db, 'tasks'), {
        taskName: newTask.taskName.trim(),
        description: newTask.description.trim(),
        status: 'Pending',
        priority: newTask.priority,
        category: newTask.category,
        subCategory: newTask.subCategory,
        department: newTask.department,
        serialNumber: serial,
        assignedTo: newTask.assignedTo || appUser.displayName,
        assignedToId: newTask.assignedToId || user.uid,
        assignedBy: appUser.displayName,
        assignedById: user.uid,
        collaboratorIds: newTask.collaboratorIds,
        collaborators: newTask.collaboratorIds.map(id => projectUsers.find(u => u.id === id)?.displayName || ''),
        teamId: appUser.teamId || 'NONE',
        dueDate: newTask.dueDate || null,
        filePaths: newTask.filePaths || [],
        isPrivate: !!newTask.isPrivate,
        attachedFile: newTask.attachedFile || null,
        attachedFileName: newTask.attachedFileName || null,
        ...(extraFields || {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Snapshot of what was just written, for the notification bodies.
      const created: Partial<Task> = {
        taskName: newTask.taskName.trim(),
        description: newTask.description.trim(),
        serialNumber: serial,
        priority: newTask.priority,
        status: 'Pending',
        dueDate: newTask.dueDate || undefined,
        assignedTo: newTask.assignedTo || appUser.displayName,
      };
      const assigneeId = newTask.assignedToId || user.uid;

      // The assignee learns about their own new task. (Self-assignment is the
      // common case here, hence the guard.)
      if (assigneeId !== user.uid) {
        await createNotification({
          type: 'task_assigned',
          title: 'New Task Assigned',
          message: taskDetails(
            `${appUser.displayName} assigned you the task "${created.taskName}".`,
            created,
          ),
          forUserId: assigneeId,
          read: false,
          relatedId: taskRef.id,
          createdAt: serverTimestamp(),
        }, projectUsers);
      }

      // Notify each collaborator they were added.
      for (const cid of newTask.collaboratorIds) {
        if (cid === user.uid || cid === assigneeId) continue;
        await createNotification({
          type: 'task_assigned',
          title: 'Added as Collaborator',
          message: taskDetails(
            `${appUser.displayName} added you as a collaborator on "${created.taskName}".`,
            created,
          ),
          forUserId: cid,
          read: false,
          relatedId: taskRef.id,
          createdAt: serverTimestamp(),
        }, projectUsers);
      }

      if (!newTask.isPrivate) {
        await notifyManagers({
          type: 'task_assigned',
          title: 'New Task Created',
          message: taskDetails(
            `${appUser.displayName} created "${created.taskName}" for ${created.assignedTo}.`,
            created,
          ),
          read: false,
          relatedId: taskRef.id,
          createdAt: serverTimestamp(),
        }, projectUsers, { actorId: user.uid, excludeIds: [assigneeId] });
      }

      const submitted = newTask;
      setNewTask(emptyDraft(user, appUser));
      onCreated?.(taskRef.id, submitted);
      onClose();
    } catch (err) {
      console.error('Firestore:', { err, op: 'CREATE', path: 'tasks' });
      setError(t('Failed to create task.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(15,23,42,0.4)',
              backdropFilter: 'blur(2px)',
              zIndex: 1500,
            }}
          />
          {/* Slide-over panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            style={{
              position: 'fixed', top: 0, insetInlineEnd: 0, bottom: 0,
              width: '100%', maxWidth: 480,
              background: 'var(--surface)',
              borderInlineStart: '1px solid var(--border-md)',
              boxShadow: '-8px 0 40px rgba(15,23,42,0.12)',
              zIndex: 1501,
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Panel header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div style={{
                  width: 32, height: 32, background: headerIconBackground || 'var(--blue-600)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {headerIcon || <Plus style={{ width: 16, height: 16, color: '#fff' }} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {headerTitle || t('New Task')}
                  </div>
                  <div style={{
                    fontSize: 11, color: 'var(--text-muted)', marginTop: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {headerSubtitle || t('Fill in the details below')}
                  </div>
                </div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={onClose}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>

            {sourceStrip}

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

              {/* Hero: Task Name */}
              <div style={{ marginBottom: 20 }}>
                <label className="input-label">
                  {t('Task Name')}<span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  className="input"
                  required
                  style={{ fontSize: 16, fontWeight: 500, padding: '12px 14px' }}
                  value={newTask.taskName}
                  onChange={e => setNewTask({ ...newTask, taskName: e.target.value })}
                  placeholder={t('What needs to be done?')}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && newTask.taskName.trim() && handleCreateTask()}
                />
              </div>

              {/* Description */}
              <div style={{ marginBottom: 20 }}>
                <label className="input-label">{t('Description')}<span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{t('(optional)')}</span></label>
                <textarea
                  className="input"
                  value={newTask.description}
                  onChange={e => setNewTask({ ...newTask, description: e.target.value })}
                  rows={3}
                  placeholder={t('Add context, links, or notes…')}
                  style={{ resize: 'vertical', minHeight: 72 }}
                />
              </div>

              {/* Divider: When & Urgency */}
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{t('When & Urgency')}</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                <div>
                  <label className="input-label">{t('Priority')}</label>
                  <select className="input" value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value as Corresponding['priority'] })}>
                    {PRIORITY_OPTIONS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="input-label">{t('Due Date')}<span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{t('(optional)')}</span></label>
                  <input type="date" className="input" value={newTask.dueDate} onChange={e => setNewTask({ ...newTask, dueDate: e.target.value })} />
                </div>
              </div>

              {/* Divider: Who */}
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{t('Who')}</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label className="input-label">{t('Assignee')}</label>
                <select
                  className="input"
                  value={newTask.assignedToId}
                  onChange={e => {
                    const u = projectUsers.find(u => u.id === e.target.value);
                    if (u) setNewTask({ ...newTask, assignedToId: u.id, assignedTo: u.displayName });
                  }}
                >
                  {projectUsers
                    .filter(u =>
                      u.id === user.uid ||
                      appUser.role === 'Admin' ||
                      (u.department === appUser.department && u.teamId === appUser.teamId)
                    )
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.displayName} ({u.role})</option>
                    ))
                  }
                </select>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label className="input-label">{t('Collaborators')} <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{t('(optional)')}</span></label>
                <CollaboratorPicker
                  users={projectUsers.filter(u =>
                    appUser.role === 'Admin' ||
                    (u.department === appUser.department && u.teamId === appUser.teamId)
                  )}
                  ownerId={newTask.assignedToId}
                  selectedIds={newTask.collaboratorIds}
                  onChange={ids => setNewTask({ ...newTask, collaboratorIds: ids })}
                />
              </div>

              {/* Divider: Visibility */}
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{t('Visibility')}</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <PrivacyToggle
                  isPrivate={!!newTask.isPrivate}
                  onChange={v => setNewTask({ ...newTask, isPrivate: v })}
                />
              </div>

              {/* Divider: Classification */}
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{t('Classification')}</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                <div>
                  <label className="input-label">{t('Category')}</label>
                  <ComboBox
                    value={newTask.category}
                    onChange={v => setNewTask({ ...newTask, category: (v || 'Project') as CorrespondingCategory })}
                    options={categoryOptions}
                    placeholder={t('Select or add a category…')}
                    clearable={false}
                    listLabel={t('Categories')}
                  />
                </div>
                <div>
                  <label className="input-label">{t('Department')}</label>
                  <ComboBox
                    value={newTask.department}
                    onChange={v => setNewTask({ ...newTask, department: v || 'None' })}
                    options={dynamicDepartments}
                    placeholder={t('Select or add a department…')}
                    emptyValue="None"
                    listLabel={t('Departments')}
                  />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="input-label">{t('Sub-Category / Project')}</label>
                  <ComboBox
                    value={newTask.subCategory}
                    onChange={v => setNewTask({ ...newTask, subCategory: v || 'None' })}
                    options={newTask.category === 'Project' ? PROJECT_OPTIONS : dynamicSubCategories}
                    placeholder={t('Select or add a project…')}
                    emptyValue="None"
                    listLabel={t('Projects')}
                  />
                </div>
              </div>

              {/* Divider: Attachment */}
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{t('Attachment')}</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 8, padding: '20px 16px',
                    border: `2px dashed ${isDragOver ? 'var(--blue-500)' : 'var(--border-md)'}`,
                    background: isDragOver ? 'rgba(59,130,246,0.05)' : 'var(--surface-2)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={e => {
                    e.preventDefault(); setIsDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleNewFileUpload({ target: { files: e.dataTransfer.files } } as any);
                  }}
                >
                  <input type="file" onChange={handleNewFileUpload} style={{ display: 'none' }} />
                  {isUploading ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Uploading to Drive...')}</div>
                  ) : newTask.attachedFileName ? (
                    <div style={{ fontSize: 12, color: 'var(--blue-600)', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                      <Paperclip style={{ width: 14, height: 14 }} /> {newTask.attachedFileName}
                    </div>
                  ) : (
                    <>
                      <Paperclip style={{ width: 20, height: 20, color: 'var(--text-muted)' }} />
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('Drop file or click to upload')}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t('Uploads to Google Drive')}</div>
                      </div>
                    </>
                  )}
                </label>
              </div>

              {/* Advanced: Shared Folder Paths */}
              <button
                type="button"
                onClick={() => setShowAdvancedCreate(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: 12,
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                <ChevronRight style={{ width: 12, height: 12, transform: showAdvancedCreate ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                {t('Advanced')}
                <div style={{ flex: 1, height: 1, background: 'var(--border)', marginInlineStart: 4 }} />
              </button>

              <AnimatePresence>
                {showAdvancedCreate && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ marginBottom: 20 }}>
                      <label className="input-label">{t('Shared Folder Paths (Computer Paths)')}</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                        {newTask.filePaths.map((path, idx) => (
                          <div key={idx} style={{ display: 'flex', gap: 8 }}>
                            <input
                              className="input"
                              placeholder={`\\\\server\\share\\folder or C:\\Documents\\...`}
                              value={path}
                              onChange={e => {
                                const newPaths = [...newTask.filePaths];
                                newPaths[idx] = e.target.value.replace(/["']/g, '');
                                setNewTask({ ...newTask, filePaths: newPaths });
                              }}
                            />
                            <button
                              type="button"
                              className="btn btn-danger btn-icon"
                              onClick={() => {
                                const newPaths = newTask.filePaths.filter((_, i) => i !== idx);
                                setNewTask({ ...newTask, filePaths: newPaths });
                              }}
                            >
                              <X style={{ width: 14, height: 14 }} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ width: 'fit-content', gap: 6 }}
                          onClick={() => setNewTask({ ...newTask, filePaths: [...newTask.filePaths, ''] })}
                        >
                          <Plus style={{ width: 14, height: 14 }} /> {t('Add Path')}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {error && (
                <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>{error}</div>
              )}

            </div>

            {/* Panel footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--border)',
              display: 'flex', gap: 12, justifyContent: 'flex-end',
              flexShrink: 0, background: 'var(--surface)',
            }}>
              <button className="btn btn-ghost" onClick={onClose}>{t('Cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={handleCreateTask}
                disabled={!newTask.taskName.trim() || isSaving}
                style={{ minWidth: 120 }}
              >
                <Plus style={{ width: 16, height: 16 }} /> {t('Create Task')}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
