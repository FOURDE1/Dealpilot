import { z } from 'zod';
import { CursorQuery, Email, IsoDateTime, Locale, ProvinceCA, Uuid, paginated, withKey } from './common.js';
import { OrganizationStatus, PlanTier, orgSlugInput } from './organization.js';
import { CreateStoreInput } from './store.js';
import { ActivityEvent } from './activity.js';
import { Role } from './roles.js';
import type { PermissionT } from './permissions.js';

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
  /** F-70: provision a tenant and (re)issue its owner seat (§3 "Create tenants"). */
  'tenants:create': ['platform_super_admin'],
  /** F-71 §3/§7: read-only support sessions. */
  'impersonation:start_read_only': ['platform_super_admin', 'platform_support'],
  /** F-71 §7: full mode — a super admin's alone. */
  'impersonation:start_full': ['platform_super_admin'],
  /** F-71: the register, ending a session, the member picker. Billing: none. */
  'impersonation:manage': ['platform_super_admin', 'platform_support'],
  /** F-72 §8: the announcement register and one announcement. Billing: none. */
  'announcements:read': ['platform_super_admin', 'platform_support'],
  /** F-72 §3: support may publish — and §3 says `info` only. */
  'announcements:publish': ['platform_super_admin', 'platform_support'],
  /** …anything louder than `info` is a super admin's alone (asked as a second literal). */
  'announcements:publish_elevated': ['platform_super_admin'],
  /** F-72 §5.3: seeing whether the platform is paused. */
  'settings:read': ['platform_super_admin', 'platform_support'],
  /** …flipping one is a super admin's alone (§5.3, verbatim). */
  'settings:write': ['platform_super_admin'],
  /** F-73 §9: queue depth and the failed set. §3's matrix withholds it from billing. */
  'queues:read': ['platform_super_admin', 'platform_support'],
  /**
   * F-73 §9/§11: putting a failed job back on the queue. Its own capability
   * and not half of a `queues:manage`, because §3 distinguishes looking at a
   * stuck queue from acting on one — and on `deferred-send` or `assistant-turn`
   * the act re-sends a real customer's SMS.
   */
  'queues:retry': ['platform_super_admin', 'platform_support'],
} as const satisfies Record<string, readonly PlatformRoleT[]>;
export type PlatformCapabilityT = keyof typeof PLATFORM_CAPABILITIES;
export const PLATFORM_CAPABILITY_NAMES = Object.keys(PLATFORM_CAPABILITIES) as [PlatformCapabilityT, ...PlatformCapabilityT[]];
export const PlatformCapability = z.enum(PLATFORM_CAPABILITY_NAMES);

export function capabilitiesOf(role: PlatformRoleT): PlatformCapabilityT[] {
  return PLATFORM_CAPABILITY_NAMES.filter((c) => (PLATFORM_CAPABILITIES[c] as readonly string[]).includes(role));
}

/**
 * F-71 — impersonation with audit (admin-console.md §7; D-072). The literals
 * mirror packages/core/src/impersonation.ts (schemas carries no dependency on
 * core — the TENANT_STATUSES precedent); schemas.test.ts asserts equality.
 */
export const ImpersonationMode = z.enum(['read_only', 'full']);
export const ImpersonationEndReason = z.enum(['manual', 'ttl', 'revoked']);
export const IMPERSONATION_REASON_MIN_CHARS = 20;

/**
 * Refused in EVERY mode (§7 "blocked even in full mode", widened to the
 * powers that change who holds authority, mint credentials, move pay, sign
 * legal attestations or answer customers — O-19). Typed against the
 * catalogue: a typo is a compile error, not a permission that gates nothing.
 */
export const IMPERSONATION_BLOCKED_PERMISSIONS: readonly PermissionT[] = [
  'organization:update',
  'organization:delete',
  'member:invite',
  'member:update_roles',
  'member:revoke',
  'intake_key:manage',
  'pay_plan:write',
  'document:sign',
  'checklist:sign_safety',
  'conversation:reply',
];

