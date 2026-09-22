import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { User } from 'firebase/auth';
import { collection, onSnapshot, serverTimestamp } from 'firebase/firestore';
import {
  Files, CheckSquare, MailOpen, Target, FolderKanban, Users2, Info, EyeOff, Bell, Check, Building2,
} from 'lucide-react';
import { db } from './lib/firebase';
import { subscribeVisibleTasks } from './lib/taskVisibility';
import { requestOpen } from './lib/deepLink';
import { createNotification } from './lib/pushNotification';
import { clientFileHash } from './lib/clientFile';
import { useFormat, DATE_MEDIUM } from './lib/format';
import { useDisplayLabel } from './lib/displayLabel';
import {
  findDuplicates, duplicateSummary, BID_DEADLINE_DAYS, LETTER_DAYS, TASK_DAYS,
  type DupGroup, type DupKind, type DupRecord, type Reason, type ClientClash,
} from './lib/duplicates';
import { AppUser } from './types';
import type { AppView } from './App';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

const localDate = (isoDay: string) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const rows = (snap: any) => snap.docs.filter((d: any) => d.id !== '--stats--').map((d: any) => ({ id: d.id, ...d.data() }));

type Filter = 'all' | DupKind | 'clash';

const KIND_ICON: Record<DupKind, React.ReactNode> = {
  bid: <Target size={14} />,
  letter: <MailOpen size={14} />,
  task: <CheckSquare size={14} />,
  project: <FolderKanban size={14} />,
};
const KIND_HEADING: Record<DupKind, string> = { bid: 'Bids', letter: 'Letters', task: 'Tasks', project: 'Projects' };
const KIND_ORDER: DupKind[] = ['bid', 'letter', 'task', 'project'];

// ── "Not a duplicate" and "told them" — per manager, per browser ─────────────

