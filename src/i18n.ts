import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import ar from './locales/ar';

export type Language = 'en' | 'ar';
export type LocaleKey = keyof typeof en;

export const LANGUAGES: { code: Language; label: string; dir: 'ltr' | 'rtl' }[] = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
];

export const LANG_STORAGE_KEY = 'etaske-lang';

export function getStoredLanguage(): Language {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en'; // private mode / storage disabled
  }
}

export function dirFor(lang: Language): 'ltr' | 'rtl' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Stamps `lang` + `dir` on <html>. Called once at module load — before React
 * renders — so the first paint is already in the right direction and there is
 * no LTR→RTL flash. Mirrors the `data-theme` stamp in `hooks/useTheme.ts`.
 */
export function applyLanguageToDocument(lang: Language) {
  const el = document.documentElement;
  el.setAttribute('lang', lang);
  el.setAttribute('dir', dirFor(lang));
}

const initial = getStoredLanguage();
applyLanguageToDocument(initial);

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    lng: initial,
    fallbackLng: 'en',
    // ★ Both MUST stay false. The keys ARE the English sentences, so they contain
    // '.' ("No content provided.") and ':' ("From:") — i18next's defaults read
    // those as a nested path and a namespace, so those lookups missed entirely
    // and only "worked" because a miss echoes the key back, which was English.
    // With Arabic loaded, a miss is a visible bug.
    keySeparator: false,
    nsSeparator: false,
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
