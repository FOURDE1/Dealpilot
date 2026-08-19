import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';

/**
 * F-47 — staff notifications (automation-notifications.md §2/§5, D-050).
 * The row carries an i18n KEY plus ICU params; the recipient's client renders
 * it in their own locale. `read` is one vocabulary: `read_at` nullable.
 */

export const NotificationUrgency = z.enum(['low', 'medium', 'high']);

export const Notification = z.object({
  id: Uuid,
  organization_id: Uuid,
  user_id: Uuid,
  store_id: Uuid.nullable(),
  urgency: NotificationUrgency,
  title_key: z.string(),
  params: z.record(z.string(), z.unknown()),
  link: z.string().nullable(),
  entity_type: z.string().nullable(),
  entity_id: Uuid.nullable(),
  read_at: IsoDateTime.nullable(),
  channels_sent: z.array(z.string()),
  created_at: IsoDateTime,
});

/** The bell's payload: the 20 most recent plus the true unread count. */
export const NotificationList = z.object({
  items: z.array(Notification),
  unread: z.number().int(),
});

/**
 * Every title_key a producer may write — one vocabulary, carried here so the
 * API (writers) and the web locales (renderers) lockstep-test against the
 * same list without depending on each other.
 */
export const NOTIFICATION_TITLE_KEYS = [
  'notif_lead_assigned',
  'notif_lead_taken_back',
  'notif_lead_escalated',
] as const;

export type NotificationT = z.infer<typeof Notification>;
export type NotificationUrgencyT = z.infer<typeof NotificationUrgency>;
