import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, X } from 'lucide-react';
import { isEdited, type BdData, type BdRow } from '../../lib/bdControl';
import {
  EDIT_FIELDS, KEY_FIELDS, diffForm, editNotes, isAppAdded, nextSr, planCreate, suggestions, toInput,
  type CreatePlan, type EditField, type EditTable, type EditWho,
} from '../../lib/bdControlEdit';
import { listenBdHistory, saveBdCreate, saveBdEdit, type BdHistoryEntry } from '../../lib/bdControlSave';
import { DATETIME_SHORT } from '../../lib/format';
import { useBdWords } from './shared';

/**
 * Editing a BD control record (queue E6b). One provider per page holds the
 * open form; any row shows an <EditButton> (managers + admin only, same as the
 * rules) and an <EditedBadge> once someone has changed it in eTaske. The form
 * shows, per field, what the Excel file said and who changed it, plus the
 * row's change log. An <AddButton> opens the same form empty, with the
 * record's key fields first, to add a new record (queue E6c).
 */
type Preset = Record<string, string>;
interface Ctx {
  canEdit: boolean;
  open: (table: EditTable, row: BdRow, title: string) => void;
  add: (table: EditTable, title: string, preset?: Preset) => void;
}
const EditCtx = createContext<Ctx>({ canEdit: false, open: () => {}, add: () => {} });
type Target =
  | { mode: 'edit'; table: EditTable; id: string; title: string }
  | { mode: 'add'; table: EditTable; title: string; preset: Preset; n: number };

