const { z } = require('zod');

// ── Shared validators ──────────────────────────────────────────────

const vinSchema = z.string()
  .length(17, 'VIN must be exactly 17 characters')
  .regex(/^[A-HJ-NPR-Z0-9]+$/, 'VIN cannot contain I, O, or Q')
  .optional()
  .nullable();

const phoneSchema = z.string()
  .transform((val) => val.replace(/[^0-9]/g, ''))
  .refine((val) => val === '' || (val.length >= 10 && val.length <= 11), {
    message: 'Phone must be 10-11 digits',
  })
  .optional()
  .nullable();

const postalCodeSchema = z.string()
  .regex(/^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/, 'Invalid Canadian postal code (e.g., J9L 3G1)')
  .optional()
  .nullable();

const emailSchema = z.string().email('Invalid email address').optional().nullable();

const nonNegativeNumber = z.number().nonnegative('Must be non-negative').optional().nullable();

// ── Contact schemas ────────────────────────────────────────────────

const createContactSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  email: emailSchema,
  phone: z.string().max(20).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  province: z.string().max(2).optional().nullable(),
  postal_code: postalCodeSchema,
  driver_license: z.string().max(50).optional().nullable(),
  employer: z.string().max(100).optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  preferred_language: z.enum(['en', 'fr']).default('fr'),
  marketing_consent: z.boolean().default(false),
  source: z.enum(['walk_in', 'phone', 'web', 'referral', 'repeat', 'other']).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const updateContactSchema = createContactSchema.partial();

// ── Deal schemas ───────────────────────────────────────────────────

const createDealSchema = z.object({
  stock_number: z.string().max(20).optional().nullable(),
  vin: vinSchema,
  year: z.number().int().min(1900).max(2100).optional().nullable(),
  make: z.string().max(50).optional().nullable(),
  model: z.string().max(50).optional().nullable(),
  color: z.string().max(30).optional().nullable(),
  vehicle_source: z.string().max(50).optional().nullable(),
  vehicle_status: z.enum(['incoming', 'at_garage', 'delivered']).default('incoming'),
  sale_type: z.enum(['retail', 'wholesale']).optional().nullable(),
  listed_online: z.boolean().default(false),
  customer_name: z.string().max(100).optional().nullable(),
  customer_address: z.string().max(200).optional().nullable(),
  customer_phone: z.string().max(20).optional().nullable(),
  has_cosigner: z.boolean().default(false),
  cosigner_name: z.string().max(100).optional().nullable(),
  salesperson_name: z.string().max(100).optional().nullable(),
  financing_bank: z.string().max(100).optional().nullable(),
  finance_status: z.enum(['pending', 'approved', 'funded']).default('pending'),
  money_down_amount: nonNegativeNumber,
  money_down_collected: z.boolean().default(false),
  cash_back_amount: nonNegativeNumber,
  cash_back_sent: z.boolean().default(false),
  accessories: z.string().max(500).optional().nullable(),
  native_status: z.boolean().default(false),
  contact_id: z.string().uuid().optional().nullable(),
  sale_price: nonNegativeNumber,
  vehicle_cost: nonNegativeNumber,
  fi_reserve: nonNegativeNumber,
}).passthrough(); // Allow additional fields for delivery, trade-in, etc.

const updateDealSchema = createDealSchema.partial();

// ── Salesperson schemas ────────────────────────────────────────────

const createSalespersonSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  commission_rate: z.number().min(0).max(1),
  has_pad: z.boolean().default(false),
  pad_amount: nonNegativeNumber,
  has_tiered_rate: z.boolean().default(false),
  tier_threshold: nonNegativeNumber,
  tier_rate: z.number().min(0).max(1).optional().nullable(),
  override_on: z.string().max(100).optional().nullable(),
  override_rate: z.number().min(0).max(1).optional().nullable(),
  active: z.boolean().default(true),
}).passthrough();

// ── Store schemas ──────────────────────────────────────────────────

const updateStoreSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  province: z.string().max(2).optional(),
  tax_rate: z.number().min(0).max(1).optional(),
  address: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  postal_code: postalCodeSchema,
  phone: z.string().max(20).optional().nullable(),
  email: emailSchema,
  aging_threshold_days: z.number().int().min(1).max(365).optional(),
  safety_overdue_days: z.number().int().min(1).max(90).optional(),
  funding_overdue_days: z.number().int().min(1).max(90).optional(),
  bill_of_sale_system: z.enum(['CAMS', 'Merlin', 'Other']).optional(),
  esign_platform: z.string().max(50).optional().nullable(),
}).passthrough();

// ── User account schema ────────────────────────────────────────────

const createAccountSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  role: z.enum([
    'owner', 'gm', 'sales_manager', 'used_car_manager', 'fi_manager',
    'salesperson', 'wholesale_manager', 'logistics', 'admin_office', 'bdc_agent',
  ]),
  store_id: z.string().uuid().optional().nullable(),
});

module.exports = {
  vinSchema,
  phoneSchema,
  postalCodeSchema,
  emailSchema,
  createContactSchema,
  updateContactSchema,
  createDealSchema,
  updateDealSchema,
  createSalespersonSchema,
  updateStoreSchema,
  createAccountSchema,
};
