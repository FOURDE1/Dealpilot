const STORAGE_KEY = 'dealpilot.theme';

export type Theme = 'light' | 'dark';

/**
 * F-75 (D-076): a tenant whose brand says `dark_mode: 'disabled'` holds the
 * document to light. The lock lives HERE, not in the toggle, so the exported
 * `setTheme` is an invariant and not a hidden button — and it never writes
 * storage, so the user's own preference survives for every other tenant and
 * for the day this one unlocks.
 */
let lockedLight = false;

/** localStorage choice wins; otherwise the OS preference. */
function preferred(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'dark' || stored === 'light'
    ? stored
    : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
}

function apply(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}

/** Stamps and returns the theme to show now: light while locked, else the preference. */
export function initTheme(): Theme {
  const theme: Theme = lockedLight ? 'light' : preferred();
  apply(theme);
  return theme;
}

/** The user's choice — remembered and applied, unless the tenant lock is on (then a no-op). */
export function setTheme(theme: Theme): void {
  if (lockedLight) return;
  localStorage.setItem(STORAGE_KEY, theme);
  apply(theme);
}

/**
 * Lock the document to light (`dark_mode: 'disabled'`) or release it. Releasing
 * re-applies the stored/OS preference, which the lock never erased.
 */
export function setThemeLock(locked: boolean): void {
  lockedLight = locked;
  apply(locked ? 'light' : preferred());
}