export const StartImpersonationInput = z.strictObject({
  /** §7 wire name; = organizations.id (D-070 2). */
  tenant_id: Uuid,
  target_user_id: Uuid,
  mode: ImpersonationMode.default('read_only'),
  reason: z.string().trim().min(IMPERSONATION_REASON_MIN_CHARS).max(500),
  ticket_ref: z.string().trim().min(1).max(60).optional(),
});
const Person = z.object({ id: Uuid, email: z.string(), name: z.string() });
export const ImpersonationSession = z.object({
  id: Uuid,
  tenant: z.object({ id: Uuid, name: z.string(), slug: z.string() }),
  platform_user: Person,
  target_user: Person,
  mode: ImpersonationMode,
  reason: z.string(),
  ticket_ref: z.string().nullable(),
  started_at: IsoDateTime,
  expires_at: IsoDateTime,
  ended_at: IsoDateTime.nullable(),
  end_reason: ImpersonationEndReason.nullable(),
  ended_by: Uuid.nullable(),
  /** ended_at IS NULL AND expires_at > now(), computed by the database. */
  active: z.boolean(),
  request_count: z.number().int().nonnegative(),
});
export const ImpersonationRequest = z.object({
  seq: z.number().int(),
  method: z.string(),
  route: z.string(),
  url: z.string(),
  status_code: z.number().int(),
  at: IsoDateTime,
});
export const ImpersonationSessionDetail = ImpersonationSession.extend({ requests: z.array(ImpersonationRequest) });
export const ImpersonationList = z.object({ items: z.array(ImpersonationSession) });
export const ImpersonationListQuery = z.object({
  tenant_id: Uuid.optional(),
  /** 'true' | 'false' | absent — a plain string on purpose: enum-vocabulary binds z.enum by field name and `plans.active` exists. */
  active: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? null : v === 'true')),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const AdminTenantMember = z.object({
  user_id: Uuid,
  email: z.string(),
  name: z.string(),
  roles: z.array(Role),
  store_codes: z.array(z.string()),
  is_platform_staff: z.boolean(),
});
export const AdminTenantMembers = z.object({ items: z.array(AdminTenantMember) });
/** What the tenant shell needs for the §7 banner — nothing more. */
export const ImpersonationBanner = z.object({
  id: Uuid,
  mode: ImpersonationMode,
  expires_at: IsoDateTime,
  tenant: z.object({ id: Uuid, name: z.string(), slug: z.string() }),
  acting_as: Person,
});
/** Tenant-side register (§7 "every session visible to the tenant"). */
export const SupportAccessEntry = ImpersonationSession.omit({ request_count: true, ended_by: true });
export const SupportAccessList = z.object({ items: z.array(SupportAccessEntry) });
export const SupportAccessQuery = z.object({
  organization_id: Uuid,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const AdminMeResponse = z.object({
  user: z.object({ id: Uuid, email: Email, name: z.string() }),
  role: PlatformRole,
  capabilities: z.array(PlatformCapability),
  /** The gate refuses an unenrolled staffer, so a 200 always carries `true`. */
  mfa_enabled: z.literal(true),
  session: z.object({ created_at: IsoDateTime, reauth_by: IsoDateTime }),
  /** F-71: the live support session bound to this console session, if any. */
  impersonation: ImpersonationSession.nullable(),
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
  /** F-70: the §4.2 trial clock; NULL for organizations not provisioned through the console. */
  trial_ends_at: IsoDateTime.nullable(),
});
/** The open owner seat of a provisioned tenant (F-70). Never the token. */
export const AdminOwnerInvitation = z.object({
  id: Uuid,
  email: z.string(),
  name: z.string().nullable(),
  expires_at: IsoDateTime,
  expired: z.boolean(),
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
  /** F-70: the open owner seat until the owner accepts (null once accepted or never issued). */
  owner_invitation: AdminOwnerInvitation.nullable(),
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
  /** F-71: the staffer behind an impersonated act (actor_email is the impersonated user). */
  impersonator_email: z.string().nullable(),
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

/**
 * F-70 — provisioning (admin-console.md §4.3). The §4.3 store body, coded
 * exactly as CreateStoreInput codes a store (uppercased, format-checked);
 * the store's locale is the tenant's (the spec's store body has no locale).
 */
export const ProvisionStoreInput = CreateStoreInput.pick({ name: true, code: true, province: true, timezone: true })
  .extend({ city: z.string().trim().min(1).max(100).optional() })
  .strict();

export const ProvisionTenantInput = z
  .strictObject({
    legal_name: z.string().trim().min(1).max(200),
    /** → organizations.name (0065: name IS §4.1 display_name). */
    display_name: z.string().trim().min(1).max(200),
    /** Format + reserved names, the same rule as self-serve (organization.ts). */
    slug: orgSlugInput,
    province: ProvinceCA,
    default_locale: Locale.default('fr-CA'),
    plan_id: Uuid,
    owner_email: Email,
    owner_name: z.string().trim().min(1).max(120),
    stores: z.array(ProvisionStoreInput).min(1).max(20),
  })
  .superRefine((v, ctx) => {
    // Refused here so the form learns the ROW; the definer refuses it again
    // (PA012) for a caller that is not this schema.
    const seen = new Set<string>();
    v.stores.forEach((s, i) => {
      if (seen.has(s.code)) {
        ctx.addIssue({ code: 'custom', path: ['stores', i, 'code'], message: 'duplicate store code', params: { key: 'duplicate_store_code' } });
      }
      seen.add(s.code);
    });
  });

export const ProvisionedOwnerInvitation = AdminOwnerInvitation.extend({
  /** Present ONLY when the mailer cannot reach the invitee (the F-12 CR-05 rule). */
  accept_url: z.string().optional(),
});
export const AdminTenantProvisioned = z.object({
  tenant: AdminTenantDetail,
  invitation: ProvisionedOwnerInvitation,
});

/** Re-send or correct the owner seat while the tenant has no owner (F-70). */
export const ReissueOwnerInvitationInput = z.strictObject({
  email: Email,
  name: z.string().trim().min(1).max(120).optional(),
});
export const OwnerInvitationReissued = ProvisionedOwnerInvitation.extend({
  revoked_invitation_ids: z.array(Uuid),
});

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
export type AdminOwnerInvitationT = z.infer<typeof AdminOwnerInvitation>;
export type ProvisionStoreInputT = z.infer<typeof ProvisionStoreInput>;
export type ProvisionTenantInputT = z.infer<typeof ProvisionTenantInput>;
export type AdminTenantProvisionedT = z.infer<typeof AdminTenantProvisioned>;
export type ReissueOwnerInvitationInputT = z.infer<typeof ReissueOwnerInvitationInput>;
export type OwnerInvitationReissuedT = z.infer<typeof OwnerInvitationReissued>;
export type ImpersonationModeT = z.infer<typeof ImpersonationMode>;
export type ImpersonationEndReasonT = z.infer<typeof ImpersonationEndReason>;
export type StartImpersonationInputT = z.infer<typeof StartImpersonationInput>;
export type ImpersonationSessionT = z.infer<typeof ImpersonationSession>;
export type ImpersonationRequestT = z.infer<typeof ImpersonationRequest>;
export type ImpersonationSessionDetailT = z.infer<typeof ImpersonationSessionDetail>;
export type ImpersonationListQueryT = z.infer<typeof ImpersonationListQuery>;
export type AdminTenantMemberT = z.infer<typeof AdminTenantMember>;
export type ImpersonationBannerT = z.infer<typeof ImpersonationBanner>;
export type SupportAccessEntryT = z.infer<typeof SupportAccessEntry>;

/* ------------------------------------------------------------------------ *
 * F-72 §5.3 — platform kill switches
 * ------------------------------------------------------------------------ */

/**
 * Two keys, not the spec's three. `webhook_delivery_pause` is deliberately
 * absent: this codebase has no outbound webhook deliverer to gate, and a
 * switch nothing consults is the dead-vocabulary bug. Adding it is a forward
 * CHECK swap on `platform_settings.setting_key` plus one gate line (D-073).
 */
export const PLATFORM_SETTING_KEYS = ['ai_outbound_killswitch', 'sms_send_killswitch'] as const;
export const PlatformSettingKey = z.enum(PLATFORM_SETTING_KEYS);
export type PlatformSettingKeyT = z.infer<typeof PlatformSettingKey>;

/**
 * The worst-case delay between a flip and every process obeying it. The API
 * and each worker are separate processes with no shared cache and no
 * invalidation channel (REDIS_URL is optional here), so this NUMBER is the
 * contract — and the console prints it beside the switch rather than implying
 * a propagation guarantee nothing makes true.
 */
export const KILL_SWITCH_TTL_MS = 5_000;

export const PlatformSetting = z.object({
  setting_key: PlatformSettingKey,
  enabled: z.boolean(),
  /** Held on the row only while the switch is ON; NULLed on resume. */
  reason: z.string().nullable(),
  changed_by_email: z.string().nullable(),
  changed_at: IsoDateTime,
});
export const PlatformSettingList = z.object({ items: z.array(PlatformSetting) });

export const SetPlatformSettingInput = z
  .strictObject({
    enabled: z.boolean(),
    reason: z.string().trim().min(10).max(500),
    /** Typed-to-confirm, required to RESUME sending, never to stop it. */
    confirm_setting_key: z.string().trim().optional(),
  })
  .refine((v) => v.enabled || typeof v.confirm_setting_key === 'string', {
    path: ['confirm_setting_key'],
    ...withKey('confirm_required'),
  });

/* ------------------------------------------------------------------------ *
 * F-72 §8 — announcements and broadcast
 * ------------------------------------------------------------------------ */

export const ANNOUNCEMENT_SEVERITIES = ['info', 'maintenance', 'incident', 'marketing'] as const;
export const AnnouncementSeverity = z.enum(ANNOUNCEMENT_SEVERITIES);
export type AnnouncementSeverityT = z.infer<typeof AnnouncementSeverity>;

/**
 * §8 spells the third arm `{"type":"tenants","tenant_ids":[…]}`. This repo
 * says organization, never tenant — `tenant_id` appears nowhere in
 * packages/schemas, which is the vocabulary source of truth — so the arm is
 * `organizations`/`organization_ids`, matching the 0068 CHECK and
 * `announcement_matches`. Recorded as a deliberate deviation in D-073.
 */
/**
 * Canonically lower-case, because the two SQL sides compare the same id with
 * two different relations: `admin_publish_announcement`'s PA026 guard casts to
 * `uuid` (case-insensitive) while `announcement_matches` tests the jsonb array
 * with `? p_org::text` (byte-exact). An upper-case id therefore passed the
 * guard and matched nobody — and §12 immutability makes that unfixable except
 * by ending the announcement. `z.uuid()` accepts both cases and normalizes
 * neither, so the wire value is canonicalized here, once, at the boundary.
 */
const AudienceOrgId = Uuid.transform((v) => v.toLowerCase());

export const AnnouncementAudience = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('all') }),
  z.strictObject({ type: z.literal('plan'), plan_codes: z.array(PlanTier).min(1).max(4) }),
  z.strictObject({ type: z.literal('organizations'), organization_ids: z.array(AudienceOrgId).min(1).max(200) }),
]);

