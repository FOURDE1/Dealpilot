import { useTranslation } from 'react-i18next';
import type { ActivityActionT, ActivityEntityTypeT, ActivityEventT } from '@dealpilot/schemas';
import { useMembers } from '../team/api.js';
import { formatCents } from '../deals/money.js';
import { useActivity } from './api.js';

const ACTION_KEYS = {
  created: 'action_created',
  updated: 'action_updated',
  deleted: 'action_deleted',
  stage_changed: 'action_stage_changed',
  funding_changed: 'action_funding_changed',
  delivered: 'action_delivered',
  assigned: 'action_assigned',
  unassigned: 'action_unassigned',
  checklist_completed: 'action_checklist_completed',
  checklist_uncompleted: 'action_checklist_uncompleted',
  checklist_waived: 'action_checklist_waived',
  checklist_unwaived: 'action_checklist_unwaived',
  roles_changed: 'action_roles_changed',
  revoked: 'action_revoked',
  reinstated: 'action_reinstated',
} as const satisfies Record<ActivityActionT, string>;

function changeValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * One entity's audit trail (F-10). The wording stays close to the wire —
 * field names and raw values — because this is the surface an auditor reads;
 * prettifying values would put an interpretation between them and the record.
 */
export function ActivityTimeline({
  entityType,
  entityId,
  organizationId,
}: {
  entityType: ActivityEntityTypeT;
  entityId: string;
  organizationId: string | undefined;
}) {
  const { t, i18n } = useTranslation('activity');
  const activity = useActivity(entityType, entityId, organizationId);
  const members = useMembers(organizationId, { enabled: organizationId !== undefined });
  const removed = useMembers(organizationId, {
    enabled: organizationId !== undefined,
    status: 'revoked',
  });

  const actorName = (event: ActivityEventT) => {
    if (event.actor_user_id === null) return t('system');
    return (
      members.data?.items.find((m) => m.user_id === event.actor_user_id)?.name ??
      removed.data?.items.find((m) => m.user_id === event.actor_user_id)?.name ??
      t('unlistedMember')
    );
  };

  const resolveUser = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    return (
      members.data?.items.find((m) => m.user_id === v)?.name ??
      removed.data?.items.find((m) => m.user_id === v)?.name ??
      null
    );
  };

  const renderValue = (field: string, v: unknown): string => {
    if (field.endsWith('_cents') && typeof v === 'number') return formatCents(v, i18n.language);
    const name = resolveUser(v);
    return name ?? changeValue(v);
  };

  if (activity.isPending)
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  if (activity.isError)
    return (
      <p role="alert" className="text-sm text-danger-text">
        {t('loadError')}
      </p>
    );
  if (activity.data.items.length === 0)
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;

  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
    {activity.data.truncated ? (
      <p className="text-sm text-muted-foreground">{t('truncated')}</p>
    ) : null}
    <ol className="divide-y divide-border">
      {activity.data.items.map((event) => {
        const fields = Object.entries(event.changes);
        return (
          <li key={event.id} className="space-y-0.5 py-2 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <span>
                <span className="font-medium">{t(ACTION_KEYS[event.action])}</span>
                <span className="text-muted-foreground"> — {actorName(event)}</span>
              </span>
              <time dateTime={event.created_at} className="text-xs text-muted-foreground">
                {fmt.format(new Date(event.created_at))}
              </time>
            </div>
            {event.reason !== null ? (
              <p className="text-xs text-muted-foreground">{t('reason', { reason: event.reason })}</p>
            ) : null}
            {fields.length > 0 ? (
              <ul className="space-y-0.5">
                {fields.map(([field, change]) => {
                  const c = change as { from?: unknown; to?: unknown };
                  const hasFromTo = c !== null && typeof c === 'object' && ('from' in c || 'to' in c);
                  return (
                    <li key={field} className="font-mono text-xs text-muted-foreground">
                      {field}
                      {hasFromTo
                        ? `: ${renderValue(field, c.from)} → ${renderValue(field, c.to)}`
                        : `: ${renderValue(field, change)}`}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
    </>
  );
}
