import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { useSession } from '../../shared/auth/client.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { useOrganizations } from '../organizations/api.js';
import { useLeads } from '../leads/api.js';
import { LEAD_STATUS_KEYS, leadDisplayName } from '../leads/labels.js';
import { recentLeads } from './stats.js';
import { SpeedPanel } from './speed-panel.js';
import { GmReport } from './gm-report.js';

/**
 * The post-login landing (F-78, D-079). The old floor tiles — client counts
 * over the lead list's first page presented as org totals — are GONE for
 * every role. Holders of report:view get the GM Command Center's
 * server-computed figures (gm-report.tsx); everyone else keeps the greeting,
 * the SpeedPanel, the links and the recent-leads LIST — zero figures, and
 * the report request is never fired.
 */
export function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { t: tLeads } = useTranslation('leads');
  const { data: session } = useSession();
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const scopeOrg = multiOrg ? orgs.data?.items[0] : undefined;
  // A4: the REPORT's org is the first org, unconditionally (the shipped
  // win-loss pattern) — the scopeOrg dance above is undefined for every
  // single-org tenant and would 400 the owner on his own page.
  const orgId = orgs.data?.items[0]?.id;
  const mine = usePermissionsMine(orgId, { enabled: !orgs.isPending });
  const canView = can(mine.data, 'report:view');
  // A10: while permissions/mine resolves, can() is false, so every holder
  // briefly carries the non-holder title — accepted deliberately (a title
  // claims no figure), switching to gmTitle once report:view settles.
  usePageTitle(t(canView ? 'gmTitle' : 'myDayTitle'));
  // Wait for orgs before listing: a multi-org user's unscoped list is a
  // guaranteed 4xx (server requires organization_id).
  const leads = useLeads(scopeOrg?.id, { enabled: !orgs.isPending });

  const name = session?.user.name || session?.user.email;
  const items = useMemo(() => leads.data?.items ?? [], [leads.data]);
  const recent = useMemo(() => recentLeads(items), [items]);
  const pending = orgs.isPending || leads.isPending;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {name ? t('greetingName', { name }) : t('greeting')}
      </h1>

      {canView ? <GmReport orgId={orgId} /> : null}

      <SpeedPanel orgId={scopeOrg?.id} enabled={!orgs.isPending} />

      <p className="text-sm">
        <Link
          to="/commissions"
          className="font-medium text-primary-text hover:underline max-lg:inline-flex max-lg:min-h-11 max-lg:items-center"
        >
          {t('commissionsLink')}
        </Link>
        {' · '}
        <Link
          to="/dispatch"
          className="font-medium text-primary-text hover:underline max-lg:inline-flex max-lg:min-h-11 max-lg:items-center"
        >
          {t('deliveriesLink')}
        </Link>
      </p>

      <section className="space-y-3" aria-labelledby="dash-recent-title">
        <header className="flex items-baseline justify-between gap-3">
          <h2 id="dash-recent-title" className="text-lg font-semibold">
            {t('recentTitle')}
          </h2>
          <Link
            to="/leads"
            className="text-sm font-medium text-primary-text hover:underline max-lg:inline-flex max-lg:min-h-11 max-lg:items-center"
          >
            {t('viewAll')}
          </Link>
        </header>
        {pending ? (
          <p className="text-sm text-muted-foreground">{tLeads('loading')}</p>
        ) : leads.isError ? (
          <p role="alert" className="text-sm text-danger-text">
            {tLeads('loadError')}
          </p>
        ) : recent.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6">
            <h3 className="text-[15px] font-semibold">{t('welcomeTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('noLeadsYet')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {recent.map((lead) => (
              <li key={lead.id}>
                <Link
                  to={`/leads/${lead.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {leadDisplayName(lead) ?? tLeads('noName')}
                    </span>
                    <span className="block font-mono text-[12px] text-muted-foreground">
                      {lead.phone}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-secondary-foreground">
                    {tLeads(LEAD_STATUS_KEYS[lead.status])}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
