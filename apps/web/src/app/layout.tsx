import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@dealpilot/ui';
import { signOut, useSession } from '../shared/auth/client.js';
import { useMe } from '../shared/api/use-me.js';
import { queryClient } from '../shared/api/queryClient.js';
import { LanguageSwitcher } from '../shared/i18n/language-switcher.js';
import { ThemeToggle } from '../shared/theme-toggle.js';
import { BrandStyle, useBrandName } from '../features/branding/brand-style.js';
import { useOrganizations } from '../features/organizations/api.js';
import { NotificationsBell } from '../features/notifications/bell.js';
import { notificationKeys } from '../features/notifications/api.js';
import { useRealtime } from '../shared/realtime.js';

/**
 * F-43 (D-047 #1): holding the app open IS being online. The shell keeps one
 * notifications-room subscription per organization the user belongs to; each
 * successful subscribe marks them present there, and the server's 60s beat
 * keeps it fresh while any tab lives. Events are ignored until the
 * notification slice gives them a consumer — the subscription's job today is
 * the heartbeat.
 */
function PresenceBeacon({ organizationId }: { organizationId: string }) {
  useRealtime({ kind: 'notifications', organization_id: organizationId }, (event) => {
    // F-47: the event is a refresh HINT — the bell refetches; the row is the
    // truth (D-050). Workers write rows without a hint; the 60s interval
    // covers those.
    if (event.type === 'notification.created') {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    }
  });
  return null;
}

// `/pipeline` returns with its feature slice — a dead route belongs in no nav.
const NAV_ITEMS = [
  { to: '/', key: 'nav:dashboard', shortKey: 'nav:shortDashboard', end: true },
  { to: '/organizations', key: 'nav:organizations', shortKey: 'nav:shortOrganizations' },
  { to: '/leads', key: 'nav:prospects', shortKey: 'nav:shortProspects' },
  { to: '/contacts', key: 'nav:contacts', shortKey: 'nav:shortContacts', mobileHidden: true },
  { to: '/appointments', key: 'nav:appointments', shortKey: 'nav:shortAppointments', mobileHidden: true },
  { to: '/conversations', key: 'nav:conversations', shortKey: 'nav:shortConversations' },
  { to: '/pipeline', key: 'nav:pipeline', shortKey: 'nav:shortPipeline' },
  { to: '/inventory', key: 'nav:inventory', shortKey: 'nav:shortInventory' },
  { to: '/commissions', key: 'nav:commissions', shortKey: 'nav:shortCommissions', mobileHidden: true },
  { to: '/dispatch', key: 'nav:dispatch', shortKey: 'nav:shortDispatch', mobileHidden: true },
  { to: '/team', key: 'nav:team', shortKey: 'nav:shortTeam' },
] as const;

/**
 * App shell: fixed sidebar (240px, >=lg) + 56px topbar + bottom tab bar
 * (<lg) on semantic tokens; all strings via i18n (H-04, ADR-019).
 * Spec note (§7): tablet (640-1023px) formally gets a sidebar DRAWER — the
 * tab bar covers that range as an accepted increment until the drawer lands.
 */
export function AppLayout() {
  const { t } = useTranslation(['common', 'nav', 'security']);
  const { data: session } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  // F-41: the MFA policy banner. `required` is computed server-side from the
  // caller's roles; the banner nags on every page EXCEPT /security itself,
  // where the fix lives.
  const me = useMe();
  const mfaNag =
    me.data?.mfa.required === true &&
    me.data.mfa.enabled === false &&
    location.pathname !== '/security';
  // F-14: the tenant's own name in place of the platform name, when published.
  const brandName = useBrandName(t('common:appName'));
  // F-43: one presence beacon per organization (usually one).
  const orgs = useOrganizations();

  async function handleSignOut() {
    await signOut();
    // Cached rosters/leads are the previous account's data — never let the
    // next sign-in on this device read them.
    queryClient.clear();
    navigate('/login');
  }

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      {/* F-14: paint the tenant's published brand over the platform defaults. */}
      <BrandStyle />
      {(orgs.data?.items ?? []).map((o) => (
        <PresenceBeacon key={o.id} organizationId={o.id} />
      ))}
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        {t('common:skipToContent')}
      </a>
      <aside className="hidden w-[var(--sidebar-width)] shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <p className="px-5 pt-5 pb-3 text-lg font-bold">{brandName}</p>
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
        <header className="flex h-[var(--topbar-height)] items-center justify-between gap-4 border-b border-border bg-card px-3 sm:px-4">
          <p className="text-sm font-semibold lg:hidden">{brandName}</p>
          <div className="ms-auto flex items-center gap-1.5 sm:gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session?.user.name || session?.user.email}
            </span>
            <Link
              to="/security"
              // Hidden below sm like the username: the topbar does not wrap,
              // and this label pushed 360px viewports 8px sideways (caught by
              // the a11y reflow journey). The banner carries the path to
              // /security on mobile whenever the policy actually demands it.
              className="hidden text-sm font-medium text-primary underline-offset-4 hover:underline sm:inline"
            >
              {t('security:title')}
            </Link>
            <NotificationsBell />
            <ThemeToggle />
            <LanguageSwitcher />
            <Button variant="outline" size="sm" onClick={() => void handleSignOut()}>
              {/* The F-47 bell spent the topbar's last slack at 360px (the
                  a11y guard measured EXACTLY zero margin, and CI's wider
                  fonts tipped it). The short label keeps sign-out present
                  on the narrowest phones; the full words return at sm. */}
              <span className="sm:hidden">{t('common:signOutShort')}</span>
              <span className="hidden sm:inline">{t('common:signOut')}</span>
            </Button>
          </div>
        </header>
        {mfaNag ? (
          // role=status, NOT alert: this is a standing policy reminder, not an
          // interruption — and an assertive live region on every page would
          // also shout over real alerts (screen readers) and collide with
          // every getByRole('alert') assertion (the f01 journey found that).
          <p role="status" className="bg-warning-bg px-4 py-2 text-sm font-medium text-warning-text">
            {t('security:requiredBanner')}{' '}
            <Link to="/security" className="underline underline-offset-4">
              {t('security:title')}
            </Link>
          </p>
        ) : null}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 p-4 pb-20 lg:p-6 outline-none max-lg:pb-24">
          <Outlet />
        </main>

        {/* Mobile navigation (ui-design-system §7): the sidebar hides <lg,
            so a bottom tab bar carries the primary destinations. Icons join
            when the icon set lands (lucide deferred for release cooldown). */}
        <nav
          aria-label={t('nav:mainNav')}
          className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {NAV_ITEMS.filter((item) => !('mobileHidden' in item)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 items-center justify-center overflow-hidden border-t-2 px-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground',
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