/**
 * What a TENANT USER is told. No organization id, no plan, no audience — a
 * defect in the matcher can leak a platform-authored message; it cannot leak
 * who else is a customer, what they pay, or how many there are.
 */
export const Announcement = z.object({
  id: Uuid,
  severity: AnnouncementSeverity,
  title_en: z.string(),
  title_fr: z.string(),
  body_en: z.string(),
  body_fr: z.string(),
  dismissible: z.boolean(),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime.nullable(),
  /** §8's status-page link, typed by the publisher; the banner is the anchor. */
  status_incident_url: z.string().nullable(),
});
export const ActiveAnnouncements = z.object({ items: z.array(Announcement) });

export const AdminAnnouncement = Announcement.extend({
  audience: AnnouncementAudience,
  published_by_email: z.string(),
  published_at: IsoDateTime,
  /** A COUNT of real notifications rows, never a stored column that can drift. */
  recipients_notified: z.number().int(),
});
export const AdminAnnouncementList = paginated(AdminAnnouncement);

/** No `active` filter: `admin_list_announcements` takes no such argument. */
export const AnnouncementListQuery = CursorQuery.extend({
  severity: AnnouncementSeverity.optional(),
});

const announcementText = (max: number) => z.string().trim().max(max);

export const PublishAnnouncementInput = z
  .strictObject({
    severity: AnnouncementSeverity,
    title_en: announcementText(120),
    title_fr: announcementText(120),
    body_en: announcementText(2000),
    body_fr: announcementText(2000),
    audience: AnnouncementAudience,
    starts_at: IsoDateTime.optional(),
    ends_at: IsoDateTime.nullable().optional(),
    status_incident_url: z.string().trim().url().max(512).optional(),
    // `dismissible` is deliberately not an input: it is derived from severity
    // by the definer and tied by a CHECK, so strictObject refuses it for free.
  })
  .superRefine((v, ctx) => {
    // §8 / Bill 96: both languages, and the form marks EVERY empty one in one
    // round trip (that is what ApiError.detailPaths was built for in F-70).
    for (const f of ['title_en', 'title_fr', 'body_en', 'body_fr'] as const) {
      if (v[f].length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: [f],
          message: 'both languages are required',
          ...withKey('missing_translation'),
        });
      }
    }
    if (v.status_incident_url !== undefined && !v.status_incident_url.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['status_incident_url'],
        message: 'the status-page link must be https',
        // Its own key: the link is present and wrong, not absent.
        ...withKey('status_incident_scheme'),
      });
    }
    // The DB CHECK is the guarantee; this is the message. Without it a
    // biconditional violation surfaces as 23514, which platformErrorFrom
    // renders as "Reason required" on path `reason`.
    if (v.severity === 'incident' && !v.status_incident_url) {
      ctx.addIssue({
        code: 'custom',
        path: ['status_incident_url'],
        message: 'an incident must link its status-page incident',
        ...withKey('status_incident_required'),
      });
    }
    if (v.severity !== 'incident' && v.status_incident_url) {
      ctx.addIssue({
        code: 'custom',
        path: ['status_incident_url'],
        message: 'only an incident links a status-page incident',
        ...withKey('status_incident_forbidden'),
      });
    }
    // Against the EFFECTIVE start, because `starts_at` is optional and the
    // definer substitutes `COALESCE(p_starts_at, now())`. Requiring both ends
    // left the CHECK to answer a blank "Starts" with a past "Ends" — 23514,
    // which platformErrorFrom renders as "Reason required" on path `reason`,
    // a field the compose form does not have. Compared as instants: the form
    // may send a local offset, and two equal instants can differ lexically.
    if (v.ends_at != null) {
      const start = v.starts_at != null ? Date.parse(v.starts_at) : Date.now();
      if (Date.parse(v.ends_at) <= start) {
        ctx.addIssue({
          code: 'custom',
          path: ['ends_at'],
          message: 'the window must end after it starts',
          ...withKey('invalid_window'),
        });
      }
    }
  });

