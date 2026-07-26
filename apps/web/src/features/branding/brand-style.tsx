import { usePublishedBranding, type PublishedBrandingT } from './api.js';

/**
 * F-14 injection — increment 1: the SAFE, contrast-neutral parts of a published
 * brand. Colour injection is deliberately NOT here: the app's `--primary` is
 * dual-role (both `bg-primary` fills and `text-primary` links), while the brand
 * palette separates fills / text / foregrounds precisely because one colour
 * cannot serve both. Mapping a raw fill onto `--primary` breaks link contrast,
 * and the palette carries no dark-mode foreground, so the dark button label
 * would fail AA. Both need work before colours can land: an app token role-split
 * and a server `foregrounds.*_dark` value (CR-15). Until then only radius —
 * which has no contrast dimension — is injected, and the tenant's name is shown.
 */

const RADIUS_REM: Record<PublishedBrandingT['radius'], string> = {
  none: '0px',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
};

/** The tenant's own name, or the platform name when unbranded. */
export function useBrandName(platformName: string): string {
  const branding = usePublishedBranding();
  return branding.data?.display_name?.trim() || platformName;
}

/** Only the corner radius — no colour, no contrast dimension (see the note). */
export function brandCss(branding: PublishedBrandingT): string {
  return `:root{--radius:${RADIUS_REM[branding.radius]};}`;
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
