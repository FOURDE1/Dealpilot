import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * F-13 deal documents (documents.md §2/§4). Thirteen types, seven statuses,
 * one vocabulary (ADR-009).
 */
export const DocumentType = z.enum([
  'bank_contract', 'bill_of_sale', 'warranty_agreement', 'gap_agreement',
  'aftermarket_agreement', 'privacy_consent', 'omvic_disclosure',
  'vehicle_condition', 'trade_in_lien_authorization', 'odometer_statement',
  'as_is_waiver', 'carfax_report', 'lease_agreement',
]);

export const SourceSystem = z.enum(['dealertrack', 'cams', 'merlin', 'internal', 'carfax']);

/** The Carfax path skips signing: not_ready → generated → in_file → filed. */
export const DocumentStatus = z.enum([
  'not_ready', 'generated', 'e_signed', 'printed', 'in_file', 'signed', 'filed',
]);

export const EsignPlatform = z.enum(['onespan', 'docusign']);

export const DealDocument = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  deal_id: Uuid,
  document_type: DocumentType,
  document_name: z.string(),
  source_system: SourceSystem,
  status: DocumentStatus,
  /** False for information-only documents — nobody signs a Carfax. */
  requires_signature: z.boolean(),
  esign_platform: EsignPlatform.nullable(),
  esign_envelope_id: z.string().nullable(),
  esign_sent_at: IsoDateTime.nullable(),
  esign_signed_at: IsoDateTime.nullable(),
  printed_at: IsoDateTime.nullable(),
  printed_by: Uuid.nullable(),
  signed_at_delivery: IsoDateTime.nullable(),
  filed_at: IsoDateTime.nullable(),
  filed_by: Uuid.nullable(),
  unsigned_file_url: z.string().nullable(),
  signed_file_url: z.string().nullable(),
  notes: z.string().nullable(),
  sort_order: z.number().int(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/** Defaults-free (the F-05 lesson): a PATCH carries only what it changes. */
export const UpdateDocumentInput = z
  .strictObject({
    status: DocumentStatus.optional(),
    notes: z.string().trim().min(1).max(1000).nullable().optional(),
    esign_platform: EsignPlatform.nullable().optional(),
    esign_envelope_id: z.string().trim().min(1).max(200).nullable().optional(),
    unsigned_file_url: z.string().trim().min(1).max(500).nullable().optional(),
    signed_file_url: z.string().trim().min(1).max(500).nullable().optional(),
  })
  // An empty body changes nothing; answering 200 to it is a lie (the F-08 lesson).
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Nothing to change',
    path: ['status'],
  });

export const DocumentListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  deal_id: Uuid.optional(),
  status: DocumentStatus.optional(),
  document_type: DocumentType.optional(),
});

/** The deal's file, plus whether it is actually complete. */
export const DealDocumentsResponse = z.object({
  items: z.array(DealDocument),
  /**
   * READY TO TRAVEL: every signature document printed or later (§6). This is
   * what dispatch gates on. null = this deal has no document list (predates F-13).
   */
  wet_ink_prepared: z.boolean().nullable(),
  /** Everything signed and back — the after-delivery question. */
  wet_ink_complete: z.boolean().nullable(),
});

export type DealDocumentT = z.infer<typeof DealDocument>;
