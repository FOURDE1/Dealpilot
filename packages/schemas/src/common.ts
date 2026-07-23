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
  .refine((d) => d.length === 10 || (d.length === 11 && d.startsWith('1')), {
    message: 'Expected a 10-digit North American phone number',
  })
  .transform((d) => `+1${d.slice(-10)}`);

/** Canadian postal code, normalized to `A1A 1A1` (uppercase, single space). */
export const PostalCodeCA = z
  .string()
  .trim()
  .regex(/^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/, 'Expected a Canadian postal code (A1A 1A1)')
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
