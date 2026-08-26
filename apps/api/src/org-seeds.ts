import { DEFAULT_ROLE_PERMISSIONS } from '@dealpilot/schemas';
import { LOST_REASON_DEFAULTS } from '@dealpilot/core';
import { CHECKLIST_CANONICAL } from './checklist.js';

/**
 * F-70 — what a provisioned tenant is born with (admin-console.md §4.3
 * "seed defaults"), as the jsonb payload `admin_provision_tenant()` (0066)
 * inserts from. Built from the SAME constants the self-serve birth uses
 * (`seedPermissions`, f01 `seedLostReasons`, checklist `ensureTemplate`), so
 * SQL never carries a second copy of any catalogue (the 0055 frozen-copy
 * lesson); f70-provisioning.test.ts proves an F-70 tenant equals an F-01
 * organization + store row for row.
 *
 * Pure and constant: nothing here comes from a request body.
 */
export interface ProvisioningSeeds {
  role_permissions: { role: string; permission: string }[];
  lost_reasons: { name: string; name_fr: string; icon: string }[];
  checklist: { code: string; label_fr: string; label_en: string; overridable: boolean; sort_order: number }[];
}

export function provisioningSeeds(): ProvisioningSeeds {
  return {
    role_permissions: Object.entries(DEFAULT_ROLE_PERMISSIONS).flatMap(([role, perms]) =>
      perms.map((permission) => ({ role, permission })),
    ),
    lost_reasons: LOST_REASON_DEFAULTS.map(({ name, name_fr, icon }) => ({ name, name_fr, icon })),
    checklist: CHECKLIST_CANONICAL.map(({ code, label_fr, label_en, overridable, sort_order }) => ({
      code, label_fr, label_en, overridable, sort_order,
    })),
  };
}
