/**
 * Language-aware display formatting: enum labels, dates, numbers, money and
 * relative time. Task 6 of the Arabic locale queue.
 *
 * ── The one rule this file exists to enforce ────────────────────────────────
 * NOTHING here ever changes what is written to Firestore. A status, priority,
 * stage or role is stored as its English value forever; these helpers only
 * decide how that value is PAINTED. Arabic must never reach the database —
 * two users on the same board can be running different languages, and the
 * security rules, the filters and the analytics all compare English values.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Language } from '../i18n';
import { parseAmount } from '../utils';

// ─── Locale selection ────────────────────────────────────────────────────────

/**
 * ★ Arabic formats through `ar-EG-u-nu-latn`, NOT plain `ar-EG`.
 *
 * The default numbering system for `ar-EG` is Arabic-Indic (٢٠٢٦, ١٥/٠٨), and
 * this is a business dashboard: amounts, counts and dates are read alongside
 * English contracts and Outlook mail and compared by eye. `-u-nu-latn` keeps
 * Western digits while still giving Arabic month and weekday names (أغسطس,
 * the Egyptian form — never the Levantine آب).
 */
export const intlLocale = (lang: Language): string =>
  lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';

/**
 * A purely NUMERIC date (15/08/2026) carries no language, so it stays `en-GB`
 * in both. Going through `ar-EG` for it would gain nothing and would inject
 * RIGHT-TO-LEFT MARK (U+200F) separators into the string, which then fight the
 * `.ltr-data` isolation the RTL sweep put on every date span. Only formats
 * that ask for a month or weekday NAME are localized — those are the ones with
 * words in them.
 */
const numericOnly = (opts: Intl.DateTimeFormatOptions): boolean =>
  opts.month !== 'short' && opts.month !== 'long' &&
  opts.weekday !== 'short' && opts.weekday !== 'long';

const dateLocale = (lang: Language, opts: Intl.DateTimeFormatOptions): string =>
  numericOnly(opts) ? 'en-GB' : intlLocale(lang);

// ─── Coercion ────────────────────────────────────────────────────────────────

/** Firestore Timestamp | Date | millis | ISO/date string -> Date, or null. */
export type DateLike = { toDate?: () => Date } | Date | number | string | null | undefined;

export const toDate = (value: DateLike): Date | null => {
  if (value == null || value === '') return null;
  let d: Date;
  if (value instanceof Date) d = value;
  else if (typeof value === 'number') d = new Date(value);
  else if (typeof value === 'string') d = new Date(value);
  else if (typeof (value as any).toDate === 'function') d = (value as any).toDate();
  else return null;
  return isNaN(d.getTime()) ? null : d;
};

// ─── Dates ───────────────────────────────────────────────────────────────────

export const DATE_NUMERIC: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
export const DATE_SHORT: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
export const DATE_MEDIUM: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
export const TIME_SHORT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
export const DATETIME_SHORT: Intl.DateTimeFormatOptions = {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
};

export const fmtDate = (
  value: DateLike,
  lang: Language,
  opts: Intl.DateTimeFormatOptions = DATE_NUMERIC
): string => {
  const d = toDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat(dateLocale(lang, opts), opts).format(d);
};

export const fmtTime = (value: DateLike, lang: Language): string => {
  const d = toDate(value);
  if (!d) return '';
  // hour12:false — the app has always shown 24h clocks, and `ar-EG` would
  // otherwise append ص/م and turn a pure-Latin timestamp into mixed script.
  return new Intl.DateTimeFormat('en-GB', { ...TIME_SHORT, hour12: false }).format(d);
};

export const fmtDateTime = (
  value: DateLike,
  lang: Language,
  opts: Intl.DateTimeFormatOptions = DATETIME_SHORT
): string => {
  const d = toDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat(dateLocale(lang, opts), { ...opts, hour12: false }).format(d);
};

/**
 * True when a formatted date can contain Arabic letters (a month or weekday
 * name) and therefore must NOT be wrapped in `.ltr-data`. Callers pick the
 * bidi class with this: `.ltr-data` forces a left-to-right run, which is right
 * for `15/08/2026` and wrong for `15 أغسطس`. `.bidi-isolate` only isolates —
 * enough to stop the trailing-punctuation jump, without forcing direction.
 */
