import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'firebase/auth';
import { AppUser, Project } from './types';
import { useDisplayLabel } from './lib/displayLabel';
import { useFormat } from './lib/format';
import {
  ArrowLeft, Activity, DollarSign, FileText, Truck, Edit2,
  Building2, Hash, MapPin, CalendarRange, Link2,
} from 'lucide-react';
import LinkedRecordsPanel from './components/LinkedRecordsPanel';
import type { AppView } from './App';
import ProjectTrackingTab from './components/projects/ProjectTrackingTab';
import ProjectFinancialsTab from './components/projects/ProjectFinancialsTab';
import ProjectContractsTab from './components/projects/ProjectContractsTab';
import ProjectSubcontractsTab from './components/projects/ProjectSubcontractsTab';

type Tab = 'tracking' | 'financials' | 'contracts' | 'subcontracts' | 'linked';

function statusColors(status: string): { bg: string; fg: string } {
  switch (status) {
    case 'Active':    return { bg: 'rgba(22,163,74,0.12)',  fg: '#16a34a' };
    case 'On Hold':   return { bg: 'rgba(245,158,11,0.14)', fg: '#b45309' };
    case 'Completed': return { bg: 'rgba(37,99,235,0.12)',  fg: '#2563eb' };
    case 'Cancelled': return { bg: 'rgba(220,38,38,0.12)',  fg: '#dc2626' };
    default:          return { bg: 'var(--surface-3)',      fg: 'var(--text-secondary)' };
  }
}

interface Props {
  project: Project;
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onBack: () => void;
  onEdit: () => void;
  /** Lets the Linked tab jump into the task / correspondence it lists. */
  onNavigate?: (v: AppView) => void;
}

export default function ProjectDetail({ project, user, appUser, projectUsers, onBack, onEdit, onNavigate }: Props) {
  const { t } = useTranslation();
  const dl = useDisplayLabel();
  const fmt = useFormat();
  const [tab, setTab] = useState<Tab>('tracking');

  // The tab table lives inside the component so each label is a literal t()
  // call — a module-level table would only ever call t(variable), which the
  // harness's key audit cannot see.
  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'tracking', label: t('Tracking'), icon: <Activity className="w-4 h-4" /> },
    { id: 'financials', label: t('Financials'), icon: <DollarSign className="w-4 h-4" /> },
    { id: 'contracts', label: t('Contracts'), icon: <FileText className="w-4 h-4" /> },
    { id: 'subcontracts', label: t('Subcontracts'), icon: <Truck className="w-4 h-4" /> },
    // Queue task 6: the reverse view of the cross-record link — what is
    // attached to this project, from the other collections.
    { id: 'linked', label: t('Linked'), icon: <Link2 className="w-4 h-4" /> },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px' }}>
      {/* Back + edit */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" /> {t('All projects')}
        </button>
        <button className="btn btn-ghost" onClick={onEdit}>
          <Edit2 className="w-4 h-4" /> {t('Edit project')}
        </button>
      </div>

      {/* Header card */}
      <div className="card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{project.name}</h1>
          {(() => {
            const c = statusColors(project.status);
            return (
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: c.fg, background: c.bg, padding: '4px 10px', whiteSpace: 'nowrap' }}>
                {dl(project.status)}
              </span>
            );
          })()}
          {project.serialNumber && <span className="ltr-data" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{project.serialNumber}</span>}
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)' }}>
          {(project.client || project.operator) && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Building2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />{[project.client, project.operator].filter(Boolean).join(' · ')}</span>}
          {project.code && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Hash className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />{project.code}</span>}
          {project.location && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><MapPin className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />{project.location}</span>}
          {(project.startDate || project.endDate) && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><CalendarRange className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /><span className="ltr-data">{[project.startDate, project.endDate].filter(Boolean).map(d => fmt.date(d)).join(' → ')}</span></span>}
        </div>
        {/* ★ Free-text prose is whatever language the user typed. An English
            paragraph inside an RTL page has its trailing full stop dragged to
            the front (the "Other..." trap, at paragraph scale), so the run is
            isolated — and `bidiFor` picks LTR only when the text is Latin. */}
        {project.description && <p className={fmt.bidiFor(project.description)} style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '12px 0 0', lineHeight: 1.5 }}>{project.description}</p>}
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

      {/* Tab panels */}
      {tab === 'tracking' && <ProjectTrackingTab project={project} user={user} appUser={appUser} />}
      {tab === 'financials' && <ProjectFinancialsTab project={project} user={user} />}
      {tab === 'contracts' && <ProjectContractsTab project={project} user={user} />}
      {tab === 'subcontracts' && <ProjectSubcontractsTab project={project} user={user} />}
      {tab === 'linked' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            {t('Correspondences and tasks attached to this project.')}
          </p>
          <LinkedRecordsPanel
            target="project"
            targetId={project.id}
            user={user}
            appUser={appUser}
            projectUsers={projectUsers}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
  );
}