const dismissKey = (uid: string) => `etaske:dupdismiss:${uid}`;
const toldKey = (uid: string) => `etaske:dupclashtold:${uid}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window: forget quietly */ }
}

/**
 * "N days apart" — one key per Arabic number form (1 · 2 · 3–10 · 11+), the
 * app's plural convention; i18next's _one/_other cannot express Arabic.
 */
function apart(t: TFunction, what: 'deadlines' | 'received' | 'entered', n: number): string {
  const keys = {
    deadlines: ['Same submission deadline', 'Deadlines a day apart', 'Deadlines two days apart', 'Deadlines {{count}} days apart', 'Deadlines {{count}} days from each other'],
    received: ['Received the same day', 'Received a day apart', 'Received two days apart', 'Received {{count}} days apart', 'Received {{count}} days from each other'],
    entered: ['Entered the same day', 'Entered a day apart', 'Entered two days apart', 'Entered {{count}} days apart', 'Entered {{count}} days from each other'],
  }[what];
  return t(keys[n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 10 ? 3 : 4], { count: n });
}

/** One reason as a short phrase in the reader's language. */
function reasonText(t: TFunction, r: Reason): string {
  switch (r.code) {
    case 'same-tender-number': return t('Same tender number ({{value}})', { value: r.value });
    case 'same-client': return t('Same client');
    case 'same-title': return t('Same title');
    case 'similar-title': return t('Nearly the same title');
    case 'deadlines-close': return apart(t, 'deadlines', Number(r.value));
    case 'one-closed': return t('One of them is already closed — it may be a re-issued tender');
    case 'same-sender': return t('Same sender');
    case 'received-close': return apart(t, 'received', Number(r.value));
    case 'same-letter': return t('Made from the same letter ({{value}})', { value: r.value });
    case 'same-owner': return t('Same owner');
    case 'same-link': return t('Linked to the same bid or project');
    case 'created-close': return apart(t, 'entered', Number(r.value));
    case 'same-contract-number': return t('Same contract number ({{value}})', { value: r.value });
  }
}

/**
 * Duplicates (queue task D8) — records that look entered twice (the same
 * tender, letter, task or project) and clients that two colleagues each hold
 * open bids with. Manager/Admin only: cleaning up is their call, and every
 * employee already gets the warning on the New bid form.
 *
 * Nothing is merged or deleted here — each row opens its record, where the
 * board's own delete / close applies. "Not a duplicate" is remembered in this
 * browser. The rules live in `lib/duplicates.ts` (pure, harness-covered).
 */
export default function DuplicatesDashboard({ user, appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const label = useDisplayLabel();

  const [bids, setBids] = useState<any[] | null>(null);
  const [letters, setLetters] = useState<any[] | null>(null);
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [projects, setProjects] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [dismissed, setDismissed] = useState<string[]>(() => readJson(dismissKey(user.uid), []));
  const [showDismissed, setShowDismissed] = useState(false);
  const [told, setTold] = useState<Record<string, string>>(() => readJson(toldKey(user.uid), {}));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const unsubT = subscribeVisibleTasks(user.uid, list => setTasks(list), () => setTasks([]));
    const sub = (name: string, set: (v: any[]) => void) => onSnapshot(collection(db, name), s => set(rows(s)),
      err => { console.warn(`Duplicates — ${name} listener:`, err.code); set([]); });
    const u = [sub('opportunities', setBids), sub('correspondences', setLetters), sub('projects', setProjects)];
    return () => { unsubT(); u.forEach(f => f()); };
  }, [user.uid]);

  const loaded = !!(bids && letters && tasks && projects);
  const report = useMemo(
    () => (loaded ? findDuplicates({ opportunities: bids!, correspondences: letters!, tasks: tasks!, projects: projects! }) : { groups: [], clashes: [] }),
    [loaded, bids, letters, tasks, projects],
  );

  const hidden = new Set(dismissed);
  const liveGroups = report.groups.filter(g => showDismissed || !hidden.has(g.key));
  const liveClashes = report.clashes.filter(c => showDismissed || !hidden.has(c.key));
  const sum = duplicateSummary({ groups: report.groups.filter(g => !hidden.has(g.key)), clashes: report.clashes.filter(c => !hidden.has(c.key)) });
  const hiddenCount = report.groups.filter(g => hidden.has(g.key)).length + report.clashes.filter(c => hidden.has(c.key)).length;

  const shownGroups = liveGroups.filter(g => filter === 'all' || filter === g.kind);
  const shownClashes = filter === 'all' || filter === 'clash' ? liveClashes : [];

  const setDismissedSaved = (next: string[]) => {
    setDismissed(next);
    writeJson(dismissKey(user.uid), next);
  };
  const dismiss = (key: string) => setDismissedSaved([...dismissed.filter(k => k !== key), key]);
  const undismiss = (key: string) => setDismissedSaved(dismissed.filter(k => k !== key));

  const dateText = (d: string) => fmt.date(localDate(d), DATE_MEDIUM);

  const openRecord = (r: DupRecord) => {
    const type = r.kind === 'bid' ? 'opportunity' : r.kind === 'letter' ? 'corresponding' : r.kind;
    requestOpen({ type, id: r.id, label: r.title, serial: r.serial });
    onNavigate(r.kind === 'bid' ? 'opportunities' : r.kind === 'letter' ? 'correspondences' : r.kind === 'task' ? 'tasks' : 'projects');
  };

  /** Tell each owner who else holds open bids with this client. One bell entry each. */
  const tellThem = async (c: ClientClash) => {
    setBusy(c.key);
    setMessage(null);
    let failed = 0;
    for (const p of c.people) {
      if (!projectUsers.some(u => u.id === p.id)) continue;
      const others = c.people.filter(o => o.id !== p.id);
      const lines = others.map(o => `${o.name || '—'}: ${o.bids.map(b => [b.serial, b.title].filter(Boolean).join(' ')).join('; ')}`).join(' · ');
      try {
        await createNotification({
          type: 'opportunity_client_shared',
          title: `Others are bidding to ${c.client} too`,
          message: `Besides your bid(s), ${lines}. Worth a word with each other before anyone contacts ${c.client}.`,
          forUserId: p.id,
          read: false,
          // Opens the first of the OTHER person's bids.
          relatedId: others[0]?.bids[0]?.id,
          createdAt: serverTimestamp(),
        }, projectUsers);
      } catch (e) {
        console.warn('Duplicates — notification failed:', e);
        failed++;
      }
    }
    setBusy(null);
    if (failed) {
      setMessage({ kind: 'error', text: t('Could not send every notification. Check your connection and try again.') });
      return;
    }
    const next = { ...told, [c.key]: new Date().toISOString().slice(0, 10) };
    setTold(next);
    writeJson(toldKey(user.uid), next);
    setMessage({ kind: 'ok', text: t('Each of them has a notification naming the others’ bids.') });
  };

  const chip = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', minHeight: 32, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
    background: active ? 'var(--blue-600)' : 'var(--surface)', color: active ? '#fff' : 'var(--text-secondary)',
    border: `1px solid ${active ? 'var(--blue-600)' : 'var(--border)'}`,
  });
  const small: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', minHeight: 32, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 600, background: 'var(--surface)', color: 'var(--blue-600)', border: '1px solid var(--border)',
  };

  const filters: { key: Filter; text: string; count: number }[] = [
    { key: 'all', text: t('All'), count: sum.groups + sum.clashes },
    ...KIND_ORDER.map(k => ({ key: k as Filter, text: t(KIND_HEADING[k]), count: sum.byKind[k] })),
    { key: 'clash', text: t('Two people, one client'), count: sum.clashes },
  ];

  const recordRow = (r: DupRecord, i: number, g?: DupGroup) => {
    const sub = [
      r.status ? label(r.status) : '',
      r.party || '',
      r.ownerName ? t('Owner: {{name}}', { name: r.ownerName }) : '',
      r.date ? dateText(r.date) : '',
      r.created ? t('Entered {{date}}', { date: dateText(r.created) }) : '',
    ].filter(Boolean) as string[];
    return (
      <li key={r.id} data-dup="record" data-id={r.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', minWidth: 0 }}>
        <button
          type="button"
          onClick={() => openRecord(r)}
          style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', textAlign: 'start', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minWidth: 0 }}
        >
          <span style={{ color: 'var(--blue-600)', display: 'flex', flexShrink: 0, marginTop: 2 }}>{KIND_ICON[r.kind]}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 }}>
              {r.serial && <span className="ltr-data" style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{r.serial}</span>}
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere', minWidth: 0 }}><bdi>{r.title}</bdi></span>
              {g && i === 0 && g.records.length > 1 && (
                <span data-dup="oldest" style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', background: 'var(--blue-50)', color: 'var(--blue-600)' }}>{t('Entered first')}</span>
              )}
            </span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
              {sub.map((part, n) => <React.Fragment key={n}>{n > 0 && ' · '}<bdi>{part}</bdi></React.Fragment>)}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }} data-dup="page">
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          <Files size={22} style={{ color: 'var(--blue-600)' }} /> {t('Duplicates')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          {t('Records that look entered twice, and clients two colleagues are each bidding to.')}
        </p>
      </div>

      <section className="card" data-dup="summary" style={{ padding: 16, marginBottom: 16 }}>
        {!loaded ? (
          <p role="status" style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('Reading the boards…')}</p>
        ) : (
          <>
            <p data-dup="headline" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {sum.groups === 0 && sum.clashes === 0
                ? t('Nothing looks entered twice.')
                : [
                    sum.groups ? (sum.groups === 1 ? t('1 possible duplicate') : t('{{count}} possible duplicates', { count: sum.groups })) : '',
                    sum.certain ? t('{{count}} almost certain', { count: sum.certain }) : '',
                    sum.clashes ? (sum.clashes === 1 ? t('1 client with two bid owners') : t('{{count}} clients with two bid owners', { count: sum.clashes })) : '',
                  ].filter(Boolean).join(' · ')}
            </p>
            {sum.extraCopies > 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                {sum.extraCopies === 1 ? t('Keeping one of each would remove 1 extra record.') : t('Keeping one of each would remove {{count}} extra records.', { count: sum.extraCopies })}
              </p>
            )}
            <div role="group" aria-label={t('Show')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              {filters.map(f => (
                <button key={f.key} type="button" data-dup={`filter-${f.key}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} style={chip(filter === f.key)}>
                  {f.text} <span className="ltr-data" style={{ opacity: 0.8 }}>{f.count}</span>
                </button>
              ))}
            </div>
            {hiddenCount > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
                {t('{{count}} marked “not a duplicate”', { count: hiddenCount })}{' · '}
                <button type="button" data-dup="toggle-dismissed" onClick={() => setShowDismissed(s => !s)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--blue-600)' }}>
                  {showDismissed ? t('Hide them') : t('Show them again')}
                </button>
              </p>
            )}
          </>
        )}
        {message && (
          <p role={message.kind === 'error' ? 'alert' : 'status'} data-dup="message" style={{ fontSize: 13, fontWeight: 600, color: message.kind === 'error' ? 'var(--danger)' : 'var(--success)', margin: '10px 0 0' }}>
            {message.text}
          </p>
        )}
      </section>

      {loaded && shownGroups.map(g => {
        const isHidden = hidden.has(g.key);
        return (
          <section key={g.key} className="card" data-dup="group" data-key={g.key} data-strength={g.strength}
            style={{ padding: 14, marginBottom: 12, minWidth: 0, opacity: isHidden ? 0.6 : 1, borderInlineStart: `4px solid ${g.strength === 'certain' ? 'var(--danger)' : 'var(--warning)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ color: 'var(--blue-600)', display: 'flex' }}>{KIND_ICON[g.kind]}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
                {t(KIND_HEADING[g.kind])} · <span className="ltr-data">{g.records.length}</span>
              </span>
              <span data-dup="strength" style={{
                fontSize: 11, fontWeight: 700, padding: '2px 8px',
                background: g.strength === 'certain' ? '#fee2e2' : '#fef3c7', color: g.strength === 'certain' ? '#991b1b' : '#92400e',
              }}>
                {g.strength === 'certain' ? t('Almost certainly the same') : t('Probably the same')}
              </span>
            </div>
            <p data-dup="why" style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
              {g.reasons.map(r => reasonText(t, r)).join(' · ')}
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {g.records.map((r, i) => recordRow(r, i, g))}
            </ul>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              {isHidden ? (
                <button type="button" data-dup="undismiss" onClick={() => undismiss(g.key)} style={small}>{t('Check it again')}</button>
              ) : (
                <button type="button" data-dup="dismiss" onClick={() => dismiss(g.key)} style={small}><EyeOff size={13} /> {t('Not a duplicate')}</button>
              )}
            </div>
          </section>
        );
      })}

      {loaded && shownClashes.length > 0 && (
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '18px 0 10px' }}>
          <Users2 size={16} style={{ color: 'var(--blue-600)' }} /> {t('Two people, one client')}
        </h2>
      )}
      {loaded && shownClashes.map(c => {
        const isHidden = hidden.has(c.key);
        return (
          <section key={c.key} className="card" data-dup="clash" data-key={c.key} style={{ padding: 14, marginBottom: 12, minWidth: 0, opacity: isHidden ? 0.6 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <Building2 size={14} style={{ color: 'var(--blue-600)' }} />
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}><bdi>{c.client}</bdi></span>
              <a href={clientFileHash(c.client)} data-dup="client-file" style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue-600)', textDecoration: 'none', whiteSpace: 'nowrap' }}>{t('Client file')} <span className="dir-arrow">→</span></a>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
              {t('{{count}} colleagues each hold open bids with this client.', { count: c.people.length })}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
              {c.people.map(p => (
                <div key={p.id} data-dup="person" style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}><bdi>{p.name || '—'}</bdi></p>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {p.bids.map((b, i) => recordRow(b, i))}
                  </ul>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              <button type="button" data-dup="tell" disabled={busy === c.key} onClick={() => tellThem(c)} style={small}>
                {told[c.key] ? <Check size={13} /> : <Bell size={13} />} {busy === c.key ? t('Sending…') : told[c.key] ? t('Told them on {{date}} — tell again', { date: dateText(told[c.key]) }) : t('Let them know')}
              </button>
              {isHidden ? (
                <button type="button" data-dup="undismiss" onClick={() => undismiss(c.key)} style={small}>{t('Check it again')}</button>
              ) : (
                <button type="button" data-dup="dismiss" onClick={() => dismiss(c.key)} style={small}><EyeOff size={13} /> {t('This is fine')}</button>
              )}
            </div>
          </section>
        );
      })}

      {loaded && shownGroups.length === 0 && shownClashes.length === 0 && (sum.groups > 0 || sum.clashes > 0) && (
        <p data-dup="empty-filter" style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{t('Nothing of this kind.')}</p>
      )}

      <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 0', lineHeight: 1.5 }}>
        <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          {t('Nothing is deleted or merged from this page: open the extra copy and delete or close it on its own board — usually keep the one entered first.')}{' '}
          {t('Bids match on the tender number, or on the same client with nearly the same title and deadlines within {{days}} days.', { days: BID_DEADLINE_DAYS })}{' '}
          {t('Letters match on the same sender and subject within {{letter}} days; tasks on the same title for the same person or bid within {{task}} days.', { letter: LETTER_DAYS, task: TASK_DAYS })}{' '}
          {t('An Arabic title and an English title for the same tender are not matched.')}
        </span>
      </p>
    </div>
  );
}
