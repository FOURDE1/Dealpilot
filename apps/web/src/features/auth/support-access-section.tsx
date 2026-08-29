import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SupportAccessList } from '@dealpilot/schemas';
import { ApiError, apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';

/**
 * F-71 — the tenant's register of support access (admin-console.md §7
 * "every session visible to the tenant"; spec path /settings/security/
 * support-access → a section of /security here). One block per organization
 * the person belongs to; a block they may not read (no activity:read) is
 * simply absent — the server said no, the page does not argue.
 */
function SupportAccessFor({ orgId, name }: { orgId: string; name: string }) {
  const { t, i18n } = useTranslation('security');
  const { t: tAdmin } = useTranslation('admin');
  const list = useQuery({
    queryKey: ['support-access', orgId],
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.supportAccess.list, { query: { organization_id: orgId, limit: '50' }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return SupportAccessList.parse(res.body);
    },
  });
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');
  if (list.isError) {
    const status = list.error instanceof ApiError ? list.error.status : undefined;
    // No activity:read (403) or not a member here (404): the register does
    // not exist for this caller. Anything else is an outage and says so —
    // an error must not read as an empty register (review).
    if (status === 403 || status === 404) return null;
    return <p role="alert" className="text-sm text-danger-text">{t('supportAccessLoadError')}</p>;
  }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{name}</h3>
      {list.isPending ? <p aria-busy="true" className="text-sm text-muted-foreground">{t('supportAccessLoading')}</p> : null}
      {list.isSuccess && list.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{t('supportAccessEmpty')}</p> : null}
      {list.isSuccess && list.data.items.length > 0 ? (
        <ul className="divide-y divide-border text-sm">
          {list.data.items.map((s) => (
            <li key={s.id} className="space-y-0.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.platform_user.email}</span>
                <span>{t('supportAccessTarget')}{' '}{s.target_user.name || t('supportAccessFormerMember')}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{tAdmin(s.mode === 'full' ? 'mode_full' : 'mode_read_only')}</span>
                {s.active ? <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning-text">{t('supportAccessActive')}</span> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {fmt(s.started_at)} → {s.active ? fmt(s.expires_at) : fmt(s.ended_at)}
                {s.ticket_ref ? ` · ${s.ticket_ref}` : ''}
              </p>
              <p className="text-xs">{t('supportAccessReason', { reason: s.reason })}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SupportAccessSection() {
  const { t } = useTranslation('security');
  const orgs = useOrganizations();
  const items = orgs.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="support-access" className="space-y-3 rounded-lg border border-border p-4">
      <h2 id="support-access" className="text-sm font-semibold">{t('supportAccessTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('supportAccessBody')}</p>
      {items.map((o) => (
        <SupportAccessFor key={o.id} orgId={o.id} name={o.name} />
      ))}
    </section>
  );
}
