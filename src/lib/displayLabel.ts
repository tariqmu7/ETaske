/**
 * The enum display-label layer. Task 6 of the Arabic locale queue.
 *
 * ── Why this is one function and not a lookup table per enum ────────────────
 * Task 5 settled the rule the whole locale rests on: **the i18next key IS the
 * English word**. So a status word hard-coded as UI copy (a stat-card label, a
 * filter tab, an `<option>`) and the SAME word arriving from Firestore as
 * `task.status` land on the same key. A per-enum map would have created a
 * second mechanism and a second place for the two to drift apart.
 *
 * ── Why a miss is safe ──────────────────────────────────────────────────────
 * i18next echoes the key back when there is no translation, and the key is the
 * English text — so an unknown value renders exactly as it does today. That
 * matters because several of these "enums" are not closed sets: `category`,
 * `department` and `subCategory` accept free text the user typed (a real
 * department name, an Arabic one, "Other..."), and `sector` / `client` are
 * pure free text. Those pass through untouched instead of blowing up.
 *
 * ── What is deliberately NOT translated ─────────────────────────────────────
 * The stored value. `displayLabel` is a render-time projection only — every
 * write, filter, query, badge class and analytics bucket keeps the English
 * string. See the header of `format.ts` for the same rule on dates/numbers.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

/**
 * Display text for a value stored in Firestore. Empty in, empty out (so a
 * caller can keep using `{x && <span>…</span>}`).
 */
export const displayLabel = (t: TFunction, value?: string | null): string => {
  const v = (value ?? '').trim();
  if (!v) return '';
  return t(v);
};

/** `displayLabel` bound to the active translator, for use inside components. */
export function useDisplayLabel() {
  const { t } = useTranslation();
  return useCallback((value?: string | null) => displayLabel(t, value), [t]);
}
