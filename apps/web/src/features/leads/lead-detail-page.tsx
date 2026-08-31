import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { BackLink } from '../../shared/ui/back-link.js';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { buttonVariants, Label, Select } from '@dealpilot/ui';
import { LEAD_STATUSES, type LeadStatusT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useLead, useUpdateLead } from './api.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { activeMembers, useMembers } from '../team/api.js';
import { useDealsForLead } from '../deals/api.js';
import { ChecklistDialog } from '../checklists/checklist-dialog.js';
import { ActivityTimeline } from '../activity/activity-timeline.js';
import { ConsentPanel } from '../compliance/consent-panel.js';
import { DealActivityDialog } from '../activity/activity-dialog.js';
import { BookDispatchDialog } from '../dispatch/book-dialog.js';
import { DocumentsDialog } from '../documents/documents-dialog.js';
import { DEAL_TYPE_KEYS, FUNDING_STATUS_KEYS, PIPELINE_STAGE_KEYS } from '../deals/labels.js';
import { formatCents } from '../deals/money.js';
import { LEAD_SOURCE_KEYS, LEAD_STATUS_KEYS, leadDisplayName } from './labels.js';
import { LostReasonDialog } from './lost-reason-dialog.js';
import { TaskPanel } from '../tasks/task-panel.js';
import { useLostReasons } from './lost-reason-api.js';
import { useDuplicates } from './duplicate-api.js';
import { lostReasonLabel } from '@dealpilot/core';
import type { DealT } from '@dealpilot/schemas';

