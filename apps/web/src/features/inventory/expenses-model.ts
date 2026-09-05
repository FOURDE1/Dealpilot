import type {
  CreateExpenseInputT,
  ExpenseCategoryT,
  ExpenseStatusT,
  UpdateExpenseInputT,
  VehicleExpenseT,
} from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { parseMoneyToCents } from '../deals/money.js';

/**
 * F-82 — the expenses panel's pure logic (the submissions-model.ts pattern:
 * decisions out of the component, goldens beside them; D-084).
 *
 * The one addition the page makes is here (`withExpenses`) and nowhere in the
 * API: the ledger's approved sum is ADDED to the derived vehicle total at
 * render, captioned, and never stored, never sent to the desk. Every other
 * function mirrors a rule the server enforces (the ladder, the money-free
 * edit body) so the screen never offers a door the server would refuse.
 */

/** `inventory:` namespace key per category — a thirteenth code fails to compile here. */
export const EXPENSE_CATEGORY_KEYS = {
  safety_pdi: 'cat_safety_pdi',
  recon_mech: 'cat_recon_mech',
  recon_body: 'cat_recon_body',
  detail: 'cat_detail',
  parts: 'cat_parts',
  sublet: 'cat_sublet',
  keys: 'cat_keys',
  advertising: 'cat_advertising',
  floorplan: 'cat_floorplan',
  warranty_cost: 'cat_warranty_cost',
  admin: 'cat_admin',
  other: 'cat_other',
} as const satisfies Record<ExpenseCategoryT, string>;

/** Status chips are TEXT (never colour alone) — one key per stored status. */
export const EXPENSE_STATUS_KEYS = {
  pending: 'status_pending',
  approved: 'status_approved',
  paid: 'status_paid',
  rejected: 'status_rejected',
  void: 'status_void',
} as const satisfies Record<ExpenseStatusT, string>;

/**
 * The ladder, mirrored from the route (spec §4's diagram): pending →
 * approved | rejected | void; approved → paid | void; paid → void; rejected
 * and void are terminal. Every status appears exactly once as a key.
 */
export type MoveTarget = Exclude<ExpenseStatusT, 'pending'>;
export const EXPENSE_TRANSITIONS: Record<ExpenseStatusT, readonly MoveTarget[]> = {
  pending: ['approved', 'rejected', 'void'],
  approved: ['paid', 'void'],
  paid: ['void'],
  rejected: [],
  void: [],
};

/**
 * The moves the screen offers on a row. ONE flag: every transition — the
 * pending → void retract included — runs under `expense:approve` (R2/A20), so
 * a masked writer with `vehicle:update` alone is shown no status button and
 * never clicks into a 403. A row never moves back to `pending`.
 */
export function legalMoves(status: ExpenseStatusT, canApprove: boolean): readonly MoveTarget[] {
  return canApprove ? EXPENSE_TRANSITIONS[status] : [];
}

/**
 * « Coût avec dépenses » — the page's ONE addition: the derived vehicle total
 * the API already computed, plus the ledger's approved + paid sum. Pure, no
 * rounding, integer cents in and out. Never a column, never a desk input.
 */
export function withExpenses(totalCostCents: number, approvedCents: number): number {
  return totalCostCents + approvedCents;
}

/** Raw form text — parsed to cents on submit, never stored as floats. */
export interface ExpenseDraft {
  category: ExpenseCategoryT;
  vendor_name: string;
  amount: string;
  tax: string;
  expense_date: string;
  invoice_number: string;
  description: string;
}

const textOrNull = (raw: string) => (raw.trim() === '' ? null : raw.trim());

export type ExpenseBody =
  | { readonly kind: 'create'; readonly body: CreateExpenseInputT }
  | { readonly kind: 'update'; readonly body: UpdateExpenseInputT };

