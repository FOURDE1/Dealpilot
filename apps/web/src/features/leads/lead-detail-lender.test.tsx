import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { createI18n } from '@dealpilot/i18n';
import type { DealT, LenderT } from '@dealpilot/schemas';

/**
 * F-80 — the lead's deal line names its lender by FULL name (the pipeline card
 * shortens; the record page does not): « … · TD Auto Finance », '…' while the
 * registry has not resolved, nothing when the deal names none.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const LEAD = '99999999-9999-4999-8999-999999999999';
const TD = '11111111-1111-4111-8111-111111111111';

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

const lead = {
  id: LEAD,
  organization_id: ORG,
  store_id: '88888888-8888-4888-8888-888888888888',
  contact_id: null,
  first_name: 'Marie',
  last_name: 'Roy',
  phone: '+15145550142',
  email: null,
  vehicle_interest: null,
  source: 'website',
  status: 'qualified',
  assigned_to: null,
  lost_reason_id: null,
  lost_reason_note: null,
  created_at: '2026-09-02T12:00:00.000Z',
  updated_at: '2026-09-02T12:00:00.000Z',
};

const state: { deals: DealT[]; lenders: { items: LenderT[] } | undefined } = {
  deals: [],
  lenders: undefined,
};

vi.mock('./api.js', () => ({
  useLead: () => ({ data: lead, isPending: false, isError: false, isSuccess: true }),
  useUpdateLead: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../deals/api.js', () => ({
  useDealsForLead: () => ({
    data: { items: state.deals, next_cursor: null },
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
}));
vi.mock('../team/api.js', () => ({
  useMembers: () => ({ data: { items: [] }, isPending: false, isError: false, isSuccess: true }),
  activeMembers: () => [],
}));
vi.mock('../../shared/permissions.js', () => ({
  usePermissionsMine: () => ({ data: new Set(), isPending: false, isError: false, isSuccess: true }),
  can: () => false,
}));
vi.mock('./lost-reason-api.js', () => ({
  useLostReasons: () => ({ data: undefined, isPending: false, isError: false, isSuccess: false }),
}));
vi.mock('./duplicate-api.js', () => ({
  useDuplicates: () => ({ data: { items: [] }, isPending: false, isError: false, isSuccess: true }),
}));
vi.mock('../lenders/api.js', () => ({
  useLenders: () => ({
    data: state.lenders,
    isPending: state.lenders === undefined,
    isError: false,
    isSuccess: state.lenders !== undefined,
  }),
}));
vi.mock('./lost-reason-dialog.js', () => ({ LostReasonDialog: () => null }));
vi.mock('../tasks/task-panel.js', () => ({ TaskPanel: () => null }));
vi.mock('../compliance/consent-panel.js', () => ({ ConsentPanel: () => null }));
vi.mock('../activity/activity-timeline.js', () => ({ ActivityTimeline: () => null }));
vi.mock('../activity/activity-dialog.js', () => ({ DealActivityDialog: () => null }));
vi.mock('../checklists/checklist-dialog.js', () => ({ ChecklistDialog: () => null }));
vi.mock('../dispatch/book-dialog.js', () => ({ BookDispatchDialog: () => null }));
vi.mock('../documents/documents-dialog.js', () => ({ DocumentsDialog: () => null }));

const { LeadDetailPage } = await import('./lead-detail-page.js');

function markup(): string {
  const i18n = createI18n({ locale: 'fr-CA', strictIcu: true });
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(
        MemoryRouter,
        { initialEntries: [`/leads/${LEAD}`] },
        createElement(Routes, null, createElement(Route, { path: '/leads/:leadId', element: createElement(LeadDetailPage) })),
      ),
    ),
  );
}

describe('lead detail › the deal line names its lender in full', () => {
  it('renders « · TD Auto Finance » — the full name, not the pipeline short form', () => {
    state.deals = [deal({})];
    state.lenders = { items: [lender({})] };
    const html = markup();
    expect(html).toContain('· TD Auto Finance');
    expect(html).not.toContain('· TD<');
  });

  it("renders '…' while the registry has not resolved — never a raw uuid", () => {
    state.deals = [deal({})];
    state.lenders = undefined;
    const html = markup();
    expect(html).toContain('· …');
    expect(html).not.toContain(TD.slice(0, 8));
  });

  it('a deal naming no lender adds nothing to the line', () => {
    state.deals = [deal({ lender_id: null })];
    state.lenders = { items: [lender({})] };
    expect(markup()).not.toContain('· TD Auto Finance');
  });
});
