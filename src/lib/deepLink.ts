// Lightweight in-app deep-link bus.
//
// Used when a chat message references a Task or Correspondence: ChatBox calls
// `requestOpen(...)` and switches the active view; the target dashboard either
// picks up the pending request when it mounts (`consumePending`) or reacts live
// while already mounted (`subscribeOpen`). This avoids a router and keeps the
// existing local-state navigation model (see CLAUDE.md → App shell & navigation).

import { recordRecent } from './recents';

export type DeepLinkRef = {
  type: 'task' | 'corresponding';
  id: string;
  // Optional display metadata. When present it feeds the "Jump back in"
  // recents list (src/lib/recents.ts); callers without it (e.g. a bare
  // notification) simply don't contribute a label.
  label?: string;
  serial?: string;
};

let pending: DeepLinkRef | null = null;
const listeners = new Set<(ref: DeepLinkRef) => void>();

/** Request that a task/correspondence be opened. Navigate to the matching view
 *  right after calling this. */
export function requestOpen(ref: DeepLinkRef) {
  pending = ref;
  if (ref.label) {
    recordRecent({ kind: ref.type, id: ref.id, label: ref.label, serial: ref.serial });
  }
  listeners.forEach(fn => fn(ref));
}

/** A dashboard mounting (or its data finishing loading) calls this to grab a
 *  request aimed at it. Returns the id once, then clears it. */
export function consumePending(type: DeepLinkRef['type']): string | null {
  if (pending && pending.type === type) {
    const { id } = pending;
    pending = null;
    return id;
  }
  return null;
}

/** Subscribe to live open requests while a dashboard is already mounted. */
export function subscribeOpen(fn: (ref: DeepLinkRef) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Which dashboard a notification type points at (mirrors Sidebar's routing). */
export function refTypeForNotification(type: string): DeepLinkRef['type'] | null {
  if (type.includes('task') || type.includes('milestone')) return 'task';
  if (type.includes('correspond')) return 'corresponding';
  return null;
}

const viewForType = (type: DeepLinkRef['type']) =>
  type === 'task' ? 'tasks' : 'correspondences';

/**
 * Absolute URL that opens one record. Shared out of the app (Telegram DMs,
 * FCM pushes), so it must survive a cold load: the "#/<view>" part is picked up
 * by useHashRoute, and "?open=<id>" by readHashOpenRef below.
 */
export function buildDeepLinkUrl(type: DeepLinkRef['type'], id: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/${viewForType(type)}?open=${encodeURIComponent(id)}`;
}

/** Parse "#/tasks?open=<id>" from the current URL. Null if absent/unknown. */
export function readHashOpenRef(): DeepLinkRef | null {
  const [view, qs] = window.location.hash.replace(/^#\/?/, '').split('?');
  if (!qs) return null;
  const id = new URLSearchParams(qs).get('open');
  if (!id) return null;
  if (view === 'tasks' || view === 'archive') return { type: 'task', id };
  if (view === 'correspondences' || view === 'manager-inbox') return { type: 'corresponding', id };
  return null;
}
