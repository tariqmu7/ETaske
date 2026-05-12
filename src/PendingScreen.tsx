import React from 'react';
import { Clock } from 'lucide-react';

export default function PendingScreen() {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #eff6ff, #f0fdf4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 24, padding: '48px 40px', maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ width: 72, height: 72, background: '#fef3c7', border: '2px solid #fde68a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          <Clock style={{ width: 32, height: 32, color: '#d97706' }} />
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>Account Pending</h1>
        <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
          Your account is awaiting admin approval. You will gain access once an administrator approves your request.
        </p>
        <p style={{ marginTop: 24, fontSize: 12, color: '#94a3b8' }}>This page will update automatically.</p>
      </div>
    </div>
  );
}
