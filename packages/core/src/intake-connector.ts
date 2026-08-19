import type { Channel, ConsentType, NewConsentRow, Scope } from './compliance-consent.js';
import { consentExpiryFor } from './compliance-consent.js';
import { ADF_CONNECTOR } from './intake-adf.js';

/**
 * The intake connector framework (ADR-005, amended 2026-07-23).
 *
 * The amendment is the whole design: "all known lead sources ship as connector
 * definitions, and any new source — JSON webhook, ADF/XML email, or API polling
 * — is added by CONFIGURATION, not code."
 *
 * That matters because lead sources are the part of this product that changes
 * without warning. A dealership signs up with a new listing site on Tuesday and
 * wants the leads flowing on Wednesday; if that needs a deployment, it does not
 * happen. So a connector is data — field paths, a source name, what the consent
 * checkbox on that form actually granted — and this module is the one piece of
 * code that reads it.
 *
 * Pure: no database, no clock of its own, no network. The caller supplies the
 * instant, so a lead that arrives at 23:59:59 is normalised against the time it
 * arrived rather than the time a worker got to it.
 */

/** The fields every source is mapped ONTO, whatever it calls them. */
export const CANONICAL_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'vehicle_interest',
  'preferred_language',
  'comments',
] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export interface ConsentMapping {
  /** Where the "yes, contact me" box lives in this provider's payload. */
  readonly checkboxPath?: string;
  /** Where the exact wording shown to the customer lives, if the provider sends it. */
  readonly wordingPath?: string;
  /**
   * What a ticked box on THIS form actually granted.
   *
   * Per-connector because it is a fact about that form, not about us: a site
   * whose checkbox says "send me offers" granted marketing, and one that says
   * "contact me about this vehicle" did not, and no amount of wanting the second
   * to be the first makes it so.
   */
  readonly grants: {
    readonly consentType: ConsentType;
    readonly channels: readonly Channel[];
    readonly scopes: readonly Scope[];
  };
}

export interface ConnectorDefinition {
  readonly key: string;
  readonly label: string;
  /** What `leads.source` becomes for this connector. */
  readonly source: string;
  /**
   * Canonical field → one or more paths in the provider payload. The first path
   * that yields a non-empty value wins, so a provider that renamed a field can
   * be supported by adding the new name in front of the old one — no migration,
   * no redeploy, and old payloads keep working.
   */
  readonly fieldMap: Partial<Record<CanonicalField, readonly string[]>>;
  readonly consent?: ConsentMapping;
  /** Which canonical fields identify "the same enquiry arriving twice". */
  readonly dedupeFields: readonly CanonicalField[];
}

/** Read `a.b.c` or `a.b[0].c` out of an arbitrary parsed payload. */
export function readPath(payload: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = payload;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function firstNonEmpty(payload: unknown, paths: readonly string[] | undefined): string | null {
  for (const p of paths ?? []) {
    const v = readPath(payload, p);
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s.length > 0) return s;
  }
  return null;
}

/**
 * A North American number in the one form the database accepts.
 *
 * Lead providers send `(514) 555-0100`, `514-555-0100`, `1 514 555 0100` and
 * `+1 (514) 555-0100` for the same person. Storing them as sent would make the
 * suppression list, the consent ledger and the do-not-call list all miss —
 * every one of them keys on the number, and a customer who said STOP from a
 * differently-formatted copy of their own number would keep being messaged.
 *
 * Returns null rather than guessing on anything that is not clearly a Canadian
 * or US ten-digit number. A wrong number is worse than a missing one: it is
 * somebody else's phone.
 */
export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  // NANP: area code and exchange both start 2–9. Anything else is a typo or a
  // placeholder like 000-000-0000, and dialling it reaches somebody unrelated.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

/** Quebec-first: an unrecognised or absent preference means French. */
export function normalizeLanguage(raw: string | null): 'fr-CA' | 'en-CA' {
  const v = (raw ?? '').toLowerCase();
  if (v.startsWith('en')) return 'en-CA';
  return 'fr-CA';
}

export interface NormalizedLead {
  readonly source: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly vehicle_interest: string | null;
  readonly preferred_language: 'fr-CA' | 'en-CA';
  /** Free text the customer typed. Untrusted — spotlight it before any model. */
  readonly comments: string | null;
}

export interface NormalizeResult {
  readonly lead: NormalizedLead;
  /** The consent this submission actually granted, or none. */
  readonly consent: readonly NewConsentRow[];
  /**
   * Stable key for "this same enquiry arrived twice".
   *
   * Deterministic and derived only from the mapped fields, so a provider that
   * retries a webhook — which they all do — does not create a second lead and a
   * second first-touch text to the same person.
   */
  readonly dedupeKey: string;
  /** Things a human should know, without failing the intake over them. */
  readonly warnings: readonly string[];
}

/** Truthy in the shapes providers actually send for a ticked box. */
function isTicked(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return ['true', 'yes', 'y', '1', 'on', 'oui'].includes(v.trim().toLowerCase());
  return false;
}

/**
 * Turn one provider payload into a lead, its consent, and a dedupe key.
 *
 * Never throws on a bad payload: an intake endpoint that 500s on a field a
 * provider renamed loses leads silently and blames the provider. Missing data
 * becomes a warning and a null, and the one field that genuinely cannot be
 * missing — the phone number — is reported as a warning the caller decides
 * about, because some sources are email-only.
 */
