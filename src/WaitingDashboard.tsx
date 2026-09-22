import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { User } from 'firebase/auth';
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  Hourglass, CheckSquare, MailOpen, Target, Mail, ArrowRightLeft, Undo2, PenLine, Info,
  ChevronDown, ChevronUp, UserRound, Users,
} from 'lucide-react';
import { db } from './lib/firebase';
import { subscribeVisibleTasks } from './lib/taskVisibility';
import { requestOpen } from './lib/deepLink';
import { fetchBridgeMail, BRIDGE_URL, bridgeHeaders } from './lib/outlookBridge';
import { groupThreads, threadsAwaitingReply, threadsAwaitingTheirReply } from './lib/mailThreads';
import { loadMailLedger } from './lib/mailSuggest';
import { waitingSince, type FollowUpInfo } from './lib/followUp';
import { useFormat, DATE_MEDIUM } from './lib/format';
import FollowUpLetterModal from './components/FollowUpLetterModal';
import {
  buildWaitingBoard, filterItems, sideSummary, waitingPatch, canMoveLetter, canMoveTask,
  AGE_WARN_DAYS, type WaitItem, type KindFilter, type Side,
} from './lib/waitingBoard';
import { AppUser } from './types';
import type { AppView } from './App';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

/** yyyy-mm-dd → a local Date (new Date('yyyy-mm-dd') would be UTC midnight). */
const localDate = (isoDay: string) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const rows = (snap: any) => snap.docs.filter((d: any) => d.id !== '--stats--').map((d: any) => ({ id: d.id, ...d.data() }));

/**
 * "Waiting 5 days" with Arabic number agreement: 1 and 2 have their own words,
 * 3–10 take a plural noun and 11+ a singular one — separate keys, because
 * i18next's _one/_other pair cannot express it.
 */
function ageText(t: TFunction, days: number | null): string {
  if (days === null) return t('Age unknown');
  if (days === 0) return t('Since today');
  if (days === 1) return t('Waiting 1 day');
  if (days === 2) return t('Waiting 2 days');
  return days <= 10 ? t('Waiting {{count}} days', { count: days }) : t('{{count}} days waiting', { count: days });
}

function reasonText(t: TFunction, it: WaitItem): string {
  switch (it.reason) {
    case 'letter-open': return t('Letter to answer');
    case 'task-open': return t('Open task');
    case 'bid-prepare': return t('Bid to submit');
    case 'mail-unanswered': return t('E-mail with no reply from us');
    case 'bid-decision': return t('Submitted — awaiting their decision');
    case 'marked': return it.kind === 'letter' ? t('Letter — waiting on them') : t('Task — waiting on them');
    case 'mail-no-reply': return t('We wrote last — no answer yet');
  }
}

const KIND_ICON: Record<WaitItem['kind'], React.ReactNode> = {
  letter: <MailOpen size={14} />,
  task: <CheckSquare size={14} />,
  bid: <Target size={14} />,
  mail: <Mail size={14} />,
};

const BAND_STYLE: Record<WaitItem['band'], React.CSSProperties> = {
  fresh: { background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
  warn: { background: 'var(--surface-warn)', color: 'var(--surface-warn-text)', border: '1px solid var(--surface-warn-border)' },
  alert: { background: 'var(--surface)', color: 'var(--danger)', border: '1px solid var(--danger)' },
};

const KINDS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'letter', label: 'Letters' },
  { value: 'task', label: 'Tasks' },
  { value: 'bid', label: 'Bids' },
  { value: 'mail', label: 'E-mails' },
];

const SHOW_FIRST = 12;

/**
 * Waiting board (queue task D2) — every open piece of work split by whose move
 * it is: "Waiting on us" (letters to answer, open tasks, bids to submit, mail
 * nobody answered) and "Waiting on them" (bids the client has not decided,
 * tasks and letters marked as waiting on someone, mail they have not answered),
 * each with how many days it has been waiting, longest first.
 *
 * All the sorting is in `lib/waitingBoard.ts` (pure, harness-covered). The one
 * write is the "waiting on them" mark on a task or a letter.
 */
