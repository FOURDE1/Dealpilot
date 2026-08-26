import { z } from 'zod';
import { IsoDateTime, Locale, MESSAGE_KEYS, ProvinceCA, Uuid, withKey } from './common.js';

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
  .min(3)
  .max(40)
  .refine((v) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v), withKey(MESSAGE_KEYS.org_slug_format));

/**
 * The slug drives subdomains + intake URLs (multi-tenancy.md §7): platform
 * namespaces are reserved, and the slug is IMMUTABLE after creation — it is
 * deliberately absent from UpdateOrganizationInput.
 */
/** Slugs a tenant may never take — the platform's own names (F-69, admin-console.md §2). */
export const PLATFORM_RESERVED_SLUGS = ['platform', 'readyloans-platform', 'dealpilot-platform'] as const;
const RESERVED_SLUGS = new Set(['www', 'api', 'app', 'admin', 'in', 'status', ...PLATFORM_RESERVED_SLUGS]);
/** Exported for F-70 provisioning: the console's slug field obeys the same format + reserved-name rules. */
export const orgSlugInput = orgSlug.refine(
  (s) => !RESERVED_SLUGS.has(s),
  withKey(MESSAGE_KEYS.org_slug_reserved),
);

export const Organization = z.object({
  id: Uuid,
  name: orgName,
  slug: orgSlug,
  status: OrganizationStatus,
  plan_tier: PlanTier,
  /** F-69: the plan catalogue row; plan_tier is its trigger-maintained code (0065). */
  plan_id: Uuid,
  stripe_customer_id: z.string().nullable(),
  default_locale: Locale,
  /** F-69 (admin-console.md §4.1): invoices, PDFs, consent records. */
  legal_name: z.string().nullable(),
  province: ProvinceCA.nullable(),
  /** Law 25 privacy officer. */
  privacy_officer_name: z.string().nullable(),
  privacy_officer_email: z.string().nullable(),
  activated_at: IsoDateTime.nullable(),
  suspended_at: IsoDateTime.nullable(),
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
export type OrganizationStatusT = z.infer<typeof OrganizationStatus>;
export type PlanTierT = z.infer<typeof PlanTier>;
export type CreateOrganizationInputT = z.infer<typeof CreateOrganizationInput>;
export type UpdateOrganizationInputT = z.infer<typeof UpdateOrganizationInput>;
