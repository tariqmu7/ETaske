import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Printer, Download, Plus, Trash2, RotateCcw, RefreshCw, Check, Info, Lock } from 'lucide-react';
import {
  buildDailyTodo, arDueState, shortDay, sheetTitle, sheetDate, sheetCounts, KIND_AR,
  type TodoRow, type TodoInput,
} from '../lib/dailyTodo';
import { iso } from '../lib/deadlineCalendar';
import { addMyTodo, myLateBy, removeMyTodo, todosForDay, updateMyTodo, watchMyTodos, type MyTodo, type MyTodoPatch } from '../lib/myTodos';

interface Props {
  /** The signed-in person — owner of the "My daily tasks" list. */
  uid: string;
  /** The boards, read once by the Weekly report page. Null while reading. */
  data: TodoInput | null;
  /** Department name typed on the Weekly report page — used in the sheet's heading too. */
  department: string;
  onDepartment: (v: string) => void;
  onReload: () => void;
}

interface Draft { rows: TodoRow[]; extra: string }

const AHEAD_KEY = 'etaske:dailytodo:ahead';
const draftKey = (day: string) => `etaske:dailytodo:${day}`;
// Number(null) is 0, so a first visit must be told apart from a saved "today only".
const readAhead = () => { try { const v = localStorage.getItem(AHEAD_KEY); return v !== null && ['0', '3', '7'].includes(v) ? Number(v) : 3; } catch { return 3; } };
const readDraft = (day: string): Draft | null => {
  try { const v = JSON.parse(localStorage.getItem(draftKey(day)) || 'null'); return v && Array.isArray(v.rows) ? v : null; } catch { return null; }
};
const saveDraft = (day: string, d: Draft | null) => {
  try { if (d) localStorage.setItem(draftKey(day), JSON.stringify(d)); else localStorage.removeItem(draftKey(day)); } catch { /* private window */ }
};

const AHEAD_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Due today and late' },
  { value: 3, label: 'Next 3 days and late' },
  { value: 7, label: 'Next 7 days and late' },
];

/**
 * Daily to-do sheet — the second tab of the Weekly report page. Builds today's
 * pending items from the boards (lib/dailyTodo.ts), lets the person preparing
 * it edit, delete and add rows, then Print (an A4 landscape Arabic sheet with
 * "Done / Not done" boxes for the manager to tick by hand) or Download an Excel
 * copy to add more to. Edits to the generated list are kept in this browser
 * for that day only. Below it, "My daily tasks" is the person's own list, saved
 * to their account (lib/myTodos.ts) — only they can see it, and each row stays
 * until they tick it done. Both parts print on the same sheet.
 */
