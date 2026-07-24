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
