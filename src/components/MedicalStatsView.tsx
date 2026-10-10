import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import {
  MEDICAL_STATUSES, STAT_BUCKETS, STATUS_BADGE, medicalStats,
  type DatedContract, type MedicalContract, type MedicalStatus, type StatBucket, type StatRow,
} from '../lib/medicalContracts';
import { useFormat, DATE_MEDIUM } from '../lib/format';

interface Props {
  all: MedicalContract[];
  today: string;
  statusLabel: Record<MedicalStatus, string>;
  /** Open one contract's window. */
  onOpen: (id: string) => void;
  /** Go to the board at this governorate (and area, when given). */
  onPlace: (governorate: string, area?: string) => void;
  /** Go to the board filtered to this type. */
  onType: (type: string) => void;
}

/** Legend + direct-label keys per bucket. */
const BUCKET_LABEL: Record<StatBucket, string> = {
  inForce: 'In force',
  endingSoon: 'Ending soon',
  expired: 'Expired',
  other: 'Other: being renewed, not signed or no end date',
};
const BUCKET_COUNT: Record<StatBucket, string> = {
  inForce: 'In force: {{count}}',
  endingSoon: 'Ending soon: {{count}}',
  expired: 'Expired: {{count}}',
  other: 'Other: {{count}}',
};

/** Long lists start short. */
const FIRST = 10;

/**
 * Medical contracts statistics (queue M5) — the "Statistics" tab of the
 * Medical contracts page. Always the WHOLE book as of today (the board's
 * filters do not apply — a figure that silently follows a search box reads as
 * complete and is not). Every bar is labelled with its numbers, not colour
 * alone. Clicking a governorate, area or type opens that place on the board;
 * clicking a contract opens its window.
 */