export const bidiClass = (lang: Language, opts: Intl.DateTimeFormatOptions = DATE_NUMERIC): string =>
  lang === 'ar' && !numericOnly(opts) ? 'bidi-isolate' : 'ltr-data';

/**
 * The same choice made from the TEXT rather than from a format. Needed by the
 * chips that paint an enum label: after task 6 that label is Arabic under `ar`
 * but is still Latin whenever the value is free text the user typed (a custom
 * category, a client name) or the UI is English — and `.ltr-data` on an Arabic
 * word puts it in a left-to-right run inside a right-to-left row.
 *
 * ★ Isolation is required either way. The bug this class exists for was
 * "Other..." painting as "...Other": the trailing dots are bidi-NEUTRAL, so
 * they take the paragraph's direction and jump to the front of a Latin run.
 */
const ARABIC_RANGE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

export const bidiClassFor = (text?: string | null): string =>
  ARABIC_RANGE.test(text || '') ? 'bidi-isolate' : 'ltr-data';

// ─── Numbers & money ─────────────────────────────────────────────────────────

export const fmtNumber = (
  value: number | string | null | undefined,
  lang: Language,
  opts: Intl.NumberFormatOptions = { maximumFractionDigits: 2 }
): string => {
  const v = parseAmount(value as any);
  if (v == null) return value == null ? '' : String(value);
  return new Intl.NumberFormat(intlLocale(lang), opts).format(v);
};

export const fmtPercent = (value: number | null | undefined, lang: Language, digits = 0): string => {
  if (value == null || isNaN(value)) return '';
  return new Intl.NumberFormat(intlLocale(lang), {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(value) + '%';
};

/**
 * Money, grouped and with the currency CODE (EGP / USD) rather than a symbol —
 * the app stores free-typed currency strings, so `style:'currency'` would throw
 * on anything Intl does not recognise. A non-numeric value ("TBD") is returned
 * untouched, same contract as `utils.formatMoney`.
 */
export const fmtMoney = (
  value: number | string | null | undefined,
  currency: string | undefined,
  lang: Language
): string => {
  const v = parseAmount(value as any);
  if (v == null) return value == null ? '' : String(value);
  const formatted = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 2 }).format(v);
  return currency ? `${formatted} ${currency}` : formatted;
};

// ─── Relative time ───────────────────────────────────────────────────────────

/**
 * The translated twin of `utils.timeAgo`. `utils.timeAgo` stays as it is: it is
 * imported by non-React code that has no translator, and its English output is
 * still the right thing there. Anything rendered in JSX uses this.
 *
 * Reuses the four keys OutlookFeed already owns ("just now", "{{count}}m ago",
 * …) so the two relative clocks in the app can never drift apart.
 */
export const fmtAgo = (value: DateLike, lang: Language, t: TFunction): string => {
  const d = toDate(value);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return t('just now');
  const min = Math.floor(diff / 60_000);
  if (min < 60) return t('{{count}}m ago', { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('{{count}}h ago', { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t('{{count}}d ago', { count: day });
  return fmtDate(d, lang, DATE_SHORT);
};

// ─── The hook ────────────────────────────────────────────────────────────────

/**
 * Every formatter above, bound to the active language (and to `t` for the
 * relative clock). One `useTranslation()` under the hood, so a component that
 * already calls `useTranslation` can take this instead of both.
 */
export function useFormat() {
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language === 'ar' ? 'ar' : 'en';

  return useMemo(() => ({
    lang,
    t,
    date: (v: DateLike, opts?: Intl.DateTimeFormatOptions) => fmtDate(v, lang, opts),
    time: (v: DateLike) => fmtTime(v, lang),
    dateTime: (v: DateLike, opts?: Intl.DateTimeFormatOptions) => fmtDateTime(v, lang, opts),
    number: (v: number | string | null | undefined, opts?: Intl.NumberFormatOptions) => fmtNumber(v, lang, opts),
    percent: (v: number | null | undefined, digits?: number) => fmtPercent(v, lang, digits),
    money: (v: number | string | null | undefined, currency?: string) => fmtMoney(v, currency, lang),
    ago: (v: DateLike) => fmtAgo(v, lang, t),
    bidi: (opts?: Intl.DateTimeFormatOptions) => bidiClass(lang, opts),
    bidiFor: (text?: string | null) => bidiClassFor(text),
  }), [lang, t]);
}
