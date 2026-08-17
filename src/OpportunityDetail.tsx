import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'firebase/auth';
import { AppUser, Opportunity, isOpportunityOpen } from './types';
import { useDisplayLabel } from './lib/displayLabel';
import { useFormat } from './lib/format';
import {
  ArrowLeft, Edit2, MessageSquare, FileText, Building2, Hash, MapPin,
  CalendarClock, User as UserIcon, Percent, Trophy, Flag, CheckSquare,
} from 'lucide-react';
import OpportunityFollowUpsTab from './components/opportunities/OpportunityFollowUpsTab';
import OpportunityMilestonesTab from './components/opportunities/OpportunityMilestonesTab';
import OpportunityOutcomeTab from './components/opportunities/OpportunityOutcomeTab';
import OpportunityTasksTab from './components/opportunities/OpportunityTasksTab';
import LinkedRecordsPanel from './components/LinkedRecordsPanel';
import { STAGE_COLORS, fullMoney, daysUntil } from './components/opportunities/opportunityUi';
import type { AppView } from './App';

type Tab = 'overview' | 'followups' | 'tasks' | 'milestones' | 'outcome';

interface Props {
  opportunity: Opportunity;
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onBack: () => void;
  onEdit: () => void;
  /** Lets the Tasks tab jump into the tasks dashboard on a linked task. */
  onNavigate?: (v: AppView) => void;
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <FileText className="w-4 h-4" /> },
  { id: 'followups', label: 'Follow-ups', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'tasks', label: 'Tasks', icon: <CheckSquare className="w-4 h-4" /> },
  { id: 'milestones', label: 'Milestones', icon: <Flag className="w-4 h-4" /> },
  { id: 'outcome', label: 'Outcome', icon: <Trophy className="w-4 h-4" /> },
];

