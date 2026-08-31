import { describe, expect, it } from 'vitest';
import { frCA } from '@dealpilot/i18n';
import { NAV_ITEMS } from './nav.js';

/**
 * F-76 (A10) — the tenant nav's mobile partition, pinned.
 *
 * The bottom tab bar (layout.tsx) is a fixed `grid-cols-6` fed by every item
 * WITHOUT `mobileHidden`; a new item that forgets the flag lands in that bar
 * and wraps it. The seven paths below are the set at 4dd004f (mobile-nav.e2e
 * checks overflow only, so the pre-existing seventh tab is out of scope here
 * and simply pinned). Mutation before landing: drop `mobileHidden` from the
 * `/settings` item → both assertions red; restored.
 */
describe('NAV_ITEMS', () => {
  it('the items visible on mobile are exactly the seven that were there before /settings', () => {
    expect(NAV_ITEMS.filter((i) => !('mobileHidden' in i)).map((i) => i.to)).toEqual([
      '/',
      '/organizations',
      '/leads',
      '/conversations',
      '/pipeline',
      '/inventory',
      '/team',
    ]);
  });

  it('the /settings item exists and is desktop-only', () => {
    const settings = NAV_ITEMS.find((i) => i.to === '/settings');
    expect(settings).toBeDefined();
    expect(settings && 'mobileHidden' in settings && settings.mobileHidden).toBe(true);
  });

  it('every key and shortKey resolves in fr-CA nav', () => {
    const nav = frCA.nav as Record<string, string>;
    for (const item of NAV_ITEMS) {
      expect(nav[item.key.replace(/^nav:/, '')], item.key).toBeTruthy();
      expect(nav[item.shortKey.replace(/^nav:/, '')], item.shortKey).toBeTruthy();
    }
    expect(nav[NAV_ITEMS[NAV_ITEMS.length - 1]?.key.replace(/^nav:/, '') ?? '']).toBe('Réglages');
  });
});
