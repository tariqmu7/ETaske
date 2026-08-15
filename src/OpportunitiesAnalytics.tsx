/// <reference types="vite/client" />
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import {
  AppUser, Opportunity, OpportunityFeedback, OpportunityMilestone,
  OpportunityStage, OPEN_OPPORTUNITY_STAGES, isOpportunityOpen,
} from './types';
import type { AppView } from './App';
import { STAGE_COLORS, toNumber, money } from './components/opportunities/opportunityUi';
import { useDisplayLabel } from './lib/displayLabel';
import { useFormat, intlLocale, bidiClassFor } from './lib/format';
import type { Language } from './i18n';
import {
  BarChart3, Target, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Minus, RefreshCw, Info, FileSpreadsheet, Loader2,
} from 'lucide-react';
import { exportOpportunities } from './lib/exportData';

/*
 * Opportunities analytics — the management read of the bid pipeline.
 *
 * Two clocks run on this page and they are labelled everywhere:
 *   • PIPELINE metrics (open bids, weighted forecast, at-risk) are "as of today"
 *     and deliberately ignore the period filter — an open bid is open now.
 *   • OUTCOME metrics (win rate, reasons, trend, clients) are restricted to the
 *     selected period, keyed on the decision date.
 *
 * Everything is derived from the three collections. Nothing is stored back, so
 * this view can never contradict the records the other tabs write.
 */

interface Props {
  appUser: AppUser;
  projectUsers: AppUser[];
  onNavigate: (v: AppView) => void;
}

type Period = '6m' | '12m' | 'ytd' | '24m' | 'all';

// The English label is the i18next key, exactly like every other string in the
// app — `t(PERIOD_LABELS[p])` is what paints it.
const PERIOD_LABELS: Record<Period, string> = {
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  'ytd': 'Year to date',
  '24m': 'Last 24 months',
  'all': 'All time',
};

const isoOf = (ts?: { seconds: number }) =>
  ts ? new Date(ts.seconds * 1000).toISOString().slice(0, 10) : '';

const todayIso = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const addMonths = (iso: string, delta: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + delta);
  return d.toISOString().slice(0, 10);
};

// When a bid was decided. decisionDate is the fact; updatedAt is the fallback
// for records closed before the field existed (or closed without one).
const decidedOn = (o: Opportunity) => o.decisionDate || isoOf(o.updatedAt) || isoOf(o.createdAt);

