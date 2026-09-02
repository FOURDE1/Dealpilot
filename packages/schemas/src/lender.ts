import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';

/**
 * F-80 — the lender registry (lenders-billofsale.md §1.1–§1.2; FR-FIN-007 P1).
 *
 * Tenant config, the F-53 lost-reasons family: WHO can fund a deal. The deal
 * names its lender through `deals.lender_id`; members read the registry (the
 * desking Select and the render sites need names), `lender:manage` writes it.
 * No pricing vocabulary lives here — rates stay on the deal (D-081) — and none
 * of §2's submission vocabulary is declared: that is the submissions slice.
 */

/**
 * Display order is the spec's: PRIME → NEAR_PRIME → SUBPRIME → CAPTIVE.
 * The legacy's IN_HOUSE (zero seed rows — a value nothing produces) and CUSTOM
 * (a localStorage artifact; a tenant-created lender gets a REAL category) are
 * cut by name (D-081).
 */
export const LENDER_CATEGORIES = ['PRIME', 'NEAR_PRIME', 'SUBPRIME', 'CAPTIVE'] as const;
export const LenderCategory = z.enum(LENDER_CATEGORIES);
export type LenderCategoryT = z.infer<typeof LenderCategory>;

/**
 * §1.2's Canadian catalog, VERBATIM from the legacy file the spec documents
 * (the read-only legacy specs repo under reference/, at
 * client/src/utils/lenderData.js:21-43): full
 * names, all 18 shortNames, the two real notes; empty-string notes become
 * null. 7 PRIME + 5 NEAR_PRIME + 5 SUBPRIME + 1 CAPTIVE.
 *
 * The single source for ALL THREE birth paths: f01 `seedLenders`, the console
 * birth via org-seeds `provisioningSeeds()`, and — frozen, lockstep-pinned by
 * apps/api/src/f80-lender-seed.test.ts — the 0073 backfill for existing
 * organizations. `defaultRate` is deliberately absent: pricing stays on the
 * deal (D-081).
 */
export const LENDER_DEFAULTS: readonly {
  name: string;
  short_name: string;
  category: LenderCategoryT;
  notes: string | null;
}[] = [
  { name: 'TD Auto Finance', short_name: 'TD', category: 'PRIME', notes: null },
  { name: 'RBC Royal Bank', short_name: 'RBC', category: 'PRIME', notes: null },
  { name: 'CIBC', short_name: 'CIBC', category: 'PRIME', notes: null },
  { name: 'Scotiabank', short_name: 'Scotia', category: 'PRIME', notes: null },
  { name: 'Desjardins', short_name: 'Desj.', category: 'PRIME', notes: null },
  { name: 'National Bank', short_name: 'NBC', category: 'PRIME', notes: null },
  { name: 'BMO Bank of Montreal', short_name: 'BMO', category: 'PRIME', notes: null },
  { name: 'Scotia Dealer Advantage', short_name: 'SDA', category: 'NEAR_PRIME', notes: null },
  { name: 'iA Financial Group (Industrial Alliance)', short_name: 'iA', category: 'NEAR_PRIME', notes: null },
  { name: 'ACC (Automotive Credit Corporation)', short_name: 'ACC', category: 'NEAR_PRIME', notes: null },
  { name: 'TD Non-Prime (TD Auto Finance Special)', short_name: 'TD NP', category: 'NEAR_PRIME', notes: 'TD subprime program' },
  { name: 'Eden Park', short_name: 'Eden', category: 'NEAR_PRIME', notes: null },
  { name: 'Santander Consumer Canada', short_name: 'Sant.', category: 'SUBPRIME', notes: null },
  { name: 'Iceberg Finance', short_name: 'Ice.', category: 'SUBPRIME', notes: null },
  { name: 'Quantifi (by Desjardins)', short_name: 'Quant.', category: 'SUBPRIME', notes: null },
  { name: 'Rifco National Auto Finance', short_name: 'Rifco', category: 'SUBPRIME', notes: null },
  { name: 'Northlake Financial', short_name: 'NLake', category: 'SUBPRIME', notes: null },
  { name: 'Kia Finance (KFCC)', short_name: 'KIA', category: 'CAPTIVE', notes: 'Kia Finance Company of Canada' },
];

export const Lender = z.object({
  id: Uuid,
  organization_id: Uuid,
  name: z.string(),
  /** Compact label the pipeline card renders; NULL falls back to name. */
  short_name: z.string().nullable(),
  category: LenderCategory,
  contact_name: z.string().nullable(),
  contact_email: z.string().nullable(),
  contact_phone: z.string().nullable(),
  notes: z.string().nullable(),
  /** §1.1 soft deactivation: history keeps its name; only NEW picks stop. */
  active: z.boolean(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const CreateLenderInput = z.strictObject({
  organization_id: Uuid,
  name: z.string().trim().min(1).max(120),
  short_name: z.string().trim().min(1).max(20).optional(),
  category: LenderCategory,
  contact_name: z.string().trim().max(120).optional(),
  contact_email: z.string().trim().max(254).pipe(z.email()).optional(),
  contact_phone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(500).optional(),
});

// No .default() anywhere: a defaulted field would inject into every PATCH
// and silently overwrite stored config (the defaults-leak regression).
export const UpdateLenderInput = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    short_name: z.string().trim().min(1).max(20).nullable().optional(),
    category: LenderCategory.optional(),
    contact_name: z.string().trim().max(120).nullable().optional(),
    contact_email: z.string().trim().max(254).pipe(z.email()).nullable().optional(),
    contact_phone: z.string().trim().max(30).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    /** false IS the deactivate; true reactivates. No dedicated endpoint. */
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export const LenderListQuery = z.object({
  organization_id: Uuid.optional(),
  /** Management screens pass 'true'; pick-lists default to active only.
   * House boolean (lost-reason.ts): z.coerce.boolean would read "false" as true. */
  include_inactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** A pick-list never outgrows one page — bounded, no cursor. */
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type LenderT = z.infer<typeof Lender>;
export type CreateLenderInputT = z.infer<typeof CreateLenderInput>;
export type UpdateLenderInputT = z.infer<typeof UpdateLenderInput>;
export type LenderListQueryT = z.infer<typeof LenderListQuery>;