export function BdEditProvider({ data, canEdit, who, children }: { data: BdData; canEdit: boolean; who: EditWho; children: React.ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  const ctx = useMemo<Ctx>(() => ({
    canEdit,
    open: (table, row, title) => setTarget({ mode: 'edit', table, id: row.id, title }),
    add: (table, title, preset = {}) => setTarget({ mode: 'add', table, title, preset, n: Date.now() }),
  }), [canEdit]);
  // Always the live row, so a change saved elsewhere shows at once.
  const row = target?.mode === 'edit' ? (data[target.table] as BdRow[]).find(r => r.id === target.id) : undefined;
  const close = () => setTarget(null);
  return (
    <EditCtx.Provider value={ctx}>
      {children}
      {canEdit && target?.mode === 'edit' && row && (
        <EditDialog key={target.table + '/' + target.id} data={data} table={target.table} row={row} title={target.title} who={who} onClose={close} />
      )}
      {canEdit && target?.mode === 'add' && (
        <EditDialog key={`add/${target.table}/${target.n}`} data={data} table={target.table} title={target.title} preset={target.preset} who={who} onClose={close} />
      )}
    </EditCtx.Provider>
  );
}

export function EditButton({ table, row, title }: { table: EditTable; row: BdRow; title: string }) {
  const { t } = useTranslation();
  const { canEdit, open } = useContext(EditCtx);
  if (!canEdit) return null;
  return (
    <button type="button" className="btn btn-ghost btn-sm bdc-edit" onClick={e => { e.preventDefault(); e.stopPropagation(); open(table, row, title); }}
      data-bdc-edit={`${table}:${row.id}`} aria-label={t('Edit {{x}}', { x: title })}>
      <Pencil size={14} /> {t('Edit')}
    </button>
  );
}

/** "Add …" for managers + admin: opens the form empty (`preset` filled in, e.g. the client on a client page). */
export function AddButton({ table, label, title, preset }: { table: EditTable; label: string; title: string; preset?: Preset }) {
  const { canEdit, add } = useContext(EditCtx);
  if (!canEdit) return null;
  return (
    <button type="button" className="btn btn-ghost btn-sm bdc-edit" onClick={() => add(table, title, preset)} data-bdc-add={table}>
      <Plus size={14} /> {label}
    </button>
  );
}

export function EditedBadge({ row }: { row: BdRow }) {
  const { t } = useTranslation();
  if (isAppAdded(row)) {
    return (
      <span className="bdc-pill bdc-pill-edit" data-bdc-added={row.id}
        title={row.createdByName ? t('Added in eTaske by {{name}}', { name: row.createdByName }) : undefined}>
        {t('Added in eTaske')}
      </span>
    );
  }
  if (!isEdited(row)) return null;
  const names = [...new Set(editNotes(row).map(n => n.byName).filter(Boolean))].join('، ');
  return (
    <span className="bdc-pill bdc-pill-edit" data-bdc-edited={row.id} title={names ? t('Changed in eTaske by {{names}}', { names }) : undefined}>
      {t('Edited in eTaske')}
    </span>
  );
}

const EMPTY_ROW: BdRow = { id: '' };

/** Edits `row`, or — with no row — adds a new record (key fields first, all required). */
function EditDialog({ data, table, row, preset, title, who, onClose }: {
  data: BdData; table: EditTable; row?: BdRow; preset?: Preset; title: string; who: EditWho; onClose: () => void;
}) {
  const w = useBdWords(data);
  const { t } = useTranslation();
  const { F } = w;
  const adding = !row;
  const rows = data[table] as BdRow[];
  const keyFields = useMemo(() => (adding ? KEY_FIELDS[table] : []), [adding, table]);
  const fields = useMemo(() => [...keyFields, ...EDIT_FIELDS[table]], [keyFields, table]);
  const [form, setForm] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = Object.fromEntries(fields.map(fd => [fd.key, row ? toInput(row[fd.key], fd.kind) : '']));
    if (adding && table === 'clientContracts') start.sr = String(nextSr(rows));
    return { ...start, ...(preset || {}) };
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<BdHistoryEntry[] | null>(null);
  const [logErr, setLogErr] = useState(false);
  const edit = useMemo(() => (row ? diffForm(table, row, form) : { changes: [], bad: [] as string[] }), [table, row, form]);
  const plan = useMemo(() => (adding ? planCreate(table, rows, form, who, null) : null), [adding, table, rows, form, who]);
  const refused = plan && !plan.ok ? (plan as Extract<CreatePlan, { ok: false }>) : null;
  const bad = refused ? refused.bad : edit.bad;
  const missing = refused ? refused.missing : [];
  const clash = refused ? refused.clash : null;
  const { changes } = edit;
  const canSave = adding ? !!plan?.ok : changes.length > 0 && bad.length === 0;
  const notes = useMemo(() => new Map(editNotes(row || EMPTY_ROW).map(n => [n.field, n])), [row]);
  const label = (key: string) => t(fields.find(fd => fd.key === key)?.label || key);
  const rowId = row?.id;

  useEffect(() => (rowId ? listenBdHistory(table, rowId, setLog, () => setLogErr(true)) : undefined), [table, rowId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, saving]);

  const lists = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const fd of fields) {
      if (fd.clients) out[fd.key] = data.clients.map(c => c.code).sort();
      else if (fd.suggest) out[fd.key] = suggestions(rows, fd.key);
    }
    return out;
  }, [fields, data, rows]);

  const shown = (v: unknown, kind?: EditField['kind']) => {
    if (v == null || v === '') return <span className="bdc-blank">{t('blank')}</span>;
    if (kind === 'date' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) return <>{w.date(v) || String(v)}</>;
    if (typeof v === 'number') return <>{F.number(v, { maximumFractionDigits: 2 })}</>;
    return w.bidi(String(v));
  };
  const when = (v: unknown) => (v && typeof (v as { seconds?: number }).seconds === 'number'
    ? F.dateTime(new Date((v as { seconds: number }).seconds * 1000), DATETIME_SHORT) : '');

  const save = async () => {
    if (!canSave) return;
    setSaving(true); setErr(null);
    try {
      if (row) await saveBdEdit(table, row, changes, who);
      else await saveBdCreate(table, rows, form, who);
      onClose();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setErr(code === 'permission-denied'
        ? t('Not saved: only managers can change BD control records, or the new security rules are not live yet.')
        : t('Not saved. Check the connection and try again.'));
      setSaving(false);
    }
  };

  const inputFor = (fd: EditField) => {
    const common = {
      id: `bdc-f-${fd.key}`, className: 'input', value: form[fd.key] ?? '', disabled: saving,
      'aria-invalid': bad.includes(fd.key) || undefined, 'aria-required': keyFields.includes(fd) || undefined, 'data-bdc-field': fd.key,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [fd.key]: e.target.value })),
      style: { width: '100%' },
    };
    if (fd.kind === 'long') return <textarea {...common} rows={2} />;
    if (fd.kind === 'date') return <input {...common} type="date" />;
    if (fd.kind === 'number') return <input {...common} inputMode="decimal" dir="ltr" />;
    return <input {...common} list={lists[fd.key] ? `bdc-l-${fd.key}` : undefined} />;
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal bdc-modal" role="dialog" aria-modal="true" aria-labelledby="bdc-edit-title" onClick={e => e.stopPropagation()}
        data-bdc-dialog={row ? `${table}:${row.id}` : `add:${table}`}>
        <div className="bdc-modal-head">
          <h2 id="bdc-edit-title" className="bdc-h" style={{ margin: 0 }}>{row ? t('Edit {{x}}', { x: title }) : title}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} disabled={saving} aria-label={t('Close')}><X size={18} /></button>
        </div>
        <p className="bdc-cap">{row
          ? t('Changes are saved in eTaske with your name. The next Excel refresh keeps them, and BD is told if the Excel file changed the same field.')
          : t('The new record is saved in eTaske with your name and shows in every chart at once. The next Excel refresh keeps it; add it to the Excel file too so the two match.')}</p>
        {row && isAppAdded(row) && (
          <p className="bdc-sub" data-bdc="added-by" style={{ whiteSpace: 'normal' }}>
            {[row.createdByName ? t('Added in eTaske by {{name}}', { name: row.createdByName }) : t('Added in eTaske'), when(row.createdAt)].filter(Boolean).join(' · ')}
          </p>
        )}

        <div className="bdc-form">
          {fields.map(fd => {
            const n = notes.get(fd.key);
            return (
              <div key={fd.key} className={`bdc-formrow${fd.kind === 'long' ? ' bdc-formrow-wide' : ''}`}>
                <label htmlFor={`bdc-f-${fd.key}`}>{t(fd.label)}{keyFields.includes(fd) && <span className="bdc-req" aria-hidden> *</span>}</label>
                {inputFor(fd)}
                {lists[fd.key] && lists[fd.key].length > 0 && (
                  <datalist id={`bdc-l-${fd.key}`}>{lists[fd.key].map(s => <option key={s} value={s} />)}</datalist>
                )}
                {bad.includes(fd.key) && (
                  <span className="bdc-field-err" data-bdc-bad={fd.key}>{fd.kind === 'number' ? t('Type a number, e.g. 1250000') : t('Pick a date')}</span>
                )}
                {n && (
                  <span className="bdc-field-note" data-bdc-note={fd.key}>
                    {t('Excel file:')} {shown(n.excelValue, fd.kind)}
                    {n.byName && <> · {t('changed by {{name}}', { name: n.byName })}</>}
                    {when(n.at) && <> · {when(n.at)}</>}
                    {toInput(n.excelValue, fd.kind) !== form[fd.key].trim() && (
                      <> · <button type="button" className="bdc-link" disabled={saving} data-bdc-revert={fd.key}
                        onClick={() => setForm(f => ({ ...f, [fd.key]: toInput(n.excelValue, fd.kind) }))}>{t('Use the Excel value')}</button></>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {clash && (
          <p className="bdc-field-err" role="alert" data-bdc="clash" style={{ marginTop: 10 }}>
            {t('This record is already on file. Close this form, open the record and use Edit.')}
          </p>
        )}
        {err && <p className="bdc-field-err" role="alert" data-bdc="save-error" style={{ marginTop: 10 }}>{err}</p>}
        <div className="bdc-modal-foot">
          <span className="bdc-sub" data-bdc="change-count">
            {adding
              ? (missing.length ? t('Still to fill in: {{list}}', { list: missing.map(label).join(w.ar ? '، ' : ', ') }) : clash ? '' : t('Ready to add'))
              : changes.length ? t('Fields changed: {{n}}', { n: F.number(changes.length) }) : t('Nothing changed yet')}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !canSave} data-bdc="save">
            {saving ? t('Saving…') : adding ? t('Add') : t('Save')}
          </button>
        </div>

        {row && <>
          <h3 className="bdc-h3">{t('Change log')}</h3>
          {logErr ? <p className="bdc-empty">{t('The change log could not be loaded.')}</p>
            : log == null ? <p className="bdc-empty">{t('Loading…')}</p>
            : log.length === 0 ? <p className="bdc-empty" data-bdc-empty="log">{t('No changes made in eTaske yet.')}</p>
            : <ul className="bdc-changes" data-bdc="log" style={{ borderBottom: 0, paddingInlineStart: 0 }}>
                {log.map(h => (
                  <li key={h.id} data-bdc-row="log" style={{ paddingInlineStart: 0 }}>
                    <span className="bdc-change-what">{[label(h.field), h.byName, when(h.at)].filter(Boolean).join(' · ')}</span>
                    <span className="bdc-change-vals">{shown(h.from)} <span className="bdc-arrow">→</span> {shown(h.to)}</span>
                  </li>
                ))}
              </ul>}
        </>}
      </div>
    </div>
  );
}
