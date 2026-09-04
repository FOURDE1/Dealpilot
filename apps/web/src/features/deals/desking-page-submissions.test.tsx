import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createI18n, frCA } from '@dealpilot/i18n';
import type { DealT, LeadT } from '@dealpilot/schemas';

/**
 * F-81 — the desking page's FIFTH section, rendered for real (react-dom/server,
 * the pipeline-lender.test.tsx harness) with the panel itself stubbed: the
 * create-mode sentence « Enregistrez la transaction pour consigner les
 * réponses des prêteurs. » is a claim about a deal that is NOT saved (R8:
 * `!isEdit` only). On /leads/:id/desk/:dealId the deal IS saved, so the
 * section may never say it — not while the deal query is pending, and not
 * when it errors; it says the page's own loading / loadError sentence and
 * mounts the panel once the deal resolves.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const STORE = '55555555-5555-4555-8555-555555555555';
const LEAD = '99999999-9999-4999-8999-999999999999';
const DEAL = '77777777-7777-4777-8777-777777777777';

const lead = {
  id: LEAD,
  organization_id: ORG,
  store_id: STORE,
  first_name: 'Chantal',
  last_name: 'Approuvée',
  phone: '+15145550181',
} as unknown as LeadT;

const deal = {
  id: DEAL,
  lead_id: LEAD,
  organization_id: ORG,
  store_id: STORE,
  deal_type: 'finance',
  province: 'QC',
  amount_financed_cents: 3_449_250,
  interest_rate_bps: 699,
  term_months: 72,
  lender_id: null,
} as unknown as DealT;

type DealQuery = { data: DealT | undefined; isPending: boolean; isError: boolean; isSuccess: boolean };
const state: { deal: DealQuery } = {
  deal: { data: undefined, isPending: true, isError: false, isSuccess: false },
};

vi.mock('../../shared/use-page-title.js', () => ({ usePageTitle: () => undefined }));
vi.mock('../leads/api.js', () => ({
  useLead: () => ({ data: lead, isPending: false, isError: false, isSuccess: true }),
}));
vi.mock('../inventory/api.js', () => ({
  useVehicles: () => ({ data: { items: [] }, isPending: false, isError: false, isSuccess: true }),
}));
vi.mock('../team/api.js', async () => {
  const actual = await vi.importActual<typeof import('../team/api.js')>('../team/api.js');
  return { ...actual, useMembers: () => ({ data: { items: [] }, isPending: false, isError: false, isSuccess: true }) };
});
vi.mock('../lenders/api.js', () => ({
  useLenders: () => ({ data: { items: [], next_cursor: null }, isPending: false, isError: false, isSuccess: true }),
}));
vi.mock('./api.js', () => ({
  useDeal: () => state.deal,
  useCalculateDeal: () => ({ data: undefined, isFetching: false, isPlaceholderData: false, isError: false }),
  useCreateDeal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDealInputs: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./fi-products-api.js', () => ({
  useFiProducts: () => ({ data: [], isPending: false, isError: false, isSuccess: true }),
  useCreateFiProduct: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useDeleteFiProduct: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));
vi.mock('./submissions-panel.js', () => ({
  SubmissionsPanel: () => createElement('section', { 'aria-labelledby': 'subm-heading' }, 'PANEL-MOUNTED'),
}));

const { DeskingPage } = await import('./desking-page.js');

const D = frCA.deals as Record<string, string>;

function markup(path: string): string {
  const i18n = createI18n({ locale: 'fr-CA', strictIcu: true });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/leads/:leadId/desk', element: createElement(DeskingPage) }),
            createElement(Route, { path: '/leads/:leadId/desk/:dealId', element: createElement(DeskingPage) }),
          ),
        ),
      ),
    ),
  );
}

/** The fifth section only — « Chargement… » also lives in the Résultats aside. */
function submSection(html: string): string {
  const m = /<section aria-labelledby="subm-heading"[\s\S]*?<\/section>/.exec(html);
  expect(m, 'the submissions section is rendered').not.toBeNull();
  return m![0];
}

describe('desking page › the submissions section keys on isEdit, never on the deal query', () => {
  it('create mode (/leads/:id/desk): the create-mode sentence, and nothing else', () => {
    state.deal = { data: undefined, isPending: false, isError: false, isSuccess: false };
    const section = submSection(markup(`/leads/${LEAD}/desk`));
    expect(section).toContain(D['submCreateModeHint']!);
    expect(section).not.toContain('PANEL-MOUNTED');
  });

  it('edit mode while the deal is pending: the section says « Chargement… » — NEVER « Enregistrez la transaction… » on a saved deal', () => {
    state.deal = { data: undefined, isPending: true, isError: false, isSuccess: false };
    const section = submSection(markup(`/leads/${LEAD}/desk/${DEAL}`));
    expect(section).not.toContain(D['submCreateModeHint']!);
    expect(section).toContain(D['submSection']!);
    expect(section).toContain(D['loading']!);
  });

  it('edit mode when the deal GET errors: the section says the loadError sentence, not the create-mode instruction', () => {
    state.deal = { data: undefined, isPending: false, isError: true, isSuccess: false };
    const section = submSection(markup(`/leads/${LEAD}/desk/${DEAL}`));
    expect(section).not.toContain(D['submCreateModeHint']!);
    expect(section).toContain(D['submSection']!);
    expect(section).toContain(D['loadError']!);
    expect(section).toContain('role="alert"');
  });

  it('edit mode once the deal resolves: the panel is mounted', () => {
    state.deal = { data: deal, isPending: false, isError: false, isSuccess: true };
    const section = submSection(markup(`/leads/${LEAD}/desk/${DEAL}`));
    expect(section).toContain('PANEL-MOUNTED');
    expect(section).not.toContain(D['submCreateModeHint']!);
  });
});
