import { z } from 'zod';
import { IsoDateTime, Locale, Uuid } from './common.js';

/**
 * Tenant root: Platform → Organization (dealer group) → Store.
 * Vocabularies are exact per multi-tenancy.md §3 (organizations table).
 */
export const OrganizationStatus = z.enum([
  'active',
  'trial',
  'past_due',
  'read_only',
  'suspended',
  'offboarding',
  'purged',
]);

/** Drives entitlements/quotas (ADR-024, ADR-011). */
export const PlanTier = z.enum(['core', 'growth', 'scale', 'enterprise']);

const orgName = z.string().trim().min(1).max(200);
const orgSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case, lowercase alphanumerics')
  .min(3)
  .max(40);

export const Organization = z.object({
  id: Uuid,
  name: orgName,
  slug: orgSlug,
  status: OrganizationStatus,
  plan_tier: PlanTier,
  stripe_customer_id: z.string().nullable(),
  default_locale: Locale,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
});

/** Create carries the defaults; update never does (see common.ts header). */
export const CreateOrganizationInput = z.strictObject({
  name: orgName,
  slug: orgSlug,
  status: OrganizationStatus.default('active'),
  plan_tier: PlanTier.default('core'),
  default_locale: Locale.default('fr-CA'),
});

export const UpdateOrganizationInput = z.strictObject({
  name: orgName.optional(),
  slug: orgSlug.optional(),
  status: OrganizationStatus.optional(),
  plan_tier: PlanTier.optional(),
  default_locale: Locale.optional(),
});

export type OrganizationT = z.infer<typeof Organization>;
export type CreateOrganizationInputT = z.infer<typeof CreateOrganizationInput>;
export type UpdateOrganizationInputT = z.infer<typeof UpdateOrganizationInput>;
