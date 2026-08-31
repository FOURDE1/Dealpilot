import type { PlatformCapabilityT } from '@dealpilot/schemas';

/**
 * F-74 — the console nav as data, extracted from AdminLayout so the
 * capability→item mapping is testable across ALL THREE platform roles.
 * Pure, following the access.ts precedent ("Pure, so the guard component
 * stays a switch and this stays unit-testable"): a browser run can mint at
 * most two staffers — the bootstrap one-shot plus one console grant — so
 * platform_support's subset is provable only in nav.test.ts, while the e2e
 * journey (f74-console-door.e2e.ts) proves the component actually renders
 * this function's answer.
 *
 * Order matters: the journey's toHaveText([...]) assertion checks count AND
 * order against exactly this sequence.
 */
export interface AdminNavItem {
  to: string;
  /** Key in the `admin` i18n namespace — the layout translates. */
  labelKey: 'navTenants' | 'navSupport' | 'navAnnouncements' | 'navSwitches' | 'navQueues' | 'navStaff';
}

export function adminNavItems(capabilities: readonly PlatformCapabilityT[]): AdminNavItem[] {
  return [
    // Every platform role holds tenants:read — the directory is the floor.
    { to: '/admin/tenants', labelKey: 'navTenants' as const },
    ...(capabilities.includes('impersonation:manage') ? [{ to: '/admin/support-sessions', labelKey: 'navSupport' as const }] : []),
    ...(capabilities.includes('announcements:read') ? [{ to: '/admin/announcements', labelKey: 'navAnnouncements' as const }] : []),
    ...(capabilities.includes('settings:read') ? [{ to: '/admin/platform-settings', labelKey: 'navSwitches' as const }] : []),
    ...(capabilities.includes('queues:read') ? [{ to: '/admin/queues', labelKey: 'navQueues' as const }] : []),
    ...(capabilities.includes('staff:manage') ? [{ to: '/admin/staff', labelKey: 'navStaff' as const }] : []),
  ];
}