const dayDiff = (a: string, b: string) =>
  Math.round((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000);

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

const monthKey = (iso: string) => iso.slice(0, 7);
/**
 * The trend chart's x-axis label.
 *
 * ★ Arabic gets a NUMERIC month, English the short name — and that is a layout
 * decision, not a translation shortcut. Arabic has no three-letter month
 * abbreviation: `ar-EG` renders "أغسطس", 5–7 glyphs wide, and this axis packs up
 * to 14 columns of `min-width:34px` with `white-space:nowrap`, so the names
 * overlapped each other into an unreadable smear (found by LOOKING at
 * i18nrtl-bid-analytics-ar.png — every assertion on the page was green).
 * A purely numeric date carries no language, which is the same rule lib/format
 * already applies to every other date in the app.
 */
const monthLabel = (key: string, lang: Language) => {
  const d = new Date(`${key}-01T00:00:00`);
  if (lang === 'ar') return `${key.slice(5, 7)}/${key.slice(2, 4)}`;
  return new Intl.DateTimeFormat(intlLocale(lang), { month: 'short', year: '2-digit' }).format(d);
};
const quarterKey = (iso: string) => `${iso.slice(0, 4)}-Q${Math.ceil(Number(iso.slice(5, 7)) / 3)}`;

export default function OpportunitiesAnalytics({ appUser, projectUsers, onNavigate }: Props) {
  const { t } = useTranslation();
  const dl = useDisplayLabel();
  const fmt = useFormat();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [feedback, setFeedback] = useState<OpportunityFeedback[]>([]);
  const [milestones, setMilestones] = useState<OpportunityMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [period, setPeriod] = useState<Period>('12m');
  const [sector, setSector] = useState('All');
  const [owner, setOwner] = useState('All');
  const [splitBy, setSplitBy] = useState<'client' | 'sector'>('client');
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setExportNote(null);
    try {
      const r = await exportOpportunities();
      setExportNote(t('Saved {{file}} — {{opportunities}} opportunities, {{feedback}} outcomes, {{milestones}} bid gates, {{followUps}} follow-ups.', {
        file: r.fileName, opportunities: r.opportunities, feedback: r.feedback,
        milestones: r.milestones, followUps: r.followUps,
      }));
    } catch (e) {
      console.error('Export opportunities failed:', e);
      setExportNote(t('Export failed. Please try again.'));
    } finally {
      setExporting(false);
    }
  };

  // ── Listeners ─────────────────────────────────────────────────────────────
  // One per collection, unfiltered — the whole board is the analysis unit, and
  // the rules already scope reads to approved org members.
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'opportunities')), snap => {
      setOpportunities(
        snap.docs.filter(d => d.id !== '--stats--').map(d => ({ id: d.id, ...d.data() } as Opportunity)),
      );
      setUpdatedAt(new Date());
      setLoading(false);
    }, err => {
      console.error('Analytics opportunities listener:', err, { uid: auth.currentUser?.uid });
      setErrors(e => ({ ...e, opportunities: t('Failed to load opportunities.') }));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'opportunityFeedback')), snap => {
      setFeedback(snap.docs.map(d => ({ id: d.id, ...d.data() } as OpportunityFeedback)));
    }, err => {
      console.error('Analytics feedback listener:', err);
      setErrors(e => ({ ...e, feedback: t('Failed to load outcome records — reason analysis is unavailable.') }));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'opportunityMilestones')), snap => {
      setMilestones(snap.docs.map(d => ({ id: d.id, ...d.data() } as OpportunityMilestone)));
    }, err => {
      console.error('Analytics milestones listener:', err);
      setErrors(e => ({ ...e, milestones: t('Failed to load bid gates — slippage is unavailable.') }));
    });
    return () => unsub();
  }, []);

  // ── Period windows ────────────────────────────────────────────────────────
  const windows = useMemo(() => {
    const today = todayIso();
    if (period === 'all') return { start: null as string | null, prevStart: null, prevEnd: null };
    if (period === 'ytd') {
      const year = Number(today.slice(0, 4));
      return {
        start: `${year}-01-01`,
        prevStart: `${year - 1}-01-01`,
        prevEnd: `${year - 1}${today.slice(4)}`,
      };
    }
    const months = period === '6m' ? 6 : period === '12m' ? 12 : 24;
    const start = addMonths(today, -months);
    return { start, prevStart: addMonths(start, -months), prevEnd: start };
  }, [period]);

  // ── Scoping (sector / owner apply to every number on the page) ────────────
  const scoped = useMemo(() => opportunities.filter(o => {
    if (sector !== 'All' && (o.sector || '—') !== sector) return false;
    if (owner !== 'All' && (o.ownerId || '') !== owner) return false;
    return true;
  }), [opportunities, sector, owner]);

  const sectorOptions = useMemo(() => {
    const set = new Set<string>();
    opportunities.forEach(o => { if (o.sector) set.add(o.sector); });
    return Array.from(set).sort();
  }, [opportunities]);

  const mainCurrency = useMemo(() => {
    const counts: Record<string, number> = {};
    opportunities.forEach(o => { if (o.currency) counts[o.currency] = (counts[o.currency] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'EGP';
  }, [opportunities]);

  // One feedback record per opportunity (oldest wins — same rule as the tab).
  const feedbackByOpp = useMemo(() => {
    const map = new Map<string, OpportunityFeedback>();
    [...feedback]
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
      .forEach(f => { if (!map.has(f.opportunityId)) map.set(f.opportunityId, f); });
    return map;
  }, [feedback]);

  // ── Pipeline (today, period-independent) ──────────────────────────────────
  const pipeline = useMemo(() => {
    const open = scoped.filter(o => isOpportunityOpen(o.stage));
    const value = open.reduce((s, o) => s + toNumber(o.estimatedValue), 0);
    // A missing probability counts as 0, never 100 — an unassessed bid must not
    // inflate the forecast (same rule as the list page).
    const weighted = open.reduce((s, o) => s + toNumber(o.estimatedValue) * ((o.probability ?? 0) / 100), 0);
    const today = todayIso();
    const overdue = open.filter(o => o.submissionDeadline && o.submissionDeadline < today);
    const byStage = OPEN_OPPORTUNITY_STAGES.map(stage => {
      const rows = open.filter(o => o.stage === stage);
      return {
        stage,
        count: rows.length,
        value: rows.reduce((s, o) => s + toNumber(o.estimatedValue), 0),
      };
    });
    return {
      open, value, weighted, byStage,
      overdueCount: overdue.length,
      overdueValue: overdue.reduce((s, o) => s + toNumber(o.estimatedValue), 0),
      unassessed: open.filter(o => o.probability === undefined || o.probability === null).length,
    };
  }, [scoped]);

  // ── Decided bids in the period ────────────────────────────────────────────
  const decided = useMemo(() => {
    const inWindow = (o: Opportunity, start: string | null, end: string | null) => {
      const d = decidedOn(o);
      if (!d) return false;
      if (start && d < start) return false;
      if (end && d >= end) return false;
      return true;
    };
    const closed = scoped.filter(o => !isOpportunityOpen(o.stage));
    const rows = closed.filter(o => inWindow(o, windows.start, null));
    const prev = closed.filter(o => inWindow(o, windows.prevStart, windows.prevEnd));
    const tally = (list: Opportunity[]) => {
      const won = list.filter(o => o.stage === 'Won');
      const lost = list.filter(o => o.stage === 'Lost');
      const other = list.filter(o => o.stage === 'No Bid' || o.stage === 'Cancelled');
      const wonValue = won.reduce((s, o) => s + toNumber(o.estimatedValue), 0);
      const lostValue = lost.reduce((s, o) => s + toNumber(o.estimatedValue), 0);
      return {
        list, won, lost, other, wonValue, lostValue,
        rate: pct(won.length, won.length + lost.length),
        valueRate: pct(wonValue, wonValue + lostValue),
      };
    };
    return { ...tally(rows), previous: tally(prev) };
  }, [scoped, windows]);

  // Closed bids with no outcome record — they count in the win rate but carry no
  // reason, so every reason-based card states its own coverage.
  const coverage = useMemo(() => {
    const closedInPeriod = decided.list;
    const withRecord = closedInPeriod.filter(o => feedbackByOpp.has(o.id));
    return {
      total: closedInPeriod.length,
      withRecord: withRecord.length,
      missing: closedInPeriod.length - withRecord.length,
    };
  }, [decided, feedbackByOpp]);

  // ── Loss reasons (Pareto) ─────────────────────────────────────────────────
  const reasons = useMemo(() => {
    const lostWithRecord = decided.lost
      .map(o => feedbackByOpp.get(o.id))
      .filter((f): f is OpportunityFeedback => !!f);
    const counts = new Map<string, { cited: number; primary: number }>();
    lostWithRecord.forEach(f => {
      (f.reasons || []).forEach(r => {
        const cur = counts.get(r) || { cited: 0, primary: 0 };
        cur.cited += 1;
        if (f.primaryReason === r) cur.primary += 1;
        counts.set(r, cur);
      });
    });
    const rows = Array.from(counts.entries())
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.cited - a.cited || b.primary - a.primary);
    const totalCitations = rows.reduce((s, r) => s + r.cited, 0);
    let running = 0;
    const withCumulative = rows.map(r => {
      running += r.cited;
      return { ...r, cumulative: totalCitations ? Math.round((running / totalCitations) * 100) : 0 };
    });
    return {
      rows: withCumulative,
      totalCitations,
      bids: lostWithRecord.length,
      lostTotal: decided.lost.length,
      max: rows[0]?.cited || 0,
    };
  }, [decided, feedbackByOpp]);

  // ── Price gap on lost bids ────────────────────────────────────────────────
  const priceGap = useMemo(() => {
    const gaps = decided.lost
      .map(o => feedbackByOpp.get(o.id)?.priceGapPercent)
      .filter((g): g is number => typeof g === 'number' && isFinite(g));
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted.length
      ? (sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      : null;
    const buckets = [
      { label: 'Cheaper than winner', test: (g: number) => g <= 0 },
      { label: '0 – 5% above', test: (g: number) => g > 0 && g <= 5 },
      { label: '5 – 10% above', test: (g: number) => g > 5 && g <= 10 },
      { label: '10 – 20% above', test: (g: number) => g > 10 && g <= 20 },
      { label: 'Over 20% above', test: (g: number) => g > 20 },
    ].map(b => ({ label: b.label, count: gaps.filter(b.test).length }));
    return {
      median: median === null ? null : Math.round(median * 10) / 10,
      count: gaps.length,
      lostTotal: decided.lost.length,
      buckets,
      max: Math.max(1, ...buckets.map(b => b.count)),
    };
  }, [decided, feedbackByOpp]);

  // ── Outcome trend ─────────────────────────────────────────────────────────
  // Monthly while that fits on screen; quarterly beyond ~14 buckets so the
  // columns never turn into hairlines.
  const trend = useMemo(() => {
    const rows = decided.list.map(o => ({ o, date: decidedOn(o) })).filter(r => r.date);
    if (!rows.length) return { buckets: [] as { key: string; label: string; won: number; lost: number; other: number; rate: number | null }[], grouping: 'month' as const, max: 0 };
    const first = windows.start || rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
    const monthsSpan = Math.max(1, Math.round(dayDiff(todayIso(), first) / 30.4) + 1);
    const grouping: 'month' | 'quarter' = monthsSpan > 14 ? 'quarter' : 'month';
    const keyOf = (iso: string) => (grouping === 'month' ? monthKey(iso) : quarterKey(iso));

    // Build every bucket in the span, so a month with no decisions shows as a
    // real gap rather than being silently skipped.
    const keys: string[] = [];
    if (grouping === 'month') {
      for (let cursor = `${first.slice(0, 7)}-01`; cursor.slice(0, 7) <= monthKey(todayIso()); cursor = addMonths(cursor, 1)) {
        keys.push(monthKey(cursor));
      }
    } else {
      const seen = new Set<string>();
      for (let cursor = `${first.slice(0, 7)}-01`; cursor.slice(0, 7) <= monthKey(todayIso()); cursor = addMonths(cursor, 1)) {
        const k = quarterKey(cursor);
        if (!seen.has(k)) { seen.add(k); keys.push(k); }
      }
    }
    const buckets = keys.map(key => {
      const inBucket = rows.filter(r => keyOf(r.date) === key);
      const won = inBucket.filter(r => r.o.stage === 'Won').length;
      const lost = inBucket.filter(r => r.o.stage === 'Lost').length;
      const other = inBucket.length - won - lost;
      return {
        key,
        label: grouping === 'month' ? monthLabel(key, fmt.lang) : key.replace('-', ' '),
        won, lost, other,
        rate: pct(won, won + lost),
      };
    });
    return { buckets, grouping, max: Math.max(1, ...buckets.map(b => b.won + b.lost + b.other)) };
  }, [decided, windows, fmt.lang]);

  // ── Client / sector split ─────────────────────────────────────────────────
  const split = useMemo(() => {
    const groups = new Map<string, { won: number; lost: number; other: number; wonValue: number }>();
    decided.list.forEach(o => {
      const key = (splitBy === 'client' ? o.client : o.sector) || t('Not recorded');
      const cur = groups.get(key) || { won: 0, lost: 0, other: 0, wonValue: 0 };
      if (o.stage === 'Won') { cur.won += 1; cur.wonValue += toNumber(o.estimatedValue); }
      else if (o.stage === 'Lost') cur.lost += 1;
      else cur.other += 1;
      groups.set(key, cur);
    });
    const rows = Array.from(groups.entries())
      .map(([name, v]) => ({ name, ...v, total: v.won + v.lost + v.other, rate: pct(v.won, v.won + v.lost) }))
      .sort((a, b) => b.total - a.total || b.won - a.won);
    return { rows: rows.slice(0, 8), hidden: Math.max(0, rows.length - 8), max: rows[0]?.total || 0 };
  }, [decided, splitBy]);

  // ── Bid-gate slippage ─────────────────────────────────────────────────────
  // Gate titles are a fixed starter list on purpose (task 3), which is what makes
  // this aggregation comparable across bids.
  const slippage = useMemo(() => {
    const scopedIds = new Set(scoped.map(o => o.id));
    const today = todayIso();
    const groups = new Map<string, { late: number[]; open: number }>();
    milestones.forEach(m => {
      if (!scopedIds.has(m.opportunityId) || !m.dueDate) return;
      const cur = groups.get(m.title) || { late: [], open: 0 };
      // A finished gate is judged on the day it finished; an unfinished one is
      // judged against today, so slippage can never be read off a stale date.
      const reference = m.status === 'Done' ? (m.completedDate || today) : today;
      cur.late.push(dayDiff(reference, m.dueDate));
      if (m.status !== 'Done') cur.open += 1;
      groups.set(m.title, cur);
    });
    const rows = Array.from(groups.entries())
      .map(([title, v]) => ({
        title,
        gates: v.late.length,
        open: v.open,
        avg: Math.round(v.late.reduce((s, d) => s + d, 0) / v.late.length),
        worst: Math.max(...v.late),
      }))
      .sort((a, b) => b.avg - a.avg);
    return { rows, max: Math.max(1, ...rows.map(r => Math.abs(r.avg))) };
  }, [milestones, scoped]);

  // ── Decided-bid table ─────────────────────────────────────────────────────
  const table = useMemo(() => {
    const rows = [...decided.list]
      .sort((a, b) => decidedOn(b).localeCompare(decidedOn(a)))
      .map(o => ({ o, f: feedbackByOpp.get(o.id) || null, date: decidedOn(o) }));
    return { rows: rows.slice(0, 40), hidden: Math.max(0, rows.length - 40) };
  }, [decided, feedbackByOpp]);

  // Lower-cased only in English, where the label sits mid-sentence; Arabic has
  // no letter case and `toLowerCase()` on it is a no-op that reads as a bug.
  const periodLabel = t(PERIOD_LABELS[period]);
  const periodNote = fmt.lang === 'en' ? periodLabel.toLowerCase() : periodLabel;
  const rateDelta = decided.rate !== null && decided.previous.rate !== null && period !== 'all'
    ? decided.rate - decided.previous.rate
    : null;

  if (loading) {
    return (
      <div style={wrap}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="card skeleton" style={{ height: 92 }} />)}
        </div>
        <div className="card skeleton" style={{ height: 260, marginTop: 18 }} />
      </div>
    );
  }

  if (errors.opportunities) {
    return (
      <div style={wrap}>
        <div style={errorBox}><AlertTriangle className="w-4 h-4" /> {errors.opportunities}</div>
      </div>
    );
  }

  if (opportunities.length === 0) {
    return (
      <div style={wrap}>
        <div className="empty-state">
          <div className="empty-state-icon"><BarChart3 className="w-8 h-8" /></div>
          <div className="empty-state-title">{t('Nothing to analyse yet')}</div>
          <div className="empty-state-sub">
            {t('Win rate, loss reasons and pipeline value appear here as soon as opportunities are recorded.')}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => onNavigate('opportunities')}>
            <Target className="w-4 h-4" /> {t('Go to Opportunities')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="oa" style={wrap}>
      <style>{OA_STYLE}</style>

      {/* Header + global filters */}
      <div className="oa-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 10, background: 'rgba(59,130,246,0.1)', color: 'var(--accent)' }}>
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{t('Bid Analytics')}</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {t('{{count}} opportunities in view · outcomes for {{period}}', { count: scoped.length, period: periodNote })}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="oa-select" value={period} onChange={e => setPeriod(e.target.value as Period)} title={t('Outcome period')}>
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => <option key={p} value={p}>{t(PERIOD_LABELS[p])}</option>)}
          </select>
          <select className="oa-select" value={sector} onChange={e => setSector(e.target.value)} title={t('Sector')}>
            <option value="All">{t('All sectors')}</option>
            {sectorOptions.map(s => <option key={s} value={s}>{dl(s)}</option>)}
          </select>
          <select className="oa-select" value={owner} onChange={e => setOwner(e.target.value)} title={t('Bid owner')}>
            <option value="All">{t('All bid owners')}</option>
            {projectUsers.filter(u => u.status === 'Approved').map(u => (
              <option key={u.id} value={u.id}>{u.displayName}</option>
            ))}
          </select>
          {/* Exports the full bid book, not this page's filtered view — the
              workbook is the raw record these charts are derived from. */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleExport}
            disabled={exporting}
            title={t('Download every opportunity, outcome, bid gate and follow-up as one Excel workbook (ignores the filters above)')}
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            {exporting ? t('Exporting…') : t('Export all')}
          </button>
          <span className="oa-stamp" title={t('This page is live — every figure updates as records change')}>
            <RefreshCw className="w-3.5 h-3.5" />
            {updatedAt ? t('Live · {{time}}', { time: fmt.time(updatedAt) }) : t('Live')}
          </span>
        </div>
      </div>

      {exportNote && (
        <div className="oa-note" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)', marginBottom: 14, fontSize: 13 }}>
          <FileSpreadsheet className="w-4 h-4" style={{ flexShrink: 0, color: 'var(--accent)' }} />
          <span style={{ flex: 1 }}>{exportNote}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setExportNote(null)}>{t('Dismiss')}</button>
        </div>
      )}

      {(sector !== 'All' || owner !== 'All') && (
        <button className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }} onClick={() => { setSector('All'); setOwner('All'); }}>
          {t('Clear filters')}
        </button>
      )}

      {/* KPI row */}
      <div className="oa-kpis">
        <Kpi
          label={t('Win rate')}
          value={decided.rate === null ? '—' : fmt.percent(decided.rate)}
          sub={decided.rate === null ? t('no decided bids in period') : t('{{won}} won / {{lost}} lost', { won: decided.won.length, lost: decided.lost.length })}
          tone={decided.rate === null ? 'neutral' : decided.rate >= 50 ? 'good' : decided.rate >= 30 ? 'warn' : 'bad'}
          delta={rateDelta === null ? undefined : {
            value: t('{{value}} pp', { value: `${rateDelta > 0 ? '+' : ''}${rateDelta}` }),
            dir: rateDelta > 0 ? 'up' : rateDelta < 0 ? 'down' : 'flat',
            note: t('vs previous period'),
          }}
        />
        <Kpi
          label={t('Win rate by value')}
          value={decided.valueRate === null ? '—' : fmt.percent(decided.valueRate)}
          sub={t('{{won}} won of {{total}} bid', { won: money(decided.wonValue, mainCurrency), total: money(decided.wonValue + decided.lostValue, mainCurrency) })}
          tone="neutral"
        />
        <Kpi
          label={t('Value won')}
          value={money(decided.wonValue, mainCurrency)}
          sub={decided.won.length === 1
            ? t('{{count}} bid · {{period}}', { count: 1, period: periodNote })
            : t('{{count}} bids · {{period}}', { count: decided.won.length, period: periodNote })}
          tone="good"
        />
        <Kpi
          label={t('Open pipeline')}
          value={money(pipeline.value, mainCurrency)}
          sub={t('{{count}} open bids · today', { count: pipeline.open.length })}
          tone="neutral"
        />
        <Kpi
          label={t('Weighted forecast')}
          value={money(pipeline.weighted, mainCurrency)}
          sub={pipeline.unassessed === 0 ? t('value × win %')
            : pipeline.unassessed === 1 ? t('{{count}} bid with no win %', { count: 1 })
            : t('{{count}} bids with no win %', { count: pipeline.unassessed })}
          tone="neutral"
        />
        <Kpi
          label={t('Past deadline')}
          value={String(pipeline.overdueCount)}
          sub={pipeline.overdueCount ? t('{{value}} still marked open', { value: money(pipeline.overdueValue, mainCurrency) }) : t('no open bid is past its deadline')}
          tone={pipeline.overdueCount ? 'bad' : 'good'}
        />
      </div>

      {/* Coverage banner — states the honesty limit of every reason-based card */}
      {coverage.missing > 0 && (
        <div className="oa-note">
          <Info className="w-4 h-4" style={{ flexShrink: 0 }} />
          <span>
            <b>{t('{{missing}} of {{total}}', { missing: coverage.missing, total: coverage.total })}</b>{' '}
            {t('bids decided in this period have no outcome record. They count in the win rate but not in the reason, competitor or price analysis below.')}
          </span>
        </div>
      )}
      {errors.feedback && <div style={errorBox}><AlertTriangle className="w-4 h-4" /> {errors.feedback}</div>}

      {/* Primary visual — open pipeline by stage */}
      <Card
        title={t('Open pipeline by stage')}
        subtitle={t('Where the {{count}} open bids sit today · bar length = number of bids', { count: pipeline.open.length })}
      >
        {pipeline.open.length === 0 ? (
          <Empty text={t('No open bids. Everything in view has been decided.')} />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {pipeline.byStage.map(s => {
              const maxCount = Math.max(1, ...pipeline.byStage.map(x => x.count));
              const share = pct(s.count, pipeline.open.length);
              return (
                <div key={s.stage} className="oa-funnel-row" title={t('{{stage}}: {{count}} bids · {{value}}', { stage: dl(s.stage), count: s.count, value: money(s.value, mainCurrency) })}>
                  <span className="oa-funnel-label">{dl(s.stage)}</span>
                  <div className="oa-track">
                    <div
                      className="oa-bar"
                      style={{ width: `${(s.count / maxCount) * 100}%`, background: STAGE_COLORS[s.stage as OpportunityStage] }}
                    />
                  </div>
                  <span className="oa-num" style={{ fontWeight: 800 }}>{s.count}</span>
                  <span className="oa-num oa-dim oa-c-2">{share === null ? '' : fmt.percent(share)}</span>
                  <span className="oa-num ltr-data">{money(s.value, mainCurrency)}</span>
                </div>
              );
            })}
          </div>
        )}
        <Foot>
          {t("A snapshot of today's distribution, not a conversion funnel — stage history is not recorded, so no drop-off percentage is claimed between stages.")}
        </Foot>
      </Card>

      {/* Supporting grid */}
      <div className="oa-grid">
        {/* Loss reasons — Pareto */}
        <Card
          title={t('Why we lose')}
          subtitle={reasons.bids
            ? t('{{citations}} reasons cited across {{bids}} of {{lost}} lost bids', { citations: reasons.totalCitations, bids: reasons.bids, lost: reasons.lostTotal })
            : t('No outcome record on any lost bid in this period')}
        >
          {reasons.rows.length === 0 ? (
            <Empty text={decided.lost.length === 0 ? t('No bids lost in this period.') : t('Capture the outcome on a lost bid to build this analysis.')} />
          ) : (
            <>
              <div style={{ display: 'grid', gap: 8 }}>
                {reasons.rows.map(r => (
                  <div key={r.reason} className="oa-reason-row" title={t('{{reason}}: cited on {{cited}} bids, primary on {{primary}}', { reason: dl(r.reason), cited: r.cited, primary: r.primary })}>
                    <span className="oa-reason-label">{dl(r.reason)}</span>
                    <div className="oa-track">
                      <div className="oa-bar" style={{ width: `${(r.cited / reasons.max) * 100}%`, background: 'var(--oa-lost-soft)' }}>
                        {r.primary > 0 && (
                          <div className="oa-bar-inner" style={{ width: `${(r.primary / r.cited) * 100}%`, background: 'var(--oa-lost)' }} />
                        )}
                      </div>
                    </div>
                    <span className="oa-num" style={{ fontWeight: 800 }}>{r.cited}</span>
                    <span className="oa-num oa-dim oa-c-2">{fmt.percent(r.cumulative)}</span>
                  </div>
                ))}
              </div>
              <div className="oa-legend">
                <span><i style={{ background: 'var(--oa-lost)' }} /> {t('Primary reason')}</span>
                <span><i style={{ background: 'var(--oa-lost-soft)' }} /> {t('Also cited')}</span>
                <span className="oa-dim">{t('Right column = cumulative share of all citations')}</span>
              </div>
            </>
          )}
        </Card>

        {/* Outcome trend */}
        <Card
          title={t('Decisions over time')}
          subtitle={trend.buckets.length
            ? (trend.grouping === 'month' ? t('By month · win % printed above each column') : t('By quarter · win % printed above each column'))
            : t('No decided bids in this period')}
        >
          {trend.buckets.length === 0 ? (
            <Empty text={t('Nothing has been decided in the selected period.')} />
          ) : (
            <>
              <div className="oa-cols">
                {trend.buckets.map(b => {
                  const total = b.won + b.lost + b.other;
                  return (
                    <div key={b.key} className="oa-col" title={t('{{label}}: {{won}} won, {{lost}} lost, {{other}} no bid / cancelled', { label: b.label, won: b.won, lost: b.lost, other: b.other })}>
                      <span className="oa-col-rate">{b.rate === null ? '' : fmt.percent(b.rate)}</span>
                      <div className="oa-col-stack">
                        {b.won > 0 && <div style={{ height: `${(b.won / trend.max) * 100}%`, background: 'var(--oa-won)' }} />}
                        {b.lost > 0 && <div style={{ height: `${(b.lost / trend.max) * 100}%`, background: 'var(--oa-lost)' }} />}
                        {b.other > 0 && <div style={{ height: `${(b.other / trend.max) * 100}%`, background: 'var(--oa-none)' }} />}
                      </div>
                      <span className="oa-col-total">{total || ''}</span>
                      <span className="oa-col-label">{b.label}</span>
                    </div>
                  );
                })}
              </div>
              <div className="oa-legend">
                <span><i style={{ background: 'var(--oa-won)' }} /> {dl('Won')}</span>
                <span><i style={{ background: 'var(--oa-lost)' }} /> {dl('Lost')}</span>
                <span><i style={{ background: 'var(--oa-none)' }} /> {t('No bid / cancelled')}</span>
              </div>
            </>
          )}
        </Card>

        {/* Client / sector split */}
        <Card
          title={splitBy === 'client' ? t('By client') : t('By sector')}
          subtitle={split.hidden
            ? t('Decided bids in {{period}} · top 8 of {{total}}', { period: periodNote, total: split.rows.length + split.hidden })
            : t('Decided bids in {{period}}', { period: periodNote })}
          action={
            <div className="oa-toggle">
              <button className={splitBy === 'client' ? 'on' : ''} onClick={() => setSplitBy('client')}>{t('Client')}</button>
              <button className={splitBy === 'sector' ? 'on' : ''} onClick={() => setSplitBy('sector')}>{t('Sector')}</button>
            </div>
          }
        >
          {split.rows.length === 0 ? (
            <Empty text={t('No decided bids in this period.')} />
          ) : (
            <>
              <div style={{ display: 'grid', gap: 8 }}>
                {split.rows.map(r => (
                  <div key={r.name} className="oa-reason-row" title={t('{{name}}: {{won}} won, {{lost}} lost, {{other}} no bid / cancelled · {{value}} won', { name: dl(r.name), won: r.won, lost: r.lost, other: r.other, value: money(r.wonValue, mainCurrency) })}>
                    <span className={fmt.bidiFor(dl(r.name))}>{dl(r.name)}</span>
                    <div className="oa-track">
                      <div className="oa-split" style={{ width: `${(r.total / Math.max(1, split.max)) * 100}%` }}>
                        {r.won > 0 && <span style={{ flex: r.won, background: 'var(--oa-won)' }} />}
                        {r.lost > 0 && <span style={{ flex: r.lost, background: 'var(--oa-lost)' }} />}
                        {r.other > 0 && <span style={{ flex: r.other, background: 'var(--oa-none)' }} />}
                      </div>
                    </div>
                    <span className="oa-num" style={{ fontWeight: 800 }}>{r.rate === null ? '—' : fmt.percent(r.rate)}</span>
                    <span className="oa-num oa-dim oa-c-2">{r.total === 1 ? t('{{count}} bid', { count: 1 }) : t('{{count}} bids', { count: r.total })}</span>
                  </div>
                ))}
              </div>
              <div className="oa-legend">
                <span><i style={{ background: 'var(--oa-won)' }} /> {dl('Won')}</span>
                <span><i style={{ background: 'var(--oa-lost)' }} /> {dl('Lost')}</span>
                <span><i style={{ background: 'var(--oa-none)' }} /> {t('No bid / cancelled')}</span>
                <span className="oa-dim">{t('% column = win rate (won ÷ decided)')}</span>
              </div>
            </>
          )}
        </Card>

        {/* Price gap */}
        <Card
          title={t('How far off was our price')}
          subtitle={priceGap.count
            ? t('{{count}} of {{total}} lost bids have both prices recorded', { count: priceGap.count, total: priceGap.lostTotal })
            : t('No lost bid in this period records our price and the winning price')}
        >
          {priceGap.count === 0 ? (
            <Empty text={t('Record our price and the winning price on a lost bid to see the gap.')} />
          ) : (
            <>
              <div className="oa-hero">
                <span className="oa-hero-value" style={{ color: (priceGap.median ?? 0) > 0 ? 'var(--oa-lost)' : 'var(--oa-won)' }}>
                  {priceGap.median === null ? '—' : `${priceGap.median > 0 ? '+' : ''}${fmt.percent(priceGap.median, priceGap.median % 1 === 0 ? 0 : 1)}`}
                </span>
                <span className="oa-hero-note">
                  {(priceGap.median ?? 0) > 0
                    ? t('median gap to the winning price — we bid above the winner')
                    : t('median gap to the winning price')}
                </span>
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {priceGap.buckets.map(b => (
                  <div key={b.label} className="oa-reason-row" title={t('{{label}}: {{count}} lost bids', { label: t(b.label), count: b.count })}>
                    <span className="oa-reason-label">{t(b.label)}</span>
                    <div className="oa-track">
                      <div className="oa-bar" style={{ width: `${(b.count / priceGap.max) * 100}%`, background: 'var(--oa-lost-soft)' }} />
                    </div>
                    <span className="oa-num" style={{ fontWeight: 800 }}>{b.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Gate slippage */}
        <Card
          title={t('Bid-gate slippage')}
          subtitle={slippage.rows.length ? t('Average days late per gate · negative = finished early') : t('No dated bid gates yet')}
          span
        >
          {errors.milestones ? (
            <Empty text={errors.milestones} />
          ) : slippage.rows.length === 0 ? (
            <Empty text={t('Seed the five bid gates on an opportunity and give them dates to track slippage.')} />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {slippage.rows.map(r => {
                const late = r.avg > 0;
                const widthPct = (Math.abs(r.avg) / slippage.max) * 50;
                return (
                  <div key={r.title} className="oa-reason-row" title={t('{{title}}: {{gates}} gates, {{open}} still open, worst {{worst}}d', { title: dl(r.title), gates: r.gates, open: r.open, worst: r.worst })}>
                    <span className="oa-reason-label">{dl(r.title)}</span>
                    <div className="oa-track oa-diverging">
                      <span className="oa-zero" />
                      <div
                        className="oa-bar"
                        style={{
                          width: `${widthPct}%`,
                          marginInlineStart: late ? '50%' : `${50 - widthPct}%`,
                          background: late ? 'var(--oa-late)' : 'var(--oa-early)',
                        }}
                      />
                    </div>
                    <span className="oa-num" style={{ fontWeight: 800, color: late ? 'var(--oa-late)' : 'var(--oa-early)' }}>
                      {late ? `+${r.avg}d` : `${r.avg}d`}
                    </span>
                    <span className="oa-num oa-dim oa-c-2">{r.gates === 1 ? t('{{count}} gate', { count: 1 }) : t('{{count}} gates', { count: r.gates })}</span>
                  </div>
                );
              })}
            </div>
          )}
          <Foot>
            {t('A finished gate is measured on the day it was completed; an unfinished one against today, so an open gate keeps ageing until it is ticked.')}
          </Foot>
        </Card>
      </div>

      {/* Detail table */}
      <Card
        title={t('Decided bids')}
        subtitle={table.hidden
          ? t('{{count}} decided in {{period}} · showing the {{shown}} most recent', { count: decided.list.length, period: periodNote, shown: table.rows.length })
          : t('{{count}} decided in {{period}}', { count: decided.list.length, period: periodNote })}
      >
        {table.rows.length === 0 ? (
          <Empty text={t('No bids were decided in the selected period.')} />
        ) : (
          <div className="oa-tablewrap">
            <table className="oa-table">
              <thead>
                <tr>
                  <th>{t('Decided')}</th>
                  <th>{t('Opportunity')}</th>
                  <th>{t('Client')}</th>
                  <th style={{ textAlign: 'end' }}>{t('Value')}</th>
                  <th>{t('Outcome')}</th>
                  <th>{t('Primary reason')}</th>
                  <th style={{ textAlign: 'end' }}>{t('Price gap')}</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map(({ o, f, date }) => (
                  <tr key={o.id}>
                    <td className="oa-num ltr-data">{fmt.date(date) || '—'}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{o.title}</span>
                      {o.serialNumber && <span className="oa-dim ltr-data"> · {o.serialNumber}</span>}
                    </td>
                    <td>{o.client || '—'}</td>
                    <td className="oa-num" style={{ textAlign: 'end' }}>
                      <span className="ltr-data">{o.estimatedValue ? money(toNumber(o.estimatedValue), o.currency) : '—'}</span>
                    </td>
                    <td>
                      <span className="oa-chip" style={{ background: STAGE_COLORS[o.stage] }}>{dl(o.stage)}</span>
                    </td>
                    <td>{dl(f?.primaryReason) || (f ? '—' : <span className="oa-dim">{t('no record')}</span>)}</td>
                    <td className="oa-num" style={{ textAlign: 'end', color: (f?.priceGapPercent ?? 0) > 0 ? 'var(--oa-lost)' : undefined }}>
                      {typeof f?.priceGapPercent === 'number' ? `${f.priceGapPercent > 0 ? '+' : ''}${f.priceGapPercent}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Foot>
          {t('Values are summed as entered, without currency conversion — totals are labelled {{currency}}, the currency used on most records.', { currency: mainCurrency })}
          {appUser.role === 'Employee' ? '' : ` ${t('Open a bid from the Opportunities page to see or edit its outcome record.')}`}
        </Foot>
      </Card>
    </div>
  );
}

// ── Presentation pieces ─────────────────────────────────────────────────────

const wrap: React.CSSProperties = { maxWidth: 1280, margin: '0 auto', padding: '24px 16px' };

const errorBox: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
  background: '#fee2e2', color: '#991b1b', marginBottom: 16, fontSize: 13, fontWeight: 600,
};

function Kpi({ label, value, sub, tone, delta }: {
  label: string;
  value: string;
  sub: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  delta?: { value: string; dir: 'up' | 'down' | 'flat'; note: string };
}) {
  const toneColor = tone === 'good' ? 'var(--oa-won)' : tone === 'bad' ? 'var(--oa-lost)'
    : tone === 'warn' ? 'var(--oa-late)' : 'var(--text-primary)';
  const Arrow = delta?.dir === 'up' ? ArrowUpRight : delta?.dir === 'down' ? ArrowDownRight : Minus;
  return (
    <div className="card oa-kpi">
      <div className="oa-kpi-label">{label}</div>
      <div className={`oa-kpi-value ${bidiClassFor(value)}`} style={{ color: toneColor }}>{value}</div>
      <div className="oa-kpi-sub">{sub}</div>
      {delta && (
        <div className="oa-kpi-delta" style={{ color: delta.dir === 'up' ? 'var(--oa-won)' : delta.dir === 'down' ? 'var(--oa-lost)' : 'var(--text-muted)' }}>
          <Arrow className="w-3.5 h-3.5" /> {delta.value} <span className="oa-dim">{delta.note}</span>
        </div>
      )}
    </div>
  );
}

function Card({ title, subtitle, action, span, children }: {
  title: string; subtitle?: string; action?: React.ReactNode; span?: boolean; children: React.ReactNode;
}) {
  return (
    <section className={`card oa-card${span ? ' oa-span' : ''}`}>
      <header className="oa-card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="oa-empty">{text}</div>;
}

function Foot({ children }: { children: React.ReactNode }) {
  return <p className="oa-foot">{children}</p>;
}

/*
 * Chart colours. The module's stage colours stay in charge of stage identity;
 * these three carry OUTCOME identity and were re-stepped from them because the
 * original green/red pair fails colour-vision separation when the two sit side
 * by side in one bar (validated with the dataviz palette checker: light
 * #22c55e/#991b1b/#64748b passes, the original #16a34a/#dc2626 pair scored 5.0
 * where 8 is the floor). Dark mode gets its own steps against the dark surface,
 * not a lightened flip. Every segment is also direct-labelled and legended, so
 * colour is never the only carrier.
 */
const OA_STYLE = `
.oa { --oa-won:#22c55e; --oa-lost:#991b1b; --oa-lost-soft:#d9a3a3; --oa-none:#64748b; --oa-late:#b45309; --oa-early:#15803d; }
[data-theme="dark"] .oa { --oa-won:#34d399; --oa-lost:#f43f5e; --oa-lost-soft:#7f2b3c; --oa-none:#94a3b8; --oa-late:#f59e0b; --oa-early:#34d399; }

.oa-head { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:18px; }
.oa-select { padding:8px 10px; background:var(--surface); border:1px solid var(--border); color:var(--text-primary); font-size:13px; font-family:inherit; }
.oa-stamp { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:700; color:var(--text-muted); }

.oa-kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-bottom:16px; }
.oa-kpi { padding:14px 16px; }
.oa-kpi-label { font-size:12px; font-weight:700; color:var(--text-secondary); }
.oa-kpi-value { font-size:26px; font-weight:800; line-height:1.15; font-variant-numeric:tabular-nums; margin-top:2px; }
.oa-kpi-sub { font-size:11.5px; color:var(--text-muted); margin-top:2px; }
.oa-kpi-delta { display:inline-flex; align-items:center; gap:4px; font-size:11.5px; font-weight:700; margin-top:6px; }

.oa-note { display:flex; align-items:flex-start; gap:8px; padding:10px 14px; margin-bottom:16px;
  background:var(--surface-warn-strong); border:1px solid var(--surface-warn-border); color:var(--surface-warn-text);
  font-size:12.5px; line-height:1.5; }

/* 420px, not the usual 320: a third column squeezes the 12-column trend chart
   into a horizontal scroller and ellipsises every reason label.
   ★ min(420px, 100%), never a bare 420px: a fixed minimum cannot shrink below
   itself, so on a 390px phone the track was 62px wider than the viewport and
   the whole page scrolled sideways. Same trap the RTL sweep hit on .modgrid. */
.oa-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(420px, 100%), 1fr)); gap:16px; margin-top:16px; }
.oa-card { padding:18px; }
/* The odd card out — without this it sits alone beside an empty half-row. */
.oa-span { grid-column:1 / -1; }
.oa-card-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:14px; }
.oa-card-head h2 { font-size:15px; font-weight:800; color:var(--text-primary); margin:0; }
.oa-card-head p { font-size:12px; color:var(--text-muted); margin:2px 0 0; }

.oa-funnel-row, .oa-reason-row { display:grid; grid-template-columns:minmax(96px, 30%) 1fr auto auto; align-items:center; gap:10px; }
.oa-funnel-row { grid-template-columns:minmax(96px, 26%) 1fr auto auto auto; }
.oa-funnel-label, .oa-reason-label { font-size:12.5px; font-weight:600; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.oa-track { position:relative; height:16px; background:var(--surface-3); }
.oa-bar { height:100%; min-width:2px; border-radius:0 3px 3px 0; display:flex; }
.oa-bar-inner { height:100%; border-radius:0 3px 3px 0; }
.oa-split { height:100%; min-width:2px; display:flex; gap:2px; }
.oa-split span { display:block; height:100%; }
.oa-diverging .oa-zero { position:absolute; left:50%; top:-2px; bottom:-2px; width:1px; background:var(--border-md); }
.oa-num { font-size:12.5px; font-variant-numeric:tabular-nums; color:var(--text-primary); white-space:nowrap; }
.oa-dim { color:var(--text-muted); }

.oa-legend { display:flex; flex-wrap:wrap; gap:12px; margin-top:12px; font-size:11.5px; color:var(--text-secondary); }
.oa-legend span { display:inline-flex; align-items:center; gap:5px; }
.oa-legend i { width:10px; height:10px; display:inline-block; }

.oa-cols { display:flex; align-items:flex-end; gap:6px; height:220px; overflow-x:auto; padding-bottom:2px; }
.oa-col { flex:1 1 0; min-width:34px; display:flex; flex-direction:column; align-items:center; height:100%; }
.oa-col-rate { font-size:10.5px; font-weight:800; color:var(--text-secondary); height:14px; }
.oa-col-stack { flex:1; width:100%; display:flex; flex-direction:column-reverse; justify-content:flex-start; gap:2px; }
.oa-col-stack > div { width:100%; min-height:3px; }
.oa-col-total { font-size:11px; font-weight:700; color:var(--text-primary); font-variant-numeric:tabular-nums; }
.oa-col-label { font-size:10.5px; color:var(--text-muted); white-space:nowrap; }

.oa-hero { display:flex; flex-direction:column; }
.oa-hero-value { font-size:32px; font-weight:800; line-height:1.1; font-variant-numeric:tabular-nums; }
.oa-hero-note { font-size:12px; color:var(--text-muted); }

.oa-empty { padding:22px 4px; font-size:12.5px; color:var(--text-muted); text-align:center; }
.oa-foot { font-size:11.5px; color:var(--text-muted); line-height:1.5; margin-top:12px; padding-top:10px; border-top:1px solid var(--border); }

.oa-toggle { display:flex; border:1px solid var(--border); }
.oa-toggle button { padding:5px 10px; font-size:12px; font-weight:700; font-family:inherit; cursor:pointer;
  background:var(--surface); color:var(--text-muted); border:none; }
.oa-toggle button.on { background:var(--blue-50); color:var(--accent); }

.oa-tablewrap { overflow-x:auto; max-height:520px; overflow-y:auto; }
.oa-table { width:100%; border-collapse:collapse; font-size:12.5px; }
.oa-table th { position:sticky; top:0; z-index:1; background:var(--surface-2); text-align:start; font-weight:700;
  color:var(--text-secondary); padding:8px 10px; white-space:nowrap; border-bottom:1px solid var(--border); }
.oa-table td { padding:9px 10px; border-bottom:1px solid var(--border); color:var(--text-secondary); vertical-align:top; }
.oa-chip { display:inline-block; padding:2px 7px; font-size:11px; font-weight:800; color:#fff; white-space:nowrap; }

/* Narrow screens drop the secondary column explicitly (and the grid loses that
   track with it) — otherwise a hidden child would reflow onto a second row. */
@media (max-width: 640px) {
  .oa-funnel-row { grid-template-columns:minmax(80px, 34%) 1fr auto auto; }
  .oa-reason-row { grid-template-columns:minmax(80px, 34%) 1fr auto; }
  .oa-c-2 { display:none; }
}
`;