export function normalizeLead(
  payload: unknown,
  def: ConnectorDefinition,
  at: Date,
): NormalizeResult {
  const warnings: string[] = [];
  const raw = (f: CanonicalField) => firstNonEmpty(payload, def.fieldMap[f]);

  const rawPhone = raw('phone');
  const phone = normalizePhone(rawPhone);
  if (rawPhone && !phone) {
    // Named, not silently dropped: "we received a number we could not read" is
    // something a dealership can act on; a blank field is not.
    warnings.push(`phone could not be read as a Canadian number: ${rawPhone}`);
  }
  if (!rawPhone) warnings.push('no phone number in the payload');

  const email = raw('email');
  const lead: NormalizedLead = {
    source: def.source,
    first_name: raw('first_name'),
    last_name: raw('last_name'),
    email: email ? email.toLowerCase() : null,
    phone,
    vehicle_interest: raw('vehicle_interest'),
    preferred_language: normalizeLanguage(raw('preferred_language')),
    comments: raw('comments'),
  };

  const consent = buildConsent(payload, def, lead, at, warnings);

  const dedupeKey = def.dedupeFields
    .map((f) => String(lead[f as keyof NormalizedLead] ?? '').toLowerCase().trim())
    .join('|');

  return { lead, consent, dedupeKey, warnings };
}

function buildConsent(
  payload: unknown,
  def: ConnectorDefinition,
  lead: NormalizedLead,
  at: Date,
  warnings: string[],
): readonly NewConsentRow[] {
  if (!def.consent) return [];
  const mapping = def.consent;

  // A form WITH a consent box that was not ticked granted nothing. This is the
  // difference between a lead you may text and one you may only wait for, and
  // treating an unticked box as consent is the single most expensive mistake
  // available in this file.
  if (mapping.checkboxPath) {
    const ticked = isTicked(readPath(payload, mapping.checkboxPath));
    if (!ticked) {
      warnings.push('the consent box on this form was not ticked — no basis recorded');
      return [];
    }
  }

  const wording = mapping.wordingPath ? firstNonEmpty(payload, [mapping.wordingPath]) : null;
  if (!wording) {
    // The wording IS the evidence. Without it we can say somebody agreed but not
    // to what, which is exactly the question a regulator asks.
    warnings.push('the form did not send the consent wording — evidence will be thin');
  }

  const rows: NewConsentRow[] = [];
  for (const channel of mapping.grants.channels) {
    // Do not record a basis on a channel we have no address for: an SMS consent
    // with no phone number is a row no gate can ever find.
    if ((channel === 'sms' || channel === 'mms' || channel === 'voice') && !lead.phone) continue;
    if (channel === 'email' && !lead.email) continue;

    for (const scope of mapping.grants.scopes) {
      rows.push({
        channel,
        scope,
        consentType: mapping.grants.consentType,
        grantedAt: at,
        expiresAt: consentExpiryFor(mapping.grants.consentType, at),
        source: 'webhook_inquiry',
        evidence: {
          connector: def.key,
          form_wording: wording,
          checkbox_path: mapping.checkboxPath ?? null,
          received_at: at.toISOString(),
        },
      });
    }
  }
  return rows;
}

/**
 * The connectors that ship in the box.
 *
 * Definitions, not code paths. A new site is a new entry — or, once the admin
 * console can write them, a row somebody adds without an engineer.
 */
export const BUILT_IN_CONNECTORS: readonly ConnectorDefinition[] = [
  // FR-LEAD-004: defined in intake-adf.ts beside its parser. The import is
  // runtime-acyclic — intake-adf takes only a TYPE from this module.
  ADF_CONNECTOR,
  {
    key: 'website_form',
    label: 'Dealership website form',
    source: 'website',
    fieldMap: {
      first_name: ['first_name', 'firstName', 'fname', 'name.first'],
      last_name: ['last_name', 'lastName', 'lname', 'name.last'],
      email: ['email', 'email_address', 'contact.email'],
      phone: ['phone', 'phone_number', 'telephone', 'contact.phone'],
      vehicle_interest: ['vehicle', 'vehicle_interest', 'vehicle_of_interest', 'subject'],
      preferred_language: ['language', 'lang', 'preferred_language'],
      comments: ['message', 'comments', 'question'],
    },
    consent: {
      checkboxPath: 'consent',
      wordingPath: 'consent_text',
      // An enquiry through a dealership's own form is an enquiry: six months,
      // about what they asked, and nothing more.
      grants: {
        consentType: 'implied_inquiry',
        channels: ['sms', 'email'],
        scopes: ['conversational'],
      },
    },
    dedupeFields: ['phone', 'email', 'vehicle_interest'],
  },
  {
    key: 'meta_lead_ads',
    label: 'Meta Lead Ads',
    source: 'meta',
    fieldMap: {
      first_name: ['field_data.first_name', 'first_name'],
      last_name: ['field_data.last_name', 'last_name'],
      email: ['field_data.email', 'email'],
      phone: ['field_data.phone_number', 'phone_number'],
      vehicle_interest: ['field_data.vehicle', 'ad_name'],
      preferred_language: ['field_data.language', 'locale'],
      comments: ['field_data.comments'],
    },
    consent: {
      // Meta's own form carries the advertiser's consent wording; the submission
      // itself is the tick, so there is no separate box to check.
      wordingPath: 'privacy_policy_text',
      grants: {
        consentType: 'implied_inquiry',
        channels: ['sms', 'email'],
        scopes: ['conversational'],
      },
    },
    dedupeFields: ['phone', 'email'],
  },
];

export function findConnector(key: string): ConnectorDefinition | null {
  return BUILT_IN_CONNECTORS.find((c) => c.key === key) ?? null;
}
