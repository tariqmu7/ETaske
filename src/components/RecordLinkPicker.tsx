// ─── The link picker: attach a task / correspondence to a bid and a project ──
//
// Queue task 4. One control, used by the create-task panel, the task edit form
// and (task 5) the correspondence form, so "what can be linked" is answered in
// exactly one place. It only PICKS — writing the link fields and mirroring the
// history entry stay in src/lib/recordLinks.ts.
//
// ★ These are two closed <select>s, not the app's ComboBox. A ComboBox is
// searchable AND create-capable, and its display text IS its value; a link must
// resolve to an existing `opportunities/{id}` / `projects/{id}`, so a free-typed
// value would be a dangling reference. Every option carries an explicit
// `value={id}`, so no label — Arabic or otherwise — is ever written.
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Opportunity, Project, RecordLinks } from '../types';
import { buildRecordLinks } from '../lib/recordLinks';
import { Link2, Target, Briefcase, Lock } from 'lucide-react';

type OppRow = { id: string; title: string; serialNumber?: string };
type PrjRow = { id: string; name: string; serialNumber?: string };

interface Props {
  value: RecordLinks;
  onChange: (links: RecordLinks) => void;
  /**
   * The opportunity was chosen by the screen the form was opened from (the
   * bid's own Tasks tab), so it is shown but not editable — changing it there
   * would silently move the record off the page the user is standing on.
   */
  lockOpportunity?: boolean;
  /** Skip the listeners entirely while the form is closed. */
  active?: boolean;
  /**
   * Overrides the footer sentence. The default speaks about a task; the
   * correspondence form (task 5) passes its own, already translated — the
   * picker must not have to know which record kind it is sitting in.
   */
  hint?: string;
}

export default function RecordLinkPicker({ value, onChange, lockOpportunity, active = true, hint }: Props) {
  const { t } = useTranslation();
  const [opportunities, setOpportunities] = useState<OppRow[] | null>(null);
  const [projects, setProjects] = useState<PrjRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Unordered reads, sorted client-side: both collections are small, and an
  // orderBy would need an index the rest of the module deliberately avoids.
  useEffect(() => {
    if (!active) return;
    const stopOpp = onSnapshot(query(collection(db, 'opportunities')), snap => {
      setOpportunities(snap.docs
        .filter(d => d.id !== '--stats--')
        .map(d => ({ id: d.id, ...(d.data() as Opportunity) }))
        .map(o => ({ id: o.id, title: o.title, serialNumber: o.serialNumber }))
        .sort((a, b) => (b.serialNumber || '').localeCompare(a.serialNumber || '')));
    }, err => { console.error('link picker / opportunities:', err); setOpportunities([]); setFailed(true); });

    const stopPrj = onSnapshot(query(collection(db, 'projects')), snap => {
      setProjects(snap.docs
        .filter(d => d.id !== '--stats--')
        .map(d => ({ id: d.id, ...(d.data() as Project) }))
        .map(p => ({ id: p.id, name: p.name, serialNumber: p.serialNumber }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    }, err => { console.error('link picker / projects:', err); setProjects([]); setFailed(true); });

    return () => { stopOpp(); stopPrj(); };
  }, [active]);

  // A link whose record is gone (or not loaded yet) still has to be selectable,
  // or opening the form would silently drop it on the next save. The stored
  // label is what makes that possible — that is what it is denormalized for.
  const oppOptions = useMemo(() => {
    const rows = opportunities || [];
    if (value.opportunityId && !rows.some(o => o.id === value.opportunityId)) {
      return [{ id: value.opportunityId, title: value.opportunityTitle || t('Linked opportunity'), serialNumber: value.opportunitySerial }, ...rows];
    }
    return rows;
  }, [opportunities, value.opportunityId, value.opportunityTitle, value.opportunitySerial, t]);

  const prjOptions = useMemo(() => {
    const rows = projects || [];
    if (value.projectId && !rows.some(p => p.id === value.projectId)) {
      return [{ id: value.projectId, name: value.projectName || t('Linked project') }, ...rows];
    }
    return rows;
  }, [projects, value.projectId, value.projectName, t]);

  const pickOpportunity = (id: string) => {
    const picked = oppOptions.find(o => o.id === id);
    onChange(buildRecordLinks(
      picked ? { id: picked.id, title: picked.title, serialNumber: picked.serialNumber } : null,
      value.projectId ? { id: value.projectId, name: value.projectName || '' } : null,
    ));
  };

  const pickProject = (id: string) => {
    const picked = prjOptions.find(p => p.id === id);
    onChange(buildRecordLinks(
      value.opportunityId
        ? { id: value.opportunityId, title: value.opportunityTitle || '', serialNumber: value.opportunitySerial }
        : null,
      picked ? { id: picked.id, name: picked.name } : null,
    ));
  };

  const oppLabel = (o: OppRow) => (o.serialNumber ? `${o.serialNumber} — ${o.title}` : o.title);

  return (
    <div>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Target style={{ width: 12, height: 12 }} />
            {t('Opportunity / Bid')}
            {lockOpportunity && <Lock style={{ width: 11, height: 11, color: 'var(--text-muted)' }} />}
          </label>
          {lockOpportunity ? (
            <div
              className="input"
              style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)', color: 'var(--text-secondary)', cursor: 'not-allowed' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {value.opportunitySerial && <span className="ltr-data" style={{ fontWeight: 700 }}>{value.opportunitySerial}</span>}
                {value.opportunitySerial && ' — '}
                {value.opportunityTitle || t('Linked opportunity')}
              </span>
            </div>
          ) : (
            <select
              className="input"
              value={value.opportunityId || ''}
              onChange={e => pickOpportunity(e.target.value)}
              disabled={opportunities === null}
            >
              <option value="">{t('Not linked to a bid')}</option>
              {oppOptions.map(o => <option key={o.id} value={o.id}>{oppLabel(o)}</option>)}
            </select>
          )}
        </div>

        <div>
          <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Briefcase style={{ width: 12, height: 12 }} />
            {/* "Project record", not "Project": the task form already carries a
                free-text "Sub-Category / Project" classification a few rows
                above, and two adjacent fields called Project read as a bug. */}
            {t('Project record')}
          </label>
          <select
            className="input"
            value={value.projectId || ''}
            onChange={e => pickProject(e.target.value)}
            disabled={projects === null}
          >
            <option value="">{t('Not linked to a project')}</option>
            {prjOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <Link2 style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />
        <span>
          {failed
            ? t('The bid and project lists could not be loaded — an existing link is kept as it is.')
            : (hint || t('Progress on this task is echoed into the history of whatever it is linked to.'))}
        </span>
      </div>
    </div>
  );
}
