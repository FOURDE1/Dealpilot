import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * F-08 delivery checklist (delivery.md §2) — the gate between Signed and
 * Delivered. Ten canonical items: nine SOFT (a manager may waive one, always
 * with a recorded reason) and one HARD — the safety inspection, which is a
 * legal obligation and can never be waived.
 */
export const ChecklistCode = z.enum([
  'insurance', 'void_cheque', 'funding', 'idv', 'safety',
  'vehicle_ready', 'wet_ink_file', 'delivery_date', 'drivers_booked', 'registration',
]);

/** Per-store policy: which items this store requires (owner decision D-020). */
export const ChecklistTemplate = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  code: ChecklistCode,
  label_fr: z.string(),
  label_en: z.string(),
  required: z.boolean(),
  overridable: z.boolean(),
  sort_order: z.number().int(),
  active: z.boolean(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/** A store may switch an item off or change its wording — never its code. */
export const UpdateChecklistTemplateInput = z.strictObject({
  label_fr: z.string().trim().min(1).max(120).optional(),
  label_en: z.string().trim().min(1).max(120).optional(),
  required: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100).optional(),
  active: z.boolean().optional(),
});

/** The deal's own copy — required/overridable are snapshots from attach time. */
export const DealChecklistItem = z.object({
  id: Uuid,
  organization_id: Uuid,
  deal_id: Uuid,
  code: ChecklistCode,
  label_fr: z.string(),
  label_en: z.string(),
  required: z.boolean(),
  overridable: z.boolean(),
  sort_order: z.number().int(),
  completed_at: IsoDateTime.nullable(),
  completed_by: Uuid.nullable(),
  overridden_at: IsoDateTime.nullable(),
  overridden_by: Uuid.nullable(),
  override_reason: z.string().nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/**
 * Tick an item, untick it, or waive it. A waiver always carries its reason —
 * `override_reason` is required whenever `overridden` is true.
 */
export const UpdateChecklistItemInput = z
  .strictObject({
    completed: z.boolean().optional(),
    overridden: z.boolean().optional(),
    override_reason: z.string().trim().min(3).max(300).optional(),
  })
  .refine((v) => v.overridden !== true || (v.override_reason?.length ?? 0) > 0, {
    message: 'A waiver must say why',
    path: ['override_reason'],
  })
  // A reason with no waiver to attach it to would be accepted and silently
  // dropped — the caller would believe it had been recorded.
  .refine((v) => v.override_reason === undefined || v.overridden === true, {
    message: 'A reason belongs to a waiver — send `overridden: true` with it',
    path: ['override_reason'],
  })
  // An empty body changes nothing; answering 200 to it is a lie.
  .refine((v) => v.completed !== undefined || v.overridden !== undefined, {
    message: 'Nothing to change',
    path: ['completed'],
  });

export const ChecklistItemListQuery = CursorQuery.extend({
  deal_id: Uuid.optional(),
});

/** What the deal screen needs to show the gate at a glance. */
export const ChecklistReadiness = z.object({
  deal_id: Uuid,
  ready_for_delivery: z.boolean(),
  outstanding: z.array(ChecklistCode),
  hard_blocked: z.boolean(),
});

export type ChecklistTemplateT = z.infer<typeof ChecklistTemplate>;
export type DealChecklistItemT = z.infer<typeof DealChecklistItem>;
export type ChecklistReadinessT = z.infer<typeof ChecklistReadiness>;
