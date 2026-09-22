/// <reference types="vite/client" />
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, orderBy,
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { User } from 'firebase/auth';
import {
  AppUser, Opportunity, OpportunityStage, OpportunitySource,
  OPPORTUNITY_STAGE_OPTIONS, OPPORTUNITY_SOURCE_OPTIONS,
  OPEN_OPPORTUNITY_STAGES, CURRENCY_OPTIONS, isOpportunityOpen,
} from './types';
import { getNextSerialNumber } from './lib/counters';
import { globalSearch, getUserColor } from './utils';
import { useDisplayLabel } from './lib/displayLabel';
import { useFormat } from './lib/format';
import { consumePending, subscribeOpen, takeConsumedTab } from './lib/deepLink';
import { consumeCreateIntent, subscribeCreate, type OpportunityPrefill } from './lib/createIntent';
import { recordRecent } from './lib/recents';
import { exportOpportunities } from './lib/exportData';
import { buildChecklist, checklistProgress, defaultTemplateForSource, templatesFor, localToday } from './lib/checklists';
import { findSimilarBids } from './lib/duplicates';
import { checkGate, crossesGate, approvalState, waitingForSignOff, isManagerRole, type GateProblem, type GateResult } from './lib/offerApproval';
import {
  Plus, X, Target, Building2, CalendarClock,
  Trash2, Edit2, AlertCircle, User as UserIcon, BarChart3,
  FileSpreadsheet, Loader2, Layers, ListChecks, MapPin, Inbox, ArrowLeft, ShieldCheck, Clock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppView } from './App';
import { motion, AnimatePresence } from 'motion/react';
import OpportunityDetail from './OpportunityDetail';
import GroupByBar, { GroupByOption } from './components/GroupByBar';
import BoardToolbar from './components/BoardToolbar';
import GroupGrid, { GroupCard } from './components/GroupGrid';
import CardMenu from './components/CardMenu';
import { buildGroups, UNGROUPED } from './lib/grouping';
import { STAGE_COLORS, toNumber, money, daysUntil } from './components/opportunities/opportunityUi';

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate?: (v: AppView) => void;
}

/**
 * The dimension the bid grid is bucketed by — the fourth and last board to grow
 * the shared control (see `components/GroupByBar.tsx`).
 *
 * Like a Project and unlike a Task or a Corresponding, an Opportunity OWNS its
 * `location`, so this board needs no extra listener either. `owner` is the bid
 * owner, and the record stores `ownerName` next to `ownerId` (the module's
 * denormalisation rule), so the bucket key needs no `projectUsers` lookup at
 * all — the projects board had to resolve one.
 */
type OpportunityGroupBy = 'stage' | 'location' | 'source' | 'owner';

/**
 * Bucket order for `groupBy === 'stage'`. `OPPORTUNITY_STAGE_OPTIONS` is already
 * the pipeline order (Identified → … → Won/Lost), so it is reused rather than
 * restated — the same reason the projects board reuses its status options.
 */
const OPPORTUNITY_STAGE_GROUP_ORDER: readonly OpportunityStage[] = OPPORTUNITY_STAGE_OPTIONS;

/**
 * Avatar glyph for the dimensions that have no person to show a face for. Same
 * three-of-four shape as the other boards: only `owner` draws a photo/initial.
 * The glyphs are the ones `groupByOptions` already puts on the control, so a
 * dimension reads the same in the picker and on its cards.
 */
const OPPORTUNITY_GROUP_ICON: Partial<Record<OpportunityGroupBy, LucideIcon>> = {
  stage: ListChecks,
  location: MapPin,
  source: Inbox,
};

const emptyForm = () => ({
  title: '',
  client: '',
  sector: '',
  location: '',
  tenderNumber: '',
  source: 'Public Tender' as OpportunitySource,
  scope: '',
  stage: 'Identified' as OpportunityStage,
  probability: '',
  estimatedValue: '',
  currency: 'EGP',
  announcedDate: '',
  submissionDeadline: '',
  submittedDate: '',
  decisionDate: '',
  ownerId: '',
  awardedTo: '',
  awardedValue: '',
  nextActionDate: '',
});

