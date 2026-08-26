import { describe, expect, it } from 'vitest';
import {
  CANADA_TIMEZONES,
  codeOf,
  draftToBody,
  emptyDraft,
  emptyStore,
  localeFor,
  slugify,
  storeCodesUnique,
  timezoneFor,
} from './provisioning-defaults.js';

describe('provisioning defaults (F-70)', () => {
  it('suggests a slug and a store code from a name, within the server rules', () => {
    expect(slugify('Groupe Alpha Inc.')).toBe('groupe-alpha-inc');
    expect(codeOf('Kia Mont-Laurier')).toBe('KIA-MONT-LAURIER');
    expect(codeOf('Québec Élégance')).toBe('QUEBEC-ELEGANCE');
    const long = codeOf('A very long dealership name indeed');
    expect(long.length).toBeLessThanOrEqual(20);
    expect(long.endsWith('-')).toBe(false);
    expect(codeOf('---')).toBe('');
  });

  it('defaults the timezone and locale from the province, Montréal/French when unsure', () => {
    expect(timezoneFor('QC')).toBe('America/Montreal');
    expect(timezoneFor('ON')).toBe('America/Toronto');
    expect(timezoneFor('BC')).toBe('America/Vancouver');
    expect(timezoneFor('SK')).toBe('America/Regina');
    expect(timezoneFor('NL')).toBe('America/St_Johns');
    expect(timezoneFor('XX')).toBe('America/Montreal');
    expect(localeFor('QC')).toBe('fr-CA');
    expect(localeFor('ON')).toBe('en-CA');
    for (const tz of CANADA_TIMEZONES) expect(tz).toMatch(/^America\/[A-Za-z_]+$/);
    expect(new Set(CANADA_TIMEZONES).size).toBe(CANADA_TIMEZONES.length);
  });

  it('compares codes the way the server stores them', () => {
    expect(storeCodesUnique(['KIA-ML', 'kia-ml'])).toBe(false);
    expect(storeCodesUnique(['KIA-ML', 'KIA-LAV', ''])).toBe(true);
    expect(storeCodesUnique([])).toBe(true);
  });

  it('builds the wire body: trimmed, uppercased codes, empty city dropped, order kept', () => {
    const draft = emptyDraft();
    draft.display_name = ' Groupe Alpha ';
    draft.legal_name = 'Groupe Alpha inc.';
    draft.slug = 'groupe-alpha';
    draft.plan_id = 'plan';
    draft.owner_name = 'Alice';
    draft.owner_email = ' Owner@Alpha.ca ';
    draft.stores = [
      { ...emptyStore('QC'), name: 'Laval', code: 'kia-lav', city: '  ' },
      { ...emptyStore('ON'), name: 'Ottawa', code: 'KIA-OTT', city: 'Ottawa' },
    ];
    expect(draftToBody(draft)).toEqual({
      legal_name: 'Groupe Alpha inc.',
      display_name: 'Groupe Alpha',
      slug: 'groupe-alpha',
      province: 'QC',
      default_locale: 'fr-CA',
      plan_id: 'plan',
      owner_email: 'Owner@Alpha.ca',
      owner_name: 'Alice',
      stores: [
        { name: 'Laval', code: 'KIA-LAV', province: 'QC', timezone: 'America/Montreal' },
        { name: 'Ottawa', code: 'KIA-OTT', province: 'ON', timezone: 'America/Toronto', city: 'Ottawa' },
      ],
    });
    expect(emptyDraft().stores).toHaveLength(1);
  });
});
