import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createI18n, frCA } from '@dealpilot/i18n';
import type { ExpenseSummaryT, VehicleT } from '@dealpilot/schemas';
import { formatCents } from '../deals/money.js';

/**
 * F-82 — the vehicle page's two strip rows and the third block, rendered for
 * real (react-dom/server, the desking-page-submissions.test.tsx harness) with
 * the panel stubbed: « Dépenses ajoutées » and « Coût avec dépenses » exist
 * ONLY when the list carries `summary` (a granted viewer of a zero-expense
 * car reads a real 0,00 $; a masked viewer reads nothing, never a 0,00 $);
 * « Coût avec dépenses » is the derived total plus the approved sum with the
 * SHIPPED caption inside the same group as its term; « Coût total » is
 * untouched; the recon input carries its caption; the panel is the third
 * block after the grid and mounts even when the cost block is masked.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const STORE = '55555555-5555-4555-8555-555555555555';
const CAR = '66666666-6666-4666-8666-666666666666';

const car: VehicleT = {
  id: CAR,
  organization_id: ORG,
  store_id: STORE,
  stock_number: 'K1042',
  vin: null,
  year: 2023,
  make: 'Kia',
  model: 'Sportage',
  trim: 'EX',
  exterior_color: null,
  mileage_km: 42_000,
  vehicle_type: 'used',
  acquisition_type: 'auction',
  acquisition_date: '2026-07-01',
  acquisition_cost_cents: 2_600_000,
  transport_cost_cents: 50_000,
  recon_cost_cents: 115_000,
  list_price_cents: 3_290_000,
  location_status: 'on_lot',
  deal_status: 'available',
  location_details: null,
  total_cost_cents: 2_765_000,
  created_at: '2026-09-04T12:00:00.000Z',
  updated_at: '2026-09-04T12:00:00.000Z',
  deleted_at: null,
};

/** FR-TEN-006: the cost build-up is ABSENT for a masked viewer. */
function maskedCar(): VehicleT {
  const out = { ...car };
  delete out.acquisition_cost_cents;
  delete out.transport_cost_cents;
  delete out.recon_cost_cents;
  delete out.list_price_cents;
  delete out.total_cost_cents;
  return out;
}

const state: { vehicle: VehicleT; summary: ExpenseSummaryT | undefined; listArg: string | undefined } = {
  vehicle: car,
  summary: undefined,
  listArg: undefined,
};

vi.mock('../../shared/use-page-title.js', () => ({ usePageTitle: () => undefined }));
vi.mock('./api.js', () => ({
  useVehicle: () => ({ data: state.vehicle, isPending: false, isError: false, isSuccess: true }),
  useUpdateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./expenses-api.js', () => ({
  useVehicleExpenses: (vehicleId: string) => {
    state.listArg = vehicleId;
    return {
      data: { items: [], ...(state.summary ? { summary: state.summary } : {}) },
      isPending: false,
      isError: false,
      isSuccess: true,
    };
  },
}));
vi.mock('./expenses-panel.js', () => ({
  ExpensesPanel: () => createElement('section', { 'aria-labelledby': 'exp-heading' }, 'PANEL-MOUNTED'),
}));

const { VehicleDetailPage } = await import('./vehicle-detail-page.js');

const I = frCA.inventory as Record<string, string>;
const fr = (cents: number) => formatCents(cents, 'fr-CA');
const norm = (s: string) => s.replace(/[\s\u00a0\u202f]/g, ' ');

function markup(vehicle: VehicleT, summary: ExpenseSummaryT | undefined): string {
  state.vehicle = vehicle;
  state.summary = summary;
  state.listArg = undefined;
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
          { initialEntries: [`/inventory/${CAR}`] },
          createElement(Routes, null, createElement(Route, { path: '/inventory/:vehicleId', element: createElement(VehicleDetailPage) })),
        ),
      ),
    ),
  );
}

/** The <div> group of the <dl> whose <dt> is exactly this label. */
function costRow(html: string, label: string): string | null {
  const groups = html.match(/<div class="flex justify-between gap-4[^"]*">[\s\S]*?<\/div>/g) ?? [];
  return groups.find((g) => new RegExp(`<dt[^>]*>${label}</dt>`).test(g)) ?? null;
}
const rowValue = (row: string) => norm(/<dd[^>]*>([\s\S]*?)<\/dd>/.exec(row)![1]!);

