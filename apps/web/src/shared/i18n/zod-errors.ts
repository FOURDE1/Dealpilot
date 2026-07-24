import { z } from 'zod';
import { i18n } from './index.js';

/**
 * Localizes EVERY client-side zod message (Bill 96 — the French UI must be
 * equivalent; zod's built-in messages are English). Two generic buckets keep
 * the copy honest: empty inputs read as "required", everything else as
 * "invalid". Field-specific wording arrives with per-field schema overrides
 * when a form needs it. Registered once at app boot (imported by main.tsx).
 */
z.config({
  customError: (issue) => {
    const { input, code } = issue as { input?: unknown; code?: string };
    // `custom` issues (form-layer refinements) carry no input — always "invalid".
    if (code !== 'custom' && (input === '' || input === undefined || input === null)) {
      return i18n.t('common:validationRequired');
    }
    return i18n.t('common:validationInvalid');
  },
});
