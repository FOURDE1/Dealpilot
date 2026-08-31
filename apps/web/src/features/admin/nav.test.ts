import { describe, expect, it } from 'vitest';
import { capabilitiesOf } from '@dealpilot/schemas';
import { frCA } from '@dealpilot/i18n';
import { adminNavItems } from './nav.js';

/**
 * F-74 — the nav partitioned across all three platform roles.
 *
 * The e2e journey can only exercise two of them (the bootstrap super admin
 * and one console-granted billing staffer), so platform_support's subset —
 * everything except «Équipe» — is unprovable in a browser and lives here at
 * zero flake cost. Labels are asserted through fr-CA (the reference locale),
 * the same strings the journey asserts in the real DOM, so a renamed key
 * cannot silently detach the two proofs.
 */
const labelsFor = (role: Parameters<typeof capabilitiesOf>[0]) =>
  adminNavItems(capabilitiesOf(role)).map((item) => frCA.admin[item.labelKey]);

describe('adminNavItems', () => {
  it('platform_super_admin sees all six, in render order', () => {
    // Order is load-bearing: the e2e toHaveText() assertion checks count AND
    // order against this exact sequence.
    expect(labelsFor('platform_super_admin')).toEqual([
      'Locataires',
      'Sessions de soutien',
      'Annonces',
      'Interrupteurs',
      'Files de travaux',
      'Équipe',
    ]);
  });

  it('platform_support sees everything except «Équipe»', () => {
    expect(labelsFor('platform_support')).toEqual([
      'Locataires',
      'Sessions de soutien',
      'Annonces',
      'Interrupteurs',
      'Files de travaux',
    ]);
  });

  it('platform_billing sees exactly «Locataires»', () => {
    const labels = labelsFor('platform_billing');
    expect(labels).toEqual(['Locataires']);
    // The five gated names, absent by name — deleting one capability guard in
    // adminNavItems must redden this line, not only the count above.
    for (const gated of ['Sessions de soutien', 'Annonces', 'Interrupteurs', 'Files de travaux', 'Équipe']) {
      expect(labels).not.toContain(gated);
    }
  });
});
