import type { DealDocumentT } from '@dealpilot/schemas';

/** i18n keys for the 13 document types (documents.md §2). */
export const DOCUMENT_TYPE_KEYS = {
  bank_contract: 'type_bank_contract',
  bill_of_sale: 'type_bill_of_sale',
  warranty_agreement: 'type_warranty_agreement',
  gap_agreement: 'type_gap_agreement',
  aftermarket_agreement: 'type_aftermarket_agreement',
  privacy_consent: 'type_privacy_consent',
  omvic_disclosure: 'type_omvic_disclosure',
  vehicle_condition: 'type_vehicle_condition',
  trade_in_lien_authorization: 'type_trade_in_lien_authorization',
  odometer_statement: 'type_odometer_statement',
  as_is_waiver: 'type_as_is_waiver',
  carfax_report: 'type_carfax_report',
  lease_agreement: 'type_lease_agreement',
} as const satisfies Record<DealDocumentT['document_type'], string>;

/** i18n keys for the 7-status lifecycle (§4). */
export const DOCUMENT_STATUS_KEYS = {
  not_ready: 'status_not_ready',
  generated: 'status_generated',
  e_signed: 'status_e_signed',
  printed: 'status_printed',
  in_file: 'status_in_file',
  signed: 'status_signed',
  filed: 'status_filed',
} as const satisfies Record<DealDocumentT['status'], string>;

type DocStatus = DealDocumentT['status'];

/** Action-button labels: what MOVING a document to this status is called. */
export const DOCUMENT_ACTION_KEYS = {
  not_ready: 'act_not_ready',
  generated: 'act_generated',
  e_signed: 'act_e_signed',
  printed: 'act_printed',
  in_file: 'act_in_file',
  signed: 'act_signed',
  filed: 'act_filed',
} as const satisfies Record<DocStatus, string>;

/**
 * Mirror of packages/core DOCUMENT_TRANSITIONS — forward only, and the
 * `in_file → filed` shortcut exists for information-only documents alone
 * (a bank contract must be SIGNED before it is filed; a Carfax is never signed).
 */
const SIGNATURE_NEXT: Record<DocStatus, readonly DocStatus[]> = {
  not_ready: ['generated'],
  generated: ['e_signed', 'printed'],
  e_signed: ['printed', 'in_file'],
  printed: ['in_file'],
  in_file: ['signed'],
  signed: ['filed'],
  filed: [],
};

const INFO_NEXT: Record<DocStatus, readonly DocStatus[]> = {
  not_ready: ['generated'],
  generated: ['in_file'],
  in_file: ['filed'],
  filed: [],
  e_signed: [],
  printed: [],
  signed: [],
};

export function nextDocumentStatuses(doc: Pick<DealDocumentT, 'status' | 'requires_signature'>): readonly DocStatus[] {
  return (doc.requires_signature ? SIGNATURE_NEXT : INFO_NEXT)[doc.status];
}

/**
 * Mirror of the server's permission grading: recording a SIGNATURE
 * (e-sign, signed at delivery, filing the signed copy) is `document:sign`;
 * printing and assembling is `document:prepare`.
 */
export function isSigningMove(to: DocStatus): boolean {
  return to === 'e_signed' || to === 'signed' || to === 'filed';
}

/** Mirror of core wetInkPrepared, per document: is THIS paper ready to travel? */
export function docPrepared(d: Pick<DealDocumentT, 'requires_signature' | 'status'>): boolean {
  return d.requires_signature
    ? ['e_signed', 'printed', 'in_file', 'signed', 'filed'].includes(d.status)
    : ['generated', 'in_file', 'filed'].includes(d.status);
}

/**
 * A deal can carry several per-product agreements (F-13b), and the server
 * names each after its product so a clerk can tell two apart. For those, the
 * stored name IS the distinguisher — a translated type label would render
 * every one identically.
 */
const PER_PRODUCT_TYPES: ReadonlySet<DealDocumentT['document_type']> = new Set([
  'warranty_agreement', 'gap_agreement', 'aftermarket_agreement',
]);

export function documentDisplayName(
  doc: Pick<DealDocumentT, 'document_type' | 'document_name'>,
  translate: (key: (typeof DOCUMENT_TYPE_KEYS)[keyof typeof DOCUMENT_TYPE_KEYS]) => string,
): string {
  return PER_PRODUCT_TYPES.has(doc.document_type)
    ? doc.document_name
    : translate(DOCUMENT_TYPE_KEYS[doc.document_type]);
}
