import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Label, Select, buttonVariants } from '@dealpilot/ui';
import { usePageTitle } from '../../shared/use-page-title.js';
import { usePermissionsMine } from '../../shared/permissions.js';
import { useOrganizations } from '../organizations/api.js';
import { sectionHref, visibleSections } from './sections.js';

/**
 * F-76 (R3, R9) — /settings: one place that names where each piece of the
 * organization's configuration lives. Nothing moved: every card links an
 * existing page at its existing address (sections.ts, guarded by
 * sections.test.ts against the router). Org scope as the scoring page does
 * it: a select appears only when the member belongs to more than one.
 */
export function SettingsIndexPage() {
  const { t } = useTranslation([
    'settings',
    'orgs',
    'scoring',
    'assignment',
    'leads',
    'connectors',
    'schedules',
    'permissions',
    'security',
  ]);
  usePageTitle(t('settings:title'));
  const orgs = useOrganizations();
  const noOrg = orgs.isSuccess && orgs.data.items.length === 0;
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const mine = usePermissionsMine(multiOrg ? orgId : undefined, { enabled: !orgs.isPending && !noOrg });
  const sections = visibleSections(mine.data, orgId);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('settings:title')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings:subtitle')}</p>
      </header>

      {multiOrg ? (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="settings-org">{t('settings:orgScope')}</Label>
          <Select id="settings-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
            {orgs.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {orgs.isPending ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('settings:loading')}
        </p>
      ) : orgs.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('settings:loadError')}
        </p>
      ) : noOrg ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">{t('settings:noOrg')}</p>
          <Link to="/organizations/new" className={buttonVariants({ size: 'sm' })}>
            {t('settings:noOrgCta')}
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sections.map((section) => {
            const href = sectionHref(section, orgId);
            if (!href) return null;
            return (
              <li key={section.id}>
                <Link
                  to={href}
                  className="block h-full rounded-lg border border-border bg-card p-4 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block font-medium text-primary-text">{t(section.labelKey)}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t(`settings:${section.descKey}`)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
