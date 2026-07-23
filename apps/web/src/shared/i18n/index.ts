import { initReactI18next } from 'react-i18next';
import { createI18n, DEFAULT_LOCALE, isLocale, type Locale } from '@dealpilot/i18n';

const STORAGE_KEY = 'dp_locale';

/**
 * localStorage can THROW on access under blocked-cookies/site-data policies
 * (Chromium SecurityError) — and this module runs at app boot, so an
 * unguarded read would blank the whole SPA. Fail open to detection instead.
 */
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preference just won't persist — the in-memory switch still happens.
  }
}

/**
 * Detection: stored preference → browser language → fr-CA (FR-first default).
 * The full ADR-019 chain (user profile → tenant default → browser) grows the
 * profile and tenant steps when those features exist — this is the subset
 * available pre-auth with no tenant context.
 */
export function detectLocale(): Locale {
  const stored = safeGet(STORAGE_KEY);
  if (stored !== null && isLocale(stored)) return stored;
  for (const lang of navigator.languages) {
    if (lang.toLowerCase().startsWith('fr')) return 'fr-CA';
    if (lang.toLowerCase().startsWith('en')) return 'en-CA';
  }
  return DEFAULT_LOCALE;
}

export const i18n = createI18n({
  locale: detectLocale(),
  plugins: [initReactI18next],
  strictIcu: import.meta.env.DEV,
});

function applyHtmlLang(locale: string) {
  document.documentElement.lang = locale;
}
applyHtmlLang(i18n.language);
i18n.on('languageChanged', applyHtmlLang);

export function setLocale(locale: Locale): void {
  safeSet(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
}

export function currentLocale(): Locale {
  return isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}
