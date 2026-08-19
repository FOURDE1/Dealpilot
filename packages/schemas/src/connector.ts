import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';
import { ConsentChannel, ConsentScope, ConsentType } from './compliance.js';
import { LeadSource } from './lead.js';

/**
 * F-49 — tenant connectors (FR-LEAD-019, D-053). A connector is CONFIG: the
 * provider's field names mapped onto the canonical envelope, plus the CASL
 * basis of that form's consent box. Mirrors core's CANONICAL_FIELDS —
 * lockstep-tested, never imported.
 */

export const ConnectorField = z.enum([
  'first_name',
  'last_name',
  'email',
  'phone',
  'vehicle_interest',
  'preferred_language',
  'comments',
]);

export const ConnectorType = z.enum(['json_webhook', 'adf_xml']);

/** What a ticked box on THIS form actually granted — a fact about the form. */
export const ConnectorConsent = z.strictObject({
  checkbox_path: z.string().trim().min(1).max(200).optional(),
  wording_path: z.string().trim().min(1).max(200).optional(),
  grants: z.strictObject({
    consent_type: ConsentType,
    channels: z.array(ConsentChannel).min(1).max(5),
    scopes: z.array(ConsentScope).min(1).max(3),
  }),
});

// partialRecord, not record: Zod 4's record(enum, …) demands EVERY key.
const FieldMap = z
  .partialRecord(ConnectorField, z.array(z.string().trim().min(1).max(200)).min(1).max(5))
  .default({});

export const TenantConnector = z.object({
  id: Uuid,
  organization_id: Uuid,
  source_key: z.string(),
  label: z.string(),
  type: ConnectorType,
  default_source: LeadSource,
  field_map: z.record(z.string(), z.array(z.string())),
  consent: ConnectorConsent.nullable(),
  dedupe_fields: z.array(z.string()),
  is_active: z.boolean(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const CreateConnectorInput = z.strictObject({
  organization_id: Uuid,
  source_key: z
    .string()
    .regex(/^[a-z0-9_]{2,40}$/, 'lowercase letters, digits and underscores, 2-40 chars'),
  label: z.string().trim().min(1).max(120),
  type: ConnectorType.default('json_webhook'),
  default_source: LeadSource,
  field_map: FieldMap,
  consent: ConnectorConsent.optional(),
  dedupe_fields: z.array(ConnectorField).max(4).default(['phone', 'email']),
});

export const UpdateConnectorInput = z
  .strictObject({
    label: z.string().trim().min(1).max(120).optional(),
    default_source: LeadSource.optional(),
    field_map: FieldMap.optional(),
    consent: ConnectorConsent.nullable().optional(),
    dedupe_fields: z.array(ConnectorField).max(4).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export const ConnectorListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
});

export type TenantConnectorT = z.infer<typeof TenantConnector>;
export type CreateConnectorInputT = z.infer<typeof CreateConnectorInput>;
export type UpdateConnectorInputT = z.infer<typeof UpdateConnectorInput>;