/**
 * F-72 §12 — the platform audit vocabulary, lockstep-tested against the
 * `platform_audit_events_event_check` CHECK by platform-drift.test.ts.
 */
export const PLATFORM_AUDIT_EVENTS = [
  'staff.granted',
  'staff.role_changed',
  'staff.reinstated',
  'staff.revoked',
  'announcement.published',
  'announcement.ended',
  'settings.flipped',
  /**
   * F-73 §9. `requested`, not `retried`: the row is filed BEFORE Redis is
   * touched, because Redis and Postgres cannot commit together and an
   * unaudited retry is the failure §9's "actions audited" forbids. What the
   * register can honestly record at that moment is the request — the queue,
   * the ids asked for, the organizations they name, and the reason.
   */
  'queue.retry_requested',
] as const;

export type PlatformSettingT = z.infer<typeof PlatformSetting>;
export type PlatformSettingListT = z.infer<typeof PlatformSettingList>;
export type SetPlatformSettingInputT = z.infer<typeof SetPlatformSettingInput>;
export type AnnouncementAudienceT = z.infer<typeof AnnouncementAudience>;
export type AnnouncementT = z.infer<typeof Announcement>;
export type ActiveAnnouncementsT = z.infer<typeof ActiveAnnouncements>;
export type AdminAnnouncementT = z.infer<typeof AdminAnnouncement>;
export type AnnouncementListQueryT = z.infer<typeof AnnouncementListQuery>;
export type PublishAnnouncementInputT = z.infer<typeof PublishAnnouncementInput>;

