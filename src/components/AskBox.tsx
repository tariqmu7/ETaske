import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { User } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  MessageCircleQuestion, CheckSquare, MailOpen, Target, FolderKanban, ArrowRight, X, Info,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { subscribeVisibleTasks } from '../lib/taskVisibility';
import { requestOpen } from '../lib/deepLink';
import { useFormat, DATE_MEDIUM } from '../lib/format';
import { useDisplayLabel } from '../lib/displayLabel';
import {
  readQuestion, answerQuestion,
  taskRecord, correspondingRecord, opportunityRecord, projectRecord,
  type AskRecord, type AskKind, type AskQuery,
} from '../lib/askRecords';
import { AppUser } from '../types';
import type { AppView } from '../App';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

const KIND_META: Record<AskKind, { label: string; icon: React.ReactNode }> = {
  task: { label: 'Tasks', icon: <CheckSquare size={14} /> },
  corresponding: { label: 'Correspondences', icon: <MailOpen size={14} /> },
  opportunity: { label: 'Opportunities', icon: <Target size={14} /> },
  project: { label: 'Projects', icon: <FolderKanban size={14} /> },
};

const EXAMPLES = [
  'What did we send NNPC in July?',
  'Open bids closing this month',
  'My overdue tasks',
  'How many tenders did we win this year?',
];

const SHOW_FIRST = 15;

/** yyyy-mm-dd → a local Date (new Date('yyyy-mm-dd') would be UTC midnight). */
const localDate = (isoDay: string) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/**
 * Ask-it questions (queue task D11) — a question box on Home.
 *
 * "What did we send NNPC in July?" is read into filters by the pure rules in
 * `lib/askRecords.ts` (no AI — a static public site has nowhere safe for a key)
 * and run over the four boards the reader can already see. The answer shows
 * what the question was understood as, so a wrong reading is obvious, and
 * every row opens its record. Nothing is written.
 *
 * The boards are only read once the person starts using the box, so Home costs
 * nothing extra for somebody who never asks.
 */
