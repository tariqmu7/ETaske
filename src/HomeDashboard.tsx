import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, MailOpen, CheckSquare, FolderKanban, Archive, Megaphone, Mail, Users,
  AlertCircle, ArrowRight, Clock, Target, Hourglass, CalendarDays, Users2, Handshake,
  Building2, FolderOpen, Files, FileText, ChevronDown, CheckCircle2, LayoutGrid,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from './lib/firebase';
import { AppUser } from './types';
import { AppView, NavCounts } from './App';
import { getRecents, RecentItem } from './lib/recents';
import { requestOpen } from './lib/deepLink';
import { subscribeVisibleTasks } from './lib/taskVisibility';
import { fetchBridgeMail, BRIDGE_URL, bridgeHeaders } from './lib/outlookBridge';
import { groupThreads, threadsAwaitingReply, threadsAwaitingTheirReply } from './lib/mailThreads';
import { loadMailLedger } from './lib/mailSuggest';
import { buildHomeBriefing, BriefLine, LeadRecord, CONTRACT_WARN_DAYS } from './lib/homeBriefing';
import { useFormat } from './lib/format';
import HowItWorks from './components/HowItWorks';
import QuickCapture from './components/QuickCapture';
import AskBox from './components/AskBox';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
  dueSoonCount: number;
  announcementCount: number;
  unreadNotifications: number;
  navCounts: NavCounts;
}

const recentIcon = (kind: RecentItem['kind']) =>
  kind === 'task' ? <CheckSquare className="w-4 h-4" />
    : kind === 'corresponding' ? <MailOpen className="w-4 h-4" />
      : kind === 'opportunity' ? <Target className="w-4 h-4" />
        : <FolderKanban className="w-4 h-4" />;

const rows = (snap: any) => snap.docs.filter((d: any) => d.id !== '--stats--').map((d: any) => ({ id: d.id, ...d.data() }));

const TONE_COLOR: Record<BriefLine['tone'], string> = {
  alert: 'var(--danger)',
  warn: 'var(--warning)',
  info: 'var(--blue-600)',
};

// "All sections" stays open or closed per browser — a convenience, not state.
const SECTIONS_KEY = 'etaske.home.sections.open.v1';
const readSectionsOpen = () => { try { return localStorage.getItem(SECTIONS_KEY) === '1'; } catch { return false; } };

/**
 * Home (queue task E1) — a briefing, not a menu.
 *
 * The page opens with a few sentences built from the live records
 * (lib/homeBriefing.ts): what is late, what is due today, which tenders close
 * this week, which e-mails wait for a reply, and — for a manager — what waits
 * on them. Each sentence opens the one page that deals with it. The section
 * tiles that used to fill the page now sit one level down, behind "All
 * sections"; the top menu still reaches every one of them.
 */
