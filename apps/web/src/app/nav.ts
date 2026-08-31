/**
 * The tenant shell's navigation, as data — a LEAF module so nav.test.ts can
 * pin the mobile partition without importing the shell (layout.tsx reaches
 * `document` at module load through the language switcher).
 *
 * `/pipeline` returns with its feature slice — a dead route belongs in no nav.
 * The bottom tab bar (layout.tsx) is a fixed `grid-cols-6` fed by every item
 * WITHOUT `mobileHidden`; nav.test.ts pins that set (F-76, A10).
 */
export const NAV_ITEMS = [
  { to: '/', key: 'nav:dashboard', shortKey: 'nav:shortDashboard', end: true },
  { to: '/organizations', key: 'nav:organizations', shortKey: 'nav:shortOrganizations' },
  { to: '/leads', key: 'nav:prospects', shortKey: 'nav:shortProspects' },
  { to: '/contacts', key: 'nav:contacts', shortKey: 'nav:shortContacts', mobileHidden: true },
  { to: '/appointments', key: 'nav:appointments', shortKey: 'nav:shortAppointments', mobileHidden: true },
  { to: '/tasks', key: 'nav:tasks', shortKey: 'nav:shortTasks', mobileHidden: true },
  { to: '/conversations', key: 'nav:conversations', shortKey: 'nav:shortConversations' },
  { to: '/pipeline', key: 'nav:pipeline', shortKey: 'nav:shortPipeline' },
  { to: '/inventory', key: 'nav:inventory', shortKey: 'nav:shortInventory' },
  { to: '/commissions', key: 'nav:commissions', shortKey: 'nav:shortCommissions', mobileHidden: true },
  { to: '/dispatch', key: 'nav:dispatch', shortKey: 'nav:shortDispatch', mobileHidden: true },
  { to: '/analytics/win-loss', key: 'nav:reports', shortKey: 'nav:shortReports', mobileHidden: true },
  { to: '/team', key: 'nav:team', shortKey: 'nav:shortTeam' },
  // F-76: desktop-only — the phone reaches /settings from the organization
  // page's « Réglages » link (organization-detail-page.tsx).
  { to: '/settings', key: 'nav:settings', shortKey: 'nav:shortSettings', mobileHidden: true },
] as const;
