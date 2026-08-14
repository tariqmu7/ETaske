import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LANG_STORAGE_KEY, applyLanguageToDocument, dirFor, type Language } from '../i18n';

/**
 * Active language + direction. Reads i18next's own state (via `useTranslation`,
 * which re-renders every consumer on `changeLanguage`) so there is no context
 * provider and no prop drilling — any component can call this.
 *
 * The <html dir> stamp is the single source of truth for layout direction;
 * `isRtl` is for the handful of places that must branch in JS (icon flips,
 * `transform: translateX`, chart axes).
 */
export function useLanguage() {
  const { i18n } = useTranslation();
  const lang: Language = i18n.language === 'ar' ? 'ar' : 'en';

  const setLanguage = useCallback((next: Language) => {
    if (next === lang) return;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // storage disabled — the change still applies for this session
    }
    applyLanguageToDocument(next);
    void i18n.changeLanguage(next);
  }, [i18n, lang]);

  const toggle = useCallback(() => {
    setLanguage(lang === 'ar' ? 'en' : 'ar');
  }, [lang, setLanguage]);

  return { lang, dir: dirFor(lang), isRtl: lang === 'ar', setLanguage, toggle };
}
