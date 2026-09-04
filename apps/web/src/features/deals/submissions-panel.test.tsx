import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { QueryClient } from '@tanstack/react-query';
import { createI18n, frCA } from '@dealpilot/i18n';
import type { DealSubmissionT, DealT, LenderT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { formatCents } from './money.js';

/**
 * F-81 — the submissions panel's claims, rendered for real (react-dom/server,
 * the lenders-page.test.tsx harness): a member without `deal:update` sees the
 * SHIPPED read-only sentence and NO write control and fires NO mutation; a
 * writer gets the form and « Choisir cette approbation » only on approved
 * rows; the Achat|Vente|Écart line says « — » for a missing side; the
 * lender's quoted payment renders ONLY inside its captioned sentence; the
 * ★ chip wears the accent pair; the expired chip is the API's boolean; the
 * ceiling and desk-differs chips fire on their ruled inputs; the selected
 * row's three promoted inputs are locked; ONE form at a time; the select
 * response lands in the deal cache and reaches `onPromoted` (D-082).
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const DEAL = '77777777-7777-4777-8777-777777777777';
const TD = '11111111-1111-4111-8111-111111111111';
const IA = '33333333-3333-4333-8333-333333333333';
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

let seq = 0;
function sub(over: Partial<DealSubmissionT>): DealSubmissionT {
  seq += 1;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, '0')}`,
    organization_id: ORG,
    store_id: '55555555-5555-4555-8555-555555555555',
    deal_id: DEAL,
    lender_id: TD,
    platform: 'dealertrack',
    status: 'submitted',
    approval_amount_cents: null,
    buy_rate_bps: null,
    sell_rate_bps: null,
    term_months: null,
    monthly_payment_cents: null,
    conditions: null,
    conditions_met: false,
    decline_reason: null,
    expiry_date: null,
    expired: false,
    selected: false,
    submitted_at: '2026-09-02T12:00:00.000Z',
    responded_at: null,
    notes: null,
    created_at: '2026-09-02T12:00:00.000Z',
    updated_at: '2026-09-02T12:00:00.000Z',
    ...over,
  };
}

const state: {
  rows: DealSubmissionT[];
  lenders: LenderT[];
  canWrite: boolean;
  selectError: unknown;
  selectVariables: string | undefined;
  selectOpts: { onPromoted?: (deal: DealT) => void } | undefined;
} = { rows: [], lenders: [], canWrite: true, selectError: null, selectVariables: undefined, selectOpts: undefined };

const createMutate = vi.fn();
const updateMutate = vi.fn();
const selectMutate = vi.fn();

vi.mock('../../shared/permissions.js', () => ({
  usePermissionsMine: () => ({
    data: new Set(state.canWrite ? ['deal:update'] : []),
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
  can: (mine: Set<string> | undefined, p: string) => mine?.has(p) ?? false,
}));
vi.mock('../lenders/api.js', () => ({
  useLenders: () => ({
    data: { items: state.lenders, next_cursor: null },
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
}));
vi.mock('./submissions-api.js', async () => {
  const actual = await vi.importActual<typeof import('./submissions-api.js')>('./submissions-api.js');
  return {
    ...actual,
    useSubmissions: () => ({ data: state.rows, isPending: false, isError: false, isSuccess: true }),
    useCreateSubmission: () => ({ mutateAsync: createMutate, isPending: false, error: null, reset: () => undefined }),
    useUpdateSubmission: () => ({
      mutateAsync: updateMutate,
      isPending: false,
      error: null,
      variables: undefined,
      reset: () => undefined,
    }),
    useSelectSubmission: (_dealId: string, opts?: { onPromoted?: (deal: DealT) => void }) => {
      state.selectOpts = opts;
      return {
        mutateAsync: selectMutate,
        isPending: false,
        error: state.selectError,
        variables: state.selectVariables,
        reset: () => undefined,
      };
    },
  };
});

const { SubmissionsPanel, SubmissionsPanelView, submissionErrorKey, updateBody } = await import('./submissions-panel.js');
const { applySelectResult } = await import('./submissions-api.js');

const D = frCA.deals as Record<string, string>;
const onPromoted = vi.fn();

type Live = { interest_rate_bps: number | null; term_months: number | null; lender_id: string | null };
const LIVE_TD: Live = { interest_rate_bps: 699, term_months: 72, lender_id: TD };

function markup(over?: {
  live?: Live;
  amountFinancedCents?: number | null;
  dealType?: 'finance' | 'lease' | 'cash';
  mode?: 'closed' | 'add' | { edit: string };
}): string {
  const i18n = createI18n({ locale: 'fr-CA', strictIcu: true });
  const props = {
    dealId: DEAL,
    orgId: ORG,
    live: over?.live ?? LIVE_TD,
    amountFinancedCents: over?.amountFinancedCents ?? null,
    dealType: over?.dealType ?? 'finance',
    onPromoted,
  };
  const panel = over?.mode
    ? createElement(SubmissionsPanelView, { ...props, mode: over.mode, onModeChange: () => undefined })
    : createElement(SubmissionsPanel, props);
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, panel));
}

function reset(rows: DealSubmissionT[], canWrite = true) {
  state.rows = rows;
  state.lenders = [lender({}), lender({ id: IA, name: 'iA Financial Group (Industrial Alliance)', short_name: 'iA' })];
  state.canWrite = canWrite;
  state.selectError = null;
  state.selectVariables = undefined;
  createMutate.mockClear();
  updateMutate.mockClear();
  selectMutate.mockClear();
  onPromoted.mockClear();
}

const approvedTd = () =>
  sub({ status: 'approved', buy_rate_bps: 599, sell_rate_bps: 699, term_months: 72, approval_amount_cents: 2_800_000 });

describe('submissions panel › the reader (no deal:update)', () => {
  it('renders the SHIPPED read-only sentence, the list, NO write control, and fires NO mutation', () => {
    reset([approvedTd()], false);
    const html = markup();
    expect(html).toContain('Vous pouvez consulter les soumissions ; votre rôle ne permet pas de les consigner.');
    expect(html).toContain(D['submReadOnly']!);
    expect(html).toContain('TD Auto Finance');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain(D['submAdd']!);
    expect(html).not.toContain(D['submSelectAction']!);
    expect(createMutate).not.toHaveBeenCalled();
    expect(updateMutate).not.toHaveBeenCalled();
    expect(selectMutate).not.toHaveBeenCalled();
  });

  it('with zero rows says « Aucune soumission. » — never the CTA a reader cannot follow', () => {
    reset([], false);
    const html = markup();
    expect(html).toContain('Aucune soumission.');
    expect(html).not.toContain(D['submEmptyCta']!);
    expect(html).not.toContain('<form');
  });
});

describe('submissions panel › the writer', () => {
  it('zero rows: the CTA sentence and the add form with « Prêteur sollicité », all four platforms and the approved-term label', () => {
    reset([]);
    const html = markup();
    expect(html).toContain('Aucune soumission — consignez la première réponse d’un prêteur.');
    expect(html).toContain('<form');
    expect(html).toContain('Prêteur sollicité');
    expect(html).toContain('Terme approuvé (mois)');
    expect(html).not.toContain('>Terme (mois)<');
    for (const p of ['DealerTrack', 'CreditApp', 'RouteOne', 'Manuelle']) expect(html).toContain(`>${p}<`);
    // No read-only sentence flashes for a writer.
    expect(html).not.toContain(D['submReadOnly']!);
    // The add form offers only ACTIVE lenders, grouped by category.
    expect(html).toContain('<optgroup label="Prime">');
  });

  it('« Choisir cette approbation — TD Auto Finance » is live on the approved row; the conditional row is disabled with its reason', () => {
    const td = approvedTd();
    const ia = sub({ lender_id: IA, status: 'conditional', sell_rate_bps: 999, term_months: 60, conditions: 'Preuve de revenu' });
    reset([td, ia]);
    const html = markup();
    const tdButton = /<button[^>]*aria-label="Choisir cette approbation — TD Auto Finance"[^>]*>/.exec(html);
    expect(tdButton).not.toBeNull();
    expect(tdButton![0]).not.toContain('disabled=""');
    const iaButton = /<button[^>]*aria-label="Choisir cette approbation — iA Financial Group \(Industrial Alliance\)"[^>]*>/.exec(html);
    expect(iaButton).not.toBeNull();
    expect(iaButton![0]).toContain('disabled=""');
    expect(iaButton![0]).toContain(`aria-describedby="subm-reason-${ia.id}"`);
    expect(html).toContain(`id="subm-reason-${ia.id}"`);
    expect(html).toContain('Approuvez la soumission — conditions remplies — avant de la choisir.');
    // The conditions checkbox is the writer's control on the conditional row.
    expect(html).toContain(`id="subm-met-${ia.id}"`);
    expect(html).toContain('accent-primary-text');
    // « Modifier — {lender} » on every row.
    expect(html).toContain('aria-label="Modifier — TD Auto Finance"');
    // With rows on file the add form is closed behind its button.
    expect(html).toContain(`>${D['submAdd']}<`);
    expect(html).not.toContain('<form');
  });

  it('a submitted row and an incomplete approval are disabled with their own reasons; an expired approval too', () => {
    const submitted = sub({});
    const incomplete = sub({ status: 'approved', sell_rate_bps: 699 });
    const expired = sub({ status: 'approved', sell_rate_bps: 699, term_months: 72, expiry_date: '2026-01-01', expired: true });
    reset([submitted, incomplete, expired]);
    const html = markup();
    expect(html).toContain(D['submSelectErr_submission_not_approved']!);
    expect(html).toContain(D['submIncompleteHint']!);
    expect(html).toContain(D['submSelectErr_submission_expired']!);
  });
});

describe('submissions panel › the row lines', () => {
  it('Achat | Vente | Écart shows /1,00 %/ for 599/699 and « — » for an untyped side', () => {
    const td = approvedTd();
    const scotia = sub({ lender_id: IA, sell_rate_bps: 849 });
    reset([td, scotia]);
    const html = markup();
    expect(html).toMatch(/Écart 1,00\s?%/);
    expect(html).toContain('Achat — | Vente 8,49');
    expect(html).toMatch(/Écart —</);
    expect(html).not.toMatch(/Écart 0,00/);
  });

  it('the decline reason paragraph renders only on a declined row', () => {
    const declined = sub({ status: 'declined', decline_reason: 'Ratio d’endettement trop élevé' });
    reset([declined]);
    expect(markup()).toContain('Ratio d’endettement trop élevé');
    expect(markup()).toContain(`${D['submDeclineReason']} : `);
    reset([sub({ status: 'approved', sell_rate_bps: 699, term_months: 72 })]);
    expect(markup()).not.toContain(D['submDeclineReason']!);
  });

  it('the lender’s quoted payment renders ONLY as the full captioned sentence, and only when on file', () => {
    reset([sub({ ...approvedTd(), monthly_payment_cents: 65_000 })]);
    const amount = formatCents(65_000, 'fr-CA');
    const html = markup();
    expect(html).toContain(
      `Paiement cité par le prêteur : ${amount} — la feuille de calcul calcule celui de la transaction.`,
    );
    // The bare number never appears outside the sentence.
    expect(html.split(amount).length - 1).toBe(1);
    reset([approvedTd()]);
    expect(markup()).not.toContain('Paiement cité par le prêteur');
  });

  it('the terms line reads « 28 000,00 $ @ 6,99 % × 72 mois » when ceiling, sell and term are all on file', () => {
    reset([approvedTd()]);
    const html = markup().replace(/[\s\u00a0\u202f]/g, ' ');
    expect(html).toContain('28 000,00 $ @ 6,99 % × 72 mois');
  });

  it('the term and the ceiling each render WITHOUT the other: « 9,99 % × 60 mois » with no ceiling, « Plafond … » with no term, « Terme … » alone', () => {
    const norm = () => markup().replace(/[\s\u00a0\u202f]/g, ' ');
    // The common partial answer — approved at 9,99 over 60, ceiling to follow.
    reset([sub({ lender_id: IA, status: 'approved', sell_rate_bps: 999, term_months: 60 })]);
    let html = norm();
    expect(html).toContain('9,99 % × 60 mois');
    expect(html).not.toContain('Plafond');
    // A ceiling with no term yet.
    reset([sub({ status: 'approved', sell_rate_bps: 999, approval_amount_cents: 2_800_000 })]);
    html = norm();
    expect(html).toContain('Plafond 28 000,00 $');
    expect(html).not.toContain('mois');
    // Ceiling and term, no sell rate (the rates line says « Vente — »).
    reset([sub({ status: 'submitted', approval_amount_cents: 2_800_000, term_months: 72 })]);
    html = norm();
    expect(html).toContain('Plafond 28 000,00 $ · Terme 72 mois');
    // The term alone.
    reset([sub({ status: 'submitted', term_months: 60 })]);
    html = norm();
    expect(html).toContain('Terme 60 mois');
    expect(html).not.toContain('Plafond');
    // Nothing but a sell rate: the rates line already carries it — no terms line.
    reset([sub({ status: 'submitted', sell_rate_bps: 849 })]);
    html = norm();
    expect(html).not.toContain('mois');
    expect(html).not.toContain('Plafond');
    // The full triple still reads as one line, never the fragments.
    reset([approvedTd()]);
    html = norm();
    expect(html).toContain('28 000,00 $ @ 6,99 % × 72 mois');
    expect(html).not.toContain('Plafond');
    expect(html).not.toContain('Terme 72');
  });

  it('★ « Approbation choisie » wears the accent pair and the row a primary-text border — never text-primary-text on a tint', () => {
    reset([sub({ ...approvedTd(), selected: true })]);
    const html = markup();
    expect(html).toContain('Approbation choisie');
    expect(html).toContain('bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground');
    expect(html).toContain('border-primary-text');
    expect(html).not.toMatch(/bg-(?:warning|caution|danger|success|info)-bg[^"]*text-primary-text/);
  });

  it('the expired chip is the API boolean: expired:true → « Expirée »; a past date with expired:false → « Expire le … »', () => {
    reset([sub({ status: 'approved', sell_rate_bps: 699, term_months: 72, expiry_date: '2020-01-15', expired: true })]);
    let html = markup();
    expect(html).toContain('Expirée');
    expect(html).toContain('text-danger-text');
    reset([sub({ status: 'approved', sell_rate_bps: 699, term_months: 72, expiry_date: '2020-01-15', expired: false })]);
    html = markup();
    expect(html).not.toContain('Expirée');
    expect(html).toContain('Expire le ');
    expect(html).toContain('2020');
  });
});

describe('submissions panel › the two chips on the selected row', () => {
  const chosen = () => sub({ ...approvedTd(), selected: true });

  it('ceiling: finance 30 000,00 $ financed vs 28 000,00 $ ceiling → the warning chip', () => {
    reset([chosen()]);
    const html = markup({ amountFinancedCents: 3_000_000, dealType: 'finance' });
    expect(html.replace(/[\s\u00a0\u202f]/g, ' ')).toContain('Le montant financé dépasse le plafond approuvé (28 000,00 $).');
    expect(html).toContain('bg-warning-bg text-warning-text');
  });

  it('ceiling: cash and lease never compare; a null ceiling has nothing to exceed; an unselected row is silent', () => {
    reset([chosen()]);
    expect(markup({ amountFinancedCents: 3_000_000, dealType: 'cash' })).not.toContain('dépasse le plafond');
    expect(markup({ amountFinancedCents: 3_000_000, dealType: 'lease' })).not.toContain('dépasse le plafond');
    reset([sub({ ...chosen(), approval_amount_cents: null })]);
    expect(markup({ amountFinancedCents: 3_000_000, dealType: 'finance' })).not.toContain('dépasse le plafond');
    reset([approvedTd()]);
    expect(markup({ amountFinancedCents: 3_000_000, dealType: 'finance' })).not.toContain('dépasse le plafond');
  });

  it('desk-differs: row 699/72/TD vs live 499/48/TD → chip; vs 699/72/TD → none; vs 699/72/ICE → chip (lender differs)', () => {
    reset([chosen()]);
    const chip = 'La feuille de calcul ne correspond plus à l’approbation choisie — choisissez-la de nouveau pour la réappliquer.';
    const differs = markup({ live: { interest_rate_bps: 499, term_months: 48, lender_id: TD } });
    expect(differs).toContain(chip);
    expect(differs).toContain('bg-caution-bg text-caution-text');
    expect(markup({ live: LIVE_TD })).not.toContain(chip);
    expect(markup({ live: { interest_rate_bps: 699, term_months: 72, lender_id: ICE } })).toContain(chip);
  });
});

describe('submissions panel › the editor', () => {
  it('the selected row’s sell rate, term and lender inputs are disabled with the locked hint; ONE form at a time', () => {
    const chosen = sub({ ...approvedTd(), selected: true });
    reset([chosen, sub({ lender_id: IA })]);
    const html = markup({ mode: { edit: chosen.id } });
    expect(html).toContain('Modification — TD Auto Finance');
    expect(html).not.toContain('Ajouter une soumission');
    expect(html.split('id="subm-ceiling"').length - 1).toBe(1);
    for (const id of ['subm-sell', 'subm-term', 'subm-lender']) {
      const field = new RegExp(`<(?:input|select)[^>]*id="${id}"[^>]*>`).exec(html);
      expect(field, id).not.toBeNull();
      expect(field![0], id).toContain('disabled=""');
      expect(field![0], id).toContain('aria-describedby="subm-locked-hint"');
    }
    expect(html).toContain('id="subm-locked-hint"');
    expect(html).toContain(D['submLockedHint']!);
    // The buy rate stays editable on the chosen row.
    const buy = /<input[^>]*id="subm-buy"[^>]*>/.exec(html);
    expect(buy![0]).not.toContain('disabled=""');
  });

  it('an unselected row’s editor leaves all three editable and offers the status select', () => {
    const td = approvedTd();
    reset([td]);
    const html = markup({ mode: { edit: td.id } });
    expect(html).toContain('id="subm-status"');
    for (const s of ['Soumise', 'Approuvée', 'Conditionnelle', 'Refusée']) expect(html).toContain(`>${s}<`);
    const sell = /<input[^>]*id="subm-sell"[^>]*>/.exec(html);
    expect(sell![0]).not.toContain('disabled=""');
    expect(html).not.toContain('id="subm-locked-hint"');
  });

  it('updateBody is a diff: nothing changed → {}, a status move travels alone, a reason only with declined', () => {
    const td = approvedTd();
    const draft = {
      lender_id: td.lender_id,
      platform: td.platform,
      status: td.status,
      buy_rate: '5.99',
      sell_rate: '6.99',
      term: '72',
      ceiling: '28000.00',
      payment: '',
      expiry: '',
      conditions: '',
      decline_reason: '',
      notes: '',
    };
    expect(updateBody(td, draft)).toEqual({});
    expect(updateBody(td, { ...draft, status: 'submitted' })).toEqual({ status: 'submitted' });
    expect(updateBody(td, { ...draft, status: 'approved', decline_reason: 'x' })).toEqual({});
    expect(updateBody(td, { ...draft, status: 'declined', decline_reason: 'x' })).toEqual({
      status: 'declined',
      decline_reason: 'x',
    });
    expect(updateBody(td, { ...draft, ceiling: '' })).toEqual({ approval_amount_cents: null });
    expect(updateBody(td, { ...draft, sell_rate: '7,49', expiry: '2026-10-15' })).toEqual({
      sell_rate_bps: 749,
      expiry_date: '2026-10-15',
    });
  });
});

describe('submissions panel › select', () => {
  it('passes onPromoted into the select hook, and applySelectResult writes the deal cache then calls it', () => {
    reset([approvedTd()]);
    markup();
    expect(state.selectOpts?.onPromoted).toBe(onPromoted);

    const queryClient = new QueryClient();
    const deal = { id: DEAL, interest_rate_bps: 699, term_months: 72, lender_id: TD } as DealT;
    const submission = sub({ ...approvedTd(), selected: true });
    applySelectResult(queryClient, DEAL, { submission, deal }, onPromoted);
    expect(queryClient.getQueryData(['deals', 'one', DEAL])).toBe(deal);
    expect(onPromoted).toHaveBeenCalledTimes(1);
    expect(onPromoted).toHaveBeenCalledWith(deal);
  });

  it('a select 422 lender_inactive renders the NEW sentence under that row', () => {
    const td = approvedTd();
    reset([td, sub({ lender_id: IA, status: 'approved', sell_rate_bps: 899, term_months: 60 })]);
    state.selectError = new ApiError(
      422,
      'lender_id',
      'lender_inactive',
      'lender_inactive',
      ['lender_inactive'],
      ['Reactivate it in the registry, or pick an active lender'],
      ['lender_id'],
    );
    state.selectVariables = td.id;
    const html = markup();
    const sentence = 'Ce prêteur est désactivé — réactivez-le au registre ou choisissez un prêteur actif.';
    expect(html).toContain(sentence);
    expect(html.split(sentence).length - 1).toBe(1);
    // The English API fallback never reaches the screen.
    expect(html).not.toContain('Reactivate it in the registry');
  });

  it('maps every 422 the routes emit to its sentence; anything else is the generic failure', () => {
    const err = (code: string, detail = code) => new ApiError(422, 'x', detail, code, [detail], [], ['x']);
    expect(submissionErrorKey(err('lender_inactive'))).toBe('submSelectErr_lender_inactive');
    expect(submissionErrorKey(err('validation_failed', 'invalid_reference'))).toBe('submErr_invalid_reference');
    expect(submissionErrorKey(err('selected_terms_locked'))).toBe('submLockedHint');
    expect(submissionErrorKey(err('conditions_unmet'))).toBe('submSelectErr_conditions_unmet');
    expect(submissionErrorKey(err('validation_failed', 'not_declined'))).toBe('submErr_not_declined');
    expect(submissionErrorKey(err('submission_not_approved'))).toBe('submSelectErr_submission_not_approved');
    expect(submissionErrorKey(err('submission_incomplete'))).toBe('submSelectErr_submission_incomplete');
    expect(submissionErrorKey(err('submission_expired'))).toBe('submSelectErr_submission_expired');
    expect(submissionErrorKey(new ApiError(500))).toBe('genericError');
    expect(submissionErrorKey(new Error('boom'))).toBe('genericError');
  });
});
