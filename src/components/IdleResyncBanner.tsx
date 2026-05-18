import { useEffect, useRef, useState } from 'react';
import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { RefreshCw, CheckCircle2 } from 'lucide-react';

// The whole app is already real-time (live onSnapshot listeners), so we never
// hard-reload — that would throw away scroll position, open panels and form
// state. Instead, after a long idle gap we briefly bounce the Firestore
// connection (disableNetwork → enableNetwork). That forces every active
// listener to re-sync fresh data from the server while leaving all React/UI
// state untouched, and we surface a small banner so the user knows they're
// looking at the latest. We skip the bounce while they're actively typing.

const IDLE_MS = 10 * 60 * 1000; // 10 minutes (chosen by the user)
const CHECK_MS = 30_000;

type Phase = 'active' | 'idle' | 'syncing' | 'done';

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  );
}

export default function IdleResyncBanner() {
  const [phase, setPhase] = useState<Phase>('active');
  const lastActivityRef = useRef(Date.now());
  const phaseRef = useRef<Phase>('active');
  const resyncingRef = useRef(false);
  phaseRef.current = phase;

  useEffect(() => {
    const markActive = () => { lastActivityRef.current = Date.now(); };

    const resync = async () => {
      // Synchronous guard: many activity events can fire in one tick before
      // React state (phase) updates, so a ref is what actually prevents
      // double-bouncing the connection.
      if (resyncingRef.current) return;
      // Honor "don't refresh while the user is adding info": defer until they
      // stop typing — data keeps streaming live in the meantime anyway.
      if (isTyping()) { setPhase('active'); return; }
      resyncingRef.current = true;
      setPhase('syncing');
      try {
        await disableNetwork(db);
        await enableNetwork(db);
      } catch {
        // Network bounce is best-effort; listeners reconnect on their own.
      }
      setPhase('done');
      setTimeout(() => {
        resyncingRef.current = false;
        setPhase('active');
      }, 2500);
    };

    const onActivity = () => {
      const wasIdle = phaseRef.current === 'idle';
      markActive();
      if (wasIdle) resync();
    };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const goneFor = Date.now() - lastActivityRef.current;
      markActive();
      if (phaseRef.current === 'idle' || goneFor >= IDLE_MS) resync();
    };

    const activityEvents: (keyof WindowEventMap)[] = [
      'mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart',
    ];
    activityEvents.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);

    const interval = setInterval(() => {
      if (phaseRef.current !== 'active') return;
      if (Date.now() - lastActivityRef.current >= IDLE_MS) setPhase('idle');
    }, CHECK_MS);

    return () => {
      activityEvents.forEach(ev => window.removeEventListener(ev, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, []);

  if (phase !== 'syncing' && phase !== 'done') return null;

  const syncing = phase === 'syncing';
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        borderRadius: 999,
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        boxShadow: '0 8px 20px -6px rgba(0,0,0,0.18)',
        fontSize: 13,
        fontWeight: 600,
        color: syncing ? '#475569' : '#16a34a',
        pointerEvents: 'none',
      }}
    >
      {syncing ? (
        <>
          <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} />
          Syncing latest updates…
        </>
      ) : (
        <>
          <CheckCircle2 size={15} />
          You're up to date
        </>
      )}
    </div>
  );
}
