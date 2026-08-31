import { useLayoutEffect } from 'react';
import { setThemeLock } from '../../shared/theme.js';
import { assetUrl, type PublishedBrandingT } from './api.js';

/**
 * F-75 (D-076): the parts of a published brand that live on the DOCUMENT
 * rather than in a stylesheet — the density attribute `DataTable`/`Input`
 * read through `[data-density="compact"]`, the light-theme lock behind
 * `dark_mode: 'disabled'`, and the favicon `<link>` (index.html declares
 * none). Layout effects, so the first shell frame already carries them; every
 * effect restores the platform state on unmount (sign-out) or when the value
 * goes away, and the lock never touches the user's stored preference
 * (shared/theme.ts). Rendered in the same commit as `ThemeToggle`, so the
 * SHELL never commits a dark frame for a locked tenant; the boot theme
 * (`initTheme()` in main.tsx) and the pre-shell skeletons still follow the
 * stored preference for one round trip on a cold load (accepted, R7/D-076).
 */
const DENSITY_ATTR = 'density';
const FAVICON_SELECTOR = 'link[rel="icon"][data-brand-favicon]';

export function BrandDocument({ branding }: { branding: PublishedBrandingT | null }) {
  const locked = branding?.dark_mode === 'disabled';
  const favicon = branding?.favicon_key ? assetUrl(branding, 'favicon') : null;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (branding?.density === 'compact') root.dataset[DENSITY_ATTR] = 'compact'; else delete root.dataset[DENSITY_ATTR];
    return () => {
      delete root.dataset[DENSITY_ATTR];
    };
  }, [branding]);

  useLayoutEffect(() => {
    setThemeLock(locked);
    return () => setThemeLock(false);
  }, [locked]);

  useLayoutEffect(() => {
    const existing = document.head.querySelector<HTMLLinkElement>(FAVICON_SELECTOR);
    if (favicon === null) {
      existing?.remove();
      return;
    }
    const link = existing ?? document.createElement('link');
    link.rel = 'icon';
    link.dataset['brandFavicon'] = '';
    link.href = favicon;
    if (!existing) document.head.append(link);
    return () => {
      link.remove();
    };
  }, [favicon]);

  return null;
}
