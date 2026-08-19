import type { LeadStatusT, LeadT } from '@dealpilot/schemas';

/** Vocabulary → localized-label keys; `satisfies` keeps them exhaustive. */
export const LEAD_STATUS_KEYS = {
  new: 'status_new',
  chatbot_engaged: 'status_chatbot_engaged',
  assigned: 'status_assigned',
  contacted: 'status_contacted',
  qualified: 'status_qualified',
  converted: 'status_converted',
  unresponsive: 'status_unresponsive',
  nurture: 'status_nurture',
  expired: 'status_expired',
  lost: 'status_lost',
} as const satisfies Record<LeadStatusT, string>;

export const LEAD_SOURCE_KEYS = {
  fluent_form: 'source_fluent_form',
  meta_lead_form: 'source_meta_lead_form',
  manual: 'source_manual',
  chatbot: 'source_chatbot',
  website: 'source_website',
  walk_in: 'source_walk_in',
  phone: 'source_phone',
  referral: 'source_referral',
  repeat: 'source_repeat',
  service: 'source_service',
  instagram: 'source_instagram',
  marketplace: 'source_marketplace',
  google_ads: 'source_google_ads',
  autotrader: 'source_autotrader',
  cargurus: 'source_cargurus',
  kijiji: 'source_kijiji',
  oem: 'source_oem',
  appointment_promotion: 'source_appointment_promotion',
  other: 'source_other',
} as const satisfies Record<LeadT['source'], string>;

export function leadDisplayName(lead: Pick<LeadT, 'first_name' | 'last_name'>): string | null {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
  return name || null;
}

/**
 * §6.4 band → localized-label keys and pill classes (F-39). The band itself
 * comes from @dealpilot/core's scoreBand — the same function the engine uses,
 * so the list's colour can never disagree with the API's `band`.
 */
export const SCORE_BAND_KEYS = {
  hot: 'band_hot',
  warm: 'band_warm',
  cold: 'band_cold',
} as const satisfies Record<'hot' | 'warm' | 'cold', string>;

export const SCORE_BAND_CLASSES = {
  hot: 'bg-success-bg text-success-text',
  warm: 'bg-warning-bg text-warning-text',
  cold: 'bg-danger-bg text-danger-text',
} as const satisfies Record<'hot' | 'warm' | 'cold', string>;

/**
 * §5's lead-age colors (FR-LEAD-016): under 5 minutes the AI should be
 * engaging (fresh), to 15 it should have handed off (aging), and past 15 a
 * lead NOBODY owns is overdue — an owned lead's age is its owner's story, so
 * it stays amber, never red. Only the pre-human states carry a freshness
 * clock at all; a worked lead has a person, not a timer.
 */
export function agingBand(
  lead: Pick<LeadT, 'created_at' | 'assigned_to' | 'status'>,
  nowMs: number,
): 'fresh' | 'aging' | 'overdue' | null {
  if (lead.status !== 'new' && lead.status !== 'chatbot_engaged') return null;
  const ageMs = nowMs - Date.parse(lead.created_at);
  if (ageMs < 5 * 60_000) return 'fresh';
  if (ageMs < 15 * 60_000) return 'aging';
  return lead.assigned_to === null ? 'overdue' : 'aging';
}

export const AGING_KEYS = {
  fresh: 'aging_fresh',
  aging: 'aging_aging',
  overdue: 'aging_overdue',
} as const satisfies Record<'fresh' | 'aging' | 'overdue', string>;

export const AGING_CLASSES = {
  fresh: 'bg-success-bg text-success-text',
  aging: 'bg-warning-bg text-warning-text',
  overdue: 'bg-danger-bg text-danger-text',
} as const satisfies Record<'fresh' | 'aging' | 'overdue', string>;
