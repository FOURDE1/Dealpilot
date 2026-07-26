import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import { initTheme, setTheme, type Theme } from './theme.js';

export function ThemeToggle() {
  const { t } = useTranslation('common');
  const [theme, setLocal] = useState<Theme>(() => initTheme());
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = theme === 'dark' ? t('themeLight') : t('themeDark');
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={theme === 'dark'}
      aria-label={label}
      onClick={() => {
        setTheme(next);
        setLocal(next);
      }}
    >
      <span className="max-sm:hidden">{label}</span>
      {/* Compact glyph at phone widths — the accessible name stays the full label. */}
      <span aria-hidden className="sm:hidden">
        {theme === 'dark' ? '☀' : '☾'}
      </span>
    </Button>
  );
}