/** The F-02 acceptance action: change a lead's status from its record page. */
export function LeadDetailPage() {
  const { t, i18n } = useTranslation('leads');
  const { t: td } = useTranslation('deals');
  const { t: ta } = useTranslation('activity');
  const { leadId = '' } = useParams();
  const lead = useLead(leadId);
  const updateLead = useUpdateLead(leadId);
  const deals = useDealsForLead(leadId, lead.data?.organization_id);
  usePageTitle(lead.data ? (leadDisplayName(lead.data) ?? lead.data.phone) : undefined);
  const members = useMembers(lead.data?.organization_id, { enabled: lead.isSuccess });
  const mine = usePermissionsMine(lead.data?.organization_id, { enabled: lead.isSuccess });
  const canDispatch = can(mine.data, 'dispatch:book');
  const assignees = activeMembers(members.data?.items);
  const assignedTo = lead.data?.assigned_to ?? null;
  const assignedIsFormer =
    assignedTo !== null && !assignees.some((m) => m.user_id === assignedTo);
  const [feedback, setFeedback] = useState<'saved' | 'error' | null>(null);
  const [checklistDeal, setChecklistDeal] = useState<DealT | null>(null);
  const [activityDeal, setActivityDeal] = useState<DealT | null>(null);
  const [dispatchDeal, setDispatchDeal] = useState<DealT | null>(null);
  const [documentsDeal, setDocumentsDeal] = useState<DealT | null>(null);
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  // The stored WHY, shown while the lead sits lost (inactive reasons still
  // resolve — history keeps its label after retirement).
  const lostReasons = useLostReasons(lead.data?.organization_id, {
    enabled: lead.data?.status === 'lost' && lead.data.lost_reason_id !== null,
    includeInactive: true,
  });
  const pendingDups = useDuplicates(lead.data?.organization_id, {
    status: 'pending',
    leadId,
    enabled: lead.isSuccess,
  });
  const inPendingPair = (pendingDups.data?.items.length ?? 0) > 0;
  const currentReason =
    lead.data?.lost_reason_id != null
      ? (lostReasons.data?.items.find((r) => r.id === lead.data?.lost_reason_id) ?? null)
      : null;

  async function handleStatusChange(status: LeadStatusT) {
    setFeedback(null);
    // leads.md §11: a loss needs a WHY — intercept with the modal instead of
    // collecting the API's 422 after the fact. A re-loss (reason already on
    // the row) passes straight through.
    if (status === 'lost' && lead.data?.status !== 'lost' && !lead.data?.lost_reason_id) {
      setLostDialogOpen(true);
      return;
    }
    try {
      await updateLead.mutateAsync({ status });
      setFeedback('saved');
    } catch (err) {
      setFeedback('error');
      if (!(err instanceof ApiError)) throw err;
    }
  }

  async function handleLostConfirm(reasonId: string, note: string | null) {
    setFeedback(null);
    try {
      await updateLead.mutateAsync({ status: 'lost', lost_reason_id: reasonId, lost_reason_note: note });
      setLostDialogOpen(false);
      setFeedback('saved');
    } catch (err) {
      setLostDialogOpen(false);
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
        {lead.data.contact_id ? (
          // The enquiry knows its person (F-36): one click from the lead to the
          // customer's full record — their deals, their history, their consent.
          <Link
            to={`/contacts/${lead.data.contact_id}`}
            className="text-sm font-medium text-primary-text underline-offset-4 hover:underline"
          >
            {t('customerFile')}
          </Link>
        ) : null}
      </header>
      {inPendingPair ? (
        <p role="status" className="rounded-md bg-caution-bg px-3 py-2 text-sm font-medium text-caution-text">
          {t('dup_banner')}{' '}
          <Link to="/leads/duplicates" className="underline underline-offset-4">
            {t('dup_bannerLink')}
          </Link>
        </p>
      ) : null}

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
          {lead.data.status === 'lost' && currentReason ? (
            <p className="text-sm text-muted-foreground">
              {t('lostReason_current')} <span aria-hidden="true">{currentReason.icon}</span>{' '}
              {lostReasonLabel(currentReason, i18n.language)}
              {lead.data.lost_reason_note ? <> — {lead.data.lost_reason_note}</> : null}
            </p>
          ) : null}
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

        <TaskPanel lead={lead.data} />

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
                <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5 text-sm">
                  <span>
                    {td(DEAL_TYPE_KEYS[d.deal_type])}
                    <span className="text-muted-foreground">
                      {' '}— {td(PIPELINE_STAGE_KEYS[d.pipeline_stage])} · {td(FUNDING_STATUS_KEYS[d.funding_status])}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono tabular-nums">
                      {d.deal_type === 'cash'
                        ? formatCents(d.amount_financed_cents, i18n.language)
                        : td('monthlyAbbr', {
                            amount: formatCents(d.monthly_payment_cents, i18n.language),
                          })}
                    </span>
                    <Link
                      to={`/leads/${leadId}/desk/${d.id}`}
                      className="text-xs font-medium text-primary-text underline-offset-4 hover:underline max-lg:min-h-11 max-lg:inline-flex max-lg:items-center"
                      aria-label={td('editDealFor', {
                        name: `${td(DEAL_TYPE_KEYS[d.deal_type])} ${formatCents(d.deal_type === 'cash' ? d.amount_financed_cents : d.monthly_payment_cents, i18n.language)}`,
                      })}
                    >
                      {td('editDeal')}
                    </Link>
                    {canDispatch ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-primary-text underline-offset-4 hover:underline max-lg:min-h-11"
                      aria-label={td('bookDispatchFor', {
                        name: `${td(DEAL_TYPE_KEYS[d.deal_type])} ${formatCents(d.deal_type === 'cash' ? d.amount_financed_cents : d.monthly_payment_cents, i18n.language)}`,
                      })}
                      onClick={() => setDispatchDeal(d)}
                    >
                      {td('bookDispatch')}
                    </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-xs font-medium text-primary-text underline-offset-4 hover:underline max-lg:min-h-11"
                      aria-label={ta('historyFor', {
                        name: `${td(DEAL_TYPE_KEYS[d.deal_type])} ${formatCents(d.deal_type === 'cash' ? d.amount_financed_cents : d.monthly_payment_cents, i18n.language)}`,
                      })}
                      onClick={() => setActivityDeal(d)}
                    >
                      {ta('historyAction')}
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary-text underline-offset-4 hover:underline max-lg:min-h-11"
                      aria-label={td('checklistFor', {
                        name: `${td(DEAL_TYPE_KEYS[d.deal_type])} ${formatCents(d.deal_type === 'cash' ? d.amount_financed_cents : d.monthly_payment_cents, i18n.language)}`,
                      })}
                      onClick={() => setChecklistDeal(d)}
                    >
                      {td('checklistAction')}
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary-text underline-offset-4 hover:underline max-lg:min-h-11"
                      aria-label={td('documentsFor', {
                        name: `${td(DEAL_TYPE_KEYS[d.deal_type])} ${formatCents(d.deal_type === 'cash' ? d.amount_financed_cents : d.monthly_payment_cents, i18n.language)}`,
                      })}
                      onClick={() => setDocumentsDeal(d)}
                    >
                      {td('documentsAction')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* F-15: whether we may contact this person, and on what basis. Placed
            above the history because it answers a question somebody is about to
            act on, while the history answers one about the past. */}
        <div className="sm:col-span-2">
          <ConsentPanel lead={lead.data} />
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-card p-4 sm:col-span-2">
          <h2 className="text-[15px] font-semibold">{ta('title')}</h2>
          <ActivityTimeline
            entityType="lead"
            entityId={lead.data.id}
            organizationId={lead.data.organization_id}
          />
        </div>
      </div>
      <LostReasonDialog
        open={lostDialogOpen}
        orgId={lead.data.organization_id}
        storeId={lead.data.store_id}
        pending={updateLead.isPending}
        onConfirm={(reasonId, note) => void handleLostConfirm(reasonId, note)}
        onClose={() => setLostDialogOpen(false)}
      />
      <ChecklistDialog
        deal={checklistDeal}
        dealLabel={checklistDeal ? td(DEAL_TYPE_KEYS[checklistDeal.deal_type]) : undefined}
        onClose={() => setChecklistDeal(null)}
      />
      <DealActivityDialog
        deal={activityDeal}
        dealLabel={activityDeal ? td(DEAL_TYPE_KEYS[activityDeal.deal_type]) : undefined}
        onClose={() => setActivityDeal(null)}
      />
      <BookDispatchDialog
        deal={dispatchDeal}
        dealLabel={dispatchDeal ? td(DEAL_TYPE_KEYS[dispatchDeal.deal_type]) : undefined}
        onClose={() => setDispatchDeal(null)}
      />
      <DocumentsDialog
        deal={documentsDeal}
        dealLabel={documentsDeal ? td(DEAL_TYPE_KEYS[documentsDeal.deal_type]) : undefined}
        onClose={() => setDocumentsDeal(null)}
      />
    </div>
  );
}
