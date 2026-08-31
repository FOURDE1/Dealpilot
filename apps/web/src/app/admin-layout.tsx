import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@dealpilot/ui';
import { signOut } from '../shared/auth/client.js';
import { queryClient } from '../shared/api/queryClient.js';
import { LanguageSwitcher } from '../shared/i18n/language-switcher.js';
import { ThemeToggle } from '../shared/theme-toggle.js';
import { useAdminMe } from '../features/admin/api.js';
import { ROLE_KEYS } from '../features/admin/labels.js';
import { adminNavItems } from '../features/admin/nav.js';
import { KillSwitchBanner } from '../features/admin/kill-switch-banner.js';

/**
 * F-69 — the platform console's shell (admin-console.md §2). Same skeleton
 * as the tenant shell minus every tenant concern: no BrandStyle (a tenant's
 * brand must never paint the platform), no presence beacon, no bell. The
 * console shares the SPA origin until the dedicated host lands (O-8); the
 * API gate is identity-based, so nothing here depends on the host.
 */
export function AdminLayout() {
  const { t, i18n } = useTranslation('admin');
  const { t: tc } = useTranslation('common');
  const navigate = useNavigate();
  const me = useAdminMe();
  // The deadline carries its day when it is not today: a 12h window that
  // ends tomorrow morning must not read as a time already past (review).
  const reauthAt = me.data
    ? (() => {
        const by = new Date(me.data.session.reauth_by);
        const sameDay = by.toDateString() === new Date().toDateString();
        return new Intl.DateTimeFormat(i18n.language, sameDay ? { timeStyle: 'short' } : { dateStyle: 'short', timeStyle: 'short' }).format(by);
      })()
    : null;

  async function handleSignOut() {
    await signOut();
    queryClient.clear();
    navigate('/login');
  }

  // F-74: the capability→item mapping lives in features/admin/nav.ts, where
  // nav.test.ts proves it for all three platform roles (a browser run can
  // mint at most two). This layout only translates; the e2e console journey
  // is what proves the component renders that function's answer.
  const items = adminNavItems(me.data?.capabilities ?? []).map((item) => ({ to: item.to, label: t(item.labelKey) }));
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-11 items-center rounded-md px-3 text-sm font-medium',
      isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
    );

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        {tc('skipToContent')}
      </a>
      <aside className="hidden w-[var(--sidebar-width)] shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <p className="px-5 pt-5 pb-3 text-lg font-bold">{t('consoleName')}</p>
        <nav aria-label={t('consoleName')} className="flex flex-col gap-1 px-3">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/" className="mx-3 mt-auto mb-5 flex min-h-11 items-center px-3 text-sm text-sidebar-foreground underline-offset-4 hover:underline">
          {t('backToApp')}
        </Link>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[var(--topbar-height)] items-center justify-between gap-4 border-b border-border bg-card px-3 sm:px-4">
          <p className="text-sm font-semibold lg:hidden">{t('consoleName')}</p>
          <div className="ms-auto flex items-center gap-1.5 sm:gap-3">
            {me.data ? (
              <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">{t(ROLE_KEYS[me.data.role])}</span>
                {reauthAt ? <span>{t('reauthAt', { time: reauthAt })}</span> : null}
              </span>
            ) : null}
            <ThemeToggle />
            <LanguageSwitcher />
            <Button variant="outline" size="sm" onClick={() => void handleSignOut()}>
              {tc('signOut')}
            </Button>
          </div>
        </header>
        {/* F-72 §5.3: a flipped kill switch stands over every console page
            until someone resumes sending — the reason it cannot be forgotten. */}
        <KillSwitchBanner />
        <main id="main" tabIndex={-1} className="flex-1 p-4 pb-20 sm:p-6 lg:pb-6">
          <Outlet />
        </main>
        <nav
          aria-label={t('consoleName')}
          className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn('flex min-h-14 items-center justify-center text-xs font-medium', isActive ? 'text-primary-text' : 'text-muted-foreground')
              }
            >
              {item.label}
            </NavLink>
          ))}
          <Link to="/" className="flex min-h-14 items-center justify-center text-xs font-medium text-muted-foreground">
            {t('backToApp')}
          </Link>
        </nav>
      </div>
    </div>
  );
}
