import { describe, expect, it } from 'vitest';
import {
  findConnector,
  normalizeLead,
  normalizeLanguage,
  normalizePhone,
  readPath,
  type ConnectorDefinition,
} from './intake-connector.js';

/**
 * The intake connector framework (ADR-005).
 *
 * Two things are being protected here. One is boring and constant: lead
 * providers send the same person's phone number in six different shapes, and
 * every compliance mechanism in this product keys on that number. The other is
 * the expensive one: an unticked consent box must never become a consent.
 */

const at = new Date('2026-05-01T14:00:00Z');
const website = findConnector('website_form')!;

describe('phone numbers arrive in every shape and must leave in one', () => {
  it('accepts the forms providers actually send', () => {
    // Storing these as sent would make the suppression list, the consent ledger
    // and the do-not-call list all miss — every one of them keys on the number,
    // so a customer who said STOP would keep being messaged from a differently
    // formatted copy of their own number.
    for (const raw of [
      '(514) 555-0100', '514-555-0100', '514.555.0100', '5145550100',
      '1 514 555 0100', '+1 (514) 555-0100', ' +15145550100 ',
    ]) {
      expect(normalizePhone(raw), raw).toBe('+15145550100');
    }
  });

  it('refuses anything it cannot read, rather than guessing', () => {
    // A wrong number is worse than a missing one: it is somebody else's phone,
    // and everything downstream would treat it as this customer's.
    for (const raw of ['555-0100', '123', '', '000-000-0000', '+44 20 7946 0000', 'call me']) {
      expect(normalizePhone(raw), raw).toBeNull();
    }
    // NANP forbids a leading 0 or 1 on the area code and the exchange.
    expect(normalizePhone('114-555-0100')).toBeNull();
    expect(normalizePhone('514-155-0100')).toBeNull();
  });

  it('defaults language to French, this being a Quebec-first product', () => {
    expect(normalizeLanguage(null)).toBe('fr-CA');
    expect(normalizeLanguage('')).toBe('fr-CA');
    expect(normalizeLanguage('fr')).toBe('fr-CA');
    expect(normalizeLanguage('en_US')).toBe('en-CA');
    expect(normalizeLanguage('English')).toBe('en-CA');
  });
});

