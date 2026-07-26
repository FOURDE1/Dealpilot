/**
 * F-13 — which documents a deal needs (documents.md §2/§3).
 *
 * Pure, so the rule can be reasoned about and tested without a database, the
 * same treatment the money engine and the dispatch rules get. Getting this
 * wrong is a compliance problem rather than a clerical one: a missing OMVIC
 * disclosure on an Ontario deal, or a lien payoff authorization that nobody
 * put in the file, is the kind of thing that surfaces months later.
 */

export type DocumentType =
  | 'bank_contract' | 'bill_of_sale' | 'warranty_agreement' | 'gap_agreement'
  | 'aftermarket_agreement' | 'privacy_consent' | 'omvic_disclosure'
  | 'vehicle_condition' | 'trade_in_lien_authorization' | 'odometer_statement'
  | 'as_is_waiver' | 'carfax_report' | 'lease_agreement';

export type SourceSystem = 'dealertrack' | 'cams' | 'merlin' | 'internal' | 'carfax';

export interface DealShape {
  dealType: 'cash' | 'finance' | 'lease';
  province: string;
  tradeLienCents: number;
  soldAsIs: boolean;
  /** Undefined when no vehicle is attached yet. */
  vehicleType?: 'new' | 'used' | undefined;
  /** Which system this store's bill of sale comes from. */
  billOfSaleSystem: 'CAMS' | 'Merlin' | 'Other';
  /** F&I products sold on the deal, if any. */
  fiProducts?: readonly { kind: 'warranty' | 'gap' | 'aftermarket'; name: string }[];
}

export interface RequiredDocument {
  type: DocumentType;
  name: string;
  source: SourceSystem;
  /** False only for information-only documents — nobody signs a Carfax. */
  requiresSignature: boolean;
  sortOrder: number;
}

/**
 * The exact rule from §3. Order matters: `sortOrder` is the order a driver
 * hands the file over, so the bill of sale leads and the information-only
 * documents trail.
 */
