import type { ProvinceCA } from '@dealpilot/schemas';
import { slugify } from '../organizations/organization-new-page.js';

export type ProvinceCAT = (typeof ProvinceCA.options)[number];

/**
 * F-70 — the provisioning form's pure helpers (admin-console.md §4.3).
 * Defaults are SUGGESTIONS the staffer can overwrite; the server is the
 * authority on every value (timezone names are checked against Postgres,
 * codes and slugs against the schema). Nothing here talks to the network.
 */

export { slugify };

/** Region/city IANA names for Canada — the only kind `assertKnownTimezone` accepts (F-67). */
export const CANADA_TIMEZONES = [
  'America/St_Johns',
  'America/Halifax',
  'America/Moncton',
  'America/Montreal',
  'America/Toronto',
  'America/Winnipeg',
  'America/Regina',
  'America/Edmonton',
  'America/Vancouver',
  'America/Whitehorse',
  'America/Yellowknife',
  'America/Iqaluit',
] as const;
export type CanadaTimezone = (typeof CANADA_TIMEZONES)[number];

const TIMEZONE_BY_PROVINCE: Record<ProvinceCAT, CanadaTimezone> = {
  AB: 'America/Edmonton',
  BC: 'America/Vancouver',
  MB: 'America/Winnipeg',
  NB: 'America/Moncton',
  NL: 'America/St_Johns',
  NS: 'America/Halifax',
  NT: 'America/Yellowknife',
  NU: 'America/Iqaluit',
  ON: 'America/Toronto',
  PE: 'America/Halifax',
  QC: 'America/Montreal',
  SK: 'America/Regina',
  YT: 'America/Whitehorse',
};

/** The province's usual zone; Montréal for anything unknown (the product is Québec-first). */
export function timezoneFor(province: string): CanadaTimezone {
  return (TIMEZONE_BY_PROVINCE as Record<string, CanadaTimezone | undefined>)[province] ?? 'America/Montreal';
}

/** Bill 96: a Québec tenant is French by default; everywhere else English — editable. */
export function localeFor(province: string): 'fr-CA' | 'en-CA' {
  return province === 'QC' ? 'fr-CA' : 'en-CA';
}

/**
 * A store code from its name: uppercase, non-alphanumerics collapsed to a
 * hyphen, at most 20 characters and never ending in one (the storeCode
 * rule in packages/schemas/src/store.ts).
 */
export function codeOf(name: string): string {
  return name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '-')
    .slice(0, 20)
    .replace(/^-+|-+$/g, '');
}

/** Codes are compared the way the server stores them: uppercased. */
export function storeCodesUnique(codes: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const code of codes) {
    const key = code.trim().toUpperCase();
    if (key === '') continue;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export interface StoreDraft {
  name: string;
  code: string;
  province: ProvinceCAT;
  city: string;
  timezone: string;
}

export interface TenantDraft {
  display_name: string;
  legal_name: string;
  slug: string;
  province: ProvinceCAT;
  default_locale: 'fr-CA' | 'en-CA';
  plan_id: string;
  owner_name: string;
  owner_email: string;
  stores: StoreDraft[];
}

export function emptyStore(province: ProvinceCAT): StoreDraft {
  return { name: '', code: '', province, city: '', timezone: timezoneFor(province) };
}

export function emptyDraft(): TenantDraft {
  return {
    display_name: '',
    legal_name: '',
    slug: '',
    province: 'QC',
    default_locale: 'fr-CA',
    plan_id: '',
    owner_name: '',
    owner_email: '',
    stores: [emptyStore('QC')],
  };
}

/** The wire body: trimmed, codes uppercased, empty cities dropped, order kept. */
export function draftToBody(draft: TenantDraft) {
  return {
    legal_name: draft.legal_name.trim(),
    display_name: draft.display_name.trim(),
    slug: draft.slug.trim(),
    province: draft.province,
    default_locale: draft.default_locale,
    plan_id: draft.plan_id,
    owner_email: draft.owner_email.trim(),
    owner_name: draft.owner_name.trim(),
    stores: draft.stores.map((s) => ({
      name: s.name.trim(),
      code: s.code.trim().toUpperCase(),
      province: s.province,
      timezone: s.timezone.trim(),
      ...(s.city.trim() ? { city: s.city.trim() } : {}),
    })),
  };
}
