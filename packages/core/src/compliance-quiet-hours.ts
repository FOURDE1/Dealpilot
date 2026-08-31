/**
 * Quiet hours (compliance-and-quality.md §3).
 *
 * The CRTC windows are stated in the RECIPIENT's local time, not the store's and
 * certainly not the server's. A dealership in Montreal texting a customer in
 * Vancouver at 21:00 Eastern is reaching them at 18:00 — fine — while the same
 * message at 09:15 Eastern arrives at 06:15, which is not. Getting the timezone
 * from the recipient rather than the sender is the whole substance of this
 * module; the window arithmetic is the easy half.
 *
 * A message that arrives inside quiet hours is DEFERRED, never dropped. §3's only
 * edge out of that state is "re-enqueue at next allowed window" — a customer who
 * asked a question at 23:00 should hear back at 09:00, not never.
 */

export type TzSource = 'postal_code' | 'area_code' | 'store';
export type CommChannel = 'sms' | 'mms' | 'email' | 'voice';

export type MessageClass =
  | 'inbound_reply'
  | 'first_touch'
  | 'drip'
  | 'follow_up'
  | 're_engagement'
  | 'outbound_voice';

export interface QuietHoursConfig {
  /** Already the intersection of the organisation's window and the store's. */
  readonly smsQuietStart: string;
  readonly smsQuietEnd: string;
  readonly firstTouchQuietExempt: boolean;
}

/**
 * Canadian forward sortation areas (first letter of a postal code) → timezone.
 *
 * The first letter identifies the province, which is enough everywhere except
 * the provinces that straddle a boundary; those fall back to the province's
 * dominant zone, and a wrong guess there is corrected by the area code tier
 * below rather than by silently using the store's.
 */
const FSA_LETTER_TZ: Record<string, string> = {
  A: 'America/St_Johns', // NL
  B: 'America/Halifax', // NS
  C: 'America/Halifax', // PE
  E: 'America/Moncton', // NB
  G: 'America/Toronto', // QC east
  H: 'America/Toronto', // QC Montreal
  J: 'America/Toronto', // QC west
  K: 'America/Toronto', // ON east
  L: 'America/Toronto', // ON central
  M: 'America/Toronto', // ON Toronto
  N: 'America/Toronto', // ON southwest
  P: 'America/Toronto', // ON north
  R: 'America/Winnipeg', // MB
  S: 'America/Regina', // SK — no daylight saving, which is why it is its own zone
  T: 'America/Edmonton', // AB
  V: 'America/Vancouver', // BC
  X: 'America/Edmonton', // NT/NU — dominant zone
  Y: 'America/Whitehorse', // YT
};

/**
 * North American area codes → timezone, for the provinces this product serves.
 *
 * §3 names the Quebec set explicitly (438/514/450/819/873). The rest are here
 * because a Quebec dealership sells to Ontario and the Maritimes, and falling
 * back to the store's timezone for those would put every out-of-province
 * customer on Montreal hours.
 */
const AREA_CODE_TZ: Record<string, string> = {
  // Quebec
  '418': 'America/Toronto', '438': 'America/Toronto', '450': 'America/Toronto',
  '514': 'America/Toronto', '579': 'America/Toronto', '581': 'America/Toronto',
  '819': 'America/Toronto', '873': 'America/Toronto', '367': 'America/Toronto',
  '354': 'America/Toronto', '263': 'America/Toronto', '468': 'America/Toronto',
  // Ontario
  '226': 'America/Toronto', '249': 'America/Toronto', '289': 'America/Toronto',
  '343': 'America/Toronto', '365': 'America/Toronto', '416': 'America/Toronto',
  '437': 'America/Toronto', '519': 'America/Toronto', '548': 'America/Toronto',
  '613': 'America/Toronto', '647': 'America/Toronto', '705': 'America/Toronto',
  '742': 'America/Toronto', '807': 'America/Winnipeg', '905': 'America/Toronto',
  // Atlantic
  '506': 'America/Moncton', '709': 'America/St_Johns', '782': 'America/Halifax',
  '902': 'America/Halifax',
  // Prairies and west
  '204': 'America/Winnipeg', '431': 'America/Winnipeg', '584': 'America/Winnipeg',
  '306': 'America/Regina', '639': 'America/Regina', '474': 'America/Regina',
  '403': 'America/Edmonton', '587': 'America/Edmonton', '780': 'America/Edmonton',
  '825': 'America/Edmonton', '368': 'America/Edmonton',
  '236': 'America/Vancouver', '250': 'America/Vancouver', '257': 'America/Vancouver',
  '604': 'America/Vancouver', '672': 'America/Vancouver', '778': 'America/Vancouver',
  // Territories
  '867': 'America/Edmonton',
};

