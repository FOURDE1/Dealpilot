import { describe, expect, it } from 'vitest';
import { checkParity, icuArgs } from './parity.js';
import { frCA } from './locales/fr-CA.js';
import { createI18n, DEFAULT_LOCALE, isLocale, resources } from './index.js';

describe('checkParity', () => {
  it('passes on identical key trees', () => {
    expect(checkParity({ a: { b: 'x' } }, { en: { a: { b: 'y' } } })).toEqual([]);
  });

  it('reports missing keys (the Bill 96 gate — must fail the build)', () => {
    const issues = checkParity({ a: { b: 'x', c: 'x' } }, { en: { a: { b: 'y' } } });
    expect(issues).toEqual([{ locale: 'en', kind: 'missing', key: 'a.c' }]);
  });

  it('reports extra and empty keys', () => {
    const issues = checkParity({ a: { b: 'x' } }, { en: { a: { b: '', z: 'y' } } });
    expect(issues).toContainEqual({ locale: 'en', kind: 'empty', key: 'a.b' });
    expect(issues).toContainEqual({ locale: 'en', kind: 'extra', key: 'a.z' });
  });

  it('reports an EMPTY value in the fr-CA reference itself (worst Bill 96 failure)', () => {
    const issues = checkParity({ a: { b: '' } }, { 'en-CA': { a: { b: 'x' } } });
    expect(issues).toContainEqual({ locale: 'fr-CA', kind: 'empty', key: 'a.b' });
  });

  it('reports ICU argument sets that diverge between languages', () => {
    const issues = checkParity(
      { a: { b: 'Au moins {min} caractères' } },
      { 'en-CA': { a: { b: 'At least {minimum} characters' } } },
    );
    expect(issues).toEqual([{ locale: 'en-CA', kind: 'args-mismatch', key: 'a.b' }]);
  });

  it('the shipped locales hold parity — every locale in resources, none hardcoded', () => {
    const others = Object.fromEntries(
      Object.entries(resources).filter(([locale]) => locale !== DEFAULT_LOCALE),
    );
    expect(Object.keys(others).length).toBeGreaterThan(0);
    expect(checkParity(resources[DEFAULT_LOCALE], others, DEFAULT_LOCALE)).toEqual([]);
  });
});

describe('icuArgs', () => {
  it('extracts simple and plural/select argument heads', () => {
    expect(icuArgs('Bonjour, {name}')).toEqual(new Set(['name']));
    expect(icuArgs('{count, plural, one {# item} other {# items}}')).toEqual(new Set(['count']));
    expect(icuArgs('no args')).toEqual(new Set());
  });

  it('a plural branch that starts with a word, not #, is not an argument (F-77: « Aucun connecteur actif »)', () => {
    expect(icuArgs('{count, plural, =0 {Aucun connecteur actif} one {# connecteur actif} other {# connecteurs actifs}}')).toEqual(
      new Set(['count']),
    );
    expect(icuArgs('{count, plural, =0 {No active connector} one {# active connector} other {# active connectors}}')).toEqual(
      new Set(['count']),
    );
  });

  it('an argument nested inside a plural or select branch still counts', () => {
    expect(icuArgs('{count, plural, one {# for {name}} other {# for {name}}}')).toEqual(new Set(['count', 'name']));
    expect(icuArgs('{g, select, male {Il a {n} points} other {Elle a {n} points}}')).toEqual(new Set(['g', 'n']));
  });
});

describe('createI18n', () => {
  it('defaults to fr-CA (Bill 96 French-first)', () => {
    const i18n = createI18n();
    expect(i18n.language).toBe(DEFAULT_LOCALE);
    expect(i18n.t('auth:signInTitle')).toBe('Connexion');
  });

  it('renders ICU arguments in both locales', () => {
    const fr = createI18n();
    expect(fr.t('auth:passwordHint', { min: 12 })).toBe('Au moins 12 caractères.');
    expect(fr.t('dashboard:greetingName', { name: 'Marie' })).toBe('Bonjour, Marie');
    const en = createI18n({ locale: 'en-CA' });
    expect(en.t('auth:passwordHint', { min: 12 })).toBe('At least 12 characters.');
  });

  it('strictIcu makes a missing ICU argument throw instead of leaking "{min}"', () => {
    const strict = createI18n({ strictIcu: true });
    expect(() => strict.t('auth:passwordHint')).toThrow();
    // Lenient default: renders the raw placeholder rather than crashing prod.
    const lenient = createI18n();
    expect(lenient.t('auth:passwordHint')).toContain('{min}');
  });

  it('isLocale narrows the vocabulary', () => {
    expect(isLocale('fr-CA')).toBe(true);
    expect(isLocale('en-US')).toBe(false);
  });

  it('every shipped fr-CA message is non-empty', () => {
    const walk = (tree: object): string[] =>
      Object.values(tree).flatMap((v) => (typeof v === 'string' ? [v] : walk(v)));
    expect(walk(frCA).every((s) => s.trim().length > 0)).toBe(true);
  });
});
