// "Jump back in" — a tiny localStorage-backed ring of the most recently opened
// tasks / correspondences / projects, surfaced on the Home dashboard so the
// most common path (re-open the thing you were just on) is one click away.

export type RecentKind = 'task' | 'corresponding' | 'project';

export interface RecentItem {
  kind: RecentKind;
  id: string;
  label: string;      // taskName / subject / project name
  serial?: string;    // TK000001 / CR000001 / PR000001
  at: number;         // ms timestamp of last open
}

const KEY = 'etaske.recents.v1';
const MAX = 8;

const read = (): RecentItem[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const getRecents = (): RecentItem[] => read();

/** Record (or bump) a recently opened item. Most-recent first, de-duplicated. */
export const recordRecent = (item: Omit<RecentItem, 'at'>): void => {
  if (!item.id || !item.kind) return;
  const next: RecentItem = { ...item, label: item.label || item.serial || item.id, at: Date.now() };
  const list = read().filter(r => !(r.kind === next.kind && r.id === next.id));
  list.unshift(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    // Let any mounted listeners (e.g. Home) refresh without a full reload.
    window.dispatchEvent(new CustomEvent('etaske:recents'));
  } catch {
    /* storage full / disabled — non-fatal */
  }
};
