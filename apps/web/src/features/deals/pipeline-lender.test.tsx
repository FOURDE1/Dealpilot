import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createI18n } from '@dealpilot/i18n';
import type { DealT, LenderT } from '@dealpilot/schemas';

/**
 * F-80 — the pipeline card names the deal's lender beside the funding control:
 * « Prêteur : TD » through `short_name ?? name`, '…' while the registry has
 * not resolved, and NOTHING on a deal that names no lender. Rendered for real
 * (react-dom/server, the settings-stores-page.test.tsx pattern).
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const LEAD = '99999999-9999-4999-8999-999999999999';
const TD = '11111111-1111-4111-8111-111111111111';
const ICE = '44444444-4444-4444-8444-444444444444';

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

function deal(over: Partial<DealT>): DealT {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    lead_id: LEAD,
    deal_type: 'finance',
    pipeline_stage: 'new',
    funding_status: 'submitted',
    amount_financed_cents: 3_200_000,
    monthly_payment_cents: 52_300,
    lender_id: TD,
    ...over,
  } as DealT;
}

const state: { deals: DealT[]; lenders: { items: LenderT[] } | undefined } = {
  deals: [],
  lenders: undefined,
};

vi.mock('../organizations/api.js', () => ({
  useOrganizations: () => ({
    data: { items: [{ id: ORG, name: 'Groupe Test' }] },
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
}));
vi.mock('../leads/api.js', () => ({
  useLeadNames: () => ({ data: [{ id: LEAD, first_name: 'Marie', last_name: 'Roy', phone: '+15145550142' }] }),
}));
vi.mock('./api.js', () => ({
  usePipelineDeals: () => ({
    data: { items: state.deals, truncated: false },
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
  useUpdateDealTracks: () => ({ isPending: false, variables: undefined, mutateAsync: vi.fn() }),
}));
vi.mock('../lenders/api.js', () => ({
  useLenders: () => ({
    data: state.lenders,
    isPending: state.lenders === undefined,
    isError: false,
    isSuccess: state.lenders !== undefined,
  }),
}));
vi.mock('../checklists/checklist-dialog.js', () => ({ ChecklistDialog: () => null }));
vi.mock('../activity/activity-dialog.js', () => ({ DealActivityDialog: () => null }));
vi.mock('../documents/documents-dialog.js', () => ({ DocumentsDialog: () => null }));

const { PipelinePage } = await import('./pipeline-page.js');

function markup(): string {
  const i18n = createI18n({ locale: 'fr-CA', strictIcu: true });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MemoryRouter, { initialEntries: ['/pipeline'] }, createElement(PipelinePage)),
      ),
    ),
  );
}

describe('pipeline › the card names its lender', () => {
  it('renders « Prêteur : TD » from short_name beside the funding control', () => {
    state.deals = [deal({})];
    state.lenders = { items: [lender({})] };
    expect(markup()).toContain('Prêteur : TD<');
  });

  it('falls back to the FULL name when short_name is null', () => {
    state.deals = [deal({ lender_id: ICE })];
    state.lenders = { items: [lender({ id: ICE, name: 'Iceberg Finance', short_name: null, category: 'SUBPRIME' })] };
    expect(markup()).toContain('Prêteur : Iceberg Finance');
  });

  it("renders '…' while the registry has not resolved — never a raw uuid", () => {
    state.deals = [deal({})];
    state.lenders = undefined;
    const html = markup();
    expect(html).toContain('Prêteur : …');
    expect(html).not.toContain(`Prêteur : ${TD}`);
  });

  it('a deal naming no lender says nothing at all', () => {
    state.deals = [deal({ lender_id: null })];
    state.lenders = { items: [lender({})] };
    expect(markup()).not.toContain('Prêteur :');
  });
});
