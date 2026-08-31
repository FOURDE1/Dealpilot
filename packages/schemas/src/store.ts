import { z } from 'zod';
import { TimeOfDay } from './schedule.js';
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

/**
 * Which system prints this store's bill of sale (documents.md §2), and which
 * e-sign platform it uses. Both were added with F-13 and read by the document
 * generator; until F-11c's dead-column guard found them, nothing could SET
 * either, so every store was permanently on the CAMS default and a Merlin
 * store could not be configured at all.
 */
export const BillOfSaleSystem = z.enum(['CAMS', 'Merlin', 'Other']);
export const StoreEsignPlatform = z.enum(['onespan', 'docusign']);

/** A holiday is a `YYYY-MM-DD` string on both sides of the wire (F-76). */
const HOLIDAY_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export const Store = z.object({
  id: Uuid,
  organization_id: Uuid,
  name: storeName,
  code: storeCode,
  phone: PhoneE164.nullable(),
  /**
   * The carrier number this store texts from (F-30). Distinct from `phone`,
   * which is the number on the door.
   */
  sms_number: PhoneE164.nullable(),
  address_line1: z.string().trim().max(200).nullable(),
  city: z.string().trim().max(100).nullable(),
  province: ProvinceCA,
  postal_code: PostalCodeCA.nullable(),
  default_locale: Locale,
  /** Quiet-hours + drip scheduling are tenant-local (multi-tenancy.md §3). */
  timezone: z.string().min(1),
  business_hours: z.record(z.string(), z.object({ open: z.string(), close: z.string() })),
  /**
   * `YYYY-MM-DD` strings, in lockstep with the f01 store-row serialiser
   * (F-76): pg parses `date[]` into JS Dates at server-local midnight and
   * the API rewrites them from LOCAL parts. An ISO timestamp never matches
   * the format, so a store exit that skips the serialiser is red in the web
   * parse and in UTC CI — not only on a desktop ahead of UTC.
   */
  holiday_dates: z.array(z.string().regex(HOLIDAY_DATE_FORMAT)),
  status: StoreStatus,
  bill_of_sale_system: BillOfSaleSystem,
  esign_platform: StoreEsignPlatform.nullable(),
  /** How close two deliveries must be before the board flags them (F-11). */
  dispatch_conflict_window_hours: z.number().int(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
});

/**
 * F-51 (FR-AI-011 config): per-day opening window in the STORE's timezone;
 * a missing day is a closed day. Consumed by the assistant's after-hours
 * behaviour when the AI engine lands.
 */
const DayHours = z.strictObject({ open: TimeOfDay, close: TimeOfDay }).refine(
  (d) => d.close > d.open,
  { message: 'close must be after open' },
);
// Shape and default kept SEPARATE: an update input carrying .default() would
// inject {} into every unrelated PATCH and silently erase the hours — the
// defaults-leak guard exists for exactly that, and it fired on the first try.
const BusinessHoursShape = z.partialRecord(
  z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  DayHours,
);
export const BusinessHours = BusinessHoursShape.default({});
/**
 * F-76: the format alone admits `2026-02-30`; Postgres then refuses it with
 * 22008 ("date/time field value out of range"), which nothing in f01 maps — a
 * 500 for a value this schema had called valid. Rebuild the date from its
 * parts and compare: JS rolls an out-of-range day or month forward, so the
 * rebuilt string differs from the input whenever the parts were not a real
 * calendar date. The year is bounded to 1900–2199 first: year 0 does not
 * exist in Postgres (22008 again), and a year below 1000 comes back from pg
 * as a Date whose `getFullYear()` is 1, 99 or 999 — the shape a mistyped
 * native date input produces, and one the product has no use for.
 * `setUTCFullYear` rather than `Date.UTC` so the year is taken literally.
 * Never throws: zod 4 runs this check even after the format check has
 * failed, and an Invalid Date's `toISOString()` would throw. A tightening of
 * an existing field, no new key — the detail code is zod's `custom`.
 *
 * Mirrored line for line in apps/web/src/features/organizations/holiday-dates.ts;
 * holiday-dates.test.ts binds the two through `UpdateStoreInput.safeParse`.
 */
const HOLIDAY_YEAR_MIN = 1900;
const HOLIDAY_YEAR_MAX = 2199;
const isCalendarDate = (s: string): boolean => {
  if (!HOLIDAY_DATE_FORMAT.test(s)) return false;
  const year = Number(s.slice(0, 4));
  if (year < HOLIDAY_YEAR_MIN || year > HOLIDAY_YEAR_MAX) return false;
  const rebuilt = new Date(0);
  rebuilt.setUTCFullYear(year, Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return rebuilt.toISOString().slice(0, 10) === s;
};
const HolidayDatesShape = z
  .array(
    z
      .string()
      .regex(HOLIDAY_DATE_FORMAT, 'expected YYYY-MM-DD')
      .refine(isCalendarDate, { message: 'not a calendar date within 1900–2199' }),
  )
  .max(60);
const HolidayDates = HolidayDatesShape.default([]);

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
  business_hours: BusinessHours,
  holiday_dates: HolidayDates,
  status: StoreStatus.default('active'),
  // Optional, not defaulted: a store is opened first and configured after, and
  // a `.default()` here would make these REQUIRED in the inferred input type —
  // breaking every existing caller for the sake of a value the database
  // already defaults.
  bill_of_sale_system: BillOfSaleSystem.optional(),
  esign_platform: StoreEsignPlatform.nullable().optional(),
  dispatch_conflict_window_hours: z.number().int().min(1).max(24).optional(),
});

export const UpdateStoreInput = z.strictObject({
  name: storeName.optional(),
  code: storeCode.optional(),
  phone: PhoneE164.nullable().optional(),
  /**
   * The carrier number (F-30). Update-only, not create-only: a store is opened
   * before a number is bought for it, and A2P registration takes weeks.
   */
  sms_number: PhoneE164.nullable().optional(),
  address_line1: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  province: ProvinceCA.optional(),
  postal_code: PostalCodeCA.nullable().optional(),
  default_locale: Locale.optional(),
  timezone: z.string().min(1).optional(),
  business_hours: BusinessHoursShape.optional(),
  holiday_dates: HolidayDatesShape.optional(),
  status: StoreStatus.optional(),
  bill_of_sale_system: BillOfSaleSystem.optional(),
  esign_platform: StoreEsignPlatform.nullable().optional(),
  dispatch_conflict_window_hours: z.number().int().min(1).max(24).optional(),
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