export default function WaitingDashboard({ user, appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const isManager = appUser.role === 'Admin' || appUser.role === 'Manager';

  const [tasks, setTasks] = useState<any[] | null>(null);
  const [letters, setLetters] = useState<any[] | null>(null);
  const [bids, setBids] = useState<any[] | null>(null);
  const [threads, setThreads] = useState<any[]>([]);
  const [mailState, setMailState] = useState<'checking' | 'off' | 'on'>('checking');
  // Employees see their own work on every board (settled rule 11); a manager
  // starts on the whole department and can narrow to one person or to Mine.
  const [mineOnly, setMineOnly] = useState(!isManager);
  const [person, setPerson] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [more, setMore] = useState<Record<Side, boolean>>({ us: false, them: false });
  const [marking, setMarking] = useState<string | null>(null);
  const [party, setParty] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [letterFor, setLetterFor] = useState<FollowUpInfo | null>(null);

  useEffect(() => {
    // Privacy-aware: only the tasks this person may read (public + own).
    const unsubT = subscribeVisibleTasks(user.uid, list => setTasks(list), () => setTasks([]));
    const unsubC = onSnapshot(collection(db, 'correspondences'), s => setLetters(rows(s)),
      err => { console.warn('Waiting — correspondences listener:', err.code); setLetters([]); });
    const unsubO = onSnapshot(collection(db, 'opportunities'), s => setBids(rows(s)),
      err => { console.warn('Waiting — opportunities listener:', err.code); setBids([]); });
    return () => { unsubT(); unsubC(); unsubO(); };
  }, [user.uid]);

  // Outlook on this PC, when the helper is running: the chains the Outlook
  // Feed would flag (and has not had waved away). Silent when it is not.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${BRIDGE_URL}/status`, { headers: bridgeHeaders, signal: AbortSignal.timeout(3000), targetAddressSpace: 'loopback' } as RequestInit);
        if (!res.ok) throw new Error('off');
      } catch {
        if (alive) setMailState('off');
        return;
      }
      const [inbox, sent] = await Promise.all([fetchBridgeMail('Inbox', '', 50), fetchBridgeMail('Sent Items', '', 50)]);
      if (!alive) return;
      if (!inbox && !sent) { setMailState('off'); return; }
      const all = groupThreads([...(inbox || []), ...(sent || [])]);
      const ledger = loadMailLedger();
      setThreads([...threadsAwaitingReply(all, ledger, 50), ...threadsAwaitingTheirReply(all, ledger, 50)]);
      setMailState('on');
    })();
    return () => { alive = false; };
  }, []);

  const userNames = useMemo(() => Object.fromEntries(projectUsers.map(u => [u.id, u.displayName])), [projectUsers]);
  const loaded = !!(tasks && letters && bids);
  const board = useMemo(
    () => (loaded ? buildWaitingBoard({ tasks: tasks!, correspondences: letters!, opportunities: bids!, threads, userNames }) : { us: [], them: [] }),
    [loaded, tasks, letters, bids, threads, userNames],
  );
  const opts = { uid: user.uid, mineOnly, kind, person: mineOnly ? '' : person };
  const us = filterItems(board.us, opts);
  const them = filterItems(board.them, opts);
  const people = useMemo(
    () => [...new Set([...board.us, ...board.them].map(i => i.owner).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [board],
  );

  const recordOf = (it: WaitItem) => {
    if (!it.open) return null;
    const list = it.kind === 'task' ? tasks : it.kind === 'letter' ? letters : null;
    return list?.find(r => r.id === it.open!.id) || null;
  };
  const canMove = (it: WaitItem) => {
    if (!it.movable) return false;
    const r = recordOf(it);
    if (!r) return false;
    return it.kind === 'task' ? canMoveTask(r, user.uid, isManager) : canMoveLetter(r, user.uid, isManager);
  };

  const move = async (it: WaitItem, side: Side, who?: string) => {
    if (!it.open) return;
    setSaving(it.key);
    setError('');
    try {
      await updateDoc(doc(db, it.kind === 'task' ? 'tasks' : 'correspondences', it.open.id), {
        ...waitingPatch(side, who),
        updatedAt: serverTimestamp(),
      });
      setMarking(null);
      setParty('');
    } catch (e) {
      console.error('Waiting — move failed:', e);
      setError(t('Could not save the change. Check your connection and try again.'));
    } finally {
      setSaving(null);
    }
  };

  const openRecord = (it: WaitItem) => {
    if (!it.open) { onNavigate('outlook-feed'); return; }
    requestOpen({ type: it.open.type, id: it.open.id, label: it.open.label, serial: it.open.serial });
    onNavigate(it.open.type === 'task' ? 'tasks' : it.open.type === 'corresponding' ? 'correspondences' : 'opportunities');
  };

  const writeLetter = (it: WaitItem) => setLetterFor({
    subject: it.title,
    counterparty: it.party,
    ourName: appUser.displayName,
    reference: it.serial,
    lastContact: it.since ? fmt.date(localDate(it.since), DATE_MEDIUM) : undefined,
    waitingDays: waitingSince(it.since),
  });

  const column = (side: Side, list: WaitItem[]) => {
    const sum = sideSummary(list);
    const shown = more[side] ? list : list.slice(0, SHOW_FIRST);
    return (
      <section className="card" data-waiting={`side-${side}`} style={{ padding: 16, minWidth: 0 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          <span style={{ color: side === 'us' ? 'var(--blue-600)' : 'var(--text-secondary)', display: 'flex' }}>
            {side === 'us' ? <UserRound size={17} /> : <Users size={17} />}
          </span>
          {side === 'us' ? t('Waiting on us') : t('Waiting on them')}
          <span className="ltr-data" data-waiting="count" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>{sum.count}</span>
        </h2>
        <p data-waiting="summary" style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 12px' }}>
          {side === 'us' ? t('Our move: letters to answer, open tasks, bids to submit.') : t('Their move: bids awaiting a decision, and anything marked as waiting on someone.')}
          {sum.aged > 0 && <> {' '}<strong style={{ color: 'var(--surface-warn-text)' }}>{t('{{count}} waiting a week or more', { count: sum.aged })}</strong></>}
        </p>
        {!loaded ? (
          <p role="status" style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('Reading the boards…')}</p>
        ) : list.length === 0 ? (
          <p data-waiting="empty" style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
            {side === 'us' ? t('Nothing is waiting on us here.') : t('Nothing is waiting on anyone else here.')}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {shown.map(it => (
              <WaitRow
                key={it.key}
                it={it}
                t={t}
                dueText={it.due ? (it.late ? t('Was due {{date}}', { date: fmt.date(localDate(it.due), DATE_MEDIUM) }) : t('Due {{date}}', { date: fmt.date(localDate(it.due), DATE_MEDIUM) })) : ''}
                showOwner={!mineOnly}
                onOpen={() => openRecord(it)}
                canMove={canMove(it)}
                busy={saving === it.key}
                marking={marking === it.key}
                party={party}
                onParty={setParty}
                onStartMark={() => { setMarking(it.key); setParty(it.kind === 'letter' ? (it.party || '') : ''); }}
                onCancelMark={() => { setMarking(null); setParty(''); }}
                onMark={() => move(it, 'them', party)}
                onBack={() => move(it, 'us')}
                onLetter={side === 'them' ? () => writeLetter(it) : undefined}
              />
            ))}
          </ul>
        )}
        {list.length > SHOW_FIRST && (
          <button
            type="button"
            onClick={() => setMore(m => ({ ...m, [side]: !m[side] }))}
            style={{
              marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600, background: 'var(--surface)', color: 'var(--blue-600)', border: '1px solid var(--border)',
            }}
          >
            {more[side] ? <><ChevronUp size={13} />{t('Show fewer')}</> : <><ChevronDown size={13} />{t('Show all {{count}}', { count: list.length })}</>}
          </button>
        )}
      </section>
    );
  };

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px', minHeight: 36, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
    background: active ? 'var(--blue-600)' : 'var(--surface)', color: active ? '#fff' : 'var(--text-secondary)',
    border: `1px solid ${active ? 'var(--blue-600)' : 'var(--border)'}`,
  });

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px' }} data-waiting="page">
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          <Hourglass size={22} style={{ color: 'var(--blue-600)' }} /> {t('Waiting')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          {t('Who has the next move on every open item, and how long it has been waiting.')}
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        {isManager && (
          <div role="group" aria-label={t('Whose items')} style={{ display: 'flex' }}>
            <button type="button" data-waiting="scope-all" aria-pressed={!mineOnly} onClick={() => setMineOnly(false)} style={chip(!mineOnly)}>{t('Everyone')}</button>
            <button type="button" data-waiting="scope-mine" aria-pressed={mineOnly} onClick={() => setMineOnly(true)} style={chip(mineOnly)}>{t('Mine')}</button>
          </div>
        )}
        {isManager && !mineOnly && people.length > 0 && (
          <select
            className="input"
            data-waiting="person"
            value={person}
            onChange={e => setPerson(e.target.value)}
            aria-label={t('Person')}
            style={{ fontFamily: 'inherit', fontSize: 13, minHeight: 36, maxWidth: 220 }}
          >
            <option value="">{t('All people')}</option>
            {people.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <div role="group" aria-label={t('Type')} style={{ display: 'flex', flexWrap: 'wrap' }}>
          {KINDS.filter(k => k.value !== 'mail' || mailState === 'on').map(k => (
            <button key={k.value} type="button" data-waiting={`kind-${k.value}`} aria-pressed={kind === k.value} onClick={() => setKind(k.value)} style={chip(kind === k.value)}>
              {t(k.label)}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 12px' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: 16, alignItems: 'start' }}>
        {column('us', us)}
        {column('them', them)}
      </div>

      <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 0', lineHeight: 1.5 }}>
        <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          {t('Age is counted in calendar days: from the day a letter arrived, a task was created or a bid was submitted — or from the day someone marked it as waiting on them. Amber from {{warn}} days.', { warn: AGE_WARN_DAYS })}{' '}
          {mailState === 'on'
            ? t('E-mails come from the Outlook on this PC only and are not saved.')
            : mailState === 'off' ? t('Start the Outlook helper to add your unanswered e-mails here.') : ''}
        </span>
      </p>

      <FollowUpLetterModal info={letterFor} onClose={() => setLetterFor(null)} />
    </div>
  );
}

// ── One row ──────────────────────────────────────────────────────────────────

function WaitRow({
  it, t, dueText, showOwner, onOpen, canMove, busy, marking, party, onParty, onStartMark, onCancelMark, onMark, onBack, onLetter,
}: {
  it: WaitItem; t: TFunction; dueText: string; showOwner: boolean; onOpen: () => void;
  canMove: boolean; busy: boolean; marking: boolean; party: string; onParty: (v: string) => void;
  onStartMark: () => void; onCancelMark: () => void; onMark: () => void; onBack: () => void; onLetter?: () => void;
}) {
  const sub = [
    reasonText(t, it),
    it.party ? (it.side === 'them' ? t('On: {{name}}', { name: it.party }) : it.kind === 'bid' ? it.party : t('From: {{name}}', { name: it.party })) : '',
    showOwner ? it.owner : '',
  ].filter(Boolean) as string[];

  const small: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', minHeight: 30, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 600, background: 'var(--surface)', color: 'var(--blue-600)', border: '1px solid var(--border)',
  };

  return (
    <li data-waiting="row" data-key={it.key} data-band={it.band} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', minWidth: 0 }}>
      <button
        type="button"
        onClick={onOpen}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', textAlign: 'start', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minWidth: 0 }}
      >
        <span style={{ color: 'var(--blue-600)', display: 'flex', flexShrink: 0 }}>{KIND_ICON[it.kind]}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
            {it.serial && <span className="ltr-data" style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{it.serial}</span>}
            <span dir="auto" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
          </span>
          {/* Each piece isolated: an English name inside an Arabic line would
              otherwise drag its neighbours ("من: AGIBA") out of order. */}
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sub.map((part, i) => <React.Fragment key={i}>{i > 0 && ' · '}<bdi>{part}</bdi></React.Fragment>)}
          </span>
          {dueText && (
            <span data-waiting="due" style={{ display: 'block', fontSize: 11, fontWeight: it.late ? 700 : 400, color: it.late ? 'var(--danger)' : 'var(--text-secondary)' }}>{dueText}</span>
          )}
        </span>
        <span data-waiting="age" style={{ ...BAND_STYLE[it.band], flexShrink: 0, padding: '3px 8px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {ageText(t, it.days)}
        </span>
      </button>

      {(canMove || onLetter) && !marking && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 10px 8px' }}>
          {canMove && it.side === 'us' && (
            <button type="button" data-waiting="mark" disabled={busy} onClick={onStartMark} style={small}>
              <ArrowRightLeft size={13} /> {t('Waiting on them')}
            </button>
          )}
          {canMove && it.side === 'them' && (
            <button type="button" data-waiting="back" disabled={busy} onClick={onBack} style={small}>
              <Undo2 size={13} /> {busy ? t('Saving…') : t('Back to us')}
            </button>
          )}
          {onLetter && (
            <button type="button" data-waiting="letter" onClick={onLetter} style={small}>
              <PenLine size={13} /> {t('Write a follow-up')}
            </button>
          )}
        </div>
      )}

      {marking && (
        <form
          data-waiting="mark-form"
          onSubmit={e => { e.preventDefault(); onMark(); }}
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '0 10px 10px' }}
        >
          <input
            className="input"
            dir="auto"
            autoFocus
            value={party}
            onChange={e => onParty(e.target.value)}
            placeholder={t('Waiting on whom? (optional)')}
            aria-label={t('Waiting on whom? (optional)')}
            style={{ flex: '1 1 180px', minWidth: 0, fontFamily: 'inherit', fontSize: 13 }}
          />
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ minHeight: 36 }}>{busy ? t('Saving…') : t('Save')}</button>
          <button type="button" className="btn btn-ghost" onClick={onCancelMark} style={{ minHeight: 36 }}>{t('Cancel')}</button>
        </form>
      )}
    </li>
  );
}
