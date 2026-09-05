import { describe, expect, it } from 'vitest';
import { enCA, frCA } from '@dealpilot/i18n';
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES, type ExpenseStatusT, type VehicleExpenseT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import {
  EXPENSE_CATEGORY_KEYS,
  EXPENSE_STATUS_KEYS,
  EXPENSE_TRANSITIONS,
  draftToBody,
  expenseErrorKey,
  legalMoves,
  todayLocal,
  voidStep,
  withExpenses,
  type ExpenseDraft,
} from './expenses-model.js';

/**
 * F-82 — goldens for the panel's pure decisions (D-084): the ladder mirror
 * (every terminal → []), the page's ONE addition, the money-free edit body,
 * the refusal vocabulary, the local-parts date and the two-step void.
 */

const row = (over: Partial<VehicleExpenseT>): VehicleExpenseT => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  organization_id: '22222222-2222-4222-8222-222222222222',
  store_id: '55555555-5555-4555-8555-555555555555',
  vehicle_id: '66666666-6666-4666-8666-666666666666',
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
});

const draft = (over: Partial<ExpenseDraft>): ExpenseDraft => ({
  category: 'detail',
  vendor_name: 'Lave-Auto Express',
  amount: '340',
  tax: '50,92',
  expense_date: '2026-08-15',
  invoice_number: 'LAE-1042',
  description: '',
  ...over,
});

describe('EXPENSE_TRANSITIONS — the ladder mirror', () => {
  it('is a partition: every status appears exactly once as a key, and the legal sets are exactly as ruled', () => {
    expect(Object.keys(EXPENSE_TRANSITIONS).sort()).toEqual([...EXPENSE_STATUSES].sort());
    expect(EXPENSE_TRANSITIONS).toEqual({
      pending: ['approved', 'rejected', 'void'],
      approved: ['paid', 'void'],
      paid: ['void'],
      rejected: [],
      void: [],
    });
    // 6 legal ordered pairs out of 20 — the T-X2 ladder's cell count.
    expect(Object.values(EXPENSE_TRANSITIONS).flat()).toHaveLength(6);
  });

  it.each(EXPENSE_STATUSES)('legalMoves(%s, canApprove=false) offers nothing — every transition is the manager’s door', (s) => {
    expect(legalMoves(s, false)).toEqual([]);
  });

  it.each([
    ['pending', ['approved', 'rejected', 'void']],
    ['approved', ['paid', 'void']],
    ['paid', ['void']],
    ['rejected', []],
    ['void', []],
  ] as const)('legalMoves(%s, canApprove=true) → %j; terminals stay []', (s, moves) => {
    expect(legalMoves(s as ExpenseStatusT, true)).toEqual(moves);
  });
});

describe('withExpenses — the page’s one addition', () => {
  it('2 765 000 + 39 092 = 2 804 092, and a zero ledger leaves the total as it is', () => {
    expect(withExpenses(2_765_000, 39_092)).toBe(2_804_092);
    expect(withExpenses(2_765_000, 0)).toBe(2_765_000);
    expect(withExpenses(0, 0)).toBe(0);
  });
});

describe('draftToBody — create', () => {
  it('dollars → cents, every typed field travels, expense_date always', () => {
    expect(draftToBody(draft({ description: 'Lavage complet' }), null)).toEqual({
      kind: 'create',
      body: {
        category: 'detail',
        vendor_name: 'Lave-Auto Express',
        amount_cents: 34_000,
        tax_cents: 5_092,
        invoice_number: 'LAE-1042',
        expense_date: '2026-08-15',
        description: 'Lavage complet',
      },
    });
  });

  it('a blank tax is OMITTED (the route applies 0); empty optionals are omitted', () => {
    const out = draftToBody(draft({ tax: '', invoice_number: '  ', description: '' }), null);
    expect(out).toEqual({
      kind: 'create',
      body: { category: 'detail', vendor_name: 'Lave-Auto Express', amount_cents: 34_000, expense_date: '2026-08-15' },
    });
    expect(out && 'tax_cents' in out.body).toBe(false);
  });

  it('a blank or garbage amount, a garbage tax, a blank vendor or a blank date is not a body', () => {
    expect(draftToBody(draft({ amount: '' }), null)).toBeNull();
    expect(draftToBody(draft({ amount: 'abc' }), null)).toBeNull();
    expect(draftToBody(draft({ tax: 'x' }), null)).toBeNull();
    expect(draftToBody(draft({ vendor_name: '   ' }), null)).toBeNull();
    expect(draftToBody(draft({ expense_date: '' }), null)).toBeNull();
  });

  it('accepts FR and EN money habits: "1 500,00" and "1,500.00" both read 150 000 cents', () => {
    const fr = draftToBody(draft({ amount: '1 500,00', tax: '' }), null);
    const en = draftToBody(draft({ amount: '1,500.00', tax: '' }), null);
    expect(fr?.kind === 'create' && fr.body.amount_cents).toBe(150_000);
    expect(en?.kind === 'create' && en.body.amount_cents).toBe(150_000);
  });
});

