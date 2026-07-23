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

/**
 * The slug drives subdomains + intake URLs (multi-tenancy.md §7): platform
 * namespaces are reserved, and the slug is IMMUTABLE after creation — it is
 * deliberately absent from UpdateOrganizationInput.
 */
const RESERVED_SLUGS = new Set(['www', 'api', 'app', 'admin', 'in', 'status']);
const orgSlugInput = orgSlug.refine((s) => !RESERVED_SLUGS.has(s), {
  message: 'This slug is reserved',
});

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

/**
 * Create carries the defaults; update never does (see common.ts header).
 * `status` and `plan_tier` are PLATFORM authority (billing/suspension —
 * admin-console.md §4): tenants never set them; the server defaults apply
 * (review 2026-07-24 — an owner must not self-un-suspend or self-upgrade).
 */
export const CreateOrganizationInput = z.strictObject({
  name: orgName,
  slug: orgSlugInput,
  default_locale: Locale.default('fr-CA'),
});

/** No `slug` (immutable), no `status`/`plan_tier` (platform authority). */
export const UpdateOrganizationInput = z.strictObject({
  name: orgName.optional(),
  default_locale: Locale.optional(),
});

export type OrganizationT = z.infer<typeof Organization>;
export type CreateOrganizationInputT = z.infer<typeof CreateOrganizationInput>;
export type UpdateOrganizationInputT = z.infer<typeof UpdateOrganizationInput>;
