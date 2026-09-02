import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { createI18n, frCA } from '@dealpilot/i18n';
import type { LenderT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';

/**
 * F-80 — the registry page's claims, rendered for real (react-dom/server, the
 * settings-stores-page.test.tsx pattern): the four category groups carry the
 * LEGACY-verbatim labels (« Captif (OEM) », never « Captif » — A15), a
 * deactivated lender wears the inline-span « Inactif » chip (A12 — no Badge
 * component exists), a member without `lender:manage` sees NO write control
 * and fires NO mutation (zero-request law), and the duplicate-name 409 lands
 * under the name field as `lenders:nameTaken`.
 */

const ORG = '22222222-2222-4222-8222-222222222222';

function lender(over: Partial<LenderT>): LenderT {
  return {
    id: '11111111-1111-4111-8111-111111111111',
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

const state: {
  items: LenderT[];
  canManage: boolean;
  createError: unknown;
} = { items: [], canManage: true, createError: null };

const createMutate = vi.fn();
const updateMutate = vi.fn();

vi.mock('../organizations/api.js', () => ({
  useOrganizations: () => ({
    data: { items: [{ id: ORG, name: 'Groupe Test' }] },
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
}));
vi.mock('../../shared/permissions.js', () => ({
  usePermissionsMine: () => ({
    data: new Set(state.canManage ? ['lender:manage'] : []),
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
  can: (mine: Set<string> | undefined, p: string) => mine?.has(p) ?? false,
}));
vi.mock('../lenders/api.js', () => ({
  useLenders: () => ({
    data: { items: state.items, next_cursor: null },
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
  useCreateLender: () => ({
    mutateAsync: createMutate,
    isPending: false,
    error: state.createError,
    reset: () => undefined,
  }),
  useUpdateLender: () => ({
    mutateAsync: updateMutate,
    isPending: false,
    error: null,
    reset: () => undefined,
  }),
}));

const { LendersPage } = await import('./lenders-page.js');

function markup(): string {
  const i18n = createI18n({ locale: 'fr-CA', strictIcu: true });
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MemoryRouter, { initialEntries: ['/settings/lenders'] }, createElement(LendersPage)),
    ),
  );
}

const L = frCA.lenders as Record<string, string>;

const fourCategories = () => [
  lender({}),
  lender({ id: '33333333-3333-4333-8333-333333333333', name: 'Scotia Dealer Advantage', short_name: 'SDA', category: 'NEAR_PRIME' }),
  lender({ id: '44444444-4444-4444-8444-444444444444', name: 'Iceberg Finance', short_name: 'Ice.', category: 'SUBPRIME' }),
  lender({ id: '55555555-5555-4555-8555-555555555555', name: 'Kia Finance (KFCC)', short_name: 'KIA', category: 'CAPTIVE', notes: 'Kia Finance Company of Canada' }),
];

describe('settings › lenders registry', () => {
  it('renders the four category groups with the legacy-verbatim labels, « Captif (OEM) » included', () => {
    state.items = fourCategories();
    state.canManage = true;
    state.createError = null;
    const html = markup();
    for (const label of ['Prime', 'Quasi-prime', 'Subprime', 'Captif (OEM)']) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain('Scotia Dealer Advantage');
    expect(html).toContain('« SDA »');
    // An active row wears no chip.
    expect(html).not.toContain(`>${L['inactive']}<`);
  });

  it('a deactivated lender wears the inline-span « Inactif » chip (A12 — token classes, no Badge import)', () => {
    state.items = [lender({ active: false })];
    state.canManage = true;
    state.createError = null;
    const html = markup();
    expect(html).toContain(`>${L['inactive']}<`);
    expect(html).toContain('bg-secondary');
    expect(html).toContain(`>${L['reactivate']}<`);
  });

  it('without lender:manage: read-only sentence, NO write control, and no mutation fired', () => {
    state.items = fourCategories();
    state.canManage = false;
    state.createError = null;
    createMutate.mockClear();
    updateMutate.mockClear();
    const html = markup();
    expect(html).toContain(L['readOnly']);
    expect(html).not.toContain(L['add']);
    expect(html).not.toContain(`>${L['edit']}<`);
    expect(html).not.toContain(`>${L['deactivate']}<`);
    // The list itself still renders — it is the member's pick-list.
    expect(html).toContain('TD Auto Finance');
    expect(createMutate).not.toHaveBeenCalled();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('the duplicate-name 409 renders `nameTaken` under the name field (in-route 23505→409, A7)', () => {
    state.items = fourCategories();
    state.canManage = true;
    state.createError = new ApiError(409, 'name', 'duplicate_name', 'duplicate_name', ['duplicate_name'], ['TD Auto Finance'], ['name']);
    const html = markup();
    expect(html).toContain(L['nameTaken']);
    expect(html).toContain('id="lender-name-error"');
    expect(html).toContain('aria-describedby="lender-name-error"');
    // A duplicate name is not the generic failure.
    expect(html).not.toContain(L['genericError']);
    state.createError = null;
  });
});