describe('draftToBody — edit bodies are diffs with no amount keys', () => {
  it('nothing changed → null (the screen sends nothing)', () => {
    expect(draftToBody(draft({}), row({}))).toBeNull();
  });

  it('only the changed keys travel; the amount typed in the draft never does', () => {
    const out = draftToBody(draft({ invoice_number: 'LAE-1043', amount: '999', tax: '1' }), row({}));
    expect(out).toEqual({ kind: 'update', body: { invoice_number: 'LAE-1043' } });
    expect(out && Object.keys(out.body)).not.toContain('amount_cents');
    expect(out && Object.keys(out.body)).not.toContain('tax_cents');
  });

  it('every one of the five facts diffs; a cleared optional travels as null', () => {
    const out = draftToBody(
      draft({ category: 'parts', vendor_name: 'Pièces Kia Laval', expense_date: '2026-08-16', invoice_number: '', description: 'x' }),
      row({}),
    );
    expect(out).toEqual({
      kind: 'update',
      body: {
        category: 'parts',
        vendor_name: 'Pièces Kia Laval',
        invoice_number: null,
        expense_date: '2026-08-16',
        description: 'x',
      },
    });
  });

  it('a blank vendor on edit is not a change (the row keeps its name)', () => {
    expect(draftToBody(draft({ vendor_name: '' }), row({}))).toBeNull();
  });
});

describe('expenseErrorKey — exhaustive over the six codes + fallback', () => {
  const codeErr = (code: string) => new ApiError(422, 'status', code, code, [code], [code], ['status']);
  it.each([
    ['invalid_transition', 'expErr_invalid_transition'],
    ['expense_not_pending', 'expErr_expense_not_pending'],
    ['cost_masked', 'expErr_cost_masked'],
    ['expense_closed', 'expErr_expense_closed'],
    ['content_mismatch', 'expErr_content_mismatch'],
    ['unsupported_media_type', 'expErr_unsupported_media_type'],
  ])('%s → %s', (code, key) => {
    expect(expenseErrorKey(codeErr(code))).toBe(key);
  });

  it('cost_masked is read from the DETAIL code under a top-level forbidden (the route’s shape)', () => {
    expect(expenseErrorKey(new ApiError(403, 'store_id', 'cost_masked', 'forbidden', ['cost_masked'], ['x'], ['store_id']))).toBe(
      'expErr_cost_masked',
    );
  });

  it('a plain 403, a 500 and a non-ApiError fall back to genericError', () => {
    expect(expenseErrorKey(new ApiError(403, undefined, undefined, 'forbidden'))).toBe('genericError');
    expect(expenseErrorKey(new ApiError(500))).toBe('genericError');
    expect(expenseErrorKey(new Error('boom'))).toBe('genericError');
  });

  it('every key resolves in both locales', () => {
    for (const key of [
      'expErr_invalid_transition',
      'expErr_expense_not_pending',
      'expErr_cost_masked',
      'expErr_expense_closed',
      'expErr_content_mismatch',
      'expErr_unsupported_media_type',
      'genericError',
    ]) {
      expect((frCA.inventory as Record<string, string>)[key]?.trim(), `fr ${key}`).toBeTruthy();
      expect((enCA.inventory as Record<string, string>)[key]?.trim(), `en ${key}`).toBeTruthy();
    }
  });
});

