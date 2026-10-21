import React, { useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { millions, type BdData, type ExpiryFlag } from '../../lib/bdControl';
import { useFormat, DATE_MEDIUM } from '../../lib/format';

/** Chip / column labels for the grades on the CSA sheet; any other grade shows as written. */
export const GRADE_SHORT: Record<string, string> = {
  'General Manager': 'GM', 'Assistant GM': 'Asst GM', 'Department Manager': 'Dept Mgr',
  'Section Head': 'Section Head', 'Senior Engineer': 'Sr Eng', 'Operator': 'Operator',
};

/** Long lists on the browse tabs start this short. */
export const BROWSE_FIRST = 40;

const FLAG_LABEL: Record<ExpiryFlag, string> = {
  'Expired on paper': 'Expired on paper', 'Within 90 days': 'Ends within 90 days', 'Within 180 days': 'Ends within 180 days',
  OK: 'More than 6 months left', 'No date': 'No end date', Ended: 'Ended',
};
const FLAG_TONE: Record<ExpiryFlag, string> = {
  'Expired on paper': 'lo', 'Within 90 days': 'mid', 'Within 180 days': 'mid', OK: 'ok', 'No date': 'flat', Ended: 'flat',
};

/**
 * The ⓘ panel of the Analysis center tile a chart sits in (queue B1). A chart's
 * reading notes (AssumedKey) are drawn there instead of under the chart; with
 * no tile around (null) they stay under the chart.
 */
export const InfoSlot = React.createContext<HTMLElement | null>(null);

/** A list in an Analysis center tile shows this many rows; "Show all" opens the browse tab with every row (queue B2). */
export const TILE_FIRST = 5;

/**
 * A side line about a chart (what is left out, what has no date…). Inside a
 * dashboard tile it goes behind the ⓘ button with the reading notes, so the
 * chart keeps the whole tile (queue B2); with no tile it stays under the chart.
 */
export function TileFoot({ attr, children }: { attr: string; children: React.ReactNode }) {
  const slot = useContext(InfoSlot);
  const foot = <p className="bdc-foot" data-ac-foot={attr}>{children}</p>;
  return slot ? createPortal(foot, slot) : foot;
}

/** "Show all N" under a tile's first rows: opens the browse tab that lists every row. */
export function ShowAll({ total, onOpen, attr }: { total: number; onOpen: () => void; attr: string }) {
  const { t } = useTranslation();
  if (total <= TILE_FIRST) return null;
  return (
    <button type="button" className="btn btn-ghost btn-sm ac-more" onClick={onOpen} data-ac-more={attr}>
      {t('Show all {{count}}', { count: total })}
    </button>
  );
}

/** Grid row unit for useMasonry, px (matches `.is-masonry` in index.css). */
const MASONRY_ROW = 4;

/**
 * Packs a card grid with no tall holes (queue A2, Tariq: "no wide empty spaces
 * between charts"). A plain grid makes every card in a row as tall as the
 * tallest one; here each card spans as many 4 px rows as its own height needs,
 * so a short card sits right under the one above it. Re-measures whenever a card
 * or the grid changes size. Without ResizeObserver the grid stays a plain grid.
 */
export function useMasonry<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid || typeof ResizeObserver === 'undefined') return;
    grid.classList.add('is-masonry');
    const fit = () => {
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      for (const el of Array.from(grid.children) as HTMLElement[]) {
        const span = `span ${Math.max(1, Math.ceil((el.getBoundingClientRect().height + gap) / MASONRY_ROW))}`;
        if (el.style.gridRowEnd !== span) el.style.gridRowEnd = span;
      }
    };
    fit();
    // Next frame, so a re-fit never runs inside the observer's own loop.
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); });
    ro.observe(grid);
    for (const el of Array.from(grid.children)) ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  });
  return ref;
}

