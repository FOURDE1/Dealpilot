import { describe, expect, it } from 'vitest';
import { countSegments } from './sms-segments.js';

/**
 * Segment counting is a money calculation, so it gets golden numbers like the
 * tax and commission engines do.
 *
 * The cases that matter are French. This is a Quebec-first product; most
 * messages it sends will carry accents, and the difference between an accent
 * GSM-7 carries and one it does not is 160 characters versus 70 — the same
 * sentence at 2.3× the price.
 */

describe('plain GSM-7', () => {
  it('counts one segment up to 160 septets', () => {
    expect(countSegments('a'.repeat(160))).toMatchObject({ encoding: 'gsm7', segments: 1, units: 160 });
  });

  it('splits at 161 into two segments of 153, not 160', () => {
    // The 7 missing septets are the header that reassembles the parts. A
    // count that used 160 here would under-bill every long message.
    expect(countSegments('a'.repeat(161))).toMatchObject({ segments: 2 });
    expect(countSegments('a'.repeat(306))).toMatchObject({ segments: 2 });
    expect(countSegments('a'.repeat(307))).toMatchObject({ segments: 3 });
  });

  it('treats an empty body as one segment', () => {
    // Nothing sends an empty message, but returning 0 would make it free and
    // arithmetic downstream would divide by it.
    expect(countSegments('')).toMatchObject({ segments: 1, units: 0 });
  });
});

describe('French, which is most of what this product sends', () => {
  it('reports the FIRST character that forced UCS-2, not the last', () => {
    // Two culprits: ê in "prêt" and the curly apostrophe U+2019 in
    // "aujourd’hui". The one worth telling an operator about is the one they
    // reach first when reading their own draft.
    const body = 'Bonjour! Le véhicule est prêt à être vu dès aujourd’hui';
    const r = countSegments(body);
    expect(r.encoding).toBe('ucs2');
    expect(r.forcedUcs2By).toBe('ê');
  });

  it('is not saved by straightening the apostrophe', () => {
    // The obvious fix for an expensive message is to replace the curly quote.
    // It does not help here, because ê was never in GSM-7 either — which is
    // exactly why the count names a character instead of just charging more.
    const body = "Bonjour! Le véhicule est prêt à être vu dès aujourd'hui";
    expect(countSegments(body)).toMatchObject({ encoding: 'ucs2', forcedUcs2By: 'ê' });

    // Remove BOTH and it fits on GSM-7 at a third of the price.
    const plain = "Bonjour! Le véhicule est pret à être vu dès aujourd'hui".replace('être', 'etre');
    expect(countSegments(plain)).toMatchObject({ encoding: 'gsm7', segments: 1 });
  });

  it('is GSM-7 for the accents GSM-7 actually carries', () => {
    // é è à ù ì ò Ç Å å É Ä Ö Ñ Ü ä ö ñ ü — all single septets.
    const r = countSegments('Réponse à votre demande, où êtes');
    expect(r.forcedUcs2By).toBe('ê');

    const clean = countSegments('Réponse à votre demande, ù ì ò Ç É');
    expect(clean).toMatchObject({ encoding: 'gsm7', segments: 1 });
  });

  it('drops to UCS-2 on a lowercase ç, and says so', () => {
    // GSM-7 has Ç and not ç. "Ça va" and "ca va" are the same sentence at
    // 160 characters and at 70.
    const r = countSegments('ça va');
    expect(r).toMatchObject({ encoding: 'ucs2', segments: 1, forcedUcs2By: 'ç' });

    expect(countSegments('Ça va')).toMatchObject({ encoding: 'gsm7' });
  });

  it('halves the capacity once UCS-2 kicks in', () => {
    expect(countSegments('ç'.repeat(70))).toMatchObject({ segments: 1 });
    expect(countSegments('ç'.repeat(71))).toMatchObject({ segments: 2 });
    expect(countSegments('ç'.repeat(134))).toMatchObject({ segments: 2 });
    expect(countSegments('ç'.repeat(135))).toMatchObject({ segments: 3 });
  });
});

describe('the extension table', () => {
  it('charges two septets for an escaped character', () => {
    expect(countSegments('€')).toMatchObject({ encoding: 'gsm7', units: 2, segments: 1 });
    expect(countSegments('[]{}')).toMatchObject({ encoding: 'gsm7', units: 8 });
  });

  it('splits a message that only overflows because of escapes', () => {
    // 80 euro signs is 160 septets — exactly one segment — and 81 is not.
    expect(countSegments('€'.repeat(80))).toMatchObject({ segments: 1, units: 160 });
    expect(countSegments('€'.repeat(81))).toMatchObject({ segments: 2 });
  });
});

describe('characters that are not one code unit', () => {
  it('bills an emoji as two UTF-16 units', () => {
    // 🚗 is astral: one character to a person, two code units to a carrier.
    const r = countSegments('🚗');
    expect(r).toMatchObject({ encoding: 'ucs2', units: 2, segments: 1 });
  });

  it('does not split a surrogate pair while counting', () => {
    // Iterating by index instead of by code point would count 35 astral chars
    // as 70 separate units AND report a lone surrogate as the culprit.
    const r = countSegments('🚗'.repeat(35));
    expect(r.units).toBe(70);
    expect(r.segments).toBe(1);
    expect(r.forcedUcs2By).toBe('🚗');
  });
});

describe('what the count is for', () => {
  it('names the character that made it expensive', () => {
    // An operator asking "why is this three segments?" gets an answer they can
    // act on: one character, usually replaceable.
    const body = `${'a'.repeat(100)}ç${'b'.repeat(100)}`;
    const r = countSegments(body);
    expect(r.forcedUcs2By).toBe('ç');
    // 201 UTF-16 units at 67 per part — exactly 3, and the ç is the only
    // reason it is not 2 GSM-7 segments.
    expect(r).toMatchObject({ units: 201, segments: 3 });
    expect(countSegments(body.replace('ç', 'c'))).toMatchObject({ encoding: 'gsm7', segments: 2 });
  });
});
