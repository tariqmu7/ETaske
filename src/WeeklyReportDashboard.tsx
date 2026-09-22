import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import {
  FileText, ChevronLeft, ChevronRight, Copy, Download, Mail, RotateCcw, RefreshCw, Info, Check,
} from 'lucide-react';
import { db } from './lib/firebase';
import { getVisibleTasks } from './lib/taskVisibility';
import { useFormat } from './lib/format';
import {
  buildWeeklyFacts, writeArabicReport, arabicSubject, defaultWeek, shiftWeek, weekOf, parseWeekParam,
  type WeekRange, type WeeklyInput,
} from './lib/weeklyReport';
import { iso, localDate } from './lib/deadlineCalendar';
import { AppUser } from './types';
import type { AppView } from './App';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

const rows = (snap: any) => snap.docs.filter((d: any) => d.id !== '--stats--').map((d: any) => ({ id: d.id, ...d.data() }));

/** `#/weekly-report?w=2026-09-16` → that week; anything else → null (the default week). */
function weekFromHash(hash: string): WeekRange | null {
  const [view, qs] = hash.replace(/^#\/?/, '').split('?');
  if (view !== 'weekly-report' || !qs) return null;
  return parseWeekParam(new URLSearchParams(qs).get('w'));
}

const DEPT_KEY = 'etaske:weeklyreport:dept';
const readDept = () => { try { return localStorage.getItem(DEPT_KEY) || ''; } catch { return ''; } };
const saveDept = (v: string) => { try { localStorage.setItem(DEPT_KEY, v); } catch { /* private window */ } };

/** A mailto: URL longer than this is cut by some mail programs — copy instead. */
const MAILTO_MAX = 1900;

/** The collections the report reads, besides tasks (read through the privacy-aware helper). */
const SOURCES: Array<[keyof WeeklyInput, string]> = [
  ['correspondences', 'correspondences'],
  ['opportunities', 'opportunities'],
  ['projects', 'projects'],
  ['projectUpdates', 'projectUpdates'],
  ['meetings', 'meetings'],
  ['contracts', 'projectContracts'],
  ['subcontracts', 'projectSubcontracts'],
];

/**
 * Weekly department report (queue task D9) — a ready-to-send Arabic report of
 * one Sunday-to-Saturday week, written from the records themselves: tasks
 * finished and still late, letters in and closed, bids submitted and decided,
 * project updates, contracts running out, meetings, each colleague's share,
 * and the week ahead. Manager/Admin only — it speaks for the department.
 *
 * The boards are read ONCE per visit ("Read the records again" re-reads), so
 * the text never changes under the manager's hands while they edit it. The
 * text box is editable; nothing is written to the database and nothing is sent
 * from here — Copy, Download or an e-mail draft in the manager's own program.
 * The rules live in `lib/weeklyReport.ts` (pure, harness-covered).
 */
export default function WeeklyReportDashboard({ user, projectUsers }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();

  const [week, setWeek] = useState<WeekRange>(() => weekFromHash(window.location.hash) || defaultWeek());
  const [data, setData] = useState<WeeklyInput | null>(null);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [readAt, setReadAt] = useState(0);
  const [dept, setDept] = useState(readDept);
  const [draft, setDraft] = useState<string | null>(null);
  // The message keeps its KEY and is translated when painted, so it follows a language switch.
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; key: string } | null>(null);

  // One read of everything the report needs. A collection the rules refuse
  // (e.g. meetings before its rules are deployed) is left out and named.
  const load = useCallback(async () => {
    setData(null);
    const missing: string[] = [];
    const [tasks, ...rest] = await Promise.all([
      getVisibleTasks(user.uid).catch(err => { console.warn('Weekly report — tasks:', err?.code); missing.push('tasks'); return []; }),
      ...SOURCES.map(([, name]) => getDocs(collection(db, name)).then(rows).catch(err => {
        console.warn(`Weekly report — ${name}:`, err?.code); missing.push(name); return [];
      })),
    ]);
    const next: WeeklyInput = { tasks: tasks as any[] };
    SOURCES.forEach(([key], i) => { (next as any)[key] = rest[i]; });
    setUnreadable(missing);
    setData(next);
    setReadAt(Date.now());
    setDraft(null);
  }, [user.uid]);

  useEffect(() => { void load(); }, [load]);

  // Back / Forward and a pasted `#/weekly-report?w=…` link.
  useEffect(() => {
    const onHash = () => { const w = weekFromHash(window.location.hash); if (w) { setWeek(w); setDraft(null); } };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const thisWeek = weekOf(iso(new Date()));
  const goWeek = (w: WeekRange) => {
    if (w.start > thisWeek.start) return;
    setWeek(w);
    setDraft(null);
    setMessage(null);
    window.location.hash = `/weekly-report?w=${w.start}`;
  };

  // Colleague names come from App's live user list; it refreshing must not re-read the boards (that would drop edits).
  const facts = useMemo(() => (data ? buildWeeklyFacts({ ...data, users: projectUsers }, week) : null), [data, week, projectUsers]);
  const generated = useMemo(() => (facts ? writeArabicReport(facts, { department: dept }) : ''), [facts, dept]);
  const text = draft ?? generated;
  const edited = draft !== null && draft !== generated;

  const rangeText = `${fmt.date(localDate(week.start), { day: 'numeric', month: 'short' })} – ${fmt.date(localDate(week.end), { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const flash = (kind: 'ok' | 'error', key: string) => setMessage({ kind, key });

  const copy = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older browsers / no permission: select the text so Ctrl+C works.
      const box = document.querySelector<HTMLTextAreaElement>('[data-wr="text"]');
      box?.focus();
      box?.select();
      return false;
    }
  };
  const onCopy = async () => {
    if (await copy()) flash('ok', 'Copied — paste it into an e-mail or WhatsApp.');
    else flash('error', 'Could not copy by itself — the text is selected, press Ctrl+C.');
  };

  const onDownload = () => {
    // BOM so Notepad and Outlook open the Arabic as UTF-8.
    const blob = new Blob([String.fromCharCode(0xfeff) + text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly-report-${week.start}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash('ok', 'Saved as a text file.');
  };

  const onEmail = async () => {
    if (!facts) return;
    const subject = encodeURIComponent(arabicSubject(facts, dept));
    const body = encodeURIComponent(text);
    if (subject.length + body.length <= MAILTO_MAX) {
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
      return;
    }
    // Too long for a mailto: link — copy the text, open the draft with the subject only.
    const copied = await copy();
    window.location.href = `mailto:?subject=${subject}`;
    flash(copied ? 'ok' : 'error', copied ? 'The report is long, so it is copied — paste it into the e-mail.' : 'Could not copy by itself — the text is selected, press Ctrl+C.');
  };

  const small: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', minHeight: 36, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: 'var(--surface)', color: 'var(--blue-600)', border: '1px solid var(--border)',
  };
  const primary: React.CSSProperties = { ...small, background: 'var(--blue-600)', color: '#fff', border: '1px solid var(--blue-600)' };

  const tiles = facts ? [
    { key: 'done', label: t('Tasks finished'), value: facts.tasks.done.length },
    { key: 'letters', label: t('Letters received'), value: facts.letters.received.length },
    { key: 'submitted', label: t('Offers submitted'), value: facts.bids.submitted.length },
    { key: 'late', label: facts.current ? t('Late today') : t('Late at week end'), value: facts.tasks.late.length + facts.letters.overdue.length + facts.bids.missed.length, warn: true },
  ] : [];

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px 16px' }} data-wr="page">
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          <FileText size={22} style={{ color: 'var(--blue-600)' }} /> {t('Weekly report')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          {t('The department’s week, written in Arabic from what was recorded — ready to send.')}
        </p>
      </div>

      <section className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div role="group" aria-label={t('Week')} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" data-wr="prev" onClick={() => goWeek(shiftWeek(week, -1))} style={small} aria-label={t('Previous week')}>
            <ChevronLeft size={15} className="dir-arrow" /> <span>{t('Previous week')}</span>
          </button>
          <span data-wr="range" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', padding: '0 6px' }}>
            <bdi dir="auto">{rangeText}</bdi>
          </span>
          <button type="button" data-wr="next" onClick={() => goWeek(shiftWeek(week, 1))} disabled={week.start >= thisWeek.start}
            style={{ ...small, opacity: week.start >= thisWeek.start ? 0.45 : 1, cursor: week.start >= thisWeek.start ? 'default' : 'pointer' }} aria-label={t('Next week')}>
            <span>{t('Next week')}</span> <ChevronRight size={15} className="dir-arrow" />
          </button>
          {week.start !== thisWeek.start && (
            <button type="button" data-wr="this-week" onClick={() => goWeek(thisWeek)} style={small}>{t('This week')}</button>
          )}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', flex: '1 1 240px', minWidth: 0 }}>
          <span style={{ whiteSpace: 'nowrap' }}>{t('Department name in the heading')}</span>
          <input
            data-wr="dept"
            dir="rtl"
            lang="ar"
            value={dept}
            placeholder="إدارة …"
            onChange={e => { setDept(e.target.value); saveDept(e.target.value); setDraft(null); }}
            style={{ flex: 1, minWidth: 0, padding: '6px 10px', minHeight: 36, fontFamily: 'inherit', fontSize: 14, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
          />
        </label>
      </section>

      {!facts ? (
        <p role="status" data-wr="loading" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('Reading the boards…')}</p>
      ) : (
        <>
          <div data-wr="tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            {tiles.map(tile => (
              <div key={tile.key} className="card" data-wr={`tile-${tile.key}`} style={{ padding: '10px 14px' }}>
                <div className="ltr-data" style={{ fontSize: 24, fontWeight: 800, color: tile.warn && tile.value ? 'var(--danger)' : 'var(--text-primary)' }}>{tile.value}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{tile.label}</div>
              </div>
            ))}
          </div>

          {facts.empty && (
            <p data-wr="empty" style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
              {t('Nothing was recorded for this week. The report below says so.')}
            </p>
          )}

          <section className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <button type="button" data-wr="copy" onClick={onCopy} style={primary}><Copy size={14} /> {t('Copy')}</button>
              <button type="button" data-wr="email" onClick={onEmail} style={small}><Mail size={14} /> {t('E-mail draft')}</button>
              <button type="button" data-wr="download" onClick={onDownload} style={small}><Download size={14} /> {t('Download')}</button>
              {edited && (
                <button type="button" data-wr="reset" onClick={() => { setDraft(null); setMessage(null); }} style={small}><RotateCcw size={14} /> {t('Undo my edits')}</button>
              )}
              <button type="button" data-wr="reload" onClick={() => { setMessage(null); void load(); }} style={small}><RefreshCw size={14} /> {t('Read the records again')}</button>
            </div>
            {message && (
              <p role={message.kind === 'error' ? 'alert' : 'status'} data-wr="message" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: message.kind === 'error' ? 'var(--danger)' : 'var(--success)', margin: '0 0 10px' }}>
                {message.kind === 'ok' && <Check size={14} />} {t(message.key)}
              </p>
            )}
            <textarea
              data-wr="text"
              dir="rtl"
              lang="ar"
              aria-label={t('Report text')}
              value={text}
              onChange={e => setDraft(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%', minHeight: 520, padding: 14, boxSizing: 'border-box', resize: 'vertical',
                fontFamily: 'inherit', fontSize: 15, lineHeight: 1.8, color: 'var(--text-primary)',
                background: 'var(--surface-2)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap',
              }}
            />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
              {edited ? t('You have edited the text — changing the week or the heading starts again from the records.') : t('You can edit the text before sending it.')}
              {readAt ? <> {' · '}{t('Records read at {{time}}', { time: fmt.date(new Date(readAt), { hour: '2-digit', minute: '2-digit' }) })}</> : null}
            </p>
          </section>

          {unreadable.length > 0 && (
            <p role="status" data-wr="unreadable" style={{ fontSize: 12.5, color: 'var(--warning)', margin: '10px 0 0' }}>
              {t('Some records could not be read and are left out: {{list}}', { list: unreadable.join(', ') })}
            </p>
          )}

          <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 0', lineHeight: 1.5 }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              {t('A week runs Sunday to Saturday. “Late” and “open” are counted as they stood at the end of that week (today, for the current week).')}{' '}
              {t('A task finished outside the Tasks board has no finishing date, so its last edit is used; letters closed and bids decided are dated the same way when no date was entered.')}{' '}
              {t('Private tasks are never included. Nothing is saved or sent from this page.')}
            </span>
          </p>
        </>
      )}
    </div>
  );
}
