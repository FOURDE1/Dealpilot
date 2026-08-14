/**
 * How many SMS segments a message costs (ADR-024).
 *
 * This is a money calculation, so it lives in core beside the other ones and is
 * computed rather than guessed. A carrier bills per segment, and the boundary
 * between one segment and two is not a length — it is an alphabet.
 *
 * The Quebec-first part matters more than it looks. GSM-7 carries `é`, `è`, `à`
 * and `ù`, so most French text fits 160 characters. It does NOT carry lowercase
 * `ç`, `œ`, `€`-adjacent typography, or curly quotes — and a single one of those
 * drops the whole message to UCS-2 at 70 characters. "Ça va" and "Ca va" are the
 * same sentence and a 2.3× difference in price, which is exactly the kind of
 * thing nobody notices until the invoice.
 */

/**
 * GSM 03.38 basic set — one septet each.
 *
 * Written out rather than expressed as ranges because the set is not a range:
 * it interleaves Latin, Greek capitals that happen to have their own code
 * points, and currency symbols, and every "obvious" shortcut gets one wrong.
 */
const GSM_BASIC = new Set(
  [
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ',
    ' !"#¤%&\'()*+,-./',
    '0123456789:;<=>?',
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§',
    '¿abcdefghijklmnopqrstuvwxyzäöñüà',
  ]
    .join('')
    .split(''),
);

/** GSM 03.38 extension table — two septets each (an escape, then the char). */
const GSM_EXTENDED = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);

/** Septets available in one message, and in each part of a concatenated one. */
const GSM_SINGLE = 160;
const GSM_CONCAT = 153; // 7 septets go to the UDH that reassembles the parts

/** UTF-16 code units available, likewise. */
const UCS2_SINGLE = 70;
const UCS2_CONCAT = 67;

export type SmsEncoding = 'gsm7' | 'ucs2';

export interface SegmentCount {
  readonly encoding: SmsEncoding;
  /** Billable parts. Always at least 1, even for an empty body. */
  readonly segments: number;
  /** Septets for GSM-7, UTF-16 code units for UCS-2. */
  readonly units: number;
  /**
   * The first character that forced UCS-2, if any. Null on GSM-7.
   *
   * Returned because "why is this message costing triple?" is a question an
   * operator will ask, and the answer is one character they can usually change.
   */
  readonly forcedUcs2By: string | null;
}

/**
 * Count what a carrier will bill for.
 *
 * Deliberately returns the encoding and the culprit rather than a bare number:
 * a segment count on its own tells an operator that something is expensive
 * without telling them what to do about it.
 */
export function countSegments(body: string): SegmentCount {
  let units = 0;
  let forcedUcs2By: string | null = null;

  // Iterated by code POINT, not by index: an emoji is one character to a person
  // and two UTF-16 code units to a carrier, and `body[i]` would split it.
  for (const ch of body) {
    if (GSM_BASIC.has(ch)) {
      units += 1;
      continue;
    }
    if (GSM_EXTENDED.has(ch)) {
      units += 2;
      continue;
    }
    forcedUcs2By ??= ch;
  }

  if (forcedUcs2By !== null) {
    // UCS-2 counts UTF-16 code units, so an astral character costs two.
    const ucs2Units = [...body].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
    return {
      encoding: 'ucs2',
      segments: ucs2Units <= UCS2_SINGLE ? 1 : Math.ceil(ucs2Units / UCS2_CONCAT),
      units: ucs2Units,
      forcedUcs2By,
    };
  }

  return {
    encoding: 'gsm7',
    segments: units <= GSM_SINGLE ? 1 : Math.ceil(units / GSM_CONCAT),
    units,
    forcedUcs2By: null,
  };
}
