import { z } from 'zod';
import { CursorQuery, Email, IsoDateTime, Locale, ProvinceCA, Uuid, paginated } from './common.js';
import { OrganizationStatus, PlanTier } from './organization.js';
import { ActivityEvent } from './activity.js';

/**
 * F-69 — platform staff and the tenant directory (admin-console.md §3/§4).
 *
 * Roles are the spec's three; authority in routes is a CAPABILITY, never a
 * role name (the A-13/D-033 discipline, applied to the platform). Only the
 * capabilities slice 1 enforces exist here — later slices add theirs WITH
 * their routes; apps/api/src/platform-drift.test.ts fails on a capability
 * nothing enforces (the dead-vocabulary rule).
 */
export const PLATFORM_ROLES = ['platform_super_admin', 'platform_support', 'platform_billing'] as const;
export const PlatformRole = z.enum(PLATFORM_ROLES);
export type PlatformRoleT = z.infer<typeof PlatformRole>;

export const PlatformStaffStatus = z.enum(['active', 'revoked']);

export const PLATFORM_CAPABILITIES = {
  'tenants:read': ['platform_super_admin', 'platform_support', 'platform_billing'],
  'tenants:update': ['platform_super_admin'],
  'tenants:set_status': ['platform_super_admin'],
  'tenants:set_plan': ['platform_super_admin', 'platform_billing'],
  'plan:read': ['platform_super_admin', 'platform_support', 'platform_billing'],
  'staff:manage': ['platform_super_admin'],
} as const satisfies Record<string, readonly PlatformRoleT[]>;
export type PlatformCapabilityT = keyof typeof PLATFORM_CAPABILITIES;
export const PLATFORM_CAPABILITY_NAMES = Object.keys(PLATFORM_CAPABILITIES) as [PlatformCapabilityT, ...PlatformCapabilityT[]];
export const PlatformCapability = z.enum(PLATFORM_CAPABILITY_NAMES);

export function capabilitiesOf(role: PlatformRoleT): PlatformCapabilityT[] {
  return PLATFORM_CAPABILITY_NAMES.filter((c) => (PLATFORM_CAPABILITIES[c] as readonly string[]).includes(role));
}

export const AdminMeResponse = z.object({
  user: z.object({ id: Uuid, email: Email, name: z.string() }),
  role: PlatformRole,
  capabilities: z.array(PlatformCapability),
  /** The gate refuses an unenrolled staffer, so a 200 always carries `true`. */
  mfa_enabled: z.literal(true),
  session: z.object({ created_at: IsoDateTime, reauth_by: IsoDateTime }),
});