export function requiredDocuments(deal: DealShape): RequiredDocument[] {
  const bosSource: SourceSystem =
    deal.billOfSaleSystem === 'Merlin' ? 'merlin' : deal.billOfSaleSystem === 'CAMS' ? 'cams' : 'internal';

  const docs: RequiredDocument[] = [
    { type: 'bill_of_sale', name: 'Bill of sale', source: bosSource, requiresSignature: true, sortOrder: 10 },
    { type: 'privacy_consent', name: 'Privacy consent', source: 'internal', requiresSignature: true, sortOrder: 20 },
    { type: 'vehicle_condition', name: 'Vehicle condition disclosure', source: 'internal', requiresSignature: true, sortOrder: 30 },
    { type: 'odometer_statement', name: 'Odometer statement', source: 'internal', requiresSignature: true, sortOrder: 40 },
  ];

  // A financed deal has a lender contract; a cash deal does not.
  if (deal.dealType === 'finance') {
    docs.push({ type: 'bank_contract', name: 'Bank contract', source: 'dealertrack', requiresSignature: true, sortOrder: 5 });
  }
  if (deal.dealType === 'lease') {
    docs.push({ type: 'lease_agreement', name: 'Lease agreement', source: 'dealertrack', requiresSignature: true, sortOrder: 6 });
  }

  // Ontario's regulator requires its own disclosure.
  if (deal.province === 'ON') {
    docs.push({ type: 'omvic_disclosure', name: 'OMVIC disclosure', source: 'internal', requiresSignature: true, sortOrder: 50 });
  }

  // Somebody else is owed money on the trade, and they must be paid from the
  // proceeds. Without this authorization the payoff cannot be made.
  if (deal.tradeLienCents > 0) {
    docs.push({
      type: 'trade_in_lien_authorization', name: 'Trade-in lien payoff authorization',
      source: 'internal', requiresSignature: true, sortOrder: 60,
    });
  }

  // documents.md §3 pairs this with a safety-inspection exemption
  // (delivery.md §2.2). That exemption is NOT implemented, because the owner's
  // instruction is that the safety inspection can never be waived — the two
  // rules contradict each other and choosing is his call (D-036). So this adds
  // the disclosure to the file and changes nothing about safety.
  if (deal.soldAsIs) {
    docs.push({ type: 'as_is_waiver', name: 'As-is waiver', source: 'internal', requiresSignature: true, sortOrder: 70 });
  }

  // Information only: it belongs in the file, but nobody signs a history report.
  if (deal.vehicleType === 'used') {
    docs.push({ type: 'carfax_report', name: 'Carfax report', source: 'carfax', requiresSignature: false, sortOrder: 90 });
  }

  // One agreement per F&I product sold, named after the product so a filing
  // clerk can tell two aftermarket agreements apart.
  for (const [i, product] of (deal.fiProducts ?? []).entries()) {
    const type: DocumentType =
      product.kind === 'warranty' ? 'warranty_agreement'
      : product.kind === 'gap' ? 'gap_agreement'
      : 'aftermarket_agreement';
    docs.push({
      type,
      name: `${product.kind === 'gap' ? 'GAP agreement' : product.kind === 'warranty' ? 'Extended warranty agreement' : 'Aftermarket product agreement'} — ${product.name}`,
      source: 'internal',
      requiresSignature: true,
      sortOrder: 80 + i,
    });
  }

  return docs.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * The lifecycle from §4. A document moves forward or it does not move.
 *
 * The table depends on `requiresSignature`, and that is the whole point: the
 * shortcut `in_file → filed` exists for the Carfax path only. Allowing it for a
 * signature document let a bank contract reach `filed` — and count as complete —
 * with `signed_at_delivery` NULL. The record would say a customer signed
 * something nobody watched them sign.
 */
const SIGNATURE_TRANSITIONS: Record<string, readonly string[]> = {
  not_ready: ['generated'],
  // E-signing is optional: a store may print and collect wet ink instead.
  generated: ['e_signed', 'printed'],
  e_signed: ['printed', 'in_file'],
  printed: ['in_file'],
  in_file: ['signed'],
  signed: ['filed'],
  filed: [],
};

/** Information only — nobody signs a history report. */
const INFO_TRANSITIONS: Record<string, readonly string[]> = {
  not_ready: ['generated'],
  generated: ['in_file'],
  in_file: ['filed'],
  filed: [],
};

export const DOCUMENT_TRANSITIONS = SIGNATURE_TRANSITIONS;

export function canAdvanceDocument(from: string, to: string, requiresSignature = true): boolean {
  const table = requiresSignature ? SIGNATURE_TRANSITIONS : INFO_TRANSITIONS;
  return (table[from] ?? []).includes(to);
}

/**
 * Is the file READY TO TRAVEL (§6)? Every signature document printed or later.
 *
 * This — not completion — is what dispatch needs. `signed` means "signed at
 * delivery", so gating the trip on it would demand an outcome that can only
 * exist after the trip.
 */
export function wetInkPrepared(
  docs: readonly { requiresSignature: boolean; status: string }[],
): boolean | null {
  if (docs.length === 0) return null;
  return docs.every((d) =>
    d.requiresSignature
      ? ['e_signed', 'printed', 'in_file', 'signed', 'filed'].includes(d.status)
      : ['generated', 'in_file', 'filed'].includes(d.status));
}

/**
 * Is the file COMPLETE — everything signed and back? The after-delivery
 * question. Mirrors the SQL in migration 0024 so the same question has the same
 * answer in both places.
 */
export function wetInkComplete(
  docs: readonly { requiresSignature: boolean; status: string }[],
): boolean | null {
  if (docs.length === 0) return null; // no documents = not applicable
  return docs.every((d) =>
    d.requiresSignature
      ? d.status === 'signed' || d.status === 'filed'
      : d.status === 'in_file' || d.status === 'filed');
}