describe('reading a provider payload', () => {
  it('walks dotted and indexed paths', () => {
    const p = { contact: { email: 'a@b.test' }, items: [{ v: 'first' }, { v: 'second' }] };
    expect(readPath(p, 'contact.email')).toBe('a@b.test');
    expect(readPath(p, 'items[1].v')).toBe('second');
    expect(readPath(p, 'nope.at.all')).toBeUndefined();
  });

  it('takes the first path that has anything, so a renamed field is a config change', () => {
    // The point of the framework: a provider renames `phone` to `phone_number`
    // on a Tuesday and the fix is a definition edit, not a deployment.
    const r = normalizeLead({ phone_number: '514-555-0100', firstName: 'Marie' }, website, at);
    expect(r.lead.phone).toBe('+15145550100');
    expect(r.lead.first_name).toBe('Marie');
  });

  it('never throws on a payload it does not recognise', () => {
    // An intake endpoint that 500s on a renamed field loses leads silently and
    // blames the provider.
    const r = normalizeLead({ totally: { unexpected: true } }, website, at);
    expect(r.lead.phone).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('says so when a number arrives that it cannot read', () => {
    const r = normalizeLead({ phone: 'call the shop', email: 'x@y.test' }, website, at);
    expect(r.warnings.some((w) => w.includes('could not be read'))).toBe(true);
  });
});

describe('what the consent box on a form actually granted', () => {
  it('records a basis when the box was ticked, with the wording as evidence', () => {
    const r = normalizeLead(
      {
        phone: '514-555-0100', email: 'Marie@Example.TEST',
        consent: true, consent_text: 'I agree to be contacted about this vehicle',
      },
      website,
      at,
    );
    expect(r.consent).toHaveLength(2); // sms + email
    expect(r.consent.every((c) => c.scope === 'conversational')).toBe(true);
    expect(r.consent.every((c) => c.consentType === 'implied_inquiry')).toBe(true);
    // The wording IS the evidence: without it we can say somebody agreed but not
    // to what, which is the question a regulator asks.
    expect(r.consent[0]!.evidence['form_wording']).toContain('agree to be contacted');
    expect(r.lead.email, 'emails are compared case-insensitively downstream').toBe('marie@example.test');
  });

  it('records NOTHING when the box was not ticked', () => {
    // The most expensive mistake available in this file. A form WITH a consent
    // box that was left alone granted nothing at all.
    for (const consent of [false, 'false', 'no', 0, '', undefined, null]) {
      const r = normalizeLead({ phone: '514-555-0100', consent }, website, at);
      expect(r.consent, `consent=${String(consent)}`).toEqual([]);
      expect(r.warnings.some((w) => w.includes('not ticked'))).toBe(true);
    }
  });

  it('understands the shapes a ticked box arrives in', () => {
    for (const consent of [true, 'true', 'yes', 'Y', 1, 'on', 'oui']) {
      const r = normalizeLead({ phone: '514-555-0100', consent, consent_text: 'ok' }, website, at);
      expect(r.consent.length, `consent=${String(consent)}`).toBeGreaterThan(0);
    }
  });

  it('never records a basis on a channel with no address for it', () => {
    // An SMS consent with no phone number is a row no gate can ever find — it
    // looks like protection and is nothing.
    const noPhone = normalizeLead({ email: 'x@y.test', consent: true, consent_text: 'ok' }, website, at);
    expect(noPhone.consent.every((c) => c.channel === 'email')).toBe(true);

    const noEmail = normalizeLead({ phone: '514-555-0100', consent: true, consent_text: 'ok' }, website, at);
    expect(noEmail.consent.every((c) => c.channel === 'sms')).toBe(true);
  });

  it('warns when the provider sent no wording to record', () => {
    const r = normalizeLead({ phone: '514-555-0100', consent: true }, website, at);
    expect(r.consent.length).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.includes('wording'))).toBe(true);
  });

  it('gives an enquiry six months and nothing more', () => {
    const r = normalizeLead(
      { phone: '514-555-0100', consent: true, consent_text: 'contact me' },
      website,
      at,
    );
    expect(r.consent[0]!.expiresAt!.toISOString().slice(0, 10)).toBe('2026-11-01');
    // An enquiry is not a marketing list, whatever the dealership would prefer.
    expect(r.consent.some((c) => c.scope === 'marketing')).toBe(false);
  });

  it('honours a form that genuinely granted marketing', () => {
    // Per-connector because it is a fact about THAT form: a site whose box says
    // "send me offers" granted marketing, and wanting the other kind to be this
    // one does not make it so.
    const offers: ConnectorDefinition = {
      ...website,
      key: 'offers_form',
      consent: {
        checkboxPath: 'consent',
        wordingPath: 'consent_text',
        grants: { consentType: 'express', channels: ['email'], scopes: ['marketing'] },
      },
    };
    const r = normalizeLead(
      { email: 'x@y.test', consent: true, consent_text: 'Send me offers and promotions' },
      offers,
      at,
    );
    expect(r.consent[0]).toMatchObject({ scope: 'marketing', consentType: 'express' });
    // Express consent does not expire — it is withdrawn, not outlived.
    expect(r.consent[0]!.expiresAt).toBeNull();
  });
});

describe('the same enquiry arriving twice', () => {
  it('produces the same key, because every provider retries webhooks', () => {
    // Without this, a retry is a second lead and a second first-touch text to
    // somebody who enquired once.
    const payload = { phone: '(514) 555-0100', email: 'A@B.test', vehicle: 'Forte' };
    const again = { phone: '+1 514 555 0100', email: 'a@b.TEST', vehicle: 'Forte' };
    expect(normalizeLead(payload, website, at).dedupeKey)
      .toBe(normalizeLead(again, website, new Date('2026-05-01T14:00:09Z')).dedupeKey);
  });

  it('treats a different enquiry as different', () => {
    const a = normalizeLead({ phone: '514-555-0100', vehicle: 'Forte' }, website, at);
    const b = normalizeLead({ phone: '514-555-0100', vehicle: 'Sportage' }, website, at);
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });
});

describe('the connectors that ship in the box', () => {
  it('maps a Meta Lead Ads payload', () => {
    const meta = findConnector('meta_lead_ads')!;
    const r = normalizeLead(
      {
        field_data: {
          first_name: 'Luc', last_name: 'Tremblay',
          phone_number: '+1 (450) 555-0199', email: 'luc@example.test',
          vehicle: 'Sportage', language: 'fr',
        },
        privacy_policy_text: 'En soumettant, vous acceptez d’être contacté.',
      },
      meta,
      at,
    );
    expect(r.lead).toMatchObject({
      first_name: 'Luc', phone: '+14505550199', source: 'meta', preferred_language: 'fr-CA',
    });
    // Meta's own form carries the wording and the submission is the tick, so
    // there is no separate box to look for.
    expect(r.consent.length).toBeGreaterThan(0);
    expect(r.consent[0]!.evidence['form_wording']).toContain('acceptez');
  });

  it('every built-in connector can be found by its key', () => {
    expect(findConnector('website_form')).not.toBeNull();
    expect(findConnector('meta_lead_ads')).not.toBeNull();
    expect(findConnector('nope')).toBeNull();
  });
});