describe('vehicle page › the two strip rows', () => {
  it('with summary {39 092, 5 000} on a 2 765 000 car: « Dépenses ajoutées » 390,92 $, « Coût avec dépenses » 28 040,92 $ with the caption inside the same group as its term, « Coût total » 27 650,00 $ untouched', () => {
    const html = markup(car, { approved_cents: 39_092, pending_cents: 5_000 });
    const added = costRow(html, 'Dépenses ajoutées');
    expect(added).not.toBeNull();
    expect(rowValue(added!)).toBe(norm(fr(39_092)));

    const withRow = costRow(html, 'Coût avec dépenses');
    expect(withRow).not.toBeNull();
    expect(norm(withRow!)).toContain(norm(fr(2_804_092)));
    // The caption lives INSIDE the « Coût avec dépenses » group, in its <dd>, never in the <dt>.
    expect(withRow).toContain('<dt class="text-muted-foreground">Coût avec dépenses</dt>');
    expect(withRow).toContain(
      '<span id="exp-with-caption" class="block text-xs font-normal text-muted-foreground">Coût total plus les dépenses approuvées et payées du registre. La feuille de calcul copie le coût total, jamais ce montant.</span>',
    );
    expect(withRow).toContain(I['expWithCostCaption']!);

    const total = costRow(html, 'Coût total');
    expect(total).not.toBeNull();
    expect(rowValue(total!)).toBe(norm(fr(2_765_000)));
    expect(html).toContain('<dt>Coût total</dt>');
    // Pending money is NOT a strip row.
    expect(html).not.toContain('En attente d’approbation');
    // The rows sit between « Coût total » and « Prix affiché », in that order.
    const order = ['<dt>Coût total</dt>', 'Dépenses ajoutées</dt>', 'Coût avec dépenses</dt>', 'Prix affiché</dt>'].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('without summary (masked ledger): NEITHER new row, no caption, and no « 0,00 $ » anywhere', () => {
    const html = markup(car, undefined);
    expect(costRow(html, 'Dépenses ajoutées')).toBeNull();
    expect(costRow(html, 'Coût avec dépenses')).toBeNull();
    expect(html).not.toContain('exp-with-caption');
    expect(html).not.toContain('jamais ce montant');
    expect(norm(html)).not.toMatch(/(?<!\d)0,00 \$/);
    // « Coût total » still renders for a viewer who sees the car's costs.
    expect(rowValue(costRow(html, 'Coût total')!)).toBe(norm(fr(2_765_000)));
  });

  it('with summary {0, 0}: both rows read 0,00 $ / = « Coût total » — a real zero, not a masked absence', () => {
    const html = markup(car, { approved_cents: 0, pending_cents: 0 });
    expect(rowValue(costRow(html, 'Dépenses ajoutées')!)).toBe(norm(fr(0)));
    expect(norm(costRow(html, 'Coût avec dépenses')!)).toContain(norm(fr(2_765_000)));
    expect(rowValue(costRow(html, 'Coût total')!)).toBe(norm(fr(2_765_000)));
  });

  it('a masked VEHICLE (no total_cost_cents): no cost block, no new row, no caption — the panel still mounts', () => {
    const html = markup(maskedCar(), undefined);
    expect(html).not.toContain('Coût total');
    expect(costRow(html, 'Dépenses ajoutées')).toBeNull();
    expect(costRow(html, 'Coût avec dépenses')).toBeNull();
    expect(html).toContain('PANEL-MOUNTED');
    // The masked case never invents a summary either.
    expect(markup(maskedCar(), { approved_cents: 39_092, pending_cents: 0 })).not.toContain('Dépenses ajoutées');
  });

  it('never a bare « Total » label: every <dt> the page renders is one of the known labels', () => {
    const html = markup(car, { approved_cents: 39_092, pending_cents: 5_000 });
    const terms = [...html.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((m) => m[1]!);
    expect(terms).not.toContain('Total');
    expect(terms).toContain('Dépenses ajoutées');
    expect(terms).toContain('Coût avec dépenses');
  });
});

describe('vehicle page › the recon caption and the third block', () => {
  it('expReconCaption sits under #veh-recon and describes it', () => {
    const html = markup(car, undefined);
    expect(html).toContain('<p id="veh-recon-hint" class="text-xs text-muted-foreground">Les lignes de reconditionnement du registre ne modifient jamais ce champ.</p>');
    const recon = /<input[^>]*id="veh-recon"[^>]*>/.exec(html);
    expect(recon).not.toBeNull();
    expect(recon![0]).toContain('aria-describedby="veh-recon-hint"');
    expect(html.indexOf('id="veh-recon"')).toBeLessThan(html.indexOf('id="veh-recon-hint"'));
    expect(html).not.toContain('grand livre');
  });

  it('the panel is mounted ONCE as the third block, after the grid’s two columns, with the list declared for this vehicle', () => {
    const html = markup(car, { approved_cents: 39_092, pending_cents: 5_000 });
    expect(html.split('PANEL-MOUNTED').length - 1).toBe(1);
    const panelAt = html.indexOf('<section aria-labelledby="exp-heading"');
    expect(panelAt).toBeGreaterThan(html.indexOf('id="veh-list"'));
    expect(panelAt).toBeGreaterThan(html.lastIndexOf('</dl>'));
    // The page's ONE list GET is keyed on the route's vehicle id.
    expect(state.listArg).toBe(CAR);
  });
});
