import { z } from 'zod';

/**
 * The 10 platform roles — one vocabulary, defined once (ADR-001/016;
 * authentication-authorization.md §RBAC). Additive multi-role memberships;
 * scope comes from the membership row, never from the client.
 */
export const ROLES = [
  'owner',
  'gm',
  'sales_manager',
  'used_car_manager',
  'fi_manager',
  'salesperson',
  'wholesale_manager',
  'logistics',
  'admin_office',
  'bdc_agent',
] as const;

export const Role = z.enum(ROLES);
export type RoleT = z.infer<typeof Role>;

/** Roles that hold Restricted-data or org-wide power → MFA required (§9). */
export const MFA_REQUIRED_ROLES: readonly RoleT[] = [
  'owner',
  'gm',
  'fi_manager',
  'admin_office',
];