export default function OpportunitiesDashboard({ user, appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const dl = useDisplayLabel();
  const fmt = useFormat();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'deadline' | 'value' | 'recent' | 'stage'>('deadline');
  const [groupBy, setGroupBy] = useState<OpportunityGroupBy>('stage');
  /** `null` = the group grid is showing; a key = that bucket is drilled into. */
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [formData, setFormData] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Queue C3 — which standard checklist a NEW bid starts with. `null` = follow
  // the source (tender → full list, direct order → quick quotation) until the
  // user picks one; 'none' = start empty.
  const [checklistChoice, setChecklistChoice] = useState<string | null>(null);
  const checklistKey = checklistChoice ?? defaultTemplateForSource(formData.source);
  const [deleteTarget, setDeleteTarget] = useState<Opportunity | null>(null);
  // Detail page is keyed by id, not by the object, so the open page keeps
  // following the live snapshot instead of freezing on a stale copy.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  // Queue D6: a link may name the tab to land on (an earlier bid opens on 'decisions').
  const [openTab, setOpenTab] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const canDelete = appUser.role === 'Admin' || appUser.role === 'Manager';

  // Queue D8 — "this looks like a bid we already have", read as the form is typed.
  const similarBids = useMemo(
    () => (isModalOpen
      ? findSimilarBids({
          title: formData.title, client: formData.client,
          tenderNumber: formData.tenderNumber, submissionDeadline: formData.submissionDeadline,
        }, opportunities, editing?.id)
      : []),
    [isModalOpen, formData.title, formData.client, formData.tenderNumber, formData.submissionDeadline, opportunities, editing?.id],
  );
  const today = localToday();

  // Queue D10 — offers waiting for a manager, shown to managers above the board.
  const isManager = isManagerRole(appUser.role);
  const waiting = useMemo(() => (isManager ? waitingForSignOff(opportunities, Date.now()) : []), [isManager, opportunities]);

  useEffect(() => {
    const q = query(collection(db, 'opportunities'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setOpportunities(
        snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Opportunity))
      );
      setLoading(false);
    }, err => {
      console.error('Opportunities listener error:', err, { uid: auth.currentUser?.uid });
      setError(t('Failed to load opportunities.'));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const stats = useMemo(() => {
    const open = opportunities.filter(o => isOpportunityOpen(o.stage));
    const won = opportunities.filter(o => o.stage === 'Won');
    const lost = opportunities.filter(o => o.stage === 'Lost');
    const decided = won.length + lost.length;
    // Weighted pipeline: value x probability. A missing probability is read as
    // 0 rather than 100 so an unassessed bid never inflates the forecast.
    const weighted = open.reduce((sum, o) => sum + toNumber(o.estimatedValue) * ((o.probability ?? 0) / 100), 0);
    const openValue = open.reduce((sum, o) => sum + toNumber(o.estimatedValue), 0);
    const dueSoon = open.filter(o => {
      const d = daysUntil(o.submissionDeadline);
      return d !== null && d >= 0 && d <= 7;
    }).length;
    const overdue = open.filter(o => {
      const d = daysUntil(o.submissionDeadline);
      return d !== null && d < 0;
    }).length;
    return {
      open: open.length,
      openValue,
      weighted,
      winRate: decided ? Math.round((won.length / decided) * 100) : null,
      won: won.length,
      lost: lost.length,
      dueSoon,
      overdue,
    };
  }, [opportunities]);

  // The dominant currency across the board — the KPI tiles sum mixed currencies
  // naively, so label them with the one actually in use most.
  const mainCurrency = useMemo(() => {
    const counts: Record<string, number> = {};
    opportunities.forEach(o => { if (o.currency) counts[o.currency] = (counts[o.currency] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'EGP';
  }, [opportunities]);

  const stageRank = useMemo(() => {
    const rank: Record<string, number> = {};
    OPPORTUNITY_STAGE_OPTIONS.forEach((s, i) => { rank[s] = i; });
    return rank;
  }, []);

  const visible = useMemo(() => {
    const rows = opportunities.filter(o => {
      if (stageFilter === 'Open' && !isOpportunityOpen(o.stage)) return false;
      if (stageFilter !== 'All' && stageFilter !== 'Open' && o.stage !== stageFilter) return false;
      if (search && !globalSearch(o, search)) return false;
      return true;
    });
    rows.sort((a, b) => {
      if (sortBy === 'value') return toNumber(b.estimatedValue) - toNumber(a.estimatedValue);
      if (sortBy === 'stage') return (stageRank[a.stage] ?? 99) - (stageRank[b.stage] ?? 99);
      if (sortBy === 'deadline') {
        // Opportunities without a deadline sink to the bottom instead of
        // hijacking the top of the list.
        const av = a.submissionDeadline || '9999-12-31';
        const bv = b.submissionDeadline || '9999-12-31';
        return av.localeCompare(bv);
      }
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });
    return rows;
  }, [opportunities, search, stageFilter, sortBy, stageRank]);

  const isFiltering = search.trim() !== '' || stageFilter !== 'All';

  // What a bid's group key is, per dimension. An empty string sends the row to
  // the trailing "no value" bucket (`UNGROUPED`). `ownerName` is the stored
  // denormalised label, so no user lookup is needed here.
  const groupKeyOf = useMemo(() => {
    switch (groupBy) {
      case 'stage': return (o: Opportunity) => o.stage;
      case 'location': return (o: Opportunity) => o.location;
      case 'source': return (o: Opportunity) => o.source;
      case 'owner': return (o: Opportunity) => o.ownerName;
    }
  }, [groupBy]);

  // Buckets over the already-sorted list. As on the projects board, no `sort` is
  // passed: this board has its own sort select (deadline / value / stage /
  // recent) and forcing an order inside a bucket would make that control dead —
  // "Submission deadline", its default, already IS soonest-due-first.
  const groupedOpportunities = useMemo(
    () => buildGroups(visible, groupKeyOf, {
      order: groupBy === 'stage' ? OPPORTUNITY_STAGE_GROUP_ORDER : undefined,
    }),
    [visible, groupKeyOf, groupBy],
  );

  // The open bucket, re-resolved from `groupedOpportunities` every render: a
  // filter (or someone else's edit arriving over the listener) can empty the
  // bucket the user drilled into, and then `find` returns undefined and we fall
  // back to the grid instead of painting a blank section.
  const activeGroup = useMemo(
    () => (openGroup ? groupedOpportunities.find(g => g.key === openGroup) : undefined),
    [openGroup, groupedOpportunities],
  );

  // Switching dimension re-buckets everything, so the key that was open no
  // longer means anything.
  useEffect(() => { setOpenGroup(null); }, [groupBy]);

  // Grouping IS the grid: no open card means no bid cards at all. There is no
  // deep-link bypass to build here — an opened opportunity (including one
  // arriving through `pendingOpenId`) renders `OpportunityDetail` in place of
  // the whole board, above any of this.
  const showGroupGrid = !activeGroup;

  // What the list renders: the open bucket only. This board has no pager, so
  // unlike the tasks/correspondences boards there is nothing else to re-scope.
  const renderGroups = useMemo(
    () => (activeGroup ? [activeGroup] : []),
    [activeGroup],
  );

  // Header for one bucket. Each dimension gets its own phrasing because a single
  // "{{x}} Opportunities" template reads wrong for half of them.
  const groupHeading = (group: { key: string; value: string }) => {
    if (group.key === UNGROUPED) {
      switch (groupBy) {
        case 'location': return t('No location');
        case 'source': return t('No source');
        case 'owner': return t('No owner');
        default: return t('Uncategorized');
      }
    }
    const name = dl(group.value);
    switch (groupBy) {
      case 'location': return t('Location: {{name}}', { name });
      case 'source': return t('Source: {{name}}', { name });
      case 'owner': return t('Owner: {{name}}', { name });
      default: return t('{{stage}} Opportunities', { stage: name });
    }
  };

  // The card title is the group's NAME on its own — the "Source: …" / "Owner: …"
  // framing belongs on the drilled-in section header, not under a 44px avatar
  // that already says whose card this is.
  const groupTitle = (group: { key: string; value: string }) =>
    group.key === UNGROUPED ? groupHeading(group) : dl(group.value);

  // What the grid draws. One card per bucket. The "small info" a bid pipeline
  // actually turns on is MONEY, so unlike the projects board the subtitle is the
  // bucket's open value rather than a role — a card that says "4 opportunities"
  // without saying what they are worth tells a bid manager nothing.
  const groupCards = useMemo<GroupCard[]>(() => groupedOpportunities.map(group => {
    const rows = group.items;
    const open = rows.filter(o => isOpportunityOpen(o.stage));
    const won = rows.filter(o => o.stage === 'Won').length;
    const lost = rows.filter(o => o.stage === 'Lost').length;
    // Value of what is still live in this bucket. Mixed currencies are summed
    // naively and labelled with `mainCurrency`, exactly as the KPI tiles at the
    // top of this board already do.
    const openValue = open.reduce((sum, o) => sum + toNumber(o.estimatedValue), 0);
    // "Late" = the submission deadline has passed on a bid still open. A Won,
    // Lost, No Bid or Cancelled record cannot miss a deadline any more.
    const late = open.filter(o => {
      const d = daysUntil(o.submissionDeadline);
      return d !== null && d < 0;
    }).length;

    // The bucket key for `owner` is `ownerName` (the module's denormalised
    // label), so no lookup is needed to LABEL the card — but a face still is.
    // Resolve it through a row's `ownerId`, not by matching the display name:
    // two people can share one name.
    const isPerson = groupBy === 'owner';
    const ownerId = isPerson ? rows.find(o => o.ownerId)?.ownerId : undefined;
    const owner = ownerId ? projectUsers.find(pu => pu.id === ownerId) : undefined;
    const title = groupTitle(group);

    return {
      key: group.key,
      title,
      subtitle: open.length > 0 ? t('{{value}} open', { value: money(openValue, mainCurrency) }) : undefined,
      accent: groupBy === 'stage'
        ? STAGE_COLORS[group.value as OpportunityStage] || 'var(--accent)'
        : isPerson
          ? (owner?.userColor || getUserColor(ownerId || group.value || group.key))
          : getUserColor(group.key),
      photoURL: isPerson ? owner?.photoURL : undefined,
      // A person gets an initial; a stage/location/source gets the dimension's
      // icon, so the card still reads as "a thing of this kind".
      initial: isPerson ? title.charAt(0).toUpperCase() : undefined,
      icon: isPerson ? undefined : OPPORTUNITY_GROUP_ICON[groupBy],
      count: rows.length,
      countLabel: rows.length === 1 ? t('opportunity') : t('opportunities'),
      badge: late > 0 ? `${late} ${t('OVERDUE')}` : undefined,
      // Grouping BY stage already puts the stage in the title, so repeating the
      // outcome chips under it would be pure noise.
      stats: groupBy === 'stage' ? undefined : [
        { label: t('live'), value: open.length, tone: 'info' as const },
        { label: dl('Won'), value: won, tone: 'success' as const },
        { label: dl('Lost'), value: lost, tone: 'warn' as const },
      ],
    };
  }), [groupedOpportunities, groupBy, projectUsers, mainCurrency, dl, t]);

  const groupByOptions = useMemo<GroupByOption<OpportunityGroupBy>[]>(() => [
    { key: 'stage', label: t('Stage'), icon: ListChecks },
    { key: 'location', label: t('Location'), icon: MapPin },
    { key: 'source', label: t('Source'), icon: Inbox },
    { key: 'owner', label: t('Owner'), icon: UserIcon },
  ], [t]);

  const openCreate = () => {
    setEditing(null);
    setFormData({ ...emptyForm(), ownerId: appUser.id, currency: mainCurrency });
    setFormError(null);
    setChecklistChoice(null);
    setIsModalOpen(true);
  };

  // Outlook Feed → "yes, make that bid" (src/lib/createIntent.ts). Same two-step
  // as the deep link above: take the intent parked before the view switched, and
  // also listen while mounted. It only ever OPENS the form prefilled — the user
  // still presses Save, so a wrong guess costs nothing.
  useEffect(() => {
    const apply = (p: OpportunityPrefill) => {
      setEditing(null);
      setFormError(null);
      setSelectedId(null);
      setFormData({
        ...emptyForm(),
        ownerId: appUser.id,
        currency: mainCurrency,
        title: p.title || '',
        client: p.client || '',
        tenderNumber: p.tenderNumber || '',
        submissionDeadline: p.submissionDeadline || '',
        scope: p.scope || '',
      });
      setChecklistChoice(null);
      setIsModalOpen(true);
    };
    const initial = consumeCreateIntent('opportunity');
    if (initial) apply(initial);
    return subscribeCreate(intent => {
      if (intent.type === 'opportunity') apply(intent.prefill);
    });
  }, [appUser.id, mainCurrency]);

  const openEdit = (o: Opportunity) => {
    setEditing(o);
    setFormError(null);
    setFormData({
      title: o.title || '',
      client: o.client || '',
      sector: o.sector || '',
      location: o.location || '',
      tenderNumber: o.tenderNumber || '',
      source: o.source || 'Public Tender',
      scope: o.scope || '',
      stage: o.stage || 'Identified',
      // null as well as undefined: handleSave writes null for a blank number, so
      // checking undefined alone made the next edit read back "null" and save NaN.
      probability: o.probability === undefined || o.probability === null ? '' : String(o.probability),
      estimatedValue: o.estimatedValue === undefined || o.estimatedValue === null ? '' : String(o.estimatedValue),
      currency: o.currency || mainCurrency,
      announcedDate: o.announcedDate || '',
      submissionDeadline: o.submissionDeadline || '',
      submittedDate: o.submittedDate || '',
      decisionDate: o.decisionDate || '',
      ownerId: o.ownerId || '',
      awardedTo: o.awardedTo || '',
      awardedValue: o.awardedValue === undefined || o.awardedValue === null ? '' : String(o.awardedValue),
      nextActionDate: o.nextActionDate || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    const title = formData.title.trim();
    if (!title) { setFormError(t('Opportunity title is required.')); return; }
    const probability = formData.probability === '' ? undefined : Number(formData.probability);
    if (probability !== undefined && (!isFinite(probability) || probability < 0 || probability > 100)) {
      setFormError(t('Probability must be between 0 and 100.'));
      return;
    }
    // Never let a non-numeric entry reach Firestore as NaN — it poisons every
    // pipeline/weighted-value total that sums estimatedValue.
    const estimatedValue = formData.estimatedValue === '' ? null : Number(formData.estimatedValue);
    const awardedValue = formData.awardedValue === '' ? null : Number(formData.awardedValue);
    if ((estimatedValue !== null && !isFinite(estimatedValue)) ||
        (awardedValue !== null && !isFinite(awardedValue))) {
      setFormError(t('Estimated value and awarded value must be numbers.'));
      return;
    }
    if (formData.announcedDate && formData.submissionDeadline &&
        formData.submissionDeadline < formData.announcedDate) {
      setFormError(t('Submission deadline cannot be before the announcement date.'));
      return;
    }
    const owner = projectUsers.find(u => u.id === formData.ownerId);
    // Queue D10 — an offer does not go out without a manager's sign-off. A
    // manager is never stopped: the save records them as the approver.
    const gate: GateResult = editing
      ? checkGate(editing, { stage: formData.stage, estimatedValue, currency: formData.currency },
          { id: appUser.id, name: appUser.displayName || appUser.email || '—', role: appUser.role }, Date.now())
      : { ok: true };
    if ('problem' in gate) { setFormError(gateMessage(gate.problem)); return; }
    const payload = {
      title,
      client: formData.client.trim(),
      sector: formData.sector.trim(),
      location: formData.location.trim(),
      tenderNumber: formData.tenderNumber.trim(),
      source: formData.source,
      scope: formData.scope.trim(),
      stage: formData.stage,
      probability: probability ?? null,
      estimatedValue,
      currency: formData.currency,
      announcedDate: formData.announcedDate,
      submissionDeadline: formData.submissionDeadline,
      submittedDate: formData.submittedDate,
      decisionDate: formData.decisionDate,
      ownerId: formData.ownerId,
      ownerName: owner?.displayName || '',
      awardedTo: formData.awardedTo.trim(),
      awardedValue,
      nextActionDate: formData.nextActionDate,
    };
    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      if (editing) {
        await updateDoc(doc(db, 'opportunities', editing.id), {
          ...payload,
          ...('approval' in gate && gate.approval ? { approval: gate.approval } : {}),
          updatedAt: serverTimestamp(),
        });
      } else {
        const serialNumber = await getNextSerialNumber('opportunities');
        await addDoc(collection(db, 'opportunities'), {
          ...payload,
          // Written once, at birth; afterwards the Checklist tab owns it.
          checklist: buildChecklist(checklistKey, payload.submissionDeadline, localToday()),
          serialNumber,
          userId: user.uid,
          teamId: appUser.teamId || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setIsModalOpen(false);
      setEditing(null);
    } catch (e) {
      console.error('Save opportunity failed:', e);
      setFormError(t('Failed to save opportunity. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'opportunities', deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      console.error('Delete opportunity failed:', e);
      setError(t('Failed to delete opportunity. Only managers and admins can delete.'));
      setDeleteTarget(null);
    }
  };

  const closedOutcome = formData.stage === 'Lost' || formData.stage === 'Won';

  function gateMessage(p: GateProblem) {
    switch (p) {
      case 'pending': return t('This offer is still waiting for a manager’s sign-off. It can be marked as sent once a manager approves it.');
      case 'returned': return t('A manager sent this offer back. Fix it and ask for sign-off again on the bid page.');
      case 'price-changed': return t('The price changed after the manager approved it. Ask for sign-off again on the bid page.');
      default: return t('This offer needs a manager’s sign-off before it can be marked as sent. Save it at its current stage and use “Ask for sign-off” on the bid page.');
    }
  }
  // Shown under the Stage select while it points past the gate.
  const stageNote = (() => {
    if (!editing || !crossesGate(editing.stage, formData.stage)) return null;
    const next = {
      approval: editing.approval,
      estimatedValue: formData.estimatedValue === '' ? null : Number(formData.estimatedValue),
      currency: formData.currency,
    };
    if (approvalState(next) === 'approved') return { ok: true, text: t('Signed off by {{name}} — it can go out.', { name: editing.approval?.decidedByName || '—' }) };
    if (isManagerRole(appUser.role)) return { ok: true, text: t('No sign-off on it yet — saving records you as the approver.') };
    return { ok: false, text: t('Needs a manager’s sign-off first.') };
  })();

  // Export is deliberately the WHOLE pipeline, not the filtered view: the
  // workbook is a record of the bid book, and a sheet that silently reflected a
  // search box would be misread as complete. Filtering belongs in Excel.
  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const r = await exportOpportunities();
      setExportNote(t('Saved {{file}} — {{opportunities}} opportunities, {{feedback}} outcomes, {{milestones}} bid gates, {{followUps}} follow-ups.', {
        file: r.fileName, opportunities: r.opportunities, feedback: r.feedback,
        milestones: r.milestones, followUps: r.followUps,
      }));
    } catch (e) {
      console.error('Export opportunities failed:', e);
      setError(t('Export failed. Please try again.'));
    } finally {
      setExporting(false);
    }
  };

  // Opening a bid also feeds Home's "Jump back in" list, exactly like a task or
  // a correspondence.
  const openOpportunity = (o: Opportunity) => {
    setSelectedId(o.id);
    setOpenTab(null);
    recordRecent({ kind: 'opportunity', id: o.id, label: o.title, serial: o.serialNumber });
  };

  // Deep link — a bid-deadline notification ("#/opportunities?open=<id>") or a
  // command-palette hit. Same two-step as TasksDashboard: the id is parked until
  // the snapshot carrying it has arrived, so a cold load still lands on the bid.
  useEffect(() => {
    const initial = consumePending('opportunity');
    if (initial) { setPendingOpenId(initial); setOpenTab(takeConsumedTab()); }
    return subscribeOpen(ref => {
      if (ref.type === 'opportunity') { setPendingOpenId(ref.id); setOpenTab(ref.tab ?? null); }
    });
  }, []);

  useEffect(() => {
    if (!pendingOpenId) return;
    const match = opportunities.find(o => o.id === pendingOpenId);
    if (!match) {
      // Still loading — wait. Once loaded and still absent, the record is gone
      // (deleted), so stop waiting rather than parking the id forever.
      if (!loading) setPendingOpenId(null);
      return;
    }
    setSelectedId(match.id);
    recordRecent({ kind: 'opportunity', id: match.id, label: match.title, serial: match.serialNumber });
    setPendingOpenId(null);
  }, [pendingOpenId, opportunities, loading]);

  const selected = selectedId ? opportunities.find(o => o.id === selectedId) || null : null;
  // A deleted (or filtered-away) record must not leave the page on a ghost.
  useEffect(() => {
    if (selectedId && !loading && !opportunities.some(o => o.id === selectedId)) setSelectedId(null);
  }, [selectedId, opportunities, loading]);

  return (
    <div className={selected ? undefined : 'board-page'} style={selected ? { maxWidth: 'none', margin: 0, padding: 0 } : { maxWidth: 1280, margin: '0 auto', padding: '24px 16px' }}>
      {selected ? (
        <OpportunityDetail
          key={`${selected.id}:${openTab || ''}`}
          opportunity={selected}
          user={user}
          appUser={appUser}
          projectUsers={projectUsers}
          initialTab={openTab || undefined}
          onBack={() => { setSelectedId(null); setOpenTab(null); }}
          onEdit={() => openEdit(selected)}
          onNavigate={onNavigate}
        />
      ) : (
      <>
      {/* Header */}
      <div className="board-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="board-head-icon" style={{ padding: 10, background: 'rgba(59,130,246,0.1)', color: 'var(--accent)' }}>
            <Target className="w-6 h-6" />
          </div>
          <div>
            <h1 className="board-head-title" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{t('Opportunities')}</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {opportunities.length === 1
                ? t('{{count}} opportunity · {{open}} open', { count: 1, open: stats.open })
                : t('{{count}} opportunities · {{open}} open', { count: opportunities.length, open: stats.open })}
            </p>
          </div>
        </div>
        <button className="btn btn-primary board-head-action" onClick={openCreate} aria-label={t('New Opportunity')} title={t('New Opportunity')}>
          <Plus className="w-4 h-4" /> <span className="board-head-label">{t('New Opportunity')}</span>
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fee2e2', color: '#991b1b', marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {exportNote && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)', marginBottom: 16, fontSize: 13 }}>
          <FileSpreadsheet className="w-4 h-4" style={{ flexShrink: 0, color: 'var(--accent)' }} />
          <span style={{ flex: 1 }}>{exportNote}</span>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setExportNote(null)} title={t('Dismiss')}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="card" data-approval="waiting" style={{ padding: '12px 14px', marginBottom: 16, borderInlineStart: '3px solid #f59e0b', background: 'rgba(245,158,11,0.06)' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
            <ShieldCheck className="w-4 h-4" style={{ color: '#b45309' }} />
            {waiting.length === 1 ? t('1 offer waiting for your sign-off') : t('{{count}} offers waiting for your sign-off', { count: waiting.length })}
          </h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {waiting.map(w => (
              <li key={w.id}>
                <button
                  type="button"
                  data-approval="waiting-row"
                  onClick={() => { const o = opportunities.find(x => x.id === w.id); if (o) openOpportunity(o); }}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'baseline', width: '100%', textAlign: 'start', background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-secondary)', borderTop: '1px solid var(--border)' }}
                >
                  {w.serial && <span className="ltr-data" style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{w.serial}</span>}
                  <bdi style={{ fontWeight: 700, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{w.title}</bdi>
                  <span className="ltr-data" style={{ fontWeight: 700 }}>{w.amount === null ? '—' : money(toNumber(w.amount), w.currency)}</span>
                  <span>
                    <bdi>{w.requestedByName}</bdi>{' · '}
                    {w.ageDays === 0 ? t('asked today') : w.ageDays === 1 ? t('asked yesterday') : t('asked {{count}} days ago', { count: w.ageDays })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* KPI strip */}
      {opportunities.length > 0 && (
        <div className="board-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
          {[
            { key: 'open', label: t('Open'), value: String(stats.open), sub: t('in pipeline'), filter: 'Open', color: 'var(--text-primary)' },
            { key: 'value', label: t('Pipeline value'), value: money(stats.openValue, mainCurrency), sub: t('open bids'), filter: 'Open', color: '#3b82f6' },
            { key: 'weighted', label: t('Weighted'), value: money(stats.weighted, mainCurrency), sub: t('value × probability'), filter: 'Open', color: '#8b5cf6' },
            { key: 'winrate', label: t('Win rate'), value: stats.winRate === null ? '—' : fmt.percent(stats.winRate), sub: t('{{won}}W / {{lost}}L', { won: stats.won, lost: stats.lost }), filter: 'Won', color: '#16a34a' },
            { key: 'duesoon', label: t('Due ≤ 7 days'), value: String(stats.dueSoon), sub: t('{{count}} past deadline', { count: stats.overdue }), filter: 'Open', color: stats.overdue > 0 ? '#dc2626' : '#f59e0b' },
          ].map(s => {
            const active = stageFilter === s.filter;
            return (
              <button
                key={s.key}
                onClick={() => setStageFilter(active ? 'All' : s.filter)}
                className="card board-kpi"
                style={{ padding: '12px 14px', textAlign: 'start', cursor: 'pointer', border: active ? '1px solid var(--accent)' : '1px solid var(--border)', background: active ? 'rgba(59,130,246,0.08)' : 'var(--surface)' }}
              >
                <div className={`${fmt.bidiFor(s.value)} board-kpi-value`} style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
                <div className="board-kpi-label" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 4 }}>{s.label}</div>
                <div className="board-kpi-sub" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.sub}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* One toolbar row: search + Group by + the rest folded into `Filters`,
          with Export/Analytics demoted here so the header carries exactly one
          action — New Opportunity. */}
      <BoardToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t('Search opportunities…')}
        groupBy={<GroupByBar<OpportunityGroupBy> value={groupBy} onChange={setGroupBy} options={groupByOptions} />}
        activeFilterCount={(stageFilter !== 'All' ? 1 : 0) + (sortBy !== 'deadline' ? 1 : 0)}
        onClearFilters={() => { setStageFilter('All'); setSortBy('deadline'); }}
        filters={
          <>
            <select
              value={stageFilter}
              onChange={e => setStageFilter(e.target.value)}
              style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit' }}
            >
              <option value="All">{t('All stages')}</option>
              <option value="Open">{t('Open only')}</option>
              {OPPORTUNITY_STAGE_OPTIONS.map(s => <option key={s} value={s}>{dl(s)}</option>)}
            </select>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
              style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit' }}
              title={t('Sort opportunities')}
            >
              <option value="deadline">{t('Submission deadline')}</option>
              <option value="value">{t('Value (high → low)')}</option>
              <option value="stage">{t('Stage')}</option>
              <option value="recent">{t('Most recent')}</option>
            </select>
          </>
        }
        secondary={
          <>
            <button
              className="btn btn-ghost"
              onClick={handleExport}
              disabled={exporting}
              title={t('Download the pipeline, outcomes, bid gates and follow-ups as one Excel workbook')}
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              {exporting ? t('Exporting…') : t('Export')}
            </button>
            {onNavigate && (appUser.role === 'Admin' || appUser.role === 'Manager') && (
              <button className="btn btn-ghost" onClick={() => onNavigate('bid-analytics')} title={t('Win rate, loss reasons and pipeline analysis')}>
                <BarChart3 className="w-4 h-4" /> {t('Analytics')}
              </button>
            )}
          </>
        }
      />

      {/* Grid */}
      {loading ? (
        <div className="card-grid">
          {[0, 1, 2].map(i => <div key={i} className="card skeleton" style={{ height: 190 }} />)}
        </div>
      ) : showGroupGrid ? (
        // Grouping IS the grid: one card per bucket, and the bid cards only
        // appear once a card is opened. `groupCards` is built from every visible
        // opportunity, so the counts and values are the real totals.
        <GroupGrid
          cards={groupCards}
          onSelect={setOpenGroup}
          empty={
            <div className="empty-state">
              <div className="empty-state-icon"><Target className="w-8 h-8" /></div>
              <div className="empty-state-title">{isFiltering ? t('No matching opportunities') : t('No opportunities yet')}</div>
              <div className="empty-state-sub">
                {isFiltering
                  ? t('No opportunities match your search or filter. Try clearing them.')
                  : t('Add your first tender or bid to start tracking the pipeline, deadlines and win rate.')}
              </div>
              {isFiltering ? (
                <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => { setSearch(''); setStageFilter('All'); }}>
                  {t('Clear filters')}
                </button>
              ) : (
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openCreate}>
                  <Plus className="w-4 h-4" /> {t('New Opportunity')}
                </button>
              )}
            </div>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* The only way back to the grid. */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setOpenGroup(null)}
            style={{ alignSelf: 'flex-start' }}
          >
            <ArrowLeft className="w-4 h-4" /> {t('All Groups')}
          </button>
          {renderGroups.map(group => (
          <div key={group.key}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, paddingInlineStart: 4 }}>
              <Layers className="w-4 h-4 text-accent" />
              {groupHeading(group)}
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginInlineStart: 'auto', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 0 }}>{group.items.length}</span>
            </h2>
            <div className="card-grid">
          <AnimatePresence>
            {group.items.map(o => {
              const dLeft = daysUntil(o.submissionDeadline);
              const showCountdown = isOpportunityOpen(o.stage) && dLeft !== null;
              const late = showCountdown && (dLeft as number) < 0;
              const soon = showCountdown && (dLeft as number) >= 0 && (dLeft as number) <= 7;
              // Read off the bid itself (settled rule 1) — no extra query per card.
              const steps = isOpportunityOpen(o.stage) ? checklistProgress(o.checklist, today) : null;
              return (
                <motion.div
                  key={o.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="card card-interactive"
                  style={{ padding: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10, borderInlineStart: `3px solid ${STAGE_COLORS[o.stage] || 'var(--border)'}` }}
                  onClick={() => openOpportunity(o)}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', color: '#fff', background: STAGE_COLORS[o.stage] || '#64748b' }}>
                      {dl(o.stage)}
                    </span>
                    {o.approval?.status === 'requested' && isOpportunityOpen(o.stage) && (
                      <span data-approval="card-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#b45309', marginInlineStart: 'auto' }}>
                        <Clock className="w-3.5 h-3.5" /> {t('Awaiting sign-off')}
                      </span>
                    )}
                    <CardMenu items={[
                      { label: t('Edit'), icon: <Edit2 className="w-3.5 h-3.5" />, onClick: () => openEdit(o) },
                      ...(canDelete ? [{ label: t('Delete'), icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => setDeleteTarget(o), danger: true }] : []),
                    ]} />
                  </div>

                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0, lineHeight: 1.3 }}>{o.title}</h3>
                    {o.serialNumber && (
                      <span className="ltr-data" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{o.serialNumber}</span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {o.client && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Building2 className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /> {o.client}{o.sector ? ` · ${o.sector}` : ''}</div>}
                    {o.ownerName && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UserIcon className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /> {o.ownerName}</div>}
                    {showCountdown && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: late ? '#dc2626' : soon ? '#f59e0b' : 'var(--text-secondary)', fontWeight: late || soon ? 700 : 400 }}>
                        <CalendarClock className="w-3.5 h-3.5" />
                        {late
                          ? t('{{count}}d past deadline', { count: Math.abs(dLeft as number) })
                          : (dLeft === 0 ? t('Due today') : t('{{count}}d to deadline', { count: dLeft as number }))}
                      </div>
                    )}
                    {steps && steps.total > 0 && (
                      <div data-testid="opp-card-checklist" style={{ display: 'flex', alignItems: 'center', gap: 6, color: steps.late > 0 ? '#dc2626' : 'var(--text-secondary)', fontWeight: steps.late > 0 ? 700 : 400 }}>
                        <ListChecks className="w-3.5 h-3.5" />
                        <span>
                          {t('{{done}}/{{total}} steps', { done: steps.done, total: steps.total })}
                          {steps.late > 0 && ` · ${steps.late === 1 ? t('{{count}} step overdue', { count: 1 }) : t('{{count}} steps overdue', { count: steps.late })}`}
                        </span>
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 6 }}>
                    <span className="ltr-data" style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
                      {o.estimatedValue ? money(toNumber(o.estimatedValue), o.currency) : '—'}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
            </div>
          </div>
          ))}
        </div>
      )}

      </>
      )}

      {/* Create / Edit modal — kept outside the list/detail switch so "Edit
          opportunity" works from the detail page too. */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 620, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                {editing ? t('Edit Opportunity') : t('New Opportunity')}
              </h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setIsModalOpen(false)}><X className="w-5 h-5" /></button>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              <Field label={t('Title *')}>
                <input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} className="opp-input" placeholder={t('e.g. EGPC Turnaround Services Tender 2026')} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label={t('Client')}><input value={formData.client} onChange={e => setFormData({ ...formData, client: e.target.value })} className="opp-input" placeholder={t('e.g. EGPC')} /></Field>
                <Field label={t('Sector')}><input value={formData.sector} onChange={e => setFormData({ ...formData, sector: e.target.value })} className="opp-input" placeholder={t('e.g. Refining')} /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label={t('Tender / RFQ number')}><input value={formData.tenderNumber} onChange={e => setFormData({ ...formData, tenderNumber: e.target.value })} className="opp-input" /></Field>
                <Field label={t('Source')}>
                  <select value={formData.source} onChange={e => setFormData({ ...formData, source: e.target.value as OpportunitySource })} className="opp-input">
                    {OPPORTUNITY_SOURCE_OPTIONS.map(s => <option key={s} value={s}>{dl(s)}</option>)}
                  </select>
                </Field>
              </div>
              {similarBids.length > 0 && (
                <div role="status" data-testid="opp-similar" style={{ padding: '10px 12px', background: '#fef3c7', border: '1px solid #fcd34d', color: '#78350f', fontSize: 12.5 }}>
                  <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, margin: '0 0 6px' }}>
                    <AlertCircle className="w-4 h-4" style={{ flexShrink: 0 }} />
                    {similarBids.some(h => h.strength === 'certain')
                      ? t('This tender is already on the board:')
                      : t('This may already be on the board:')}
                  </p>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {similarBids.map(h => (
                      <li key={h.record.id} data-testid="opp-similar-row" style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 }}>
                        {h.record.serial && <span className="ltr-data" style={{ fontWeight: 700 }}>{h.record.serial}</span>}
                        <bdi style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{h.record.title}</bdi>
                        <span style={{ opacity: 0.85 }}>
                          {[h.record.party, h.record.ownerName, h.record.status ? dl(h.record.status) : '']
                            .filter(Boolean).map((part, i) => <React.Fragment key={i}>{i > 0 && ' · '}<bdi>{part}</bdi></React.Fragment>)}
                        </span>
                        <button
                          type="button"
                          data-testid="opp-similar-open"
                          onClick={() => { setIsModalOpen(false); setEditing(null); setSelectedId(h.record.id); }}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color: 'var(--blue-600)' }}
                        >
                          {t('Open it')}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p style={{ margin: '6px 0 0', opacity: 0.85 }}>{t('If it is the same tender, open it instead of creating a second copy. If it is a new one, carry on.')}</p>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label={t('Stage')}>
                  <select value={formData.stage} onChange={e => setFormData({ ...formData, stage: e.target.value as OpportunityStage })} className="opp-input">
                    {OPPORTUNITY_STAGE_OPTIONS.map(s => <option key={s} value={s}>{dl(s)}</option>)}
                  </select>
                  {stageNote && (
                    <span data-approval="stage-note" style={{ display: 'block', marginTop: 4, fontSize: 11.5, fontWeight: 700, color: stageNote.ok ? '#15803d' : '#b45309' }}>{stageNote.text}</span>
                  )}
                </Field>
                <Field label={t('Bid owner')}>
                  <select value={formData.ownerId} onChange={e => setFormData({ ...formData, ownerId: e.target.value })} className="opp-input">
                    <option value="">{t('Unassigned')}</option>
                    {projectUsers.filter(u => u.status === 'Approved').map(u => (
                      <option key={u.id} value={u.id}>{u.displayName}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr', gap: 14 }}>
                <Field label={t('Estimated value')}>
                  <input type="number" min="0" value={formData.estimatedValue} onChange={e => setFormData({ ...formData, estimatedValue: e.target.value })} className="opp-input" />
                </Field>
                <Field label={t('Currency')}>
                  <select value={formData.currency} onChange={e => setFormData({ ...formData, currency: e.target.value })} className="opp-input">
                    {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label={t('Win %')}>
                  <input type="number" min="0" max="100" value={formData.probability} onChange={e => setFormData({ ...formData, probability: e.target.value })} className="opp-input" />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label={t('Announced date')}><input type="date" value={formData.announcedDate} onChange={e => setFormData({ ...formData, announcedDate: e.target.value })} className="opp-input" /></Field>
                <Field label={t('Submission deadline')}><input type="date" value={formData.submissionDeadline} onChange={e => setFormData({ ...formData, submissionDeadline: e.target.value })} className="opp-input" /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                <Field label={t('Submitted on')}><input type="date" value={formData.submittedDate} onChange={e => setFormData({ ...formData, submittedDate: e.target.value })} className="opp-input" /></Field>
                <Field label={t('Decision date')}><input type="date" value={formData.decisionDate} onChange={e => setFormData({ ...formData, decisionDate: e.target.value })} className="opp-input" /></Field>
                <Field label={t('Next action')}><input type="date" value={formData.nextActionDate} onChange={e => setFormData({ ...formData, nextActionDate: e.target.value })} className="opp-input" /></Field>
              </div>
              <Field label={t('Location')}><input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} className="opp-input" /></Field>
              <Field label={t('Scope')}><textarea value={formData.scope} onChange={e => setFormData({ ...formData, scope: e.target.value })} className="opp-input" rows={3} /></Field>

              {!editing && (
                <Field label={t('Starting checklist')}>
                  <select value={checklistKey} onChange={e => setChecklistChoice(e.target.value)} className="opp-input" data-testid="opp-checklist-template">
                    {templatesFor('opportunity').map(tp => (
                      <option key={tp.key} value={tp.key}>
                        {t('{{name}} — {{count}} steps', { name: t(tp.label), count: tp.steps.length })}
                      </option>
                    ))}
                    <option value="none">{t('No checklist')}</option>
                  </select>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {formData.submissionDeadline
                      ? t('Each step is dated back from the submission deadline. You can edit them later on the Checklist tab.')
                      : t('Add the submission deadline and each step gets its own date.')}
                  </span>
                </Field>
              )}

              {closedOutcome && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <Field label={formData.stage === 'Won' ? t('Awarded to us — competitor') : t('Awarded to (competitor)')}>
                    <input value={formData.awardedTo} onChange={e => setFormData({ ...formData, awardedTo: e.target.value })} className="opp-input" />
                  </Field>
                  <Field label={t('Awarded value')}>
                    <input type="number" min="0" value={formData.awardedValue} onChange={e => setFormData({ ...formData, awardedValue: e.target.value })} className="opp-input" />
                  </Field>
                </div>
              )}
            </div>

            {formError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: '#fee2e2', color: '#991b1b', marginTop: 16, fontSize: 13, fontWeight: 600 }}>
                <AlertCircle className="w-4 h-4" style={{ flexShrink: 0 }} /> {formError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>{t('Cancel')}</button>
              <button className="btn btn-primary" disabled={saving || !formData.title.trim()} onClick={handleSave}>
                {saving ? t('Saving…') : (editing ? t('Save changes') : t('Create opportunity'))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 420, padding: '22px 24px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{t('Delete opportunity?')}</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 20px' }}>
              {t('“{{title}}” will be removed, and it will no longer count towards win rate or loss analysis. Its follow-ups, milestones and feedback are not auto-deleted.', { title: deleteTarget.title })}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={handleDelete}>{t('Delete')}</button>
            </div>
          </div>
        </div>
      )}

      <style>{`.opp-input { width:100%; padding:9px 11px; background:var(--surface); border:1px solid var(--border); color:var(--text-primary); font-size:14px; font-family:inherit; }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}
