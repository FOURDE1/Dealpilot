import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createI18n, frCA } from '@dealpilot/i18n';
import type { ExpenseSummaryT, VehicleExpenseT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { formatCents } from '../deals/money.js';
import type { ExpenseDraft } from './expenses-model.js';

/**
 * F-82 — the expenses panel's claims, rendered for real (react-dom/server,
 * the submissions-panel.test.tsx harness; D-084 / A37): the reader sees the
 * SHIPPED sentence, rows without money and NO write control; the masked
 * writer gets the form and « Modifier — » but no status button, no file
 * input and no amount; the approver's control set per status is exactly the
 * ladder; chips wear the F-75 token pairs; the receipt line, the pending
 * header line, the refusal sentences, the money-free edit mode, ONE form at
 * a time, the armed void relabel and the invalid-amount alert.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const STORE = '55555555-5555-4555-8555-555555555555';
const CAR = '66666666-6666-4666-8666-666666666666';

let seq = 0;
function exp(over: Partial<VehicleExpenseT>): VehicleExpenseT {
  seq += 1;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, '0')}`,
    organization_id: ORG,
    store_id: STORE,
    vehicle_id: CAR,
    category: 'detail',
    vendor_name: 'Lave-Auto Express',
    amount_cents: 34_000,
    tax_cents: 5_092,
    total_cents: 39_092,
    invoice_number: 'LAE-1042',
    expense_date: '2026-08-15',
    description: null,
    status: 'pending',
    receipt_content_sha256: null,
    receipt_content_type: null,
    receipt_size_bytes: null,
    created_at: '2026-09-04T12:00:00.000Z',
    updated_at: '2026-09-04T12:00:00.000Z',
    ...over,
  };
}

/** The masked shape the API sends: money and receipt fields ABSENT, never null. */
function masked(row: VehicleExpenseT): VehicleExpenseT {
  const out = { ...row };
  delete out.amount_cents;
  delete out.tax_cents;
  delete out.total_cents;
  delete out.receipt_content_sha256;
  delete out.receipt_content_type;
  delete out.receipt_size_bytes;
  return out;
}

const state: {
  perms: string[];
  updateError: unknown;
  updateVariables: { id: string } | undefined;
  uploadError: unknown;
  uploadVariables: { id: string } | undefined;
} = { perms: [], updateError: null, updateVariables: undefined, uploadError: null, uploadVariables: undefined };

const logMutate = vi.fn();
const updateMutate = vi.fn();
const uploadMutate = vi.fn();

vi.mock('../../shared/permissions.js', () => ({
  usePermissionsMine: () => ({ data: new Set(state.perms), isPending: false, isError: false, isSuccess: true }),
  can: (mine: Set<string> | undefined, p: string) => mine?.has(p) ?? false,
}));
vi.mock('./expenses-api.js', () => ({
  useLogExpense: () => ({ mutateAsync: logMutate, isPending: false, error: null, reset: () => undefined }),
  useUpdateExpense: () => ({
    mutateAsync: updateMutate,
    isPending: false,
    error: state.updateError,
    variables: state.updateVariables,
    reset: () => undefined,
  }),
  useUploadReceipt: () => ({
    mutateAsync: uploadMutate,
    isPending: false,
    error: state.uploadError,
    variables: state.uploadVariables,
    reset: () => undefined,
  }),
  fetchReceipt: vi.fn(),
}));

const { ExpensesPanel, ExpensesPanelView } = await import('./expenses-panel.js');

const I = frCA.inventory as Record<string, string>;
const fr = (cents: number) => formatCents(cents, 'fr-CA');

type Mode = 'closed' | 'add' | { edit: string };

function markup(over: {
  items: VehicleExpenseT[];
  summary?: ExpenseSummaryT;
  perms: string[];
  mode?: Mode;
  draft?: ExpenseDraft;
  confirmVoidId?: string;
  pending?: boolean;
  error?: boolean;
}): string {
  state.perms = over.perms;
  const i18n = createI18n({ locale: 'fr-CA', strictIcu: true });
  const list = {
    data: over.pending || over.error ? undefined : { items: over.items, ...(over.summary ? { summary: over.summary } : {}) },
    isPending: over.pending ?? false,
    isError: over.error ?? false,
    isSuccess: !(over.pending || over.error),
  };
  const props = { vehicleId: CAR, orgId: ORG, list };
  const panel =
    over.mode || over.draft || over.confirmVoidId
      ? createElement(ExpensesPanelView, {
          ...props,
          mode: over.mode ?? 'closed',
          onModeChange: () => undefined,
          draft: over.draft ?? null,
          onDraftChange: () => undefined,
          confirmVoidId: over.confirmVoidId ?? null,
          onConfirmVoidChange: () => undefined,
        })
      : createElement(ExpensesPanel, props);
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, panel));
}