export default function HomeDashboard({ user, appUser, projectUsers, onNavigate, dueSoonCount, announcementCount, navCounts }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const isManagerOrAdmin = appUser.role === 'Admin' || appUser.role === 'Manager';
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
  const firstName = (appUser.displayName || '').split(' ')[0] || appUser.displayName;

  // "Jump back in" — recently opened records, kept fresh via the recents bus.
  const [recents, setRecents] = useState<RecentItem[]>(() => getRecents());
  useEffect(() => {
    const refresh = () => setRecents(getRecents());
    window.addEventListener('etaske:recents', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('etaske:recents', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // ── The records the briefing reads ─────────────────────────────────────────
  // App.tsx already listens to the same collections, and the Firestore SDK
  // shares one watch between identical listeners, so this costs no extra reads.
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [letters, setLetters] = useState<any[] | null>(null);
  const [bids, setBids] = useState<any[] | null>(null);
  const [projects, setProjects] = useState<any[] | null>(null);
  const [contracts, setContracts] = useState<any[] | null>(null);
  const [subcontracts, setSubcontracts] = useState<any[] | null>(null);
  const [mail, setMail] = useState<{ awaitingUs: number; awaitingThem: number } | null>(null);

  useEffect(() => {
    // Privacy-aware: only the tasks this person may read (public + own).
    const unsubT = subscribeVisibleTasks(user.uid, list => setTasks(list), () => setTasks([]));
    const listen = (name: string, set: (v: any[]) => void) => onSnapshot(collection(db, name),
      s => set(rows(s)),
      err => { console.warn(`Home briefing — ${name} listener:`, err.code); set([]); });
    const unsubs = [listen('correspondences', setLetters), listen('opportunities', setBids)];
    // Contracts have no owner uid, so only a manager's briefing names them
    // (the same rule as the contract expiry alert in App.tsx).
    if (isManagerOrAdmin) {
      unsubs.push(listen('projects', setProjects), listen('projectContracts', setContracts), listen('projectSubcontracts', setSubcontracts));
    }
    return () => { unsubT(); unsubs.forEach(u => u()); };
  }, [user.uid, isManagerOrAdmin]);

  // Outlook on this PC, when the helper is running — the same chains the
  // Waiting board lists. Silent (no mail sentence) when it is not.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${BRIDGE_URL}/status`, { headers: bridgeHeaders, signal: AbortSignal.timeout(3000), targetAddressSpace: 'loopback' } as RequestInit);
        if (!res.ok) return;
        const [inbox, sent] = await Promise.all([fetchBridgeMail('Inbox', '', 50), fetchBridgeMail('Sent Items', '', 50)]);
        if (!alive || (!inbox && !sent)) return;
        const all = groupThreads([...(inbox || []), ...(sent || [])]);
        const ledger = loadMailLedger();
        setMail({
          awaitingUs: threadsAwaitingReply(all, ledger, 50).length,
          awaitingThem: threadsAwaitingTheirReply(all, ledger, 50).length,
        });
      } catch {
        /* helper not running — no mail line */
      }
    })();
    return () => { alive = false; };
  }, []);

  const userNames = useMemo(() => Object.fromEntries(projectUsers.map(u => [u.id, u.displayName])), [projectUsers]);
  const loaded = !!(tasks && letters && bids);
  const lines = useMemo(() => loaded ? buildHomeBriefing({
    uid: user.uid, isManager: isManagerOrAdmin,
    tasks: tasks!, correspondences: letters!, opportunities: bids!,
    projects: projects ?? undefined, contracts: contracts ?? undefined, subcontracts: subcontracts ?? undefined,
    mail, userNames,
  }) : [], [loaded, user.uid, isManagerOrAdmin, tasks, letters, bids, projects, contracts, subcontracts, mail, userNames]);

  // ── Wording ────────────────────────────────────────────────────────────────
  // Singular/plural is two explicit keys + a ternary, never an i18next suffix
  // (Arabic has six forms; ar.ts is typed key-for-key against en.ts).
  const theirMail = (n: number) =>
    t(n === 1 ? '1 e-mail we sent has had no answer yet' : '{{count}} e-mails we sent have had no answer yet', { count: n });

  const headline = (l: BriefLine): string => {
    const n = l.count;
    const one = n === 1;
    const m = isManagerOrAdmin;
    switch (l.key) {
      case 'late':
        return m ? t(one ? '1 item is late across the department' : '{{count}} items are late across the department', { count: n })
          : t(one ? '1 of your items is late' : '{{count}} of your items are late', { count: n });
      case 'today':
        return m ? t(one ? '1 item is due today across the department' : '{{count}} items are due today across the department', { count: n })
          : t(one ? '1 of your items is due today' : '{{count}} of your items are due today', { count: n });
      case 'signoff':
        return t(one ? '1 offer waiting for your sign-off' : '{{count}} offers waiting for your sign-off', { count: n });
      case 'bids':
        return m ? t(one ? '1 tender closes this week' : '{{count}} tenders close this week', { count: n })
          : t(one ? '1 of your tenders closes this week' : '{{count}} of your tenders close this week', { count: n });
      case 'mail':
        if (!n) return theirMail(l.second || 0);
        return t(one ? '1 e-mail is waiting for a reply from us' : '{{count}} e-mails are waiting for a reply from us', { count: n });
      case 'review':
        return t(one ? '1 letter is waiting for your review' : '{{count}} letters are waiting for your review', { count: n });
      case 'contracts':
        return t(one ? '1 contract runs out within {{days}} days' : '{{count}} contracts run out within {{days}} days', { count: n, days: CONTRACT_WARN_DAYS });
    }
  };

  /** "3 days late" / "due today" / "in 5 days". Arabic counts nouns
   *  differently for 1, 2, 3–10 and 11+, hence the bands. */
  const whenText = (days?: number): string => {
    if (days === undefined) return '';
    if (days < 0) {
      const late = -days;
      return late === 1 ? t('1 day late') : late === 2 ? t('2 days late')
        : late <= 10 ? t('{{count}} days late', { count: late }) : t('late for {{count}} days', { count: late });
    }
    if (days === 0) return t('due today');
    if (days === 1) return t('due tomorrow');
    if (days === 2) return t('in 2 days');
    return days <= 10 ? t('in {{count}} days', { count: days }) : t('{{count}} days from now', { count: days });
  };

  const record = (r: LeadRecord) => (
    <span className={fmt.bidiFor(r.label)} style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
      {r.serial && <span className="ltr-data">{r.serial}</span>}{r.serial ? ' ' : ''}{r.label}
    </span>
  );

  const detailParts = (l: BriefLine): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    if (l.lead) {
      const label = l.key === 'late' ? t('Longest late')
        : l.key === 'today' ? t('Among them')
          : l.key === 'signoff' ? t('Oldest request')
            : t('Nearest');
      parts.push(<span>{label}: {record(l.lead)}</span>);
      // A sign-off's "days" is its age, not a deadline — name who asked instead.
      if (l.key === 'signoff') { if (l.lead.owner) parts.push(<span>{t('from {{name}}', { name: l.lead.owner })}</span>); }
      else if (l.key !== 'today') parts.push(<span>{whenText(l.lead.days)}</span>);
    }
    if (l.topPerson) parts.push(<span>{t('most with {{name}} ({{count}})', { name: l.topPerson.name, count: l.topPerson.count })}</span>);
    if (l.key === 'mail') {
      if (l.count && l.second) parts.push(<span>{theirMail(l.second)}</span>);
      parts.push(<span>{t('From the Outlook on this PC.')}</span>);
    }
    return parts;
  };

  const today = fmt.date(new Date(), { weekday: 'long', day: 'numeric', month: 'long' });

  // ── Everything else, one level down ────────────────────────────────────────
  const [sectionsOpen, setSectionsOpen] = useState(readSectionsOpen);
  const toggleSections = () => {
    const next = !sectionsOpen;
    setSectionsOpen(next);
    try { localStorage.setItem(SECTIONS_KEY, next ? '1' : '0'); } catch { /* per-browser only */ }
  };

  type Section = { id: AppView; label: string; icon: React.ReactNode; badge?: number; show: boolean };
  // Same four groups, same role gating as the top menu (settled rule 11).
  const groups: { key: string; label: string; items: Section[] }[] = [
    {
      key: 'work', label: t('Work'), items: [
        { id: 'due-soon', label: t('Needs you today'), icon: <AlertCircle className="w-4 h-4" />, badge: dueSoonCount, show: true },
        { id: 'tasks', label: t('Tasks'), icon: <CheckSquare className="w-4 h-4" />, badge: navCounts.myActiveTasks, show: true },
        { id: 'correspondences', label: t('Correspondences'), icon: <MailOpen className="w-4 h-4" />, badge: isManagerOrAdmin ? navCounts.corrNeedsReview : navCounts.corrUnread, show: true },
        { id: 'waiting', label: t('Waiting'), icon: <Hourglass className="w-4 h-4" />, show: true },
        { id: 'calendar', label: t('Calendar'), icon: <CalendarDays className="w-4 h-4" />, show: true },
        { id: 'meetings', label: t('Meetings'), icon: <Users2 className="w-4 h-4" />, show: true },
        { id: 'handover', label: t('Handover'), icon: <Handshake className="w-4 h-4" />, show: true },
      ] as Section[],
    },
    {
      key: 'portfolio', label: t('Portfolio'), items: [
        { id: 'opportunities', label: t('Opportunities'), icon: <Target className="w-4 h-4" />, badge: navCounts.bidsDueSoon, show: true },
        { id: 'projects', label: t('Projects'), icon: <FolderKanban className="w-4 h-4" />, show: true },
        { id: 'clients', label: t('Clients'), icon: <Building2 className="w-4 h-4" />, show: true },
        { id: 'documents', label: t('Documents'), icon: <FolderOpen className="w-4 h-4" />, show: true },
      ] as Section[],
    },
    {
      key: 'insights', label: t('Insights'), items: [
        { id: 'overview', label: t('Overview'), icon: <BarChart3 className="w-4 h-4" />, show: isManagerOrAdmin },
        { id: 'bid-analytics', label: t('Bid Analytics'), icon: <BarChart3 className="w-4 h-4" />, show: isManagerOrAdmin },
        { id: 'weekly-report', label: t('Weekly report'), icon: <FileText className="w-4 h-4" />, show: isManagerOrAdmin },
        { id: 'duplicates', label: t('Duplicates'), icon: <Files className="w-4 h-4" />, show: isManagerOrAdmin },
      ] as Section[],
    },
    {
      key: 'more', label: t('More'), items: [
        { id: 'announcements', label: t('News'), icon: <Megaphone className="w-4 h-4" />, badge: announcementCount, show: true },
        { id: 'archive', label: t('Archive'), icon: <Archive className="w-4 h-4" />, show: true },
        { id: 'outlook-feed', label: t('Outlook'), icon: <Mail className="w-4 h-4" />, show: true },
        { id: 'admin', label: t('Users'), icon: <Users className="w-4 h-4" />, show: appUser.role === 'Admin' },
      ] as Section[],
    },
  ].map(g => ({ ...g, items: g.items.filter(i => i.show) })).filter(g => g.items.length);

  const openRecent = (r: RecentItem) => {
    if (r.kind === 'task') { requestOpen({ type: 'task', id: r.id, label: r.label, serial: r.serial }); onNavigate('tasks'); }
    else if (r.kind === 'corresponding') { requestOpen({ type: 'corresponding', id: r.id, label: r.label, serial: r.serial }); onNavigate('correspondences'); }
    else if (r.kind === 'opportunity') { requestOpen({ type: 'opportunity', id: r.id, label: r.label, serial: r.serial }); onNavigate('opportunities'); }
    else onNavigate('projects');
  };

  const sectionHeading: React.CSSProperties = { fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 };

  return (
    <div>
      {/* Greeting + today's date */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
          {/* One key, not "greeting + comma + name": the comma itself differs
              (Arabic uses ، and it must sit on the correct side of the name). */}
          {t('{{greeting}}, {{name}}', { greeting, name: firstName })}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 6 }}>{today}</p>
      </div>

      {/* The briefing — sentences, each one a door to the page that handles it */}
      <section className="card" data-briefing aria-labelledby="home-briefing-h" style={{ background: 'var(--surface)', padding: '16px 18px', marginBottom: 20 }}>
        <h2 id="home-briefing-h" style={{ ...sectionHeading, marginBottom: 6 }}>
          {isManagerOrAdmin ? t('The department today') : t('Your day')}
        </h2>
        {!loaded ? (
          <p data-briefing-state="loading" style={{ fontSize: 14, color: 'var(--text-muted)', margin: '6px 0 0' }}>{t('Reading your records…')}</p>
        ) : lines.length === 0 ? (
          <p data-briefing-state="clear" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '6px 0 0' }}>
            <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--success)', flexShrink: 0 }} />
            {t('Nothing is late and nothing is due today.')}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {lines.map((l, i) => {
              const parts = detailParts(l);
              return (
                <li key={l.key} style={{ borderTop: i ? '1px solid var(--border)' : 'none' }}>
                  <button
                    data-line={l.key}
                    onClick={() => onNavigate(l.view)}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', padding: '12px 0', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start' }}
                  >
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: TONE_COLOR[l.tone], marginTop: 8, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span data-headline style={{ display: 'block', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4 }}>{headline(l)}</span>
                      {parts.length > 0 && (
                        <span data-detail style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                          {parts.map((p, j) => <React.Fragment key={j}>{j > 0 && <span aria-hidden> · </span>}{p}</React.Fragment>)}
                        </span>
                      )}
                    </span>
                    <ArrowRight className="w-4 h-4" style={{ color: 'var(--text-muted)', marginTop: 5, flexShrink: 0 }} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* One-box capture (queue C1) — the default way to add work: paste an
          e-mail or write a sentence, confirm the proposal in the normal form. */}
      <QuickCapture user={user} appUser={appUser} projectUsers={projectUsers} onNavigate={onNavigate} />

      {/* Ask-it questions (queue D11) — "what did we send NNPC in July?"
          answered from the records the reader can already see. */}
      <AskBox user={user} appUser={appUser} projectUsers={projectUsers} onNavigate={onNavigate} />

      {/* First-run guidance — the three steps work takes here. Hidden for
          anyone who has already opened a record, and dismissible for good. */}
      <HowItWorks enabled={recents.length === 0} onNavigate={onNavigate} />

      {/* Jump back in — recently opened records */}
      {recents.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Clock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <h2 style={sectionHeading}>{t('Jump back in')}</h2>
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {recents.map(r => (
              <button
                key={`${r.kind}-${r.id}`}
                onClick={() => openRecent(r)}
                className="card card-interactive"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, maxWidth: 260, textAlign: 'start' }}
              >
                <span style={{ color: 'var(--blue-600)', flexShrink: 0, display: 'flex' }}>{recentIcon(r.kind)}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                  {r.serial && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{r.serial}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All sections — the old tile grid, now one level down */}
      <div data-sections>
        <button
          onClick={toggleSections}
          aria-expanded={sectionsOpen}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-muted)' }}
        >
          <LayoutGrid className="w-4 h-4" />
          <span style={sectionHeading}>{t('All sections')}</span>
          <ChevronDown className="w-4 h-4" style={{ transform: sectionsOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>
        {sectionsOpen && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginTop: 10 }}>
            {groups.map(g => (
              <div key={g.key}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>{g.label}</div>
                {g.items.map(s => (
                  <button
                    key={s.id}
                    data-section={s.id}
                    onClick={() => onNavigate(s.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 8px', minHeight: 40, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, color: 'var(--text-primary)', textAlign: 'start' }}
                  >
                    <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{s.icon}</span>
                    <span style={{ flex: 1 }}>{s.label}</span>
                    {!!s.badge && (
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '1px 7px' }}>
                        {s.badge > 99 ? '99+' : s.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
