import React, { useMemo } from 'react';
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
