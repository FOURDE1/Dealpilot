import type { TFunction } from 'i18next';
import { ApiError } from '../../shared/api/client.js';

/**
 * Maps a mutation failure to a localized message. 409 = uniqueness conflict
 * on the form's key field; 422 = server-side validation with the offending
 * field in the envelope (the server is the only validation layer for these
 * forms until the H-05 Form primitive brings client-side zod).
 * Non-API errors are BUGS (contract drift, coding errors) — rethrown so they
 * surface instead of masquerading as a retryable failure (CLAUDE.md).
 */
export function formErrorMessage(
  t: TFunction<'orgs'>,
  err: unknown,
  uniqueField: 'slug' | 'code',
): string {
  if (!(err instanceof ApiError)) throw err;
  if (err.status === 409 && err.fieldPath === uniqueField) {
    return t(uniqueField === 'slug' ? 'slugTaken' : 'codeTaken');
  }
  if (err.status === 422) {
    if (err.fieldPath === 'slug') return t('slugInvalid');
    if (err.fieldPath === 'code') return t('codeInvalid');
    return t('invalidInput');
  }
  return t('genericError');
}
