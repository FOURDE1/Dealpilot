import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@dealpilot/ui';
import type { OrganizationT } from '@dealpilot/schemas';
import { useOrganizations } from './api.js';

/** Status/plan vocabularies are data — users see localized labels. */
const STATUS_KEYS = {
  active: 'status_active',
  trial: 'status_trial',
  past_due: 'status_past_due',
  read_only: 'status_read_only',
  suspended: 'status_suspended',
  offboarding: 'status_offboarding',
  purged: 'status_purged',
} as const satisfies Record<OrganizationT['status'], string>;

const TIER_KEYS = {
  core: 'tier_core',
  growth: 'tier_growth',
  scale: 'tier_scale',
  enterprise: 'tier_enterprise',
} as const satisfies Record<OrganizationT['plan_tier'], string>;

export function OrganizationsPage() {
  const { t } = useTranslation('orgs');
  const orgs = useOrganizations();

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link to="/organizations/new" className={buttonVariants()}>
          {t('newOrg')}
        </Link>
      </header>

      {orgs.isPending ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('loading')}
        </p>
      ) : orgs.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('loadError')}
        </p>
      ) : orgs.data.items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <h2 className="text-[15px] font-semibold">{t('emptyTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-start text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 text-start">{t('name')}</th>
                <th className="px-4 py-2.5 text-start">{t('slug')}</th>
                <th className="px-4 py-2.5 text-start">{t('statusLabel')}</th>
                <th className="px-4 py-2.5 text-start">{t('planLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {orgs.data.items.map((org) => (
                <tr key={org.id} className="border-b border-border last:border-b-0 hover:bg-muted">
                  <td className="px-4 py-2.5 font-medium">
                    <Link to={`/organizations/${org.id}`} className="text-primary hover:underline">
                      {org.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[13px]">{org.slug}</td>
                  <td className="px-4 py-2.5">{t(STATUS_KEYS[org.status])}</td>
                  <td className="px-4 py-2.5">{t(TIER_KEYS[org.plan_tier])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
