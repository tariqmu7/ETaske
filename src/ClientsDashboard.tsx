import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { User } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  ArrowLeft, Building2, Search, CheckSquare, MailOpen, Target, FolderKanban, ListChecks,
  AlertTriangle, Users, MessageSquare, Mail, Send, Inbox, FileText, Info, ChevronDown, ChevronUp,
} from 'lucide-react';
import { db } from './lib/firebase';
import { subscribeVisibleTasks } from './lib/taskVisibility';
import { requestOpen } from './lib/deepLink';
import { fetchBridgeMail, BRIDGE_URL, bridgeHeaders } from './lib/outlookBridge';
import { useFormat, DATE_MEDIUM } from './lib/format';
import { useDisplayLabel } from './lib/displayLabel';
import { globalSearch } from './utils';
import {
  listClients, buildClientFile, clientFromHash, clientFileHash, dayOf, STEP_HORIZON_DAYS,
  type OwedItem, type ContactEvent, type RecordKind,
} from './lib/clientFile';
import { clientMemory } from './lib/decisionMemory';
import EarlierWithClient, { MemoryIcon } from './components/opportunities/EarlierWithClient';
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
 * "3 days late" / "in 2 days" with Arabic number agreement: 1 and 2 have their
 * own words, 3–10 take a plural noun and 11+ a singular one — four keys each,
 * because i18next's _one/_other pair cannot express it.
 */
function whenText(t: TFunction, days: number | null, late: boolean): string {
  if (days === null) return t('No date');
  if (days === 0) return t('Today');
  if (late) {
    if (days === 1) return t('1 day late');
    if (days === 2) return t('2 days late');
    return days <= 10 ? t('{{count}} days late', { count: days }) : t('Late by {{count}} days', { count: days });
  }
  if (days === 1) return t('Tomorrow');
  if (days === 2) return t('In 2 days');
  return days <= 10 ? t('In {{count}} days', { count: days }) : t('{{count}} days from now', { count: days });
}

const OWED_ICON: Record<OwedItem['kind'], React.ReactNode> = {
  letter: <MailOpen size={14} />,
  task: <CheckSquare size={14} />,
  bid: <Target size={14} />,
  step: <ListChecks size={14} />,
};

const SHOW_FIRST = 8;

/**
 * Client file (queue task D1) — one page per client: what we owe them, who
 * spoke to them last, their open bids, projects and contracts, and the latest
 * letters and e-mails. `#/clients` lists the clients; `#/clients?c=<name>`
 * opens one, so the page can be bookmarked and linked from a project or bid.
 *
 * All the thinking is in `lib/clientFile.ts` (pure, harness-covered); this file
 * only reads the boards and draws. Nothing is written.
 */
