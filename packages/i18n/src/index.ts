import { createInstance, type i18n } from 'i18next';
import ICU from 'i18next-icu';
import { frCA } from './locales/fr-CA.js';
import { enCA } from './locales/en-CA.js';

export { frCA } from './locales/fr-CA.js';
export { enCA } from './locales/en-CA.js';
export type { LocaleShape } from './locales/fr-CA.js';
export { checkParity, type ParityIssue } from './parity.js';

/** Locale vocabulary per D-017. French first (Bill 96) — fr-CA is default AND fallback. */
export const LOCALES = ['fr-CA', 'en-CA'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr-CA';

export const resources = {
  'fr-CA': frCA,
  'en-CA': enCA,
} as const;

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Framework-free i18next factory shared by SPA, API, and workers (ADR-019).
 * ICU message syntax; resources bundled; framework bindings (e.g.
 * react-i18next's initReactI18next) are passed by the caller via `plugins`.
 *
 * `strictIcu` makes ICU format errors (missing/misnamed arguments) THROW
 * instead of silently rendering the raw "{arg}" placeholder — turn it on in
 * dev and tests so a bad call site fails loudly; leave it off in production
 * (a visible placeholder beats a crashed render).
 */
export function createI18n(options?: {
  locale?: Locale;
  plugins?: Parameters<i18n['use']>[0][];
  strictIcu?: boolean;
}): i18n {
  const instance = createInstance();
  instance.use(
    options?.strictIcu
      ? new ICU({
          parseErrorHandler: (error: Error) => {
            throw error;
          },
        })
      : ICU,
  );
  for (const plugin of options?.plugins ?? []) instance.use(plugin);
  void instance.init({
    lng: options?.locale ?? DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...LOCALES],
    resources,
    defaultNS: 'common',
    ns: Object.keys(frCA),
    interpolation: { escapeValue: false }, // React escapes; server callers render text
    returnNull: false,
  });
  return instance;
}
