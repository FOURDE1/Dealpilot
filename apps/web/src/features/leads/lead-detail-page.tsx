import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { BackLink } from '../../shared/ui/back-link.js';
import { useTranslation } from 'react-i18next';
import { buttonVariants, Label, Select } from '@dealpilot/ui';
import { LEAD_STATUSES, type LeadStatusT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useLead, useUpdateLead } from './api.js';
import { activeMembers, useMembers } from '../team/api.js';
import { useDealsForLead } from '../deals/api.js';
import { DEAL_STATUS_KEYS, DEAL_TYPE_KEYS } from '../deals/labels.js';
import { formatCents } from '../deals/money.js';
import { LEAD_SOURCE_KEYS, LEAD_STATUS_KEYS, leadDisplayName } from './labels.js';

/** The F-02 acceptance action: change a lead's status from its record page. */
export function LeadDetailPage() {
  const { t, i18n } = useTranslation('leads');
  const { t: td } = useTranslation('deals');
  const { leadId = '' } = useParams();
  const lead = useLead(leadId);
  const updateLead = useUpdateLead(leadId);
  const deals = useDealsForLead(leadId, lead.data?.organization_id);
  const members = useMembers(lead.data?.organization_id, { enabled: lead.isSuccess });
  const assignees = activeMembers(members.data?.items);
  const assignedTo = lead.data?.assigned_to ?? null;
  const assignedIsFormer =
    assignedTo !== null && !assignees.some((m) => m.user_id === assignedTo);
  const [feedback, setFeedback] = useState<'saved' | 'error' | null>(null);

  async function handleStatusChange(status: LeadStatusT) {
    setFeedback(null);
    try {
      await updateLead.mutateAsync({ status });
      setFeedback('saved');
    } catch (err) {
      setFeedback('error');
      if (!(err instanceof ApiError)) throw err;
    }
  }

  async function handleAssign(userId: string) {
    setFeedback(null);
    try {
      await updateLead.mutateAsync({ assigned_to: userId === '' ? null : userId });
      setFeedback('saved');
    } catch (err) {
      setFeedback('error');
      if (!(err instanceof ApiError)) throw err;
    }
  }

  if (lead.isPending) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        {t('loading')}
      </p>
    );
  }
  if (lead.isError) {
    return (
      <p role="alert" className="text-sm text-danger-text">
        {t('loadError')}
      </p>
    );
  }

  const created = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(lead.data.created_at));

  return (
    <div className="space-y-6">
      <BackLink to={"/leads"}>{t('back')}</BackLink>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold">{leadDisplayName(lead.data) ?? t('noName')}</h1>
        <span className="font-mono text-sm text-muted-foreground">{lead.data.phone}</span>
      </header>

      <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('sourceCol')}</dt>
              <dd>{t(LEAD_SOURCE_KEYS[lead.data.source])}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('email')}</dt>
              <dd>{lead.data.email ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('vehicleInterest')}</dt>
              <dd>{lead.data.vehicle_interest ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('createdAt')}</dt>
              <dd>{created}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="space-y-2">
            <Label htmlFor="lead-assignee">{t('assignTitle')}</Label>
            <Select
              id="lead-assignee"
              value={lead.data.assigned_to ?? ''}
              disabled={updateLead.isPending || members.isPending}
              onChange={(e) => void handleAssign(e.target.value)}
            >
              <option value="">{t('unassigned')}</option>
              {assignedIsFormer ? (
                <option value={assignedTo} disabled>
                  {t('formerMember')}
                </option>
              ) : null}
              {assignees.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <Label htmlFor="lead-status">{t('changeStatus')}</Label>
          <Select
            id="lead-status"
            value={lead.data.status}
            disabled={updateLead.isPending}
            onChange={(e) => void handleStatusChange(e.target.value as LeadStatusT)}
          >
            {LEAD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(LEAD_STATUS_KEYS[status])}
              </option>
            ))}
          </Select>
          {feedback === 'saved' ? (
            <p role="status" className="text-sm font-medium text-success-text">
              {t('saved')}
            </p>
          ) : null}
          {feedback === 'error' ? (
            <p role="alert" className="text-sm text-danger-text">
              {t('genericError')}
            </p>
          ) : null}
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-card p-4 sm:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">{td('dealsTitle')}</h2>
            <Link to={`/leads/${leadId}/desk`} className={buttonVariants({ size: 'sm' })}>
              {td('deskAction')}
            </Link>
          </div>
          {deals.isPending ? (
            <p className="text-sm text-muted-foreground">{td('loading')}</p>
          ) : deals.isError ? (
            <p role="alert" className="text-sm text-danger-text">
              {td('loadError')}
            </p>
          ) : deals.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{td('noDeals')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {deals.data.items.map((d) => (
                <li key={d.id} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
                  <span>
                    {td(DEAL_TYPE_KEYS[d.deal_type])}
                    <span className="text-muted-foreground"> — {td(DEAL_STATUS_KEYS[d.status])}</span>
                  </span>
                  <span className="font-mono tabular-nums">
                    {d.deal_type === 'cash'
                      ? formatCents(d.amount_financed_cents, i18n.language)
                      : td('monthlyAbbr', {
                          amount: formatCents(d.monthly_payment_cents, i18n.language),
                        })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
