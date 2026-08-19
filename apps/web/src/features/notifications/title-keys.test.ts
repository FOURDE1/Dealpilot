import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TITLE_KEYS } from '@dealpilot/schemas';
import { enCA, frCA } from '@dealpilot/i18n';

/**
 * F-47 lockstep: every title_key a producer may WRITE must be a key both
 * locales can RENDER — a notification whose key misses the namespace shows
 * the raw key to a dealer, which is the dead-vocabulary bug wearing a bell.
 */
describe('notification title keys', () => {
  it('every producable key renders in both locales', () => {
    for (const key of NOTIFICATION_TITLE_KEYS) {
      expect(Object.keys(frCA.notif), `fr-CA misses ${key}`).toContain(key);
      expect(Object.keys(enCA.notif), `en-CA misses ${key}`).toContain(key);
    }
  });
});