describe('todayLocal — local calendar parts, never the UTC day', () => {
  it('23:30 local on 2026-08-15 is 2026-08-15 whatever toISOString says', () => {
    const late = new Date(2026, 7, 15, 23, 30, 0);
    expect(todayLocal(late)).toBe('2026-08-15');
    // The oracle: local getters, zero-padded.
    expect(todayLocal(new Date(2026, 0, 5, 0, 5, 0))).toBe('2026-01-05');
  });

  it('differs from the UTC day when the local evening has crossed midnight in UTC', () => {
    const late = new Date(2026, 7, 15, 23, 30, 0);
    if (late.getTimezoneOffset() < 0) {
      // East of Greenwich: the UTC instant is still the 15th; the property is that
      // todayLocal reads the LOCAL day either way.
      expect(todayLocal(late)).toBe('2026-08-15');
    } else if (late.getTimezoneOffset() > 0) {
      // West (Québec): toISOString is already the 16th; todayLocal is not.
      expect(late.toISOString().slice(0, 10)).toBe('2026-08-16');
      expect(todayLocal(late)).toBe('2026-08-15');
    }
  });
});

describe('voidStep — the inline two-step', () => {
  it('first click arms the row, second click sends, blur disarms; another row’s blur is inert', () => {
    expect(voidStep('click', null, 'r1')).toEqual({ next: 'r1', send: false });
    expect(voidStep('click', 'r1', 'r1')).toEqual({ next: null, send: true });
    expect(voidStep('blur', 'r1', 'r1')).toEqual({ next: null, send: false });
    expect(voidStep('blur', 'r1', 'r2')).toEqual({ next: 'r1', send: false });
    // Arming a second row moves the arm; it never sends.
    expect(voidStep('click', 'r1', 'r2')).toEqual({ next: 'r2', send: false });
  });
});

describe('the locale partition — 12 categories + 5 statuses name themselves in BOTH bundles', () => {
  const fr = frCA.inventory as Record<string, string>;
  const en = enCA.inventory as Record<string, string>;

  it('EXPENSE_CATEGORY_KEYS covers exactly the 12 codes; every key is a distinct non-empty string in fr and en', () => {
    expect(Object.keys(EXPENSE_CATEGORY_KEYS).sort()).toEqual([...EXPENSE_CATEGORIES].sort());
    expect(EXPENSE_CATEGORIES).toHaveLength(12);
    expect(EXPENSE_CATEGORIES).not.toContain('pack');
    for (const bundle of [fr, en]) {
      const values = EXPENSE_CATEGORIES.map((c) => bundle[EXPENSE_CATEGORY_KEYS[c]]?.trim());
      expect(values.every((v) => v)).toBe(true);
      expect(new Set(values).size).toBe(12);
    }
    expect(fr['cat_warranty_cost']).toBe('Garantie achetée pour l’unité');
  });

  it('EXPENSE_STATUS_KEYS covers exactly the 5 statuses; distinct non-empty in fr and en', () => {
    expect(Object.keys(EXPENSE_STATUS_KEYS).sort()).toEqual([...EXPENSE_STATUSES].sort());
    for (const bundle of [fr, en]) {
      const values = EXPENSE_STATUSES.map((s) => bundle[EXPENSE_STATUS_KEYS[s]]?.trim());
      expect(values.every((v) => v)).toBe(true);
      expect(new Set(values).size).toBe(5);
    }
    expect(EXPENSE_STATUSES.map((s) => fr[EXPENSE_STATUS_KEYS[s]])).toEqual([
      'En attente', 'Approuvée', 'Payée', 'Refusée', 'Annulée',
    ]);
  });

  it('every fr exp* string with an apostrophe uses the typographic ’ (the review rule, made a test)', () => {
    for (const [key, value] of Object.entries(fr)) {
      if (!/^(exp|cat_|status_)/.test(key)) continue;
      expect(value, `fr ${key} uses a straight apostrophe`).not.toContain("'");
    }
    expect(en['expWithCostCaption']).toContain('ledger’s');
  });
});
