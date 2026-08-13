import { describe, expect, it } from 'vitest';
import {
  foldForKeywordMatch,
  isAffirmative,
  matchOptOutKeyword,
  matchReOptInKeyword,
  OPT_OUT_EN,
} from './compliance-keywords.js';
import {
  consentExpiryFor,
  dnclExemption,
  fanOutGrant,
  resolveConsent,
  type ConsentRow,
} from './compliance-consent.js';
import {
  allowedWindow,
  nextWindowStart,
  quietHoursDecision,
  resolveRecipientTimezone,
} from './compliance-quiet-hours.js';
import { evaluateSend, type ComplianceFacts, type SendRequest } from './compliance-gate.js';

/**
 * The compliance engine's adversarial suite (compliance-and-quality.md §12).
 *
 * These are not unit tests of convenience. §12 is a red-team list, and the
 * roadmap calls this area binary: "a CASL violation costs up to $10M". So every
 * case here is written as an attack — the question is never "does the happy path
 * work" but "what is the cheapest way to get an unlawful message out".
 *
 * The clock is always injected. Nothing here reads Date.now(), so a test that
 * passes today passes in March when the clocks move.
 */

/** Independent reference for local wall-clock, so the code is not its own oracle. */
function partsIn(tz: string, at: Date): { weekday: string; hour: number; minute: number } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { weekday: String(p['weekday']), hour: Number(p['hour']) % 24, minute: Number(p['minute']) };
}

const CFG = { smsQuietStart: '09:00', smsQuietEnd: '21:00', firstTouchQuietExempt: true };
const TZ = 'America/Toronto';