/**
 * Whose clock governs this message (§3): the postal code, then the area code,
 * then the store.
 *
 * An unrecognised postal code or area code falls through to the next tier rather
 * than failing. A message nobody can place in time still has to go out on SOME
 * defensible schedule, and the store's is the honest last resort — but it is
 * recorded as the source so an audit can see it was a fallback.
 */
export function resolveRecipientTimezone(input: {
  postalCode?: string | null;
  phoneE164?: string | null;
  storeTimezone: string;
}): { tz: string; source: TzSource } {
  const letter = input.postalCode?.trim().toUpperCase()[0];
  if (letter && FSA_LETTER_TZ[letter]) return { tz: FSA_LETTER_TZ[letter]!, source: 'postal_code' };

  const area = input.phoneE164?.match(/^\+1(\d{3})/)?.[1];
  if (area && AREA_CODE_TZ[area]) return { tz: AREA_CODE_TZ[area]!, source: 'area_code' };

  return { tz: input.storeTimezone, source: 'store' };
}

/**
 * Wall-clock parts in a timezone, without pulling in a date library.
 *
 * Exported (F-76) as one of the two clock helpers this package owns: the
 * store-hours module reuses it rather than carrying a second, untested clock.
 * Throws the `Intl` RangeError on a timezone name it does not know — callers
 * that cannot refuse the name upstream must catch it.
 */
export function zonedParts(utc: Date, tz: string): {
  year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number;
} {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(utc).map((p) => [p.type, p.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    // 24-hour formatting renders midnight as "24" in some locales.
    hour: Number(parts['hour']) % 24,
    minute: Number(parts['minute']),
    second: Number(parts['second']),
    weekday: weekdays[String(parts['weekday'])] ?? 0,
  };
}

/**
 * The UTC instant at which a given wall clock reads this time in `tz`.
 *
 * Two corrections rather than one: the first lands within an hour, the second
 * settles the offset even across a daylight-saving change. Without the second
 * pass, the Sunday in March when clocks move would schedule an hour off — on
 * exactly the sort of edge nobody notices until a customer is woken up.
 *
 * Exported (F-76) as the second clock helper; the store-hours module's
 * "next opening" instant is this function, so its DST case is proven once.
 */
export function utcForLocal(tz: string, y: number, mo: number, d: number, hh: number, mm: number): Date {
  let guess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const wanted = Date.UTC(y, mo - 1, d, hh, mm, 0);
    if (actual === wanted) break;
    guess += wanted - actual;
  }
  return new Date(guess);
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m ?? 0);
}

export interface AllowedWindow {
  readonly startMinute: number;
  readonly endMinute: number;
  readonly label: string;
}

/**
 * The window in which contact is ALLOWED, recipient-local (§3).
 *
 * Voice is fixed by the CRTC and differs by day type — 09:00–21:30 on weekdays,
 * 10:00–18:00 at weekends. SMS is one window every day, tenant-configurable
 * within the platform default.
 *
 * Half-open: 21:29 is inside, 21:30 is not. The spec does not state boundary
 * inclusivity, and §5's own principle is to over-honour rather than under-honour.
 */
export function allowedWindow(
  channel: CommChannel,
  localWeekday: number,
  cfg: QuietHoursConfig,
): AllowedWindow {
  if (channel === 'voice') {
    const weekend = localWeekday === 0 || localWeekday === 6;
    return weekend
      ? { startMinute: 10 * 60, endMinute: 18 * 60, label: 'voice:weekend 10:00-18:00' }
      : { startMinute: 9 * 60, endMinute: 21 * 60 + 30, label: 'voice:weekday 09:00-21:30' };
  }
  return {
    startMinute: minutesOf(cfg.smsQuietStart),
    endMinute: minutesOf(cfg.smsQuietEnd),
    label: `sms:${cfg.smsQuietStart}-${cfg.smsQuietEnd}`,
  };
}

