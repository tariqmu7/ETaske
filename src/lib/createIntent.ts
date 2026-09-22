// "Create this record, already filled in" bus (queue task B1).
//
// The same shape as src/lib/deepLink.ts, and for the same reason: navigation is
// local state, so a page that wants ANOTHER board to open its create form hands
// the prefill over here and switches the view. The target board picks it up
// when it mounts (`consumeCreateIntent`) or reacts live if it is already
// mounted (`subscribeCreate`).
//
// Two producers: the Outlook Feed, turning an accepted mail suggestion into a
// bid or a correspondence, and the one-box capture on Home (QuickCapture, queue
// C1). Tasks do not need this — both own a CreateTaskPanel of their own.

import type { CorrespondingCategory, TaskPriority } from '../types';

export interface OpportunityPrefill {
  title: string;
  client?: string;
  tenderNumber?: string;
  /** ISO yyyy-mm-dd */
  submissionDeadline?: string;
  scope?: string;
}

export interface CorrespondingPrefill {
  subject: string;
  body?: string;
  sentFrom?: string;
  category?: CorrespondingCategory;
  priority?: TaskPriority;
  /** ISO yyyy-mm-dd */
  deadline?: string;
  dateReceived?: string;
}

export type CreateIntent =
  | { type: 'opportunity'; prefill: OpportunityPrefill }
  | { type: 'corresponding'; prefill: CorrespondingPrefill };

let pending: CreateIntent | null = null;
const listeners = new Set<(intent: CreateIntent) => void>();

/** Ask a board to open its create form prefilled. Navigate right after. */
export function requestCreate(intent: CreateIntent) {
  pending = intent;
  listeners.forEach(fn => fn(intent));
}

/**
 * A board mounting grabs an intent aimed at it. Returns it once, then clears.
 * Overloaded rather than generic so each caller gets its own prefill type —
 * a generic `Extract<…>` stays unresolved and will not narrow.
 */
export function consumeCreateIntent(type: 'opportunity'): OpportunityPrefill | null;
export function consumeCreateIntent(type: 'corresponding'): CorrespondingPrefill | null;
export function consumeCreateIntent(
  type: CreateIntent['type'],
): OpportunityPrefill | CorrespondingPrefill | null {
  if (pending && pending.type === type) {
    const { prefill } = pending;
    pending = null;
    return prefill;
  }
  return null;
}

/** Subscribe to intents raised while the board is already mounted. */
export function subscribeCreate(fn: (intent: CreateIntent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
