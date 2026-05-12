import React from 'react';
import { XCircle } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from './lib/firebase';

export default function RejectedScreen() {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #eff6ff, #fff1f2)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 24, padding: '48px 40px', maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ width: 72, height: 72, background: '#fee2e2', border: '2px solid #fecaca', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          <XCircle style={{ width: 32, height: 32, color: '#dc2626' }} />
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>Access Denied</h1>
        <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
          Your account access request has been rejected. Please contact your administrator for assistance.
        </p>
        <button
          onClick={() => signOut(auth)}
          className="btn btn-ghost"
          style={{ marginTop: 24 }}
        >
          Sign out & try another account
        </button>
      </div>
    </div>
  );
}
