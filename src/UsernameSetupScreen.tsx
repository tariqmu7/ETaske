import React, { useState } from 'react';

export default function UsernameSetupScreen({ onSave }: { onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    
    setSubmitting(true);
    try {
      await onSave(trimmed);
    } catch (err) {
      console.error(err);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-sm border border-neutral-200">
        <h2 className="text-2xl font-bold mb-2">Welcome!</h2>
        <p className="text-neutral-500 text-sm mb-6">Please choose a display name to continue to the application.</p>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Display Name
            </label>
            <input 
              type="text" 
              className="w-full px-4 py-2 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-neutral-900" 
              value={name} 
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Jane Doe"
              disabled={submitting}
              autoFocus
              required
            />
          </div>
          <button 
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-neutral-900 text-white rounded-xl font-medium hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-neutral-900 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