/* ------------------------------------------------------------------------ *
 * F-73 §6 — per-tenant usage, and §9's job inspector
 * ------------------------------------------------------------------------ */

/**
 * The window a usage number is FOR.
 *
 * Every response repeats `window_start`/`window_end` beside the figures, so a
 * number is never read without the period it belongs to. `mtd` is the month to
 * date in America/Montreal — the platform's operating month, and the only
 * period a MONTHLY plan allowance can honestly be compared against.
 */
export const USAGE_PERIODS = ['mtd', '30d', '90d'] as const;
export const UsagePeriod = z.enum(USAGE_PERIODS);
export type UsagePeriodT = z.infer<typeof UsagePeriod>;
export const AdminUsageQuery = z.object({ period: UsagePeriod.default('mtd') });

/**
 * §6, as shipped: the numbers a real row can answer, counted inside the window.
 *
 * Seven of §6's names are absent, each by decision rather than by oversight —
 * `dau`, `wau`, `mau` (the Better Auth `"session"` table is hard-deleted on
 * sign-out and by four platform definers, so any retroactive figure is
 * arithmetic on deleted rows), `ai_voice_minutes` (nothing dials, nothing
 * answers, no call has a duration anywhere in this repo), `api_calls_mtd` and
 * `rate_limit_429s` (the limiter stores a token LEVEL under a PEXPIREd key,
 * never a count, and fails open), and `intake_ack_p99_ms` (nothing times the
 * intake ACK). Each carries its un-cut condition in D-074.
 *
 * `members_who_acted` is what stands in for dau/wau/mau, and it is named for
 * what it measures rather than for what §6 wished it were: `activity_events`
 * is a MUTATION log, so a manager who reads the kanban all day writes no row.
 * The number is a FLOOR on active people, never a DAU, and both captions say so.
 *
 * apps/api/src/usage-metric-drift.test.ts is this list's lockstep: it proves
 * every metric names a column that exists AND that `admin_tenant_usage` really
 * reads it, so a metric cannot quietly become a word the definer stopped
 * computing.
 */
export const USAGE_WINDOW_METRICS = [
  'members_who_acted',
  'leads_created',
  'deals_created',
  'deals_delivered',
  'ai_conversations_engaged',
  'sms_segments',
  'sms_messages_unsegmented',
  'ai_first_touch_p95_seconds',
  'ai_first_touch_sample_count',
] as const;

/**
 * Standing totals, not window counts — they answer "how big is this tenant",
 * which has no period.
 *
 * `member_count` and `store_count` are the EXISTING vocabulary, computed by the
 * same SQL `admin_get_tenant` already uses (0066:114-115), so the usage card
 * and the tenant detail page cannot print two different numbers for one fact.
 * `seats_provisioned` is the genuinely new one: `memberships` is UNIQUE on
 * (user_id, organization_id, store_id) and the members route writes ONE ROW PER
 * STORE, so a GM at three rooftops is three membership rows and one seat.
 */
