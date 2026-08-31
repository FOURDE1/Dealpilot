import { useState } from 'react';
import { cn } from '@dealpilot/ui';
import { assetUrl, type PublishedBrandingT } from './api.js';

/**
 * F-75 (D-076): the tenant's mark in the sidebar and the topbar — the
 * published logo as `<img src>`, or the wordmark (the brand name, or the
 * platform name) when there is none or it fails to load.
 *
 * `<img src>` ONLY, never inline SVG: the asset route serves tenant-supplied
 * bytes under `default-src 'none'; sandbox` + `nosniff`, headers that do not
 * apply to markup pasted into the DOM (docs/SECURITY.md, SVG section). The
 * light/dark pair is the first consumer of the `dark:` variant tokens.css
 * declares (`dark:hidden` / `hidden dark:block`); a missing dark logo shows
 * the light one in both themes. `alt` is the brand name, so the mark is the
 * image's accessible name.
 *
 * The images live in `BrandImages`, KEYED on their two URLs: `onError` falls
 * back to the wordmark for that source only. A republish puts a new `v=` in
 * the URL, so the pair remounts with a clean `failed` state and the new logo
 * is tried again in the same mounted shell — the admin who fixes a broken
 * asset and publishes is in that shell. `BrandMark` itself holds no state, so
 * brand-style.test.ts #12d can call it and read the key off the element.
 */
export function BrandMark({
  branding,
  name,
  className,
}: {
  branding: PublishedBrandingT | null;
  /** The wordmark and the images' accessible name (brand name or platform name). */
  name: string;
  className?: string;
}) {
  const light = branding?.logo_light_key ? assetUrl(branding, 'logo_light') : null;
  const dark = branding?.logo_dark_key ? assetUrl(branding, 'logo_dark') : null;
  if (!light && !dark) return <span>{name}</span>;
  return <BrandImages key={`${light ?? ''}|${dark ?? ''}`} light={light} dark={dark} name={name} className={className} />;
}

/** The `<img>` pair (or the single light image) behind one onError → wordmark fallback. */
function BrandImages({
  light,
  dark,
  name,
  className,
}: {
  light: string | null;
  dark: string | null;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const onError = () => setFailed(true);

  if (failed) return <span>{name}</span>;
  if (!dark) {
    return light ? <img src={light} alt={name} className={className} onError={onError} /> : <span>{name}</span>;
  }
  return (
    <>
      {light ? (
        <img src={light} alt={name} className={cn(className, 'dark:hidden')} onError={onError} />
      ) : (
        <span className="dark:hidden">{name}</span>
      )}
      <img src={dark} alt={name} className={cn(className, 'hidden dark:block')} onError={onError} />
    </>
  );
}
