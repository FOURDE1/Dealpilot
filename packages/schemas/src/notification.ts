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
  /** F-68 §3.3: task overdue → its assignee and the store's sales managers. */
  'notif_task_overdue',
  /** …and, ten minutes unacknowledged, the GM. */
  'notif_task_escalated',
  /** F-71 §7: every active owner, when platform support opens a session on a member. */
  'notif_support_access_started_read_only',
  'notif_support_access_started_full',
  /**
   * F-72 §8: a published announcement, one row per matched person, written by
   * `announcement_fanout_batch` (0068). Its `params` carry BOTH titles —
   * `title_en` and `title_fr` — because 0051's contract is that the language
   * is chosen at DISPLAY time by the recipient's own locale, and
   * `users.language_pref` is written by nothing in this product.
   */
  'notif_announcement_published',
  /**
   * Produced today and never registered until F-72 closed the hole: the input
   * type was `string`, so nothing compared these against the locale bundles.
   */
  'notif_duplicate_resubmission',
  'notif_qa_compliance_flag',
  'notif_qa_weekly_low',
  /** F-79 §11.4: a confirmed clawback → the salesperson whose line is reversed,
   *  and the store's GMs (owner fallback); the confirming actor is dropped from
   *  the MANAGER set only — the earner always receives, even confirming their own. */
  'notif_commission_clawback',
] as const;

export type NotificationT = z.infer<typeof Notification>;
export type NotificationUrgencyT = z.infer<typeof NotificationUrgency>;
