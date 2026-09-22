import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AppUser } from '../types';
import { useDisplayLabel } from '../lib/displayLabel';
import { useFormat } from '../lib/format';
import {
  ChecklistItem, ChecklistTarget, templatesFor, missingSteps, addTemplateSteps,
  addItem, setDone, setDue, renameItem, removeItem, redate, redateCount,
  checklistProgress, localToday,
} from '../lib/checklists';
import { ListChecks, Plus, Check, Trash2, CalendarClock, AlertTriangle, RefreshCw, Pencil } from 'lucide-react';

interface Props {
  target: ChecklistTarget;
  recordId: string;
  /** The live `checklist` field of the record (from the board's snapshot). */
  items: ChecklistItem[] | undefined;
  /** Submission deadline (bid) or start date (project) — steps are dated from it. */
  anchorDate?: string;
  appUser: AppUser;
}

/**
 * The standard-steps checklist on a bid or a project (queue C3).
 *
 * ★ Every change goes through a TRANSACTION that re-reads the record's array
 * and applies one small edit to it. Writing back the array this component
 * happens to hold would silently undo a colleague's tick made a second
 * earlier — the list is shared by the whole bid team.
 */
export default function ChecklistPanel({ target, recordId, items, anchorDate, appUser }: Props) {
  const { t } = useTranslation();
  const dl = useDisplayLabel();
  const fmt = useFormat();
  const list = Array.isArray(items) ? items : [];
  const today = localToday();
  const progress = useMemo(() => checklistProgress(list, today), [list, today]);
  const templates = templatesFor(target);
  const inUse = templates
    .map(tp => ({ key: tp.key, have: tp.steps.length - missingSteps(tp.key, list).length }))
    .filter(x => x.have > 0)
    .sort((a, b) => b.have - a.have)[0]?.key ?? null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [due, setDueInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const collectionName = target === 'opportunity' ? 'opportunities' : 'projects';
  const anchorLabel = target === 'opportunity' ? t('submission deadline') : t('start date');

  const mutate = async (fn: (cur: ChecklistItem[]) => ChecklistItem[]) => {
    setBusy(true);
    setError(null);
    try {
      await runTransaction(db, async tx => {
        const ref = doc(db, collectionName, recordId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('record gone');
        const cur = Array.isArray(snap.data().checklist) ? (snap.data().checklist as ChecklistItem[]) : [];
        tx.update(ref, { checklist: fn(cur), updatedAt: serverTimestamp() });
      });
    } catch (e) {
      console.error('checklist update failed:', e);
      setError(t('Failed to update the checklist. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const who = appUser.displayName || '';
  const redateN = redateCount(list, anchorDate, today);

  const submitAdd = async () => {
    if (!title.trim()) return;
    const tt = title, dd = due;
    setTitle(''); setDueInput('');
    await mutate(cur => addItem(cur, tt, dd));
  };

  const submitRename = async (id: string) => {
    const text = editText;
    setEditingId(null);
    // Unchanged (the box opens on the TRANSLATED label) → no write, so a
    // template step stays English data instead of turning into Arabic text.
    const cur = list.find(i => i.id === id);
    if (!text.trim() || !cur || text.trim() === dl(cur.title)) return;
    await mutate(cur => renameItem(cur, id, text));
  };

  return (
    <div style={{ display: 'grid', gap: 16 }} data-testid="checklist-panel">
      {error && (
        <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#991b1b', fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {/* Progress + templates */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <ListChecks className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            {t('Checklist')}
          </span>
        </div>

        {progress.total > 0 ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span className="ltr-data" style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
                {progress.done}/{progress.total}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700 }}>
                {t('steps done · {{percent}}%', { percent: progress.percent })}
              </span>
            </div>
            <div style={{ height: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', marginTop: 10 }}>
              <div style={{ width: `${progress.percent}%`, height: '100%', background: progress.late > 0 ? '#f59e0b' : '#16a34a' }} />
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 12.5 }}>
              {progress.next && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)' }}>
                  <CalendarClock className="w-3.5 h-3.5" />
                  {t('Next step:')} <strong className={fmt.bidiFor(dl(progress.next.title))} style={{ color: 'var(--text-primary)' }}>{dl(progress.next.title)}</strong>
                  {progress.next.dueDate ? ` · ${fmt.date(progress.next.dueDate)}` : ''}
                </span>
              )}
              {progress.late > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#dc2626', fontWeight: 700 }}>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {progress.late === 1 ? t('{{count}} step overdue', { count: 1 }) : t('{{count}} steps overdue', { count: progress.late })}
                </span>
              )}
            </div>
          </>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            {t('No checklist yet. Start from a standard list, then add or remove steps to suit this job.')}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {templates.map(tp => {
            const missing = missingSteps(tp.key, list).length;
            // Once a list is in use, offer to top up only THAT one (the template
            // sharing the most steps with it) — not to bolt a second list on.
            if (missing === 0 || (list.length > 0 && tp.key !== inUse)) return null;
            return (
              <button
                key={tp.key}
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => mutate(cur => addTemplateSteps(cur, tp.key, anchorDate, today))}
              >
                <Plus className="w-4 h-4" />
                {list.length === 0
                  ? t('Use the “{{name}}” list', { name: t(tp.label) })
                  : missing === 1
                    ? t('Add {{count}} missing step from “{{name}}”', { count: 1, name: t(tp.label) })
                    : t('Add {{count}} missing steps from “{{name}}”', { count: missing, name: t(tp.label) })}
              </button>
            );
          })}
          {redateN > 0 && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => mutate(cur => redate(cur, anchorDate, today))}>
              <RefreshCw className="w-4 h-4" />
              {redateN === 1
                ? t('Re-date {{count}} step from the {{anchor}}', { count: 1, anchor: anchorLabel })
                : t('Re-date {{count}} steps from the {{anchor}}', { count: redateN, anchor: anchorLabel })}
            </button>
          )}
        </div>
        {!anchorDate && list.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
            {t('Set the {{anchor}} first and every step gets a date of its own.', { anchor: anchorLabel })}
          </p>
        )}
      </div>

      {/* The steps */}
      {list.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          {list.map((it, idx) => {
            const late = !it.done && !!it.dueDate && it.dueDate < today;
            const dueToday = !it.done && it.dueDate === today;
            const label = dl(it.title);
            return (
              <div
                key={it.id}
                data-testid="checklist-row"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px',
                  borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                <button
                  title={it.done ? t('Mark as not done') : t('Mark as done')}
                  aria-label={it.done ? t('Mark as not done') : t('Mark as done')}
                  aria-pressed={it.done}
                  disabled={busy}
                  onClick={() => mutate(cur => setDone(cur, it.id, !it.done, today, who))}
                  style={{
                    width: 24, height: 24, flexShrink: 0, cursor: 'pointer', padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: it.done ? '#16a34a' : 'var(--surface)',
                    border: `1px solid ${it.done ? '#16a34a' : late ? '#dc2626' : 'var(--border)'}`,
                  }}
                >
                  {it.done && <Check className="w-4 h-4" style={{ color: '#fff' }} />}
                </button>

                {editingId === it.id ? (
                  <input
                    autoFocus
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onBlur={() => submitRename(it.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') submitRename(it.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    style={{ ...inputStyle, flex: '1 1 200px', padding: '5px 8px' }}
                  />
                ) : (
                  <span
                    className={fmt.bidiFor(label)}
                    style={{
                      flex: '1 1 200px', minWidth: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
                      textDecoration: it.done ? 'line-through' : 'none', opacity: it.done ? 0.7 : 1,
                    }}
                  >
                    {label}
                  </span>
                )}

                <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginInlineStart: 'auto', flexWrap: 'wrap' }}>
                  {it.done ? (
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {it.doneByName
                        ? t('Done {{date}} by {{name}}', { date: fmt.date(it.doneAt) || '', name: it.doneByName })
                        : t('Done {{date}}', { date: fmt.date(it.doneAt) || '' })}
                    </span>
                  ) : (
                    <>
                      {(late || dueToday) && (
                        <span style={{ fontSize: 11.5, fontWeight: 800, padding: '3px 8px', color: late ? '#991b1b' : '#92400e', background: late ? '#fee2e2' : '#fef3c7' }}>
                          {late ? t('Past due') : t('Due today')}
                        </span>
                      )}
                      <input
                        type="date"
                        aria-label={t('Due date')}
                        value={it.dueDate || ''}
                        disabled={busy}
                        // ⚠ Read the value NOW: the transaction runs later, by which time
                        // this controlled input has snapped back to the old date.
                        onChange={e => { const v = e.target.value; mutate(cur => setDue(cur, it.id, v)); }}
                        style={{ ...inputStyle, padding: '4px 8px', fontSize: 12 }}
                      />
                    </>
                  )}
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    title={t('Rename step')}
                    aria-label={t('Rename step')}
                    onClick={() => { setEditingId(it.id); setEditText(label); }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    title={t('Remove step')}
                    aria-label={t('Remove step')}
                    disabled={busy}
                    onClick={() => mutate(cur => removeItem(cur, it.id))}
                  >
                    <Trash2 className="w-3.5 h-3.5" style={{ color: '#dc2626' }} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Add a step */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 4, flex: '2 1 220px' }}>
            <span style={labelStyle}>{t('New step')}</span>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitAdd(); }}
              placeholder={t('e.g. Get the ISO certificate copy')}
              style={{ ...inputStyle, width: '100%' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>{t('Due date')}</span>
            <input type="date" value={due} onChange={e => setDueInput(e.target.value)} style={inputStyle} />
          </label>
          <button className="btn btn-primary" disabled={busy || !title.trim()} onClick={submitAdd}>
            <Plus className="w-4 h-4" /> {t('Add step')}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '9px 11px', background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
};
