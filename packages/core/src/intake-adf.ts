import { XMLParser } from 'fast-xml-parser';
import type { ConnectorDefinition } from './intake-connector.js';

/**
 * ADF/XML lead parsing (ADR-005; conversation-engine intake §).
 *
 * ADF is how AutoTrader.ca and Kijiji Autos deliver leads — an XML document,
 * usually by email. It is a twenty-year-old format and every provider bends it
 * slightly, so this module's job is to turn any of those bends into the flat
 * shape the connector field-map already understands, rather than to be a strict
 * ADF validator. A lead we refuse to parse is a customer nobody calls.
 *
 * The parser is configured defensively. ADF arrives from outside, unsigned, and
 * is exactly the kind of input that carries an XML attack rather than a lead.
 */

/**
 * Parser settings, each chosen against a specific way XML is used as a weapon.
 *
 * `processEntities: false` is the important one: it disables entity expansion,
 * which is what "billion laughs" uses to turn a few kilobytes into gigabytes of
 * memory. fast-xml-parser does not resolve EXTERNAL entities at all, so classic
 * XXE file disclosure is not reachable here — but entity expansion is, and
 * turning it off costs nothing because ADF leads do not use entities.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  processEntities: false,
  parseTagValue: false, // keep "0514" a string, not the number 514
  parseAttributeValue: false,
  trimValues: true,
});

/** Bound on the document itself, before it ever reaches the parser. */
export const MAX_ADF_BYTES = 256 * 1024;

export interface AdfLead {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  vehicle_interest: string | null;
  comments: string | null;
  provider: string | null;
  requested_at: string | null;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    // fast-xml-parser gives `{ '#text': 'x', '@part': 'first' }` for an element
    // that has both attributes and content.
    const t = (v as Record<string, unknown>)['#text'];
    return t === undefined ? null : String(t).trim() || null;
  }
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * The customer's name, which ADF splits across repeated elements.
 *
 * `<name part="first">Marie</name><name part="last">Tremblay</name>` is the
 * spec's shape, but plenty of providers send a single `<name>Marie Tremblay</name>`.
 * Both are common enough that handling only the first would drop real leads.
 */
function readName(contact: Record<string, unknown>): { first: string | null; last: string | null } {
  const names = asArray(contact['name'] as unknown);
  let first: string | null = null;
  let last: string | null = null;
  let whole: string | null = null;

  for (const n of names) {
    const part = typeof n === 'object' && n !== null ? String((n as Record<string, unknown>)['@part'] ?? '') : '';
    const value = text(n);
    if (!value) continue;
    if (part === 'first') first = value;
    else if (part === 'last') last = value;
    else if (!whole) whole = value;
  }

  if (!first && !last && whole) {
    const bits = whole.split(/\s+/);
    first = bits[0] ?? null;
    last = bits.length > 1 ? bits.slice(1).join(' ') : null;
  }
  return { first, last };
}

/**
 * The best phone number in the document.
 *
 * ADF allows several, tagged by type. A mobile is worth more than a work number
 * for a product whose first move is a text message, so preference is explicit
 * rather than "whichever appeared first in the XML".
 */
function readPhone(contact: Record<string, unknown>): string | null {
  const phones = asArray(contact['phone'] as unknown);
  const byType = new Map<string, string>();
  for (const p of phones) {
    const value = text(p);
    if (!value) continue;
    const type =
      typeof p === 'object' && p !== null
        ? String((p as Record<string, unknown>)['@type'] ?? '').toLowerCase()
        : '';
    if (!byType.has(type)) byType.set(type, value);
  }
  for (const preferred of ['cellphone', 'mobile', 'voice', '']) {
    const hit = byType.get(preferred);
    if (hit) return hit;
  }
  return [...byType.values()][0] ?? null;
}

function readVehicle(prospect: Record<string, unknown>): string | null {
  const vehicles = asArray(prospect['vehicle'] as unknown);
  // `interest="buy"` is the one they want; a trade-in is also listed here and is
  // emphatically not what they are enquiring about.
  const wanted =
    vehicles.find(
      (v) =>
        typeof v === 'object' &&
        v !== null &&
        String((v as Record<string, unknown>)['@interest'] ?? 'buy').toLowerCase() === 'buy',
    ) ?? vehicles[0];
  if (!wanted || typeof wanted !== 'object') return null;
  const v = wanted as Record<string, unknown>;
  const parts = [text(v['year']), text(v['make']), text(v['model']), text(v['trim'])].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

export class AdfParseError extends Error {}

/**
 * Turn an ADF document into the flat shape the connector field-map reads.
 *
 * Throws only when the document is not ADF at all. Anything that IS ADF but is
 * missing pieces comes back with nulls, because a lead with no email is still a
 * lead and refusing it helps nobody.
 */
export function parseAdf(xml: string): AdfLead {
  if (xml.length > MAX_ADF_BYTES) {
    throw new AdfParseError(`ADF document is ${xml.length} bytes; the limit is ${MAX_ADF_BYTES}`);
  }

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new AdfParseError(`not parseable as XML: ${(e as Error).message}`);
  }

  const adf = (doc['adf'] ?? doc) as Record<string, unknown>;
  const prospect = asArray(adf['prospect'] as unknown)[0] as Record<string, unknown> | undefined;
  if (!prospect || typeof prospect !== 'object') {
    throw new AdfParseError('no <prospect> element — this is not an ADF lead');
  }

  const customer = (prospect['customer'] ?? {}) as Record<string, unknown>;
  const contact = (customer['contact'] ?? {}) as Record<string, unknown>;
  const { first, last } = readName(contact);
  const providerBlock = (prospect['provider'] ?? {}) as Record<string, unknown>;

  return {
    first_name: first,
    last_name: last,
    email: text(contact['email']),
    phone: readPhone(contact),
    vehicle_interest: readVehicle(prospect),
    // Free text the customer typed. UNTRUSTED — §11 names ADF comments as an
    // injection vector by name, so this must be spotlighted before it reaches
    // any model.
    comments: text(customer['comments']) ?? text(prospect['comments']),
    provider: text(providerBlock['name']) ?? text(providerBlock['service']),
    requested_at: text(prospect['requestdate']),
  };
}

/**
 * The ADF connector definition.
 *
 * `parseAdf` has already flattened the document, so the field map is trivial —
 * which is the point. A new ADF provider with slightly different element names
 * is a definition change, not a parser change.
 */
export const ADF_CONNECTOR: ConnectorDefinition = {
  key: 'adf_xml',
  label: 'ADF/XML (AutoTrader.ca, Kijiji Autos)',
  source: 'autotrader',
  fieldMap: {
    first_name: ['first_name'],
    last_name: ['last_name'],
    email: ['email'],
    phone: ['phone'],
    vehicle_interest: ['vehicle_interest'],
    comments: ['comments'],
  },
  // NO consent mapping, deliberately.
  //
  // An ADF lead carries no consent evidence: the listing site collected whatever
  // it collected under its own terms, and we did not see the wording, the box, or
  // the moment. Treating a syndicated lead as consent would be inventing a
  // record — and the implied-inquiry basis these leads DO have is a decision
  // about the source, which belongs with the owner (D-042) rather than here.
  dedupeFields: ['phone', 'email', 'vehicle_interest'],
};
