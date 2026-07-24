import { NavLink, Outlet, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@dealpilot/ui';
import { signOut, useSession } from '../shared/auth/client.js';
import { LanguageSwitcher } from '../shared/i18n/language-switcher.js';

const NAV_ITEMS = [
  { to: '/', key: 'nav:dashboard', end: true },
  { to: '/organizations', key: 'nav:organizations' },
  { to: '/prospects', key: 'nav:prospects' },
  { to: '/pipeline', key: 'nav:pipeline' },
] as const;

/**
 * App shell: fixed sidebar (240px, collapses under lg to a top strip for this
 * increment) + 56px topbar, everything on semantic tokens; all strings via
 * i18n (H-04, ADR-019).
 */
export function AppLayout() {
  const { t } = useTranslation(['common', 'nav']);
  const { data: session } = useSession();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
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
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
