import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { AppUser, Project } from './types';
import {
  ArrowLeft, Activity, DollarSign, FileText, Truck, Edit2,
  Building2, Hash, MapPin, CalendarRange,
} from 'lucide-react';
import ProjectTrackingTab from './components/projects/ProjectTrackingTab';
import ProjectFinancialsTab from './components/projects/ProjectFinancialsTab';
import ProjectContractsTab from './components/projects/ProjectContractsTab';
import ProjectSubcontractsTab from './components/projects/ProjectSubcontractsTab';

type Tab = 'tracking' | 'financials' | 'contracts' | 'subcontracts';

interface Props {
  project: Project;
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onBack: () => void;
  onEdit: () => void;
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'tracking', label: 'Tracking', icon: <Activity className="w-4 h-4" /> },
  { id: 'financials', label: 'Financials', icon: <DollarSign className="w-4 h-4" /> },
  { id: 'contracts', label: 'Contracts', icon: <FileText className="w-4 h-4" /> },
  { id: 'subcontracts', label: 'Subcontracts', icon: <Truck className="w-4 h-4" /> },
];

export default function ProjectDetail({ project, user, appUser, projectUsers, onBack, onEdit }: Props) {
  const [tab, setTab] = useState<Tab>('tracking');

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px' }}>
      {/* Back + edit */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" /> All projects
        </button>
        <button className="btn btn-ghost" onClick={onEdit}>
          <Edit2 className="w-4 h-4" /> Edit project
        </button>
      </div>

      {/* Header card */}
      <div className="card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{project.name}</h1>
          {project.serialNumber && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{project.serialNumber}</span>}
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)' }}>
          {(project.client || project.operator) && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Building2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />{[project.client, project.operator].filter(Boolean).join(' · ')}</span>}
          {project.code && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Hash className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />{project.code}</span>}
          {project.location && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><MapPin className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />{project.location}</span>}
          {(project.startDate || project.endDate) && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><CalendarRange className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />{[project.startDate, project.endDate].filter(Boolean).join(' → ')}</span>}
        </div>
        {project.description && <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '12px 0 0', lineHeight: 1.5 }}>{project.description}</p>}
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
    </div>
  );
}