function consent(over: Partial<ConsentRow> = {}): ConsentRow {
  return {
    id: 'c1',
    channel: 'sms',
    scope: 'conversational',
    consentType: 'express',
    grantedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: null,
    revokedAt: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// RT-13 — the STOP keyword matrix
// ---------------------------------------------------------------------------

describe('RT-13 · somebody says stop', () => {
  it('recognises every opt-out word, in either language, however typed', () => {
    const words = [
      ...OPT_OUT_EN,
      'ARRET', 'ARRÊT', 'arrêt', 'Annuler', 'DESABONNER', 'désabonner', 'FIN',
      'stop', 'Stop', 'STOP.', 'STOP!', '  stop  ', '(STOP)',
    ];
    for (const w of words) {
      expect(matchOptOutKeyword(w), `"${w}" must be understood as stop`).not.toBeNull();
    }
  });

  it('finds the word inside a sentence — "actually STOP" is somebody saying stop', () => {
    // Whole-body equality would sail past this and keep messaging them.
    expect(matchOptOutKeyword('actually STOP')).toMatchObject({ keyword: 'STOP' });
    expect(matchOptOutKeyword('ok merci, ARRET svp')).toMatchObject({ language: 'fr' });
  });

  it('does NOT fire on words that merely contain one', () => {
    // The other failure direction: suppressing a live customer who said nothing
    // of the kind costs the dealership a sale and is invisible.
    for (const w of ['stopping by tomorrow', 'I cancelled my other appointment', 'friendly', 'ENDEAVOUR']) {
      expect(matchOptOutKeyword(w), `"${w}" must NOT be read as stop`).toBeNull();
    }
  });

  it('folds accents and case identically', () => {
    expect(foldForKeywordMatch(' Arrêt  ')).toBe('ARRET');
  });
});

describe('RT-14 · coming back after stop', () => {
  it('START and RECOMMENCER stand alone; YES only answers a question we asked', () => {
    expect(matchReOptInKeyword('START', false)).toMatchObject({ keyword: 'START' });
    expect(matchReOptInKeyword('recommencer', false)).toMatchObject({ language: 'fr' });
    // "yes" in ordinary conversation must never resubscribe somebody — that is
    // consent by accident, which is the thing CASL exists to prevent.
    expect(matchReOptInKeyword('yes please', false)).toBeNull();
    expect(matchReOptInKeyword('yes please', true)).toMatchObject({ keyword: 'YES' });
  });

  it('the affirmative check reads the stored message, not a summary of it', () => {
    // RT-16: a model that can report "they said yes" can be talked into
    // reporting it. This function is given the body re-read from the database.
    expect(isAffirmative('maybe later')).toBeNull();
    expect(isAffirmative('YES')).toMatchObject({ matched: 'YES' });
    expect(isAffirmative('oui, appelez-moi')).toMatchObject({ matched: 'OUI' });
  });
});

// ---------------------------------------------------------------------------
// RT-15 — the consent expiry boundary
// ---------------------------------------------------------------------------

describe('RT-15 · consent runs out', () => {
  it('counts calendar months, so the window can never be longer than stated', () => {
    // 6 months from 31 August is 28 February, not 3 March. A day-count would
    // give two extra days of messaging with no basis.
    const from = new Date('2026-08-31T12:00:00Z');
    const six = consentExpiryFor('implied_inquiry', from)!;
    expect(six.toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(consentExpiryFor('implied_ebr', new Date('2026-01-15T00:00:00Z'))!.toISOString().slice(0, 10))
      .toBe('2028-01-15');
    expect(consentExpiryFor('express', from)).toBeNull();
  });

  it('is live one second before it expires and expired one second after', () => {
    const expiresAt = new Date('2026-07-01T00:00:00Z');
    const rows = [consent({ consentType: 'implied_inquiry', expiresAt })];
    expect(resolveConsent(rows, 'sms', 'conversational', new Date(expiresAt.getTime() - 1000)).state).toBe('live');
    expect(resolveConsent(rows, 'sms', 'conversational', new Date(expiresAt.getTime() + 1000)).state).toBe('expired');
  });

  it('never reads a cached status — expiry passes between nightly sweeps', () => {
    // A row the sweep has not visited yet is still expired. Keying the gate on a
    // status column lets a message out for up to a day past the boundary.
    const rows = [consent({ consentType: 'implied_inquiry', expiresAt: new Date('2026-01-02T00:00:00Z') })];
    const verdict = resolveConsent(rows, 'sms', 'conversational', new Date('2026-06-01T00:00:00Z'));
    expect(verdict.state).toBe('expired');
  });

  it('renewal APPENDS: the longest-lived live row wins, not the newest', () => {
    // §2: "history is never mutated". A second inquiry adds a row; the effective
    // expiry is the furthest one out, and the old row stays exactly as it was.
    const rows = [
      consent({ id: 'old', consentType: 'implied_inquiry', expiresAt: new Date('2026-03-01T00:00:00Z') }),
      consent({ id: 'new', consentType: 'implied_inquiry', expiresAt: new Date('2026-09-01T00:00:00Z') }),
    ];
    const v = resolveConsent(rows, 'sms', 'conversational', new Date('2026-02-01T00:00:00Z'));
    expect(v.state === 'live' && v.row.id).toBe('new');
  });

  it('tells expired and revoked apart, because the remedies differ', () => {
    const revoked = [consent({ revokedAt: new Date('2026-02-01T00:00:00Z') })];
    expect(resolveConsent(revoked, 'sms', 'conversational', new Date('2026-03-01T00:00:00Z')).state).toBe('revoked');
    expect(resolveConsent([], 'sms', 'conversational', new Date()).state).toBe('absent');
  });

  it('an SMS basis does not authorise a different purpose', () => {
    const rows = [consent({ scope: 'conversational' })];
    expect(resolveConsent(rows, 'sms', 'marketing', new Date()).state).toBe('absent');
  });

  it('one act fans out to a row per channel and purpose, each with its own expiry', () => {
    const rows = fanOutGrant({
      consentType: 'implied_inquiry',
      scopes: ['conversational', 'marketing'],
      channels: ['sms', 'email'],
      grantedAt: new Date('2026-01-01T00:00:00Z'),
      source: 'webhook_inquiry',
      evidence: { form: 'website' },
    });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.expiresAt !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RT-17 — quiet hours
// ---------------------------------------------------------------------------

describe('RT-17 · quiet hours are the recipient’s, not ours', () => {
  it('takes the timezone from the postal code, then the area code, then the store', () => {
    // A Montreal dealership texting Vancouver at 21:00 Eastern reaches them at
    // 18:00. The same message at 09:15 Eastern arrives at 06:15.
    expect(resolveRecipientTimezone({ postalCode: 'V6B 1A1', phoneE164: '+15145550100', storeTimezone: TZ }))
      .toMatchObject({ tz: 'America/Vancouver', source: 'postal_code' });
    expect(resolveRecipientTimezone({ postalCode: null, phoneE164: '+16045550100', storeTimezone: TZ }))
      .toMatchObject({ tz: 'America/Vancouver', source: 'area_code' });
    // Every area code §3 names for Quebec.
    for (const ac of ['438', '514', '450', '819', '873']) {
      expect(resolveRecipientTimezone({ postalCode: null, phoneE164: `+1${ac}5550100`, storeTimezone: 'America/Vancouver' }))
        .toMatchObject({ tz: 'America/Toronto', source: 'area_code' });
    }
    // Unknown is a fallback, not an error — and it is RECORDED as a fallback.
    expect(resolveRecipientTimezone({ postalCode: null, phoneE164: '+12125550100', storeTimezone: TZ }))
      .toMatchObject({ tz: TZ, source: 'store' });
  });

  it('uses the CRTC voice windows, which differ at the weekend', () => {
    expect(allowedWindow('voice', 3, CFG)).toMatchObject({ startMinute: 540, endMinute: 1290 });
    expect(allowedWindow('voice', 6, CFG)).toMatchObject({ startMinute: 600, endMinute: 1080 });
  });

  it('a voice call refused late on FRIDAY waits for Saturday at 10:00, not 09:00', () => {
    // The hop §3 makes and a naive "tomorrow at the usual time" would miss.
    const friday2135 = new Date('2026-08-14T01:35:00Z'); // 21:35 the previous evening in Toronto
    const local = partsIn(TZ, friday2135);
    expect(local.weekday).toBe('Thu'); // sanity: confirm the instant we built
    const fridayNight = new Date('2026-08-15T01:35:00Z'); // Fri 21:35 Toronto
    expect(partsIn(TZ, fridayNight).weekday).toBe('Fri');

    const d = quietHoursDecision({
      nowUtc: fridayNight, tz: TZ, channel: 'voice',
      messageClass: 'outbound_voice', cfg: CFG, jitterMs: 0,
    });
    expect(d.status).toBe('deferred');
    if (d.status !== 'deferred') return;
    const start = partsIn(TZ, d.windowStartUtc);
    expect(start.weekday).toBe('Sat');
    expect(start.hour).toBe(10);
    expect(start.minute).toBe(0);
  });

  it('spreads the queue with injected jitter rather than firing at exactly 09:00:00', () => {
    const night = new Date('2026-08-12T05:00:00Z'); // 01:00 Toronto, a Wednesday
    const d = quietHoursDecision({
      nowUtc: night, tz: TZ, channel: 'sms', messageClass: 'drip', cfg: CFG, jitterMs: 600_000,
    });
    expect(d.status).toBe('deferred');
    if (d.status !== 'deferred') return;
    expect(d.runAt.getTime() - d.windowStartUtc.getTime()).toBe(600_000);
    expect(partsIn(TZ, d.windowStartUtc)).toMatchObject({ hour: 9, minute: 0 });
  });

  it('refuses a jitter outside the mandated range rather than silently clamping', () => {
    expect(() => quietHoursDecision({
      nowUtc: new Date(), tz: TZ, channel: 'sms', messageClass: 'drip', cfg: CFG, jitterMs: 3_600_000,
    })).toThrow(/jitterMs/);
  });

  it('defers a drip at 21:30 and allows one at 20:59', () => {
    const at = (utc: string) => quietHoursDecision({
      nowUtc: new Date(utc), tz: TZ, channel: 'sms', messageClass: 'drip', cfg: CFG, jitterMs: 0,
    }).status;
    expect(at('2026-08-12T01:30:00Z')).toBe('deferred'); // 21:30 local
    expect(at('2026-08-12T00:59:00Z')).toBe('allowed');  // 20:59 local
  });

  it('answers somebody who texts at 03:00, always', () => {
    // They are awake; they just messaged us. Making them wait until 09:00 for an
    // answer they asked for at 03:00 is worse service and no more lawful.
    const d = quietHoursDecision({
      nowUtc: new Date('2026-08-12T07:00:00Z'), tz: TZ, channel: 'sms',
      messageClass: 'inbound_reply', cfg: CFG, jitterMs: 0,
    });
    expect(d).toMatchObject({ status: 'allowed', windowApplied: 'skipped:inbound_reply' });
  });

  it('honours the first-touch exemption, and honours it being switched off', () => {
    const night = new Date('2026-08-12T07:00:00Z'); // 03:00 local
    expect(quietHoursDecision({
      nowUtc: night, tz: TZ, channel: 'sms', messageClass: 'first_touch', cfg: CFG, jitterMs: 0,
    }).status).toBe('allowed');
    expect(quietHoursDecision({
      nowUtc: night, tz: TZ, channel: 'sms', messageClass: 'first_touch',
      cfg: { ...CFG, firstTouchQuietExempt: false }, jitterMs: 0,
    }).status).toBe('deferred');
  });

  it('never exempts a VOICE call — §3 says "Exemptions: None"', () => {
    const d = quietHoursDecision({
      nowUtc: new Date('2026-08-12T07:00:00Z'), tz: TZ, channel: 'voice',
      messageClass: 'first_touch', cfg: CFG, jitterMs: 0,
    });
    expect(d.status).toBe('deferred');
  });

  it('always lands inside the window it computed, across a whole week', () => {
    // Property rather than a table: whatever the day, the next start is in the
    // future and is a legal opening. This is what catches the DST Sunday.
    for (let h = 0; h < 24 * 7; h += 5) {
      const now = new Date(Date.UTC(2026, 2, 6, h, 17)); // spans the March change
      for (const channel of ['sms', 'voice'] as const) {
        const start = nextWindowStart(now, TZ, channel, CFG);
        expect(start.getTime()).toBeGreaterThan(now.getTime());
        const p = partsIn(TZ, start);
        const w = allowedWindow(channel, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), CFG);
        expect(p.hour * 60 + p.minute, `${channel} @ ${start.toISOString()}`).toBe(w.startMinute);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The gate — order, and the attacks that try to jump it
// ---------------------------------------------------------------------------

describe('the gate refuses in the right order', () => {
  const baseReq: SendRequest = {
    organizationId: 'o1', storeId: 's1', leadId: 'l1',
    phoneE164: '+15145550100', email: null,
    channel: 'sms', scope: 'conversational', messageClass: 'follow_up',
    originator: 'ai', isSolicitation: false,
    nowUtc: new Date('2026-08-12T18:00:00Z'), // 14:00 Toronto — comfortably open
    jitterMs: 0,
  };
  const baseFacts: ComplianceFacts = {
    suppressed: null,
    consentRows: [consent()],
    postalCode: null,
    storeTimezone: TZ,
    quietHours: CFG,
    onInternalDnc: false,
    newestDnclDownloadedAt: new Date('2026-08-10T00:00:00Z'),
    phoneOnDnclList: false,
    aiInitiatedSoFarToday: 0,
    aiDailyContactCap: 3,
    aiSendsSuspended: false,
  };

  it('allows a lawful message and names the row that made it lawful', () => {
    const d = evaluateSend(baseReq, baseFacts);
    expect(d.status).toBe('allowed');
    // "We had consent" is not a defence. "We relied on THIS row" is.
    expect(d.status === 'allowed' && d.consentLedgerId).toBe('c1');
  });

  it('blocks a suppressed number even inside the allowed window', () => {
    // §1: "nothing skips suppression or consent."
    const d = evaluateSend(baseReq, {
      ...baseFacts, suppressed: { channel: 'sms', createdAt: new Date('2026-08-01T00:00:00Z') },
    });
    expect(d).toMatchObject({ status: 'blocked', reason: 'suppressed' });
  });

  it('blocks a suppressed number even for an inbound reply', () => {
    // The most tempting exemption to grant, and the one §1 explicitly refuses.
    const d = evaluateSend(
      { ...baseReq, messageClass: 'inbound_reply' },
      { ...baseFacts, suppressed: { channel: 'sms', createdAt: new Date() } },
    );
    expect(d).toMatchObject({ status: 'blocked', reason: 'suppressed' });
  });

  it('reports suppression BEFORE consent, so the operator fixes the real cause', () => {
    const d = evaluateSend(baseReq, {
      ...baseFacts, consentRows: [], suppressed: { channel: 'sms', createdAt: new Date() },
    });
    expect(d.status === 'blocked' && d.reason).toBe('suppressed');
  });

  it('defers rather than drops when the only problem is the hour', () => {
    // A drop is a customer who never hears back. §3's only edge out of quiet
    // hours is "re-enqueue at the next allowed window".
    const d = evaluateSend({ ...baseReq, nowUtc: new Date('2026-08-12T07:00:00Z') }, baseFacts);
    expect(d).toMatchObject({ status: 'deferred', reason: 'quiet_hours' });
    expect(d.status === 'deferred' && d.runAt.getTime()).toBeGreaterThan(Date.parse('2026-08-12T07:00:00Z'));
  });

  it('silences the assistant the moment a human takes over', () => {
    const d = evaluateSend(baseReq, { ...baseFacts, aiSendsSuspended: true });
    expect(d).toMatchObject({ status: 'blocked', reason: 'ai_suspended' });
    // A person sending by hand is unaffected.
    expect(evaluateSend({ ...baseReq, originator: 'human' }, { ...baseFacts, aiSendsSuspended: true }).status)
      .toBe('allowed');
  });

  it('caps assistant-initiated contacts but never a reply the customer asked for', () => {
    const capped = { ...baseFacts, aiInitiatedSoFarToday: 3 };
    expect(evaluateSend(baseReq, capped)).toMatchObject({ status: 'blocked', reason: 'frequency_cap' });
    expect(evaluateSend({ ...baseReq, messageClass: 'inbound_reply' }, capped).status).toBe('allowed');
  });
});

describe('RT-16 · getting an automated call out without consent', () => {
  const voiceReq: SendRequest = {
    organizationId: 'o1', storeId: 's1', leadId: 'l1',
    phoneE164: '+15145550100', email: null,
    channel: 'voice', scope: 'ai_outbound_call', messageClass: 'outbound_voice',
    originator: 'ai', isSolicitation: true,
    nowUtc: new Date('2026-08-12T18:00:00Z'),
    jitterMs: 0,
  };
  const voiceFacts: ComplianceFacts = {
    suppressed: null,
    consentRows: [consent({ id: 'call', channel: 'voice', scope: 'ai_outbound_call', consentType: 'express' })],
    postalCode: null, storeTimezone: TZ, quietHours: CFG,
    onInternalDnc: false,
    newestDnclDownloadedAt: new Date('2026-08-10T00:00:00Z'),
    phoneOnDnclList: false,
    aiInitiatedSoFarToday: 0, aiDailyContactCap: 3, aiSendsSuspended: false,
  };

  it('allows the call only with EXPRESS call consent', () => {
    expect(evaluateSend(voiceReq, voiceFacts).status).toBe('allowed');
  });

  it('refuses when the basis is merely implied, however recent', () => {
    // §4: an automated call is lawful for solicitation "only with prior express
    // consent". A purchase last week is not that.
    const implied = [consent({
      id: 'ebr', channel: 'voice', scope: 'ai_outbound_call',
      consentType: 'implied_ebr', expiresAt: new Date('2028-01-01T00:00:00Z'),
    })];
    expect(evaluateSend(voiceReq, { ...voiceFacts, consentRows: implied }))
      .toMatchObject({ status: 'blocked', reason: 'adad_no_express_consent' });
  });

  it('refuses when the express consent has been revoked', () => {
    const revoked = [consent({
      id: 'call', channel: 'voice', scope: 'ai_outbound_call',
      consentType: 'express', revokedAt: new Date('2026-08-01T00:00:00Z'),
    })];
    expect(evaluateSend(voiceReq, { ...voiceFacts, consentRows: revoked }).status).toBe('blocked');
  });

  it('an SMS consent never authorises a CALL', () => {
    const smsOnly = [consent({ id: 'sms', channel: 'sms', scope: 'ai_outbound_call', consentType: 'express' })];
    expect(evaluateSend(voiceReq, { ...voiceFacts, consentRows: smsOnly }))
      .toMatchObject({ status: 'blocked', reason: 'consent_absent' });
  });

  it('the internal do-not-call list has no exemptions at all', () => {
    // §4, verbatim: "No exemptions to internal DNC." Not even express consent.
    expect(evaluateSend(voiceReq, { ...voiceFacts, onInternalDnc: true }))
      .toMatchObject({ status: 'blocked', reason: 'internal_dnc' });
  });

  it('stops ALL solicitation when the national list is too old to rely on', () => {
    // Past 31 days the list is not "probably still fine" — it is not a defence.
    // A consent exemption does not bypass this: if we cannot prove any number
    // was clear, we stop calling.
    const stale = { ...voiceFacts, newestDnclDownloadedAt: new Date('2026-06-01T00:00:00Z') };
    const d = evaluateSend(voiceReq, stale);
    expect(d).toMatchObject({ status: 'blocked', reason: 'dncl_list_stale', alert: 'HIGH' });
  });

  it('treats "no list has ever been loaded" as the worst kind of stale', () => {
    // The fail-closed default. A fresh install must not be able to cold-call.
    expect(evaluateSend(voiceReq, { ...voiceFacts, newestDnclDownloadedAt: null }))
      .toMatchObject({ status: 'blocked', reason: 'dncl_list_stale' });
  });

  it('scrubs a listed number, and an SMS consent does not rescue it', () => {
    const listed = { ...voiceFacts, phoneOnDnclList: true };
    // The express VOICE row exempts, which is what §4 allows.
    expect(evaluateSend(voiceReq, listed).status).toBe('allowed');

    // A marketing consent for TEXTS must not exempt a number from a CALLING
    // list — they are different acts, and conflating them is how somebody who
    // agreed to texts starts getting phone calls.
    expect(dnclExemption([consent({ id: 'm', channel: 'sms', scope: 'marketing' })], new Date())).toBeNull();

    // Proven through the gate. The basis here is a live IMPLIED INQUIRY on
    // voice: enough to talk to them, and deliberately NOT one of the two bases
    // §4 accepts as an exemption. Dialled by a person, so the ADAD rule cannot
    // be what refuses it — the national list is.
    const inquiryOnly = [consent({
      id: 'inq', channel: 'voice', scope: 'conversational',
      consentType: 'implied_inquiry', expiresAt: new Date('2027-01-01T00:00:00Z'),
    })];
    const d = evaluateSend(
      { ...voiceReq, originator: 'human', scope: 'conversational' },
      { ...listed, consentRows: inquiryOnly },
    );
    expect(d).toMatchObject({ status: 'blocked', reason: 'dncl_listed' });

    // And the same number, same list, with an express voice basis → exempt.
    const express = [consent({ id: 'x', channel: 'voice', scope: 'conversational', consentType: 'express' })];
    expect(evaluateSend(
      { ...voiceReq, originator: 'human', scope: 'conversational' },
      { ...listed, consentRows: express },
    ).status).toBe('allowed');
  });

  it('a human dialling by hand is not an automated call', () => {
    // §4 excludes click-to-call from the ADAD rule: it is gated by quiet hours
    // and the calling lists only. The facts here carry NO ai_outbound_call
    // consent at all, so an assistant would be refused on the same inputs.
    const noCallConsent = [consent({ id: 'conv', channel: 'voice', scope: 'conversational', consentType: 'express' })];
    const humanFacts = { ...voiceFacts, consentRows: noCallConsent };
    expect(evaluateSend({ ...voiceReq, originator: 'human', scope: 'conversational' }, humanFacts).status)
      .toBe('allowed');
    // Same inputs, assistant instead of a person → refused.
    expect(evaluateSend({ ...voiceReq, originator: 'ai', scope: 'conversational' }, humanFacts))
      .toMatchObject({ status: 'blocked', reason: 'adad_no_express_consent' });
  });
});
