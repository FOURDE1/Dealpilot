import { z } from 'zod';
import { IsoDateTime, NonNegativeCents, Uuid } from './common.js';

/**
 * F-82 — the vehicle expenses ledger (expenses-accounting.md §1–§5, §7, §8;
 * FR-ACC-002/003/004 P1 + FR-ACC-001's category half; D-084).
 *
 * A record and a report input, NEVER a desk input: the ledger's approved sum
 * is shown BESIDE the derived vehicle total on the car page, captioned; the
 * API keeps exactly one vehicle-cost formula site (f07's derived total) and
 * nothing here feeds the desk, the engine or pay.
 *
 * Amounts are immutable after INSERT (void + re-log is the correction door),
 * so the activity trail is money-free by construction — F-79's rule: events
 * carry STATUS ONLY, because activity:read is floor-wide and cost is masked.
 * No stamps (created_by / approved_by / paid_at): the created/updated events
 * own actorship and time (0074's submitted_by precedent).
 */

/**
 * Twelve codes, one literal enum so enum-vocabulary binds `category` to the
 * 0075 CHECK. Cut BY NAME (D-084 records each un-cut): purchase / transport
 * (the vehicle's own cost columns own those numbers), commission_sales /
 * commission_fi (F-09 is the ledger of pay), pack (a report line of FR-REP-004's
 * per-unit P&L, never a car-page entry).
 */
export const ExpenseCategory = z.enum([
  'safety_pdi', 'recon_mech', 'recon_body', 'detail', 'parts', 'sublet', 'keys',
  'advertising', 'floorplan', 'warranty_cost', 'admin', 'other',
]);
export const EXPENSE_CATEGORIES = ExpenseCategory.options;
export type ExpenseCategoryT = z.infer<typeof ExpenseCategory>;

/**
 * The ladder (route-enforced; the CHECK is vocabulary only): pending →
 * approved | rejected | void; approved → paid | void; paid → void; rejected
 * and void are terminal. Every transition runs under expense:approve.
 */
export const ExpenseStatus = z.enum(['pending', 'approved', 'paid', 'rejected', 'void']);
export const EXPENSE_STATUSES = ExpenseStatus.options;
export type ExpenseStatusT = z.infer<typeof ExpenseStatus>;

export const ReceiptContentType = z.enum(['application/pdf', 'image/jpeg', 'image/png']);

/**
 * The read model. Money and receipt metadata are `.optional()` = ABSENT when
 * the caller's cost view does not cover the vehicle's store (FR-TEN-006 /
 * D-052: masked fields are absent, never null — vehicle.ts' precedent). A
 * receipt IS the amount, so it masks with the amounts. The storage key never
 * travels on the wire.
 */
export const VehicleExpense = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  vehicle_id: Uuid,
  category: ExpenseCategory,
  vendor_name: z.string(),
  amount_cents: NonNegativeCents.optional(),
  tax_cents: NonNegativeCents.optional(),
  /** GENERATED amount_cents + tax_cents (0075) — never written by a route. */
  total_cents: NonNegativeCents.optional(),
  invoice_number: z.string().nullable(),
  /** A calendar day, serialized 'YYYY-MM-DD' by the API (pg has no DATE parser). */
  expense_date: z.iso.date(),
  description: z.string().nullable(),
  status: ExpenseStatus,
  receipt_content_sha256: z.string().nullable().optional(),
  receipt_content_type: ReceiptContentType.nullable().optional(),
  receipt_size_bytes: z.number().int().nullable().optional(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/**
 * « Dépenses ajoutées » = Σ total_cents over approved + paid rows; pending
 * money is shown apart. ABSENT (never {0, 0}) when the store is masked; a
 * granted viewer of a zero-expense car reads a real {0, 0}. No `count`.
 */
export const ExpenseSummary = z.object({
  approved_cents: NonNegativeCents,
  pending_cents: NonNegativeCents,
});

export const VehicleExpensesResult = z.object({
  items: z.array(VehicleExpense),
  summary: ExpenseSummary.optional(),
});

/**
 * Create = the invoice as logged. No organization_id / store_id (the
 * vehicle-addressed route copies both from the live vehicle); no status
 * (born pending); no .default() anywhere — tax_cents omitted is applied as 0
 * by the route. `expense_date` is REQUIRED: no server clock decides the day
 * (the form always sends today's local date). Strict, so `total_cents`,
 * `status`, `amount` typos are 422.
 */
export const CreateExpenseInput = z.strictObject({
  category: ExpenseCategory,
  vendor_name: z.string().trim().min(1).max(120),
  amount_cents: NonNegativeCents,
  tax_cents: NonNegativeCents.optional(),
  invoice_number: z.string().trim().min(1).max(60).optional(),
  expense_date: z.iso.date(),
  description: z.string().trim().min(1).max(500).optional(),
});

/**
 * Update: the ladder's `status` (the full enum — the route decides legality
 * and a same-status PATCH is a no-op) and the five facts editable while
 * pending. NEVER amount_cents / tax_cents (INSERT-only), never a receipt
 * field (the receipt route owns them), never a stamp. No .default();
 * .refine non-empty (the UpdateSubmissionInput shape).
 */
export const UpdateExpenseInput = z
  .strictObject({
    status: ExpenseStatus.optional(),
    category: ExpenseCategory.optional(),
    vendor_name: z.string().trim().min(1).max(120).optional(),
    invoice_number: z.string().trim().min(1).max(60).nullable().optional(),
    expense_date: z.iso.date().optional(),
    description: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'nothing to change' });

export type VehicleExpenseT = z.infer<typeof VehicleExpense>;
export type ExpenseSummaryT = z.infer<typeof ExpenseSummary>;
export type VehicleExpensesResultT = z.infer<typeof VehicleExpensesResult>;
export type CreateExpenseInputT = z.infer<typeof CreateExpenseInput>;
export type UpdateExpenseInputT = z.infer<typeof UpdateExpenseInput>;
