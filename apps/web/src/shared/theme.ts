const STORAGE_KEY = 'dealpilot.theme';

export type Theme = 'light' | 'dark';

/** localStorage choice wins; otherwise the OS preference. */
export function initTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  const theme: Theme =
    stored === 'dark' || stored === 'light'
      ? stored
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  document.documentElement.dataset['theme'] = theme;
  return theme;
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset['theme'] = theme;
}
