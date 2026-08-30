import { describe, expect, it } from 'vitest';
import { enCA, frCA } from '@dealpilot/i18n';
import { AnnouncementAudience, ANNOUNCEMENT_SEVERITIES } from '@dealpilot/schemas';
import { AUDIENCE_KEYS, SEVERITY_KEYS } from './labels.js';

/**
 * A severity or an audience arm the console cannot name renders as its own
 * raw token — `incident` in the middle of a French banner, at the moment the
 * reader most needs a sentence. The maps are typed, so a missing entry is a
 * compile error; this is the other half, that the key they point at is a real
 * string in BOTH bundles.
 */

const en = enCA.announcements as Record<string, string>;
const fr = frCA.announcements as Record<string, string>;

function missing(keys: readonly string[]): string[] {
  const gaps: string[] = [];
  for (const key of keys) {
    if (!en[key]?.trim()) gaps.push(`en-CA: ${key}`);
    if (!fr[key]?.trim()) gaps.push(`fr-CA: ${key}`);
  }
  return gaps;
}

describe('the shell can name every announcement it shows', () => {
  it('covers every severity', () => {
    expect(Object.keys(SEVERITY_KEYS).sort()).toEqual([...ANNOUNCEMENT_SEVERITIES].sort());
    expect(missing(Object.values(SEVERITY_KEYS))).toEqual([]);
  });

  it('covers every audience arm the publish schema accepts', () => {
    const arms = AnnouncementAudience.options.map((o) => o.shape.type.value);
    expect(arms).toEqual(['all', 'plan', 'organizations']);
    expect(Object.keys(AUDIENCE_KEYS).sort()).toEqual([...arms].sort());
    expect(missing(Object.values(AUDIENCE_KEYS))).toEqual([]);
  });
});
