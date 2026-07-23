import type { frCA } from '@dealpilot/i18n';

/**
 * Typed t() keys (H-04 scope): every useTranslation()/t() call is checked
 * against the fr-CA key shape — a typo'd or removed key is a compile error.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: typeof frCA;
  }
}
