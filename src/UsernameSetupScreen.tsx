import React, { useState } from 'react';
import { User, Phone } from 'lucide-react';

export default function UsernameSetupScreen({ onSave }: { onSave: (name: string, phoneNumber: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSave(trimmed, phoneNumber.trim());
    } catch (err) {
      console.error(err);
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #2563eb 0%, #14b8a6 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 24,
        padding: '40px 36px',
        width: '100%',
        maxWidth: 420,
        boxShadow: '0 25px 60px rgba(0,0,0,0.18)',
      }}>
        <div style={{
          width: 52, height: 52,
          background: 'linear-gradient(135deg, #2563eb, #14b8a6)',
          borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <User style={{ width: 22, height: 22, color: '#fff' }} />
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', textAlign: 'center', marginBottom: 6 }}>
          Welcome!
        </h2>
        <p style={{ color: '#64748b', fontSize: 14, textAlign: 'center', marginBottom: 28 }}>
          Please enter your details to continue.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="input-label">Display Name</label>
            <div style={{ position: 'relative' }}>
              <User style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: '#94a3b8' }} />
              <input
                type="text"
                className="input"
                style={{ paddingLeft: 40 }}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Jane Doe"
                disabled={submitting}
                autoFocus
                required
              />
            </div>
          </div>

          <div>
            <label className="input-label">WhatsApp Phone Number</label>
            <div style={{ position: 'relative' }}>
              <Phone style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: '#94a3b8' }} />
              <input
                type="tel"
                className="input"
                style={{ paddingLeft: 40 }}
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                placeholder="e.g. +201000000000"
                disabled={submitting}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px', marginTop: 4 }}
          >
            {submitting
              ? <span className="spinner" style={{ width: 18, height: 18 }} />
              : 'Continue →'}
          </button>
        </form>
      </div>
    </div>
  );
}
