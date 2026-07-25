import { z } from 'zod';

/**
 * Shared primitives — the single source of truth for validation AND
 * sanitization (trim, lowercase, E.164, postal-code normalization) across
 * client, server, and workers (ADR-016). Sanitize-then-validate, once,
 * at the boundary; interior code trusts these types.
 *
 * Conventions:
 * - Request/input schemas are STRICT (unknown keys rejected) — media-i18n-validation.md §3.1.
 * - Entity schemas are strip-mode (tolerant when parsing DB rows into responses).
 * - Create inputs carry defaults; update inputs NEVER do (a PATCH must not
 *   silently reset fields — regression-tested in schemas.test.ts).
 */

/**
 * A-10: domain constraints carry a STABLE KEY instead of an English literal.
 * An explicit `message` wins over zod's error map, which blocked the web app
 * from localizing (Bill 96) — a keyed `custom` issue leaves the message to the
 * consumer: the web app maps `issue.params.key` to FR/EN text, and the API
 * uses the key as the machine-readable `details[].code`.
 * Standard checks (min/max/email/uuid) keep zod's own codes — already
 * localizable through the same error map.
 */
export const MESSAGE_KEYS = {
  phone_nanp: 'phone_nanp',
  postal_code_ca: 'postal_code_ca',
  org_slug_format: 'org_slug_format',
  org_slug_reserved: 'org_slug_reserved',
  store_code_format: 'store_code_format',
  vin_format: 'vin_format',
} as const;

export type MessageKey = (typeof MESSAGE_KEYS)[keyof typeof MESSAGE_KEYS];

/** Attach a message key to a refinement (zod drops `params` on format checks). */
export const withKey = (key: MessageKey) => ({ params: { key } });

export const Uuid = z.uuid();

/** Lowercased, trimmed email. */
export const Email = z.string().trim().toLowerCase().pipe(z.email());

/**
 * North American phone number normalized to E.164 `+1XXXXXXXXXX`.
 * Accepts any human formatting; strips non-digits; 10 digits, or 11 starting
 * with country code 1. Replaces the five divergent legacy implementations.
 */
export const PhoneE164 = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((d) => d.length === 10 || (d.length === 11 && d.startsWith('1')), withKey('phone_nanp'))
  .transform((d) => `+1${d.slice(-10)}`);

/** Canadian postal code, normalized to `A1A 1A1` (uppercase, single space). */
export const PostalCodeCA = z
  .string()
  .trim()
  .refine((v) => /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/.test(v), withKey('postal_code_ca'))
  .transform((v) => {
    const c = v.replace(/\s/g, '').toUpperCase();
    return `${c.slice(0, 3)} ${c.slice(3)}`;
  });

/** Money is ALWAYS integer cents (ADR-009). Never floats, never dollars. */
export const MoneyCents = z.number().int();
/** Integer cents that cannot be negative (prices, budgets, fees). */
export const NonNegativeCents = MoneyCents.min(0);

export const IsoDateTime = z.iso.datetime({ offset: true });

export const Timestamps = z.object({
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/** Soft delete (ADR-009): rows are never hard-deleted from business tables. */
export const SoftDelete = z.object({
  deleted_at: IsoDateTime.nullable(),
});

export const Locale = z.enum(['fr-CA', 'en-CA']);

export const ProvinceCA = z.enum([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

/** Cursor pagination — every list endpoint paginates from day one. */
export const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });

/**
 * Canonical API error envelope (api-design.md §8). Detail `code`s — not
 * English text — are the machine-readable contract; `message` is for humans.
 */
export const ErrorDetail = z.object({
  path: z.string().optional(),
  code: z.string(),
  message: z.string(),
});

export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(ErrorDetail).optional(),
    request_id: z.string().optional(),
  }),
});

export type ErrorEnvelopeT = z.infer<typeof ErrorEnvelope>;