/**
 * The create body is what was typed (dollars → cents; a blank tax is OMITTED
 * — the route applies 0, no .default() in inputs; empty optionals omitted;
 * `expense_date` ALWAYS travels). The edit body is a DIFF against the row
 * over the five facts editable while pending — an amount can never be in it
 * because an amount can never be in a PATCH (INSERT-only; void + re-log is
 * the correction door). null = a draft the screen must not send (a blank or
 * garbage amount on create, or nothing changed on edit).
 */
export function draftToBody(draft: ExpenseDraft, prior: VehicleExpenseT | null): ExpenseBody | null {
  const vendor = textOrNull(draft.vendor_name);
  const invoice = textOrNull(draft.invoice_number);
  const description = textOrNull(draft.description);
  if (prior === null) {
    if (vendor === null || draft.expense_date === '') return null;
    const amount = parseMoneyToCents(draft.amount);
    if (amount === null) return null;
    const taxRaw = draft.tax.trim();
    const tax = taxRaw === '' ? null : parseMoneyToCents(taxRaw);
    if (taxRaw !== '' && tax === null) return null;
    return {
      kind: 'create',
      body: {
        category: draft.category,
        vendor_name: vendor,
        amount_cents: amount,
        ...(tax === null ? {} : { tax_cents: tax }),
        ...(invoice === null ? {} : { invoice_number: invoice }),
        expense_date: draft.expense_date,
        ...(description === null ? {} : { description }),
      },
    };
  }
  const body: UpdateExpenseInputT = {};
  if (draft.category !== prior.category) body.category = draft.category;
  if (vendor !== null && vendor !== prior.vendor_name) body.vendor_name = vendor;
  if (invoice !== prior.invoice_number) body.invoice_number = invoice;
  if (draft.expense_date !== '' && draft.expense_date !== prior.expense_date) body.expense_date = draft.expense_date;
  if (description !== prior.description) body.description = description;
  return Object.keys(body).length === 0 ? null : { kind: 'update', body };
}

export type ExpenseErrorKey =
  | 'expErr_invalid_transition'
  | 'expErr_expense_not_pending'
  | 'expErr_cost_masked'
  | 'expErr_expense_closed'
  | 'expErr_content_mismatch'
  | 'expErr_unsupported_media_type'
  | 'genericError';

/** Every refusal the ledger's routes spell, mapped to its sentence; anything else is the generic failure. */
export function expenseErrorKey(err: unknown): ExpenseErrorKey {
  if (!(err instanceof ApiError)) return 'genericError';
  const codes = new Set<string | undefined>([err.errorCode, err.code, ...(err.detailCodes ?? [])]);
  if (codes.has('invalid_transition')) return 'expErr_invalid_transition';
  if (codes.has('expense_not_pending')) return 'expErr_expense_not_pending';
  if (codes.has('cost_masked')) return 'expErr_cost_masked';
  if (codes.has('expense_closed')) return 'expErr_expense_closed';
  if (codes.has('content_mismatch')) return 'expErr_content_mismatch';
  if (codes.has('unsupported_media_type')) return 'expErr_unsupported_media_type';
  return 'genericError';
}

/**
 * The form's date default: today from LOCAL calendar parts — never
 * `toISOString()`, which is the UTC day and is yesterday every evening east
 * of Greenwich (D-082 (17)'s class). The input always sends this string.
 */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The void button's inline two-step (checklist-dialog.tsx' relabelled-button
 * shape, A21): the FIRST click only relabels the same button; the SECOND
 * click sends; leaving it (blur) resets. Focus never moves, so WCAG 2.4.3
 * holds by construction. `current` is the row id currently armed, or null.
 */
export function voidStep(
  event: 'click' | 'blur',
  current: string | null,
  rowId: string,
): { readonly next: string | null; readonly send: boolean } {
  if (event === 'blur') return { next: current === rowId ? null : current, send: false };
  if (current === rowId) return { next: null, send: true };
  return { next: rowId, send: false };
}
