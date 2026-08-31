import { useContext, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandNameContext } from '../features/branding/brand-style.js';

/**
 * WCAG 2.4.2: every route names itself in the tab.
 *
 * F-75 (D-076): `${title} — ${brand}` where the brand is the tenant's published
 * display name provided by the tenant shell (BrandNameContext), or the platform
 * name — the console and the public routes provide nothing, so their tabs
 * cannot carry a brand. The cleanup restores the PLATFORM name, never the
 * brand: a session-expiry redirect to /login leaves the cache warm and must
 * not leave the tenant's name in the tab. Unbranded output is byte-identical
 * to before (`Prospects — 1Dealer`).
 */
export function usePageTitle(title: string | undefined): void {
  const { t } = useTranslation('common');
  const brand = useContext(BrandNameContext);
  const appName = t('appName');
  const name = brand ?? appName;
  useEffect(() => {
    if (title) document.title = `${title} — ${name}`;
    return () => {
      document.title = appName;
    };
  }, [title, name, appName]);
}
