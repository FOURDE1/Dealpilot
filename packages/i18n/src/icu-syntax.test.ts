import { beforeAll, describe, expect, it } from 'vitest';
import i18next, { type i18n as I18n } from 'i18next';
import ICU from 'i18next-icu';
import { enCA } from './locales/en-CA.js';
import { frCA } from './locales/fr-CA.js';

/**
 * Every string must be something ICU can actually parse.
 *
 * This app formats with i18next-icu, so interpolation is `{name}` — SINGLE
 * braces. i18next's own default syntax is `{{name}}`, and it is the natural
 * thing to type, especially for anyone who has used i18next anywhere else.
 * ICU reads `{{name}}` as `{` followed by `{name}` and throws
 * `SyntaxError: MALFORMED_ARGUMENT` — at RENDER time, inside the component.
 *
 * That is what makes it worth a guard rather than a convention. Seven strings
 * had crept in with the wrong syntax, and the symptom was not a label looking
 * odd: `ConsentPanel` threw, React's error boundary rebuilt the lead page from
 * scratch, and the save confirmation the user was waiting for disappeared with
 * the component's state. A translation typo took a screen down, and the failure
 * looked like "saving is broken".
 *
 * The parity check next door compares KEYS across locales and cannot see this,
 * because both locales were wrong in identical ways.
 *
 * Driven through i18next + ICU rather than a regex, because the question is not
 * "does this look like valid ICU" but "does the parser this app ships accept
 * it". Same library, same version, same code path as the browser.
 */

type Bundle = Record<string, Record<string, unknown>>;

const LOCALES: [string, Bundle][] = [
  ['fr-CA', frCA as unknown as Bundle],
  ['en-CA', enCA as unknown as Bundle],
];

function stringKeys(bundle: Bundle): { ns: string; key: string; value: string }[] {
  const out: { ns: string; key: string; value: string }[] = [];
  for (const [ns, entries] of Object.entries(bundle)) {
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value === 'string') out.push({ ns, key, value });
    }
  }
  return out;
}

const instances: Record<string, I18n> = {};

beforeAll(async () => {
  for (const [locale, bundle] of LOCALES) {
    const instance = i18next.createInstance();
    await instance
      .use(ICU)
      .init({
        lng: locale,
        resources: { [locale]: bundle as never },
        // Surface the failure instead of swallowing it into the key name.
        parseMissingKeyHandler: (key) => key,
      });
    instances[locale] = instance;
  }
});

describe.each(LOCALES)('%s', (locale, bundle) => {
  it('has strings to check', () => {
    // A restructured bundle that yielded nothing would make the rest vacuous.
    expect(stringKeys(bundle).length).toBeGreaterThan(200);
  });

  it('uses ICU single-brace interpolation, never i18next double-brace', () => {
    const offenders = stringKeys(bundle)
      .filter(({ value }) => value.includes('{{'))
      .map(({ ns, key, value }) => `${ns}.${key}: ${value}`);

    expect(
      offenders,
      `these use i18next's {{name}} syntax, which the ICU formatter cannot parse. It throws during render and the error boundary takes the whole screen with it — a translation typo becomes a blank page. Use {name}:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('translates every key without throwing', () => {
    const t = instances[locale]!;
    const offenders: string[] = [];
    for (const { ns, key, value } of stringKeys(bundle)) {
      try {
        // Every declared argument supplied, so a legitimate placeholder does
        // not fail for want of a value — what is under test is whether the
        // message PARSES, not whether the caller passed the right variables.
        const args = Object.fromEntries(
          [...value.matchAll(/\{(\w+)[,}]/g)].map((m) => [m[1]!, 1]),
        );
        t.t(`${ns}:${key}`, args);
      } catch (err) {
        offenders.push(`${ns}.${key}: ${value} — ${(err as Error).message}`);
      }
    }
    expect(
      offenders,
      `these throw when the app's own ICU formatter parses them, which happens during render:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