export default function OpportunityDetail({ opportunity, user, appUser, projectUsers, onBack, onEdit, onNavigate }: Props) {
  const { t } = useTranslation();
  const dl = useDisplayLabel();
  const fmt = useFormat();
  const [tab, setTab] = useState<Tab>('followups');

  const o = opportunity;
  const stageColor = STAGE_COLORS[o.stage] || 'var(--border)';
  const dLeft = daysUntil(o.submissionDeadline);
  const showCountdown = isOpportunityOpen(o.stage) && dLeft !== null;
  const late = showCountdown && (dLeft as number) < 0;
  const soon = showCountdown && (dLeft as number) >= 0 && (dLeft as number) <= 7;
  const owner = projectUsers.find(u => u.id === o.ownerId);

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px' }}>
      {/* Back + edit */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" /> {t('All opportunities')}
        </button>
        <button className="btn btn-ghost" onClick={onEdit}>
          <Edit2 className="w-4 h-4" /> {t('Edit opportunity')}
        </button>
      </div>

      {/* Header card */}
      <div className="card" style={{ padding: 20, marginBottom: 18, borderInlineStart: `3px solid ${stageColor}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{o.title}</h1>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#fff', background: stageColor, padding: '4px 10px', whiteSpace: 'nowrap' }}>
            {dl(o.stage)}
          </span>
          {o.serialNumber && <span className="ltr-data" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{o.serialNumber}</span>}
        </div>

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)' }}>
          {(o.client || o.sector) && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Building2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              {[o.client, o.sector].filter(Boolean).join(' · ')}
            </span>
          )}
          {o.tenderNumber && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Hash className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />{o.tenderNumber}</span>}
          {o.location && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><MapPin className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />{o.location}</span>}
          {(o.ownerName || owner) && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <UserIcon className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              {owner?.displayName || o.ownerName}
            </span>
          )}
          {showCountdown && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: late || soon ? 700 : 400, color: late ? '#dc2626' : soon ? '#f59e0b' : 'var(--text-secondary)' }}>
              <CalendarClock className="w-4 h-4" />
              {late
                ? t('{{count}}d past deadline', { count: Math.abs(dLeft as number) })
                : (dLeft === 0 ? t('Due today') : t('{{count}}d to deadline', { count: dLeft as number }))}
            </span>
          )}
        </div>

        {/* Headline numbers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 16 }}>
          <Metric label={t('Estimated value')} value={fullMoney(o.estimatedValue, o.currency)} />
          <Metric
            label={t('Win probability')}
            value={o.probability === undefined || o.probability === null ? '—' : fmt.percent(o.probability)}
            icon={<Percent className="w-3.5 h-3.5" />}
          />
          <Metric label={t('Submission deadline')} value={fmt.date(o.submissionDeadline) || '—'} />
          <Metric label={t('Next action')} value={fmt.date(o.nextActionDate) || '—'} />
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
        {TABS.map(tb => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '11px 16px',
              background: 'none', border: 'none', borderBottom: tab === tb.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === tb.id ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 700, fontSize: 14,
              fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1,
            }}
          >
            {tb.icon}{t(tb.label)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gap: 20 }}>
          {o.scope && (
            <div className="card" style={{ padding: 20 }}>
              <SectionTitle>{t('Scope')}</SectionTitle>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{o.scope}</p>
            </div>
          )}

          <div className="card" style={{ padding: 20 }}>
            <SectionTitle>{t('Bid record')}</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              <Row label={t('Source')} value={dl(o.source)} />
              <Row label={t('Client')} value={o.client} />
              <Row label={t('Sector')} value={o.sector} />
              <Row label={t('Location')} value={o.location} />
              <Row label={t('Tender / RFQ number')} value={o.tenderNumber} />
              <Row label={t('Bid owner')} value={owner?.displayName || o.ownerName} />
              <Row label={t('Announced')} value={fmt.date(o.announcedDate)} />
              <Row label={t('Submission deadline')} value={fmt.date(o.submissionDeadline)} />
              <Row label={t('Submitted on')} value={fmt.date(o.submittedDate)} />
              <Row label={t('Decision date')} value={fmt.date(o.decisionDate)} />
              <Row label={t('Estimated value')} value={fullMoney(o.estimatedValue, o.currency)} />
              <Row label={t('Win probability')} value={o.probability === undefined || o.probability === null ? undefined : fmt.percent(o.probability)} />
            </div>
          </div>

          {/* Queue task 6 — the reverse view of the link: the emails logged
              against this bid. Tasks are excluded here because they have their
              own tab (task 3); listing the same rows twice on one page reads
              as two different lists that could disagree. */}
          <LinkedRecordsPanel
            target="opportunity"
            targetId={o.id}
            user={user}
            appUser={appUser}
            projectUsers={projectUsers}
            onNavigate={onNavigate}
            includeTasks={false}
          />

          {!isOpportunityOpen(o.stage) && (
            <div className="card" style={{ padding: 20, borderInlineStart: `3px solid ${stageColor}` }}>
              <SectionTitle>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Trophy className="w-4 h-4" style={{ color: stageColor }} /> {t('Outcome — {{stage}}', { stage: dl(o.stage) })}
                </span>
              </SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                <Row label={o.stage === 'Won' ? t('Competitor') : t('Awarded to')} value={o.awardedTo} />
                <Row label={t('Awarded value')} value={o.awardedValue === undefined || o.awardedValue === null || o.awardedValue === '' ? undefined : fullMoney(o.awardedValue, o.currency)} />
                <Row label={t('Decision date')} value={fmt.date(o.decisionDate)} />
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 14 }}
                onClick={() => setTab('outcome')}
              >
                <Trophy className="w-3.5 h-3.5" /> {t('Reasons, competitor pricing and lessons learned')}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'followups' && (
        <OpportunityFollowUpsTab opportunity={o} user={user} appUser={appUser} />
      )}

      {tab === 'tasks' && (
        <OpportunityTasksTab
          opportunity={o}
          user={user}
          appUser={appUser}
          projectUsers={projectUsers}
          onNavigate={onNavigate}
        />
      )}

      {tab === 'milestones' && (
        <OpportunityMilestonesTab opportunity={o} user={user} appUser={appUser} />
      )}

      {tab === 'outcome' && (
        <OpportunityOutcomeTab opportunity={o} user={user} appUser={appUser} />
      )}
    </div>
  );
}

/**
 * ★ Every value here goes through `bidiFor`, and money is why.
 *
 * "12,500,000 EGP" is a number followed by a Latin word with a NEUTRAL space
 * between them — in an RTL paragraph that space takes the paragraph's direction
 * and the two halves swap, so the tile painted "EGP 12,500,000". Same family as
 * the "#TK000001" and "Other..." defects, and again only visible in a rendered
 * screenshot. `bidiFor` picks the isolation from the text, so an Arabic value
 * (a client name, a translated source) is isolated without being forced LTR.
 */
function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  const fmt = useFormat();
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>
        {icon}<span className={fmt.bidiFor(value)}>{value}</span>
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  const fmt = useFormat();
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text-primary)', marginTop: 2 }}>
        <span className={fmt.bidiFor(value)}>{value || '—'}</span>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '0 0 14px' }}>
      {children}
    </h3>
  );
}
