import { z } from 'zod';
import { CursorQuery, IsoDateTime, Locale, MESSAGE_KEYS, PhoneE164, PostalCodeCA, ProvinceCA, Uuid, withKey } from './common.js';

export const StoreStatus = z.enum(['active', 'paused', 'closed']);

const storeName = z.string().trim().min(1).max(200);
/** Short stable identifier, UNIQUE per tenant, normalized uppercase (e.g. `KIA-ML`). */
const storeCode = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(2)
      .max(20)
      .refine((v) => /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(v), withKey(MESSAGE_KEYS.store_code_format)),
  );

export const Store = z.object({
  id: Uuid,
  organization_id: Uuid,
  name: storeName,
  code: storeCode,
  phone: PhoneE164.nullable(),
  address_line1: z.string().trim().max(200).nullable(),
  city: z.string().trim().max(100).nullable(),
  province: ProvinceCA,
  postal_code: PostalCodeCA.nullable(),
  default_locale: Locale,
  /** Quiet-hours + drip scheduling are tenant-local (multi-tenancy.md §3). */
  timezone: z.string().min(1),
  status: StoreStatus,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
});

export const CreateStoreInput = z.strictObject({
  organization_id: Uuid,
  name: storeName,
  code: storeCode,
  phone: PhoneE164.optional(),
  address_line1: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  province: ProvinceCA,
  postal_code: PostalCodeCA.optional(),
  default_locale: Locale.default('fr-CA'),
  timezone: z.string().min(1).default('America/Montreal'),
  status: StoreStatus.default('active'),
});

export const UpdateStoreInput = z.strictObject({
  name: storeName.optional(),
  code: storeCode.optional(),
  phone: PhoneE164.nullable().optional(),
  address_line1: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  province: ProvinceCA.optional(),
  postal_code: PostalCodeCA.nullable().optional(),
  default_locale: Locale.optional(),
  timezone: z.string().min(1).optional(),
  status: StoreStatus.optional(),
});

/**
 * Store list is org-scoped (F-01). `organization_id` is a SELECTOR the server
 * verifies against the caller's memberships — never an authority claim
 * (api-design.md §1). Optional: with exactly one org it defaults to it.
 */
export const StoreListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
});

export type StoreT = z.infer<typeof Store>;
export type CreateStoreInputT = z.infer<typeof CreateStoreInput>;
export type UpdateStoreInputT = z.infer<typeof UpdateStoreInput>;
