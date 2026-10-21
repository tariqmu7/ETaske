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
