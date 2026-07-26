import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';
import { Role, ROLES } from './roles.js';

/**
 * A-13 / D-033 — the permission catalogue.
 *
 * The owner asked for "RBAC controlling roles, and for each role what it can do
 * of actions". Before this, every route carried its own small list of roles
 * (`STORE_WRITE_ROLES`, `DISPATCH_ROLES`, …) across some thirty call sites, so
 * the real answer to "what can a BDC agent do?" existed only as a pattern in
 * the code. Nobody could read it, and no screen could show it.
 *
 * Every action in the system is named here exactly once. Routes ask this
 * catalogue; they do not carry role lists. `permission-drift.test.ts` fails if
 * one starts to.
 */
export const PERMISSIONS = [
  // --- organizations & stores -------------------------------------------
  'organization:update',
  'organization:delete',
  'store:create',
  'store:update',
  'store:delete',
  'store:configure_checklist',

  // --- team ---------------------------------------------------------------
  'member:read',
  'member:invite',
  'member:update_roles',
  'member:revoke',

  // --- leads --------------------------------------------------------------
  'lead:create',
  'lead:update',
  'lead:assign',
  'lead:delete',
  /** Intake webhook credentials — a standing key to the front door. */
  'intake_key:manage',

  // --- inventory ----------------------------------------------------------
  'vehicle:create',
  'vehicle:update',
  'vehicle:delete',

  // --- deals & desking ----------------------------------------------------
  'deal:create',
  'deal:update',
  'deal:change_stage',
  /** Recording that the money arrived. Separate from moving the car. */
  'deal:change_funding',
  'checklist:complete',
  /** Waiving a soft item, always with a reason. */
  'checklist:waive',
  /** Signing off the legally required inspection (D-033 asked this first). */
  'checklist:sign_safety',
  /** Correcting a DELIVERED deal's checklist — costs a reason (D-034). */
  'checklist:correct_delivered',

  // --- money --------------------------------------------------------------
  'pay_plan:read',
  'pay_plan:write',
  /** Everyone reads their OWN commission; this is reading everybody's. */
  'commission:read_all',

  // --- dispatch -----------------------------------------------------------
  'dispatch:read',
  'dispatch:book',
  'dispatch:update',
  'fleet:manage',

  // --- audit --------------------------------------------------------------
  'activity:read',
] as const;

export const Permission = z.enum(PERMISSIONS);
export type PermissionT = (typeof PERMISSIONS)[number];

/**
 * The defaults a new organization starts with. Deliberately conservative: it is
 * far easier for an owner to grant something on the settings screen than to
 * discover months later that a role could see payroll.
 *
 * Read this as the answer to "what can each role do?" — which is exactly what
 * the owner could not get before.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly PermissionT[]> = {
  owner: [...PERMISSIONS],

  gm: PERMISSIONS.filter((p) => p !== 'organization:delete'),

  sales_manager: [
    'member:read',
    'lead:create', 'lead:update', 'lead:assign', 'lead:delete',
    'vehicle:create', 'vehicle:update',
    'deal:create', 'deal:update', 'deal:change_stage',
    'checklist:complete', 'checklist:waive',
    'dispatch:read', 'dispatch:book',
    'activity:read',
  ],

  used_car_manager: [
    'member:read',
    'vehicle:create', 'vehicle:update', 'vehicle:delete',
    'deal:update',
    'checklist:complete',
    'dispatch:read',
    'activity:read',
  ],

  fi_manager: [
    'member:read',
    'deal:update', 'deal:change_funding',
    'checklist:complete', 'checklist:waive',
    // The F&I office is who chases funding, so they see the whole pay picture.
    'pay_plan:read', 'commission:read_all',
    'activity:read',
  ],

  salesperson: [
    'member:read',
    'lead:create', 'lead:update',
    'deal:create', 'deal:update', 'deal:change_stage',
    'checklist:complete',
    'activity:read',
  ],

  wholesale_manager: [
    'member:read',
    'vehicle:create', 'vehicle:update', 'vehicle:delete',
    'activity:read',
  ],

  logistics: [
    'member:read',
    'dispatch:read', 'dispatch:book', 'dispatch:update', 'fleet:manage',
    'checklist:complete',
    'activity:read',
  ],

  admin_office: [
    'member:read', 'member:invite', 'member:update_roles', 'member:revoke',
    'lead:update',
    'deal:update',
    'checklist:complete',
    'activity:read',
  ],

  bdc_agent: [
    'member:read',
    'lead:create', 'lead:update', 'lead:assign',
    'activity:read',
  ],
};

/** A row of the editable matrix. */
export const RolePermission = z.object({
  organization_id: Uuid,
  role: Role,
  permission: Permission,
  allowed: z.boolean(),
  updated_at: IsoDateTime,
});

/**
 * "Marc can also do X" — every dealership has these. An override is per person
 * and can DENY as well as grant, because taking one thing away from someone is
 * otherwise only possible by changing their whole role.
 */
export const UserPermission = z.object({
  organization_id: Uuid,
  user_id: Uuid,
  permission: Permission,
  allowed: z.boolean(),
  reason: z.string().nullable(),
  updated_at: IsoDateTime,
});

export const UpdateRolePermissionsInput = z.strictObject({
  organization_id: Uuid,
  role: Role,
  /** The complete set for this role. Absent permissions are revoked. */
  permissions: z.array(Permission),
});

export const UpdateUserPermissionInput = z.strictObject({
  organization_id: Uuid,
  user_id: Uuid,
  permission: Permission,
  /** null clears the override and returns the person to their role's default. */
  allowed: z.boolean().nullable(),
  reason: z.string().trim().min(3).max(300).optional(),
});

/** What the settings screen renders: the whole matrix in one call. */
export const PermissionMatrix = z.object({
  permissions: z.array(Permission),
  roles: z.array(Role),
  /** role → the permissions it currently holds. */
  matrix: z.record(z.string(), z.array(Permission)),
});

export { ROLES };
export type RolePermissionT = z.infer<typeof RolePermission>;
export type PermissionMatrixT = z.infer<typeof PermissionMatrix>;