function reset() {
  state.updateError = null;
  state.updateVariables = undefined;
  state.uploadError = null;
  state.uploadVariables = undefined;
  logMutate.mockClear();
  updateMutate.mockClear();
  uploadMutate.mockClear();
}

/** The <li> card carrying this vendor's heading. */
function cardOf(html: string, vendor: string): string {
  const cards = html.match(/<li[\s\S]*?<\/li>/g) ?? [];
  const card = cards.find((c) => c.includes(`— ${vendor}</h3>`));
  expect(card, `card for ${vendor}`).toBeDefined();
  return card!;
}

const CONTROL = /aria-label="(Approuver|Refuser|Marquer payée|Annuler la dépense|Confirmer l’annulation|Modifier|Joindre un reçu|Voir le reçu) — [^"]+"/g;
const controlsOf = (card: string) => [...card.matchAll(CONTROL)].map((m) => m[1]!);

const READER: string[] = [];
const MASKED_WRITER = ['vehicle:update'];
const MANAGER = ['vehicle:update', 'expense:approve'];
const SUMMARY = { approved_cents: 39_092, pending_cents: 5_000 };

describe('expenses panel › (1) the reader — no verb, no summary', () => {
  it('renders the SHIPPED sentence, the rows with NO money, no button, no file input, no form, and fires NO mutation', () => {
    reset();
    const rows = [masked(exp({})), masked(exp({ status: 'approved', vendor_name: 'Pièces Kia Laval', category: 'parts' }))];
    const html = markup({ items: rows, perms: READER });
    expect(html).toContain('Vous pouvez consulter les dépenses ; votre rôle ne permet pas de les consigner.');
    expect(html).toContain('role="status"');
    expect(html).toContain('Esthétique — Lave-Auto Express</h3>');
    expect(html).toContain('Pièces — Pièces Kia Laval</h3>');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('$');
    expect(html).not.toContain(fr(39_092));
    expect(html).not.toContain(I['expPending']!.slice(0, 20));
    expect(html).not.toContain(I['expLogTitle']!);
    expect(logMutate).not.toHaveBeenCalled();
    expect(updateMutate).not.toHaveBeenCalled();
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it('(2) with zero rows says « Aucune dépense. » — never the CTA a reader cannot follow, and no form', () => {
    reset();
    const html = markup({ items: [], perms: READER });
    expect(html).toContain('Aucune dépense.');
    expect(html).not.toContain(I['expEmptyCta']!);
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
  });

  it('the sentence renders only once the permission answer is in, never for a holder of either verb', () => {
    reset();
    expect(markup({ items: [], perms: MASKED_WRITER })).not.toContain(I['expReadOnly']!);
    expect(markup({ items: [], perms: ['expense:approve'] })).not.toContain(I['expReadOnly']!);
  });
});

describe('expenses panel › (3) the masked writer — vehicle:update only, no summary', () => {
  it('empty ledger: the CTA sentence and the add form OPEN with its seven fields, dated today, no cancel', () => {
    reset();
    const html = markup({ items: [], perms: MASKED_WRITER });
    expect(html).toContain('Aucune dépense — consignez la première facture.');
    expect(html).toContain('<form');
    expect(html).toContain('>Consigner une dépense<');
    for (const id of ['exp-category', 'exp-vendor', 'exp-amount', 'exp-tax', 'exp-date', 'exp-invoice', 'exp-description']) {
      expect(html, id).toContain(`id="${id}"`);
    }
    // Every one of the 12 categories is offered, in enum order, by its label.
    for (const label of ['Sécurité / PDI', 'Esthétique', 'Garantie achetée pour l’unité', 'Autre']) expect(html).toContain(`>${label}<`);
    expect(html).not.toContain('>Pack');
    const date = /<input[^>]*id="exp-date"[^>]*value="(\d{4}-\d{2}-\d{2})"/.exec(html);
    expect(date).not.toBeNull();
    expect(html).toContain('>Enregistrer la dépense<');
    expect(html).not.toContain(`>${I['expCancel']}<`);
    expect(html).not.toContain(I['expReadOnly']!);
  });

  it('with a pending row: « Modifier — » is offered, ZERO status buttons, NO file input, no amount, no receipt line', () => {
    reset();
    const rows = [masked(exp({})), masked(exp({ status: 'approved', vendor_name: 'Pièces Kia Laval', receipt_content_sha256: 'a'.repeat(64) }))];
    const html = markup({ items: rows, perms: MASKED_WRITER, mode: 'add' });
    expect(controlsOf(cardOf(html, 'Lave-Auto Express'))).toEqual(['Modifier']);
    expect(controlsOf(cardOf(html, 'Pièces Kia Laval'))).toEqual([]);
    expect(html).not.toContain('type="file"');
    // No money on any card (the form's « Montant ($) » label is the only $ on the page).
    expect(/<ul[\s\S]*<\/ul>/.exec(html)![0]).not.toContain('$');
    expect(html).not.toContain('Voir le reçu');
    // The form is open beside the rows — the masked writer logs blind (the recon asymmetry).
    expect(html).toContain('<form');
    expect(html).toContain('id="exp-amount"');
  });

  it('with rows on file and the form closed, the add form sits behind « Consigner une dépense »', () => {
    reset();
    const html = markup({ items: [masked(exp({}))], perms: MASKED_WRITER });
    expect(html).not.toContain('<form');
    expect(html).toContain('>Consigner une dépense</button>');
  });
});

describe('expenses panel › (4) logger + approver with summary — the control set per status is the ladder', () => {
  const ladder = () => [
    exp({ status: 'pending', vendor_name: 'P' }),
    exp({ status: 'approved', vendor_name: 'A' }),
    exp({ status: 'paid', vendor_name: 'D' }),
    exp({ status: 'rejected', vendor_name: 'R' }),
    exp({ status: 'void', vendor_name: 'V' }),
  ];

  it('pending: Approuver / Refuser / Annuler la dépense + Modifier + Joindre un reçu', () => {
    reset();
    const html = markup({ items: ladder(), perms: MANAGER, summary: SUMMARY });
    expect(controlsOf(cardOf(html, 'P'))).toEqual(['Approuver', 'Refuser', 'Annuler la dépense', 'Modifier', 'Joindre un reçu']);
  });

  it('approved: Marquer payée / Annuler la dépense + Joindre — no Approuver, no Modifier', () => {
    reset();
    const html = markup({ items: ladder(), perms: MANAGER, summary: SUMMARY });
    expect(controlsOf(cardOf(html, 'A'))).toEqual(['Marquer payée', 'Annuler la dépense', 'Joindre un reçu']);
  });

  it('paid: Annuler la dépense + Joindre (invoices arrive late)', () => {
    reset();
    const html = markup({ items: ladder(), perms: MANAGER, summary: SUMMARY });
    expect(controlsOf(cardOf(html, 'D'))).toEqual(['Annuler la dépense', 'Joindre un reçu']);
  });

  it('rejected and void: no button and no file input — the terminals', () => {
    reset();
    const html = markup({ items: ladder(), perms: MANAGER, summary: SUMMARY });
    for (const v of ['R', 'V']) {
      const card = cardOf(html, v);
      expect(controlsOf(card), v).toEqual([]);
      expect(card, v).not.toContain('<button');
      expect(card, v).not.toContain('type="file"');
    }
  });

  it('the money line « 340,00 $ + taxes 50,92 $ = 390,92 $ » renders on every card once the summary is present', () => {
    reset();
    const html = markup({ items: [exp({})], perms: MANAGER, summary: SUMMARY }).replace(/[\s\u00a0\u202f]/g, ' ');
    expect(html).toContain('340,00 $ + taxes 50,92 $ = 390,92 $');
    expect(html).toContain('Facture LAE-1042');
  });

  it('an approver WITHOUT vehicle:update gets the moves but no form, no Modifier and no file input', () => {
    reset();
    const html = markup({ items: [exp({})], perms: ['expense:approve'], summary: SUMMARY });
    expect(controlsOf(cardOf(html, 'Lave-Auto Express'))).toEqual(['Approuver', 'Refuser', 'Annuler la dépense']);
    expect(html).not.toContain('<form');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain(I['expReadOnly']!);
  });

  it('the file input is a label-wrapped sr-only input named « Joindre un reçu — {vendor} » accepting pdf/jpeg/png', () => {
    reset();
    const html = markup({ items: [exp({})], perms: MANAGER, summary: SUMMARY });
    const input = /<input[^>]*type="file"[^>]*>/.exec(html);
    expect(input).not.toBeNull();
    expect(input![0]).toContain('class="sr-only"');
    expect(input![0]).toContain('aria-label="Joindre un reçu — Lave-Auto Express"');
    expect(input![0]).toContain('accept="application/pdf,image/jpeg,image/png"');
    expect(html).toMatch(/<label[^>]*>Joindre un reçu<input/);
  });
});

describe('expenses panel › (5) chips — text with the F-75 token pairs', () => {
  it.each([
    ['pending', 'En attente', 'bg-muted text-muted-foreground'],
    ['approved', 'Approuvée', 'bg-success-bg text-success-text'],
    ['paid', 'Payée', 'bg-success-bg text-success-text'],
    ['rejected', 'Refusée', 'bg-danger-bg text-danger-text'],
    ['void', 'Annulée', 'bg-danger-bg text-danger-text'],
  ] as const)('%s → « %s » on %s, as role=status text', (status, label, classes) => {
    reset();
    const html = markup({ items: [exp({ status })], perms: READER });
    const chip = new RegExp(`<span role="status" class="[^"]*${classes}[^"]*">${label}</span>`);
    expect(html).toMatch(chip);
    // Never text-primary-text on a tint (the F-75 rule).
    expect(html).not.toMatch(/bg-(?:success|danger|warning|caution|info)-bg[^"]*text-primary-text/);
  });
});

describe('expenses panel › (6) the receipt line', () => {
  it('« Voir le reçu — {vendor} » renders when a hash is on file, and not otherwise', () => {
    reset();
    const html = markup({ items: [exp({ receipt_content_sha256: 'b'.repeat(64), receipt_content_type: 'image/png', receipt_size_bytes: 12 })], perms: READER });
    expect(html).toContain('aria-label="Voir le reçu — Lave-Auto Express"');
    expect(html).toContain('>Voir le reçu</button>');
    expect(markup({ items: [exp({})], perms: READER })).not.toContain('Voir le reçu');
  });
});

describe('expenses panel › (7) the pending header line', () => {
  it('renders « En attente d’approbation : 510,92 $ » only when pending_cents > 0 and the summary is present', () => {
    reset();
    const on = markup({ items: [exp({})], perms: MANAGER, summary: { approved_cents: 0, pending_cents: 51_092 } }).replace(/[\s\u00a0\u202f]/g, ' ');
    expect(on).toContain('En attente d’approbation : 510,92 $');
    const zero = markup({ items: [exp({ status: 'approved' })], perms: MANAGER, summary: { approved_cents: 39_092, pending_cents: 0 } });
    expect(zero).not.toContain('En attente d’approbation');
    // Never a « 0,00 $ » of its own (« 340,00 $ » on the card is not one).
    expect(zero.replace(/[\s\u00a0\u202f]/g, ' ')).not.toMatch(/(?<!\d)0,00 \$/);
    const none = markup({ items: [masked(exp({}))], perms: MASKED_WRITER });
    expect(none).not.toContain('En attente d’approbation');
  });
});

describe('expenses panel › (8) refusals render as role=alert sentences under their row', () => {
  it('a cost_masked 403 on approve → « Vous ne pouvez pas approuver un montant que votre rôle ne voit pas. »', () => {
    reset();
    const row = exp({});
    state.updateError = new ApiError(403, 'store_id', 'cost_masked', 'forbidden', ['cost_masked'], [STORE], ['store_id']);
    state.updateVariables = { id: row.id };
    const html = markup({ items: [row, exp({ vendor_name: 'Autre' })], perms: MANAGER, summary: SUMMARY });
    const card = cardOf(html, 'Lave-Auto Express');
    expect(card).toContain('<p role="alert" class="text-xs text-danger-text">Vous ne pouvez pas approuver un montant que votre rôle ne voit pas.</p>');
    expect(cardOf(html, 'Autre')).not.toContain('role="alert"');
  });

  it('an invalid_transition 422 and an upload refusal each say their sentence; a stranger error says the generic one', () => {
    reset();
    const row = exp({});
    state.updateError = new ApiError(422, 'status', 'invalid_transition', 'invalid_transition', ['invalid_transition'], ['paid → approved'], ['status']);
    state.updateVariables = { id: row.id };
    expect(markup({ items: [row], perms: MANAGER, summary: SUMMARY })).toContain('Ce changement de statut n’est pas permis.');
    reset();
    state.uploadError = new ApiError(415, 'content-type', 'unsupported_media_type', 'unsupported_media_type', ['unsupported_media_type'], ['text/plain'], ['content-type']);
    state.uploadVariables = { id: row.id };
    expect(markup({ items: [row], perms: MANAGER, summary: SUMMARY })).toContain('Le reçu doit être un PDF, un JPEG ou un PNG.');
    reset();
    state.updateError = new ApiError(500);
    state.updateVariables = { id: row.id };
    expect(markup({ items: [row], perms: MANAGER, summary: SUMMARY })).toContain(I['genericError']!);
  });
});

describe('expenses panel › (9) edit mode — the money is fixed at entry', () => {
  it('« Modification — {vendor} », the five facts prefilled, NO amount inputs, the expMoneyFixed sentence', () => {
    reset();
    const row = exp({ description: 'Lavage complet' });
    const html = markup({ items: [row], perms: MANAGER, summary: SUMMARY, mode: { edit: row.id } });
    expect(html).toContain('Modification — Lave-Auto Express');
    expect(html).toContain('Montant fixé à la saisie — annulez la dépense et consignez-la de nouveau pour corriger le montant.');
    expect(html).not.toContain('id="exp-amount"');
    expect(html).not.toContain('id="exp-tax"');
    expect(html).toMatch(/<input[^>]*id="exp-vendor"[^>]*value="Lave-Auto Express"/);
    expect(html).toMatch(/<input[^>]*id="exp-invoice"[^>]*value="LAE-1042"/);
    expect(html).toMatch(/<input[^>]*id="exp-date"[^>]*value="2026-08-15"/);
    expect(html).toMatch(/<input[^>]*id="exp-description"[^>]*value="Lavage complet"/);
    expect(html).toContain(`>${I['expCancel']}<`);
  });
});

describe('expenses panel › (10) ONE form at a time', () => {
  it('in edit mode the add form is gone: one exp-vendor, no « Consigner une dépense » anywhere', () => {
    reset();
    const row = exp({});
    const html = markup({ items: [row, exp({ vendor_name: 'B' })], perms: MANAGER, summary: SUMMARY, mode: { edit: row.id } });
    expect(html.split('id="exp-vendor"').length - 1).toBe(1);
    expect(html.split('<form').length - 1).toBe(1);
    expect(html).not.toContain('Consigner une dépense');
  });

  it('in add mode with rows on file the form carries a cancel button and no editor heading', () => {
    reset();
    const html = markup({ items: [exp({})], perms: MANAGER, summary: SUMMARY, mode: 'add' });
    expect(html.split('<form').length - 1).toBe(1);
    expect(html).toContain('>Consigner une dépense</h3>');
    expect(html).not.toContain('Modification —');
    expect(html).toContain(`>${I['expCancel']}<`);
  });
});

describe('expenses panel › (11) the void two-step — the SAME button relabels', () => {
  it('unarmed: « Annuler la dépense — {vendor} » as ghost; armed: « Confirmer l’annulation — {vendor} » as destructive, and the other row stays unarmed', () => {
    reset();
    const a = exp({ vendor_name: 'A' });
    const b = exp({ vendor_name: 'B' });
    const off = markup({ items: [a, b], perms: MANAGER, summary: SUMMARY });
    const offBtn = /<button[^>]*aria-label="Annuler la dépense — A"[^>]*>Annuler la dépense<\/button>/.exec(off);
    expect(offBtn).not.toBeNull();
    expect(offBtn![0]).not.toContain('bg-destructive');
    expect(off).not.toContain('Confirmer l’annulation');

    const on = markup({ items: [a, b], perms: MANAGER, summary: SUMMARY, confirmVoidId: a.id });
    const onBtn = /<button[^>]*aria-label="Confirmer l’annulation — A"[^>]*>Confirmer l’annulation<\/button>/.exec(on);
    expect(onBtn).not.toBeNull();
    expect(onBtn![0]).toContain('bg-destructive text-destructive-foreground');
    expect(on).not.toContain('aria-label="Annuler la dépense — A"');
    expect(on).toContain('aria-label="Annuler la dépense — B"');
    // Exactly one void control per card either way — the relabel adds no button.
    expect(controlsOf(cardOf(on, 'A'))).toEqual(['Approuver', 'Refuser', 'Confirmer l’annulation', 'Modifier', 'Joindre un reçu']);
  });
});

describe('expenses panel › (12) the invalid amount', () => {
  it('« abc » in Montant → aria-invalid, aria-describedby=exp-amount-error and the role=alert « Montant invalide »; the tax field too', () => {
    reset();
    const draft: ExpenseDraft = {
      category: 'detail',
      vendor_name: 'Lave-Auto Express',
      amount: 'abc',
      tax: '5%',
      expense_date: '2026-08-15',
      invoice_number: '',
      description: '',
    };
    const html = markup({ items: [], perms: MASKED_WRITER, mode: 'add', draft });
    const amount = /<input[^>]*id="exp-amount"[^>]*>/.exec(html);
    expect(amount).not.toBeNull();
    expect(amount![0]).toContain('aria-invalid="true"');
    expect(amount![0]).toContain('aria-describedby="exp-amount-error"');
    expect(amount![0]).toContain('inputMode="decimal"');
    expect(html).toContain('<p id="exp-amount-error" role="alert" class="text-xs text-danger-text">Montant invalide</p>');
    expect(html).toContain('id="exp-tax-error"');
    // The submit is disabled while an amount is invalid.
    expect(/<button type="submit"[^>]*>/.exec(html)![0]).toContain('disabled=""');
  });

  it('a valid draft enables the submit and shows no alert', () => {
    reset();
    const draft: ExpenseDraft = {
      category: 'parts',
      vendor_name: 'Pièces Kia Laval',
      amount: '120',
      tax: '',
      expense_date: '2026-08-15',
      invoice_number: '',
      description: '',
    };
    const html = markup({ items: [], perms: MASKED_WRITER, mode: 'add', draft });
    expect(html).not.toContain('role="alert"');
    expect(/<button type="submit"[^>]*>/.exec(html)![0]).not.toContain('disabled=""');
    expect(html).toMatch(/<select[^>]*id="exp-category"[^>]*>[\s\S]*?<option value="parts" selected="">Pièces<\/option>/);
  });
});

describe('expenses panel › the list states', () => {
  it('pending → « Chargement… » aria-busy; error → the loadError alert; neither offers a form', () => {
    reset();
    const loading = markup({ items: [], perms: MANAGER, pending: true });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain(I['loading']!);
    expect(loading).not.toContain('<form');
    const failed = markup({ items: [], perms: MANAGER, error: true });
    expect(failed).toContain(`<p role="alert" class="text-sm text-danger-text">${I['loadError']}</p>`);
    expect(failed).not.toContain('<form');
  });

  it('the section is a region named by its heading « Dépenses du véhicule »', () => {
    reset();
    const html = markup({ items: [], perms: READER });
    expect(html).toContain('<section aria-labelledby="exp-heading"');
    expect(html).toContain('<h2 id="exp-heading" class="text-[15px] font-semibold">Dépenses du véhicule</h2>');
  });
});
