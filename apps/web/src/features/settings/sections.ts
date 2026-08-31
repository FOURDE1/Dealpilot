import type { PermissionT } from '@dealpilot/schemas';
import { can } from '../../shared/permissions.js';

/**
 * F-76 (R4, R9, A9, A10) — what the /settings index links to.
 *
 * Two rules, both enforced by sections.test.ts:
 *
 * 1. Every `to` is a route that exists under the `/` shell (the test parses
 *    router.tsx). A link to nothing is a claim.
 * 2. A link is hidden ONLY when its target page hides itself today. Only the
 *    branding editor does (organization-detail-page.tsx:18 offers it to
 *    `organization:update` holders alone). Scoring, assignment, lost reasons,
 *    connectors, schedules, permissions and security render for every member
 *    and gate their WRITE controls — permissions-page.tsx:53 uses `can` for
 *    `canEdit` only; lost-reasons-page.tsx:33 for the write controls — so
 *    their links are unconditional here too. Stores and Automations are
 *    listed for every member: both GETs are member-readable; the forms go
 *    read-only without `store:update` / `organization:update`.
 *
 * Labels for existing pages REUSE the target page's own title key, so a
 * renamed page renames its link; only the two new sections have labels of
 * their own (`settings.sec_*`). `descKey` is a `settings.desc_*` fact about
 * the target.
 */

export type SectionId =
  | 'stores'
  | 'automations'
  | 'branding'
  | 'scoring'
  | 'assignment'
  | 'lost_reasons'
  | 'connectors'
  | 'schedules'
  | 'permissions'
  | 'security';

export type SectionLabelKey =
  | 'settings:sec_stores'
  | 'settings:sec_automations'
  | 'orgs:brandingLink'
  | 'scoring:title'
  | 'assignment:title'
  | 'leads:lr_title'
  | 'connectors:title'
  | 'schedules:title'
  | 'permissions:title'
  | 'security:title';

export interface SettingsSection {
  readonly id: SectionId;
  /** A route pattern under the `/` shell; `:orgId` is the only parameter. */
  readonly to: string;
  readonly labelKey: SectionLabelKey;
  readonly descKey: `desc_${SectionId}`;
  /** Present ONLY when the target page hides itself on this permission. */
  readonly requires?: PermissionT;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'stores', to: '/settings/stores', labelKey: 'settings:sec_stores', descKey: 'desc_stores' },
  { id: 'automations', to: '/settings/automations', labelKey: 'settings:sec_automations', descKey: 'desc_automations' },
  {
    id: 'branding',
    to: '/organizations/:orgId/branding',
    labelKey: 'orgs:brandingLink',
    descKey: 'desc_branding',
    requires: 'organization:update',
  },
  { id: 'scoring', to: '/leads/scoring', labelKey: 'scoring:title', descKey: 'desc_scoring' },
  { id: 'assignment', to: '/leads/assignment', labelKey: 'assignment:title', descKey: 'desc_assignment' },
  { id: 'lost_reasons', to: '/leads/lost-reasons', labelKey: 'leads:lr_title', descKey: 'desc_lost_reasons' },
  { id: 'connectors', to: '/leads/connectors', labelKey: 'connectors:title', descKey: 'desc_connectors' },
  { id: 'schedules', to: '/team/schedules', labelKey: 'schedules:title', descKey: 'desc_schedules' },
  { id: 'permissions', to: '/team/permissions', labelKey: 'permissions:title', descKey: 'desc_permissions' },
  { id: 'security', to: '/security', labelKey: 'security:title', descKey: 'desc_security' },
];

/** The href for one section; a section needing `:orgId` without one has no href. */
export function sectionHref(section: SettingsSection, orgId: string | undefined): string | null {
  if (!section.to.includes(':orgId')) return section.to;
  if (!orgId) return null;
  return section.to.replace(':orgId', encodeURIComponent(orgId));
}

/**
 * The sections to render, in order. A section is dropped when its target
 * would hide itself (`requires` not held) or when it needs an organization
 * and none is selected (no organization yet, or still loading).
 */
export function visibleSections(mine: Set<PermissionT> | undefined, orgId: string | undefined): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => {
    if (section.requires && !can(mine, section.requires)) return false;
    return sectionHref(section, orgId) !== null;
  });
}
