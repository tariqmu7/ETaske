import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { User } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  CalendarDays, ChevronLeft, ChevronRight, Target, Gavel, FileText, FileClock, FolderKanban,
  CheckSquare, MailOpen, AlertTriangle, Info,
} from 'lucide-react';
import { db } from './lib/firebase';
import { subscribeVisibleTasks } from './lib/taskVisibility';
import { requestOpen } from './lib/deepLink';
import { useFormat, DATE_MEDIUM } from './lib/format';
import {
  buildDeadlines, filterEvents, byDay, expiryWatch, monthGrid, monthSummary, parseMonth, monthKey,
  localDate, iso, CONTRACT_WARN_DAYS, type DeadlineEvent, type DeadlineGroup,
} from './lib/deadlineCalendar';
import { AppUser } from './types';
import type { AppView } from './App';

interface Props {
  user: User;
  appUser: AppUser;
  onNavigate: (v: AppView) => void;
}

const rows = (snap: any) => snap.docs.filter((d: any) => d.id !== '--stats--').map((d: any) => ({ id: d.id, ...d.data() }));

/** `#/calendar?m=2026-10` → that month; anything else → null (this month). */
function monthFromHash(hash: string) {
  const [view, qs] = hash.replace(/^#\/?/, '').split('?');
  if (view !== 'calendar' || !qs) return null;
  return parseMonth(new URLSearchParams(qs).get('m'));
}

/**
 * "In 5 days" / "5 days ago" with Arabic number agreement: 1 and 2 have their
 * own words, 3–10 take a plural noun and 11+ a singular one — separate keys,
 * because i18next's _one/_other pair cannot express it.
 */
export function countdownText(t: TFunction, daysLeft: number): string {
  if (daysLeft === 0) return t('Today');
  if (daysLeft === 1) return t('Tomorrow');
  if (daysLeft === 2) return t('In 2 days');
  if (daysLeft > 2) return daysLeft <= 10 ? t('In {{count}} days', { count: daysLeft }) : t('{{count}} days to go', { count: daysLeft });
  const n = -daysLeft;
  if (n === 1) return t('Yesterday');
  if (n === 2) return t('2 days ago');
  return n <= 10 ? t('{{count}} days ago', { count: n }) : t('{{count}} days back', { count: n });
}

function kindText(t: TFunction, e: DeadlineEvent): string {
  switch (e.kind) {
    case 'bid-deadline': return t('Tender deadline');
    case 'bid-decision': return t('Decision expected');
    case 'contract-end': return t('Contract ends');
    case 'subcontract-end': return t('Sub-contract ends');
    case 'project-end': return t('Project ends');
    case 'task-due': return t('Task due');
    case 'letter-due': return t('Reply due');
  }
}

const KIND_ICON: Record<DeadlineEvent['kind'], (size: number) => React.ReactNode> = {
  'bid-deadline': s => <Target size={s} />,
  'bid-decision': s => <Gavel size={s} />,
  'contract-end': s => <FileText size={s} />,
  'subcontract-end': s => <FileClock size={s} />,
  'project-end': s => <FolderKanban size={s} />,
  'task-due': s => <CheckSquare size={s} />,
  'letter-due': s => <MailOpen size={s} />,
};

/** Each group keeps an icon of its own as well as a colour, so the colour is never the only cue. */
const GROUP_COLOR: Record<DeadlineGroup, string> = {
  bid: 'var(--blue-600)',
  contract: 'var(--surface-warn-text)',
  project: 'var(--green-600)',
  task: 'var(--text-secondary)',
  letter: 'var(--text-secondary)',
};

const GROUPS: { value: DeadlineGroup | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bid', label: 'Bids' },
  { value: 'contract', label: 'Contracts' },
  { value: 'project', label: 'Projects' },
  { value: 'task', label: 'Tasks' },
  { value: 'letter', label: 'Letters' },
];

/** Chips a day cell shows before "+N more". */
const PER_CELL = 3;

/**
 * Deadline calendar (queue task D3) — tender deadlines, bid decisions,
 * contract and sub-contract ends, project ends, task and letter due dates on
 * one month grid, with a "Running out" box above it for contracts that end
 * within 60 days or already ended with nobody renewing or closing them.
 *
 * All the logic is in `lib/deadlineCalendar.ts` (pure, harness-covered).
 * Nothing is written. Below 720 px the grid gives way to a day-by-day list.
 */
export default function CalendarDashboard({ user, appUser, onNavigate }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const isManager = appUser.role === 'Admin' || appUser.role === 'Manager';

  const [tasks, setTasks] = useState<any[] | null>(null);
  const [letters, setLetters] = useState<any[] | null>(null);
  const [bids, setBids] = useState<any[] | null>(null);
  const [projects, setProjects] = useState<any[] | null>(null);
  const [contracts, setContracts] = useState<any[] | null>(null);
  const [subcontracts, setSubcontracts] = useState<any[] | null>(null);
  // Employees see their own tasks, letters and bids (settled rule 11);
  // contracts and projects are department-wide and show for everyone.
  const [mineOnly, setMineOnly] = useState(!isManager);
  const [group, setGroup] = useState<DeadlineGroup | 'all'>('all');
  const now = new Date();
  const todayIso = iso(now);
  const [month, setMonth] = useState(() => monthFromHash(window.location.hash) || { year: now.getFullYear(), month0: now.getMonth() });
  const [selected, setSelected] = useState<string>(todayIso);

  useEffect(() => {
    // Privacy-aware: only the tasks this person may read (public + own).
    const unsubT = subscribeVisibleTasks(user.uid, list => setTasks(list), () => setTasks([]));
    const sub = (name: string, set: (v: any[]) => void) => onSnapshot(collection(db, name), s => set(rows(s)),
      err => { console.warn(`Calendar — ${name} listener:`, err.code); set([]); });
    const u = [
      sub('correspondences', setLetters),
      sub('opportunities', setBids),
      sub('projects', setProjects),
      sub('projectContracts', setContracts),
      sub('projectSubcontracts', setSubcontracts),
    ];
    return () => { unsubT(); u.forEach(f => f()); };
  }, [user.uid]);

  // Back / Forward and a pasted `#/calendar?m=…` link.
  useEffect(() => {
    const onHash = () => { const m = monthFromHash(window.location.hash); if (m) setMonth(m); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const goMonth = (year: number, month0: number) => {
    const d = new Date(year, month0, 1);
    const next = { year: d.getFullYear(), month0: d.getMonth() };
    setMonth(next);
    window.location.hash = `/calendar?m=${monthKey(next.year, next.month0)}`;
    const thisMonth = next.year === now.getFullYear() && next.month0 === now.getMonth();
    setSelected(thisMonth ? todayIso : iso(new Date(next.year, next.month0, 1)));
  };

  const loaded = !!(tasks && letters && bids && projects && contracts && subcontracts);
  const all = useMemo(
    () => (loaded ? buildDeadlines({ tasks: tasks!, correspondences: letters!, opportunities: bids!, projects: projects!, contracts: contracts!, subcontracts: subcontracts! }) : []),
    [loaded, tasks, letters, bids, projects, contracts, subcontracts],
  );
  const shown = useMemo(
    () => filterEvents(all, { uid: user.uid, mineOnly, groups: group === 'all' ? 'all' : [group] }),
    [all, user.uid, mineOnly, group],
  );
  const days = useMemo(() => byDay(shown), [shown]);
  // The watch ignores the type chips — a contract running out is never filtered away.
  const watch = useMemo(() => expiryWatch(all), [all]);
  const weeks = useMemo(() => monthGrid(month.year, month.month0), [month]);
  const sum = monthSummary(shown, month.year, month.month0);
  const prefix = monthKey(month.year, month.month0);
  const monthDays = [...days.keys()].filter(d => d.startsWith(prefix)).sort();

  const open = (e: DeadlineEvent) => {
    if (!e.open) return;
    requestOpen({ type: e.open.type, id: e.open.id, label: e.open.label, serial: e.open.serial });
    onNavigate(e.open.type === 'task' ? 'tasks'
      : e.open.type === 'corresponding' ? 'correspondences'
        : e.open.type === 'opportunity' ? 'opportunities' : 'projects');
  };

  const monthTitle = fmt.date(new Date(month.year, month.month0, 1, 12), { month: 'long', year: 'numeric' });
  const weekdays = weeks[0].map(d => fmt.date(localDate(d.date), { weekday: 'short' }));
  const longDay = (d: string) => fmt.date(localDate(d), { weekday: 'long', day: 'numeric', month: 'long' });

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px', minHeight: 36, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
    background: active ? 'var(--blue-600)' : 'var(--surface)', color: active ? '#fff' : 'var(--text-secondary)',
    border: `1px solid ${active ? 'var(--blue-600)' : 'var(--border)'}`,
  });
  const navBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 36, minHeight: 36, padding: '0 10px',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
  };

  const selectedEvents = days.get(selected) || [];

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px' }} data-cal="page">
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          <CalendarDays size={22} style={{ color: 'var(--blue-600)' }} /> {t('Calendar')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          {t('Tender deadlines, contract ends and due dates, month by month.')}
        </p>
      </div>

      {/* ── Running out ── */}
      {loaded && (watch.ending.length > 0 || watch.ended.length > 0) && (
        <section className="card" data-cal="watch" style={{ padding: 16, marginBottom: 16, background: 'var(--surface-warn)', border: '1px solid var(--surface-warn-border)' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 800, color: 'var(--surface-warn-text)', margin: '0 0 4px' }}>
            <AlertTriangle size={17} /> {t('Contracts running out')}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
            {t('Renew, extend or close each one before it lapses. An amendment with a later end date counts as renewed.')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 16 }}>
            {watch.ended.length > 0 && (
              <div data-cal="watch-ended">
                <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)', margin: '0 0 6px' }}>
                  {t('Ended — not renewed or closed')} <span className="ltr-data">{watch.ended.length}</span>
                </h3>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {watch.ended.map(e => <EventRow key={e.key} e={e} t={t} when={fmt.date(localDate(e.date), DATE_MEDIUM)} onOpen={() => open(e)} />)}
                </ul>
              </div>
            )}
            {watch.ending.length > 0 && (
              <div data-cal="watch-ending">
                <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--surface-warn-text)', margin: '0 0 6px' }}>
                  {t('Ending within {{count}} days', { count: CONTRACT_WARN_DAYS })} <span className="ltr-data">{watch.ending.length}</span>
                </h3>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {watch.ending.map(e => <EventRow key={e.key} e={e} t={t} when={fmt.date(localDate(e.date), DATE_MEDIUM)} onOpen={() => open(e)} />)}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" data-cal="prev" aria-label={t('Previous month')} onClick={() => goMonth(month.year, month.month0 - 1)} style={navBtn}>
            <ChevronLeft size={16} className="dir-arrow" />
          </button>
          <h2 data-cal="month" style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0, minWidth: 150, textAlign: 'center' }}>{monthTitle}</h2>
          <button type="button" data-cal="next" aria-label={t('Next month')} onClick={() => goMonth(month.year, month.month0 + 1)} style={navBtn}>
            <ChevronRight size={16} className="dir-arrow" />
          </button>
          <button type="button" data-cal="today" onClick={() => goMonth(now.getFullYear(), now.getMonth())} style={navBtn}>{t('Today')}</button>
        </div>
        <span style={{ flex: 1 }} />
        {isManager && (
          <div role="group" aria-label={t('Whose items')} style={{ display: 'flex' }}>
            <button type="button" data-cal="scope-all" aria-pressed={!mineOnly} onClick={() => setMineOnly(false)} style={chip(!mineOnly)}>{t('Everyone')}</button>
            <button type="button" data-cal="scope-mine" aria-pressed={mineOnly} onClick={() => setMineOnly(true)} style={chip(mineOnly)}>{t('Mine')}</button>
          </div>
        )}
        <div role="group" aria-label={t('Type')} style={{ display: 'flex', flexWrap: 'wrap' }}>
          {GROUPS.map(g => (
            <button key={g.value} type="button" data-cal={`group-${g.value}`} aria-pressed={group === g.value} onClick={() => setGroup(g.value)} style={chip(group === g.value)}>
              {t(g.label)}
            </button>
          ))}
        </div>
      </div>

      <p data-cal="summary" style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        {!loaded ? t('Reading the boards…')
          : sum.count === 0 ? t('No dates this month.')
            : [
              sum.count === 1 ? t('1 date this month') : t('{{count}} dates this month', { count: sum.count }),
              sum.tenders ? t('Tender deadlines: {{count}}', { count: sum.tenders }) : '',
              sum.contracts ? t('Contract ends: {{count}}', { count: sum.contracts }) : '',
              sum.late ? t('Already passed: {{count}}', { count: sum.late }) : '',
            ].filter(Boolean).join(' · ')}
      </p>

      {/* ── Month grid (wide screens) ── */}
      <div className="cal-grid card" data-cal="grid" style={{ padding: 0, overflow: 'hidden' }}>
        <div role="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid var(--border)' }}>
          {weekdays.map((w, i) => (
            <div key={i} role="columnheader" style={{ padding: '8px 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center' }}>{w}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} role="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: wi < weeks.length - 1 ? '1px solid var(--border)' : 'none' }}>
            {week.map((d, di) => {
              const list = days.get(d.date) || [];
              const isToday = d.date === todayIso;
              const isSel = d.date === selected;
              const late = list.some(e => e.state === 'late');
              return (
                <div
                  key={d.date}
                  data-cal="day"
                  data-date={d.date}
                  data-count={list.length}
                  onClick={() => setSelected(d.date)}
                  style={{
                    minHeight: 104, padding: 6, minWidth: 0, cursor: 'pointer',
                    borderInlineStart: di > 0 ? '1px solid var(--border)' : 'none',
                    background: isSel ? 'var(--surface-2)' : d.inMonth ? 'var(--surface)' : 'var(--surface-3)',
                    outline: isSel ? '2px solid var(--blue-600)' : 'none', outlineOffset: -2,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <button
                      type="button"
                      data-cal="daynum"
                      className="ltr-data"
                      aria-label={longDay(d.date)}
                      aria-pressed={isSel}
                      onClick={ev => { ev.stopPropagation(); setSelected(d.date); }}
                      style={{
                        fontFamily: 'inherit', fontSize: 12, fontWeight: isToday ? 800 : 600, cursor: 'pointer', border: 'none',
                        color: isToday ? '#fff' : d.inMonth ? 'var(--text-primary)' : 'var(--text-muted)',
                        background: isToday ? 'var(--blue-600)' : 'none', minWidth: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                      }}
                    >{Number(d.date.slice(8))}</button>
                    {late && <span aria-hidden style={{ width: 6, height: 6, background: 'var(--danger)' }} />}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {list.slice(0, PER_CELL).map(e => (
                      <button
                        key={e.key}
                        type="button"
                        data-cal="chip"
                        data-key={e.key}
                        title={`${kindText(t, e)} · ${e.title}`}
                        onClick={ev => { ev.stopPropagation(); open(e); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: '2px 4px', minWidth: 0,
                          fontFamily: 'inherit', fontSize: 11, fontWeight: 600, textAlign: 'start', cursor: 'pointer',
                          background: 'var(--surface-2)', border: 'none', borderInlineStart: `3px solid ${e.state === 'late' ? 'var(--danger)' : GROUP_COLOR[e.group]}`,
                          color: e.state === 'late' ? 'var(--danger)' : 'var(--text-primary)',
                        }}
                      >
                        <span style={{ color: GROUP_COLOR[e.group], display: 'flex', flexShrink: 0 }}>{KIND_ICON[e.kind](11)}</span>
                        <span dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{e.title}</span>
                      </button>
                    ))}
                    {list.length > PER_CELL && (
                      <span data-cal="more" style={{ fontSize: 11, fontWeight: 600, color: 'var(--blue-600)', padding: '0 4px' }}>
                        {t('+{{count}} more', { count: list.length - PER_CELL })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── The selected day (wide screens) ── */}
      <section className="cal-grid card" data-cal="day-panel" style={{ padding: 16, marginTop: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px' }}>{longDay(selected)}</h3>
        {selectedEvents.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{t('Nothing falls due on this day.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selectedEvents.map(e => <EventRow key={e.key} e={e} t={t} onOpen={() => open(e)} />)}
          </ul>
        )}
      </section>

      {/* ── Day-by-day list (narrow screens) ── */}
      <div className="cal-agenda" data-cal="agenda">
        {loaded && monthDays.length === 0 && (
          <p className="card" style={{ padding: 16, fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{t('No dates this month.')}</p>
        )}
        {monthDays.map(d => (
          <section key={d} className="card" data-cal="agenda-day" data-date={d} style={{ padding: 12, marginBottom: 10 }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, color: d === todayIso ? 'var(--blue-600)' : 'var(--text-primary)', margin: '0 0 8px' }}>
              {longDay(d)}{d === todayIso && <> · {t('Today')}</>}
            </h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {days.get(d)!.map(e => <EventRow key={e.key} e={e} t={t} onOpen={() => open(e)} />)}
            </ul>
          </section>
        ))}
      </div>

      <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 0', lineHeight: 1.5 }}>
        <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          {t('Shows open work only: bids not yet submitted (their deadline) or awaiting a decision (the date the client gave), contracts and sub-contracts not closed, running projects, open tasks and letters.')}
          {isManager && <> {t('Managers get a bell and Telegram alert 60, 30, 14 and 7 days before a contract ends, on the day, and once after it lapses.')}</>}
        </span>
      </p>
    </div>
  );
}

// ── One row ──────────────────────────────────────────────────────────────────

function EventRow({ e, t, when, onOpen }: { e: DeadlineEvent; t: TFunction; when?: string; onOpen: () => void }) {
  const sub = [kindText(t, e), e.context, e.owner].filter(Boolean) as string[];
  const late = e.state === 'late';
  const badge: React.CSSProperties = late
    ? { background: 'var(--surface)', color: 'var(--danger)', border: '1px solid var(--danger)' }
    : e.state === 'today' || e.state === 'soon' || e.watch
      ? { background: 'var(--surface-warn)', color: 'var(--surface-warn-text)', border: '1px solid var(--surface-warn-border)' }
      : { background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' };
  return (
    <li data-cal="row" data-key={e.key} data-state={e.state} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', minWidth: 0 }}>
      <button
        type="button"
        onClick={onOpen}
        disabled={!e.open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', textAlign: 'start', background: 'none', border: 'none', cursor: e.open ? 'pointer' : 'default', fontFamily: 'inherit', minWidth: 0 }}
      >
        <span style={{ color: GROUP_COLOR[e.group], display: 'flex', flexShrink: 0 }}>{KIND_ICON[e.kind](15)}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
            {e.serial && <span className="ltr-data" style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{e.serial}</span>}
            <span dir="auto" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
          </span>
          {/* Each piece isolated: an English name inside an Arabic line would
              otherwise drag its neighbours out of order. */}
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sub.map((part, i) => <React.Fragment key={i}>{i > 0 && ' · '}<bdi>{part}</bdi></React.Fragment>)}
            {when && <> · <bdi>{when}</bdi></>}
          </span>
        </span>
        <span data-cal="when" style={{ ...badge, flexShrink: 0, padding: '3px 8px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {countdownText(t, e.daysLeft)}
        </span>
      </button>
    </li>
  );
}