export default function AskBox({ user, appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const label = useDisplayLabel();
  const [text, setText] = useState('');
  const [asked, setAsked] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [wanted, setWanted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [tasks, setTasks] = useState<AskRecord[] | null>(null);
  const [corrs, setCorrs] = useState<AskRecord[] | null>(null);
  const [bids, setBids] = useState<AskRecord[] | null>(null);
  const [projects, setProjects] = useState<AskRecord[] | null>(null);

  useEffect(() => {
    if (!wanted) return;
    const rows = (snap: any, make: (d: any) => AskRecord) => snap.docs
      .filter((d: any) => d.id !== '--stats--')
      .map((d: any) => make({ id: d.id, ...d.data() }));
    // Privacy-aware: only the tasks this person may read (public + own).
    const unsubT = subscribeVisibleTasks(user.uid, list => setTasks(list.map(taskRecord)),
      () => setTasks([]));
    const unsubC = onSnapshot(collection(db, 'correspondences'), s => setCorrs(rows(s, correspondingRecord)),
      err => { console.warn('Ask — correspondences listener:', err.code); setCorrs([]); });
    const unsubO = onSnapshot(collection(db, 'opportunities'), s => setBids(rows(s, opportunityRecord)),
      err => { console.warn('Ask — opportunities listener:', err.code); setBids([]); });
    const unsubP = onSnapshot(collection(db, 'projects'), s => setProjects(rows(s, projectRecord)),
      err => { console.warn('Ask — projects listener:', err.code); setProjects([]); });
    return () => { unsubT(); unsubC(); unsubO(); unsubP(); };
  }, [wanted, user.uid]);

  const loaded = !!(tasks && corrs && bids && projects);
  const records = useMemo(
    () => (loaded ? [...tasks!, ...corrs!, ...bids!, ...projects!] : []),
    [loaded, tasks, corrs, bids, projects],
  );

  const people = useMemo(() => {
    const list = projectUsers
      .filter(u => u.status === 'Approved' && u.displayName)
      .map(u => ({ id: u.id, name: u.displayName }));
    if (!list.some(p => p.id === user.uid)) list.push({ id: user.uid, name: appUser.displayName });
    return list;
  }, [projectUsers, user.uid, appUser.displayName]);

  // Every client, sender and project name the boards know.
  const parties = useMemo(() => {
    const names = new Set<string>();
    for (const r of records) {
      if (r.party) names.add(r.party.trim());
      if (r.kind === 'project' && r.title) names.add(r.title.trim());
    }
    return [...names].filter(n => n.length >= 3);
  }, [records]);

  const query: AskQuery | null = useMemo(
    () => (asked ? readQuestion(asked, { me: { id: user.uid, name: appUser.displayName }, people, parties }) : null),
    [asked, people, parties, user.uid, appUser.displayName],
  );
  const answer = useMemo(
    () => (query && loaded ? answerQuestion(query, records) : null),
    [query, loaded, records],
  );

  const ask = (q: string) => {
    const clean = q.trim();
    setWanted(true);
    setShowAll(false);
    setAsked(clean);
    if (clean !== text) setText(clean);
  };
  const clear = () => { setText(''); setAsked(''); inputRef.current?.focus(); };

  const open = (r: AskRecord) => {
    const ref = { id: r.id, label: r.title, serial: r.serial };
    if (r.kind === 'task') { requestOpen({ type: 'task', ...ref }); onNavigate('tasks'); }
    else if (r.kind === 'corresponding') { requestOpen({ type: 'corresponding', ...ref }); onNavigate('correspondences'); }
    else if (r.kind === 'opportunity') { requestOpen({ type: 'opportunity', ...ref }); onNavigate('opportunities'); }
    else { requestOpen({ type: 'project', ...ref }); onNavigate('projects'); }
  };

  const understood = query ? understoodChips(query, t, label, fmt) : [];
  const rows = answer ? (showAll ? answer.rows : answer.rows.slice(0, SHOW_FIRST)) : [];
  const dateOf = (r: AskRecord) => (query?.dateField === 'due' ? r.due : r.date) || r.date || r.due;

  return (
    <div className="card" data-ask="box" style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 16, marginBottom: 24 }}>
      <label htmlFor="ask-box" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
        <MessageCircleQuestion size={16} style={{ color: 'var(--blue-600)' }} />
        {t('Ask ETaske')}
      </label>
      <form
        onSubmit={e => { e.preventDefault(); ask(text); }}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        <input
          id="ask-box"
          ref={inputRef}
          className="input"
          type="search"
          dir="auto"
          value={text}
          onFocus={() => setWanted(true)}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape' && text) { e.preventDefault(); clear(); } }}
          placeholder={t('Ask a question — e.g. “What did we send NNPC in July?”')}
          style={{ flex: '1 1 240px', minWidth: 0, fontFamily: 'inherit', fontSize: 14 }}
        />
        <button
          type="submit"
          disabled={!text.trim()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', minHeight: 40,
            cursor: text.trim() ? 'pointer' : 'default', opacity: text.trim() ? 1 : 0.6,
            background: 'var(--blue-600)', color: '#fff', border: 'none', fontFamily: 'inherit', fontWeight: 600, fontSize: 13,
          }}
        >
          {t('Ask')} <ArrowRight size={15} className="dir-arrow" />
        </button>
      </form>

      {!asked && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>{t('Try:')}</span>
          {EXAMPLES.map(ex => (
            <button
              key={ex}
              type="button"
              data-ask="example"
              onClick={() => ask(t(ex))}
              dir="auto"
              style={{
                padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
              }}
            >
              {t(ex)}
            </button>
          ))}
        </div>
      )}

      {asked && !query && (
        <p data-ask="unread" style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '12px 0 0', lineHeight: 1.5 }}>
          {t('I could not read a question there. Name a client, a person, a month or a board — e.g. “letters from EGPC last month”.')}
        </p>
      )}

      {asked && query && !loaded && (
        <p role="status" style={{ fontSize: 13, color: 'var(--text-muted)', margin: '12px 0 0' }}>{t('Reading the boards…')}</p>
      )}

      {answer && (
        <div data-ask="answer" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span data-ask="count" style={{ fontSize: query!.count ? 22 : 15, fontWeight: 800, color: 'var(--text-primary)' }}>
              {t('Found: {{count}}', { count: answer.rows.length })}
            </span>
            {(Object.keys(answer.byKind) as AskKind[]).filter(k => answer.byKind[k] > 0).map(k => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                {KIND_META[k].icon}{t(KIND_META[k].label)} · {answer.byKind[k]}
              </span>
            ))}
            <button
              type="button"
              onClick={clear}
              style={{
                marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', cursor: 'pointer',
                background: 'none', border: 'none', color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: 12,
              }}
            >
              <X size={13} /> {t('Clear')}
            </button>
          </div>

          {understood.length > 0 && (
            <div data-ask="understood" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>{t('Understood as:')}</span>
              {understood.map(c => (
                <span key={c} dir="auto" style={{
                  padding: '3px 8px', fontSize: 12, fontWeight: 600,
                  background: 'rgba(59,130,246,0.08)', color: 'var(--blue-600)', border: '1px solid rgba(59,130,246,0.25)',
                }}>{c}</span>
              ))}
            </div>
          )}

          {(query!.direction === 'sent' || answer.loosened) && (
            <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.5 }}>
              <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {query!.direction === 'sent' && t('Only what was logged in ETaske — mail sent straight from Outlook is not here.')}
                {query!.direction === 'sent' && answer.loosened && ' '}
                {answer.loosened && t('No record had every word, so records with any of them are shown.')}
              </span>
            </p>
          )}

          {answer.rows.length === 0 ? (
            <p data-ask="empty" style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '12px 0 0' }}>
              {t('Nothing found. Try fewer words or a different period.')}
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map(r => {
                const d = dateOf(r);
                return (
                  <li key={`${r.kind}:${r.id}`}>
                    <button
                      type="button"
                      data-ask="row"
                      onClick={() => open(r)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', cursor: 'pointer', textAlign: 'start',
                        background: 'var(--surface-2)', border: '1px solid var(--border)', fontFamily: 'inherit', minWidth: 0,
                      }}
                    >
                      <span style={{ color: 'var(--blue-600)', display: 'flex', flexShrink: 0 }} title={t(KIND_META[r.kind].label)}>
                        {KIND_META[r.kind].icon}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
                          {r.serial && <span className="ltr-data" style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{r.serial}</span>}
                          <span dir="auto" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.title || '—'}
                          </span>
                        </span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[r.from || r.party, label(r.status), r.ownerName].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {d && (
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>
                          {fmt.date(localDate(d), DATE_MEDIUM)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!showAll && answer.rows.length > SHOW_FIRST && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              style={{
                marginTop: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                background: 'var(--surface)', color: 'var(--blue-600)', border: '1px solid var(--border)',
              }}
            >
              {t('Show all {{count}}', { count: answer.rows.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** What the question was read as, one short chip per rule that was applied. */
function understoodChips(
  q: AskQuery,
  t: TFunction,
  label: (v?: string | null) => string,
  fmt: ReturnType<typeof useFormat>,
): string[] {
  const out: string[] = [];
  if (q.kinds.length) out.push(q.kinds.map(k => t(KIND_META[k].label)).join(' + '));
  if (q.party) out.push(t('Client: {{name}}', { name: q.party }));
  if (q.person) out.push(t('Person: {{name}}', { name: q.person.name }));
  if (q.direction === 'sent') out.push(t('Sent by us'));
  if (q.direction === 'received') out.push(t('Received from them'));
  if (q.state) {
    out.push(q.state === 'open' ? t('Still open')
      : q.state === 'late' ? t('Overdue')
        : q.state === 'done' ? label('Done')
          : q.state === 'won' ? label('Won')
            : q.state === 'lost' ? label('Lost')
              : label('Submitted'));
  }
  const p = q.period;
  if (p) {
    const monthName = (y: number, m: number) => fmt.date(new Date(y, m - 1, 1), { month: 'long', year: 'numeric' });
    const range = () => `${fmt.date(localDate(p.from), DATE_MEDIUM)} – ${fmt.date(localDate(p.to), DATE_MEDIUM)}`;
    const text =
      p.code === 'month' ? monthName(p.year!, p.month!)
        : p.code === 'since-month' ? t('Since {{month}}', { month: monthName(p.year!, p.month!) })
          : p.code === 'year' ? String(p.year)
            : p.code === 'today' ? t('Today')
              : p.code === 'yesterday' ? t('Yesterday')
                : p.code === 'this-week' ? t('This week')
                  : p.code === 'last-week' ? t('Last week')
                    : p.code === 'next-week' ? t('Next week')
                      : p.code === 'this-month' ? t('This month')
                        : p.code === 'last-month' ? t('Last month')
                          : p.code === 'next-month' ? t('Next month')
                            : p.code === 'this-year' ? t('This year')
                              : p.code === 'last-year' ? t('Last year')
                                : range();
    out.push(q.dateField === 'due' ? t('Due: {{period}}', { period: text }) : text);
  }
  if (q.words.length) out.push(t('Words: {{words}}', { words: q.words.join(' · ') }));
  return out;
}