export const USAGE_GAUGES = ['seats_provisioned', 'member_count', 'store_count', 'document_bytes'] as const;
export type UsageMetricT = (typeof USAGE_WINDOW_METRICS)[number] | (typeof USAGE_GAUGES)[number];

/**
 * What the tenant BOUGHT — three of the plan's five `included_*` columns.
 *
 * `included_ai_minutes` has no numerator anywhere (there is no voice) and
 * `included_storage_gb`'s only numerator counts documents alone, so a bar
 * against either would divide a real number by an imaginary one. Both stay
 * dead, by name, in usage-metric-drift.test.ts's DEAD_PLAN_ALLOWANCES with
 * their un-cut conditions. `plans.overage` and `plans.features` are not on the
 * wire at all: Core is seeded 'hard_stop' and nothing stops.
 */
export const AdminUsageAllowances = z.object({
  /** NULL = unlimited (0065:49 permits NULL and refuses 0). Never a zero bar. */
  included_seats: z.number().int().positive().nullable(),
  /** 0 is legal (0065:51-52) and means "none included" — then no ratio at all. */
  included_sms_segments: z.number().int().nonnegative(),
  included_ai_conversations: z.number().int().nonnegative(),
});

export const AdminTenantUsage = z.object({
  organization_id: Uuid,
  plan_code: PlanTier,
  period: UsagePeriod,
  window_start: IsoDateTime,
  window_end: IsoDateTime,
  gauges: z.object({
    seats_provisioned: z.number().int().nonnegative(),
    member_count: z.number().int().nonnegative(),
    store_count: z.number().int().nonnegative(),
    document_bytes: z.number().int().nonnegative(),
  }),
  window_metrics: z.object({
    members_who_acted: z.number().int().nonnegative(),
    leads_created: z.number().int().nonnegative(),
    deals_created: z.number().int().nonnegative(),
    deals_delivered: z.number().int().nonnegative(),
    ai_conversations_engaged: z.number().int().nonnegative(),
    sms_segments: z.number().int().nonnegative(),
    sms_messages_unsegmented: z.number().int().nonnegative(),
    /** null when nothing was measured — a p95 over an empty sample is not 0. */
    ai_first_touch_p95_seconds: z.number().int().nonnegative().nullable(),
    ai_first_touch_sample_count: z.number().int().nonnegative(),
  }),
  /**
   * null unless `period === 'mtd'`. A monthly allowance beside a 90-day count
   * is a lie no caption repairs, so the API refuses to hand the client the two
   * numbers with which to make it, rather than trusting the client not to.
   */
  allowances: AdminUsageAllowances.nullable(),
});

/**
 * Whether the console could ASK the queue — kept apart from the answer.
 *
 * "we could not reach Redis" and "nothing has failed" are different facts, and
 * an operator staring at a stuck queue has to be able to tell them apart, so
 * the counts are null under anything but `ok` rather than zero.
 *
 * Spelled `queue_state` and not `status` on purpose: enum-vocabulary.test.ts
 * binds a Zod enum to every CHECKed column of the same field NAME, and `status`
 * is such a column on stores, memberships, leads, deals and conversations.
 */
export const QueueState = z.enum(['ok', 'not_configured', 'unreachable']);
export type QueueStateT = z.infer<typeof QueueState>;

/**
 * What one requested retry did — five outcomes, and deliberately no `locked`.
 *
 * BullMQ's `job.retry('failed')` runs `reprocessJob-8.lua`, whose own header
 * documents its complete return set as 1 / -1 / -3 and whose body contains no
 * lock check at all; `finishedErrors` then copies that number onto `err.code`,
 * so only -1 (the job's hash is gone) and -3 (it is not in the failed set) can
 * ever arrive. A job a worker is holding sits in `active`, so the ZREM finds
 * nothing and the script returns -3 → `not_failed`, inside a 200. A `locked`
 * value would be a state with no producer — the dead-vocabulary bug, minted in
 * the very enum that describes a safety control.
 *
 * `not_attempted` is normal rather than an error: twenty ids under one total
 * wall-clock budget are expected to run out, and the audit row was already
 * filed with the full requested list, so an id nobody reached is answerable.
 *
 * `error` is the one value that does not say what happened, and it says so on
 * purpose. Because the script's only results are 1 / -1 / -3, a rejection that
 * is neither -1 nor -3 carried no result at all: ioredis either refused the
 * command before writing it (the retry certainly did not run) or lost the
 * socket with the EVALSHA already sent (it may well have). Nothing in the
 * error object separates those two — only ioredis's English message does, and
 * matching English is what the numeric mapping exists to avoid — so `error`
 * means UNKNOWN, and on an `at_least_once` queue it must be read as "the job
 * may already be back on the queue". Reading it that way is safe, which is why
 * one value carries both cases: asking again cannot compound it, because a job
 * that WAS requeued has left the failed set and answers `not_failed`, and one
 * a worker has since finished answers `gone`. The cost is the operator's
 * certainty, so the console owes them the sentence: `jobs.outcome_error` and
 * `jobs.outcomesHelp` in `packages/i18n`, in both locales.
 */