export const PlanOverage = z.enum(['hard_stop', 'metered']);
export const Plan = z.object({
  id: Uuid,
  code: PlanTier,
  name: z.string(),
  /** NULL = negotiated per contract (enterprise). */
  monthly_price_cents_per_store: z.number().int().nonnegative().nullable(),
  /** NULL = unlimited. */
  included_seats: z.number().int().positive().nullable(),
  included_ai_minutes: z.number().int().nonnegative(),
  included_sms_segments: z.number().int().nonnegative(),
  included_ai_conversations: z.number().int().nonnegative(),
  included_storage_gb: z.number().int().nonnegative().nullable(),
  features: z.record(z.string(), z.boolean()),
  overage: PlanOverage,
  active: z.boolean(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export const PlanList = z.object({ items: z.array(Plan) });

export const AdminTenant = z.object({
  id: Uuid,
  name: z.string(),
  slug: z.string(),
  legal_name: z.string().nullable(),
  status: OrganizationStatus,
  plan_id: Uuid,
  plan_code: PlanTier,
  province: ProvinceCA.nullable(),
  default_locale: Locale,
  store_count: z.number().int().nonnegative(),
  member_count: z.number().int().nonnegative(),
  created_at: IsoDateTime,
  activated_at: IsoDateTime.nullable(),
  suspended_at: IsoDateTime.nullable(),
  deleted_at: IsoDateTime.nullable(),
});
export const AdminTenantStore = z.object({
  id: Uuid,
  name: z.string(),
  code: z.string(),
  province: ProvinceCA,
  status: z.enum(['active', 'paused', 'closed']),
});
export const AdminTenantDetail = AdminTenant.extend({
  privacy_officer_name: z.string().nullable(),
  privacy_officer_email: z.string().nullable(),
  stripe_customer_id: z.string().nullable(),
  stores: z.array(AdminTenantStore),
  owner_emails: z.array(z.string()),
  last_activity_at: IsoDateTime.nullable(),
  /** Server-computed: core matrix ∩ caller capability. The UI renders exactly these. */
  allowed_transitions: z.array(OrganizationStatus),
});
export const AdminTenantListQuery = CursorQuery.extend({
  status: OrganizationStatus.optional(),
  plan: PlanTier.optional(),
  q: z.string().trim().min(1).max(80).optional(),
});
export const AdminTenantPage = paginated(AdminTenant);

export const AdminActivityEvent = ActivityEvent.extend({
  actor_email: z.string().nullable(),
  seq: z.number().int(),
});
export const AdminTenantEventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const AdminTenantEventsResponse = z.object({ items: z.array(AdminActivityEvent) });

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
/** Profile edit; status is NOT here (transitions have their own endpoint). */
export const AdminUpdateTenantInput = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    legal_name: nullableText(200).optional(),
    province: ProvinceCA.nullable().optional(),
    privacy_officer_name: nullableText(120).optional(),
    privacy_officer_email: Email.nullable().optional(),
    default_locale: Locale.optional(),
    plan_id: Uuid.optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'reason'), { message: 'at least one field', path: ['name'] });

export const TenantStatusChangeInput = z
  .strictObject({
    status: OrganizationStatus,
    expected_from: OrganizationStatus.optional(),
    reason: z.string().trim().min(5).max(500),
    restricted: z.boolean().default(false),
    confirm_slug: z.string().trim().optional(),
  })
  .refine((v) => !['suspended', 'offboarding'].includes(v.status) || typeof v.confirm_slug === 'string', {
    message: 'confirm_slug required',
    path: ['confirm_slug'],
  });
export const TenantStatusChangeResult = AdminTenantDetail.extend({ sessions_revoked: z.number().int().nonnegative() });

export const PlatformStaffMember = z.object({
  user_id: Uuid,
  email: z.string(),
  name: z.string(),
  role: PlatformRole,
  status: PlatformStaffStatus,
  mfa_enabled: z.boolean(),
  granted_at: IsoDateTime,
  revoked_at: IsoDateTime.nullable(),
});
export const PlatformStaffList = z.object({ items: z.array(PlatformStaffMember) });
export const GrantPlatformStaffInput = z.strictObject({
  email: Email,
  role: PlatformRole,
  note: z.string().trim().min(1).max(500).optional(),
});
export const PlatformStaffGranted = PlatformStaffMember.extend({
  outcome: z.enum(['granted', 'reinstated', 'role_changed', 'unchanged']),
});

export type PlanT = z.infer<typeof Plan>;
export type AdminTenantT = z.infer<typeof AdminTenant>;
export type AdminTenantDetailT = z.infer<typeof AdminTenantDetail>;
export type AdminActivityEventT = z.infer<typeof AdminActivityEvent>;
export type AdminUpdateTenantInputT = z.infer<typeof AdminUpdateTenantInput>;
export type TenantStatusChangeInputT = z.infer<typeof TenantStatusChangeInput>;
export type PlatformStaffMemberT = z.infer<typeof PlatformStaffMember>;
export type GrantPlatformStaffInputT = z.infer<typeof GrantPlatformStaffInput>;
export type AdminMeResponseT = z.infer<typeof AdminMeResponse>;