export default function DailyTodoSheet({ uid, data, department, onDepartment, onReload }: Props) {
  const { t } = useTranslation();
  const [day, setDay] = useState(() => iso(new Date()));
  const [ahead, setAhead] = useState(readAhead);
  const [draft, setDraftState] = useState<Draft | null>(() => readDraft(iso(new Date())));
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; key: string } | null>(null);

  const generated = useMemo(() => (data ? buildDailyTodo(data, day, { ahead }) : []), [data, day, ahead]);
  const rows = draft?.rows ?? generated;
  const extra = draft?.extra ?? '';
  const counts = sheetCounts(rows);

  const setDraft = (d: Draft | null) => { setDraftState(d); saveDraft(day, d); };
  const edit = (patch: Partial<Draft>) => setDraft({ rows, extra, ...patch });
  const editRow = (id: string, patch: Partial<TodoRow>) => edit({ rows: rows.map(r => (r.id === id ? { ...r, ...patch } : r)) });

  useEffect(() => { setDraftState(readDraft(day)); setMessage(null); }, [day]);

  // ── My daily tasks (saved to the account, owner-only) ──
  const [mine, setMine] = useState<MyTodo[] | null>(null);
  const [mineError, setMineError] = useState(false);
  // Typing is kept here and written when the box loses focus — one write per edit, not per key.
  const [typing, setTyping] = useState<Record<string, MyTodoPatch>>({});
  useEffect(() => watchMyTodos(uid, rs => { setMine(rs); setMineError(false); }, err => { console.warn('My daily tasks:', (err as any)?.code); setMineError(true); setMine([]); }), [uid]);
  const myRows = useMemo(() => todosForDay(mine || [], day).map(r => ({ ...r, ...typing[r.id] })), [mine, day, typing]);

  const failed = (what: string) => (err: unknown) => {
    console.warn(`My daily tasks — ${what}:`, err);
    setMessage({ kind: 'error', key: 'Could not save your task. Check the connection and try again.' });
  };
  const saveMine = (id: string, patch: MyTodoPatch) => updateMyTodo(id, patch).catch(failed('save'));
  const typeMine = (id: string, patch: MyTodoPatch) => setTyping(p => ({ ...p, [id]: { ...p[id], ...patch } }));
  const blurMine = (id: string) => {
    const patch = typing[id];
    if (!patch) return;
    setTyping(p => { const { [id]: _, ...rest } = p; return rest; });
    void saveMine(id, patch);
  };
  const tickMine = (r: MyTodo) => void saveMine(r.id, r.done ? { done: false, doneDay: '' } : { done: true, doneDay: day });
  const addMine = () => {
    setMessage(null);
    addMyTodo(uid, day, { title: '' })
      // Focus the new row's first box once the live list paints it.
      .then(id => setTimeout(() => document.querySelector<HTMLInputElement>(`[data-my-row="${id}"] [data-dt="my-title"]`)?.focus(), 150))
      .catch(failed('add'));
  };
  const deleteMine = (id: string) => void removeMyTodo(id).catch(failed('remove'));

  const onPrint = () => {
    setMessage(null);
    window.print();
  };

  const onExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const head = ['م', 'النوع', 'الرقم', 'البند', 'المسؤول', 'الإجراء المطلوب', 'الموعد', 'الحالة', 'تم', 'لم يتم', 'ملاحظات المدير'];
      const aoa: any[][] = [
        [sheetTitle(department)],
        [sheetDate(day)],
        [],
        head,
        ...rows.map((r, i) => [i + 1, KIND_AR[r.kind], r.serial || '', r.title, r.owner || '', r.action, r.due || '', arDueState(r), '', '', r.note || '']),
        ...myRows.map((r, i) => [rows.length + i + 1, MY_KIND_AR, '', r.title, r.owner || '', r.action || '', r.due || '',
          r.done ? 'تم' : arDueState(asRow(r, day)), r.done ? '✓' : '', '', r.note || '']),
      ];
      if (extra.trim()) aoa.push([], ['ملاحظات إضافية'], [extra.trim()]);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [4, 9, 11, 46, 18, 46, 11, 13, 7, 7, 30].map(wch => ({ wch }));
      const wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(wb, ws, 'قائمة اليوم');
      XLSX.writeFile(wb, `daily-todo-${day}.xlsx`);
      setMessage({ kind: 'ok', key: 'Saved as an Excel file — add more to it and print it from Excel.' });
    } catch (err) {
      console.warn('Daily to-do — Excel:', err);
      setMessage({ kind: 'error', key: 'Could not make the Excel file.' });
    }
  };

  const small: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', minHeight: 36, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: 'var(--surface)', color: 'var(--blue-600)', border: '1px solid var(--border)',
  };
  const primary: React.CSSProperties = { ...small, background: 'var(--blue-600)', color: '#fff', border: '1px solid var(--blue-600)' };
  const cellInput: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '5px 7px', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.5,
    border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)', resize: 'vertical',
  };
  const th: React.CSSProperties = { padding: '8px 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'start', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '6px', verticalAlign: 'top', borderBottom: '1px solid var(--border)' };

  return (
    <div data-dt="page">
      <section className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
          <span>{t('Day')}</span>
          <input type="date" data-dt="day" value={day} onChange={e => e.target.value && setDay(e.target.value)}
            style={{ padding: '6px 10px', minHeight: 36, fontFamily: 'inherit', fontSize: 14, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
          <span>{t('Include')}</span>
          <select data-dt="ahead" value={ahead} onChange={e => { const n = Number(e.target.value); setAhead(n); try { localStorage.setItem(AHEAD_KEY, String(n)); } catch { /* ignore */ } }}
            style={{ padding: '6px 10px', minHeight: 36, fontFamily: 'inherit', fontSize: 14, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}>
            {AHEAD_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', flex: '1 1 240px', minWidth: 0 }}>
          <span style={{ whiteSpace: 'nowrap' }}>{t('Department name in the heading')}</span>
          <input data-dt="dept" dir="rtl" lang="ar" value={department} placeholder="إدارة …" onChange={e => onDepartment(e.target.value)}
            style={{ flex: 1, minWidth: 0, padding: '6px 10px', minHeight: 36, fontFamily: 'inherit', fontSize: 14, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }} />
        </label>
        {draft && (
          <span style={{ flexBasis: '100%', fontSize: 12, color: 'var(--text-muted)' }}>{t('The list below has your edits; changing “Include” only shows once you start again.')}</span>
        )}
      </section>

      {!data ? (
        <p role="status" data-dt="loading" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('Reading the boards…')}</p>
      ) : (
        <>
          <div data-dt="tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            {[
              { key: 'total', label: t('Items on the list'), value: counts.total },
              { key: 'late', label: t('Late'), value: counts.late, warn: true },
              { key: 'today', label: t('Due today'), value: counts.today },
              { key: 'manager', label: t('Need the manager'), value: counts.forManager },
            ].map(tile => (
              <div key={tile.key} className="card" data-dt={`tile-${tile.key}`} style={{ padding: '10px 14px' }}>
                <div className="ltr-data" style={{ fontSize: 24, fontWeight: 800, color: tile.warn && tile.value ? 'var(--danger)' : 'var(--text-primary)' }}>{tile.value}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{tile.label}</div>
              </div>
            ))}
          </div>

          <section className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <button type="button" data-dt="print" onClick={onPrint} style={primary}><Printer size={14} /> {t('Print')}</button>
              <button type="button" data-dt="excel" onClick={onExcel} style={small}><Download size={14} /> {t('Download Excel')}</button>
              {draft && (
                <button type="button" data-dt="reset" onClick={() => { setDraft(null); setMessage(null); }} style={small}><RotateCcw size={14} /> {t('Start again from the records')}</button>
              )}
              <button type="button" data-dt="reload" onClick={() => { setMessage(null); onReload(); }} style={small}><RefreshCw size={14} /> {t('Read the records again')}</button>
            </div>
            {message && (
              <p role={message.kind === 'error' ? 'alert' : 'status'} data-dt="message" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: message.kind === 'error' ? 'var(--danger)' : 'var(--success)', margin: '0 0 10px' }}>
                {message.kind === 'ok' && <Check size={14} />} {t(message.key)}
              </p>
            )}

            {rows.length === 0 ? (
              <p data-dt="empty" style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '6px 0' }}>{t('Nothing is pending on the boards for this day. Add your own tasks below if you need a sheet anyway.')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table data-dt="table" dir="rtl" lang="ar" style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 28 }}>م</th>
                      <th style={th}>البند</th>
                      <th style={{ ...th, width: 140 }}>المسؤول</th>
                      <th style={th}>الإجراء المطلوب</th>
                      <th style={{ ...th, width: 96 }}>الموعد</th>
                      <th style={{ ...th, width: 160 }}>ملاحظة</th>
                      <th style={{ ...th, width: 36 }} aria-label={t('Remove')} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id} data-dt="row" data-kind={r.kind}>
                        <td style={{ ...td, fontWeight: 700 }} className="ltr-data">{i + 1}</td>
                        <td style={td}>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 3 }}>
                            {KIND_AR[r.kind]}{r.serial ? <> · <span className="ltr-data">{r.serial}</span></> : null}
                            {r.forManager && <span style={{ color: 'var(--blue-600)', fontWeight: 700 }}> · للمديرة</span>}
                          </div>
                          <input data-dt="title" dir="auto" value={r.title} placeholder="البند…" onChange={e => editRow(r.id, { title: e.target.value })} style={cellInput} aria-label={t('Item')} />
                        </td>
                        <td style={td}><input data-dt="owner" dir="auto" value={r.owner || ''} onChange={e => editRow(r.id, { owner: e.target.value })} style={cellInput} aria-label={t('Owner')} /></td>
                        <td style={td}><textarea data-dt="action" dir="auto" rows={2} value={r.action} placeholder="الإجراء…" onChange={e => editRow(r.id, { action: e.target.value })} style={cellInput} aria-label={t('Required action')} /></td>
                        <td style={td}>
                          <div className="ltr-data" style={{ fontSize: 13 }}>{shortDay(r.due)}</div>
                          {r.due && <div style={{ fontSize: 12, fontWeight: 700, color: (r.lateBy ?? -1) > 0 ? 'var(--danger)' : r.lateBy === 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{arDueState(r)}</div>}
                        </td>
                        <td style={td}><input data-dt="note" dir="auto" value={r.note || ''} onChange={e => editRow(r.id, { note: e.target.value })} style={cellInput} aria-label={t('Note')} /></td>
                        <td style={td}>
                          <button type="button" data-dt="remove" onClick={() => edit({ rows: rows.filter(x => x.id !== r.id) })} title={t('Remove')} aria-label={t('Remove')}
                            style={{ ...small, padding: 6, minHeight: 32, color: 'var(--danger)' }}><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <label style={{ display: 'block', marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
              {t('Extra notes for the printed sheet')}
              <textarea data-dt="extra" dir="rtl" lang="ar" rows={3} value={extra} onChange={e => edit({ extra: e.target.value })} style={{ ...cellInput, marginTop: 4 }} />
            </label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
              {t('Your edits to this list are kept in this browser for this day only. Nothing is saved to the boards.')}
            </p>
          </section>

          <section className="card" data-dt="mine" style={{ padding: 14, marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--label)' }}>{t('My daily tasks')}</h2>
              <button type="button" data-dt="add" onClick={addMine} style={primary}><Plus size={14} /> {t('Add a task')}</button>
            </div>
            <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
              <Lock size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{t('Your own tasks, saved to your account — only you can see them. Each one stays on your list every day until you tick it done, and prints on the same sheet.')}</span>
            </p>
            {mine === null ? (
              <p role="status" data-dt="mine-loading" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('Reading your tasks…')}</p>
            ) : mineError ? (
              <p role="alert" data-dt="mine-error" style={{ fontSize: 13, color: 'var(--danger)' }}>{t('Could not read your tasks. Check the connection and open the page again.')}</p>
            ) : myRows.length === 0 ? (
              <p data-dt="mine-empty" style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '6px 0' }}>{t('No tasks of your own for this day yet.')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table data-dt="mine-table" dir="rtl" lang="ar" style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 44, textAlign: 'center' }}>تم</th>
                      <th style={th}>المهمة</th>
                      <th style={{ ...th, width: 140 }}>المسؤول</th>
                      <th style={th}>الإجراء المطلوب</th>
                      <th style={{ ...th, width: 150 }}>الموعد</th>
                      <th style={{ ...th, width: 160 }}>ملاحظة</th>
                      <th style={{ ...th, width: 36 }} aria-label={t('Remove')} />
                    </tr>
                  </thead>
                  <tbody>
                    {myRows.map(r => {
                      const as = asRow(r, day);
                      return (
                        <tr key={r.id} data-dt="my-row" data-my-row={r.id} data-done={r.done ? 'yes' : 'no'} style={{ opacity: r.done ? 0.6 : 1 }}>
                          <td style={{ ...td, textAlign: 'center' }}>
                            <input type="checkbox" data-dt="my-done" checked={r.done} onChange={() => tickMine(r)} aria-label={t('Done')} style={{ width: 20, height: 20, cursor: 'pointer' }} />
                          </td>
                          <td style={td}>
                            {r.addedDay && r.addedDay < day && !r.done && (
                              <div data-dt="my-since" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 3 }}>منذ <span className="ltr-data">{shortDay(r.addedDay)}</span></div>
                            )}
                            <input data-dt="my-title" dir="auto" value={r.title} placeholder="المهمة…" onChange={e => typeMine(r.id, { title: e.target.value })} onBlur={() => blurMine(r.id)}
                              style={{ ...cellInput, textDecoration: r.done ? 'line-through' : undefined }} aria-label={t('Task')} />
                          </td>
                          <td style={td}><input data-dt="my-owner" dir="auto" value={r.owner || ''} onChange={e => typeMine(r.id, { owner: e.target.value })} onBlur={() => blurMine(r.id)} style={cellInput} aria-label={t('Owner')} /></td>
                          <td style={td}><textarea data-dt="my-action" dir="auto" rows={2} value={r.action || ''} placeholder="الإجراء…" onChange={e => typeMine(r.id, { action: e.target.value })} onBlur={() => blurMine(r.id)} style={cellInput} aria-label={t('Required action')} /></td>
                          <td style={td}>
                            <input type="date" data-dt="my-due" value={r.due || ''} onChange={e => void saveMine(r.id, { due: e.target.value })} style={cellInput} aria-label={t('Due date')} />
                            {r.due && !r.done && <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3, color: (as.lateBy ?? -1) > 0 ? 'var(--danger)' : as.lateBy === 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{arDueState(as)}</div>}
                          </td>
                          <td style={td}><input data-dt="my-note" dir="auto" value={r.note || ''} onChange={e => typeMine(r.id, { note: e.target.value })} onBlur={() => blurMine(r.id)} style={cellInput} aria-label={t('Note')} /></td>
                          <td style={td}>
                            <button type="button" data-dt="my-remove" onClick={() => deleteMine(r.id)} title={t('Remove')} aria-label={t('Remove')}
                              style={{ ...small, padding: 6, minHeight: 32, color: 'var(--danger)' }}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 0', lineHeight: 1.5 }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{t('The list holds open tasks and letters that are late or due soon, every urgent task, unread letters, bids waiting for price sign-off and bids whose deadline or next step is near. Private tasks are never included.')}</span>
          </p>

          {createPortal(<PrintSheet rows={rows} mine={myRows} extra={extra} day={day} department={department} />, document.body)}
        </>
      )}
    </div>
  );
}

const MY_KIND_AR = 'مهمتي';
/** A personal task in the shape the date helpers expect. */
const asRow = (r: MyTodo, day: string): TodoRow => ({ id: r.id, kind: 'manual', title: r.title, owner: r.owner, action: r.action || '', due: r.due, lateBy: myLateBy(r, day), note: r.note });

/** The paper copy: hidden on screen, the only thing that prints while this tab is open. */
function PrintSheet({ rows, mine, extra, day, department }: { rows: TodoRow[]; mine: MyTodo[]; extra: string; day: string; department: string }) {
  const c = sheetCounts(rows);
  const box = <span style={{ display: 'inline-block', width: 14, height: 14, border: '1.5px solid #000' }} />;
  const ticked = <span style={{ display: 'inline-block', width: 14, height: 14, border: '1.5px solid #000', lineHeight: '13px', fontSize: '11pt', fontWeight: 800 }}>✓</span>;
  const cell: React.CSSProperties = { border: '1px solid #000', padding: '5px 6px', verticalAlign: 'top', textAlign: 'start' };
  const head: React.CSSProperties = { ...cell, background: '#e8e8e8', fontWeight: 700, whiteSpace: 'nowrap' };
  return (
    <div className="dt-print" dir="rtl" lang="ar" data-dt="print-sheet">
      <style>{`
        @media screen { .dt-print { display: none; } }
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          html, body { background: #fff !important; }
          body > *:not(.dt-print) { display: none !important; }
          .dt-print { display: block; color: #000; background: #fff; font-size: 11pt; }
          .dt-print table { width: 100%; border-collapse: collapse; }
          .dt-print tr { break-inside: avoid; }
          .dt-print thead { display: table-header-group; }
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: '16pt', fontWeight: 800 }}>{sheetTitle(department)}</div>
          <div style={{ fontSize: '11pt' }}>{sheetDate(day)}</div>
        </div>
        <div style={{ fontSize: '10pt' }}>
          البنود: {c.total} · المتأخرة: {c.late} · مستحقة اليوم: {c.today} · تحتاج المديرة: {c.forManager}{mine.length ? ` · مهامي: ${mine.length}` : ''}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ ...head, width: '3%' }}>م</th>
            <th style={{ ...head, width: '27%' }}>البند</th>
            <th style={{ ...head, width: '11%' }}>المسؤول</th>
            <th style={{ ...head, width: '25%' }}>الإجراء المطلوب</th>
            <th style={{ ...head, width: '9%' }}>الموعد</th>
            <th style={{ ...head, width: '4%', textAlign: 'center' }}>تم</th>
            <th style={{ ...head, width: '5%', textAlign: 'center' }}>لم يتم</th>
            <th style={{ ...head, width: '16%' }}>ملاحظات المدير</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td style={cell}>{i + 1}</td>
              <td style={cell}>
                <div style={{ fontSize: '8.5pt', color: '#444' }}>{KIND_AR[r.kind]}{r.serial ? <> · <bdi>{r.serial}</bdi></> : null}{r.forManager ? ' · للمديرة' : ''}</div>
                <bdi>{r.title}</bdi>
              </td>
              <td style={cell}><bdi>{r.owner || ''}</bdi></td>
              <td style={{ ...cell, whiteSpace: 'pre-wrap' }}><bdi>{r.action}</bdi>{r.note ? <div style={{ fontSize: '9pt', color: '#444', marginTop: 2 }}><bdi>{r.note}</bdi></div> : null}</td>
              <td style={cell}><bdi>{shortDay(r.due)}</bdi>{r.due && <div style={{ fontSize: '9pt', fontWeight: (r.lateBy ?? -1) > 0 ? 700 : 400 }}>{arDueState(r)}</div>}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{box}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{box}</td>
              <td style={cell} />
            </tr>
          ))}
          {mine.length > 0 && (
            <tr data-dt="print-mine-head"><td colSpan={8} style={head}>مهامي اليومية</td></tr>
          )}
          {mine.map((r, i) => {
            const as = asRow(r, day);
            return (
              <tr key={r.id} data-dt="print-mine">
                <td style={cell}>{rows.length + i + 1}</td>
                <td style={cell}>
                  <div style={{ fontSize: '8.5pt', color: '#444' }}>{MY_KIND_AR}{r.addedDay && r.addedDay < day && !r.done ? <> · منذ <bdi>{shortDay(r.addedDay)}</bdi></> : null}</div>
                  <bdi>{r.title}</bdi>
                </td>
                <td style={cell}><bdi>{r.owner || ''}</bdi></td>
                <td style={{ ...cell, whiteSpace: 'pre-wrap' }}><bdi>{r.action || ''}</bdi>{r.note ? <div style={{ fontSize: '9pt', color: '#444', marginTop: 2 }}><bdi>{r.note}</bdi></div> : null}</td>
                <td style={cell}><bdi>{shortDay(r.due)}</bdi>{r.due && !r.done && <div style={{ fontSize: '9pt', fontWeight: (as.lateBy ?? -1) > 0 ? 700 : 400 }}>{arDueState(as)}</div>}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{r.done ? ticked : box}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{box}</td>
                <td style={cell} />
              </tr>
            );
          })}
          {/* Three blank lines for whatever comes up during the day. */}
          {[0, 1, 2].map(n => (
            <tr key={`blank-${n}`} style={{ height: 30 }}>
              <td style={cell}>{rows.length + mine.length + n + 1}</td><td style={cell} /><td style={cell} /><td style={cell} /><td style={cell} />
              <td style={{ ...cell, textAlign: 'center' }}>{box}</td><td style={{ ...cell, textAlign: 'center' }}>{box}</td><td style={cell} />
            </tr>
          ))}
        </tbody>
      </table>
      {extra.trim() && (
        <div style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}><b>ملاحظات إضافية: </b>{extra.trim()}</div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, fontSize: '10.5pt' }}>
        <span>أعدّه: ............................</span>
        <span>اطّلعت عليه المديرة: ............................</span>
        <span>التاريخ: ............................</span>
      </div>
      <div style={{ marginTop: 8, fontSize: '8pt', color: '#555' }}>أعدّ ETaske هذه القائمة من السجلات المدوّنة، ولا تشمل المهام الخاصة؛ أمّا «مهامي اليومية» فيُضيفها مُعِدّ القائمة بنفسه.</div>
    </div>
  );
}
