/**
 * Currency utilities for integer-cents storage pattern.
 *
 * All money values are stored as INTEGER CENTS in the database.
 * $1,000.00 = 100000 cents.
 * These utilities convert between cents and display strings.
 */

/**
 * Format cents as a display string.
 * @param {number} cents - Amount in cents (integer)
 * @param {object} options
 * @param {string} options.currency - Currency code (default: 'CAD')
 * @param {string} options.locale - Locale (default: 'en-CA')
 * @param {boolean} options.showCents - Show cents in output (default: true)
 * @returns {string} Formatted string like "$1,000.00"
 */
export function formatCurrency(cents, options = {}) {
  if (cents == null || isNaN(cents)) return '$0.00';

  const {
    currency = 'CAD',
    locale = 'en-CA',
    showCents = true,
  } = options;

  const dollars = cents / 100;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(dollars);
}

/**
 * Parse a display string or number into cents.
 * Handles: "$1,000.00", "1000.00", "1000", 1000, 1000.50
 * @param {string|number} value - Display value
 * @returns {number} Amount in cents (integer)
 */
export function parseCurrency(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Math.round(value * 100);

  // Strip everything except digits, dots, and minus
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-') return 0;

  const dollars = parseFloat(cleaned);
  if (isNaN(dollars)) return 0;

  return Math.round(dollars * 100);
}

/**
 * Convert cents to dollars for form inputs.
 * @param {number} cents - Amount in cents
 * @returns {string} Dollar amount as string (e.g., "1000.00")
 */
export function centsToDollars(cents) {
  if (cents == null || isNaN(cents)) return '0.00';
  return (cents / 100).toFixed(2);
}

/**
 * Convert dollars to cents for storage.
 * @param {string|number} dollars - Dollar amount
 * @returns {number} Amount in cents (integer)
 */
export function dollarsToCents(dollars) {
  if (dollars == null) return 0;
  const num = typeof dollars === 'string' ? parseFloat(dollars) : dollars;
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}