export const RetryOutcome = z.enum(['retried', 'gone', 'not_failed', 'not_attempted', 'error']);
export type RetryOutcomeT = z.infer<typeof RetryOutcome>;

/**
 * The ceiling on one retry request. Twenty is a repair a person can read back
 * and a blast radius they can own; `Queue.retryJobs()` — which takes no id list
 * and no filter, and would requeue every tenant's failures at once — is never
 * called.
 */
export const RETRY_MAX_JOBS = 20;

export const RetryJobsInput = z.strictObject({
  /** BullMQ ids are strings, and not all are numeric (`lead:{uuid}:first-touch`). */
  job_ids: z.array(z.string().trim().min(1).max(200)).min(1).max(RETRY_MAX_JOBS),
  reason: z.string().trim().min(10).max(500),
  /**
   * Typed back, exactly, before ANY retry on an `at_least_once` queue — the
   * F-72 `confirm_setting_key` pattern pointed at the duplicating direction.
   * Optional here and required by the ROUTE, because whether it is needed
   * depends on the queue in the path, which this schema cannot see.
   */
  confirm_queue_name: z.string().trim().optional(),
});

/**
 * F-73 §9 — the tenant snapshot: everything the console already shows about a
 * tenant, plus the operational facts a support person needs on one screen.
 *
 * It EXTENDS `AdminTenantDetail` rather than restating it. Two screens that
 * assemble the same tenant independently are two screens that will one day
 * disagree, and the one a support person is reading during an incident is the
 * one that must not be the stale one.
 */
export const SnapshotTraffic = z.object({
  inbound: z.number().int().nonnegative(),
  outbound: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  last_message_at: IsoDateTime.nullable(),
});

export const SnapshotStoreHealth = z.object({
  id: Uuid,
  name: z.string(),
  code: z.string(),
  status: z.string(),
  timezone: z.string(),
  /** The dealer's own carrier number, not a boolean — support checks it against the console. */
  sms_number: z.string().nullable(),
  business_hours_set: z.boolean(),
  traffic_30d: SnapshotTraffic,
});

/** Never `token`, never `secret`: the definer does not project them and neither does this. */
export const SnapshotIntakeKey = z.object({
  id: Uuid,
  store_id: Uuid.nullable(),
  label: z.string(),
  provider: z.string(),
  active: z.boolean(),
  revoked_at: IsoDateTime.nullable(),
  /** `intake_keys.last_used_at`, named for the only thing that moves it. */
  last_lead_accepted_at: IsoDateTime.nullable(),
});

export const SnapshotCommsConfig = z.object({
  org_row_present: z.boolean(),
  store_overrides: z.number().int().nonnegative(),
  sms_quiet_start: z.string().nullable(),
  sms_quiet_end: z.string().nullable(),
  first_touch_quiet_exempt: z.boolean().nullable(),
  ai_daily_contact_cap: z.number().int().nullable(),
});

export const AdminTenantSnapshot = AdminTenantDetail.extend({
  seats_provisioned: z.number().int().nonnegative(),
  store_health: z.array(SnapshotStoreHealth),
  intake_keys: z.array(SnapshotIntakeKey),
  comms_config: SnapshotCommsConfig,
  branding: z.object({
    state: z.string(),
    version: z.number().int().nullable(),
    published_at: IsoDateTime.nullable(),
  }),
  connectors_active: z.number().int().nonnegative(),
  /**
   * Deployment configuration, identical for every tenant — grouped rather than
   * left loose beside tenant fields so a reader cannot mistake it for a
   * per-tenant switch that does not exist.
   */
  platform: z.object({
    sms_transport: z.string(),
    email_transport: z.string(),
    ai_transport: z.string(),
  }),
});

/* ---- F-73 §9 — the job inspector -------------------------------------- */

/**
 * The queue names, declared HERE rather than in `packages/contracts`, because
 * F-73 puts them on the wire: one is a path segment (`/admin/queues/:name/dlq`)
 * and one is a response field, so they are API vocabulary before they are
 * worker plumbing. `packages/contracts` imports this list and its `JOB_QUEUES`
 * catalogue is keyed off it, so there is one list and `queue-catalogue.test.ts`
 * asserts the catalogue covers it exactly — schemas cannot import contracts
 * (contracts already depends on schemas), so declaring it the other way round
 * would be two lists with nothing between them.
 */
