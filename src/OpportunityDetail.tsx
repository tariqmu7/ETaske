import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { AppUser, Opportunity, isOpportunityOpen } from './types';
import {
  ArrowLeft, Edit2, MessageSquare, FileText, Building2, Hash, MapPin,
  CalendarClock, User as UserIcon, Percent, Trophy, Flag,
} from 'lucide-react';
import OpportunityFollowUpsTab from './components/opportunities/OpportunityFollowUpsTab';
import OpportunityMilestonesTab from './components/opportunities/OpportunityMilestonesTab';
import OpportunityOutcomeTab from './components/opportunities/OpportunityOutcomeTab';
import { STAGE_COLORS, fullMoney, daysUntil } from './components/opportunities/opportunityUi';

type Tab = 'overview' | 'followups' | 'milestones' | 'outcome';

interface Props {
  opportunity: Opportunity;
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onBack: () => void;
  onEdit: () => void;
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <FileText className="w-4 h-4" /> },
  { id: 'followups', label: 'Follow-ups', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'milestones', label: 'Milestones', icon: <Flag className="w-4 h-4" /> },
  { id: 'outcome', label: 'Outcome', icon: <Trophy className="w-4 h-4" /> },
];

export default function OpportunityDetail({ opportunity, user, appUser, projectUsers, onBack, onEdit }: Props) {
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
          <ArrowLeft className="w-4 h-4" /> All opportunities
        </button>
        <button className="btn btn-ghost" onClick={onEdit}>
          <Edit2 className="w-4 h-4" /> Edit opportunity
        </button>
      </div>

      {/* Header card */}
      <div className="card" style={{ padding: 20, marginBottom: 18, borderInlineStart: `3px solid ${stageColor}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{o.title}</h1>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#fff', background: stageColor, padding: '4px 10px', whiteSpace: 'nowrap' }}>
            {o.stage}
          </span>
          {o.serialNumber && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{o.serialNumber}</span>}
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
              {late ? `${Math.abs(dLeft as number)}d past deadline` : (dLeft === 0 ? 'Due today' : `${dLeft}d to deadline`)}
            </span>
          )}
        </div>

        {/* Headline numbers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 16 }}>
          <Metric label="Estimated value" value={fullMoney(o.estimatedValue, o.currency)} />
          <Metric
            label="Win probability"
            value={o.probability === undefined || o.probability === null ? '—' : `${o.probability}%`}
            icon={<Percent className="w-3.5 h-3.5" />}
          />
          <Metric label="Submission deadline" value={o.submissionDeadline || '—'} />
          <Metric label="Next action" value={o.nextActionDate || '—'} />
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '11px 16px',
              background: 'none', border: 'none', borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 700, fontSize: 14,
              fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1,
            }}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gap: 20 }}>
          {o.scope && (
            <div className="card" style={{ padding: 20 }}>
              <SectionTitle>Scope</SectionTitle>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{o.scope}</p>
            </div>
          )}

          <div className="card" style={{ padding: 20 }}>
            <SectionTitle>Bid record</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              <Row label="Source" value={o.source} />
              <Row label="Client" value={o.client} />
              <Row label="Sector" value={o.sector} />
              <Row label="Location" value={o.location} />
              <Row label="Tender / RFQ number" value={o.tenderNumber} />
              <Row label="Bid owner" value={owner?.displayName || o.ownerName} />
              <Row label="Announced" value={o.announcedDate} />
              <Row label="Submission deadline" value={o.submissionDeadline} />
              <Row label="Submitted on" value={o.submittedDate} />
              <Row label="Decision date" value={o.decisionDate} />
              <Row label="Estimated value" value={fullMoney(o.estimatedValue, o.currency)} />
              <Row label="Win probability" value={o.probability === undefined || o.probability === null ? undefined : `${o.probability}%`} />
            </div>
          </div>

          {!isOpportunityOpen(o.stage) && (
            <div className="card" style={{ padding: 20, borderInlineStart: `3px solid ${stageColor}` }}>
              <SectionTitle>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Trophy className="w-4 h-4" style={{ color: stageColor }} /> Outcome — {o.stage}
                </span>
              </SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                <Row label={o.stage === 'Won' ? 'Competitor' : 'Awarded to'} value={o.awardedTo} />
                <Row label="Awarded value" value={o.awardedValue === undefined || o.awardedValue === null || o.awardedValue === '' ? undefined : fullMoney(o.awardedValue, o.currency)} />
                <Row label="Decision date" value={o.decisionDate} />
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 14 }}
                onClick={() => setTab('outcome')}
              >
                <Trophy className="w-3.5 h-3.5" /> Reasons, competitor pricing and lessons learned
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'followups' && (
        <OpportunityFollowUpsTab opportunity={o} user={user} appUser={appUser} />
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

function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>
        {icon}{value}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text-primary)', marginTop: 2 }}>{value || '—'}</div>
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
