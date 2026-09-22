import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Tag, XCircle, MessageCircleWarning, Lightbulb, Gavel, ChevronDown, ChevronUp } from 'lucide-react';
import { useFormat, DATE_MEDIUM } from '../../lib/format';
import { useDisplayLabel } from '../../lib/displayLabel';
import type { ClientMemory, BidRef, MemoryRow, DroppedBid } from '../../lib/decisionMemory';

/** yyyy-mm-dd → a local Date (new Date('yyyy-mm-dd') would be UTC midnight). */
const localDate = (isoDay: string) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const SHOW_FIRST = 4;

interface Props {
  memory: ClientMemory;
  /** Opens one of the earlier bids (on its Decisions tab). */
  onOpenBid: (bid: BidRef) => void;
}

/**
 * "Earlier with this client" (queue D6) — what the client's OTHER bids
 * remember: the last price we offered, why bids were lost or dropped, what they
 * objected to and what we learned. Drawn on a bid's Decisions tab and on the
 * client file; the thinking is in `lib/decisionMemory.ts`.
 */
export default function EarlierWithClient({ memory, onOpenBid }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const dl = useDisplayLabel();
  const [more, setMore] = useState<Record<string, boolean>>({});

  if (memory.empty) {
    return (
      <p data-memory="empty" style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
        {memory.bidCount
          ? t('Nothing has been recorded on the earlier bids with this client yet — no prices, reasons or objections.')
          : t('No earlier bids with this client.')}
      </p>
    );
  }

  const day = (d?: string) => (d ? fmt.date(localDate(d), DATE_MEDIUM) : '');
  const money = (r: { amount?: number; currency?: string }) => fmt.money(r.amount ?? null, r.currency);
  const lp = memory.lastPrice;

  const BidLink = ({ bid }: { bid: BidRef }) => (
    <button
      type="button"
      onClick={() => onOpenBid(bid)}
      data-memory="bid-link"
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--blue-600)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, textAlign: 'start' }}
    >
      {bid.serial && <span className="ltr-data">{bid.serial}</span>}{bid.serial ? ' · ' : ''}<span dir="auto">{bid.title || '—'}</span>
    </button>
  );

  const Block = ({ id, icon, title, count, children }: { id: string; icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) => (
    <div data-memory={`block-${id}`} style={{ display: 'grid', gap: 8 }}>
      <h4 style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: 0 }}>
        <span style={{ color: 'var(--blue-600)', display: 'flex' }}>{icon}</span>{title}
        <span className="ltr-data" style={{ color: 'var(--text-muted)' }}>{count}</span>
      </h4>
      {children}
    </div>
  );

  function limited<T>(id: string, list: T[], draw: (x: T, i: number) => React.ReactNode) {
    const shown = more[id] ? list : list.slice(0, SHOW_FIRST);
    return (
      <>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>{shown.map(draw)}</ul>
        {list.length > SHOW_FIRST && (
          <button
            type="button"
            data-memory={`more-${id}`}
            onClick={() => setMore(m => ({ ...m, [id]: !m[id] }))}
            style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 0', cursor: 'pointer', background: 'none', border: 'none', color: 'var(--blue-600)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}
          >
            {more[id] ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {more[id] ? t('Show fewer') : t('Show all {{count}}', { count: list.length })}
          </button>
        )}
      </>
    );
  }

  const item: React.CSSProperties = { padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'grid', gap: 3, minWidth: 0 };
  const meta: React.CSSProperties = { fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' };
  const body: React.CSSProperties = { fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.45, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' };

  const Line = ({ r, answerLabel }: { r: MemoryRow & { bid: BidRef }; answerLabel?: string }) => (
    <li style={item} data-memory="row">
      <div dir="auto" style={body}>{r.text}</div>
      {r.why && <div dir="auto" style={{ ...body, fontSize: 12.5, color: 'var(--text-secondary)' }}>{answerLabel}: <bdi>{r.why}</bdi></div>}
      <div style={meta}><BidLink bid={r.bid} />{r.date && <span>· {day(r.date)}</span>}{r.by && <span dir="auto">· {r.by}</span>}</div>
    </li>
  );

  const dropLine = (d: DroppedBid) => (
    <li key={d.bid.id} style={item} data-memory="dropped">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: d.stage === 'Lost' ? '#b91c1c' : '#64748b', padding: '1px 7px' }}>{dl(d.stage)}</span>
        <BidLink bid={d.bid} />
        {d.date && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>· {day(d.date)}</span>}
      </div>
      {d.reasons.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} data-memory="reasons">
          {d.reasons.map((r, i) => (
            <span key={r} style={{ fontSize: 11.5, fontWeight: i === 0 ? 700 : 500, padding: '1px 7px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}>{dl(r)}</span>
          ))}
        </div>
      )}
      {d.said && <div dir="auto" style={body}><bdi>{d.said}</bdi>{d.saidWhy ? <> — <bdi>{d.saidWhy}</bdi></> : ''}</div>}
      {(d.competitor || typeof d.gapPercent === 'number') && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {d.competitor && <>{t('Won by')}: <span dir="auto">{d.competitor}</span></>}
          {d.competitor && typeof d.gapPercent === 'number' && ' · '}
          {typeof d.gapPercent === 'number' && (d.gapPercent > 0
            ? t('Our price was {{pct}} higher', { pct: fmt.percent(d.gapPercent, 1) })
            : d.gapPercent < 0
              ? t('Our price was {{pct}} lower', { pct: fmt.percent(Math.abs(d.gapPercent), 1) })
              : t('Same price as the winner'))}
        </div>
      )}
    </li>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }} data-memory="box">
      {lp && (
        <div data-memory="last-price" style={{ padding: '10px 12px', background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.25)', display: 'grid', gap: 2 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)' }}>{t('Last price we offered them')}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
            <span className="ltr-data" data-memory="last-price-amount">{money(lp)}</span>
          </div>
          <div style={meta}>
            <BidLink bid={lp.bid} />{lp.date && <span>· {day(lp.date)}</span>}
            {lp.text && <span dir="auto">· {lp.text}</span>}
            {lp.source === 'outcome' && <span>· {t('final price, from the Outcome tab')}</span>}
          </div>
        </div>
      )}

      {memory.dropped.length > 0 && (
        <Block id="dropped" icon={<XCircle size={14} />} title={t('Why earlier bids were lost or dropped')} count={memory.dropped.length}>
          {memory.reasonTally[0]?.count >= 2 && (
            <p data-memory="tally" style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
              {t('Most common reason')}: <strong>{dl(memory.reasonTally[0].reason)}</strong> ({memory.reasonTally[0].count})
            </p>
          )}
          {limited('dropped', memory.dropped, dropLine)}
        </Block>
      )}

      {memory.objections.length > 0 && (
        <Block id="objections" icon={<MessageCircleWarning size={14} />} title={t('What they objected to')} count={memory.objections.length}>
          {limited('objections', memory.objections, r => <Line key={r.key} r={r} answerLabel={t('Our answer')} />)}
        </Block>
      )}

      {memory.lessons.length > 0 && (
        <Block id="lessons" icon={<Lightbulb size={14} />} title={t('What we learned')} count={memory.lessons.length}>
          {limited('lessons', memory.lessons, r => <Line key={r.key} r={r} />)}
        </Block>
      )}

      {memory.decisions.length > 0 && (
        <Block id="decisions" icon={<Gavel size={14} />} title={t('Decisions on their bids')} count={memory.decisions.length}>
          {limited('decisions', memory.decisions, r => <Line key={r.key} r={r} answerLabel={t('Why')} />)}
        </Block>
      )}

      {memory.prices.length > 1 && (
        <Block id="prices" icon={<Tag size={14} />} title={t('Prices we offered them')} count={memory.prices.length}>
          {limited('prices', memory.prices, r => (
            <li key={r.key} style={{ ...item, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }} data-memory="price">
              <span className="ltr-data" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{money(r)}</span>
              <span style={meta}><BidLink bid={r.bid} />{r.date && <span>· {day(r.date)}</span>}</span>
            </li>
          ))}
        </Block>
      )}
    </div>
  );
}

/** The heading icon both hosts use. */
export const MemoryIcon = History;
