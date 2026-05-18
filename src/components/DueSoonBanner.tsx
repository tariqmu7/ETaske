import React from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

export interface DueSoonEntry {
  id: string;
  type: 'Task' | 'Correspondence';
  title: string;
  due?: string;
  onClick: () => void;
}

/**
 * "Due Soon (Within 48h)" alert banner. Mirrors the styling of the Overview
 * dashboard banner so it reads identically wherever it appears. Renders nothing
 * when there are no items, so callers can drop it in unconditionally.
 */
export default function DueSoonBanner({ items }: { items: DueSoonEntry[] }) {
  if (items.length === 0) return null;

  return (
    <motion.div
      className="ov-duesoon"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ marginBottom: 28, background: '#fff7ed', border: '1px solid #ffedd5', padding: 20, borderRadius: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{ background: '#f97316', padding: 6, borderRadius: 0 }}>
          <AlertCircle className="w-4 h-4" style={{ color: '#fff' }} />
        </div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#9a3412', margin: 0 }}>Due Soon (Within 48h)</h2>
          <p style={{ fontSize: 12, color: '#c2410c', margin: 0 }}>Items that require immediate attention.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {items.slice(0, 4).map(item => (
          <div
            key={`${item.type}-${item.id}`}
            className="card"
            style={{
              padding: '12px 16px', background: '#fff', borderLeft: '4px solid #f97316',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'
            }}
            onClick={item.onClick}
          >
            <div style={{ flex: 1, marginRight: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', marginBottom: 2 }}>{item.type}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', lineHeight: 1.3 }}>{item.title}</div>
              {item.due && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Due: {item.due}</div>}
            </div>
            <ArrowRight className="w-4 h-4" style={{ color: '#94a3b8' }} />
          </div>
        ))}
        {items.length > 4 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#9a3412', background: 'rgba(249, 115, 22, 0.05)', padding: 12 }}>
            + {items.length - 4} more items due soon
          </div>
        )}
      </div>
    </motion.div>
  );
}
