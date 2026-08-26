import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@dealpilot/ui';

/**
 * F-69 — platform staff without TOTP see this and nothing else (admin-console.md
 * §2: mandatory, no exceptions). Not behind the tenant-side REQUIRE_MFA
 * switch: the console's rule is the console's. It is page content, not an
 * alert: focus lands on the landmark, the heading says what is required.
 */
export function MfaWall() {
  const { t } = useTranslation('admin');
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.focus();
  }, []);
  return (
    <main ref={main} id="main" tabIndex={-1} className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground outline-none">
      <div className="max-w-md space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">{t('mfaWallTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('mfaWallBody')}</p>
        <Link to="/security" className={buttonVariants({ size: 'default' })}>
          {t('mfaWallLink')}
        </Link>
      </div>
    </main>
  );
}