/** The words and number formats every browse tab shares (queue E6a). */
export function useBdWords(data: BdData) {
  const { t, i18n } = useTranslation();
  const F = useFormat();
  const ar = i18n.language === 'ar';
  const sep = ar ? '، ' : ', ';
  const clients = useMemo(() => new Map(data.clients.map(c => [c.code, c])), [data.clients]);
  const nameOf = (code: string) => (ar && clients.get(code)?.arabicName) || code;
  const egpM = (egp: number) => t('{{value}} m EGP', { value: F.number(millions(egp), { maximumFractionDigits: 1 }) });
  const egp = (v: unknown) => (typeof v === 'number' && isFinite(v) ? t('{{value}} EGP', { value: F.number(v, { maximumFractionDigits: 0 }) }) : null);
  const pct = (v: number | null) => v == null ? '—'
    : `${v > 0.05 ? '+' : v < -0.05 ? '−' : ''}${F.number(Math.abs(v), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const gapTone = (g: number | null) => (g == null ? 'flat' : g <= -25 ? 'lo' : g <= -10 ? 'mid' : g >= 10 ? 'hi' : 'flat');
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? F.date(v.slice(0, 10), DATE_MEDIUM) : null);
  const ends = (end: unknown, days: number | null) =>
    days == null || !end ? t('No expiry on file')
      : days === 0 ? t('Ends today')
        : days > 0 ? t('Ends {{date}} · days remaining: {{days}}', { date: date(end), days: F.number(days) })
          : t('Ended {{date}} · {{n}} days ago', { date: date(end), n: F.number(-days) });
  const flag = (f: ExpiryFlag) => <span className={`bdc-pill bdc-pill-${FLAG_TONE[f]}`} data-bdc-flag={f}>{t(FLAG_LABEL[f])}</span>;
  /** A value from the files: a known word is translated, anything else shown as written. */
  const word = (v: unknown) => { const s = String(v ?? '').trim(); return s ? t(s) : ''; };
  const bidi = (s: string) => <span className={F.bidiFor(s)}>{s}</span>;
  return { t, F, ar, sep, clients, nameOf, egpM, egp, pct, gapTone, date, ends, flag, word, bidi };
}

export function SearchBox({ value, onChange, placeholder, attr }: { value: string; onChange: (v: string) => void; placeholder: string; attr: string }) {
  const { t } = useTranslation();
  return (
    <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
      <Search size={16} style={{ position: 'absolute', insetInlineStart: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
      <input className="input" type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} data-bdc-search={attr}
        aria-label={placeholder} style={{ paddingInlineStart: 34, paddingInlineEnd: 34, width: '100%' }} />
      {value && (
        <button type="button" className="btn btn-ghost btn-icon" aria-label={t('Clear')} onClick={() => onChange('')}
          style={{ position: 'absolute', insetInlineEnd: 2, top: '50%', transform: 'translateY(-50%)' }}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function Chips<K extends string>({ options, value, onChange, attr, label }: {
  options: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void; attr: string; label: string;
}) {
  const F = useFormat();
  return (
    <div className="bdc-chips" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.key} type="button" className="bdc-chip" aria-pressed={o.key === value} onClick={() => onChange(o.key)} data-bdc-chip={`${attr}:${o.key}`}>
          {o.label}{o.count != null && <span className="bdc-chip-n">{F.number(o.count)}</span>}
        </button>
      ))}
    </div>
  );
}

/** Label / value pairs; empty values are left out. */
export function Fields({ items, attr }: { items: [string, React.ReactNode][]; attr?: string }) {
  const shown = items.filter(([, v]) => v != null && v !== '' && v !== false);
  if (!shown.length) return null;
  return (
    <dl className="bdc-dl" data-bdc-fields={attr}>
      {shown.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
    </dl>
  );
}

export function MoreButton({ shown, total, onMore, attr }: { shown: number; total: number; onMore: () => void; attr: string }) {
  const { t } = useTranslation();
  if (total <= shown) return null;
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onMore} data-bdc-more={attr} style={{ marginTop: 8 }}>
      {t('Show all {{count}}', { count: total })}
    </button>
  );
}

/** A round axis top at or above `max` and its step, so 3–5 gridlines fall on easy numbers (1, 2, 2.5, 5 × 10ⁿ). */
export function niceScale(max: number, target = 4): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 0.25 };
  const raw = max / target, pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find(m => m * pow >= raw) ?? 10) * pow;
  return { top: Math.ceil(max / step - 1e-9) * step, step };
}

/** One part of a whole for `Donut`: `tone` 1–4 picks the colour, `assumed` is how much of `value` is assumed (drawn pale). */
export type DonutPart = { key: string; name: string; sub?: string; value: number; text: string; tone: number; assumed?: number; title?: string };

/**
 * Parts of a whole as a donut with its legend (queue L3b2; the P3 donut made
 * shared). Each legend line keeps `data-ac-row` / `data-ac-key`, its name in
 * `.bdc-name > span` and its figure in `data-bdc-value`, like a list row.
 * The centre shows `centre` over `centreLabel`; `centreAttr` names it `data-ac-fig`.
 */
export function Donut({ parts, centre, centreLabel, centreAttr, label, attr }: {
  parts: DonutPart[]; centre: string; centreLabel: string; centreAttr?: string; label: string; attr: string;
}) {
  const F = useFormat();
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const R = 15.9155; // circumference 100, so a slice's length is its %
  const gap = parts.filter(p => p.value > 0).length > 1 ? 0.8 : 0;
  const share = (v: number) => (total ? (Math.max(0, v) / total) * 100 : 0);
  let at = 0;
  const arcs: React.ReactNode[] = [];
  for (const p of parts) {
    const len = Math.max(0, share(p.value) - gap);
    const pale = p.value > 0 ? len * Math.min(1, Math.max(0, p.assumed || 0) / p.value) : 0;
    [[len - pale, false], [pale, true]].forEach(([l, a], i) => {
      const off = at + (a ? len - pale : 0);
      if ((l as number) > 0) arcs.push(
        <circle key={`${p.key}-${i}`} cx="21" cy="21" r={R} className={`ac-slice ac-s${p.tone}${a ? ' ac-pale' : ''}`}
          strokeDasharray={`${l} ${100 - (l as number)}`} strokeDashoffset={25 - off} data-ac-part={p.key} {...(a ? { 'data-ac-assumed-seg': '' } : {})}>
          <title>{`${p.name}: ${p.text}`}</title>
        </circle>,
      );
    });
    at += share(p.value);
  }
  return (
    <div className="ac-donut-wrap">
      <svg viewBox="0 0 42 42" className="ac-donut" role="img" aria-label={label}>
        <circle cx="21" cy="21" r={R} className="ac-donut-hole" />
        {arcs}
        <text x="21" y="20.5" textAnchor="middle" className="ac-donut-n" style={centre.length > 5 ? { fontSize: centre.length > 7 ? 5 : 6.4 } : undefined}
          {...(centreAttr ? { 'data-ac-fig': centreAttr } : {})}>{centre}</text>
        <text x="21" y="26" textAnchor="middle" className="ac-donut-l">{centreLabel}</text>
      </svg>
      <ul className="ac-legend">
        {parts.map(p => (
          <li key={p.key} data-ac-row={attr} data-ac-key={p.key} title={p.title}>
            <span className={`bdc-key ac-s${p.tone}-bg${p.assumed && p.assumed >= p.value ? ' ac-pale' : ''}`} />
            <span className="bdc-name ac-legend-name"><span>{p.name}</span>{p.sub && <span className="bdc-sub">{p.sub}</span>}</span>
            <b data-bdc-value className={p.value ? undefined : 'bdc-zero'}>{p.text}</b>
            <span className="ac-legend-pct">{F.number(share(p.value), { maximumFractionDigits: 0 })}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One bar of a quarter column: its parts bottom first, and the figure printed on top of it. */
export type QuarterBar = { segs: { v: number; cls: string; assumed?: boolean }[]; label: string; zero?: boolean };

/**
 * Quarter columns as one plot (queue L3b, Tariq's Power BI photo): a value axis
 * with light gridlines behind every column, each figure on top of its own bar.
 * One bar per quarter, or two side by side (`ac-pair`). Every column keeps
 * `data-ac-row` / `data-ac-key`; its figures together are its `data-bdc-value`.
 */
export function QuarterPlot({ rows, label, attr, tick }: {
  rows: { quarter: string; bars: QuarterBar[] }[]; label: string; attr: string; tick: (v: number) => string;
}) {
  const { t } = useTranslation();
  const F = useFormat();
  const sum = (b: QuarterBar) => b.segs.reduce((a, s) => a + Math.max(0, s.v), 0);
  const { top, step } = niceScale(Math.max(0, ...rows.flatMap(r => r.bars.map(sum))));
  const k = Math.round(top / step);
  const pct = (v: number) => `${(v / top) * 100}%`;
  return (
    <div className="ac-cols ac-plot" style={{ ['--ac-n' as string]: rows.length, ['--ac-k' as string]: k }} role="img" aria-label={label}>
      <div className="ac-yaxis" aria-hidden="true">
        {Array.from({ length: k + 1 }, (_, i) => <span key={i} style={{ bottom: pct(i * step) }}>{tick(i * step)}</span>)}
      </div>
      {rows.map(r => (
        <div key={r.quarter} className="ac-col" data-ac-row={attr} data-ac-key={r.quarter}>
          <span className={`ac-col-bar${r.bars.length > 1 ? ' ac-pair' : ''}`} data-bdc-value>
            {r.bars.map((b, i) => {
              const n = sum(b);
              return (
                <span key={i} className="ac-bar" style={{ height: pct(n) }}>
                  <b className={`ac-bar-v${b.zero ? ' bdc-zero' : ''}`}>{b.label}</b>
                  {[...b.segs].reverse().map((s, j) => s.v > 0 && (
                    <span key={j} className={s.cls} style={{ height: `${(s.v / n) * 100}%` }} {...(s.assumed ? { 'data-ac-assumed-seg': '' } : {})} />
                  ))}
                </span>
              );
            })}
          </span>
          <span className="ac-col-l">{t('Q{{q}}', { q: F.number(Number(r.quarter.slice(-1))) })}<br />{r.quarter.slice(0, 4)}</span>
        </div>
      ))}
    </div>
  );
}
