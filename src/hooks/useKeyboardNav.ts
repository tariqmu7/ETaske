import { useEffect } from 'react';
import type { AppView } from '../App';

// Power-user "go to" shortcuts, Gmail-style: press `g` then a letter.
// Also exposes the command palette (Ctrl/Cmd+K or `/`) via onOpenPalette.
const GO_MAP: Record<string, AppView> = {
  h: 'home',
  t: 'tasks',
  c: 'correspondences',
  i: 'manager-inbox',
  o: 'overview',
  p: 'projects',
  a: 'archive',
  n: 'announcements',
  d: 'due-soon',
  u: 'admin',
};

const isTypingTarget = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
};

interface Options {
  onNavigate: (v: AppView) => void;
  onOpenPalette: () => void;
  onShowHelp?: () => void;
}

export function useKeyboardNav({ onNavigate, onOpenPalette, onShowHelp }: Options) {
  useEffect(() => {
    let awaitingGo = false;
    let goTimer: ReturnType<typeof setTimeout> | null = null;

    const clearGo = () => {
      awaitingGo = false;
      if (goTimer) { clearTimeout(goTimer); goTimer = null; }
    };

    const handler = (e: KeyboardEvent) => {
      // Command palette: Cmd/Ctrl+K from anywhere.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Everything below is single-key and must not fire while typing or with
      // modifiers held (so it never clobbers browser/OS shortcuts).
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) {
        clearGo();
        return;
      }

      // "/" focuses search — open the palette, the app-wide search surface.
      if (e.key === '/') {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      if (e.key === '?' && onShowHelp) {
        e.preventDefault();
        onShowHelp();
        return;
      }

      if (awaitingGo) {
        const target = GO_MAP[e.key.toLowerCase()];
        clearGo();
        if (target) {
          e.preventDefault();
          onNavigate(target);
        }
        return;
      }

      if (e.key.toLowerCase() === 'g') {
        awaitingGo = true;
        goTimer = setTimeout(clearGo, 1200);
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      clearGo();
    };
  }, [onNavigate, onOpenPalette, onShowHelp]);
}
