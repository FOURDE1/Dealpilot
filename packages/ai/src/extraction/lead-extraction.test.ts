import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_WINDOW,
  LeadExtraction,
  extractionTranscript,
  extractionWriteback,
  runExtraction,
  type LeadExtractionT,
  type WritebackCurrent,
} from './lead-extraction.js';

const EMPTY: LeadExtractionT = {
  budget: { monthly_budget_cents: null, down_payment_cents: null, budget_type: null },
  vehicle: { type: null, make: null, model: null, year_min: null, new_or_used: null },
  trade_in: { has_trade_in: null, year: null, make: null, model: null, mileage_km: null, has_lien: null, condition: null },
  timeline: 'unknown',
  credit_band: 'unknown',
  language: null,
  contact: { first_name: null, last_name: null, email: null },
  consent_signals: { requested_call: false, said_stop: false, gave_express_consent: false },
  conversation_flags: { wants_human: false, high_intent: false, cannot_answer: false, sentiment: 'neutral' },
};

const CURRENT: WritebackCurrent = {
  monthly_budget_cents: null,
  total_budget_cents: null,
  vehicle_interest: null,
  trade_in_status: 'unknown',
  trade_in_year: null,
  trade_in_make: null,
  trade_in_model: null,
  trade_in_mileage_km: null,
  trade_in_condition: null,
  purchase_timeline: 'unknown',
  credit_band: 'unknown',
  preferred_language: 'fr-CA',
};

describe('extraction schema (§5)', () => {
  it('every property is required — a missing key is a schema error, not an unknown', () => {
    const withoutBudget: Record<string, unknown> = { ...EMPTY };
    delete withoutBudget['budget'];
    expect(LeadExtraction.safeParse(withoutBudget).success).toBe(false);
    expect(LeadExtraction.safeParse(EMPTY).success).toBe(true);
  });

  it('unknown extra keys are rejected (additionalProperties: false)', () => {
    expect(LeadExtraction.safeParse({ ...EMPTY, invented: true }).success).toBe(false);
  });
});

describe('transcript building', () => {
  it('reads only the last 20 messages and spotlights every customer line', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `message ${i}`,
    }));
    const t = extractionTranscript(history);
    expect(t).not.toContain('message 9');
    expect(t).toContain('message 10');
    expect(t.match(/<lead_message untrusted="true">/g)?.length).toBe(EXTRACTION_WINDOW / 2);
  });
});

describe('runExtraction failure contract', () => {
  it('off-schema output is a VALUE carrying the raw payload — the regression corpus', async () => {
    const out = await runExtraction(
      { extract: () => Promise.resolve({ raw: { nonsense: true }, inputTokens: 10, outputTokens: 5 }) },
      [],
    );
    expect(out.extraction).toBeNull();
    expect(out.raw).toEqual({ nonsense: true });
    expect(out.error).toContain('schema mismatch');
    expect(out.inputTokens).toBe(10);
  });

  it('a THROWING client propagates — that is what the queue retry budget is for', async () => {
    await expect(runExtraction({ extract: () => Promise.reject(new Error('boom')) }, [])).rejects.toThrow('boom');
  });
});

describe('write-back rules (§5 table)', () => {
  it('never blanks an existing value: an all-null extraction patches nothing', () => {
    const filled: WritebackCurrent = {
      ...CURRENT,
      monthly_budget_cents: 45000,
      vehicle_interest: 'Kia Sportage',
      trade_in_status: 'has_trade',
      purchase_timeline: 'this_week',
      credit_band: 'prime',
    };
    expect(extractionWriteback(EMPTY, filled).patch).toEqual({});
  });

  it('an amount with UNKNOWN type is written nowhere — D-043 forbids guessing the column', () => {
    const r = extractionWriteback(
      { ...EMPTY, budget: { monthly_budget_cents: 40000, down_payment_cents: null, budget_type: null } },
      CURRENT,
    );
    expect(r.patch['monthly_budget_cents']).toBeUndefined();
    expect(r.patch['total_budget_cents']).toBeUndefined();
  });

  it('budget_type routes the single amount slot to the right column', () => {
    const monthly = extractionWriteback(
      { ...EMPTY, budget: { monthly_budget_cents: 40000, down_payment_cents: null, budget_type: 'monthly' } },
      CURRENT,
    );
    expect(monthly.patch['monthly_budget_cents']).toBe(40000);
    const total = extractionWriteback(
      { ...EMPTY, budget: { monthly_budget_cents: 2500000, down_payment_cents: null, budget_type: 'total' } },
      CURRENT,
    );
    expect(total.patch['total_budget_cents']).toBe(2500000);
    expect(total.patch['monthly_budget_cents']).toBeUndefined();
  });

  it('vehicle facts become the display string; trade-in details land column by column', () => {
    const r = extractionWriteback(
      {
        ...EMPTY,
        vehicle: { type: 'SUV', make: 'Kia', model: 'Sportage', year_min: 2022, new_or_used: 'used' },
        trade_in: { has_trade_in: true, year: 2019, make: 'Honda', model: 'Civic', mileage_km: 88000, has_lien: false, condition: 'good' },
        timeline: 'this_month',
        credit_band: 'near_prime',
      },
      CURRENT,
    );
    expect(r.patch['vehicle_interest']).toBe('2022 Kia Sportage');
    expect(r.patch['trade_in_status']).toBe('has_trade');
    expect(r.patch['trade_in_mileage_km']).toBe(88000);
    expect(r.patch['purchase_timeline']).toBe('this_month');
    expect(r.patch['credit_band']).toBe('near_prime');
  });

  it('identical values are dropped from the patch — no churn writes', () => {
    const r = extractionWriteback(
      { ...EMPTY, timeline: 'this_week' },
      { ...CURRENT, purchase_timeline: 'this_week' },
    );
    expect(r.patch).toEqual({});
  });

  it('language never appears in a patch — write-once is absolute', () => {
    const r = extractionWriteback({ ...EMPTY, language: 'en' }, CURRENT);
    expect(Object.keys(r.patch)).not.toContain('preferred_language');
  });
});
