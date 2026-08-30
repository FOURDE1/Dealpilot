import { describe, expect, it } from 'vitest';
import { enCA, frCA } from '@dealpilot/i18n';
import { PLATFORM_CAPABILITY_NAMES, PLATFORM_SETTING_KEYS } from '@dealpilot/schemas';
import { CAPABILITY_KEYS, SETTING_KEYS } from './labels.js';

/**
 * The console prints a staffer's capabilities and the name of every kill
 * switch. Both maps are typed, so an unnamed capability or switch is a
 * compile error; this is the half the compiler cannot check — that the key
 * each one points at is a real, non-empty string in BOTH bundles.
 *
 * A missing label here does not crash: i18next renders the key. A French
 * operator would read `sms_send_killswitch` on the screen where they decide
 * whether to stop every dealer's texting.
 */

const admin = { en: enCA.admin as Record<string, string>, fr: frCA.admin as Record<string, string> };
const switches = { en: enCA.switches as Record<string, string>, fr: frCA.switches as Record<string, string> };

function missing(bundle: { en: Record<string, string>; fr: Record<string, string> }, keys: readonly string[]): string[] {
  const gaps: string[] = [];
  for (const key of keys) {
    if (!bundle.en[key]?.trim()) gaps.push(`en-CA: ${key}`);
    if (!bundle.fr[key]?.trim()) gaps.push(`fr-CA: ${key}`);
  }
  return gaps;
}

describe('the console can name what it grants and what it stops', () => {
  it('labels every platform capability, the five F-72 ones included', () => {
    expect(Object.keys(CAPABILITY_KEYS).sort()).toEqual([...PLATFORM_CAPABILITY_NAMES].sort());
    for (const name of ['announcements:read', 'announcements:publish', 'announcements:publish_elevated', 'settings:read', 'settings:write'] as const) {
      expect(PLATFORM_CAPABILITY_NAMES, name).toContain(name);
    }
    expect(missing(admin, Object.values(CAPABILITY_KEYS))).toEqual([]);
  });

  it('names each kill switch and says what it stops, in both languages', () => {
    expect(Object.keys(SETTING_KEYS).sort()).toEqual([...PLATFORM_SETTING_KEYS].sort());
    const keys = Object.values(SETTING_KEYS).flatMap((s) => [s.label, s.scope]);
    expect(missing(switches, keys)).toEqual([]);
  });
});
