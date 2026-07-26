import { z } from 'zod';
import { IsoDateTime, NonNegativeCents, Uuid } from './common.js';

/**
 * F-13b itemised F&I (documents.md §3).
 *
 * The deal used to carry one aggregate F&I price and cost, which meant the
 * per-product agreements — warranty, GAP, aftermarket — could never be named
 * and so could never be generated. These rows are what those agreements are
 * named after; `deals.fi_price_cents` / `fi_cost_cents` remain the maintained
 * sum of them.
 */
export const FiProductKind = z.enum(['warranty', 'gap', 'aftermarket']);

/**
 * Note the absence of a per-product `taxable` flag: desking derives the tax
 * base from the deal's aggregate, so a non-taxable product would be taxed
 * regardless. See D-037 — an honoured gap beats a decorative field.
 */
export const DealFiProduct = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  deal_id: Uuid,
  kind: FiProductKind,
  name: z.string(),
  provider: z.string().nullable(),
  price_cents: z.number().int(),
  cost_cents: z.number().int(),
  term_months: z.number().int().nullable(),
  sort_order: z.number().int(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const CreateFiProductInput = z
  .strictObject({
    kind: FiProductKind,
    /** Becomes the agreement's name in the file, so a clerk can tell two apart. */
    name: z.string().trim().min(1).max(120),
    provider: z.string().trim().min(1).max(120).nullable().optional(),
    price_cents: NonNegativeCents.optional(),
    cost_cents: NonNegativeCents.optional(),
    term_months: z.number().int().positive().max(120).nullable().optional(),
    sort_order: z.number().int().min(0).max(999).optional(),
  })
  // Selling a product for less than it costs is a loss the desk should have to
  // mean, not a typo that silently lands in commissionable gross.
  .refine((v) => (v.cost_cents ?? 0) <= (v.price_cents ?? 0), {
    message: 'Cost is higher than price',
    path: ['cost_cents'],
  });

/** Defaults-free (the F-05 lesson): a PATCH carries only what it changes. */
export const UpdateFiProductInput = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    provider: z.string().trim().min(1).max(120).nullable().optional(),
    price_cents: NonNegativeCents.optional(),
    cost_cents: NonNegativeCents.optional(),
    term_months: z.number().int().positive().max(120).nullable().optional(),
    sort_order: z.number().int().min(0).max(999).optional(),
  })
  // An empty body changes nothing; answering 200 to it is a lie (the F-08 lesson).
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Nothing to change',
    path: ['name'],
  });

export type DealFiProduct = z.infer<typeof DealFiProduct>;
export type CreateFiProductInput = z.infer<typeof CreateFiProductInput>;
export type UpdateFiProductInput = z.infer<typeof UpdateFiProductInput>;
