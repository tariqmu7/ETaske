/// <reference types="vite/client" />
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import {
  AppUser, Opportunity, OpportunityFeedback, OpportunityMilestone,
  OpportunityStage, OPEN_OPPORTUNITY_STAGES, isOpportunityOpen,
} from './types';
import type { AppView } from './App';
import { STAGE_COLORS, toNumber, money } from './components/opportunities/opportunityUi';
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
const monthLabel = (key: string) => {
  const d = new Date(`${key}-01T00:00:00`);
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};
const quarterKey = (iso: string) => `${iso.slice(0, 4)}-Q${Math.ceil(Number(iso.slice(5, 7)) / 3)}`;

export default function OpportunitiesAnalytics({ appUser, projectUsers, onNavigate }: Props) {
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
      setExportNote(`Saved ${r.fileName} — ${r.opportunities} opportunities, ${r.feedback} outcomes, ${r.milestones} bid gates, ${r.followUps} follow-ups.`);
    } catch (e) {
      console.error('Export opportunities failed:', e);
      setExportNote('Export failed. Please try again.');
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
      setErrors(e => ({ ...e, opportunities: 'Failed to load opportunities.' }));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'opportunityFeedback')), snap => {
      setFeedback(snap.docs.map(d => ({ id: d.id, ...d.data() } as OpportunityFeedback)));
    }, err => {
      console.error('Analytics feedback listener:', err);
      setErrors(e => ({ ...e, feedback: 'Failed to load outcome records — reason analysis is unavailable.' }));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'opportunityMilestones')), snap => {
      setMilestones(snap.docs.map(d => ({ id: d.id, ...d.data() } as OpportunityMilestone)));
    }, err => {
      console.error('Analytics milestones listener:', err);
      setErrors(e => ({ ...e, milestones: 'Failed to load bid gates — slippage is unavailable.' }));
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
        label: grouping === 'month' ? monthLabel(key) : key.replace('-', ' '),
        won, lost, other,
        rate: pct(won, won + lost),
      };
    });
    return { buckets, grouping, max: Math.max(1, ...buckets.map(b => b.won + b.lost + b.other)) };
  }, [decided, windows]);

  // ── Client / sector split ─────────────────────────────────────────────────
  const split = useMemo(() => {
    const groups = new Map<string, { won: number; lost: number; other: number; wonValue: number }>();
    decided.list.forEach(o => {
      const key = (splitBy === 'client' ? o.client : o.sector) || 'Not recorded';
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

  const periodNote = period === 'all' ? 'all time' : PERIOD_LABELS[period].toLowerCase();
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
          <div className="empty-state-title">Nothing to analyse yet</div>
          <div className="empty-state-sub">
            Win rate, loss reasons and pipeline value appear here as soon as opportunities are recorded.
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => onNavigate('opportunities')}>
            <Target className="w-4 h-4" /> Go to Opportunities
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
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Bid Analytics</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {scoped.length} opportunities in view · outcomes for {periodNote}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="oa-select" value={period} onChange={e => setPeriod(e.target.value as Period)} title="Outcome period">
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
          </select>
          <select className="oa-select" value={sector} onChange={e => setSector(e.target.value)} title="Sector">
            <option value="All">All sectors</option>
            {sectorOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="oa-select" value={owner} onChange={e => setOwner(e.target.value)} title="Bid owner">
            <option value="All">All bid owners</option>
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
            title="Download every opportunity, outcome, bid gate and follow-up as one Excel workbook (ignores the filters above)"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            {exporting ? 'Exporting…' : 'Export all'}
          </button>
          <span className="oa-stamp" title="This page is live — every figure updates as records change">
            <RefreshCw className="w-3.5 h-3.5" />
            {updatedAt ? `Live · ${updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Live'}
          </span>
        </div>
      </div>

      {exportNote && (
        <div className="oa-note" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)', marginBottom: 14, fontSize: 13 }}>
          <FileSpreadsheet className="w-4 h-4" style={{ flexShrink: 0, color: 'var(--accent)' }} />
          <span style={{ flex: 1 }}>{exportNote}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setExportNote(null)}>Dismiss</button>
        </div>
      )}

      {(sector !== 'All' || owner !== 'All') && (
        <button className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }} onClick={() => { setSector('All'); setOwner('All'); }}>
          Clear filters
        </button>
      )}

      {/* KPI row */}
      <div className="oa-kpis">
        <Kpi
          label="Win rate"
          value={decided.rate === null ? '—' : `${decided.rate}%`}
          sub={decided.rate === null ? 'no decided bids in period' : `${decided.won.length} won / ${decided.lost.length} lost`}
          tone={decided.rate === null ? 'neutral' : decided.rate >= 50 ? 'good' : decided.rate >= 30 ? 'warn' : 'bad'}
          delta={rateDelta === null ? undefined : { value: `${rateDelta > 0 ? '+' : ''}${rateDelta} pp`, dir: rateDelta > 0 ? 'up' : rateDelta < 0 ? 'down' : 'flat', note: 'vs previous period' }}
        />
        <Kpi
          label="Win rate by value"
          value={decided.valueRate === null ? '—' : `${decided.valueRate}%`}
          sub={`${money(decided.wonValue, mainCurrency)} won of ${money(decided.wonValue + decided.lostValue, mainCurrency)} bid`}
          tone="neutral"
        />
        <Kpi
          label="Value won"
          value={money(decided.wonValue, mainCurrency)}
          sub={`${decided.won.length} ${decided.won.length === 1 ? 'bid' : 'bids'} · ${periodNote}`}
          tone="good"
        />
        <Kpi
          label="Open pipeline"
          value={money(pipeline.value, mainCurrency)}
          sub={`${pipeline.open.length} open bids · today`}
          tone="neutral"
        />
        <Kpi
          label="Weighted forecast"
          value={money(pipeline.weighted, mainCurrency)}
          sub={pipeline.unassessed > 0 ? `${pipeline.unassessed} bid${pipeline.unassessed === 1 ? '' : 's'} with no win %` : 'value × win %'}
          tone="neutral"
        />
        <Kpi
          label="Past deadline"
          value={String(pipeline.overdueCount)}
          sub={pipeline.overdueCount ? `${money(pipeline.overdueValue, mainCurrency)} still marked open` : 'no open bid is past its deadline'}
          tone={pipeline.overdueCount ? 'bad' : 'good'}
        />
      </div>

      {/* Coverage banner — states the honesty limit of every reason-based card */}
      {coverage.missing > 0 && (
        <div className="oa-note">
          <Info className="w-4 h-4" style={{ flexShrink: 0 }} />
          <span>
            <b>{coverage.missing} of {coverage.total}</b> bids decided in this period have no outcome record.
            They count in the win rate but not in the reason, competitor or price analysis below.
          </span>
        </div>
      )}
      {errors.feedback && <div style={errorBox}><AlertTriangle className="w-4 h-4" /> {errors.feedback}</div>}

      {/* Primary visual — open pipeline by stage */}
      <Card
        title="Open pipeline by stage"
        subtitle={`Where the ${pipeline.open.length} open bids sit today · bar length = number of bids`}
      >
        {pipeline.open.length === 0 ? (
          <Empty text="No open bids. Everything in view has been decided." />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {pipeline.byStage.map(s => {
              const maxCount = Math.max(1, ...pipeline.byStage.map(x => x.count));
              const share = pct(s.count, pipeline.open.length);
              return (
                <div key={s.stage} className="oa-funnel-row" title={`${s.stage}: ${s.count} bids · ${money(s.value, mainCurrency)}`}>
                  <span className="oa-funnel-label">{s.stage}</span>
                  <div className="oa-track">
                    <div
                      className="oa-bar"
                      style={{ width: `${(s.count / maxCount) * 100}%`, background: STAGE_COLORS[s.stage as OpportunityStage] }}
                    />
                  </div>
                  <span className="oa-num" style={{ fontWeight: 800 }}>{s.count}</span>
                  <span className="oa-num oa-dim oa-c-2">{share === null ? '' : `${share}%`}</span>
                  <span className="oa-num">{money(s.value, mainCurrency)}</span>
                </div>
              );
            })}
          </div>
        )}
        <Foot>
          A snapshot of today's distribution, not a conversion funnel — stage history is not recorded,
          so no drop-off percentage is claimed between stages.
        </Foot>
      </Card>

      {/* Supporting grid */}
      <div className="oa-grid">
        {/* Loss reasons — Pareto */}
        <Card
          title="Why we lose"
          subtitle={reasons.bids
            ? `${reasons.totalCitations} reasons cited across ${reasons.bids} of ${reasons.lostTotal} lost bids`
            : 'No outcome record on any lost bid in this period'}
        >
          {reasons.rows.length === 0 ? (
            <Empty text={decided.lost.length === 0 ? 'No bids lost in this period.' : 'Capture the outcome on a lost bid to build this analysis.'} />
          ) : (
            <>
              <div style={{ display: 'grid', gap: 8 }}>
                {reasons.rows.map(r => (
                  <div key={r.reason} className="oa-reason-row" title={`${r.reason}: cited on ${r.cited} bids, primary on ${r.primary}`}>
                    <span className="oa-reason-label">{r.reason}</span>
                    <div className="oa-track">
                      <div className="oa-bar" style={{ width: `${(r.cited / reasons.max) * 100}%`, background: 'var(--oa-lost-soft)' }}>
                        {r.primary > 0 && (
                          <div className="oa-bar-inner" style={{ width: `${(r.primary / r.cited) * 100}%`, background: 'var(--oa-lost)' }} />
                        )}
                      </div>
                    </div>
                    <span className="oa-num" style={{ fontWeight: 800 }}>{r.cited}</span>
                    <span className="oa-num oa-dim oa-c-2">{r.cumulative}%</span>
                  </div>
                ))}
              </div>
              <div className="oa-legend">
                <span><i style={{ background: 'var(--oa-lost)' }} /> Primary reason</span>
                <span><i style={{ background: 'var(--oa-lost-soft)' }} /> Also cited</span>
                <span className="oa-dim">Right column = cumulative share of all citations</span>
              </div>
            </>
          )}
        </Card>

        {/* Outcome trend */}
        <Card
          title="Decisions over time"
          subtitle={trend.buckets.length ? `By ${trend.grouping} · win % printed above each column` : 'No decided bids in this period'}
        >
          {trend.buckets.length === 0 ? (
            <Empty text="Nothing has been decided in the selected period." />
          ) : (
            <>
              <div className="oa-cols">
                {trend.buckets.map(b => {
                  const total = b.won + b.lost + b.other;
                  return (
                    <div key={b.key} className="oa-col" title={`${b.label}: ${b.won} won, ${b.lost} lost, ${b.other} no bid / cancelled`}>
                      <span className="oa-col-rate">{b.rate === null ? '' : `${b.rate}%`}</span>
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
                <span><i style={{ background: 'var(--oa-won)' }} /> Won</span>
                <span><i style={{ background: 'var(--oa-lost)' }} /> Lost</span>
                <span><i style={{ background: 'var(--oa-none)' }} /> No bid / cancelled</span>
              </div>
            </>
          )}
        </Card>

        {/* Client / sector split */}
        <Card
          title={splitBy === 'client' ? 'By client' : 'By sector'}
          subtitle={`Decided bids in ${periodNote}${split.hidden ? ` · top 8 of ${split.rows.length + split.hidden}` : ''}`}
          action={
            <div className="oa-toggle">
              <button className={splitBy === 'client' ? 'on' : ''} onClick={() => setSplitBy('client')}>Client</button>
              <button className={splitBy === 'sector' ? 'on' : ''} onClick={() => setSplitBy('sector')}>Sector</button>
            </div>
          }
        >
          {split.rows.length === 0 ? (
            <Empty text="No decided bids in this period." />
          ) : (
            <>
              <div style={{ display: 'grid', gap: 8 }}>
                {split.rows.map(r => (
                  <div key={r.name} className="oa-reason-row" title={`${r.name}: ${r.won} won, ${r.lost} lost, ${r.other} no bid / cancelled · ${money(r.wonValue, mainCurrency)} won`}>
                    <span className="oa-reason-label">{r.name}</span>
                    <div className="oa-track">
                      <div className="oa-split" style={{ width: `${(r.total / Math.max(1, split.max)) * 100}%` }}>
                        {r.won > 0 && <span style={{ flex: r.won, background: 'var(--oa-won)' }} />}
                        {r.lost > 0 && <span style={{ flex: r.lost, background: 'var(--oa-lost)' }} />}
                        {r.other > 0 && <span style={{ flex: r.other, background: 'var(--oa-none)' }} />}
                      </div>
                    </div>
                    <span className="oa-num" style={{ fontWeight: 800 }}>{r.rate === null ? '—' : `${r.rate}%`}</span>
                    <span className="oa-num oa-dim oa-c-2">{r.total} bid{r.total === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
              <div className="oa-legend">
                <span><i style={{ background: 'var(--oa-won)' }} /> Won</span>
                <span><i style={{ background: 'var(--oa-lost)' }} /> Lost</span>
                <span><i style={{ background: 'var(--oa-none)' }} /> No bid / cancelled</span>
                <span className="oa-dim">% column = win rate (won ÷ decided)</span>
              </div>
            </>
          )}
        </Card>

        {/* Price gap */}
        <Card
          title="How far off was our price"
          subtitle={priceGap.count
            ? `${priceGap.count} of ${priceGap.lostTotal} lost bids have both prices recorded`
            : 'No lost bid in this period records our price and the winning price'}
        >
          {priceGap.count === 0 ? (
            <Empty text="Record our price and the winning price on a lost bid to see the gap." />
          ) : (
            <>
              <div className="oa-hero">
                <span className="oa-hero-value" style={{ color: (priceGap.median ?? 0) > 0 ? 'var(--oa-lost)' : 'var(--oa-won)' }}>
                  {priceGap.median === null ? '—' : `${priceGap.median > 0 ? '+' : ''}${priceGap.median}%`}
                </span>
                <span className="oa-hero-note">
                  median gap to the winning price{(priceGap.median ?? 0) > 0 ? ' — we bid above the winner' : ''}
                </span>
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {priceGap.buckets.map(b => (
                  <div key={b.label} className="oa-reason-row" title={`${b.label}: ${b.count} lost bids`}>
                    <span className="oa-reason-label">{b.label}</span>
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
          title="Bid-gate slippage"
          subtitle={slippage.rows.length ? 'Average days late per gate · negative = finished early' : 'No dated bid gates yet'}
          span
        >
          {errors.milestones ? (
            <Empty text={errors.milestones} />
          ) : slippage.rows.length === 0 ? (
            <Empty text="Seed the five bid gates on an opportunity and give them dates to track slippage." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {slippage.rows.map(r => {
                const late = r.avg > 0;
                const widthPct = (Math.abs(r.avg) / slippage.max) * 50;
                return (
                  <div key={r.title} className="oa-reason-row" title={`${r.title}: ${r.gates} gates, ${r.open} still open, worst ${r.worst}d`}>
                    <span className="oa-reason-label">{r.title}</span>
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
                    <span className="oa-num oa-dim oa-c-2">{r.gates} gate{r.gates === 1 ? '' : 's'}</span>
                  </div>
                );
              })}
            </div>
          )}
          <Foot>
            A finished gate is measured on the day it was completed; an unfinished one against today,
            so an open gate keeps ageing until it is ticked.
          </Foot>
        </Card>
      </div>

      {/* Detail table */}
      <Card
        title="Decided bids"
        subtitle={`${decided.list.length} decided in ${periodNote}${table.hidden ? ` · showing the ${table.rows.length} most recent` : ''}`}
      >
        {table.rows.length === 0 ? (
          <Empty text="No bids were decided in the selected period." />
        ) : (
          <div className="oa-tablewrap">
            <table className="oa-table">
              <thead>
                <tr>
                  <th>Decided</th>
                  <th>Opportunity</th>
                  <th>Client</th>
                  <th style={{ textAlign: 'end' }}>Value</th>
                  <th>Outcome</th>
                  <th>Primary reason</th>
                  <th style={{ textAlign: 'end' }}>Price gap</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map(({ o, f, date }) => (
                  <tr key={o.id}>
                    <td className="oa-num">{date || '—'}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{o.title}</span>
                      {o.serialNumber && <span className="oa-dim"> · {o.serialNumber}</span>}
                    </td>
                    <td>{o.client || '—'}</td>
                    <td className="oa-num" style={{ textAlign: 'end' }}>
                      {o.estimatedValue ? money(toNumber(o.estimatedValue), o.currency) : '—'}
                    </td>
                    <td>
                      <span className="oa-chip" style={{ background: STAGE_COLORS[o.stage] }}>{o.stage}</span>
                    </td>
                    <td>{f?.primaryReason || (f ? '—' : <span className="oa-dim">no record</span>)}</td>
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
          Values are summed as entered, without currency conversion — totals are labelled {mainCurrency},
          the currency used on most records.
          {appUser.role === 'Employee' ? '' : ' Open a bid from the Opportunities page to see or edit its outcome record.'}
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
      <div className="oa-kpi-value" style={{ color: toneColor }}>{value}</div>
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
   into a horizontal scroller and ellipsises every reason label. */
.oa-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(420px, 1fr)); gap:16px; margin-top:16px; }
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
