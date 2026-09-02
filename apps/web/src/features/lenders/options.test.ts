import { describe, expect, it } from 'vitest';
import type { LenderT } from '@dealpilot/schemas';
import { deskingLenderSelect } from './options.js';

/**
 * F-80 — the desking « Prêteur » Select's ruled posture (graft 6 + A11),
 * proven on the pure model the page renders (the comms-window.ts pattern):
 * inactive lenders hidden from NEW picks, the CURRENT one kept and suffixed
 * « (inactif) », pending = disabled with only current/none, error = the
 * current option labelled '…' — never a uuid, never a silent clear.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const TD = '11111111-1111-4111-8111-111111111111';
const EDEN = '33333333-3333-4333-8333-333333333333';
const SDA = '44444444-4444-4444-8444-444444444444';

function lender(over: Partial<LenderT>): LenderT {
  return {
    id: TD,
    organization_id: ORG,
    name: 'TD Auto Finance',
    short_name: 'TD',
    category: 'PRIME',
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    notes: null,
    active: true,
    created_at: '2026-09-02T12:00:00.000Z',
    updated_at: '2026-09-02T12:00:00.000Z',
    ...over,
  };
}

const SUFFIX = '(inactif)';

const loaded = (items: LenderT[]) => ({ isPending: false, isError: false, items });

describe('deskingLenderSelect', () => {
  it('hides inactive lenders from a NEW pick, groups the rest in category order', () => {
    const model = deskingLenderSelect(
      loaded([
        lender({}),
        lender({ id: EDEN, name: 'Eden Park', short_name: 'Eden', category: 'NEAR_PRIME', active: false }),
        lender({ id: SDA, name: 'Scotia Dealer Advantage', short_name: 'SDA', category: 'NEAR_PRIME' }),
      ]),
      '',
      SUFFIX,
    );
    expect(model.disabled).toBe(false);
    expect(model.current).toBeNull();
    expect(model.groups.map((g) => g.category)).toEqual(['PRIME', 'NEAR_PRIME']);
    const labels = model.groups.flatMap((g) => g.options.map((o) => o.label));
    expect(labels).toEqual(['TD Auto Finance', 'Scotia Dealer Advantage']);
    expect(labels.join(' ')).not.toContain('Eden Park');
  });

  it('keeps the deal\'s CURRENT inactive lender selectable, suffixed « (inactif) »', () => {
    const model = deskingLenderSelect(
      loaded([lender({ active: false }), lender({ id: SDA, name: 'Scotia Dealer Advantage', category: 'NEAR_PRIME' })]),
      TD,
      SUFFIX,
    );
    const prime = model.groups.find((g) => g.category === 'PRIME');
    expect(prime?.options).toEqual([{ value: TD, label: 'TD Auto Finance (inactif)' }]);
    // Listed inside its group — no duplicate fallback option.
    expect(model.current).toBeNull();
  });

  it('while PENDING: disabled, no invented list, only the current/none option ("…", never a uuid)', () => {
    const model = deskingLenderSelect({ isPending: true, isError: false, items: undefined }, TD, SUFFIX);
    expect(model.disabled).toBe(true);
    expect(model.groups).toEqual([]);
    expect(model.current).toEqual({ value: TD, label: '…' });
    // A new deal picking nothing offers only the none option.
    expect(deskingLenderSelect({ isPending: true, isError: false, items: undefined }, '', SUFFIX).current).toBeNull();
  });

  it('on list ERROR: the current option renders as "…" and keeps its value (save unchanged, no silent clear)', () => {
    const model = deskingLenderSelect({ isPending: false, isError: true, items: undefined }, TD, SUFFIX);
    expect(model.disabled).toBe(false);
    expect(model.groups).toEqual([]);
    expect(model.current).toEqual({ value: TD, label: '…' });
  });

  it('defensively keeps a current pick the loaded list cannot name ("…", value intact)', () => {
    const model = deskingLenderSelect(loaded([lender({ id: SDA, name: 'Scotia Dealer Advantage' })]), TD, SUFFIX);
    expect(model.current).toEqual({ value: TD, label: '…' });
  });
});
