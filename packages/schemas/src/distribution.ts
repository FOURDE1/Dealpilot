import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';

/**
 * F-45 — weighted store distribution (FR-LEAD-007, D-049). Money is INTEGER
 * CENTS (ADR-009); months are always the first of month, ISO 'YYYY-MM-01'.
 */

/** Mirrors core's DISTRIBUTION_PLATFORMS — lockstep-tested, never imported. */
export const DistributionPlatform = z.enum(['google', 'meta']);

const MonthDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "expected the first of a month, 'YYYY-MM-01'");

export const DistributionRow = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  platform: DistributionPlatform,
  month: z.string(),
  contribution_amount_cents: z.number().int(),
  contribution_percentage: z.string(),
  leads_received: z.number().int(),
  actual_percentage: z.string(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/**
 * Replace-style upsert for one platform+month: every store named gets its
 * amount written, and contribution_percentage is recomputed for ALL of the
 * platform-month's rows in the same transaction (leads.md:164).
 */
export const PutDistributionConfigInput = z.strictObject({
  organization_id: Uuid,
  platform: DistributionPlatform,
  month: MonthDate,
  entries: z
    .array(z.strictObject({ store_id: Uuid, contribution_amount_cents: z.number().int().min(0) }))
    .min(1)
    .max(50),
});

export const DistributionQuery = z.object({
  organization_id: Uuid,
  platform: DistributionPlatform.optional(),
  month: MonthDate.optional(),
});

export type DistributionRowT = z.infer<typeof DistributionRow>;
export type PutDistributionConfigInputT = z.infer<typeof PutDistributionConfigInput>;
