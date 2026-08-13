import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt, liveContextBlock, platformComplianceBlock,
  type LiveContext, type TenantPromptConfig,
} from './system-prompt.js';
import { summariseInventory, unitLine, visibleUnit } from './inventory-summary.js';

/**
 * §3's block order and §10's first guardrail.
 *
 * The data-starvation cases are the ones that matter. Every other defence in
 * §10 filters what the model produces and can therefore be argued with; this
 * one removes the material, and a customer who insists, offers a number to
 * confirm, or claims a rival quoted them cannot extract a price the model was
 * never given.
 */

const TENANT: TenantPromptConfig = {
  dealershipLegalName: 'Kia Mont-Laurier inc.',
  personaName: 'Camille',
  storeAddress: '123 rue Principale, Mont-Laurier',
  storePhone: '+15145550100',
  hoursText: 'Mon–Fri 9–18, Sat 9–16',
  askLanguagePreference: true,
  currentOffersText: 'Spring event on remaining 2024 stock',
  brands: ['Kia'],
  complianceFooter: 'Reply STOP to opt out.',
  maxMessagesBeforeHandoff: 15,
  photoLimit: 3,
};

/** A row exactly as the database has it — money and all. */
const RAW_UNIT = {
  stock_number: 'K4821',
  year: 2024,
  make: 'Kia',
  model: 'Sorento',
  trim: 'EX',
  mileage_km: 18_450,
  list_price_cents: 4_299_500,
  msrp_cents: 4_650_000,
  vehicle_cost_cents: 3_710_000,
  recon_cost_cents: 84_000,
  interest_rate_bps: 490,
};

const LIVE: LiveContext = {
  inventory: [RAW_UNIT],
  lead: {
    firstName: 'Marie',
    source: 'website',
    vehicleInterest: 'Sorento',
    isDuplicate: false,
    prefilled: [],
    consentState: 'express, sms, conversational',
  },
  localDateTimeText: 'Thursday 13 August 2026, 14:02',
  withinBusinessHours: true,
  nextOpenPhrase: 'first thing tomorrow morning',
  language: 'fr',
};

describe('the model is never shown a number it could leak', () => {
  it('keeps every money field out of the inventory summary', () => {
    const summary = summariseInventory([RAW_UNIT]);
    for (const secret of ['4299500', '4650000', '3710000', '84000', '490', '42 995', '46 500']) {
      expect(summary, secret).not.toContain(secret);
    }
    // What it DOES contain is what §10 guardrail 4 composes replies from.
    expect(summary).toContain('K4821');
    expect(summary).toContain('2024 Kia Sorento EX');
    expect(summary).toContain('18,450 km');
  });

  it('keeps them out of the whole assembled prompt, not just the summary', () => {
    const whole = buildSystemPrompt({ tenant: TENANT, live: LIVE }).map((b) => b.text).join('\n');
    expect(whole).not.toContain('4299500');
    expect(whole).not.toContain('4650000');
  });

  it('builds from an allow-list, so a money column added tomorrow is excluded too', () => {
    // A deny-list implementation passes the tests above and leaks on the next
    // migration. This is the case that tells them apart.
    const withNewColumn = { ...RAW_UNIT, wholesale_floor_cents: 3_000_000, dealer_holdback_cents: 120_000 };
    const summary = summariseInventory([withNewColumn]);
    expect(summary).not.toContain('3000000');
    expect(summary).not.toContain('120000');
    expect(visibleUnit(withNewColumn)).toEqual({
      stock_number: 'K4821', year: 2024, make: 'Kia', model: 'Sorento', trim: 'EX', mileage_km: 18_450,
    });
  });

  it('refuses a unit with no stock number instead of describing it', () => {
    // The outbound guard matches vehicle mentions by stock number. A unit
    // without one is a unit the guard would call invented — better to fail here
    // than to have a real car blocked as a hallucination.
    expect(() => visibleUnit({ ...RAW_UNIT, stock_number: null })).toThrow(/stock_number/);
    expect(() => visibleUnit({ ...RAW_UNIT, stock_number: '   ' })).toThrow(/stock_number/);
  });

  it('says so plainly when there is nothing to sell', () => {
    expect(summariseInventory([])).toMatch(/No vehicles/);
  });

  it('caps the summary, because block 4 is paid for on every single turn', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ ...RAW_UNIT, stock_number: `K${i}` }));
    expect(summariseInventory(many).split('\n')).toHaveLength(50);
    expect(summariseInventory(many, 3).split('\n')).toHaveLength(3);
  });
});