export default function MedicalStatsView({ all, today, statusLabel, onOpen, onPlace, onType }: Props) {
  const { t } = useTranslation();
  const F = useFormat();
  const s = useMemo(() => medicalStats(all, today), [all, today]);
  const [allAreas, setAllAreas] = useState(false);
  const [allExpired, setAllExpired] = useState(false);
  const pct = (n: number) => F.percent(s.total ? (n / s.total) * 100 : 0);

  const segments = (r: { total: number; buckets: Record<StatBucket, number> }) => (
    STAT_BUCKETS.filter(b => r.buckets[b] > 0).map(b => (
      <span key={b} className={`ms-seg ms-${b}`} style={{ flexGrow: r.buckets[b] }} data-ms-seg={b} />
    ))
  );
  const breakdown = (r: StatRow) => STAT_BUCKETS.filter(b => r.buckets[b] > 0)
    .map(b => t(BUCKET_COUNT[b], { count: r.buckets[b] })).join(' · ');

  const barList = (rows: StatRow[], attr: string, onPick: (r: StatRow) => void, nameOf: (r: StatRow) => string) => {
    const max = Math.max(1, ...rows.map(r => r.total));
    return (
      <div style={{ display: 'grid', gap: 4 }}>
        {rows.map(r => (
          <button key={(r.governorate || '') + '|' + r.key} type="button" className="ms-row" onClick={() => onPick(r)} data-ms-row={attr} data-ms-key={r.key}>
            <span className="ms-row-name">
              <span className={F.bidiFor(nameOf(r))}>{nameOf(r)}</span>
              <span className="ms-row-sub">{breakdown(r)}</span>
            </span>
            <span className="ms-row-bar"><span className="ms-bar" style={{ width: `${(r.total / max) * 100}%` }}>{segments(r)}</span></span>
            <span className="ms-row-num" data-ms-total>{F.number(r.total)}</span>
            <ChevronRight size={15} className="ms-row-go" aria-hidden />
          </button>
        ))}
      </div>
    );
  };

  const datedList = (items: DatedContract[], attr: string, line: (d: DatedContract) => string) => (
    <div style={{ display: 'grid', gap: 2 }}>
      {items.map(d => (
        <button key={d.c.id} type="button" className="ms-row ms-row-dated" onClick={() => onOpen(d.c.id)} data-ms-contract={attr} data-ms-id={d.c.id}>
          <span className="ms-row-name">
            <span className={F.bidiFor(d.c.provider)}>{d.c.provider}</span>
            <span className="ms-row-sub">{d.c.type} · {d.c.governorate}{d.c.area ? ` › ${d.c.area}` : ''}</span>
          </span>
          <span className="ms-row-when">{line(d)}</span>
          <ChevronRight size={15} className="ms-row-go" aria-hidden />
        </button>
      ))}
    </div>
  );

  const section = (title: string, attr: string, body: React.ReactNode, wide = false) => (
    <section className="card ms-card" data-ms-section={attr} style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <h2 className="ms-h">{title}</h2>
      {body}
    </section>
  );

  const tiles: { key: string; label: string; value: number; tone?: string }[] = [
    { key: 'total', label: t('All contracts'), value: s.total },
    { key: 'inForce', label: t('In force'), value: s.buckets.inForce },
    { key: 'endingSoon', label: t('Ending in 60 days'), value: s.endingSoon.length, tone: 'var(--surface-warn-text)' },
    { key: 'expired', label: t('Expired, not renewed'), value: s.expired.length, tone: '#b91c1c' },
    { key: 'check', label: t('Needs check'), value: s.needsCheck, tone: 'var(--blue-400)' },
  ];

  const areas = allAreas ? s.areas : s.areas.slice(0, FIRST);
  const expired = allExpired ? s.expired : s.expired.slice(0, FIRST);
  const more = (shown: boolean, count: number, toggle: () => void, attr: string) => count > FIRST && (
    <button type="button" className="btn btn-ghost btn-sm" onClick={toggle} data-ms-more={attr} style={{ marginTop: 6 }}>
      {shown ? t('Show fewer') : t('Show all {{count}}', { count })}
    </button>
  );

  return (
    <div className="ms" data-medical="stats">
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.55 }}>
        {t('Every figure counts all contracts as of today; the filters on the board do not apply here.')}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
        {tiles.map(k => (
          <div key={k.key} className="card" style={{ padding: '10px 12px' }} data-ms-tile={k.key}>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.value > 0 && k.tone ? k.tone : 'var(--text-primary)' }}>{F.number(k.value)}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div className="ms-grid">
        {section(t('Status of every contract'), 'status', (
          <>
            <div className="ms-bar ms-bar-big" data-ms-total-bar>{segments(s)}</div>
            <ul className="ms-legend">
              {STAT_BUCKETS.map(b => (
                <li key={b} data-ms-legend={b}><span className={`ms-key ms-${b}`} aria-hidden />{t(BUCKET_LABEL[b])}: <b>{F.number(s.buckets[b])}</b> ({pct(s.buckets[b])})</li>
              ))}
            </ul>
            <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
              {MEDICAL_STATUSES.filter(st => s.byStatus[st] > 0).map(st => (
                <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }} data-ms-status={st}>
                  <span className={`badge ${STATUS_BADGE[st]}`}>{t(statusLabel[st])}</span>
                  <span style={{ flex: 1 }} />
                  <b>{F.number(s.byStatus[st])}</b>
                  <span style={{ color: 'var(--text-muted)', minWidth: 42, textAlign: 'end' }}>{pct(s.byStatus[st])}</span>
                </div>
              ))}
            </div>
          </>
        ))}

        {section(t('Contracts by governorate'), 'governorate',
          barList(s.byGovernorate, 'governorate', r => onPlace(r.key), r => r.key || t('No governorate')))}

        {section(t('Ending in the next 60 days'), 'ending', s.endingSoon.length === 0
          ? <p className="ms-empty" data-ms-empty="ending">{t('No contract ends in the next 60 days.')}</p>
          : datedList(s.endingSoon, 'ending', d => (d.days === 0 ? t('Ends today')
            : t('Ends {{date}} · days remaining: {{days}}', { date: F.date(d.c.endDate, DATE_MEDIUM), days: d.days }))))}

        {section(t('Expired and not being renewed'), 'expired', s.expired.length === 0
          ? <p className="ms-empty" data-ms-empty="expired">{t('No expired contract is waiting for renewal.')}</p>
          : <>
              {datedList(expired, 'expired', d => t('Ended {{date}}', { date: F.date(d.c.endDate, DATE_MEDIUM) }))}
              {more(allExpired, s.expired.length, () => setAllExpired(v => !v), 'expired')}
            </>)}

        {section(t('Areas ranked by number of contracts'), 'areas', (
          <>
            {barList(areas, 'area', r => onPlace(r.governorate || '', r.key),
              r => `${r.key || t('Area not named yet')} · ${r.governorate || t('No governorate')}`)}
            {more(allAreas, s.areas.length, () => setAllAreas(v => !v), 'areas')}
          </>
        ))}

        {section(t('Contracts by type'), 'type', barList(s.byType, 'type', r => onType(r.key), r => r.key || '—'))}
      </div>
    </div>
  );
}
