import { useCallback, useEffect, useState } from 'react';
import type { AppView } from '../App';

// All navigable views. Kept in sync with the AppView union in App.tsx.
// Used to validate a hash fragment before trusting it.
const KNOWN_VIEWS: AppView[] = [
  'home', 'correspondences', 'manager-inbox', 'tasks', 'archive',
  'admin', 'overview', 'announcements', 'due-soon', 'outlook-feed', 'projects',
];

const viewFromHash = (): AppView | null => {
  // Format: "#/tasks" (leading "#/" optional). Anything unknown -> null.
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  const view = raw.split('?')[0] as AppView;
  return KNOWN_VIEWS.includes(view) ? view : null;
};

/**
 * Local-state navigation, mirrored to the URL hash so the browser Back button,
 * page refresh, deep links and bookmarks all work — without adopting a full
 * router (the app's navigation model stays local state; see CLAUDE.md → App
 * shell & navigation). Hash routing also needs no server config, which suits
 * the static GitHub Pages deploy (`base: './'`).
 */
export function useHashRoute(initial: AppView): [AppView, (v: AppView) => void] {
  const [view, setViewState] = useState<AppView>(() => viewFromHash() ?? initial);

  // Ensure the URL reflects the initial view on first mount (e.g. landing with
  // no hash should still produce a bookmarkable "#/home").
  useEffect(() => {
    if (!viewFromHash()) {
      window.history.replaceState(null, '', `#/${view}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to Back/Forward and manual hash edits.
  useEffect(() => {
    const onHashChange = () => {
      const next = viewFromHash();
      if (next) setViewState(next);
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onHashChange);
    };
  }, []);

  const setView = useCallback((next: AppView) => {
    setViewState(next);
    if (viewFromHash() !== next) {
      window.location.hash = `/${next}`;
    }
  }, []);

  return [view, setView];
}