export const QUEUE_NAMES = [
  'deferred-send',
  'assistant-turn',
  'lead-reassign',
  'ai-extraction',
  'first-touch',
  'drip-tick',
  'live-analysis',
  'qa-review',
  'task-sweep',
  'announcement-fanout',
] as const;
export const QueueName = z.enum(QUEUE_NAMES);
export type QueueNameT = z.infer<typeof QueueName>;


export const AdminQueueDepth = z.object({
  name: QueueName,
  /** Derived from the payload shape, so this is a fact about the queue, not a second declaration. */
  org_scoped: z.boolean(),
  queue_state: QueueState,
  /** null under anything but `ok`: a zero would read as "nothing failed". */
  counts: z.record(z.string(), z.number().int().nonnegative()).nullable(),
});
export const AdminQueueDepthList = z.object({ items: z.array(AdminQueueDepth) });

export const AdminDlqQuery = CursorQuery.extend({
  /** Refused with 422 `queue_not_org_scoped` when the queue's payload has no organization_id. */
  organization_id: Uuid.optional(),
});

/**
 * One failed job, projected through the queue's own `dlq_fields` allow-list.
 *
 * `fields` is a scalar map and never the raw payload: a `deferred-send` job
 * carries the customer's message `body`, and a platform staffer browsing a
 * dead-letter queue has no business reading it.
 *
 * It carries no `job_name`, `attempts_made` or `enqueued_at`: all three shipped
 * on the wire with no reader on any screen, and `job_name` was a second copy of
 * the path segment the caller just addressed — every producer in the repo
 * passes the queue-name constant as the job name — which is the duplication
 * `AdminRetryResult` below refuses by name. An attempt count would genuinely
 * help the requeue decision and can come back, together with the column that
 * renders it.
 */
export const AdminDlqItem = z.object({
  job_id: z.string(),
  failed_at: IsoDateTime.nullable(),
  /** Redacted and truncated before it leaves the inspector. */
  failed_reason: z.string().nullable(),
  first_stack_line: z.string().nullable(),
  /**
   * An ORDERED array, not a map: the order is the queue's own `dlq_fields`
   * allow-list, which puts the identifying field first, and a JSON object
   * gives a client no ordering guarantee. Values are stringified and truncated
   * by the route.
   */
  fields: z.array(z.object({ key: z.string(), value: z.string() })),
});

export const AdminDlqPage = z.object({
  queue: QueueName,
  queue_state: QueueState,
  org_scoped: z.boolean(),
  /**
   * Not `keyset`: the failed set is a zset with no stable key a client can
   * carry, so the cursor is a POSITION and the page is honestly "the first N
   * matches within the scan ceiling".
   */
  paging_basis: z.literal('position'),
  /** Ids the scan actually walked — what makes `next_cursor` truthful. */
  scanned: z.number().int().nonnegative(),
  items: z.array(AdminDlqItem),
  next_cursor: z.string().nullable(),
});

/**
 * What one retry request DID, id by id — a 200 whatever Redis was doing.
 *
 * There is no partial-success status code to reach for and none is invented:
 * twenty ids can land on five different outcomes in one request, so the
 * per-id answer IS the response and `queue_state` says whether the queue could
 * be asked at all. `not_configured` comes back with an EMPTY outcome list
 * because nothing was attempted and no register row was filed; every other
 * state carries one entry per requested id, in the order they were asked for.
 *
 * The queue is not repeated here — it is the path segment the caller just
 * addressed, and a second copy is a second thing that can disagree.
 */
export const AdminRetryResult = z.object({
  queue_state: QueueState,
  outcomes: z.array(z.object({ job_id: z.string(), retry_outcome: RetryOutcome })),
});

export type AdminUsageAllowancesT = z.infer<typeof AdminUsageAllowances>;
export type AdminTenantUsageT = z.infer<typeof AdminTenantUsage>;
export type AdminUsageQueryT = z.infer<typeof AdminUsageQuery>;
export type RetryJobsInputT = z.infer<typeof RetryJobsInput>;
export type AdminTenantSnapshotT = z.infer<typeof AdminTenantSnapshot>;
export type SnapshotStoreHealthT = z.infer<typeof SnapshotStoreHealth>;
export type SnapshotIntakeKeyT = z.infer<typeof SnapshotIntakeKey>;
export type SnapshotCommsConfigT = z.infer<typeof SnapshotCommsConfig>;
export type AdminQueueDepthT = z.infer<typeof AdminQueueDepth>;
export type AdminQueueDepthListT = z.infer<typeof AdminQueueDepthList>;
export type AdminDlqQueryT = z.infer<typeof AdminDlqQuery>;
export type AdminDlqItemT = z.infer<typeof AdminDlqItem>;
export type AdminDlqPageT = z.infer<typeof AdminDlqPage>;
export type AdminRetryResultT = z.infer<typeof AdminRetryResult>;