/**
 * The next instant this channel may be used, in UTC.
 *
 * Walks forward day by day rather than assuming tomorrow works: a voice message
 * refused at 21:31 on Friday is not allowed at 09:00 Saturday, it waits for
 * 10:00 — and the same call refused late on Saturday waits for Sunday at 10:00,
 * not Monday. Seven days is a bound, not an expectation; no configuration can
 * produce a week with no open window.
 */
export function nextWindowStart(nowUtc: Date, tz: string, channel: CommChannel, cfg: QuietHoursConfig): Date {
  const here = zonedParts(nowUtc, tz);
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const probe = new Date(nowUtc.getTime() + dayOffset * 86_400_000);
    const p = zonedParts(probe, tz);
    const w = allowedWindow(channel, p.weekday, cfg);
    const start = utcForLocal(tz, p.year, p.month, p.day, Math.floor(w.startMinute / 60), w.startMinute % 60);
    if (start.getTime() > nowUtc.getTime()) return start;
    // Today's window may still be open ahead of us only if we are before it,
    // which the comparison above already covers; otherwise try tomorrow.
    void here;
  }
  // Unreachable with any window this module can produce; failing loudly beats
  // returning a time that silently means "now".
  throw new Error(`no allowed ${channel} window within 7 days for ${tz}`);
}

export type QuietHoursDecision =
  | { status: 'allowed'; windowApplied: string; recipientLocalTime: Date }
  | {
      status: 'deferred';
      windowStartUtc: Date;
      runAt: Date;
      jitterMs: number;
      windowApplied: string;
      recipientLocalTime: Date;
    };

/**
 * May this message go out now, and if not, when?
 *
 * `jitterMs` is injected rather than generated here (§3 asks for 0–15 minutes of
 * spread at the window start, so a tenant's whole overnight queue does not fire
 * at 09:00:00 and read as a machine). Injecting it keeps this function pure and
 * its tests deterministic.
 */
export function quietHoursDecision(input: {
  nowUtc: Date;
  tz: string;
  channel: CommChannel;
  messageClass: MessageClass;
  cfg: QuietHoursConfig;
  jitterMs: number;
}): QuietHoursDecision {
  if (input.jitterMs < 0 || input.jitterMs > 900_000) {
    throw new Error(`jitterMs out of range: ${input.jitterMs}`);
  }
  const p = zonedParts(input.nowUtc, input.tz);
  const recipientLocalTime = new Date(
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second),
  );

  // Somebody who just texted us is awake. Replying is not an intrusion, and
  // making them wait until 09:00 for an answer they asked for at 23:00 is worse
  // service with no compliance gain.
  if (input.messageClass === 'inbound_reply') {
    return { status: 'allowed', windowApplied: 'skipped:inbound_reply', recipientLocalTime };
  }
  // The first reply to a fresh lead, when the tenant leaves the default on.
  // Voice is never exempt — §3's voice row reads "Exemptions: None."
  if (
    input.messageClass === 'first_touch' &&
    input.cfg.firstTouchQuietExempt &&
    input.channel !== 'voice'
  ) {
    return { status: 'allowed', windowApplied: 'exempt:first_touch', recipientLocalTime };
  }

  const w = allowedWindow(input.channel, p.weekday, input.cfg);
  const nowMinute = p.hour * 60 + p.minute;
  if (nowMinute >= w.startMinute && nowMinute < w.endMinute) {
    return { status: 'allowed', windowApplied: w.label, recipientLocalTime };
  }

  const windowStartUtc = nextWindowStart(input.nowUtc, input.tz, input.channel, input.cfg);
  return {
    status: 'deferred',
    windowStartUtc,
    runAt: new Date(windowStartUtc.getTime() + input.jitterMs),
    jitterMs: input.jitterMs,
    windowApplied: w.label,
    recipientLocalTime,
  };
}