describe('the four blocks', () => {
  it('are in §3’s order, with the volatile one last', () => {
    const blocks = buildSystemPrompt({ tenant: TENANT, live: LIVE });
    expect(blocks.map((b) => b.id)).toEqual([
      'platform_core', 'platform_compliance', 'tenant', 'live_context',
    ]);
    // Last is not a style choice: anywhere else and every turn invalidates a
    // prefix that would otherwise be read at a 90% discount.
    expect(blocks[blocks.length - 1]!.id).toBe('live_context');
  });

  it('breaks the cache after the platform blocks and after the tenant block', () => {
    const blocks = buildSystemPrompt({ tenant: TENANT, live: LIVE });
    expect(blocks.map((b) => b.cacheBreakpoint)).toEqual([false, true, true, false]);
    // The volatile block must never be cached; caching it would serve a stale
    // inventory and a stale clock.
    expect(blocks.find((b) => b.id === 'live_context')!.cacheBreakpoint).toBe(false);
  });

  it('makes the platform blocks byte-identical across tenants', () => {
    const a = buildSystemPrompt({ tenant: TENANT, live: LIVE });
    const b = buildSystemPrompt({
      tenant: { ...TENANT, dealershipLegalName: 'Autos Rive-Sud', personaName: 'Alex', brands: ['Honda'] },
      live: LIVE,
    });
    // Block 2 carries no tenant data at all, which is what makes it cacheable
    // globally. Block 1 names the persona, so only block 2 is compared.
    expect(a[1]!.text).toBe(b[1]!.text);
    expect(a[2]!.text).not.toBe(b[2]!.text);
  });

  it('forbids rather than discourages', () => {
    const text = platformComplianceBlock();
    // "Avoid discussing rates" is advice, and a model under pressure from a
    // persistent customer treats advice as negotiable.
    expect(text).toMatch(/never state or estimate/i);
    expect(text).toMatch(/interest rate/i);
    expect(text).toMatch(/approval odds/i);
    expect(text).toMatch(/trade-in value/i);
    expect(text).toMatch(/delivery date/i);
    expect(text).not.toMatch(/\btry to avoid\b/i);
    // And it names the pressure it expects.
    expect(text).toMatch(/even when the customer\s+insists/i);
  });

  it('never asks for a credit score or a SIN', () => {
    expect(platformComplianceBlock()).toMatch(/social insurance number/i);
  });
});

describe('what changes every turn', () => {
  it('tells the assistant not to re-ask what an application already answered', () => {
    const text = liveContextBlock({
      ...LIVE,
      lead: { ...LIVE.lead, prefilled: ['income', 'employment', 'date of birth'] },
    });
    expect(text).toContain('income, employment, date of birth');
    expect(text).toMatch(/Never ask for these again/i);
  });

  it('opens differently for somebody who has applied before', () => {
    const text = liveContextBlock({ ...LIVE, lead: { ...LIVE.lead, isDuplicate: true } });
    expect(text).toMatch(/still interested rather than starting over/i);
  });

  it('sets an honest expectation when the doors are shut', () => {
    const open = liveContextBlock(LIVE);
    expect(open).toMatch(/dealership is open/i);
    const closed = liveContextBlock({
      ...LIVE, withinBusinessHours: false, nextOpenPhrase: 'on Monday morning',
    });
    expect(closed).toMatch(/closed/i);
    // Still collects everything — §3 is explicit that after-hours leads are
    // fully engaged, only the promise changes.
    expect(closed).toMatch(/Collect everything as usual/i);
    expect(closed).toContain('on Monday morning');
  });

  it('locks the language', () => {
    expect(liveContextBlock(LIVE)).toMatch(/language: French. Do not switch/);
    expect(liveContextBlock({ ...LIVE, language: 'en' })).toMatch(/language: English. Do not switch/);
  });
});

describe('one vehicle, rendered', () => {
  it('is the template §10 guardrail 4 composes from', () => {
    expect(unitLine(visibleUnit(RAW_UNIT))).toBe('K4821: 2024 Kia Sorento EX — 18,450 km');
  });

  it('degrades without inventing detail', () => {
    expect(unitLine(visibleUnit({ stock_number: 'X1' }))).toBe('X1: unspecified');
  });
});
