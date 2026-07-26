import { usePublishedBranding, type PublishedBrandingT } from './api.js';

/**
 * F-14 injection: the contrast-SAFE parts of a published brand.
 *
 * Increment 1: the tenant name + corner radius (no contrast dimension).
 * Increment 2: the focus RING, now that CR-15 gives `ring.*` guaranteed ≥3:1
 * against each surface (WCAG 2.4.11). Still deferred — the fills for buttons
 * and links: the app's `--primary` is dual-role (`bg-primary` AND `text-primary`)
 * so it needs a token role-split (fills→bg, text→links) before an un-adjusted
 * brand fill can land there. That is a design-system slice of its own; the
 * palette now carries every value it needs (fills/foregrounds/hover/text, each
 * with `_dark`).
 */

const RADIUS_REM: Record<PublishedBrandingT['radius'], string> = {
  none: '0px',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
};

/** Only well-formed colours reach the stylesheet — a guard against CSS breakout
 * from a network payload, even one the server computes. */
const SAFE_COLOR = /^(oklch\([0-9.\s%-]+\)|#[0-9a-fA-F]{3,8})$/;

/** The tenant's own name, or the platform name when unbranded. */
export function useBrandName(platformName: string): string {
  const branding = usePublishedBranding();
  return branding.data?.display_name?.trim() || platformName;
}

/** Read a palette value only if present and well-formed. */
function safeAt(branding: PublishedBrandingT, group: string, key: string): string | undefined {
  const v = branding.palette[group]?.[key];
  return typeof v === 'string' && SAFE_COLOR.test(v) ? v : undefined;
}

/**
 * The corner radius, plus the brand focus ring (CR-15's `ring.*`, ≥3:1 per
 * surface). Rings are the one colour token safe to inject before the fill/text
 * role-split: they are UI-graphic (3:1), and the server guarantees each against
 * its own surface (light and dark).
 */
export function brandCss(branding: PublishedBrandingT): string {
  const light: string[] = [`--radius:${RADIUS_REM[branding.radius]};`];
  const dark: string[] = [];

  const ringLight = safeAt(branding, 'ring', 'primary');
  const ringDark = safeAt(branding, 'ring', 'primary_dark');
  if (ringLight) light.push(`--ring:${ringLight};--sidebar-ring:${ringLight};`);
  if (ringDark) dark.push(`--ring:${ringDark};--sidebar-ring:${ringDark};`);

  const blocks = [`:root{${light.join('')}}`];
  if (dark.length) blocks.push(`:root[data-theme="dark"]{${dark.join('')}}`);
  return blocks.join('');
}

/**
 * Inject the contrast-neutral brand tokens. `null` (never published) leaves the
 * platform theme intact. Rendered inside the authenticated shell — the endpoint
 * needs a member.
 */
export function BrandStyle() {
  const branding = usePublishedBranding();
  if (!branding.data) return null;
  return (
    <style data-brand-version={branding.data.version} data-testid="brand-style">
      {brandCss(branding.data)}
    </style>
  );
}
