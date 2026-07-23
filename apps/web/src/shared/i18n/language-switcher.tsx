import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import { currentLocale, setLocale } from './index.js';

/**
 * FR↔EN toggle. The visible label is the TARGET language code (click "EN" to
 * switch to English); the accessible name comes from the locale files, so it
 * is in the CURRENT language (matching <html lang>) and parity-gated.
 */
export function LanguageSwitcher() {
  const { t } = useTranslation('common');
  const target = currentLocale() === 'fr-CA' ? 'en-CA' : 'fr-CA';
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t('switchLanguage')}
      onClick={() => setLocale(target)}
    >
      {target === 'en-CA' ? 'EN' : 'FR'}
    </Button>
  );
}
