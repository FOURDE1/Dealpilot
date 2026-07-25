import { NavLink, Outlet, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@dealpilot/ui';
import { signOut, useSession } from '../shared/auth/client.js';
import { queryClient } from '../shared/api/queryClient.js';
import { LanguageSwitcher } from '../shared/i18n/language-switcher.js';

// `/pipeline` returns with its feature slice — a dead route belongs in no nav.
const NAV_ITEMS = [
  { to: '/', key: 'nav:dashboard', shortKey: 'nav:shortDashboard', end: true },
  { to: '/organizations', key: 'nav:organizations', shortKey: 'nav:shortOrganizations' },
  { to: '/leads', key: 'nav:prospects', shortKey: 'nav:shortProspects' },
  { to: '/pipeline', key: 'nav:pipeline', shortKey: 'nav:shortPipeline' },
  { to: '/inventory', key: 'nav:inventory', shortKey: 'nav:shortInventory' },
  { to: '/team', key: 'nav:team', shortKey: 'nav:shortTeam' },
] as const;

/**
 * App shell: fixed sidebar (240px, >=lg) + 56px topbar + bottom tab bar
 * (<lg) on semantic tokens; all strings via i18n (H-04, ADR-019).
 * Spec note (§7): tablet (640-1023px) formally gets a sidebar DRAWER — the
 * tab bar covers that range as an accepted increment until the drawer lands.
 */
export function AppLayout() {
  const { t } = useTranslation(['common', 'nav']);
  const { data: session } = useSession();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    // Cached rosters/leads are the previous account's data — never let the
    // next sign-in on this device read them.
    queryClient.clear();
    navigate('/login');
  }

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="hidden w-[var(--sidebar-width)] shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <p className="px-5 pt-5 pb-3 text-lg font-bold">{t('common:appName')}</p>
        <nav aria-label={t('nav:mainNav')} className="flex flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )
              }
            >
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[var(--topbar-height)] items-center justify-between gap-4 border-b border-border bg-card px-4">
          <p className="text-sm font-semibold lg:hidden">{t('common:appName')}</p>
          <div className="ms-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session?.user.name || session?.user.email}
            </span>
            <LanguageSwitcher />
            <Button variant="outline" size="sm" onClick={() => void handleSignOut()}>
              {t('common:signOut')}
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 pb-20 lg:p-6">
          <Outlet />
        </main>

        {/* Mobile navigation (ui-design-system §7): the sidebar hides <lg,
            so a bottom tab bar carries the primary destinations. Icons join
            when the icon set lands (lucide deferred for release cooldown). */}
        <nav
          aria-label={t('nav:mainNav')}
          className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 items-center justify-center overflow-hidden px-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
            >
              {t(item.shortKey)}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
