import type { PoolClient } from '@dealpilot/db';
import type { NotificationUrgencyT } from '@dealpilot/schemas';

/**
 * F-47 — writing a staff notification (D-050).
 *
 * The ROW is the truth; realtime is a refresh hint emitted post-commit where
 * an emitter is in reach (routes), and simply absent where one is not (the
 * workers) — the bell's 60-second refetch catches those up. Email and SMS
 * channels attach here once their credentials exist; until then
 * channels_sent stays '{in_app}' and the tier table in the spec still holds.
 *
 * `title_key` is an i18n key both locales carry — the vocabulary test in
 * f47's suite fails if a producer invents a key the locales do not have.
 */

export interface NotifyInput {
  organizationId: string;
  /** The RECIPIENT. */
  userId: string;
  urgency: NotificationUrgencyT;
  titleKey: string;
  params?: Record<string, unknown>;
  link?: string;
  entityType?: string;
  entityId?: string;
  storeId?: string | null;
}

export async function notify(c: PoolClient, input: NotifyInput): Promise<string> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO notifications
       (organization_id, user_id, store_id, urgency, title_key, params, link, entity_type, entity_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      input.organizationId, input.userId, input.storeId ?? null, input.urgency,
      input.titleKey, JSON.stringify(input.params ?? {}), input.link ?? null,
      input.entityType ?? null, input.entityId ?? null,
    ],
  );
  return r.rows[0]!.id;
}
