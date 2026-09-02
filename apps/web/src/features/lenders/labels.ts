import type { LenderCategoryT } from '@dealpilot/schemas';

/**
 * F-80 — `lenders:` namespace key per category. The labels themselves are the
 * legacy locale files' VERBATIM (fr « Prime / Quasi-prime / Subprime /
 * Captif (OEM) », en '… / Captive (OEM)' — R12/A15); deriving the key from the
 * enum value keeps a new category a compile error here, not a raw string on
 * screen.
 */
export const CATEGORY_KEYS = {
  PRIME: 'category_PRIME',
  NEAR_PRIME: 'category_NEAR_PRIME',
  SUBPRIME: 'category_SUBPRIME',
  CAPTIVE: 'category_CAPTIVE',
} as const satisfies Record<LenderCategoryT, string>;
