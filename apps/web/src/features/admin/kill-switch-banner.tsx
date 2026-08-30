import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAdminMe, usePlatformSettings } from './api.js';
import { SETTING_KEYS } from './labels.js';

/**
 * F-72 R15 — the standing reminder that the platform is paused.
 *
 * §5.3 says flipping a switch "emits a Sentry event + Better Stack incident".
 * Neither is wired into this codebase and F-72 invents neither; this bar is
 * the operational half a status-page incident actually provides — no member
 * of staff can walk past a flipped switch, because it stands over every page
 * of the console until someone resumes sending.
 *
 * Console-side only. There is no tenant-facing version: a dealer learns that
 * a send was refused where the send is refused, and telling every tenant that
 * the platform is paused is what a `maintenance` announcement is for.
 */
export function KillSwitchBanner() {
  const { t } = useTranslation('switches');
  const me = useAdminMe();
  // Platform billing holds no `settings:read`; asking anyway would be a 403
  // per poll and a red herring in the log.
  const settings = usePlatformSettings(me.data?.capabilities.includes('settings:read') ?? false);
  const stopped = (settings.data?.items ?? []).filter((s) => s.enabled);
  if (stopped.length === 0) return null;

  return (
    <p role="status" className="bg-danger-bg px-4 py-2 text-sm font-medium text-danger-text">
      {t('ksBanner', { switches: stopped.map((s) => t(SETTING_KEYS[s.setting_key].label)).join(', ') })}{' '}
      <Link to="/admin/platform-settings" className="underline underline-offset-4">
        {t('title')}
      </Link>
    </p>
  );
}
