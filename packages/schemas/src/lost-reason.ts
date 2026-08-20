import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * F-53 — lost reasons (leads.md §11). Tenant config: WHY a lead was lost,
 * bilingual by construction (Bill 96 — name_fr is required, never the
 * legacy's nullable afterthought). Marking a lead lost requires one; the
 * enforcement lives on the lead PATCH, not here.
 */

const label = z.string().trim().min(1).max(80);

export const LostReason = z.object({
  id: Uuid,
  organization_id: Uuid,
  /** NULL = org-wide; a store row narrows the pick-list for that store. */
  store_id: Uuid.nullable(),
  name: z.string(),
  name_fr: z.string(),
  icon: z.string(),
  display_order: z.number().int(),
  is_active: z.boolean(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const CreateLostReasonInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid.nullable().optional(),
  name: label,
  name_fr: label,
  icon: z.string().trim().min(1).max(8).default('📝'),
  display_order: z.coerce.number().int().min(0).max(999).default(0),
});

// No .default() anywhere: a defaulted field would inject into every PATCH
// and silently overwrite stored config (the defaults-leak regression).
export const UpdateLostReasonInput = z
  .strictObject({
    name: label.optional(),
    name_fr: label.optional(),
    icon: z.string().trim().min(1).max(8).optional(),
    display_order: z.coerce.number().int().min(0).max(999).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export const LostReasonListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  /** A store's pick-list: org-wide reasons plus that store's own. */
  store_id: Uuid.optional(),
  /** Management screens pass 'true'; pick-lists default to active only.
   * House boolean (appointment.ts): z.coerce.boolean would read "false" as true. */
  include_inactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type LostReasonT = z.infer<typeof LostReason>;
export type CreateLostReasonInputT = z.infer<typeof CreateLostReasonInput>;
export type UpdateLostReasonInputT = z.infer<typeof UpdateLostReasonInput>;
