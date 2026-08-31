import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { createI18n, frCA } from '@dealpilot/i18n';
import type { StoreT } from '@dealpilot/schemas';

/**
 * F-76 — the stores list's claims, rendered for real (react-dom/server, the
 * usage-card.test.tsx pattern): « Définies » is the snapshot's predicate
 * (at least one day in `business_hours`), « Non définies » is `{}`, a
 * missing texting number is a dash and never an empty cell, and the holiday
 * COUNT is the list's length — no other number appears in that column.
 */

const ORG = '22222222-2222-4222-8222-222222222222';

function store(over: Partial<StoreT>): StoreT {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organization_id: ORG,
    name: 'Succursale A',
    code: 'SUC-A',
    phone: null,
    sms_number: null,
    address_line1: null,
    city: null,
    province: 'QC',
    postal_code: null,
    default_locale: 'fr-CA',
    timezone: 'America/Montreal',
    business_hours: {},
    holiday_dates: [],
    status: 'active',
    bill_of_sale_system: 'CAMS',
    esign_platform: null,
    dispatch_conflict_window_hours: 4,
    created_at: '2026-08-30T12:00:00.000Z',
    updated_at: '2026-08-30T12:00:00.000Z',
    deleted_at: null,
    ...over,
  };
}

const state: { items: StoreT[] } = { items: [] };

vi.mock('../organizations/api.js', () => ({
  useOrganizations: () => ({ data: { items: [{ id: ORG, name: 'Groupe Test' }] }, isPending: false, isError: false, isSuccess: true }),
  useStores: () => ({ data: { items: state.items }, isPending: false, isError: false, isSuccess: true }),
}));
vi.mock('../../shared/permissions.js', () => ({
  usePermissionsMine: () => ({ data: new Set(), isPending: false, isError: false, isSuccess: true }),
  can: () => false,
}));

const { SettingsStoresPage } = await import('./settings-stores-page.js');

function markup(): string {
  const i18n = createI18n({ locale: 'fr-CA', strictIcu: true });
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, { initialEntries: ['/settings/stores'] }, createElement(SettingsStoresPage))),
  );
}

const settings = frCA.settings as Record<string, string>;

describe('settings › stores list', () => {
  it('`business_hours: {}` reads « Non définies », a store with one day reads « Définies »', () => {
    state.items = [
      store({ id: '11111111-1111-4111-8111-111111111111', name: 'Sans heures', code: 'SANS' }),
      store({
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Avec heures',
        code: 'AVEC',
        business_hours: { mon: { open: '09:00', close: '18:00' } },
      }),
    ];
    const html = markup();
    expect(html).toContain(settings['hoursUnset']);
    expect(html).toContain(settings['hoursSet']);
    // Each predicate exactly once for these two rows.
    expect(html.split(settings['hoursUnset'] ?? '').length - 1).toBe(1);
    expect(html.split(`>${settings['hoursSet']}<`).length - 1).toBe(1);
  });

  it('a missing texting number is a dash, a present one is shown verbatim', () => {
    state.items = [store({ sms_number: null })];
    expect(markup()).toContain('>—<');
    state.items = [store({ sms_number: '+15145550142' })];
    const html = markup();
    expect(html).toContain('+15145550142');
    expect(html).not.toContain('>—<');
  });

  it('renders the holiday count and links each row to the store\'s own form', () => {
    state.items = [store({ holiday_dates: ['2026-12-25', '2027-01-01'] })];
    const html = markup();
    expect(html).toContain('>2<');
    expect(html).toContain(`href="/organizations/${ORG}/stores/11111111-1111-4111-8111-111111111111"`);
    expect(html).toContain(settings['col_holidays']);
    expect(html).toContain(settings['col_sms']);
  });

  it('without store:create there is no « Nouvelle succursale » link', () => {
    state.items = [store({})];
    expect(markup()).not.toContain(`/organizations/${ORG}/stores/new`);
  });
});