export default function ClientsDashboard({ user, appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const dl = useDisplayLabel();

  const [projects, setProjects] = useState<any[] | null>(null);
  const [bids, setBids] = useState<any[] | null>(null);
  const [letters, setLetters] = useState<any[] | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [updates, setUpdates] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<any[]>([]);
  const [mails, setMails] = useState<any[]>([]);
  const [mailState, setMailState] = useState<'checking' | 'off' | 'reading' | 'on' | 'failed'>('checking');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(() => clientFromHash(window.location.hash));
  const [more, setMore] = useState<Record<string, boolean>>({});

  // The parent boards: enough for the list and for every client's counts.
  useEffect(() => {
    const unsubP = onSnapshot(collection(db, 'projects'), s => setProjects(rows(s)),
      err => { console.warn('Clients — projects listener:', err.code); setProjects([]); });
    const unsubO = onSnapshot(collection(db, 'opportunities'), s => setBids(rows(s)),
      err => { console.warn('Clients — opportunities listener:', err.code); setBids([]); });
    const unsubC = onSnapshot(collection(db, 'correspondences'), s => setLetters(rows(s)),
      err => { console.warn('Clients — correspondences listener:', err.code); setLetters([]); });
    return () => { unsubP(); unsubO(); unsubC(); };
  }, []);

  // The detail feeds are only read once a client is open (settled rule 2:
  // child collections are read whole and filtered client-side by parent id).
  const open = !!selected;
  useEffect(() => {
    if (!open) return;
    // Privacy-aware: only the tasks this person may read (public + own).
    const unsubT = subscribeVisibleTasks(user.uid, list => setTasks(list), () => setTasks([]));
    const sub = (name: string, set: (v: any[]) => void) => onSnapshot(collection(db, name), s => set(rows(s)),
      err => { console.warn(`Clients — ${name} listener:`, err.code); set([]); });
    const u1 = sub('projectContracts', setContracts);
    const u2 = sub('projectUpdates', setUpdates);
    const u3 = sub('opportunityFollowUps', setFollowUps);
    const u4 = sub('opportunityFeedback', setFeedback);
    return () => { unsubT(); u1(); u2(); u3(); u4(); };
  }, [open, user.uid]);

  // `#/clients?c=agiba` ⇄ the open client, so Back/Forward and links work.
  useEffect(() => {
    const onHash = () => setSelected(clientFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const select = (key: string | null) => {
    window.location.hash = key ? clientFileHash(key).slice(1) : '/clients';
    setMore({});
  };

  const loaded = !!(projects && bids && letters);
  const clients = useMemo(
    () => (loaded ? listClients({ projects: projects!, opportunities: bids!, correspondences: letters! }) : []),
    [loaded, projects, bids, letters],
  );
  const userNames = useMemo(() => Object.fromEntries(projectUsers.map(u => [u.id, u.displayName])), [projectUsers]);
  const file = useMemo(() => {
    if (!loaded || !selected) return null;
    return buildClientFile(selected, {
      projects: projects!, opportunities: bids!, correspondences: letters!,
      tasks, contracts, projectUpdates: updates, followUps, mails, userNames,
    });
  }, [loaded, selected, projects, bids, letters, tasks, contracts, updates, followUps, mails, userNames]);
  const known = !!selected && clients.some(c => c.key === selected);
  // Queue D6: what the client's bids remember — prices, why lost / dropped, objections.
  const memory = useMemo(
    () => (loaded && selected ? clientMemory(selected, bids!, feedback) : null),
    [loaded, selected, bids, feedback],
  );

  // Outlook on this PC, when the helper is running: the latest mail naming the
  // client, in and out. Silent when it is not — most desks never run it.
  const mailSearch = file?.name;
  useEffect(() => {
    setMails([]);
    if (!mailSearch || !known) return;
    let alive = true;
    (async () => {
      setMailState('checking');
      try {
        const res = await fetch(`${BRIDGE_URL}/status`, { headers: bridgeHeaders, signal: AbortSignal.timeout(3000), targetAddressSpace: 'loopback' } as RequestInit);
        if (!res.ok) throw new Error('off');
      } catch {
        if (alive) setMailState('off');
        return;
      }
      if (alive) setMailState('reading');
      const [inbox, sent] = await Promise.all([
        fetchBridgeMail('Inbox', mailSearch, 10),
        fetchBridgeMail('Sent Items', mailSearch, 10),
      ]);
      if (!alive) return;
      if (!inbox && !sent) { setMailState('failed'); return; }
      setMails([...(inbox || []), ...(sent || [])]);
      setMailState('on');
    })();
    return () => { alive = false; };
  }, [mailSearch, known]);

  const openRecord = (ref: { type: RecordKind; id: string; serial?: string; label: string }) => {
    requestOpen({ type: ref.type, id: ref.id, label: ref.label, serial: ref.serial });
    onNavigate(ref.type === 'task' ? 'tasks'
      : ref.type === 'corresponding' ? 'correspondences'
        : ref.type === 'opportunity' ? 'opportunities' : 'projects');
  };

  // ── The list ──────────────────────────────────────────────────────────────
  if (!selected || (loaded && !known)) {
    const shown = clients.filter(c => globalSearch({ n: c.name, o: c.otherNames }, search.trim()));
    return (
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px' }} data-clients="list">
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{t('Clients')}</h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            {t('Everything we have with one client, on one page: what we owe them, who spoke to them last, bids, contracts and letters.')}
          </p>
        </div>
        {selected && loaded && !known && (
          <p role="status" style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
            {t('No project or bid names that client any more — pick one below.')}
          </p>
        )}
        <div style={{ position: 'relative', maxWidth: 420, marginBottom: 16 }}>
          <Search size={15} style={{ position: 'absolute', insetInlineStart: 10, top: 12, color: 'var(--text-muted)' }} />
          <input
            className="input"
            type="search"
            dir="auto"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('Find a client…')}
            aria-label={t('Find a client…')}
            style={{ width: '100%', paddingInlineStart: 32, fontFamily: 'inherit', fontSize: 14 }}
          />
        </div>
        {!loaded ? (
          <p role="status" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('Reading the boards…')}</p>
        ) : shown.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {clients.length ? t('No client matches that search.') : t('No clients yet — a client appears here once a project or bid names it.')}
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 10 }}>
            {shown.map(c => (
              <button
                key={c.key}
                type="button"
                data-clients="card"
                onClick={() => select(c.key)}
                className="card"
                style={{
                  textAlign: 'start', cursor: 'pointer', padding: 14, fontFamily: 'inherit', minWidth: 0,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Building2 size={16} style={{ color: 'var(--blue-600)', flexShrink: 0 }} />
                  <span dir="auto" style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                </span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                  {[
                    c.activeProjects ? t('Active projects: {{count}}', { count: c.activeProjects }) : '',
                    c.openBids ? t('Open bids: {{count}}', { count: c.openBids }) : '',
                    c.letters ? t('Letters: {{count}}', { count: c.letters }) : '',
                  ].filter(Boolean).join(' · ') || t('Nothing open')}
                </span>
                {c.lastActivity && (
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {t('Last activity: {{date}}', { date: fmt.date(localDate(c.lastActivity), DATE_MEDIUM) })}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── One client ────────────────────────────────────────────────────────────
  if (!file) {
    return (
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px' }}>
        <p role="status" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('Reading the boards…')}</p>
      </div>
    );
  }

  const late = file.owed.filter(o => o.late).length;
  const activeProjects = file.projects.filter(p => !p.status || p.status === 'Active' || p.status === 'On Hold').length;
  const expiring = file.contracts.filter(c => c.expiry === 'soon').length;
  const last = file.contacts[0];
  const limit = <T,>(id: string, list: T[]) => (more[id] ? list : list.slice(0, SHOW_FIRST));
  const moreButton = (id: string, total: number) => total > SHOW_FIRST && (
    <button
      type="button"
      onClick={() => setMore(m => ({ ...m, [id]: !m[id] }))}
      style={{
        marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 12, fontWeight: 600, background: 'var(--surface)', color: 'var(--blue-600)', border: '1px solid var(--border)',
      }}
    >
      {more[id] ? <><ChevronUp size={13} />{t('Show fewer')}</> : <><ChevronDown size={13} />{t('Show all {{count}}', { count: total })}</>}
    </button>
  );

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px' }} data-clients="file">
      <button className="btn btn-ghost" onClick={() => select(null)} style={{ marginBottom: 16 }}>
        <ArrowLeft className="w-4 h-4" /> {t('All clients')}
      </button>

      {/* Header */}
      <div className="card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Building2 size={22} style={{ color: 'var(--blue-600)' }} />
          <h1 dir="auto" style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{file.name}</h1>
        </div>
        {file.otherNames.length > 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
            {/* Each spelling is isolated: "Agiba Co." inside an RTL line would
                otherwise have its full stop dragged to the front. */}
            {t('Also written as:')}{' '}
            {file.otherNames.map((n, i) => <React.Fragment key={n}>{i > 0 && ' · '}<bdi>{n}</bdi></React.Fragment>)}
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 10, marginTop: 14 }}>
          <Stat label={t('We owe them')} value={file.owed.length} note={late ? t('Overdue: {{count}}', { count: late }) : undefined} alert={late > 0} />
          <Stat label={t('Active projects')} value={activeProjects} />
          <Stat label={t('Contracts')} value={file.contracts.length} note={expiring ? t('Ending soon: {{count}}', { count: expiring }) : undefined} warn={expiring > 0} />
          <Stat label={t('Open bids')} value={file.openBids.length} />
          <Stat label={t('Letters')} value={file.letters.length} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap: 16, alignItems: 'start' }}>
        {/* What we owe them */}
        <Section id="owed" icon={<AlertTriangle size={16} />} title={t('What we owe them')} count={file.owed.length}>
          {file.owed.length === 0 ? (
            <Empty>{t('Nothing owed — no open letters or tasks, no bid to submit and no step due in the next {{count}} days.', { count: STEP_HORIZON_DAYS })}</Empty>
          ) : (
            <>
              <List>
                {limit('owed', file.owed).map(o => (
                  <Row
                    key={`${o.kind}:${o.open.id}:${o.title}`}
                    data="owed"
                    icon={OWED_ICON[o.kind]}
                    serial={o.kind === 'step' ? undefined : o.open.serial}
                    title={o.kind === 'step' ? dl(o.title) : o.title}
                    sub={[
                      o.kind === 'letter' ? t('Letter to answer') : o.kind === 'bid' ? t('Bid to submit') : o.kind === 'step' ? t('Checklist step') : t('Task'),
                      o.context, o.owner,
                    ].filter(Boolean).join(' · ')}
                    end={<span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', color: o.late ? 'var(--danger)' : o.due ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                      {whenText(t, o.days, o.late)}
                    </span>}
                    onClick={() => openRecord(o.open)}
                  />
                ))}
              </List>
              {moreButton('owed', file.owed.length)}
            </>
          )}
        </Section>

        {/* Who spoke to them */}
        <Section id="contact" icon={<MessageSquare size={16} />} title={t('Last contact')}>
          {!last ? (
            <Empty>{t('No contact on file yet — no letters, bid follow-ups or project updates.')}</Empty>
          ) : (
            <>
              <div data-clients="last-contact" style={{ padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                  {contactWho(t, last)} <span style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>· {fmt.ago(last.at)}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{contactVia(t, last)}</div>
                {last.what && <div dir="auto" style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>{last.what}</div>}
              </div>
              <List>
                {file.contacts.slice(1, 6).map((c, i) => (
                  <Row
                    key={i}
                    data="contact"
                    icon={contactIcon(c)}
                    title={c.what || contactVia(t, c)}
                    sub={[contactWho(t, c), contactVia(t, c)].join(' · ')}
                    end={<span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmt.ago(c.at)}</span>}
                    onClick={c.open ? () => openRecord(c.open!) : undefined}
                  />
                ))}
              </List>
            </>
          )}
          {file.people.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
                <Users size={13} /> {t('Our people on this client')}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {file.people.slice(0, 8).map(p => (
                  <span key={p.name} dir="auto" data-clients="person" style={{ padding: '3px 8px', fontSize: 12, fontWeight: 600, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    {p.name} <span className="ltr-data" style={{ color: 'var(--text-muted)' }}>×{p.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* Bids */}
        <Section id="bids" icon={<Target size={16} />} title={t('Open bids')} count={file.openBids.length}>
          {file.openBids.length === 0 ? <Empty>{t('No open bids with this client.')}</Empty> : (
            <List>
              {file.openBids.map(o => (
                <Row
                  key={o.id}
                  data="bid"
                  icon={<Target size={14} />}
                  serial={o.serialNumber}
                  title={o.title}
                  sub={[dl(o.stage), o.ownerName].filter(Boolean).join(' · ')}
                  end={o.submissionDeadline ? <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmt.date(localDate(o.submissionDeadline), DATE_MEDIUM)}</span> : undefined}
                  onClick={() => openRecord({ type: 'opportunity', id: o.id, serial: o.serialNumber, label: o.title })}
                />
              ))}
            </List>
          )}
          {file.closedBids.length > 0 && (
            <>
              <p data-clients="record" style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '12px 0 6px', fontWeight: 600 }}>
                {t('Our record with them')}: {[
                  `${dl('Won')} ${file.record.won}`, `${dl('Lost')} ${file.record.lost}`,
                  file.record.noBid ? `${dl('No Bid')} ${file.record.noBid}` : '',
                  file.record.cancelled ? `${dl('Cancelled')} ${file.record.cancelled}` : '',
                ].filter(Boolean).join(' · ')}
              </p>
              {more.closed && (
                <List>
                  {file.closedBids.map(o => (
                    <Row
                      key={o.id}
                      data="closed-bid"
                      icon={<Target size={14} />}
                      serial={o.serialNumber}
                      title={o.title}
                      sub={[dl(o.stage), o.awardedTo].filter(Boolean).join(' · ')}
                      end={o.decisionDate ? <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmt.date(localDate(o.decisionDate), DATE_MEDIUM)}</span> : undefined}
                      onClick={() => openRecord({ type: 'opportunity', id: o.id, serial: o.serialNumber, label: o.title })}
                    />
                  ))}
                </List>
              )}
              <button
                type="button"
                onClick={() => setMore(m => ({ ...m, closed: !m.closed }))}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 0', cursor: 'pointer', background: 'none', border: 'none', color: 'var(--blue-600)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}
              >
                {more.closed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {more.closed ? t('Hide past bids') : t('Past bids ({{count}})', { count: file.closedBids.length })}
              </button>
            </>
          )}
        </Section>

        {/* Decision memory (queue D6) */}
        {memory && (
          <Section id="memory" icon={<MemoryIcon size={16} />} title={t('What we learned from their bids')}>
            <EarlierWithClient
              memory={memory}
              onOpenBid={b => { requestOpen({ type: 'opportunity', id: b.id, label: b.title, serial: b.serial, tab: 'decisions' }); onNavigate('opportunities'); }}
            />
          </Section>
        )}

        {/* Projects + contracts */}
        <Section id="projects" icon={<FolderKanban size={16} />} title={t('Projects and contracts')} count={file.projects.length}>
          {file.projects.length === 0 ? <Empty>{t('No projects with this client.')}</Empty> : (
            <List>
              {file.projects.map(p => (
                <Row
                  key={p.id}
                  data="project"
                  icon={<FolderKanban size={14} />}
                  serial={p.serialNumber}
                  title={p.name}
                  sub={[dl(p.status), p.lastUpdateText].filter(Boolean).join(' · ')}
                  onClick={() => openRecord({ type: 'project', id: p.id, serial: p.serialNumber, label: p.name })}
                />
              ))}
            </List>
          )}
          {file.contracts.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', margin: '14px 0 6px' }}>{t('Contracts')}</div>
              <List>
                {limit('contracts', file.contracts).map(c => (
                  <Row
                    key={c.id}
                    data="contract"
                    icon={<FileText size={14} />}
                    serial={c.number}
                    title={c.subject || c.number || '—'}
                    sub={[c.projectName, c.value != null && c.value !== '' ? fmt.money(c.value, c.currency) : '', c.inCharge].filter(Boolean).join(' · ')}
                    end={c.end ? (
                      <span style={{ fontSize: 12, fontWeight: c.expiry ? 700 : 400, whiteSpace: 'nowrap', color: c.expiry === 'soon' ? 'var(--surface-warn-text)' : 'var(--text-muted)' }}>
                        {c.expiry === 'soon' ? t('Ends {{when}}', { when: whenText(t, c.daysLeft, false) })
                          : c.expiry === 'ended' ? t('Ended {{date}}', { date: fmt.date(localDate(c.end), DATE_MEDIUM) })
                            : fmt.date(localDate(c.end), DATE_MEDIUM)}
                      </span>
                    ) : undefined}
                    onClick={() => openRecord({ type: 'project', id: c.projectId, label: c.projectName })}
                  />
                ))}
              </List>
              {moreButton('contracts', file.contracts.length)}
            </>
          )}
        </Section>

        {/* Letters */}
        <Section id="letters" icon={<MailOpen size={16} />} title={t('Latest letters')} count={file.letters.length}>
          {file.letters.length === 0 ? <Empty>{t('No letters on file for this client.')}</Empty> : (
            <>
              <List>
                {limit('letters', file.letters).map(l => (
                  <Row
                    key={l.id}
                    data="letter"
                    icon={<MailOpen size={14} />}
                    serial={l.serialNumber}
                    title={l.subject}
                    sub={[l.sentFrom, dl(l.status), l.assignedTo].filter(Boolean).join(' · ')}
                    end={(dayOf(l.dateReceived) || dayOf(l.createdAt)) ? <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {fmt.date(localDate(dayOf(l.dateReceived) || dayOf(l.createdAt)), DATE_MEDIUM)}
                    </span> : undefined}
                    onClick={() => openRecord({ type: 'corresponding', id: l.id, serial: l.serialNumber, label: l.subject })}
                  />
                ))}
              </List>
              {moreButton('letters', file.letters.length)}
            </>
          )}
        </Section>

        {/* E-mails from this PC's Outlook */}
        <Section id="mails" icon={<Mail size={16} />} title={t('E-mails in your Outlook')} count={mailState === 'on' ? file.mails.length : undefined}>
          {mailState === 'checking' || mailState === 'reading' ? (
            <p role="status" style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('Searching your Outlook…')}</p>
          ) : mailState === 'off' ? (
            <Empty>
              {t('The Outlook helper is not running on this PC, so only letters logged in ETaske are shown.')}{' '}
              <button type="button" onClick={() => onNavigate('outlook-feed')} style={{ padding: 0, background: 'none', border: 'none', color: 'var(--blue-600)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
                {t('Set it up')}
              </button>
            </Empty>
          ) : mailState === 'failed' ? (
            <Empty>{t('Outlook did not answer in time. Try again later.')}</Empty>
          ) : file.mails.length === 0 ? (
            <Empty>{t('No recent e-mail in your Outlook names this client.')}</Empty>
          ) : (
            <List>
              {file.mails.slice(0, SHOW_FIRST).map(m => (
                <Row
                  key={m.id}
                  data="mail"
                  icon={m.direction === 'sent' ? <Send size={14} /> : <Inbox size={14} />}
                  title={m.subject}
                  sub={m.direction === 'sent' ? t('To: {{name}}', { name: m.to || '—' }) : t('From: {{name}}', { name: m.sender || '—' })}
                  end={<span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmt.ago(m.received_at)}</span>}
                />
              ))}
            </List>
          )}
          {mailState === 'on' && (
            <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
              <Info size={12} style={{ flexShrink: 0, marginTop: 2 }} />
              {t('Read from the Outlook on this PC only — nothing is saved to ETaske.')}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function contactWho(t: TFunction, c: ContactEvent): string {
  if (c.via === 'mail-in') return c.them || t('Them');
  if (c.via === 'mail-out') return t('You');
  return c.who || '—';
}

function contactVia(t: TFunction, c: ContactEvent): string {
  switch (c.via) {
    case 'letter': return t('Letter');
    case 'mail-in': return t('E-mail from them');
    case 'mail-out': return t('E-mail to {{name}}', { name: c.them || '—' });
    case 'bid-follow-up': return t('Bid follow-up');
    case 'project-update': return t('Project update');
  }
}

function contactIcon(c: ContactEvent): React.ReactNode {
  switch (c.via) {
    case 'letter': return <MailOpen size={14} />;
    case 'mail-in': return <Inbox size={14} />;
    case 'mail-out': return <Send size={14} />;
    case 'bid-follow-up': return <Target size={14} />;
    case 'project-update': return <FolderKanban size={14} />;
  }
}

function Stat({ label, value, note, alert, warn }: { label: string; value: number; note?: string; alert?: boolean; warn?: boolean }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{label}</div>
      <div className="ltr-data" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
      {note && <div style={{ fontSize: 11, fontWeight: 700, color: alert ? 'var(--danger)' : warn ? 'var(--surface-warn-text)' : 'var(--text-secondary)' }}>{note}</div>}
    </div>
  );
}

function Section({ id, icon, title, count, children }: { id: string; icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="card" data-clients={`section-${id}`} style={{ padding: 16, minWidth: 0 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px' }}>
        <span style={{ color: 'var(--blue-600)', display: 'flex' }}>{icon}</span>
        {title}
        {count !== undefined && <span className="ltr-data" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</ul>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{children}</p>;
}

function Row({ data, icon, serial, title, sub, end, onClick }: {
  data: string; icon: React.ReactNode; serial?: string; title: string; sub?: string; end?: React.ReactNode; onClick?: () => void;
}) {
  const body = (
    <>
      <span style={{ color: 'var(--blue-600)', display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
          {serial && <span className="ltr-data" style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{serial}</span>}
          <span dir="auto" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || '—'}</span>
        </span>
        {sub && <span dir="auto" style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
      </span>
      {end}
    </>
  );
  const style: React.CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', textAlign: 'start',
    background: 'var(--surface-2)', border: '1px solid var(--border)', fontFamily: 'inherit', minWidth: 0,
  };
  return (
    <li data-clients={data}>
      {onClick
        ? <button type="button" onClick={onClick} style={{ ...style, cursor: 'pointer' }}>{body}</button>
        : <div style={style}>{body}</div>}
    </li>
  );
}
