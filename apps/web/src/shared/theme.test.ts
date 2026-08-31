import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTheme, setTheme, setThemeLock } from './theme.js';

/**
 * F-75 (D-076) — the light-theme lock behind `dark_mode: 'disabled'`.
 *
 * The lock must be an invariant of `theme.ts`, not a hidden toggle: `setTheme`
 * is exported and callable from anywhere, so the test drives it directly. It
 * must also never touch the user's stored preference — a tenant flipping back
 * to `derived` restores the dark theme the user chose. Root vitest runs in
 * node, so the DOM surface the module touches is stubbed: a dataset on the
 * root element, a Map-backed localStorage, an OS preference of light.
 */
const dataset: Record<string, string> = {};
const store = new Map<string, string>();

beforeEach(() => {
  for (const key of Object.keys(dataset)) delete dataset[key];
  store.clear();
  vi.stubGlobal('document', { documentElement: { dataset } });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
});

afterEach(() => {
  setThemeLock(false);
  vi.unstubAllGlobals();
});

describe('theme lock (dark_mode: disabled)', () => {
  it('a stored dark preference + lock → initTheme returns light and stamps light', () => {
    store.set('dealpilot.theme', 'dark');
    expect(initTheme()).toBe('dark');
    setThemeLock(true);
    expect(dataset['theme']).toBe('light');
    expect(initTheme()).toBe('light');
    expect(dataset['theme']).toBe('light');
  });

  it('setTheme under the lock is a no-op and storage still says dark', () => {
    store.set('dealpilot.theme', 'dark');
    setThemeLock(true);
    setTheme('dark');
    expect(dataset['theme']).toBe('light');
    expect(store.get('dealpilot.theme')).toBe('dark');
    // The user cannot flip it the other way either — the lock never writes.
    store.set('dealpilot.theme', 'dark');
    setTheme('light');
    expect(store.get('dealpilot.theme')).toBe('dark');
  });

  it('unlocking brings the stored dark preference back', () => {
    store.set('dealpilot.theme', 'dark');
    setThemeLock(true);
    expect(dataset['theme']).toBe('light');
    setThemeLock(false);
    expect(dataset['theme']).toBe('dark');
    expect(initTheme()).toBe('dark');
  });

  it('initTheme after setThemeLock(true) returns light even with no stored preference and a dark OS', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(initTheme()).toBe('dark');
    setThemeLock(true);
    expect(initTheme()).toBe('light');
    expect(dataset['theme']).toBe('light');
    setThemeLock(false);
    expect(initTheme()).toBe('dark');
  });

  it('without the lock, setTheme remembers and applies the choice (the pre-F-75 behaviour)', () => {
    setTheme('dark');
    expect(store.get('dealpilot.theme')).toBe('dark');
    expect(dataset['theme']).toBe('dark');
    expect(initTheme()).toBe('dark');
  });
});
