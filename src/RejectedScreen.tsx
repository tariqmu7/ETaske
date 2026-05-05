import React from 'react';
import { signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import { XCircle, LogOut } from 'lucide-react';

export default function RejectedScreen() {
  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-neutral-100 overflow-hidden p-8 text-center">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <XCircle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-neutral-900 mb-2">Access Denied</h2>
        <p className="text-neutral-500 mb-8">
          Your account request has been rejected by the administrator. Please contact IT support if you believe this is an error.
        </p>
        
        <button
          onClick={() => signOut(auth)}
          className="flex items-center justify-center gap-2 w-full py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl font-medium transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
